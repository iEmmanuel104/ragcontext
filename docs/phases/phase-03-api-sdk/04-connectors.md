# 04 — Connectors

> **Package**: `packages/connectors` | **Namespace**: `@ci/connectors`
> **Entry Point**: `packages/connectors/src/index.ts`

---

## Overview

The connector system provides a unified interface for ingesting documents from external data sources into ContextInject. Each connector implements the `BaseConnector` abstract class, which defines the contract for fetching documents, validating credentials, and handling webhooks.

Phase 3 ships 3 initial connectors:

1. **Notion** — OAuth integration, NotionToMarkdown conversion, polling for changes
2. **Google Drive** — OAuth 2.0 PKCE, Google Docs/Sheets/Slides/PDF/DOCX support
3. **Direct Upload** — PDF, DOCX, HTML, TXT, Markdown via Docling parser

Future connectors (Phase 5+): Slack, Gmail, GitHub, Confluence, Jira, SharePoint.

---

## Base Connector Interface

```typescript
// packages/connectors/src/base.ts
import type { ConnectorConfig } from "@ci/types";
import { decrypt } from "@ci/crypto";

export interface ConnectorDocument {
  /** Unique ID in the source system (e.g., Notion page ID, Google Drive file ID) */
  externalId: string;
  /** Document title */
  title: string;
  /** Extracted text content (markdown preferred) */
  content: string;
  /** MIME type of the original document */
  mimeType: string;
  /** URL to the document in the source system */
  sourceUrl: string;
  /** Source-specific metadata */
  metadata: Record<string, unknown>;
  /** Last modification time in the source system */
  lastModified: Date;
}

export abstract class BaseConnector {
  protected config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  /**
   * Fetch all documents from the data source as an async generator.
   * Yields documents one at a time to support large collections without
   * loading everything into memory.
   */
  abstract fetchDocuments(): AsyncGenerator<ConnectorDocument>;

  /**
   * Fetch a single document by its external ID.
   * Used for incremental sync when a webhook notifies of a change.
   */
  abstract fetchDocument(externalId: string): Promise<ConnectorDocument>;

  /**
   * Validate that the stored credentials are still valid.
   * Returns false if the OAuth token has expired and refresh fails.
   */
  abstract validateCredentials(): Promise<boolean>;

  /**
   * Return webhook configuration if the source supports push notifications.
   * Returns null for polling-only sources (e.g., Notion).
   */
  abstract getWebhookConfig(): { url: string; events: string[] } | null;

  /**
   * Decrypt the stored credentials using AES-256-GCM.
   */
  protected decryptCredentials<T = Record<string, string>>(): T {
    const { encrypted, iv, authTag } = this.config.credentials;
    const decrypted = decrypt(encrypted, iv, authTag);
    return JSON.parse(decrypted) as T;
  }
}
```

---

## Connector 1: Notion

### Implementation

```typescript
// packages/connectors/src/notion/index.ts
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import type { ConnectorConfig } from "@ci/types";
import { BaseConnector, type ConnectorDocument } from "../base";
import { logger } from "@ci/logger";

interface NotionCredentials {
  accessToken: string;
  workspaceId: string;
  botId: string;
}

export class NotionConnector extends BaseConnector {
  private client: Client;
  private n2m: NotionToMarkdown;

  constructor(config: ConnectorConfig) {
    super(config);
    const creds = this.decryptCredentials<NotionCredentials>();
    this.client = new Client({ auth: creds.accessToken });
    this.n2m = new NotionToMarkdown({ notionClient: this.client });
  }

  async *fetchDocuments(): AsyncGenerator<ConnectorDocument> {
    let cursor: string | undefined;
    let fetchedCount = 0;
    const maxDocuments = this.config.syncConfig.maxDocuments ?? Infinity;

    do {
      const response = await this.client.search({
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: cursor,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      });

      for (const page of response.results) {
        if (page.object !== "page") continue;
        if (fetchedCount >= maxDocuments) return;

        // Apply include/exclude filters
        if (!this.matchesFilters(page)) continue;

        try {
          const doc = await this.fetchDocument(page.id);
          fetchedCount++;
          yield doc;
        } catch (error) {
          logger.error({ pageId: page.id, error }, "Failed to fetch Notion page");
        }
      }

      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  async fetchDocument(pageId: string): Promise<ConnectorDocument> {
    const page = (await this.client.pages.retrieve({ page_id: pageId })) as any;

    // Convert Notion blocks to Markdown using notion-to-md
    const mdBlocks = await this.n2m.pageToMarkdown(pageId);
    const content = this.n2m.toMarkdownString(mdBlocks).parent;

    // Extract title from various Notion property formats
    const title = this.extractTitle(page);

    return {
      externalId: pageId,
      title,
      content,
      mimeType: "text/markdown",
      sourceUrl: page.url,
      metadata: {
        notionPageId: pageId,
        lastEditedBy: page.last_edited_by?.id,
        createdBy: page.created_by?.id,
        databaseId: page.parent?.database_id,
        parentType: page.parent?.type,
        archived: page.archived,
      },
      lastModified: new Date(page.last_edited_time),
    };
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.client.users.me();
      return true;
    } catch {
      return false;
    }
  }

  getWebhookConfig() {
    // Notion does not support webhooks natively.
    // We use polling via BullMQ recurring jobs instead.
    return null;
  }

  private extractTitle(page: any): string {
    // Notion stores titles in various property types
    const props = page.properties ?? {};
    for (const key of ["title", "Title", "Name", "name"]) {
      const prop = props[key];
      if (prop?.title?.[0]?.plain_text) return prop.title[0].plain_text;
    }
    return "Untitled";
  }

  private matchesFilters(page: any): boolean {
    const { includeFilters, excludeFilters } = this.config.syncConfig;
    const pageUrl = page.url ?? "";
    const pageTitle = this.extractTitle(page).toLowerCase();

    if (includeFilters?.length) {
      const matches = includeFilters.some(
        (f) => pageUrl.includes(f) || pageTitle.includes(f.toLowerCase()),
      );
      if (!matches) return false;
    }

    if (excludeFilters?.length) {
      const matches = excludeFilters.some(
        (f) => pageUrl.includes(f) || pageTitle.includes(f.toLowerCase()),
      );
      if (matches) return false;
    }

    return true;
  }
}
```

### Notion OAuth Flow

1. User clicks "Connect Notion" in dashboard
2. Dashboard redirects to Notion OAuth authorization URL
3. User authorizes access to their workspace
4. Notion redirects back with authorization code
5. API server exchanges code for access token
6. Token is encrypted with AES-256-GCM via `@ci/crypto` and stored in `connectors.credentials`
7. A BullMQ recurring job is created for periodic sync

### Sync Strategy

Since Notion lacks webhooks, we use polling:

- Default poll interval: 15 minutes (configurable)
- Uses `last_edited_time` sort to fetch only recently changed pages
- Compares SHA-256 content hash to detect actual content changes
- Only re-indexes pages whose content hash has changed

---

## Connector 2: Google Drive

```typescript
// packages/connectors/src/google-drive/index.ts
import { google, type drive_v3 } from "googleapis";
import type { ConnectorConfig } from "@ci/types";
import { BaseConnector, type ConnectorDocument } from "../base";
import { logger } from "@ci/logger";

interface GoogleDriveCredentials {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
}

export class GoogleDriveConnector extends BaseConnector {
  private drive: drive_v3.Drive;

  constructor(config: ConnectorConfig) {
    super(config);
    const creds = this.decryptCredentials<GoogleDriveCredentials>();

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      expiry_date: new Date(creds.tokenExpiry).getTime(),
    });

    this.drive = google.drive({ version: "v3", auth: oauth2Client });
  }

  async *fetchDocuments(): AsyncGenerator<ConnectorDocument> {
    let pageToken: string | undefined;

    const mimeTypes = [
      "application/vnd.google-apps.document", // Google Docs
      "application/vnd.google-apps.spreadsheet", // Google Sheets
      "application/vnd.google-apps.presentation", // Google Slides
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
      "text/plain",
      "text/markdown",
      "text/html",
    ];

    const query = mimeTypes.map((m) => `mimeType='${m}'`).join(" or ");

    do {
      const response = await this.drive.files.list({
        q: `(${query}) and trashed=false`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
        pageSize: 100,
        pageToken,
        orderBy: "modifiedTime desc",
      });

      for (const file of response.data.files ?? []) {
        try {
          const doc = await this.fetchDocument(file.id!);
          yield doc;
        } catch (error) {
          logger.error({ fileId: file.id, error }, "Failed to fetch Google Drive file");
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  async fetchDocument(fileId: string): Promise<ConnectorDocument> {
    // Get file metadata
    const file = await this.drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, webViewLink, size",
    });

    const mimeType = file.data.mimeType ?? "";
    let content: string;

    if (mimeType.startsWith("application/vnd.google-apps.")) {
      // Google Workspace files: export as text
      content = await this.exportGoogleFile(fileId, mimeType);
    } else {
      // Binary files: download and parse with Docling
      content = await this.downloadAndParse(fileId, mimeType);
    }

    return {
      externalId: fileId,
      title: file.data.name ?? "Untitled",
      content,
      mimeType,
      sourceUrl: file.data.webViewLink ?? "",
      metadata: {
        googleDriveFileId: fileId,
        size: file.data.size,
        originalMimeType: mimeType,
      },
      lastModified: new Date(file.data.modifiedTime ?? Date.now()),
    };
  }

  private async exportGoogleFile(fileId: string, mimeType: string): Promise<string> {
    const exportMimes: Record<string, string> = {
      "application/vnd.google-apps.document": "text/markdown",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
    };

    const exportMime = exportMimes[mimeType] ?? "text/plain";
    const response = await this.drive.files.export({
      fileId,
      mimeType: exportMime,
    });

    return response.data as string;
  }

  private async downloadAndParse(fileId: string, mimeType: string): Promise<string> {
    const response = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);

    // Parse using Docling (LF AI Foundation, MIT license)
    // Docling handles: PDF, DOCX, HTML, PPTX, images, Markdown
    const { DocumentConverter } = await import("@docling/core");
    const converter = new DocumentConverter();
    const result = await converter.convert(buffer, { mimeType });
    return result.document.exportToMarkdown();
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.drive.about.get({ fields: "user" });
      return true;
    } catch {
      return false;
    }
  }

  getWebhookConfig() {
    // Google Drive supports push notifications via the Changes API
    return {
      url: `${process.env.API_BASE_URL}/webhooks/google-drive/${this.config.id}`,
      events: ["change"],
    };
  }
}
```

### Google Drive OAuth Flow (PKCE)

1. Dashboard generates a code verifier + code challenge (PKCE)
2. Redirects user to Google OAuth with `response_type=code` and code challenge
3. User authorizes access to their Google Drive
4. Google redirects back with authorization code
5. API exchanges code + verifier for access + refresh tokens
6. Tokens are encrypted and stored
7. Register a Google Drive Changes webhook for real-time sync

---

## Connector 3: Direct Upload

The direct upload connector handles files uploaded directly through the API or dashboard. It uses **Docling** (LF AI Foundation, MIT license) as the document parser, replacing LlamaParse.

```typescript
// packages/connectors/src/direct-upload/index.ts
import type { ConnectorConfig } from "@ci/types";
import { BaseConnector, type ConnectorDocument } from "../base";

export class DirectUploadConnector extends BaseConnector {
  private content: string;
  private filename: string;
  private mimeType: string;

  constructor(
    config: ConnectorConfig,
    options: { content: string; filename: string; mimeType: string },
  ) {
    super(config);
    this.content = options.content;
    this.filename = options.filename;
    this.mimeType = options.mimeType;
  }

  async *fetchDocuments(): AsyncGenerator<ConnectorDocument> {
    yield await this.fetchDocument(this.filename);
  }

  async fetchDocument(_externalId: string): Promise<ConnectorDocument> {
    let parsedContent: string;

    // Text-based formats: use directly
    if (["text/plain", "text/markdown", "text/html"].includes(this.mimeType)) {
      parsedContent = this.content;
    } else {
      // Binary formats: parse with Docling
      parsedContent = await this.parseWithDocling(
        Buffer.from(this.content, "base64"),
        this.mimeType,
      );
    }

    return {
      externalId: `upload_${Date.now()}`,
      title: this.filename,
      content: parsedContent,
      mimeType: this.mimeType,
      sourceUrl: "",
      metadata: {
        uploadedFilename: this.filename,
        originalMimeType: this.mimeType,
      },
      lastModified: new Date(),
    };
  }

  private async parseWithDocling(buffer: Buffer, mimeType: string): Promise<string> {
    // Docling: LF AI Foundation, MIT license
    // Handles PDF, DOCX, PPTX, HTML, images, AsciiDoc, Markdown
    // Uses layout-aware AI models for structure preservation
    const { DocumentConverter } = await import("@docling/core");
    const converter = new DocumentConverter();
    const result = await converter.convert(buffer, { mimeType });
    return result.document.exportToMarkdown();
  }

  async validateCredentials(): Promise<boolean> {
    return true; // Direct upload needs no credentials
  }

  getWebhookConfig() {
    return null; // Direct upload is a one-time operation
  }
}
```

### Supported File Types

| Format     | MIME Type                                                                   | Parser                            |
| ---------- | --------------------------------------------------------------------------- | --------------------------------- |
| PDF        | `application/pdf`                                                           | Docling                           |
| DOCX       | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`   | Docling                           |
| PPTX       | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | Docling                           |
| HTML       | `text/html`                                                                 | Direct (or Docling for structure) |
| Markdown   | `text/markdown`                                                             | Direct                            |
| Plain Text | `text/plain`                                                                | Direct                            |

---

## Credential Encryption

All connector credentials are encrypted at rest using AES-256-GCM via `@ci/crypto`:

```typescript
// packages/crypto/src/index.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex"); // 32 bytes

export function encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  return { encrypted, iv: iv.toString("base64"), authTag };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

---

## Sync Scheduling with BullMQ

Connectors that support recurring sync (Notion, Google Drive) use BullMQ repeatable jobs:

```typescript
// packages/connectors/src/sync-scheduler.ts
import { Queue } from "bullmq";

const syncQueue = new Queue("connector-sync", {
  connection: { url: process.env.REDIS_URL },
});

export async function scheduleSyncJob(connectorId: string, intervalMinutes: number) {
  await syncQueue.add(
    `sync-${connectorId}`,
    { connectorId },
    {
      repeat: { every: intervalMinutes * 60 * 1000 },
      jobId: `sync-${connectorId}`, // Ensures only one schedule per connector
    },
  );
}

export async function cancelSyncJob(connectorId: string) {
  await syncQueue.removeRepeatableByKey(`sync-${connectorId}`);
}
```

---

## Future Connectors Roadmap

| Connector   | Priority         | Transport           | Notes                                     |
| ----------- | ---------------- | ------------------- | ----------------------------------------- |
| Slack       | High (Phase 5)   | OAuth + Events API  | Webhook-based real-time sync              |
| Gmail       | High (Phase 5)   | OAuth + Gmail API   | Push notifications via Pub/Sub            |
| GitHub      | Medium           | OAuth + Webhooks    | Repository files, issues, PRs, wikis      |
| Confluence  | Medium           | OAuth + REST API    | Space-level sync                          |
| Jira        | Medium           | OAuth + Webhooks    | Issue and comment indexing                |
| SharePoint  | Low (Enterprise) | Microsoft Graph API | Requires Azure AD integration             |
| Web Crawler | Low              | HTTP                | Crawl websites by sitemap or URL patterns |

Each future connector will implement the same `BaseConnector` abstract class, ensuring a consistent interface for the ingestion pipeline.

---

## Testing Requirements

```typescript
// packages/connectors/src/__tests__/notion.test.ts
import { describe, it, expect, vi } from "vitest";
import { NotionConnector } from "../notion";

describe("NotionConnector", () => {
  it("fetches and converts a Notion page to markdown", async () => {
    // Mock Notion API client
    const mockConfig = createMockConnectorConfig("notion");
    const connector = new NotionConnector(mockConfig);
    const doc = await connector.fetchDocument("test-page-id");
    expect(doc.content).toBeDefined();
    expect(doc.mimeType).toBe("text/markdown");
  });

  it("respects include/exclude filters", async () => {
    // Test filter matching
  });

  it("handles pagination correctly", async () => {
    // Test async generator with multiple pages
  });

  it("validates credentials", async () => {
    // Test credential validation
  });
});
```

- Credential encryption/decryption roundtrip test
- Sync scheduler: verify BullMQ job creation and cancellation
- Google Drive: OAuth token refresh on expiry
- Direct Upload: each supported file format parses correctly
- Error handling: connector fails gracefully on individual document errors

---

## Related Documentation

- [Phase 3 README](./README.md) — Phase overview
- [01-api-server.md](./01-api-server.md) — API routes that manage connectors
- [Phase 5: Security Hardening](../phase-05-production/03-security-hardening.md) — PII detection in ingestion
