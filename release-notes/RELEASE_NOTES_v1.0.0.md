# 🚀 LuminaFeed v.1.0.0 Official Release Notes

**Release Date:** September 14, 2026  
**Tag:** `v.1.0.0`  
**Distribution:** Single Page Application (SPA) on GitHub Pages  
**Live Site:** [https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)

---

## 🌟 Executive Summary

**LuminaFeed v.1.0.0** marks the official production launch of the zero-backend, cloud-first real-time ephemeral event photo sharing platform. Built as a high-performance Single Page Application (SPA) with **Svelte 5 Runes**, **Vite 6**, and **Vanilla CSS**, LuminaFeed requires no custom server maintenance, incurs zero hosting fees, and delivers an instant, private, and interactive photo sharing hub for weddings, conferences, parties, and corporate events with 100+ attendees.

This release represents a completely clean release baseline incorporating client-side end-to-end encryption, automated 24-hour ephemeral lifecycles, direct-to-cloud media delivery, local-first zero-latency caching, cross-device attendee directories, live TV presentation slideshows, and multi-network real-time signaling.

---

## 🔑 Key Features & Highlights

### 🔒 1. Client-Side End-to-End Encryption (E2EE) with AES-256-GCM
- **In-Browser Encryption**: All full-resolution photos and micro-thumbnails are encrypted in-browser before network transmission using the standard Web Crypto API (`crypto.subtle`).
- **Binary Envelope**: Utilizes a hardened binary envelope format (`LENC` magic header, version byte, 12-byte cryptographically secure random IV, and AES-GCM ciphertext with 128-bit authentication tag).
- **Zero Plain Data in Cloud**: Cloud storage stores only encrypted binary blobs. Raw camera photos never touch the network unencrypted.
- **Zero-Friction QR Distribution**: Event encryption keys are securely embedded inside QR join URLs (`?k=<hex_key>`), allowing guests and presentation screens to decrypt and view photos instantly without entering passwords.
- **Transparent Decryption**: Automatically decrypts on the fly during full ZIP archive exports and Google Drive cloud backups.

### ⏱️ 2. 24-Hour Ephemeral Lifecycle & Automated Storage Purging
- **24-Hour Retention Window**: Event spaces, host credentials, guest records, and cloud storage folders expire after 24 hours to maximize attendee privacy and prevent storage clutter.
- **Cascading Auto-Purge**: Automated reconciliation purges expired records from the Supabase PostgreSQL database and cascades to permanently delete all associated photos, micro-thumbnails, and event manifests from Supabase Storage.
- **Live Expiration Timer**: Host consoles feature a real-time countdown badge (`⏳ 24h Retention: Xh Ym left`) with informational modals recommending 1-click Google Drive or ZIP backups before expiration.

### ⚡ 3. Direct-to-Cloud Supabase Storage & PostgreSQL BaaS
- **Direct Mobile Uploads**: Smartphone captures bypass host bandwidth limits by streaming directly from guest mobile devices into Supabase Storage.
- **Global Edge CDN**: Instant sub-second photo delivery to live moderation queues, attendee walls, and big-screen TV slideshows.
- **100-Photo Event Quota**: Strict limit of 100 photos per event ensures gallery performance and predictable storage costs.
- **10-Event Host Quota & Event Isolation**: Host dashboards strictly isolate events by host name, preventing events created by other organizers from appearing in private dashboards.
- **Durable Photo Attribution**: Persistent photo metadata records retain author names and session tokens across device reloads and multi-tab sessions.

### 👥 4. Cross-Device Guest Directory & Attendance Tracking
- **Multi-Network Attendance**: Remote guests joining from cellular networks (4G/5G) or separate Wi-Fi connections are accurately counted in real time.
- **Dedicated Guests Directory**: Host event detail includes a dedicated "👥 Guests" panel displaying attendee names, join timestamps, submission totals, and direct links to view their contributions.

### 💾 5. Local-First Architecture (Dexie.js IndexedDB)
- **Zero-Latency UI**: IndexedDB acts as the client-side primary cache, rendering albums and host dashboards in 0ms.
- **Offline Capture Queue**: Smartphone guests in low-reception environments queue photos locally in IndexedDB, automatically streaming them to Supabase Storage once internet connectivity is restored.
- **Local Asset Caching**: Micro-thumbnails and image blobs are cached locally, eliminating unnecessary re-downloads.

### 📱 6. In-Browser Image Optimization Pipeline
- **Hardware-Accelerated Downscaling**: HTML5 Canvas scales down raw camera captures (5–25 MB) to 2048px @ 88% JPEG quality (~300–800 KB, a 90–95% file size reduction).
- **Dual Micro-Thumbnails**: Concurrently generates 360px micro-thumbnails (~25 KB) for instant moderation and grid rendering.
- **Privacy Stripping**: Automatically strips EXIF GPS coordinates via `exifr` and generates SHA-256 duplicate hashes prior to upload.

### 📺 7. Independent Multi-Tab TV Slideshow (`_blank`)
- **Preserved Host Sessions**: TV Slideshow opens in an independent browser tab, allowing the host to moderate on their laptop while presenting on a secondary TV or projector.
- **Cloud Auto-Refresh**: Dynamically pulls newly approved photos and purges rejected photos on a 5-second interval.
- **Presentation Controls**: Fullscreen (`F`), Pause/Play (`Space`), manual refresh (`R`), and keyboard navigation (`←`/`→`).

### 🛡️ 8. Real-Time Moderation Queue & 1-Click Auto-Approve
- **Instant Photo Review**: Visual moderation queue with thumbnail previews, guest attribution, and upload timestamps.
- **Auto-Approve Toggle**: Seamlessly switch between `⚡ Auto-Approve: ON` (hands-free live stream) and `🛡️ Auto-Approve: OFF` (curated manual review).
- **Reversible Moderation**: Revert approved photos back to pending or permanently delete them from both the live wall and cloud storage.

### 📦 9. Data Ownership & Backup
- **In-Memory ZIP Exporter**: Download the complete event album with original photos and `metadata.json` in seconds using `JSZip`.
- **1-Click Google Drive Cloud Backup**: Built-in Google OAuth 2.0 integration allowing hosts to back up event media directly into organized Google Drive folders.

### 🗑️ 10. Resilient Multi-Layer Event Deletion
- **Fast-Path 1-Click Deletion for Empty Events**: Empty or newly created events with 0 photos can be deleted with a single instant click—bypassing redundant name-confirmation inputs.
- **Tolerant Confirmation for Populated Events**: To safeguard active albums with photos, deletion prompts require typing the event name, accepting flexible leading/trailing whitespace and case variations (`.trim().toLowerCase()`).
- **Dashboard Card Quick Action**: Dedicated `🗑️` delete button directly on dashboard event space cards allows immediate management without having to enter the detail view.
- **Cascading Foreign Key Safety**: Ensures orderly deletion (`photos` -> `guests` -> `events`) in the Supabase PostgreSQL database while safely pruning Supabase Storage folders and local IndexedDB records.

### ☕ 11. Creator Support & Community Integration
- **Ko-fi Support Integration**: Directly support open-source development via seamless Ko-fi integration (`https://ko-fi.com/deidi0`) available in the product header, footer, host console header, and host profile settings.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend Framework** | Svelte 5 (Modern Runes: `$state`, `$derived`, `$effect`, `$props`) |
| **Bundler & Build Tool** | Vite 6 |
| **Styling** | Vanilla CSS (Glassmorphism, CSS Custom Properties, Dark Mode) |
| **Cloud Storage & BaaS** | Supabase Cloud Storage & PostgreSQL Database (`@supabase/supabase-js`) |
| **Local-First Database** | Dexie.js (IndexedDB wrapper) |
| **Cryptography** | Web Crypto API (AES-256-GCM symmetric encryption) |
| **Real-Time Signaling** | MQTT.js over Secure WebSockets (`wss://`) |
| **Image Processing** | HTML5 OffscreenCanvas + `exifr` |
| **QR Code Engine** | `qrcode` |
| **Archive Exporter** | `JSZip` |
| **Cloud Backup** | Google OAuth 2.0 & Google Drive REST API |

---

## 🚀 Getting Started

Visit the live application at:  
👉 **[https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)**

To run locally:
```bash
git clone https://github.com/deidi/lumina-feed.git
cd lumina-feed
npm --prefix client install
npm run dev
```

---

## 📄 License

Released under the **[MIT License](LICENSE)**.
