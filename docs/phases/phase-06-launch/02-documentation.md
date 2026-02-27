# Phase 6.2: Documentation Strategy

> Complete documentation plan for ContextInject launch — from README to API reference to deployment guides.

---

## Objectives

1. Enable "time to first RAG query" under 3 minutes via a clear quickstart guide
2. Generate comprehensive API reference from OpenAPI 3.1 specification
3. Provide deployment guides for Docker, Railway, Fly.io, and AWS ECS
4. Build a documentation site using Mintlify or Docusaurus

## Deliverables

- Root README.md with hero section, quickstart, badges, and feature overview
- Quickstart guide (standalone, expanded version)
- OpenAPI 3.1 specification generated from Express 5 route definitions
- SDK documentation generated from TypeDoc
- MCP server setup guide
- Connector guides (Notion, Google Drive, Direct Upload)
- Architecture overview for contributors
- Deployment guides (4 platforms)
- Self-hosting guide
- Documentation site deployed

## Dependencies

- All API endpoints finalized (Phase 3)
- SDK published to npm (Phase 6.3)
- MCP server functional (Phase 4)
- Connectors implemented (Phases 2-3)

---

## 1. Root README.md

The README is the first thing developers see. It must communicate value in 10 seconds and enable first use in 3 minutes.

### Structure

```markdown
# ContextInject

> The Stripe for RAG — intelligent context middleware between any data source
> and any AI model.

[Badges: npm version, GitHub stars, license, CI status, Discord]

## What is ContextInject?

[2-3 sentence description with value proposition]

## Quickstart

[3-minute path: install SDK -> create project -> upload document -> query]

## Features

[Grid of key features with icons/descriptions]

- Full RAG pipeline (ingestion -> retrieval -> context assembly)
- Hybrid search (dense vectors + BM25)
- Cohere Embed v4 + Rerank 3.5
- Quality scoring (Context Quality Score)
- Semantic caching (65x latency reduction)
- MCP server for AI agent integration
- Multi-tenant with permission-aware retrieval
- Open-source SDK and connectors

## Architecture

[Diagram: Data Sources -> ContextInject Pipeline -> AI Models]

## Documentation

[Links to full docs site]

## Self-Hosting

[Link to self-hosting guide]

## Contributing

[Link to CONTRIBUTING.md]

## License

MIT (SDKs, connectors, CLI) | Apache 2.0 (core packages)
```

### Badges

```markdown
[![npm version](https://badge.fury.io/js/contextinject.svg)](https://www.npmjs.com/package/contextinject)
[![GitHub stars](https://img.shields.io/github/stars/contextinject/context-inject)](https://github.com/contextinject/context-inject)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/contextinject/context-inject/actions/workflows/ci.yml/badge.svg)](https://github.com/contextinject/context-inject/actions)
[![Discord](https://img.shields.io/discord/XXXXXXX?label=Discord)](https://discord.gg/contextinject)
```

---

## 2. Quickstart Guide

### "Time to First RAG Query" in Under 3 Minutes

```markdown
# Quickstart

## Step 1: Install the SDK (30 seconds)

npm install contextinject

# or

pnpm add contextinject

## Step 2: Initialize the Client (10 seconds)

import { ContextInject } from 'contextinject';

const ci = new ContextInject({
apiKey: 'ci_live_your_api_key_here',
});

## Step 3: Create a Project (10 seconds)

const project = await ci.createProject('My Knowledge Base');
const projectId = project.data.id;

## Step 4: Upload a Document (30 seconds)

await ci.uploadText(
projectId,
'Our refund policy allows full refunds within 30 days of purchase.',
{ title: 'Refund Policy' }
);

// Wait for indexing (usually 5-15 seconds)
await new Promise(r => setTimeout(r, 10000));

## Step 5: Query Your Data (10 seconds)

const result = await ci.query(projectId, 'What is the refund policy?');
console.log(result.data.context.text);
// => "Our refund policy allows full refunds within 30 days..."
console.log(result.data.quality.overall);
// => 0.92

## That is it. You just built a RAG pipeline.

Next steps:

- [Upload PDFs and DOCX files](/docs/uploading-documents)
- [Connect Notion or Google Drive](/docs/connectors)
- [Set up the MCP server for AI agents](/docs/mcp-server)
- [Deploy to production](/docs/deployment)
```

---

## 3. API Reference (OpenAPI 3.1)

### Generation Strategy

The API reference is generated from code using `@asteasolutions/zod-to-openapi`:

```typescript
// apps/api/src/openapi.ts
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { QuerySchema, QueryResponseSchema } from "./schemas";

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: "post",
  path: "/v1/query",
  summary: "Query your knowledge base",
  description: "Retrieve relevant context from indexed documents for a given query.",
  request: { body: { content: { "application/json": { schema: QuerySchema } } } },
  responses: {
    200: {
      description: "Successful retrieval",
      content: { "application/json": { schema: QueryResponseSchema } },
    },
    400: { description: "Validation error" },
    401: { description: "Unauthorized" },
    429: { description: "Rate limit exceeded" },
  },
  tags: ["Query"],
  security: [{ bearerAuth: [] }],
});
```

### Endpoint Reference

| Method   | Path                   | Description                     | Auth Scope        |
| -------- | ---------------------- | ------------------------------- | ----------------- |
| `POST`   | `/v1/query`            | Retrieve context for a query    | `query`           |
| `POST`   | `/v1/documents/upload` | Upload a document for indexing  | `documents:write` |
| `GET`    | `/v1/documents`        | List documents in a project     | `documents:read`  |
| `GET`    | `/v1/documents/:id`    | Get document details and status | `documents:read`  |
| `DELETE` | `/v1/documents/:id`    | Delete a document (cascade)     | `documents:write` |
| `POST`   | `/v1/projects`         | Create a new project            | `admin`           |
| `GET`    | `/v1/projects`         | List all projects               | `admin`           |
| `POST`   | `/v1/connectors`       | Create a new connector          | `admin`           |
| `GET`    | `/v1/connectors`       | List connectors                 | `admin`           |
| `GET`    | `/v1/analytics`        | Get usage analytics             | `admin`           |
| `GET`    | `/health`              | Health check (no auth)          | None              |

### Key API Endpoint Details

#### POST /v1/query

**Request Body**:

```json
{
  "query": "What is the refund policy?",
  "projectId": "uuid",
  "topK": 5,
  "conversationId": "uuid (optional)",
  "filters": [{ "field": "metadata.department", "operator": "eq", "value": "support" }],
  "stream": false
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "query": "What is the refund policy?",
    "chunks": [
      {
        "id": "uuid",
        "documentId": "uuid",
        "content": "Our refund policy allows...",
        "score": 0.95,
        "vectorScore": 0.92,
        "rerankScore": 0.97,
        "metadata": { "pageNumber": 3, "sectionTitle": "Refund Policy" }
      }
    ],
    "context": {
      "text": "Assembled context string for LLM injection...",
      "tokenCount": 450,
      "citations": [
        {
          "chunkId": "uuid",
          "documentId": "uuid",
          "documentTitle": "Customer Support FAQ",
          "sourceUrl": "https://...",
          "excerpt": "Our refund policy allows..."
        }
      ]
    },
    "quality": {
      "overall": 0.92,
      "retrievalConfidence": 0.95,
      "contextSufficiency": 0.88,
      "diversityScore": 0.85,
      "estimatedFaithfulness": 0.91
    },
    "latencyMs": 142,
    "cacheHit": false,
    "usage": {
      "documentsScanned": 45,
      "chunksRetrieved": 100,
      "chunksAfterRerank": 5,
      "embeddingTokens": 12
    }
  }
}
```

#### POST /v1/documents/upload

**Request**: `multipart/form-data`

- `file`: Document file (PDF, DOCX, TXT, MD, HTML)
- `projectId`: UUID string
- `metadata`: Optional JSON string

**Response** (202 Accepted):

```json
{
  "success": true,
  "data": {
    "documentId": "uuid",
    "status": "processing"
  }
}
```

---

## 4. SDK Documentation (TypeDoc)

### Generation

```bash
# Generate SDK docs from TypeScript source
pnpm --filter @ci/sdk typedoc --out docs/sdk-reference src/index.ts
```

### Key SDK Classes and Methods

```typescript
class ContextInject {
  constructor(config: ContextInjectConfig);

  // Query
  query(projectId: string, query: string, options?: QueryOptions): Promise<QueryResponse>;

  // Documents
  uploadText(projectId: string, content: string, options?: UploadOptions): Promise<UploadResponse>;
  uploadFile(
    projectId: string,
    file: Blob | Buffer,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResponse>;
  listDocuments(projectId: string, page?: number, limit?: number): Promise<ListResponse>;
  getDocument(documentId: string): Promise<DocumentResponse>;
  deleteDocument(documentId: string): Promise<void>;

  // Projects
  createProject(name: string, description?: string): Promise<ProjectResponse>;
  listProjects(): Promise<ListResponse>;

  // Analytics
  getAnalytics(projectId: string, period?: string): Promise<AnalyticsResponse>;
}
```

---

## 5. MCP Server Setup Guide

```markdown
# MCP Server Setup

ContextInject provides an MCP (Model Context Protocol) server that enables
Claude, GPT, and any MCP-compatible AI agent to retrieve context from your
knowledge base.

## Installation

npm install -g @ci/mcp-server

## Configuration

Add to your Claude Desktop config (~/.claude/mcp.json):

{
"mcpServers": {
"context-inject": {
"command": "ci-mcp-server",
"env": {
"CONTEXT_INJECT_API_KEY": "ci_live_your_key",
"CONTEXT_INJECT_URL": "https://api.contextinject.ai"
}
}
}
}

## Available Tools

### retrieve_context

Retrieve relevant context from your connected data sources.

Parameters:

- query (string, required): The question or topic to retrieve context for
- projectId (string, required): Your ContextInject project ID
- topK (number, optional): Number of chunks to retrieve (default: 5)
- conversationId (string, optional): For conversation memory continuity

### index_document

Add a document to ContextInject for future retrieval.

Parameters:

- content (string, required): Document text content
- title (string, required): Document title
- projectId (string, required): Your ContextInject project ID
- sourceUrl (string, optional): Source URL of the document

## Self-Hosting the MCP Server

docker run -e CONTEXT*INJECT_API_KEY=ci_live*... contextinject/mcp-server
```

---

## 6. Connector Guides

### Notion Connector

```markdown
# Notion Connector Setup

## 1. Create a Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Create a new integration
3. Copy the Internal Integration Token

## 2. Share Pages with the Integration

1. Open the Notion page you want to index
2. Click "Share" in the top right
3. Search for your integration name
4. Click "Invite"

## 3. Create the Connector in ContextInject

POST /v1/connectors
{
"type": "notion",
"projectId": "your-project-id",
"credentials": { "accessToken": "ntn\_..." },
"syncConfig": {
"intervalMinutes": 60,
"includeFilters": ["*"],
"maxDocuments": 1000
}
}

## 4. Verify Sync

GET /v1/connectors/{connectorId}
// Status should show "active" with lastSyncAt timestamp
```

### Google Drive Connector

Similar structure with OAuth 2.0 PKCE flow for authentication.

### Direct Upload

```markdown
# Direct Upload Guide

Upload files directly to ContextInject via the API or SDK.

## Supported Formats

- PDF (.pdf) — parsed with Docling
- Word (.docx) — parsed with Docling
- PowerPoint (.pptx) — parsed with Docling
- HTML (.html)
- Markdown (.md)
- Plain text (.txt)

## File Size Limit: 50MB per file

## SDK Example

const result = await ci.uploadFile(
projectId,
fs.readFileSync('./my-document.pdf'),
'my-document.pdf'
);
```

---

## 7. Architecture Overview for Contributors

```markdown
# Architecture

## Monorepo Structure

context-inject/
apps/
api/ - Express 5 REST API (Node.js 22)
worker/ - BullMQ background job processor
dashboard/ - Next.js 16 web UI
mcp-server/ - MCP server for AI agent integration
packages/
core/ - Pipeline engine (ingestion + retrieval)
types/ - Shared TypeScript types (@ci/types)
db/ - Drizzle ORM schema + migrations (PostgreSQL 17)
vector-store/ - Qdrant adapter + IVectorStore interface
embeddings/ - Cohere v4 adapter + IEmbeddingProvider
chunker/ - Semantic chunking engine
reranker/ - Cohere Rerank 3.5 adapter
compressor/ - LLMLingua-2 context compression
evaluator/ - Context quality scoring (proprietary)
cache/ - Semantic cache (Redis-backed)
sdk/ - Public TypeScript SDK
connectors/ - Data source connectors (Notion, GDrive, etc.)
queue/ - BullMQ job definitions
logger/ - Pino structured logging

## Data Flow

Upload -> Docling parse -> Semantic chunk -> Cohere v4 embed -> Qdrant store
Query -> Embed query -> Hybrid search -> Cohere Rerank 3.5 -> Quality score -> Context assembly
```

---

## 8. Deployment Guides

### Docker (Self-Hosting)

```markdown
# Deploy with Docker

## Quick Start

git clone https://github.com/contextinject/context-inject
cd context-inject
cp .env.example .env.local

# Edit .env.local with your API keys

docker compose -f infra/docker/docker-compose.yml up -d

# Run migrations

docker compose exec api pnpm db:migrate

# Access

API: http://localhost:3000
Dashboard: http://localhost:3100
```

### Railway

```markdown
# Deploy to Railway

1. Fork the repo on GitHub
2. Create a new Railway project
3. Add services: PostgreSQL, Redis, and a custom service from your repo
4. Set environment variables
5. Deploy
```

### Fly.io

```markdown
# Deploy to Fly.io

fly launch --name contextinject-api
fly postgres create --name contextinject-db
fly redis create --name contextinject-cache
fly secrets set COHERE_API_KEY=your_key DATABASE_URL=... REDIS_URL=...
fly deploy
```

### AWS ECS

```markdown
# Deploy to AWS ECS

Terraform modules provided in infra/terraform/:

- VPC with private subnets
- ECS Fargate cluster
- RDS PostgreSQL 17
- ElastiCache Redis 7.2
- Application Load Balancer
- CloudWatch logging

cd infra/terraform
terraform init
terraform plan
terraform apply
```

---

## 9. Documentation Site

### Recommended: Mintlify

| Feature             | Mintlify            | Docusaurus          |
| ------------------- | ------------------- | ------------------- |
| Setup time          | Minutes (hosted)    | Hours (self-hosted) |
| OpenAPI integration | Native              | Plugin              |
| Design              | Modern, polished    | Customizable        |
| Search              | Built-in Algolia    | Requires setup      |
| Versioning          | Built-in            | Built-in            |
| Cost                | Free tier available | Free (OSS)          |
| Analytics           | Built-in            | Requires setup      |

**Decision**: Mintlify for faster launch, consider Docusaurus if self-hosting is preferred.

### Site Structure

```
docs/
  introduction.mdx
  quickstart.mdx
  api-reference/
    query.mdx
    documents.mdx
    projects.mdx
    connectors.mdx
    analytics.mdx
    health.mdx
  sdk/
    typescript.mdx
    python.mdx (future)
  connectors/
    notion.mdx
    google-drive.mdx
    direct-upload.mdx
  deployment/
    docker.mdx
    railway.mdx
    fly-io.mdx
    aws-ecs.mdx
    self-hosting.mdx
  mcp/
    setup.mdx
    tools.mdx
  concepts/
    architecture.mdx
    pipeline.mdx
    quality-scoring.mdx
    semantic-caching.mdx
```

---

## Cross-References

- Phase 6 overview: [README.md](./README.md)
- OSS preparation: [03-oss-preparation.md](./03-oss-preparation.md)
- Launch checklist: [04-launch-checklist.md](./04-launch-checklist.md)
- Tech stack: [TECH_STACK_DECISIONS.md](../../research/TECH_STACK_DECISIONS.md)
