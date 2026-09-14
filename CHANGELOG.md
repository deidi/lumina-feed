# Changelog

All notable changes to the **LuminaFeed** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-14

### Added
- **Initial Production Release of LuminaFeed v.1.0.0**:
  - Full client-side Single Page Application (SPA) built with Svelte 5 Runes, Vite 6, and modern CSS.
  - Zero-backend serverless architecture operating entirely in-browser with Supabase managed BaaS.
- **Client-Side End-to-End Encryption (E2EE) with AES-256-GCM**:
  - Full-resolution photos and micro-thumbnails are encrypted in-browser before network dispatch.
  - Hardened binary envelope format (`LENC` header, version byte, 12-byte cryptographically secure random IV, and AES-GCM ciphertext with 128-bit authentication tag) via standard Web Crypto API.
  - Zero plain camera image data is ever uploaded or stored unencrypted on cloud storage.
  - Seamless zero-friction QR key distribution: event encryption key is encoded into event QR join URLs (`?k=<hex_key>`), allowing guests and TV displays to decrypt instantly without passwords.
  - Automatic on-the-fly photo decryption for full ZIP archive exports and Google Drive cloud backups.
- **24-Hour Ephemeral Event Lifecycle & Automated Cleanup**:
  - Event spaces, host credentials, guest records, and cloud photo folders automatically expire after 24 hours.
  - Automated reconciliation routine (`cleanupExpiredHostsAndEvents`) permanently purges expired records from Supabase Database and cascades to delete all associated photos and thumbnails from Supabase Storage.
  - Host dashboard real-time retention countdown badge (`⏳ 24h Retention: Xh Ym left`) with informational alerts.
- **Direct-to-Cloud Supabase Storage & Quota Management**:
  - Direct smartphone camera streaming into Supabase Storage with global edge CDN delivery.
  - 100-photo quota per event space for fast gallery rendering and predictable storage footprints.
  - 10-event host quota and strict host event isolation.
  - Complete cascading deletion: purging events or individual photos removes both full-res and thumbnail assets with zero orphaned files.
- **Cross-Device Guest Directory & Attendance Reconciliation**:
  - Multi-network attendance tracking across cellular (4G/5G) and Wi-Fi networks via managed Supabase PostgreSQL database.
  - Dedicated "👥 Guests" tab in the host event detail panel showing attendee names, join timestamps, and submission totals.
  - Durable photo attribution preserved across reloads and multi-device sessions.
- **Local-First Architecture (Dexie.js IndexedDB)**:
  - Zero-latency 0ms album and dashboard rendering from client-side IndexedDB cache.
  - Offline capture queue enabling guests in poor-reception environments to capture photos offline and stream to the cloud upon reconnection.
- **In-Browser Image Processing Engine**:
  - Hardware-accelerated Canvas downscaling of raw captures (5–25 MB) to 2048px @ 88% JPEG (~300–800 KB).
  - Dual micro-thumbnail generation (360px @ 75% JPEG, ~25 KB).
  - Automatic EXIF GPS coordinate stripping via `exifr` and SHA-256 duplicate detection via `crypto.subtle`.
- **Independent Multi-Tab TV Presentation Slideshow**:
  - Dedicated `_blank` browser tab presentation view with dynamic 5-second cloud auto-refresh.
  - Fullscreen presentation (`F`), pause/play (`Space`), manual refresh (`R`), and keyboard slide controls.
  - Dynamic corner QR watermark for live attendee onboarding.
- **Real-Time Moderation Queue & 1-Click Auto-Approve**:
  - Visual review queue with instant approval/rejection and toggleable auto-approve mode.
- **1-Click Google Drive Cloud Backup & ZIP Archive Export**:
  - Built-in Google OAuth 2.0 integration backing up photos directly into Google Drive folders.
  - Fast client-side `.zip` archive generation with `metadata.json` via JSZip.
- **Resilient Multi-Layer Event Deletion**:
  - Fast-path 1-click deletion for fresh/empty events (0 photos) without requiring redundant confirmation typing.
  - Case-insensitive and whitespace-tolerant confirmation (`.trim().toLowerCase()`) for events with photos to prevent accidental deletion friction.
  - Direct `🗑️` delete button accessible straight from host dashboard event space cards.
  - Robust cascading deletion adhering to database foreign-key constraints (`photos` -> `guests` -> `events`) and non-blocking cleanup of Supabase Storage and local IndexedDB.
- **Creator Support & Community Links**:
  - Integrated Ko-fi creator support badges and links (`https://ko-fi.com/deidi0`) across product landing header, footer, host console header, and host profile settings dialog.
