# Phase 6.3: Open-Source Preparation

> Licensing, GitHub repo setup, npm publishing, and community infrastructure for ContextInject's open-source strategy.

---

## Objectives

1. Establish clear dual licensing: MIT for SDKs/connectors/CLI, Apache 2.0 for core packages
2. Publish @ci/sdk to npm as `contextinject`
3. Set up GitHub repository with issue templates, PR templates, labels, and milestones
4. Configure GitHub Actions for auto-labeling, stale bot, and release management
5. Create community infrastructure (CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md)

## Deliverables

- License files (MIT, Apache 2.0, proprietary notice)
- CONTRIBUTING.md with development setup and PR process
- CODE_OF_CONDUCT.md (Contributor Covenant v2.1)
- SECURITY.md with responsible disclosure process
- GitHub issue and PR templates
- GitHub Actions workflows (auto-label, stale, release-please)
- npm package published and verified
- Semantic versioning and changelog automation

## Dependencies

- All packages built and tested (Phases 1-5)
- CI/CD pipeline running (Phase 5)

---

## 1. Licensing Strategy

### Dual License Structure

| Component                       | License         | Rationale                                                         |
| ------------------------------- | --------------- | ----------------------------------------------------------------- |
| `@ci/sdk`                       | MIT             | Maximum adoption, no friction for developers                      |
| `@ci/connectors/*`              | MIT             | Community contributions, ecosystem growth                         |
| CLI tools                       | MIT             | Developer tools should be permissive                              |
| `@ci/core`                      | Apache 2.0      | Patent protection, prevents proprietary forks without attribution |
| `@ci/vector-store`              | Apache 2.0      | Core infrastructure, patent protection                            |
| `@ci/embeddings`                | Apache 2.0      | Core infrastructure                                               |
| `@ci/chunker`                   | Apache 2.0      | Core infrastructure                                               |
| `@ci/parser`                    | Apache 2.0      | Core infrastructure                                               |
| `@ci/reranker`                  | Apache 2.0      | Core infrastructure                                               |
| `@ci/compressor`                | Apache 2.0      | Core infrastructure                                               |
| `@ci/cache`                     | Apache 2.0      | Core infrastructure                                               |
| `@ci/db`                        | Apache 2.0      | Schema is core IP                                                 |
| `@ci/types`                     | Apache 2.0      | Type definitions are core                                         |
| `@ci/queue`                     | Apache 2.0      | Core infrastructure                                               |
| `@ci/logger`                    | Apache 2.0      | Core infrastructure                                               |
| `@ci/evaluator`                 | **Proprietary** | Quality scoring algorithms are competitive moat                   |
| `apps/api` (multi-tenant infra) | **Proprietary** | Multi-tenant infrastructure is competitive moat                   |
| `apps/dashboard`                | **Proprietary** | SaaS-specific UI                                                  |
| `apps/worker`                   | Apache 2.0      | Can be self-hosted                                                |
| `apps/mcp-server`               | Apache 2.0      | Community adoption                                                |

### LICENSE-MIT

```
MIT License

Copyright (c) 2026 ContextInject, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### LICENSE-APACHE

```
Apache License, Version 2.0

Copyright (c) 2026 ContextInject, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### Proprietary Notice

```
Copyright (c) 2026 ContextInject, Inc. All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, modification, or use of this software, via any medium,
is strictly prohibited.

The following components are proprietary:
- @ci/evaluator: Context quality scoring algorithms
- apps/api: Multi-tenant infrastructure and billing
- apps/dashboard: SaaS dashboard application

For licensing inquiries, contact: licensing@contextinject.ai
```

### Per-Package License Declaration

Each package's `package.json` must declare its license:

```json
// MIT packages
{ "license": "MIT" }

// Apache 2.0 packages
{ "license": "Apache-2.0" }

// Proprietary packages
{ "license": "SEE LICENSE IN LICENSE" }
```

---

## 2. CONTRIBUTING.md

```markdown
# Contributing to ContextInject

We welcome contributions to ContextInject. This document explains the
development setup, coding standards, and pull request process.

## Development Setup

### Prerequisites

- Node.js 22 LTS (use nvm: `nvm install 22`)
- pnpm 9+ (`npm install -g pnpm`)
- Docker 25+ (for local services)
- Git

### Getting Started

1. Fork the repository on GitHub
2. Clone your fork:
   git clone https://github.com/YOUR_USERNAME/context-inject.git
   cd context-inject

3. Install dependencies:
   pnpm install

4. Start local services:
   docker compose -f infra/docker/docker-compose.yml up -d

5. Copy environment file:
   cp .env.example .env.local

6. Run database migrations:
   pnpm db:migrate

7. Start development mode:
   pnpm dev

### Project Structure

context-inject/
apps/ - Deployable applications (API, worker, dashboard, MCP)
packages/ - Shared packages (@ci/ namespace)
infra/ - Infrastructure configuration
tests/ - Integration and load tests
scripts/ - Utility scripts

## Coding Standards

### TypeScript

- TypeScript 5.7+ strict mode
- No `any` types (use `unknown` with type guards)
- Prefer `interface` over `type` for object shapes
- Use Zod for runtime validation at system boundaries
- Format with Prettier, lint with ESLint

### Testing

- Write tests for all new features and bug fixes
- Use Vitest for all testing
- Maintain >80% code coverage
- Name test files: `*.test.ts` in `tests/` directory or co-located

### Commits

We use Conventional Commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `test:` adding or updating tests
- `refactor:` code changes that neither fix bugs nor add features
- `chore:` maintenance tasks
- `perf:` performance improvement

Example: `feat(chunker): add recursive chunking strategy`

### Code Review

- All PRs require at least 1 approval
- CI must pass before merge
- Squash merge to main

## Pull Request Process

1. Create a branch from `main`:
   git checkout -b feat/my-feature

2. Make changes, write tests

3. Run the full test suite:
   pnpm test

4. Run linting:
   pnpm lint

5. Push and create a PR against `main`

6. Fill out the PR template

7. Address review feedback

8. Once approved and CI passes, your PR will be merged

## What to Contribute

### Good First Issues

Look for issues labeled `good-first-issue` — these are scoped, well-described
tasks suitable for newcomers.

### Areas We Need Help

- New data source connectors (SharePoint, Jira, Confluence)
- SDK in other languages (Python, Go, Java)
- Documentation improvements
- Performance optimizations
- Bug reports with reproduction steps

### What We Do Not Accept

- Changes to proprietary code (@ci/evaluator, apps/api multi-tenant infra)
- Breaking API changes without prior RFC
- Dependencies with copyleft licenses in MIT/Apache packages
- PRs without tests

## Questions?

- Discord: https://discord.gg/contextinject
- GitHub Discussions: https://github.com/contextinject/context-inject/discussions
```

---

## 3. CODE_OF_CONDUCT.md

Based on Contributor Covenant v2.1:

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, religion, or sexual identity
and orientation.

## Our Standards

Examples of behavior that contributes to a positive environment:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

Examples of unacceptable behavior:

- The use of sexualized language or imagery
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission
- Other conduct which could reasonably be considered inappropriate

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards.

## Scope

This Code of Conduct applies within all community spaces, including the GitHub
repository, Discord server, social media, and events.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leaders at conduct@contextinject.ai.

All complaints will be reviewed and investigated promptly and fairly.

## Attribution

This Code of Conduct is adapted from the Contributor Covenant, version 2.1,
available at https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
```

---

## 4. SECURITY.md

```markdown
# Security Policy

## Supported Versions

| Version | Supported        |
| ------- | ---------------- |
| 1.x     | Yes              |
| < 1.0   | No (pre-release) |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**DO NOT open a public GitHub issue for security vulnerabilities.**

### Responsible Disclosure

1. Email: security@contextinject.ai
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. We will acknowledge receipt within 24 hours
4. We will provide an initial assessment within 72 hours
5. We will coordinate a fix and disclosure timeline with you

### What We Consider Security Issues

- Authentication or authorization bypass
- Cross-tenant data leakage
- SQL injection, XSS, CSRF
- Vector injection or embedding manipulation
- Prompt injection in MCP server
- PII exposure
- Denial of service vulnerabilities
- Dependency vulnerabilities (Critical/High severity)

### What We Do Not Consider Security Issues

- Rate limiting working as designed
- Issues requiring physical access to infrastructure
- Social engineering attacks
- Issues in dependencies that we do not control

### Bug Bounty

We do not currently have a formal bug bounty program. However, we deeply
appreciate security researchers who report vulnerabilities responsibly and
will acknowledge your contribution in our security advisories.

### PGP Key

For encrypted communication, our PGP key is available at:
https://contextinject.ai/.well-known/pgp-key.txt
```

---

## 5. npm Publish Setup

### Package Configuration

```json
// packages/sdk/package.json
{
  "name": "contextinject",
  "version": "1.0.0",
  "description": "The Stripe for RAG - intelligent context middleware for AI applications",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/contextinject/context-inject.git",
    "directory": "packages/sdk"
  },
  "homepage": "https://contextinject.ai",
  "bugs": "https://github.com/contextinject/context-inject/issues",
  "keywords": ["rag", "retrieval", "ai", "llm", "embedding", "vector", "context", "mcp"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "test": "vitest",
    "prepublishOnly": "pnpm build"
  }
}
```

### Publishing Workflow

```yaml
# .github/workflows/publish.yml
name: Publish SDK

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter contextinject build
      - run: pnpm --filter contextinject test
      - run: pnpm --filter contextinject publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 6. GitHub Repository Setup

### Issue Templates

**.github/ISSUE_TEMPLATE/bug_report.yml**:

```yaml
name: Bug Report
description: Report a bug in ContextInject
labels: ["bug", "triage"]
body:
  - type: textarea
    attributes:
      label: Description
      description: What happened? What did you expect to happen?
    validations:
      required: true
  - type: textarea
    attributes:
      label: Steps to Reproduce
      description: Minimal steps to reproduce the behavior
    validations:
      required: true
  - type: input
    attributes:
      label: SDK Version
      placeholder: "1.0.0"
  - type: input
    attributes:
      label: Node.js Version
      placeholder: "22.0.0"
  - type: textarea
    attributes:
      label: Error Output
      render: shell
```

**.github/ISSUE_TEMPLATE/feature_request.yml**:

```yaml
name: Feature Request
description: Suggest a new feature
labels: ["enhancement"]
body:
  - type: textarea
    attributes:
      label: Problem
      description: What problem does this solve?
    validations:
      required: true
  - type: textarea
    attributes:
      label: Proposed Solution
      description: How would you like it to work?
    validations:
      required: true
  - type: textarea
    attributes:
      label: Alternatives Considered
```

### PR Template

**.github/PULL_REQUEST_TEMPLATE.md**:

```markdown
## Summary

<!-- Brief description of the changes -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring
- [ ] Performance improvement
- [ ] Test improvement

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist

- [ ] Code follows project conventions
- [ ] No breaking API changes (or documented in summary)
- [ ] Documentation updated (if applicable)
- [ ] All tests passing
```

### Labels

| Label                | Color   | Description                |
| -------------------- | ------- | -------------------------- |
| `bug`                | #d73a4a | Something is not working   |
| `enhancement`        | #a2eeef | New feature or request     |
| `documentation`      | #0075ca | Documentation improvements |
| `good-first-issue`   | #7057ff | Good for newcomers         |
| `help-wanted`        | #008672 | Extra attention needed     |
| `triage`             | #e4e669 | Needs initial assessment   |
| `priority:critical`  | #b60205 | Must fix immediately       |
| `priority:high`      | #d93f0b | Fix before next release    |
| `priority:medium`    | #fbca04 | Fix when possible          |
| `priority:low`       | #0e8a16 | Nice to have               |
| `package:sdk`        | #c5def5 | SDK related                |
| `package:core`       | #c5def5 | Core pipeline related      |
| `package:connectors` | #c5def5 | Connector related          |

### Milestones

| Milestone | Target  | Description                     |
| --------- | ------- | ------------------------------- |
| v1.0.0    | Launch  | Initial public release          |
| v1.1.0    | Month 2 | Bug fixes from launch feedback  |
| v1.2.0    | Month 3 | New connectors (Slack, GitHub)  |
| v2.0.0    | Month 6 | ColPali, CRAG, knowledge graphs |

---

## 7. GitHub Actions Automation

### Auto-Label

```yaml
# .github/workflows/auto-label.yml
name: Auto Label
on: [pull_request_target]
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
# .github/labeler.yml
"package:sdk":
  - packages/sdk/**
"package:core":
  - packages/core/**
"package:connectors":
  - packages/connectors/**
```

### Stale Bot

```yaml
# .github/workflows/stale.yml
name: Stale Issues
on:
  schedule:
    - cron: "0 0 * * *"
jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          stale-issue-message: "This issue has been automatically marked as stale due to 60 days of inactivity."
          days-before-stale: 60
          days-before-close: 14
          exempt-issue-labels: "priority:critical,priority:high"
```

### Release Please (Changelog Automation)

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
          package-name: contextinject
```

---

## 8. Semantic Versioning Strategy

| Change Type               | Version Bump  | Example                      |
| ------------------------- | ------------- | ---------------------------- |
| Bug fix, patch            | PATCH (1.0.x) | Fix query cache invalidation |
| New feature, non-breaking | MINOR (1.x.0) | Add new connector            |
| Breaking API change       | MAJOR (x.0.0) | Change query response format |

**Rules**:

- Pre-1.0: Breaking changes are MINOR bumps (0.x.0)
- Post-1.0: Strict semver, breaking changes require MAJOR bump
- Conventional commits drive automatic version bumps via release-please
- Changelogs generated automatically from commit messages

---

## 9. Growth Targets

| Metric               | 1 Month      | 3 Months | 6 Months | 12 Months |
| -------------------- | ------------ | -------- | -------- | --------- |
| GitHub stars         | 50+          | 500+     | 1,000+   | 3,000+    |
| npm weekly downloads | 100+         | 500+     | 2,000+   | 10,000+   |
| Contributors         | 3 (founders) | 10       | 25       | 50+       |
| Open issues (active) | 10           | 30       | 50       | 100       |
| Discord members      | 50           | 200      | 500      | 1,000+    |

---

## Cross-References

- Phase 6 overview: [README.md](./README.md)
- Documentation: [02-documentation.md](./02-documentation.md)
- Launch checklist: [04-launch-checklist.md](./04-launch-checklist.md)
- Competitor OSS analysis: [COMPETITOR_ANALYSIS.md](../../research/COMPETITOR_ANALYSIS.md)
