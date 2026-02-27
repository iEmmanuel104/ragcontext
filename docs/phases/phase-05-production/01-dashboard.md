# 01 — Dashboard

> **App**: `apps/dashboard` | **Framework**: Next.js 16 (Turbopack stable, App Router)
> **Entry Point**: `apps/dashboard/src/app/layout.tsx`

---

## Overview

The dashboard is a Next.js 16 web application that provides self-serve management of ContextInject projects, documents, connectors, API keys, analytics, billing, and team settings. It is the primary interface for non-programmatic users and serves as the onboarding entry point for new customers.

Tech stack:

- **Next.js 16** with Turbopack (stable) for fast builds and the App Router for server components
- **Tailwind CSS + shadcn/ui** for the component library
- **Recharts** for analytics visualization
- **JWT sessions** from `@ci/auth` for authentication
- **SSE** for real-time document processing status updates
- WCAG 2.1 AA accessibility compliance
- Dark mode support

---

## Page Structure

```
apps/dashboard/src/app/
├── layout.tsx                    # Root layout: HTML head, font loading, theme provider
├── page.tsx                      # Landing redirect: auth check -> /projects or /login
├── (auth)/
│   ├── layout.tsx                # Auth layout: centered card, no sidebar
│   ├── login/page.tsx            # Email/password login
│   └── signup/page.tsx           # Signup with plan selection
├── (dashboard)/
│   ├── layout.tsx                # Dashboard shell: sidebar + header + main content
│   ├── projects/
│   │   ├── page.tsx              # Projects list (cards grid)
│   │   └── [id]/
│   │       ├── page.tsx          # Project detail: documents tab, queries tab
│   │       ├── documents/page.tsx # Document list with upload
│   │       ├── connectors/page.tsx # Connector management
│   │       └── analytics/page.tsx  # Per-project analytics
│   ├── settings/
│   │   ├── page.tsx              # Settings overview
│   │   ├── api-keys/page.tsx     # API key management (create, revoke, scopes)
│   │   ├── billing/page.tsx      # Plan selection, usage, invoices
│   │   └── team/page.tsx         # Team members, invitations, roles
│   └── analytics/page.tsx        # Global analytics dashboard
```

---

## Pages Detail

### Login / Signup

**Login** (`/login`):

- Email + password form
- "Forgot password" link
- OAuth login buttons (GitHub, Google) for future
- CSRF protection via double-submit cookie pattern
- Rate limited: 5 attempts per email per 15 minutes

**Signup** (`/signup`):

- Email, password, organization name
- Plan selection (Free, Starter, Pro, Enterprise contact form)
- Terms of service checkbox
- Email verification flow
- On success: redirect to first project creation

### Projects List

**Projects** (`/projects`):

- Grid of project cards showing: name, document count, last query time, quality score trend
- "New Project" button (disabled if at plan limit with upgrade prompt)
- Search/filter by name
- Sort by: name, created date, document count, last activity

### Project Detail

**Project Detail** (`/projects/[id]`):

- Tab navigation: Documents, Connectors, Queries, Analytics, Settings
- Real-time status indicators for document processing (SSE)
- Quick actions: upload document, run test query, copy project ID

**Documents Tab**:

- Table view: title, status (with color badge), chunks, tokens, source, uploaded date
- Bulk actions: delete selected, re-index selected
- Upload button: drag-and-drop zone for files (PDF, DOCX, HTML, TXT, MD)
- Filter by: status (pending, processing, indexed, failed), connector type
- Cursor-based pagination (no offset-based)

**Connectors Tab**:

- List of connected data sources with status indicators
- "Connect" buttons for each supported source (Notion, Google Drive)
- Sync status: last sync time, next sync time, documents synced
- Manual sync trigger button
- Disconnect with confirmation dialog

**Analytics Tab**:

- Queries per day (line chart, Recharts)
- Average latency with p50/p95/p99 (area chart)
- Cache hit rate (gauge)
- Quality score distribution (histogram)
- Top queries table
- Date range picker: 24h, 7d, 30d, 90d

### Settings

**API Keys** (`/settings/api-keys`):

- List of API keys: name, prefix (ci*live*\*\*\*), scopes, last used, created date
- "Create Key" modal: name, scope selection (checkboxes), expiry (optional)
- Key is shown only once after creation (copy to clipboard)
- Revoke key with confirmation

**Billing** (`/settings/billing`):

- Current plan with usage meters (pages used / limit, retrievals used / limit)
- Plan comparison table with upgrade/downgrade buttons
- Stripe Customer Portal link for payment method management
- Invoice history table
- For Enterprise: "Contact Sales" button

**Team** (`/settings/team`):

- Team members table: name, email, role (admin, member, viewer), joined date
- Invite modal: email + role selection
- Remove member with confirmation
- Role editing (admin only)

### Global Analytics

**Analytics** (`/analytics`):

- Cross-project aggregated metrics
- System health indicators (API uptime, error rate, latency)
- Usage vs. plan limits (progress bars)
- Revenue-relevant metrics (for internal admin view)

---

## Authentication

```typescript
// apps/dashboard/src/lib/auth.ts
// JWT-based sessions using @ci/auth package

import { cookies } from "next/headers";
import { verifyJWT } from "@ci/auth";

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("ci_session")?.value;
  if (!token) return null;

  try {
    const payload = await verifyJWT(token);
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
```

---

## CSRF Protection

The dashboard uses the double-submit cookie pattern for CSRF protection:

```typescript
// apps/dashboard/src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Set CSRF token cookie if not present
  if (!request.cookies.get("csrf_token")) {
    const csrfToken = randomBytes(32).toString("hex");
    response.cookies.set("csrf_token", csrfToken, {
      httpOnly: false, // Must be readable by JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
  }

  return response;
}
```

On form submissions and API calls from the dashboard, the CSRF token from the cookie is sent as a custom header (`X-CSRF-Token`). The API server verifies that the cookie value matches the header value.

---

## Real-Time Updates (SSE)

Document processing status updates are streamed to the dashboard via Server-Sent Events:

```typescript
// apps/dashboard/src/hooks/useDocumentStatus.ts
"use client";

import { useState, useEffect } from "react";

export function useDocumentStatus(projectId: string) {
  const [documents, setDocuments] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const eventSource = new EventSource(`/api/sse/documents?projectId=${projectId}`, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setDocuments((prev) => {
        const next = new Map(prev);
        next.set(data.documentId, data.status);
        return next;
      });
    };

    return () => eventSource.close();
  }, [projectId]);

  return documents;
}
```

---

## Component Library

Built on shadcn/ui (Tailwind CSS + Radix UI primitives):

```
apps/dashboard/src/components/
├── ui/                          # shadcn/ui base components
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   ├── table.tsx
│   ├── input.tsx
│   ├── select.tsx
│   ├── badge.tsx
│   ├── tabs.tsx
│   ├── toast.tsx
│   └── ...
├── layout/
│   ├── sidebar.tsx              # Navigation sidebar
│   ├── header.tsx               # Top header with user menu
│   └── breadcrumb.tsx           # Page breadcrumbs
├── projects/
│   ├── project-card.tsx         # Project card for grid view
│   ├── create-project-dialog.tsx
│   └── project-settings-form.tsx
├── documents/
│   ├── document-table.tsx       # Document list table
│   ├── upload-zone.tsx          # Drag-and-drop file upload
│   ├── status-badge.tsx         # Document status color badge
│   └── document-detail.tsx
├── analytics/
│   ├── queries-chart.tsx        # Recharts line chart
│   ├── latency-chart.tsx        # Recharts area chart
│   ├── quality-histogram.tsx    # Quality score distribution
│   └── cache-gauge.tsx          # Cache hit rate gauge
└── settings/
    ├── api-key-table.tsx
    ├── create-key-dialog.tsx
    └── plan-comparison.tsx
```

---

## Dark Mode

Dark mode is implemented via Tailwind CSS `dark:` variant with `next-themes`:

```typescript
// apps/dashboard/src/app/layout.tsx
import { ThemeProvider } from 'next-themes';

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

---

## Accessibility (WCAG 2.1 AA)

- All interactive elements have visible focus indicators
- Color contrast ratios meet AA standards (4.5:1 for normal text, 3:1 for large text)
- All images and icons have `alt` text or `aria-label`
- Forms have associated labels
- Keyboard navigation works throughout (tab order, escape to close modals)
- Screen reader announcements for dynamic content changes (ARIA live regions)
- Tested with axe-core in CI pipeline

---

## Testing Requirements

### Component Tests (Vitest + React Testing Library)

- Each page component renders without errors
- Form submissions send correct data
- Error states display properly
- Loading states show skeletons

### E2E Tests (Playwright)

- Signup flow: register -> verify email -> create first project
- Document upload: drag file -> upload -> wait for processing -> verify indexed
- API key management: create key -> copy -> verify shown only once
- Analytics: verify charts render with mock data
- Responsive: verify layout at mobile (375px), tablet (768px), desktop (1440px)

### Accessibility Tests

- axe-core scan on every page (zero violations at AA level)
- Keyboard-only navigation test for complete flows

---

## Related Documentation

- [Phase 5 README](./README.md) — Phase overview
- [02-billing.md](./02-billing.md) — Stripe billing integration
- [Phase 3: API Server](../phase-03-api-sdk/01-api-server.md) — API that dashboard calls
- [Phase 4: Quality Scoring](../phase-04-quality/04-quality-scoring.md) — Analytics data source
