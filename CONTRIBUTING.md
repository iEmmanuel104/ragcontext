# Contributing to ContextInject

## Setup

1. Clone the repo
2. `nvm use` (requires Node 22+)
3. `pnpm install`
4. `pnpm docker:up` (starts Postgres, Redis, Qdrant)
5. `pnpm db:migrate`
6. `pnpm build`
7. `pnpm test`

## Development Workflow

1. Create a feature branch from `main`
2. Make changes following conventions in CLAUDE.md
3. Run `pnpm lint && pnpm typecheck && pnpm test`
4. Commit using conventional commits: `feat(scope): description`
5. Open a PR against `main`

## Commit Message Format

```
type(scope): subject

body (optional)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Scopes: Package names (e.g., `db`, `auth`, `core`, `api`)

## Testing

- Write unit tests for all new code
- Integration tests for cross-package functionality
- Minimum 80% coverage (90% for auth/core)
