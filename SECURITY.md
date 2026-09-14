# Security Policy

## Supported Versions

We actively support and release security patches for the latest major version of LuminaFeed:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

LuminaFeed is a client-side Single Page Application (SPA). Photo storage and authentication are handled directly via client-side cryptography (SHA-256 host PIN hashing, Web Crypto API) and managed BaaS providers (Supabase Storage / Google Drive).

If you discover a security vulnerability or potential loophole:

1. **Do not create a public GitHub issue.**
2. Please report the vulnerability privately via **[GitHub Private Vulnerability Reporting](https://github.com/deidi/lumina-feed/security/advisories/new)** or by reaching out to the repository maintainers.
3. Include:
   - A detailed description of the vulnerability.
   - Exact steps or script to reproduce the exploit.
   - Any suggested mitigations.

We will acknowledge receipt within 48 hours and work with you to test and deploy a fix promptly.
