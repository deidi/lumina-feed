# ❓ LuminaFeed — Frequently Asked Questions (FAQ)

This document answers common architectural, operational, and data lifecycle questions regarding the **LuminaFeed** platform.

---

## 🏛️ Architecture & Storage

### Q1: Does LuminaFeed still use the local database (IndexedDB)?
**Yes, absolutely.** LuminaFeed is built on a **Local-First, Cloud-Synchronized** architecture. Rather than replacing IndexedDB, Supabase Cloud Database and Storage work *in tandem* with it.

- **IndexedDB (via Dexie.js)** is the client-side engine:
  1. **Instant UI Rendering (0ms Latency)**: When hosts or guests open an event, the UI loads immediately from local IndexedDB without waiting for cloud network roundtrips.
  2. **Offline Buffer & Upload Queue**: When guests capture photos on weak or intermittent cellular connections (e.g. in basements, rural venues, or crowded event halls), photos are saved to IndexedDB first (`db.photos`), then synced in the background to Supabase Cloud Storage.
  3. **Local Thumbnail & Asset Cache**: Micro-thumbnails and image blobs are cached locally in the browser so photos do not need to be repeatedly re-downloaded over cellular data whenever a guest switches tabs or refreshes the page.
  4. **Offline Host Session & PIN Security**: Host credentials and salted PIN hashes are stored locally in `db.settings` for session persistence.

- **Supabase Cloud Layer**:
  1. **Supabase Cloud Storage (`luminafeed-photos`)**: Global multi-device CDN delivery of downscaled photos, micro-thumbnails, and event manifests.
  2. **Supabase PostgreSQL (`hosts`, `events`, `guests`)**: Cross-device host isolation, 10-event quota enforcement, remote mobile guest directory tracking, and automated 24-hour TTL cleanup.

---

### Q2: Do `_events` JSON manifest files get deleted when an event is deleted?
**Yes, permanently.**
When an event is deleted, [`deleteEventFilesFromStorage`](client/src/lib/storage.js) scans the `_events/` folder in Supabase Storage and deletes both:
- `_events/${slug}.json` (the event descriptor and host origin manifest)
- `_events/${slug}_approved.json` (the cloud-synchronized approved photo list)

This occurs in all four deletion scenarios:
1. **Manual Host Deletion**: Organizer deletes the event from the Host Dashboard (`handleDeleteEvent` in `App.svelte` & `deleteEvent` in `db.js`).
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
- This ceiling is enforced both in local IndexedDB and inside Supabase Database (`createCloudEvent`).

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
- Events in the host dashboard and local IndexedDB are filtered strictly by `host_name`.
- Events created by other hosts will never appear in your personal dashboard or local database.

---

## 👥 Guests & Mobile Attendees

### Q7: Why did the guest count previously show 0, and how is it fixed?
Previously, attendee records existed only on the local device that created them. Remote guests joining from separate Wi-Fi or cellular networks (4G/5G) were not counted on the host's laptop.

In LuminaFeed v1.2:
- When a guest scans the QR code and joins, their attendee profile and token are synchronized to the Supabase Database `guests` table (`syncGuestToCloud`).
- The host dashboard reconciles database records, local attendees, and photo authors (`photo.guest_name`), ensuring accurate guest counts across all networks.
- Hosts can view the full attendee roster in the **`👥 Guests`** panel on the event detail page.

---

## 🔒 End-to-End Photo Encryption (E2EE)

### Q8: How does End-to-End Encryption (E2EE) protect event photos?
Every event space encrypts photos before they leave the attendee's browser:
- **AES-256-GCM Cryptography**: Both full-resolution photos and micro-thumbnails are encrypted in-browser using the standard Web Crypto API. Supabase Storage only stores encrypted binary payloads (`orig.jpg.enc`, `thumb.jpg.enc`).
- **Zero-Friction QR Key Distribution**: The 256-bit AES event key is included directly in the QR join URL (`?k=...`). Attendees simply scan the host's QR code to view and upload encrypted photos seamlessly without entering a password.
- **Privacy & Metadata Stripping**: EXIF GPS coordinates and camera metadata are automatically stripped from captures before encryption and dispatch.

---

## 📱 TV Mode & Live Slideshow

### Q9: Does launching the TV Slideshow disconnect the host?
**No.** The TV Slideshow opens in a dedicated new browser tab (`target="_blank"`):
- The host remains logged in on their laptop with the full moderation queue active.
- The TV Slideshow tab can be moved to a secondary screen or projector and toggled to fullscreen (`F`).
- The slideshow polls Supabase Storage directly every 5 seconds, automatically presenting newly approved photos and removing deleted ones without interrupting slide transitions.

---

## 🗑️ Event Deletion & Maintenance

### Q10: How does event deletion work, and why is deleting empty events faster?
LuminaFeed uses an adaptive deletion workflow designed to balance safety with user convenience:
- **Fresh or Empty Events (0 Photos)**: Can be deleted with a single instant click. Since no attendee photos or memories are at risk, there is no need to type the event title.
- **Populated Events (>0 Photos)**: Require confirmation by entering the event name. The system is tolerant of leading/trailing spaces and case differences (`.trim().toLowerCase()`), preventing frustration while guarding against accidental loss.
- **Direct Card-Level Deletion**: Organizers can click the `🗑️` button right from any event card on the host dashboard without having to enter the event detail view.
- **Full Clean-Up Cascade**: Deleting an event safely purges associated records from the cloud PostgreSQL database in proper foreign-key order (`photos` -> `guests` -> `events`), purges all storage folders and manifest descriptors from Supabase Storage, and clears local IndexedDB records.
