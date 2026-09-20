# LuminaFeed v0.3.1 Release Notes — Custom Supabase (BYOK) Setup & Fail-Safe Cloud Reset

**Release Date**: September 20, 2026  
**Release Tag**: `v.0.3.1`  
**Deployment**: [https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)

---

## 🌟 Executive Summary

LuminaFeed **v0.3.1** introduces a flexible **Bring Your Own Supabase Backend (BYOK)** architecture for organizers who require dedicated database instances, custom storage quotas, or self-hosted PostgreSQL setups. It adds an interactive modal on the Host Dashboard to input custom Supabase credentials (`Project URL`, `Public Anon Key`, and `Bucket Name`), an idempotent 1-Click SQL script generator, and a 1-click **Fail-Safe Default Cloud Reset** that restores the default managed backend while keeping credentials masked.

---

## 🚀 Key Highlights & Enhancements

### 1. 🛠️ Bring Your Own Supabase Backend (BYOK)
- **Custom Credentials Input**: Hosts can switch from the managed cloud to their own Supabase project by entering their `Project URL`, `Public Anon Key`, and `Storage Bucket Name`.
- **Dynamic Client Swapping**: Storage and database operations seamlessly re-instantiate clients on-the-fly when custom credentials are saved or modified.
- **Persistent Local Caching**: BYOK configurations are saved in browser `localStorage` under `luminafeed_custom_supabase_*` keys, allowing hosts to maintain their custom backend across browser refreshes.

### 2. 🛡️ Fail-Safe 1-Click Default Cloud Reset
- **Instant Cloud Recovery**: If custom credentials become misconfigured, network issues arise, or the host wants to return to the managed cloud, a prominent **"Use Default Setup (Fail-Safe)"** action immediately restores default backend operation.
- **Zero-Exposure Credential Masking**: Default Supabase credentials remain securely masked (`https://••••••••••••••••••••.supabase.co` and `••••••••••••••••••••••••••••••••`) in all user-facing dialogs.

### 3. 📋 1-Click SQL Initialization Script
- Organizers setting up a fresh Supabase instance can copy a pre-formatted, idempotent SQL initialization script directly from the BYOK interface.
- Automatically provisions `public.hosts`, `public.events`, `public.guests`, and `public.photos` tables, Row-Level Security (RLS) policies, and storage bucket MIME/size restrictions.

### 4. 📊 Dynamic Dashboard Status Indicator
- The Host Dashboard storage status badge automatically reflects active connectivity and setup mode (`⚡ Supabase Cloud: Managed` vs `⚡ Supabase Cloud: Custom (BYOK)`).

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

## 📖 Getting Started with BYOK

1. Navigate to the **Host Dashboard**.
2. Click the **⚡ Supabase Cloud: Managed ⚙️** status badge.
3. Switch to the **🛠️ Use My Own Setup (BYOK)** tab.
4. Enter your Supabase Project URL and Public Anon Key.
5. (Optional) Copy the **1-Click SQL Script** and execute it in your Supabase SQL Editor.
6. Click **💾 Save & Connect Setup**.
