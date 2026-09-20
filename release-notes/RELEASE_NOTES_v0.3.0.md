# LuminaFeed v0.3.0 Release Notes — Security Hardening & Architecture Refinement

**Release Date**: September 20, 2026  
**Release Tag**: `v.0.3.0`  
**Deployment**: [https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)

---

## 🌟 Executive Summary

LuminaFeed **v0.3.0** delivers comprehensive application security hardening, zero-knowledge key isolation, database Row Level Security (RLS) enforcement, cryptographically secure pseudo-random token generation, and responsive header UX refinements.

---

## 🚀 Key Highlights & Enhancements

### 1. 🛡️ Comprehensive Security Hardening & Zero-Knowledge Isolation
- **Client Bundle Private Key Elimination**: Removed hardcoded RSA private keys from client-side bundles. Decryption keys are now strictly managed at runtime via environment variables for Option B escrow workflows.
- **Authoritative Cloud PIN Verification**: Replaced client-side PIN hash comparisons with direct PostgreSQL query filtering (`.eq('pin_hash', pinHash)`), preventing host PIN hash leakage across public network requests.
- **Safe Profile Mutation & Deletion**: Added PIN hash verification guards to host update and deletion methods (`updateHostInCloud`, `deleteHostFromCloud`).

### 2. 🔒 Supabase Row Level Security (RLS) & Storage Quota Constraints
- **Active 24-Hour TTL Policies**: Hardened database policies on `public.hosts` and `public.events` to restrict anonymous data operations strictly to active records (`expires_at > now()`).
- **Bucket-Level Quota & MIME Filtering**: Configured the `luminafeed-photos` storage bucket with an explicit **5 MB upload ceiling** and allowed MIME types (`image/jpeg`, `image/png`, `application/octet-stream`).

### 3. 🎲 Cryptographically Secure Token Generation (CSPRNG)
- Replaced insecure `Math.random()` token generators with a dedicated `generateSecureToken()` engine backed by the W3C Web Crypto API (`crypto.randomUUID()` and `crypto.getRandomValues()`).
- Hardened all host session tokens, guest connection tokens, and storage filenames against prediction and spoofing.

### 4. 🎨 Header UI & Support Button Refinements
- **Streamlined Header Actions**: Removed redundant "Ko-fi" text labels from navigation headers.
- **Unified Theme & Support Bar**: Relocated the support button as a clean, polished `☕` icon button (`.kofi-header-btn`) positioned directly beside the dark/light mode toggle on the right side of the navigation bar.

### 5. ⚡ Event Status Normalization & Quota Stability
- Added schema-adaptive handling for `public.events` status (`active` vs `archived`).
- Resolved quota calculation edge cases to guarantee smooth photo submissions across cellular and Wi-Fi connections.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend Framework** | Svelte 5 (Runes: `$state`, `$derived`, `$effect`, `$props`) |
| **Build Tooling** | Vite 6 + Vanilla CSS Design System |
| **Cloud Database** | Supabase PostgreSQL BaaS (`hosts`, `events`, `guests`, `photos`) |
| **Cloud Storage** | Supabase Cloud Storage (`luminafeed-photos` CDN bucket) |
| **Cryptography** | W3C Web Crypto API (AES-256-GCM, SHA-256, CSPRNG) |
| **Real-Time Signaling** | EMQX WebSocket MQTT + Browser `BroadcastChannel` |

---

## 📖 Upgrading & Database Migration

Existing self-hosted or managed Supabase deployments should execute the updated [`supabase_schema.sql`](supabase_schema.sql) in their Supabase SQL Editor to apply the enhanced RLS policies and bucket constraints.
