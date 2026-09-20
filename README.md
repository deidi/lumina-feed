# 📸 LuminaFeed — Real-Time Event Photo Sharing PWA

[![Version](https://img.shields.io/badge/Version-v0.3.0-blue)](CHANGELOG.md)
[![Target](https://img.shields.io/badge/Latest%20Release-v0.3.0%20Production-orange)](#-rebuild-roadmap-v001--v100)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Frontend](https://img.shields.io/badge/Frontend-Svelte%205%20%2B%20Vite%206-FF3E00?logo=svelte)](https://svelte.dev/)
[![BaaS](https://img.shields.io/badge/BaaS-Supabase%20Storage%20%26%20Postgres-3ECF8E?logo=supabase)](https://supabase.com/)
[![PWA](https://img.shields.io/badge/PWA-Online--First-blueviolet)](https://web.dev/progressive-web-apps/)
[![Support](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/deidi0)

> **LuminaFeed** is a **100% Cloud-Native Progressive Web App (PWA)** for real-time event photo sharing. Guests join instantly via QR code to capture photos with **host-customized photo frames**, stream directly to cloud storage, interact with **live reactions and captions**, and watch approved memories appear instantly on a **full-screen TV slideshow**. All data — host accounts, events, guest sessions, and photos — is stored exclusively in **Supabase PostgreSQL & Cloud Storage**, ensuring seamless cross-device synchronization with zero local database dependencies.

---

## 🚀 Live Links & Resources

- **🌐 Live Demo**: [https://deidi.github.io/lumina-feed/#/](https://deidi.github.io/lumina-feed/#/)
- **💻 Host Console**: [https://deidi.github.io/lumina-feed/#/app](https://deidi.github.io/lumina-feed/#/app)
- **📝 Rebuild Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **❓ Architecture FAQ**: [FAQ.md](FAQ.md)
- **📦 Previous Release Archive**: [archive/v1.0.0-snapshot/](archive/v1.0.0-snapshot/)
- **☕ Support on Ko-fi**: [https://ko-fi.com/deidi0](https://ko-fi.com/deidi0)

---

## 🏛️ System Architecture & Workflow

```mermaid
flowchart TD
    subgraph Host ["Host Portal (Organizer)"]
        H0["Login / Register (Cloud-Verified PIN Authentication)"]
        H0A["1-Click Copy SQL Script & Auto Schema Health Probe"]
        H1["Create Event & Settings (Auto-Approve, E2EE, Quotas)"]
        H2["Frame Studio: Upload PNG Frame or Select Built-in Preset"]
        H3["Printable Table Card Generator (PDF / PNG Sign)"]
        H4["Moderation Queue: Single / Batch Approve & Reject"]
        H5["Live TV Slideshow Mode (Projector / Screen)"]
    end

    subgraph Guest ["Guest PWA Client (Mobile / Desktop)"]
        G0["Scan QR Code or Open #/event/slug"]
        G0A["Enter Name + Optional 4-Digit Passcode"]
        G1["Cloud Auth: registerOrVerifyGuestInCloud"]
        G2["Capture: In-App Viewfinder (Live Frame Overlay) OR Native File Picker"]
        G3["Photo Studio: Toggle Frame, Add Caption & Preview"]
        G4["Canvas Compositing, EXIF Strip & Downscaling (2048px / 360px)"]
        G4A["Pre-Flight Health Ping -> Upload Blob / LENC Envelope"]
        G5["Author Feed: Instant Optimistic Display"]
        G6["Live Feed: Real-Time Stream of Approved Photos + Reactions"]
    end

    subgraph BaaS ["Supabase BaaS (Cloud Database & Storage)"]
        S1[("Supabase Storage: luminafeed-photos Bucket")]
        S2[("Supabase PostgreSQL: hosts, events, guests, photos")]
        S3["WebSocket MQTT Signaling + BroadcastChannel"]
    end

    %% Host Auth & Setup
    H0 -->|"Verify host_name + pin_hash"| S2
    H0A -->|"Probe Connectivity & Tables"| BaaS
    H1 -->|"1. Insert Event Record & Quotas"| S2
    H2 -->|"2. Upload Frame PNG / Save Preset Config"| S1
    H2 -->|"3. Sync Frame URL to Event Record"| S2
    H1 --> H3

    %% Guest Flow
    G0 --> G0A
    G0A --> G1
    G1 -->|"Verify/Register in public.guests"| S2
    G1 --> G2
    G2 --> G3
    G3 --> G4
    G4 --> G4A
    G4A -->|"4. Upload Optimized Blob"| S1
    G4A -->|"5. Insert Photo Record"| S2
    G4A --> G5
    G4A -->|"6. Broadcast 'photo:submitted'"| S3

    %% Moderation Flow
    S3 -->|"7. Realtime Alert to Moderation Queue"| H4
    H4 -->|"8. Host Approves Photo"| S2
    H4 -->|"9. Broadcast 'photo:approved'"| S3

    %% Live Updates & Social
    S3 -->|"10. Stream Photos & Reactions"| G6
    S3 -->|"11. Inject into TV Slideshow"| H5
```

---

## 🌟 Core Pillars & Capabilities

### ⚡ 1. Flexible BaaS Backend & BYOK Self-Hosting
- **Default Pre-Configured Cloud**: Zero-configuration setup running out of the box using embedded environment variables.
- **Bring-Your-Own-Keys (BYOK)**: Connect any custom Supabase project by entering your Project URL and Public Anon Key in Host Settings.
- **📋 1-Click SQL Setup Generator**: Built-in copy tool that outputs the exact PostgreSQL DDL script for all 4 tables (`hosts`, `events`, `guests`, `photos`), RLS policies, and storage bucket configuration.
- **🔍 Automated Schema & Storage Health Probe**: Live probe testing API connectivity, table existence, and storage bucket accessibility with real-time status badges.

### 🛡️ 2. Free-Tier Quota Shield & Storage Math
Designed to operate comfortably within Supabase's **1 GB Free Tier**:
- **100 Photos / Event Default Cap**: Average photo + thumbnail footprint is `~480 KB`, totaling `~48 MB` per event space.
- **5 Concurrent Active Events Limit**: Consumes only `~240 MB` total (<25% of the 1 GB free-tier storage), leaving `>750 MB` of safety headroom.
- **15 Photos / Guest Quota**: Prevents single-user flood spamming.
- **24-Hour Ephemeral TTL**: Automatically purges expired events daily and cascades cloud file deletion.

### 🖼️ 3. Host Custom Photo Frame Studio
- **Custom PNG Upload**: Organizers can upload custom transparent PNG overlays (e.g. from Canva, Photoshop, or Figma).
- **Built-in Celebration Presets**: Procedural customizable templates (*Polaroid Classic*, *Golden Glamour*, *Neon Celebration*, *Minimalist Modern*) with customizable event titles and dates.
- **No-Frame Option**: Toggle to run clean, direct raw photo feeds.

### 📷 4. Dual Camera Capture & Photo Studio
- **In-App Live Viewfinder**: Real-time camera feed with live frame overlay and shutter controls.
- **Native OS Camera / Gallery Fallback**: Standard mobile file picker option.
- **Photo Studio**: Preview toggle between **Framed** and **Direct Photo** before submission.
- **Client Processing Engine**: In-browser canvas rendering (2048px @ 88% JPEG + 360px @ 75% micro-thumbnail), EXIF GPS stripping, and SHA-256 duplicate detection.

### 🔐 5. Unified Cloud Authentication & Guest Passcode Protection
- **Cloud-Verified Host Login**: Hosts authenticate against `public.hosts` with `(host_name, pin_hash)`. Separate **Sign In** and **Register** tabs in the Host Portal.
- **Guest Passcode (Option B)**: Guests can set an optional 4-digit passcode on first join, preventing other users from claiming their identity. Cross-device session restoration uses `(event_slug, name, pin_hash)`.
- **Floating Real-Time Reactions**: Attendees tap reactions (❤️ / 🔥 / 🥂 / 🎉) that float live across all guest feeds and the TV slideshow.
- **Optional Photo Captions**: Add personalized 1-line messages to uploads.
- **Cross-Device Auto-Resume**: Guests joining from any device with the correct passcode are seamlessly restored to their session without re-registering.

### 📺 6. Full-Screen TV Slideshow (Projector Mode)
- **Big Screen Ready**: Dark-theme fullscreen display with smooth Ken Burns and fade transitions.
- **Smart Portrait Split**: Elegant blurred sidebars for vertical smartphone photos.
- **Live Slide Injection**: Dynamically slots newly approved photos into the upcoming rotation without interrupting playback.
- **Corner QR Watermark**: On-screen QR code for guests to scan from anywhere in the venue.

### 🌐 7. Dynamic Host IP & LAN Event Sharing Engine
- **Automated Local LAN IP Resolution**: Automatically probes local network IPv4 via Vite server middleware and WebRTC ICE gathering.
- **Dynamic QR Code Swapping**: Replaces `localhost` and `127.0.0.1` with the host's actual IP address (`http://192.168.x.x:5173/#/event/<slug>`) so nearby smartphone attendees can scan and join seamlessly on local Wi-Fi.
- **Interactive Network Bar**: 1-click **Auto-Detect / Refresh IP** action in the QR modal to handle router DHCP updates on the fly.
- **Zero-Config GitHub Pages Isolation**: Automatically detects public domains (`deidi.github.io`) and generates public CDN join links without local IP replacements.

### 🖨️ 8. Printable High-Resolution QR Table Cards & Posters
- **1-Click Print Generator**: Creates 1200x1600px high-resolution print-ready cards and posters via HTML5 Canvas.
- **Branded Venue Assets**: Automatically embeds the event title, tagline, date, and dynamic QR code onto elegant dark/light theme templates for guest tables and venue entryways.

### 🛡️ 9. Synchronized Live Moderation & Instant Auto-Save
- **Two-Way Real-Time State Sync**: Toggling moderation in the Queue tab or "Enable Live Photo Moderation" in Settings automatically persists to Supabase Database and storage manifests.
- **Live WebSocket Signaling**: Broadcasts event setting changes instantly across all attendee viewports without requiring page refreshes.

---

## 🗺️ Rebuild Roadmap (v0.0.1 → v0.3.0)

| Phase | Target Version | Focus Milestone | Status |
|---|---|---|---|
| **Phase 1** | `v0.0.1` | **BaaS BYOK Engine, Schema & Quota Guards** | ✅ **Completed** |
| **Phase 2** | `v0.0.2` | **Online-First Network Engine & Pre-Flight Probes** | ✅ **Completed** |
| **Phase 3** | `v0.0.3` | **Crypto & Privacy Pipeline (EXIF Stripping & Optional E2EE)** | ✅ **Completed** |
| **Phase 4** | `v0.0.4` | **Guest Session Persistence & Identity Lifecycle** | ✅ **Completed** |
| **Phase 5** | `v0.0.5` | **Host Frame Studio & Printable Sign Generator** | ✅ **Completed** |
| **Phase 6** | `v0.0.6` | **Canvas Frame Compositor Engine** | ✅ **Completed** |
| **Phase 7** | `v0.0.7` | **Guest Camera Viewfinder & Photo Studio UI** | ✅ **Completed** |
| **Phase 8** | `v0.0.8` | **Real-Time Signaling, Reactions & Moderation Queue** | ✅ **Completed** |
| **Phase 9** | `v0.0.9` | **Live TV Slideshow Mode & Transitions** | ✅ **Completed** |
| **Phase 10** | `v0.1.0` | **PWA Verification & Production Re-Release** | ✅ **Completed** |
| **Phase 11** | `v0.2.0` | **Cloud-Only Migration, Unified Auth & Guest Passcode** | ✅ **Completed** |
| **Phase 12** | `v0.2.1` | **Unified Login Baseline & Schema-Adaptive Persistence** | ✅ **Completed** |
| **Phase 13** | `v0.2.2` | **Event Status Default & Quota Hardening** | ✅ **Completed** |
| **Phase 14** | `v0.3.0` | **Comprehensive Security Hardening, CSPRNG Tokens & RLS** | ✅ **Completed** |

---

## 🛠️ Development & Build Workflow

### Prerequisites
- Node.js 18+ & npm

### Setup & Local Dev
```powershell
# Install client dependencies
npm --prefix client install

# Start local dev server
npm run dev
```

### Production Build
```powershell
# Compile production bundle
npm --prefix client run build

# Sync built assets to root for GitHub Pages
Copy-Item -Path client\dist\index.html -Destination .\index.html -Force
Copy-Item -Path client\dist\assets\* -Destination .\assets\ -Force
```

---

## 📄 License & Creator Support

- **License**: Released under the [MIT License](LICENSE).
- **Creator Support**: If you love LuminaFeed, support continuous development on [Ko-fi](https://ko-fi.com/deidi0)! ☕
