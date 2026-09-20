# ❓ LuminaFeed — Frequently Asked Questions (FAQ)

This document answers common architectural, operational, and data lifecycle questions regarding the **LuminaFeed** platform.

---

## 🏛️ Architecture & Storage

### Q1: How does LuminaFeed store data?
**LuminaFeed uses a 100% Cloud-Only architecture.** All data — host accounts, event records, guest sessions, photo metadata, and photo files — is stored exclusively in **Supabase PostgreSQL** (database) and **Supabase Cloud Storage** (files/CDN). There are no local database dependencies.

- **Supabase PostgreSQL (`public.hosts`, `public.events`, `public.guests`, `public.photos`)**: Authoritative source for all structured data. Hosts, events, guests, and photo metadata are queried and written directly to the cloud database.
- **Supabase Cloud Storage (`luminafeed-photos` bucket)**: Global CDN delivery of downscaled photos, micro-thumbnails, and event manifests.
- **Browser `localStorage`**: Used only for lightweight session token caching (e.g., `luminafeed_host_token`, `luminafeed_guest_{slug}`). This is **not** an authoritative data source — sessions are always verified against the cloud database on reconnect.

> **Note:** Prior to v0.2.0, LuminaFeed used Dexie.js/IndexedDB for local-first storage. This was fully removed to ensure consistent cross-device data synchronization.

---

### Q2: Do `_events` JSON manifest files get deleted when an event is deleted?
**Yes, permanently.**
When an event is deleted, [`deleteEventFilesFromStorage`](client/src/lib/storage.js) scans the `_events/` folder in Supabase Storage and deletes both:
- `_events/${slug}.json` (the event descriptor and host origin manifest)
- `_events/${slug}_approved.json` (the cloud-synchronized approved photo list)

This occurs in all deletion scenarios:
1. **Manual Host Deletion**: Organizer deletes the event from the Host Dashboard.
2. **Automated 24-Hour TTL Expiration**: Ephemeral lifecycle cleanup purges expired events (`cleanupExpiredHostsAndEvents`).
3. **Cloud Database Cascade**: Whenever `deleteCloudEvent(slug)` is executed.

---

### Q3: What happens to photos when an event reaches the 100-photo limit?
Every event enforces a strict limit of **100 photos**:
- Organizers are alerted during event creation of the 100-photo quota.
- When the 100th photo is uploaded, guest upload controls gracefully pause and display a banner informing guests that the event album is full.
- Hosts can delete lower-quality or duplicate submissions in real time to immediately restore available quota for new uploads.

---

### Q4: How does the 10-event host limit work?
Each host account is capped at a maximum of **10 active event spaces**:
- The host dashboard displays an active quota pill (`Create New Event (X/10)`).
- If a host reaches 10 events, the "Create New Event" button is disabled and a warning banner advises the host to delete older or expired events before creating a new space.
- This ceiling is enforced inside Supabase Database (`createCloudEvent`).

---

## ⏱️ Ephemeral Lifecycle & Privacy

### Q5: What is the 24-hour ephemeral retention lifecycle?
All host spaces, events, guest attendee records, and uploaded photos in LuminaFeed are retained for **24 hours**:
- A real-time countdown badge on the host dashboard (`⏳ 24h Retention: Xh Ym left`) shows remaining time.
- After 24 hours from creation, the reconciliation routine (`cleanupExpiredHostsAndEvents`) cascades deletions from Supabase Database, permanently purging all associated photo blobs, thumbnails, and JSON manifests from Supabase Storage.
- Hosts are encouraged to use the **`☁️ Backup to GDrive`** or **`📦 Export Full Archive (.ZIP)`** buttons prior to event expiration.

---

### Q6: Can other hosts see my events?
**No.** Host dashboards strictly enforce **Host Event Isolation**:
- Events are filtered strictly by `host_name` in the Supabase PostgreSQL query.
- Events created by other hosts will never appear in your personal dashboard.

---

## 🔐 Authentication & Guest Identity

### Q7: How does host authentication work?
Hosts authenticate directly against the **`public.hosts`** table in Supabase PostgreSQL:
- **Registration**: A new host creates an account with a unique `host_name` and 4+ digit Admin PIN. The PIN is SHA-256 hashed before storage (`pin_hash`).
- **Login**: Existing hosts verify their `(host_name, pin_hash)` combination against the cloud database. Invalid credentials are rejected immediately.
- **Session Tokens**: On successful authentication, a session token is cached in `localStorage` for convenience. The token is re-verified against the cloud database on each page load via `getAuthStatus()`.
- **Expiry Detection**: If a host account has expired (24-hour TTL) or been deleted, `getAuthStatus()` automatically clears stale local session tokens and prompts re-authentication.

---

### Q8: What is the guest passcode system?
LuminaFeed uses **Option B: 4-digit guest passcode** to protect guest identities:
- **First Join**: When a guest joins an event for the first time, they enter their display name and an **optional 4-digit passcode**. If set, the passcode is SHA-256 hashed and stored as `pin_hash` in the `public.guests` table.
- **Subsequent Joins**: If a guest with the same name already exists for that event *and* has a passcode set, the new device must provide the matching passcode to resume the session.
- **Cross-Device Restoration**: Guests joining from different devices (phone, tablet, desktop) with the correct `(event_slug, name, pin_hash)` combination seamlessly restore their upload count and session.
- **No Passcode (Anonymous)**: If a guest does not set a passcode, they join without identity protection. Another user could join with the same display name on a different device.

---

### Q9: What happens if I join a deleted event?
When a guest tries to join an event that has been deleted:
- `validateAndFetchEvent(slug)` checks Supabase Database and Storage manifests.
- If the event is not found, the guest sees an error message: *"Event not found. This event may have ended or was deleted by the host."*
- Any stale local session tokens (`luminafeed_guest_{slug}`) are automatically purged.

---

## 👥 Guests & Mobile Attendees

### Q10: How are guest counts tracked across devices?
Guest attendee records are stored in the **`public.guests`** Supabase table:
- When a guest scans the QR code and joins, their profile and token are registered directly in the cloud database via `registerOrVerifyGuestInCloud`.
- The host dashboard reconciles database records and photo authors (`photo.guest_name`), ensuring accurate guest counts across all networks (Wi-Fi, 4G/5G, different devices).
- Hosts can view the full attendee roster in the **`👥 Guests`** panel on the event detail page.

---

## 🔒 End-to-End Photo Encryption (E2EE)

### Q11: How does End-to-End Encryption (E2EE) protect event photos?
Every event space can optionally encrypt photos before they leave the attendee's browser:
- **AES-256-GCM Cryptography**: Both full-resolution photos and micro-thumbnails are encrypted in-browser using the standard Web Crypto API. Supabase Storage only stores encrypted binary payloads (`orig.jpg.enc`, `thumb.jpg.enc`).
- **Zero-Friction QR Key Distribution**: The 256-bit AES event key is included directly in the QR join URL (`?k=...`). Attendees simply scan the host's QR code to view and upload encrypted photos seamlessly without entering a password.
- **Privacy & Metadata Stripping**: EXIF GPS coordinates and camera metadata are automatically stripped from captures before encryption and dispatch.

---

## 📱 TV Mode & Live Slideshow

### Q12: Does launching the TV Slideshow disconnect the host?
**No.** The TV Slideshow opens in a dedicated new browser tab (`target="_blank"`):
- The host remains logged in on their laptop with the full moderation queue active.
- The TV Slideshow tab can be moved to a secondary screen or projector and toggled to fullscreen (`F`).
- The slideshow polls Supabase Storage directly every 5 seconds, automatically presenting newly approved photos and removing deleted ones without interrupting slide transitions.

---

## 🗑️ Event Deletion & Maintenance

### Q13: How does event deletion work, and why is deleting empty events faster?
LuminaFeed uses an adaptive deletion workflow designed to balance safety with user convenience:
- **Fresh or Empty Events (0 Photos)**: Can be deleted with a single instant click. Since no attendee photos or memories are at risk, there is no need to type the event title.
- **Populated Events (>0 Photos)**: Require confirmation by entering the event name. The system is tolerant of leading/trailing spaces and case differences (`.trim().toLowerCase()`), preventing frustration while guarding against accidental loss.
- **Direct Card-Level Deletion**: Organizers can click the `🗑️` button right from any event card on the host dashboard without having to enter the event detail view.
- **Full Clean-Up Cascade**: Deleting an event safely purges associated records from the cloud PostgreSQL database in proper foreign-key order (`photos` -> `guests` -> `events`), purges all storage folders and manifest descriptors from Supabase Storage, and clears local session tokens.

---

## 🌐 Local Network & Dynamic Host IP Discovery

### Q14: How do QR codes and Join URLs work when running locally on my laptop?
When running locally during development or on a local venue Wi-Fi router:
- **Automated Local LAN IP Detection**: LuminaFeed automatically discovers the host's actual local IPv4 address (e.g. `192.168.1.x`, `10.x.x.x`) via a Vite server middleware endpoint (`/api/host-info`) and browser WebRTC ICE probing.
- **Dynamic Localhost Replacement**: The QR Code generator and join URLs replace `localhost` and `127.0.0.1` with your actual computer IP address (e.g. `http://192.168.1.2:5173/#/event/<slug>`). This allows smartphones connected to the same Wi-Fi network to scan the QR code and join immediately.
- **Dynamic IP Controls**: The QR modal features a **Host Network Address** bar with 🔄 **Auto-Detect / Refresh IP** to update local network routes on the fly if your DHCP lease changes.
- **Zero Impact on Production**: When hosted on GitHub Pages (`https://deidi.github.io/lumina-feed/#/`), public URLs are used automatically without any local IP replacement.
