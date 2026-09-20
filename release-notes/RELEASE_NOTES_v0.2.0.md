# LuminaFeed Release Notes — v0.2.0 (Cloud-Only Migration)

**Release Date:** September 20, 2026  
**Milestone:** Cloud-Only Architecture, Unified Authentication & Guest Passcode Protection  
**Live Application:** [`https://deidi.github.io/lumina-feed/#/`](https://deidi.github.io/lumina-feed/#/)

---

## 🌟 Executive Summary

**LuminaFeed v0.2.0** completes the migration from a local-first (Dexie.js/IndexedDB) architecture to a **100% cloud-only** architecture powered by Supabase PostgreSQL and Cloud Storage. All host credentials, event records, guest sessions, and photo metadata are now stored exclusively in the cloud, ensuring seamless cross-device synchronization across GitHub Pages, localhost, and LAN deployments.

This release also introduces a **unified Host Login & Registration portal** and an optional **4-digit guest passcode** system (Option B) for identity protection, preventing other users from claiming a guest's display name.

---

## 🏛️ Key Highlights

### 1. Cloud-Only Architecture Migration
- **Complete Dexie.js/IndexedDB Removal**: All local database dependencies have been fully purged. The `dexie` npm package is no longer a project dependency.
- **Supabase PostgreSQL as Single Source of Truth**: Host accounts (`public.hosts`), events (`public.events`), guest sessions (`public.guests`), and photo metadata (`public.photos`) are all queried and written directly to the cloud database.
- **Browser `localStorage` for Tokens Only**: Local storage is used solely for caching session tokens (`luminafeed_host_token`, `luminafeed_guest_{slug}`), not as an authoritative data source.
- **Schema-Adaptive Persistence**: `safeSupabaseUpsert` and `safeSupabaseUpdate` dynamically omit unsupported columns, enabling backward compatibility with older Supabase schema versions.

### 2. Unified Host Login & Registration Portal
- **Tabbed Host Portal**: Replaced the single-step host setup with a tabbed interface offering explicit **Sign In** (existing hosts) and **Register** (new hosts) tabs.
- **Cloud-Verified Authentication**: Host credentials (`host_name`, `pin_hash`) are verified authoritatively against the `public.hosts` table on every login attempt. Invalid credentials are rejected immediately.
- **Session Expiry Detection**: `getAuthStatus()` probes the cloud database on every page load to detect expired (24-hour TTL) or deleted host accounts, automatically clearing stale local session tokens and prompting re-authentication.
- **Cross-Origin Consistency**: A host logging in from GitHub Pages and then opening the app on localhost sees the same events and data, since all state lives in the cloud.

### 3. Guest Passcode Identity Protection (Option B)
- **4-Digit Optional Passcode**: Guests joining an event for the first time can set an optional 4-digit passcode. The passcode is SHA-256 hashed and stored as `pin_hash` in the `public.guests` table.
- **Identity Hijacking Prevention**: If a guest with the same name already exists for an event and has a passcode set, new devices must provide the matching passcode to resume the session.
- **Cross-Device Session Restoration**: Guests joining from different devices (phone, tablet, desktop) with the correct `(event_slug, name, pin_hash)` combination seamlessly restore their upload count and session data.
- **Anonymous Join Supported**: Guests who don't set a passcode join without identity protection, maintaining the frictionless experience for casual events.

### 4. Cloud Event Validation on Join/Rejoin
- **Real-Time Event Existence Check**: `validateAndFetchEvent(slug)` checks Supabase Database and Storage manifests on every join attempt.
- **Stale Token Cleanup**: If the event was deleted by the host, stale local guest session tokens (`luminafeed_guest_{slug}`) are automatically purged, and the guest sees a clear error message.
- **Fallback Discovery**: If the Supabase PostgreSQL query returns empty (e.g., due to schema migration), the system falls back to checking Storage manifests (`_events/${slug}.json`) for event data.

### 5. Database Schema Updates (`supabase_schema.sql`)
- **Bumped to v0.2.0**: Schema comment updated from `v0.0.1 - Rebuild` to `v0.2.0 - Cloud-Only`.
- **`pin_hash` Column on `public.guests`**: Added optional `pin_hash text` column for guest passcode storage.
- **`unique_event_guest_name` Constraint**: Added `unique(event_slug, name)` constraint to prevent duplicate guest names per event.

---

## 🔧 Technical Changes

### Removed Dependencies
| Package | Previous Version | Status |
|---|---|---|
| `dexie` | `^4.x` | ❌ **Removed** |

### Modified Modules
| Module | Changes |
|---|---|
| [`db.js`](client/src/lib/db.js) | Complete rewrite: removed Dexie schemas, added `loginHost`, `registerHost`, cloud-only `getEvents`, `joinEvent` with passcode, `db` compatibility adapter |
| [`storage.js`](client/src/lib/storage.js) | Added `loginHostInCloud`, `registerHostInCloud`, `registerOrVerifyGuestInCloud`, `safeSupabaseUpsert`, `safeSupabaseUpdate` |
| [`api.js`](client/src/lib/api.js) | Exposed new `loginHost`, `registerHost`, `joinEvent` (with passcode param) |
| [`App.svelte`](client/src/App.svelte) | Replaced Host Setup/Unlock with tabbed Host Portal; added passcode input to Guest Join UI |
| [`supabase_schema.sql`](supabase_schema.sql) | Added `pin_hash` to guests, `unique_event_guest_name` constraint |

---

## 🛠️ Build & Verification Checklist

- [x] Client production build succeeds (`npm --prefix client run build` -> `0 errors`)
- [x] Root GitHub Pages bundle synchronized (`index.html` & `assets/`)
- [x] Dexie.js fully removed from `package.json` and `node_modules`
- [x] All host auth flows verified against Supabase Database
- [x] Guest passcode join/rejoin tested across multiple devices
- [x] Event deletion correctly purges guest tokens
- [x] Documentation updated across `CHANGELOG.md`, `README.md`, `FAQ.md`, `AGENTS.md`, and `.agents/rules/`
