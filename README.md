# 📸 LuminaFeed — Zero-Backend Real-Time Event Photo Hub

[![Release](https://img.shields.io/badge/Release-v.1.0.0-blue)](https://github.com/deidi/lumina-feed/releases/tag/v.1.0.0)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Frontend](https://img.shields.io/badge/Frontend-Svelte%205%20%2B%20Vite%206-orange)](https://svelte.dev/)
[![Storage & Database](https://img.shields.io/badge/BaaS-Supabase%20Storage%20%26%20Postgres-3ECF8E?logo=supabase)](https://supabase.com/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/deidi0)
[![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-blueviolet)](https://web.dev/progressive-web-apps/)
[![Status](https://img.shields.io/badge/Deploy-GitHub%20Pages-success?logo=github)](https://deidi.github.io/lumina-feed/#/)

> **LuminaFeed** is a zero-backend, cloud-first real-time ephemeral event photo sharing platform. Built entirely in modern web standards as a client-side Single Page Application (SPA) powered by managed BaaS (Supabase Cloud Storage & PostgreSQL Database), LuminaFeed requires **no custom server infrastructure to build or maintain**, incurs **zero dedicated hosting fees**, and delivers **direct-to-cloud photo uploads & global CDN delivery**, **24-hour ephemeral event spaces**, a **cross-device guest directory**, sub-second **real-time moderation**, and high-impact **live TV presentation slideshows** for 100+ attendees.

---

## 🚀 Live Demo & Quick Links

- **🌐 Product Landing Page**: [https://deidi.github.io/lumina-feed/](https://deidi.github.io/lumina-feed/)
- **💻 Host App Console**: [https://deidi.github.io/lumina-feed/#/app](https://deidi.github.io/lumina-feed/#/app)
- **☕ Support on Ko-fi**: [https://ko-fi.com/deidi0](https://ko-fi.com/deidi0)
- **❓ Frequently Asked Questions**: [FAQ.md](FAQ.md)
- **📦 Official Release Notes**: [release-notes/RELEASE_NOTES_v1.0.0.md](release-notes/RELEASE_NOTES_v1.0.0.md)
- **📝 Project Changelog**: [CHANGELOG.md](CHANGELOG.md)

---

## 🗺️ Application Route Structure

| Route | View | Description |
| :--- | :--- | :--- |
| `/` (`#/`) | **Default Landing Page** | Public product showcase with feature highlights, live interactive preview, how-it-works guide, and CTA. |
| `/app` (`#/app`) | **Host Console** | Host setup, PIN unlock, event management dashboard, moderation queue, analytics, and cloud storage settings. |
| `/event/:slug` (`#/event/:slug`) | **Guest Portal** | Instant join page with mobile camera, photo upload queue, and live event memories wall. |
| `/event/:slug/slideshow` | **TV Slideshow** | High-contrast presentation mode for venue screens and projectors with dynamic corner QR code. |
| `/privacy` (`#/privacy`) | **Privacy Policy** | Google OAuth scope and zero-backend client-side privacy details. |
| `/terms` (`#/terms`) | **Terms of Service** | Usage terms and user-generated content policies. |

---

## 🌟 Key Features

### ⚡ 1. Zero-Backend & Pure Client SPA Architecture
- **Zero Custom Backend Maintenance**: Runs entirely inside host and guest web browsers without building, managing, or paying for custom backend servers (no Node.js/Express, Python, or Docker containers). All storage, database persistence, and media delivery are offloaded directly to managed Supabase Cloud Storage & PostgreSQL BaaS.
- **Static Cloud Deployment**: Optimized for GitHub Pages, Cloudflare Pages, Vercel, or Netlify with built-in SPA 404 fallback routing.

### ⏱️ 2. 24-Hour Ephemeral Event Lifecycle & Automated Cleanup
- **Ephemeral Event Spaces**: Host accounts, event spaces, guest records, and cloud photo folders remain active for **24 hours** from creation, ensuring attendee privacy and maintaining a lean cloud storage footprint.
- **Cascading Auto-Purge**: Once an event passes 24 hours, automated reconciliation purges the records from Supabase Database and permanently deletes all associated original photos and thumbnails from Supabase Storage (`deleteEventFilesFromStorage`).
- **Live Expiration Timer**: Host dashboards display a real-time countdown badge (`⏳ 24h Retention: Xh Ym left`) informing hosts of their remaining session window.
- **Safeguarding Memories**: Hosts can use **1-Click Backup to Google Drive** or **Export Full Archive (.ZIP)** before expiration.

### 👥 3. Cross-Device Guest Directory & Attendance Tracking
- **Multi-Network Attendance**: Remote guests joining from personal smartphones on cellular networks (4G/5G) or separate Wi-Fi are synchronized via Supabase Database.
- **Accurate Attendee Counts**: Guest counts on host cards and headers reconcile cloud attendee sessions and photo attributions, preventing zero-guest counters when remote users contribute photos.
- **Dedicated Guests Tab**: Host event detail view includes a **"👥 Guests"** panel displaying attendee names, join timestamps, submission totals, and direct links to view their contributions in the Live Gallery.
- **Immutable Attendee Identity**: Photo attribution is keyed by the guest session token, not a display name. Two attendees named Alex remain separate people, while their selected display names remain visible in the gallery.

### ☁️ 4. Direct-to-Cloud Supabase Storage & Quota Management
- **Direct Mobile Uploads**: Smartphone captures bypass host bandwidth limits by streaming directly from guest mobile devices into Supabase Storage buckets.
- **Global Edge CDN**: Instant sub-second photo delivery to live moderation queues, attendee walls, and big-screen TV slideshows.
- **Durable Photo Attribution**: Image files stay in Storage while a Supabase `photos` record preserves their storage path, guest token, guest-name snapshot, and image metadata. This keeps author names intact after a refresh, on another host device, or in a TV slideshow even if a real-time message was missed.
- **10-Event Host Quota & Event Isolation**: Host dashboards strictly isolate events by `host_name`, hiding other hosts' gatherings, and enforce a maximum cap of 10 events per host.
- **Event Photo Quota (100 Photos Max)**: Each event space enforces a limit of 100 photos. Organizers are alerted during event creation, and uploads halt gracefully once capacity is reached.
- **Cascading Deletion & Manifest Purge**: Deleting an event or photo cascades to Supabase Storage, permanently purging photos, micro-thumbnails, and event manifests (`_events/${slug}.json`, `_events/${slug}_approved.json`) with zero orphaned files.

### 💾 5. Local-First & Cloud-Synchronized Architecture (IndexedDB + Supabase BaaS)
- **Zero-Latency Local Rendering**: IndexedDB (via Dexie.js) acts as the client-side primary cache, rendering albums and host dashboards in 0ms without waiting for cloud roundtrips.
- **Offline Capture Queue**: Smartphone guests in low-reception environments queue photos locally in IndexedDB, automatically streaming them to Supabase Storage once internet connectivity is restored.
- **Local Asset Caching**: Micro-thumbnails and image blobs are cached locally in the browser, eliminating unnecessary cellular re-downloads.

### 🔒 6. Client-Side End-to-End Encryption (E2EE)
- **AES-256-GCM In-Browser Encryption**: Every event space automatically encrypts photos client-side before network transmission using the standard Web Crypto API. Raw uncompressed camera files never touch cloud storage unencrypted.
- **Zero-Friction QR Distribution**: Event encryption keys are embedded directly inside QR join URLs, allowing attendees to instantly view and upload encrypted photos without typing keys or passwords.
- **Transparent Decryption Pipelines**: On-the-fly decryption during ZIP downloads and Google Drive backups ensures organizers seamlessly receive unencrypted archives.

### 📺 7. Independent Multi-Tab TV Slideshow (`_blank`)
- **Preserved Host Sessions**: Launching the TV Slideshow opens in a separate browser tab, allowing the host's moderation dashboard to stay active and logged in on their laptop while presenting on a secondary TV/projector.
- **Live Auto-Refresh & Cloud Sync**: Periodically syncs directly with the Supabase Storage bucket on a 5-second interval, dynamically injecting newly approved captures and purging removed photos without interrupting presentation flow.
- **Presentation Shortcuts**: `F` (Fullscreen), `Space` (Pause/Resume carousel), `R` (Force manual refresh), and `←`/`→` (Manual slide navigation).
- **Customizable Overlays**: Configurable transition intervals (`3s`, `5s`, `10s`), animation effects (`fade`, `slide`, `zoom`), photographer credit badges, and live corner QR code watermark for late arrivals.

### ⚡ 8. Real-Time Moderation Queue & 1-Click Auto-Approve
- **Instant Photo Review**: Moderation feed with thumbnail previews, guest attribution, and upload timestamps.
- **1-Click Auto-Approve Toggle**: Switch seamlessly between **`⚡ Auto-Approve: ON`** (hands-free live stream) and **`🛡️ Auto-Approve: OFF`** (manual review mode) with one-click approval of pending batches.
- **Reversible Moderation & Instant Cloud Purge**: Revert approved photos back to pending or permanently delete them from both the live wall and Supabase Cloud Storage with real-time removal across all connected screens.

### 📱 9. Frictionless Guest Smartphone Experience
- **Zero App Downloads**: Guests simply scan a dynamic QR code from any standard camera app to join in seconds.
- **In-Browser Image Optimization Pipeline**: Hardware-accelerated Canvas processing renders raw smartphone camera photos (5–25 MB) down to 2048px @ 88% JPEG (~300–800 KB, a 90–95% file size reduction) paired with 360px micro-thumbnails (~25 KB). Automatically strips EXIF GPS coordinates and computes SHA-256 duplicate hashes prior to upload.
- **Live Upload Feedback**: Animated progress bar, sequential photo counters (`Uploading Photos 2 of 5`), and delivery confirmation.

### 📦 10. Data Ownership, Backup & Export
- **In-Memory ZIP Exporter**: Download the complete event album with original photos and `metadata.json` in under 2 seconds using `JSZip`.
- **1-Click Google Drive Cloud Backup**: Built-in Google OAuth 2.0 integration allowing hosts to back up event media directly into organized `/LuminaFeed Events/<Event Name>/` folder hierarchies. One-click button triggers Google sign-in and direct backup.
- **Adaptive Deletion Guard & Fast-Path**: Fresh or empty events with 0 photos can be deleted instantly with 1 click (via dedicated `🗑️` buttons on both dashboard cards and detail views). Events with photos require typing the event title (whitespace and case tolerant) to guard against accidental deletion.

---

## 🏗️ System Architecture

```
                                 ┌──────────────────────────────────────────────┐
                                 │     📱 Guest Smartphones (100+ Attendees)    │
                                 │  - Zero App Install: Instant QR Code Scan    │
                                 │  - In-Browser Resize (2048px) & EXIF Strip   │
                                 │  - Live Memories Wall & Upload Progress      │
                                 └──────┬───────────────────────────────▲───────┘
                                        │                               │
                1. Signaling & Approval │                               │ 3. Approved Media Stream
                    (MQTT / WebSockets) │                               │    (Supabase CDN / Web)
                                        ▼                               │
┌─────────────────────────────────────────────────────────┐             │
│              💻 Host Dashboard (Browser SPA)            │             │
│  - Event Spaces, 24h Ephemeral Countdown & Host Profile │             │
│  - Real-Time Moderation Queue (Auto-Approve Toggle)     ├─────────────┼────────────────────────┐
│  - Guest Directory & Supabase DB/Storage Manager        │             │                        │
└───────────────────────────┬─────────────────────────────┘             │                        │
                            │                                           │                        │
                            │ 2. Direct-to-Cloud Uploads & Attendance   │                        │
                            ▼                                           ▼                        ▼
              ┌───────────────────────────┐               ┌──────────────────────────┐ ┌───────────────────┐
              │ ⚡ Supabase Managed BaaS   │               │ 📺 TV / Projector Screen │ │ ☁️ Google Drive   │
              │  - Storage: Photo CDN     │               │ - Dedicated New Tab View │ │    & ZIP Archive  │
              │  - Postgres: Hosts/Guests │               │ - Fullscreen Presentation│ │ - In-Memory Export│
              │  - 24h Ephemeral TTL Purge│               └──────────────────────────┘ └───────────────────┘
              └───────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technologies / Libraries | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | [Svelte 5](https://svelte.dev/) | High-performance reactive UI with modern runes (`$state`) |
| **Build Tool & Bundler** | [Vite 6](https://vitejs.dev/) | Fast HMR dev server and optimized production bundling |
| **Cloud Storage & Database**| [@supabase/supabase-js](https://supabase.com/) | Managed BaaS: direct photo uploads, global CDN, and PostgreSQL host/guest directory |
| **Client Database** | [Dexie.js](https://dexie.org/) | Local-first IndexedDB engine: 0ms instant UI rendering, local photo/thumbnail caching, and offline capture queues |
| **End-to-End Encryption**| [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) | Client-side AES-256-GCM authenticated encryption for photos & micro-thumbnails |
| **Real-Time Signaling** | [MQTT.js](https://github.com/mqttjs/MQTT.js) | Sub-second WebSocket messaging for cross-device synchronization |
| **Image Processing** | `HTML5 OffscreenCanvas` + [exifr](https://github.com/MikeKovarik/exifr) | In-browser resizing, thumbnail generation, and EXIF privacy stripping |
| **QR Code Engine** | [qrcode](https://github.com/soldair/node-qrcode) | Dynamic in-browser generation of event join QR codes |
| **Archive Exporter** | [JSZip](https://stuk.github.io/jszip/) | In-browser generation of full `.zip` albums and `metadata.json` |
| **Cloud Backup** | Google OAuth 2.0 + Drive REST API | 1-Click photo backup to user's Google Drive |
| **PWA & Offline** | Service Worker (`sw.js`) + Web App Manifest | Native installability on mobile and network-first cache resilience |

---

## 📁 Repository Structure

```
lumina-feed/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Automated GitHub Pages CI/CD workflow
├── client/                     # Frontend client application
│   ├── public/
│   │   ├── 404.html            # SPA fallback for deep links on GitHub Pages
│   │   ├── manifest.json       # PWA progressive web app configuration
│   │   ├── sw.js               # Network-first Service Worker
│   │   └── .nojekyll           # Disables Jekyll processing on GitHub Pages
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.js          # Unified API bridging DB, storage & realtime
│   │   │   ├── archive.js      # In-memory JSZip event archive creator
│   │   │   ├── crypto.js       # Client-side AES-256-GCM encryption & key management
│   │   │   ├── db.js           # Dexie.js IndexedDB schema and operations
│   │   │   ├── gdrive.js       # Google Drive OAuth 2.0 integration
│   │   │   ├── offline-queue.js# Offline upload queue for unstable connections
│   │   │   ├── photo-engine.js # Client-side image resizer & EXIF orientation
│   │   │   ├── realtime.js     # MQTT over WebSockets live signaling
│   │   │   └── storage.js      # Supabase Cloud Storage client & CDN handlers
│   │   ├── App.svelte          # Main reactive SPA component
│   │   ├── app.css             # Design tokens, typography & animations
│   │   └── main.js             # Svelte 5 application entry point
│   ├── .env.example            # Environment variables template
│   ├── index.html              # HTML shell
│   ├── package.json            # Client dependencies & scripts
│   ├── svelte.config.js        # Svelte compiler & preprocessor configuration
│   └── vite.config.js          # Vite config with relative base path ('./')
├── CHANGELOG.md                # Release history and version tracking
├── FAQ.md                      # Frequently asked questions & architectural guide
├── README.md                   # Comprehensive project documentation
├── release-notes/              # Official Release Notes (v.1.0.0)
├── supabase_schema.sql         # PostgreSQL schema for hosts, events, guests & photo attribution
├── package.json                # Root convenience scripts (npm run dev/build)
└── svelte.config.js            # Root language server & Svelte config link
```

---

## 💻 Local Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### 1. Clone the Repository
```bash
git clone https://github.com/deidi/lumina-feed.git
cd lumina-feed
```

### 2. Install Dependencies
```bash
# Install dependencies in client
npm --prefix client install
```

### 3. Environment Variables (Optional)
LuminaFeed has pre-configured production defaults. If you wish to use your own Supabase project:
```bash
cd client
cp .env.example .env
```
Edit `.env`:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-public-key
VITE_SUPABASE_BUCKET=luminafeed-photos
```

### 4. Supabase Database Schema
Run [`supabase_schema.sql`](supabase_schema.sql) in the Supabase SQL Editor before deploying. It creates the `hosts`, `events`, `guests`, and `photos` tables and their RLS policies. The `photos` table is required to retain guest-selected photo names across refreshes and devices.

### 5. Run Development Server
```bash
# From root
npm run dev

# Or directly in client directory
cd client
npm run dev
```
Open `http://localhost:5173` in your browser.

### 6. Build for Production
```bash
# From root
npm run build

# Preview production build locally
npm run preview
```
The compiled static assets are generated in `client/dist/`.

---

## 📖 Event Day Runbook

### For Hosts & Event Organizers

1. **Initial Setup**:
   - Open **[https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)**.
   - Create your **Host Display Name** and **4-Digit Admin PIN** on first setup.
   - Verify cloud storage status via the **`⚡ Supabase Cloud Storage: Active`** indicator.
2. **Create the Event**:
   - Click **`+ Create New Event`**.
   - Enter the Event Name, Date, Tagline, and per-guest upload limits.
   - Note the **100 Photo Quota**: Each event includes a 100-photo capacity to keep live galleries lightweight and fast.
   - Choose moderation preference: Enable manual moderation or toggle Auto-Approve.
3. **Display & Share QR Code**:
   - Click **`📱 QR Code`** on the event card.
   - Use **`📺 Full-Screen TV Mode`** to project the join QR code at venue entrances, or **`💾 Download PNG`** to print on table cards.
4. **Launch TV Slideshow**:
   - Click **`📺 Launch TV Slideshow`** — it opens in a separate browser tab (`_blank`).
   - Drag this tab to your venue TV screen or projector and press **`F`** for fullscreen.
   - Your host dashboard remains intact on your laptop for real-time moderation!
5. **Moderate, Backup & Export**:
   - Approve, reject, or auto-approve photos in real time.
   - Deleting a photo from the Live Gallery (`🗑️`) or rejecting a pending photo automatically purges both full-res and thumbnail files from Supabase Cloud Storage.
   - Click **`☁️ Backup to GDrive`** on the event card or detail panel to sync photos directly to Google Drive via 1-click Google OAuth.
   - Click **`📦 Export Full Archive`** to download all original photos and metadata in a single `.zip` file.
6. **Deleting Events & Cloud Storage Cleanup**:
   - When deleting an event, LuminaFeed presents a safety warning prompting hosts to back up to Google Drive first.
   - Confirming deletion automatically purges all uploaded photos from Supabase Cloud Storage and removes local records.

### For Attendees & Guests

1. **Join**:
   - Scan the event QR code with any smartphone camera.
   - Type your name (e.g. `Emma`) and tap **Join Event**.
2. **Capture & Upload**:
   - Tap **📸 Camera** to capture live photos or **🖼️ Camera Roll** to select existing ones.
   - Watch the upload progress bar and delivery feedback.
3. **Live Memories**:
   - View approved memories on the live event stream in real time.
   - Delete any of your own photos at any time to free up quota.

---

## 🌐 Deploying to GitHub Pages

LuminaFeed includes an automated GitHub Actions workflow in `.github/workflows/deploy.yml`:

1. **Enable GitHub Pages**:
   - Go to your repository on GitHub: **Settings → Pages**.
   - Under **Build and deployment → Source**, select **GitHub Actions**.
2. **Push Changes**:
   - Every push to the `main` branch triggers an automated build and deployment.
   - The workflow compiles the Svelte 5 SPA, generates `404.html` for SPA hash routing, and publishes to GitHub Pages.

---

## 📄 License & Credits

Developed with ❤️ by **deidi** and the Open Source Community.  
If you love LuminaFeed and want to support ongoing development, consider buying me a coffee on **[Ko-fi](https://ko-fi.com/deidi0)**! ☕  

Released under the **[MIT License](LICENSE)**.
