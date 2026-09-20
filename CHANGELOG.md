# Changelog

All notable changes to the **LuminaFeed** project rebuild will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-20

### Added
- **Official Production Launch Baseline**: Single-commit release baseline for GitHub Pages (`https://deidi.github.io/lumina-feed/#/`), consolidating the v0.2.0 cloud-only migration.
- **Unified Synchronized Login System (Hosts + Guests)**:
  - Tabbed **Host Portal** with explicit **Sign In** (`loginHostInCloud`) and **Register** (`registerHostInCloud`) flows verified against `public.hosts` via `(host_name, pin_hash)`.
  - **Guest Passcode Protection (Option B)**: Optional 4-digit guest passcode (SHA-256 `pin_hash` in `public.guests`) with cross-device session restoration via `(event_slug, name, pin_hash)` (`registerOrVerifyGuestInCloud`).
  - **Session Expiry Detection**: `getAuthStatus()` re-verifies host sessions against the cloud database on every load, clearing stale local tokens.
- **Schema-Adaptive Persistence**: `safeSupabaseUpsert` / `safeSupabaseUpdate` dynamically omit unsupported columns for backward compatibility with older Supabase schemas.
- **Cloud Event Validation on Join/Rejoin**: `validateAndFetchEvent(slug)` checks Supabase Database + Storage manifests on every join, purging stale guest tokens for deleted events.

### Changed
- **100% Cloud-Only Architecture**: All host, event, guest, and photo data lives exclusively in Supabase PostgreSQL + Cloud Storage. Browser `localStorage` holds session tokens only. Legacy `offline-queue.js` (IndexedDB) is deprecated in favor of direct cloud uploads.
- **Clean Event Join URLs**: Canonical join route is `#/event/<slug>`; optional E2EE event keys are distributed via QR `?k=` parameter only when per-event encryption is enabled.

### Fixed
- **Cross-Device Event Discovery**: Fallback discovery reconciles Storage manifests (`_events/${slug}.json`) when database rows are not yet visible across devices/origins.
- **Single-Commit Release Hygiene**: `client/.env` (real Supabase credentials) is now git-ignored; only `client/.env.example` is tracked. Local guidelines (`AGENTS.md`, `.agents/`, `super-admin/`) remain untracked.

---

## [0.2.0] - 2026-09-20

### Added
- **Cloud-Only Architecture Migration**:
  - **Complete Dexie.js/IndexedDB Removal**: Purged all local database dependencies. All host credentials, event records, guest sessions, and photo metadata are now stored exclusively in Supabase PostgreSQL BaaS.
  - **Pure Cloud Authentication**: Hosts and guests authenticate directly against the `public.hosts` and `public.guests` tables in Supabase Database, ensuring consistent data across all devices and origins (GitHub Pages, localhost, LAN).
  - **Schema-Adaptive Persistence**: Introduced `safeSupabaseUpsert` and `safeSupabaseUpdate` helpers that dynamically omit unsupported columns, enabling backward compatibility with older Supabase schema versions.
- **Unified Host Login & Registration Portal**:
  - **Separate Login & Register Flows**: Replaced single-step host setup with a tabbed **Host Portal** offering explicit **Sign In** (existing host) and **Register** (new host) tabs.
  - **Cloud-Verified Host Authentication**: Host credentials (`host_name`, `pin_hash`) are verified authoritatively against Supabase Database on every login attempt.
  - **Session Expiry Detection**: `getAuthStatus()` probes the cloud database to detect expired or deleted host accounts, automatically clearing stale local session tokens.
- **Guest Passcode Identity Protection (Option B)**:
  - **4-Digit Guest Passcode**: Guests can set an optional 4-digit passcode during their first join. Subsequent joins from different devices require the same passcode, preventing identity hijacking.
  - **Cross-Device Session Restoration**: Guest sessions with matching `(event_slug, name, pin_hash)` are seamlessly restored across mobile devices, tablets, and desktop browsers.
  - **`pin_hash` Column on `public.guests`**: Extended the guest database schema with a `pin_hash` column for secure passcode storage.
- **Cloud Event Validation on Join/Rejoin**:
  - `validateAndFetchEvent(slug)` checks Supabase Database and Storage manifests on every join attempt, automatically purging stale local guest tokens if the event was deleted by the host.

### Changed
- **Host Authentication**: `setupHost()` now calls `registerOrVerifyHostInCloud()` instead of writing to local IndexedDB.
- **Guest Sessions**: `joinEvent()` now calls `registerOrVerifyGuestInCloud()` directly, with localStorage used only for session token caching (not as authoritative data source).
- **Event Listing**: `getEvents()` queries Supabase PostgreSQL directly with real-time photo/guest aggregates, replacing local IndexedDB queries.
- **Photo Uploads**: `uploadPhoto()` registers photos directly in `public.photos` table with cloud-first quota enforcement.

### Removed
- **Dexie.js dependency** removed from `package.json`.
- **IndexedDB database schemas** (`db.js` Dexie v4 stores) fully purged.
- **Local-to-cloud sync hooks** (`syncToCloud`, `syncFromCloud` bridge functions) eliminated — all operations are now direct cloud calls.
- **`offline-queue.js`** offline capture queue (IndexedDB-dependent) deprecated in favor of direct cloud uploads.

---

## [0.1.0] - 2026-09-20

### Added
- **Phase 10: PWA Verification & Production Re-Release**:
  - **Service Worker (`sw.js`)**:
    - Updated cache version to `luminafeed-pwa-v0.1.0` with instant client claiming and network-first navigation caching.
  - **PWA Web App Manifest (`manifest.json`)**:
    - Verified standalone mobile display configuration, high-resolution SVG icons, theme colors, and quick navigation shortcuts.
  - **Distribution Bundle**:
    - Compiled production client bundle with Vite 6 and synchronized root files (`index.html` & `assets/`) for GitHub Pages.
  - **Dynamic Host IP & Network Discovery Engine**:
    - Added 3-tier local network IPv4 detection (`/api/host-info` Vite middleware, WebRTC probing, and `localStorage` cache).
    - Automatically translates `localhost` to host LAN IP in event QR codes and join URLs for mobile guest scanning.
    - Added interactive Host Network IP bar in QR modal with Auto-Detect and 1-click Refresh IP controls.
  - **Synchronized Live Moderation & Instant Auto-Save**:
    - Two-way real-time synchronization between Moderation Queue Auto-Approve toggle and Settings "Enable Live Photo Moderation" checkbox.
    - Direct persistence to IndexedDB and Supabase storage manifests with real-time WebSocket broadcast.
  - **Responsive Button Containment & Layout Polish**:
    - Upgraded `.qr-modal-footer`, `.detail-actions-row`, and `.event-card-actions-row` to wrap into responsive multi-column and stacked grids across mobile/tablet viewports without horizontal clipping.
  - **Release Notes**:
    - Generated comprehensive release notes in [`release-notes/RELEASE_NOTES_v0.1.0.md`](release-notes/RELEASE_NOTES_v0.1.0.md).

---

## [0.0.9] - 2026-09-20

### Added
- **Phase 9: Live TV Slideshow Mode & Polish**:
  - **Ambient Blurred Backdrop for Portrait Photos (`App.svelte`)**:
    - Automatic atmospheric colored background blur (`.slide-backdrop-blur`) surrounding portrait smartphone photos on 16:9 projector and TV displays.
  - **Dynamic Captions & Author Glassmorphism Banner**:
    - Glassmorphism banner (`.slideshow-info-banner`) rendering guest captions and author attribution (`📸 Captured by [Name]`).
  - **Live Dynamic Slide Injection**:
    - Real-time slotting of newly approved photos into the ongoing slideshow queue without interrupting playback or resetting index.
  - **On-Screen Live QR Join Badge & Slide Counter**:
    - High-contrast corner QR PIP badge with event logo and live join URL (`Scan to Share`).
    - Top slide position indicator pill (`📸 1 / 42`).
  - **Fullscreen Floating Social Reactions**:
    - Large animated emoji particles and sender badges floating across the projector TV wall when attendees send reactions from their phones.
  - **Keyboard Presentation Controls & Auto-Hiding Toolbar**:
    - `F` / `f` (Fullscreen), `Space` (Play/Pause), `←` / `→` (Previous/Next), `R` / `r` (Force Cloud Refresh), `Esc` (Exit).
    - Floating hover toolbar with responsive controls and auto-hiding transitions.

---

## [0.0.8] - 2026-09-20

### Added
- **Phase 8: Real-Time Signaling, Reactions & Moderation Queue**:
  - **Social Reaction Engine (`realtime.js`)**:
    - Added `sendReaction(emoji, photoId, senderName)` delivering lightweight real-time reaction signals over WebSocket MQTT and local `BroadcastChannel`.
    - Integrated floating reaction listener (`reaction:sent`) broadcasting interactive celebration emojis (`❤️`, `🔥`, `🥂`, `🎉`, `✨`, `🥳`) across all connected devices and projector TV screens.
  - **Floating Reaction Animation Overlay (`App.svelte` & `app.css`)**:
    - Fullscreen non-blocking overlay rendering animated floating reaction emojis with random horizontal drift, elastic zoom, and smooth fade-out.
    - Added 1-tap quick reaction buttons directly on guest live gallery cards and lightbox modal.
  - **Photo Captions & Display**:
    - Persistent 1-line guest captions displayed on live gallery cards and full-resolution lightbox viewer.
  - **Host Moderation Pipeline**:
    - Single & bulk approval/rejection with instant optimistic UI feedback.
    - Automated event quota reconciliation and synchronized deletion from Supabase Cloud Storage.

---

## [0.0.7] - 2026-09-20

### Added
- **Phase 7: Guest Camera Viewfinder & Photo Studio UI**:
  - **In-App Camera Engine (`camera.js`)**:
    - WebRTC `getUserMedia` stream controller (`CameraController`) with ideal HD resolution (1920x1080) and auto-fallback.
    - Real-time front/back camera flipping (`flipCamera`) with mirrored selfie orientation.
    - Hardware torch / flashlight toggle (`toggleTorch`) via `MediaTrackCapabilities`.
    - High-fidelity snapshot grabber (`takeSnapshot`) converting video frames directly to JPEG files.
  - **Live Camera Viewfinder Modal (`App.svelte`)**:
    - Fullscreen in-app viewfinder with live video stream and real-time celebratory frame overlay (Polaroid chin, Wedding Gold, Neon Party, or Custom PNG).
    - Top control bar with close, flashlight toggle, and camera flip buttons.
    - Bottom control bar with shutter button and fast camera roll picker.
  - **Photo Studio & Preview Studio Modal**:
    - Interactive captured/selected photo preview.
    - Real-time framing selector: `[🖼️ Framed Photo]` vs `[📷 Direct Photo (No Frame)]` with instant preview canvas re-rendering.
    - Optional 1-line caption input (max 120 chars) with 1-tap quick reaction emojis (`❤️`, `🔥`, `🥂`, `🎉`, `✨`, `🥳`).
    - Pre-flight upload probe and upload progress feedback before inserting into live feed.
  - **Comprehensive Styling (`app.css`)**:
    - Fullscreen dark backdrop, responsive camera viewport, shutter animations, frame overlay styles, and photo studio preview layout.

---

## [0.0.6] - 2026-09-20

### Added
- **Phase 6: Canvas Frame Compositor Engine & Preset Integration**:
  - **High-Performance Frame Compositor (`photo-engine.js`)**:
    - Implemented `composePhotoWithFrame(fileOrBlob, frameConfig, options)` compositing camera captures with custom transparent PNG frames or procedural presets.
    - Added `renderFramedPhotoToCanvas` for direct canvas rendering and live viewfinder/capture studio preview without blob allocation overhead.
    - Implemented `drawCoverImage` helper with automatic aspect ratio cropping and centering.
    - Safe image loader `loadImageElement` with cross-origin support and automatic blob URL garbage collection.
  - **Smart Preset Sizing & Geometry**:
    - Polaroid preset inner window calculation (`width * 0.90` by `height * 0.79`) with clean top/side margins and extended bottom caption chin.
    - Golden Wedding, Neon Party, and Minimal Modern overlays layered over full-bleed photo compositions.
    - Aspect ratio adaptation (4:5 portrait, 9:16 mobile story, and 1:1 square).
  - **Downscaling & Dual Output**:
    - High-res photo export (max 2048px @ 88% JPEG quality) and micro-thumbnail export (360px @ 75% JPEG quality).
    - Integrated EXIF GPS stripping and SHA-256 duplicate fingerprinting.
    - Seamless fallback and backward-compatible passthrough in `processPhotoClient`.

---

## [0.0.5] - 2026-09-20

### Added
- **Phase 5: Host Frame Studio & Printable Sign Generator**:
  - **Host Frame Studio (`frame-studio.js`)**:
    - Built-in procedural celebration frame presets: *Polaroid Classic*, *Elegant Gold Wedding*, *Neon Party Glow*, and *Minimal Modern*.
    - Canvas rendering engine (`renderPresetFrameToCanvas`) applying borders, accents, and customizable event titles/dates.
    - Added `generatePresetFramePNG` to export high-res transparent PNG overlays.
  - **1-Click Printable Table Card Generator (`print-signs.js`)**:
    - High-resolution (1200x1600px A5/A4) print-ready table cards and posters (`generatePrintableSignBlob`).
    - Crisp high-contrast QR code, event title, date, and 3-step guest instructions.
    - 1-click PNG download trigger (`downloadPrintableSign`).

---

## [0.0.4] - 2026-09-20


### Added
- **Phase 4: Guest Session Persistence & Identity Lifecycle**:
  - **Scoped Local-First Sessions**: Scoped per event slug (`guest_session_<slug>` in `localStorage` + Dexie IndexedDB `guest_sessions` table).
  - **Seamless Auto-Resume**: Guests returning to the event URL (`#/event/<slug>`) instantly restore their session and feed without re-typing their name.
  - **1-Tap Fast-Resume on Re-Entry**: Pre-fills previous display name with a prominent 1-tap `"Continue as [Name]"` prompt if explicitly re-joining.
  - **Permanent Attribution & Quota Sync**: Photo uploads remain permanently bound to guest tokens and display names in Supabase database (`photos.guest_token`, `photos.guest_name`), with 15-photo guest upload limits enforced.
  - **Session Helper Methods (`db.js`)**: Added `saveLocalGuestSession`, `getLocalGuestSession`, and `clearLocalGuestSession`.

---

## [0.0.3] - 2026-09-20


### Added
- **Phase 3: Crypto & Privacy Pipeline**:
  - **Client-Side EXIF GPS Stripping**: In-browser Canvas rasterization strips GPS latitude/longitude, device serials, and camera metadata prior to upload.
  - **SHA-256 Duplicate Fingerprinting**: Computes cryptographic duplicate hashes (`crypto.subtle.digest('SHA-256')`) to reject re-uploads before network transmission.
  - **Zero-Knowledge End-to-End Encryption (E2EE)**:
    - 256-bit AES-GCM symmetric key generation (`generateEventKey()`) using Web Crypto API.
    - Zero-knowledge key distribution via URL hash fragments (`#/event/<slug>#key=<key>`).
    - **`LENC` Binary Envelope**: Authenticated binary envelope encoding (`[LENC 4B][Version 1B][IV 12B][Ciphertext + Auth Tag 16B]`).
    - Instant in-memory decryption (`decryptBlob()`) with `keyCache` and blob URL pooling.
    - Added `parseEventKeyFromUrl()` supporting URL hash and query string key extraction.

---

## [0.0.2] - 2026-09-20


### Added
- **Phase 2: Online-First Network Engine & Pre-Flight Probes**:
  - **Online-First Network Engine (`network.js`)**: Real-time connectivity and latency tracker (`getNetworkState`, `subscribeNetworkState`, `startNetworkMonitoring`) supporting `🟢 Live`, `🟡 Reconnecting`, and `🔴 Offline` status diagnostics.
  - **Pre-Upload Latency & Health Probes**: Implemented `probeNetworkLatency()` (<300ms HEAD/GET probes) and `preFlightUploadCheck()` to verify backend reachability prior to image canvas encoding or storage upload.
  - **Strict 15-Second Upload Timeout & Auto-Retry**: Implemented `withUploadRetry()` wrapping photo uploads with a 15-second AbortController timeout threshold and exponential backoff retry on spotty Wi-Fi / cellular data networks.
  - **Integrated Storage Safeguards**: Bound `preFlightUploadCheck` and `withUploadRetry` into `uploadPhotoToStorage` in `storage.js`.

---

## [0.0.1] - 2026-09-20


### Added
- **Phase 1: BaaS BYOK Engine, Schema Updates & Free-Tier Quota Guards**:
  - **Flexible BaaS Engine**: Built dual-mode backend architecture in `storage.js` supporting both default pre-configured Supabase credentials and custom organizer credentials (BYOK - Bring Your Own Keys).
  - **📋 1-Click SQL Setup Script Generator**: Added `get1ClickSQLSetupScript()` providing organizers with a single-click copyable SQL setup script to initialize all PostgreSQL tables, indexes, RLS policies, and storage bucket configuration.
  - **🔍 Automated Schema & Storage Health Probe**: Implemented `testBaaSConnection()` executing non-destructive connectivity checks against Supabase Auth, PostgreSQL tables (`hosts`, `events`, `guests`, `photos`), and Storage bucket (`luminafeed-photos`) with diagnostic indicators.
  - **Free-Tier Quota Shield**:
    - Enforced **100 photos / event cap** (`checkEventPhotoQuota`) for predictable storage footprints (~48 MB per event).
    - Enforced **5 concurrent active events limit** (`checkHostEventQuota`) protecting Supabase's 1 GB free-tier quota (<25% total utilization).
    - Enforced **15 photos / guest quota** (`checkGuestUploadQuota`) preventing event feed spamming.
    - Automated 24-hour ephemeral TTL lifecycle (`cleanupExpiredHostsAndEvents`).
  - **Database Schema Updates (`supabase_schema.sql`)**:
    - Added `frame_url`, `frame_config`, `auto_approve`, `e2ee_enabled`, and `allow_guest_downloads` to `public.events`.
    - Added `caption`, `has_frame`, and `likes_count` to `public.photos`.
    - Added storage bucket policies for `luminafeed-photos`.
  - **Dexie.js Local Schema v4 Migration (`db.js`)**:
    - Added `guest_sessions` table for 0ms session restoration.
    - Added `baas_settings` table for local organizer configuration.
    - Added `saveLocalGuestSession`, `getLocalGuestSession`, and `clearLocalGuestSession` helper functions.
  - **Custom Frame Asset Storage**: Added `uploadEventFrame`, `deleteEventFrame`, and `getEventFrameUrl` in `storage.js`.
