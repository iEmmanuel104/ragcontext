# Security Policy

## Reporting Vulnerabilities

Please report security vulnerabilities by emailing security@contextinject.com.

Do NOT open public issues for security vulnerabilities.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Security Measures

- All API endpoints require authentication
- Row-Level Security (RLS) enforces tenant isolation at the database level
- API keys are hashed with HMAC-SHA256 before storage
- Encryption at rest uses AES-256-GCM
- PII is redacted from all logs
- Rate limiting prevents abuse
- CORS origins must be explicitly configured
- All SQL queries use parameterized statements
- Dependencies are audited weekly via GitHub Actions
