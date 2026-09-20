# LuminaFeed Release Notes — v0.1.0 (Production Release)

**Release Date:** September 20, 2026  
**Milestone:** 100% Client-Native Online-First PWA Rebuild Complete  
**Live Application:** [`https://deidi.github.io/lumina-feed/#/`](https://deidi.github.io/lumina-feed/#/)

---

## 🌟 Executive Summary

**LuminaFeed v0.1.0** is a complete ground-up rebuild of the LuminaFeed real-time event photo sharing platform into a high-performance, online-first Progressive Web App (PWA). Operating with zero custom backend infrastructure, LuminaFeed combines Supabase Cloud Storage & PostgreSQL BaaS with client-side canvas photo compositing, WebRTC camera capture, WebSocket MQTT signaling, and ambient projector TV presentation.

---

## 🏛️ Highlights Across All 10 Phases

### 1. Flexible BaaS Backend & Bring-Your-Own-Keys (BYOK) (`Phase 1`)
- **Dual Cloud Architecture**: Runs out-of-the-box on default embedded cloud storage or connects to any custom organizer Supabase project.
- **1-Click SQL Setup Generator**: Generates complete PostgreSQL DDL tables (`hosts`, `events`, `guests`, `photos`) with RLS policies and Storage bucket configs.
- **Automated Health Probes**: Sub-300ms non-destructive probes verifying API credentials, table schemas, and storage read/write permissions.

### 2. Free-Tier Quota Shield & Storage Predictability (`Phase 1 & 2`)
- **100 Photos / Event Default Limit**: Average photo + thumbnail size is ~480 KB (~48 MB total footprint per event space).
- **5 Concurrent Active Events Cap**: Consumes only ~240 MB total (<25% of Supabase's 1 GB free tier), guaranteeing zero unexpected cloud bills.
- **15 Photos / Guest Quota**: Prevents single-user flood spamming while encouraging collaborative memory sharing.
- **24-Hour Ephemeral TTL**: Automatically purges expired events and cascades cloud file deletion from Supabase Storage.

### 3. Online-First Network Engine & Pre-Flight Probes (`Phase 2`)
- **Real-Time Network Status Indicator**: `🟢 Live` / `🟡 Reconnecting...` / `🔴 Offline` status pill.
- **Pre-Upload Health Check**: Probes network connectivity prior to triggering multi-step camera capture.
- **Automatic Retry & Timeout Guards**: 15s network timeout with exponential backoff.

### 4. Privacy & Client-Side Crypto Pipeline (`Phase 3`)
- **Automatic EXIF GPS Stripping**: Strips device serials, coordinates, and private sensor tags in HTML5 Canvas.
- **SHA-256 Duplicate Guard**: Hashes image buffers in-browser using `crypto.subtle` to reject identical uploads before network transmission.
- **Zero-Knowledge AES-256-GCM Envelope Encryption**: Optional client-side encryption (`LENC` envelope) with keys encoded in the URL hash (`#key=...`).

### 5. Persistent Guest Sessions & Identity Lifecycle (`Phase 4`)
- **Scoped Local-First Sessions**: Keyed per event slug (`guest_session_<slug>`) in `localStorage` and Dexie v4.
- **0ms Auto-Resume**: Seamless hydration on page refresh or QR re-scan without re-entering display name.
- **1-Tap Fast Re-Join**: Instant `"Continue as [Name]"` prompt if re-authenticating.

### 6. Hybrid Photo Frame Studio & Celebration Presets (`Phase 5 & 6`)
- **Custom PNG Upload**: Supports transparent PNG frame overlays (Canva, Figma, Photoshop).
- **Procedural Frame Presets**: Built-in *Polaroid Classic*, *Golden Glamour*, *Neon Party Glow*, and *Minimal Modern* frames with custom event titles and dates.
- **1-Click Printable Table Signs**: Generates 1200x1600px A5/A4 high-resolution printable table cards and posters with QR codes.

### 7. Dual Camera Capture & Live Viewfinder (`Phase 7`)
- **In-App WebRTC Camera**: Real-time live camera feed with real-time celebratory frame overlay.
- **Hardware Controls**: Torch/flashlight toggle, camera flip (front/back), and high-fidelity snapshot grabber.
- **Photo Studio**: Interactive preview with Framed vs Direct photo toggle and 1-line caption input with emoji shortcuts.

### 8. Real-Time Signaling, Floating Reactions & Moderation Queue (`Phase 8`)
- **Floating Reactions**: Real-time celebration emojis (`❤️`, `🔥`, `🥂`, `🎉`, `✨`, `🥳`) floating dynamically across guest phones and TV screens.
- **Host Moderation Queue**: Single and bulk photo approval/rejection with synchronized cloud storage deletion.

### 9. Full-Screen TV Slideshow (Projector Presentation Mode) (`Phase 9`)
- **Smart Portrait Blur**: Dynamic ambient color backdrops for vertical smartphone photos on 16:9 displays.
- **Dynamic Slide Injection**: Newly approved captures seamlessly slot into ongoing rotation.
- **On-Screen QR Watermark & Slide Counter**: High-contrast QR code for attendees to scan from anywhere in the room.
- **Keyboard Shortcuts**: `F` (Fullscreen), `Space` (Pause/Play), `←`/`→` (Navigation), `R` (Force Cloud Refresh).

### 10. Progressive Web App (PWA) & Final Distribution (`Phase 10`)
- **Service Worker v0.1.0**: Network-first caching with offline fallback.
- **PWA Web App Manifest**: Standalone mobile app experience with 1-tap installation.

### 11. Dynamic Host IP & LAN Event Sharing Engine
- **3-Tier LAN IP Discovery**: Automatically probes the host's actual local IPv4 address via `/api/host-info` Vite dev middleware and WebRTC ICE gathering.
- **Dynamic QR Code Swapping**: Dynamically substitutes `localhost` with the computer's active IP (`http://192.168.x.x:5173/#/event/<slug>`) so nearby smartphones can join over venue Wi-Fi.
- **Interactive Network Bar**: QR modal features an interactive Host Network IP bar with 🔄 **Auto-Detect / Refresh IP** for dynamic DHCP network adjustments.
- **Zero-Config GitHub Pages Isolation**: Automatically detects public domains (`deidi.github.io`) and generates public CDN join links without local IP replacements.

### 12. Responsive Button Containment & Layout Polish
- **Non-Overflowing Action Rows**: Upgraded `.qr-modal-footer`, `.detail-actions-row`, and `.event-card-actions-row` to wrap into responsive multi-column and stacked grids across mobile/tablet viewports without horizontal clipping.
- **1-Click High-Res Printable Signs**: Generates 1200x1600px A5/A4 printable table cards with embedded dynamic QR codes via HTML5 Canvas.
- **Synchronized Live Moderation**: Two-way real-time state synchronization between Moderation Queue Auto-Approve toggle and Settings "Enable Live Photo Moderation" checkbox.

---

## 🛠️ Build & Verification Checklist

- [x] Client production build succeeds (`npm --prefix client run build` -> `0 errors`)
- [x] Root GitHub Pages bundle synchronized (`index.html` & `assets/`)
- [x] Service Worker registered with cache `luminafeed-pwa-v0.1.0`
- [x] All phases documented across `CHANGELOG.md`, `README.md`, `FAQ.md`, and `release-notes/`
