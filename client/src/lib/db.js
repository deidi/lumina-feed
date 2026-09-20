import QRCode from 'qrcode';
import { processPhotoClient } from './photo-engine.js';
import {
  generateEventKey,
  wrapEventKeyForAdmin,
  getStoredEventKey,
  setStoredEventKey,
  decryptBlob,
  computeSha256,
  generateSecureToken,
} from './crypto.js';
import {
  getSupabaseClient,
  getBaaSConfig,
  isStorageConfigured,
  uploadPhotoToStorage,
  deleteIndividualPhotoFromStorage,
  deleteEventFilesFromStorage,
  listEventPhotosFromStorage,
  syncEventManifestToStorage,
  getEventManifestFromStorage,
  syncApprovedListToStorage,
  getApprovedListFromStorage,
  registerOrVerifyHostInCloud,
  loginHostInCloud,
  registerHostInCloud,
  registerOrVerifyGuestInCloud,
  getHostDetailsFromCloud,
  updateHostInCloud,
  deleteHostFromCloud,
  createCloudEvent,
  getCloudEventsForHost,
  deleteCloudEvent,
  syncGuestToCloud,
  getCloudGuestsForEvent,
  syncPhotoToCloud,
  getCloudPhotosForEvent,
  safeSupabaseUpsert,
  safeSupabaseUpdate,
  EVENT_MAX_PHOTOS_LIMIT
} from './storage.js';
import {
  buildDynamicEventJoinUrl,
  resolveDynamicOrigin,
  getStoredHostIP,
  setStoredHostIP,
  detectLocalIP
} from './network.js';

// In-memory cache for Object URLs to avoid memory leaks
const objectUrlCache = new Map();

/**
 * Convert Blob to Base64 string
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert Base64 string to Blob
 */
export function base64ToBlob(base64, mimeType = 'image/jpeg') {
  const byteCharacters = atob(base64.split(',')[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Get or create cached Object URL
 */
export function getCachedObjectURL(blob, key) {
  if (!blob) return '';
  if (objectUrlCache.has(key)) {
    return objectUrlCache.get(key);
  }
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, url);
  return url;
}

/**
 * Compute SHA-256 hash across secure and non-secure contexts
 */
export async function sha256(text) {
  return computeSha256(text);
}

/**
 * Generate clean URL slug from text
 */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Generate unique slug if duplicate exists in Supabase DB
 */
export async function getUniqueSlug(baseName) {
  let baseSlug = slugify(baseName) || 'event';
  let slug = baseSlug;
  let counter = 1;

  if (!isStorageConfigured()) return slug;

  try {
    const client = getSupabaseClient();
    while (true) {
      const { data } = await client
        .from('events')
        .select('slug')
        .eq('slug', slug)
        .maybeSingle();

      if (!data) return slug;
      counter++;
      slug = `${baseSlug}-${counter}`;
    }
  } catch (_) {
    return slug;
  }
}

// -----------------------------------------------------------------------------
// 1. HOST AUTHENTICATION & MANAGEMENT (Pure Cloud Supabase DB)
// -----------------------------------------------------------------------------

/**
 * Get host setup and authentication status (authoritatively from Supabase Database)
 */
export async function getAuthStatus() {
  const sessionToken = localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token');
  const storedHostName = localStorage.getItem('luminafeed_host_name') || '';

  if (!sessionToken || !storedHostName) {
    return {
      initialized: false,
      is_authenticated: false,
      host_name: ''
    };
  }

  if (isStorageConfigured() && storedHostName) {
    try {
      const cloudHost = await getHostDetailsFromCloud(storedHostName);
      if (!cloudHost || cloudHost.isExpired) {
        // Host was deleted or expired in the cloud DB
        localStorage.removeItem('luminafeed_host_token');
        localStorage.removeItem('caps_host_token');
        localStorage.removeItem('luminafeed_host_name');
        return {
          initialized: false,
          is_authenticated: false,
          host_name: '',
          was_expired: Boolean(cloudHost?.isExpired)
        };
      }
      return {
        initialized: true,
        is_authenticated: true,
        host_name: cloudHost.host_name || storedHostName
      };
    } catch (_) {}
  }

  return {
    initialized: Boolean(storedHostName),
    is_authenticated: Boolean(sessionToken),
    host_name: storedHostName || 'Host'
  };
}

/**
 * Explicit Host Sign In (authoritatively verified against Supabase Database)
 */
export async function loginHost(host_name, pin) {
  const cleanHost = (host_name || '').trim();
  if (!cleanHost) throw new Error('Host name is required');
  if (!pin || pin.trim().length < 4) throw new Error('Admin PIN must be at least 4 digits');

  const pin_hash = await sha256(pin.trim());

  if (isStorageConfigured()) {
    const cloudRes = await loginHostInCloud(cleanHost, pin_hash);
    if (!cloudRes || cloudRes.success === false) {
      throw new Error(cloudRes?.error || 'Invalid Host Name or Admin PIN.');
    }
  }

  const session_token = generateSecureToken('host_token');
  localStorage.setItem('luminafeed_host_token', session_token);
  localStorage.setItem('caps_host_token', session_token);
  localStorage.setItem('luminafeed_host_name', cleanHost);

  return { success: true, host_name: cleanHost, token: session_token, session_token };
}

/**
 * Explicit Host Registration (authoritatively created in Supabase Database)
 */
export async function registerHost(host_name, pin) {
  const cleanHost = (host_name || '').trim();
  if (!cleanHost) throw new Error('Host name is required');
  if (!pin || pin.trim().length < 4) throw new Error('Admin PIN must be at least 4 digits');

  const pin_hash = await sha256(pin.trim());

  if (isStorageConfigured()) {
    const cloudRes = await registerHostInCloud(cleanHost, pin_hash);
    if (!cloudRes || cloudRes.success === false) {
      throw new Error(cloudRes?.error || 'Host registration failed.');
    }
  }

  const session_token = generateSecureToken('host_token');
  localStorage.setItem('luminafeed_host_token', session_token);
  localStorage.setItem('caps_host_token', session_token);
  localStorage.setItem('luminafeed_host_name', cleanHost);

  return { success: true, host_name: cleanHost, token: session_token, session_token, isNew: true };
}

/**
 * Host logout (clears local session without deleting cloud host data)
 */
export function logoutHost() {
  localStorage.removeItem('luminafeed_host_token');
  localStorage.removeItem('caps_host_token');
  localStorage.removeItem('luminafeed_host_name');
  return { success: true };
}

/**
 * Setup host credentials (backward-compatible wrapper)
 */
export async function setupHost(host_name, pin) {
  const cleanHost = (host_name || '').trim();
  const pin_hash = await sha256(pin.trim());
  if (isStorageConfigured()) {
    const cloudRes = await registerOrVerifyHostInCloud(cleanHost, pin_hash);
    if (cloudRes && cloudRes.success === false) {
      throw new Error(cloudRes.error || 'Host setup failed.');
    }
  }

  const session_token = generateSecureToken('host_token');
  localStorage.setItem('luminafeed_host_token', session_token);
  localStorage.setItem('caps_host_token', session_token);
  localStorage.setItem('luminafeed_host_name', cleanHost);

  return { success: true, host_name: cleanHost, token: session_token, session_token };
}

/**
 * Update Host Name / Role and Admin PIN in Supabase Database
 */
export async function updateHostProfile({ host_name, current_pin, new_pin }) {
  const currentHost = localStorage.getItem('luminafeed_host_name') || '';
  if (!currentHost) throw new Error('Host not initialized');

  let newPinHash = null;
  if (new_pin && new_pin.trim()) {
    if (new_pin.trim().length < 4) throw new Error('New PIN must be at least 4 digits');
    newPinHash = await sha256(new_pin.trim());
  }

  if (isStorageConfigured()) {
    let currentHash = null;
    if (current_pin) {
      currentHash = await sha256(current_pin.trim());
      const cloudRes = await loginHostInCloud(currentHost, currentHash);
      if (cloudRes && cloudRes.success === false) {
        throw new Error('Current Admin PIN is incorrect');
      }
    }

    const updatedHostName = (host_name && host_name.trim()) ? host_name.trim() : currentHost;
    await updateHostInCloud(
      currentHost,
      {
        host_name: updatedHostName,
        pin_hash: newPinHash
      },
      currentHash
    );

    localStorage.setItem('luminafeed_host_name', updatedHostName);
    return { success: true, host_name: updatedHostName };
  }

  const updatedHostName = (host_name && host_name.trim()) ? host_name.trim() : currentHost;
  localStorage.setItem('luminafeed_host_name', updatedHostName);
  return { success: true, host_name: updatedHostName };
}

/**
 * Verify host PIN against Supabase Database
 */
export async function verifyPin(pin) {
  const storedHost = localStorage.getItem('luminafeed_host_name') || '';
  if (!storedHost) {
    throw new Error('Host is not configured yet');
  }

  return loginHost(storedHost, pin);
}

/**
 * Reset local and cloud host credentials
 */
export async function resetHostSetup() {
  const storedHost = localStorage.getItem('luminafeed_host_name') || '';
  if (storedHost && isStorageConfigured()) {
    await deleteHostFromCloud(storedHost).catch(() => {});
  }
  localStorage.removeItem('luminafeed_host_token');
  localStorage.removeItem('caps_host_token');
  localStorage.removeItem('luminafeed_host_name');
  return { success: true };
}

// -----------------------------------------------------------------------------
// 2. EVENT MANAGEMENT (Pure Cloud Supabase DB & Storage)
// -----------------------------------------------------------------------------

/**
 * Get all events for a host with real-time aggregates directly from Supabase Database
 */
export async function getEvents(hostName = '') {
  if (!isStorageConfigured()) {
    return { success: true, events: [] };
  }

  try {
    const client = getSupabaseClient();
    const cleanHost = (hostName || '').trim();

    let query = client.from('events').select('*').order('created_at', { ascending: false });
    if (cleanHost) {
      query = query.ilike('host_name', cleanHost);
    }

    let events = null;
    try {
      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        events = data;
      }
    } catch (_) {}

    // Fallback: If DB table returned empty or had an issue, query storage manifests
    if (!events || events.length === 0) {
      const storageEvents = await getCloudEventsForHost(cleanHost);
      if (storageEvents && storageEvents.length > 0) {
        events = storageEvents;
      }
    }

    if (!events || events.length === 0) {
      return { success: true, events: [] };
    }

    // Fetch photo & guest aggregates for these events
    const slugs = events.map(e => e.slug);
    let allPhotos = [];
    let allGuests = [];

    if (slugs.length > 0) {
      const [photosRes, guestsRes] = await Promise.all([
        client.from('photos').select('id, event_slug, status, guest_name').in('event_slug', slugs),
        client.from('guests').select('id, event_slug, name').in('event_slug', slugs)
      ]);
      allPhotos = photosRes.data || [];
      allGuests = guestsRes.data || [];
    }

    const photosBySlug = new Map();
    for (const p of allPhotos) {
      if (!photosBySlug.has(p.event_slug)) photosBySlug.set(p.event_slug, []);
      photosBySlug.get(p.event_slug).push(p);
    }

    const guestsBySlug = new Map();
    for (const g of allGuests) {
      if (!guestsBySlug.has(g.event_slug)) guestsBySlug.set(g.event_slug, []);
      guestsBySlug.get(g.event_slug).push(g);
    }

    const eventsWithStats = events.map(e => {
      const eventPhotos = photosBySlug.get(e.slug) || [];
      const eventGuests = guestsBySlug.get(e.slug) || [];
      const approved_photos = eventPhotos.filter(p => p.status === 'approved').length;
      const pending_photos = eventPhotos.filter(p => p.status === 'pending').length;

      const guestNamesSet = new Set(eventPhotos.map(p => (p.guest_name || '').trim().toLowerCase()).filter(Boolean));
      eventGuests.forEach(g => { if (g.name) guestNamesSet.add(g.name.trim().toLowerCase()); });
      const total_guests = Math.max(eventGuests.length, guestNamesSet.size);

      return {
        ...e,
        status: e.status || 'active',
        max_photos: Number(e.max_photos) || 100,
        total_photos: eventPhotos.length,
        approved_photos,
        pending_photos,
        total_guests
      };
    });

    return { success: true, events: eventsWithStats };
  } catch (err) {
    console.warn('getEvents error:', err);
    return { success: true, events: [] };
  }
}

/**
 * Validate event existence directly against Supabase Cloud DB & Storage.
 * If the event was deleted on the cloud, purges local guest tokens and returns error.
 */
export async function validateAndFetchEvent(slug) {
  if (!slug) throw new Error('Event slug is required');
  const cleanSlug = String(slug).trim();

  if (isStorageConfigured()) {
    const client = getSupabaseClient();
    
    // 1. Query Supabase PostgreSQL `events` table
    const { data: dbEvent, error: dbErr } = await client
      .from('events')
      .select('*')
      .eq('slug', cleanSlug)
      .maybeSingle();

    if (dbEvent) {
      const storedKey = getStoredEventKey(cleanSlug) || dbEvent.encryption_key || '';
      if (storedKey) {
        setStoredEventKey(cleanSlug, storedKey);
      }
      return {
        ...dbEvent,
        status: dbEvent.status || 'active',
        max_photos: Number(dbEvent.max_photos) || 100,
        guest_upload_limit: Number(dbEvent.guest_upload_limit) || 20,
        is_encrypted: Boolean(dbEvent.is_encrypted || dbEvent.e2ee_enabled || storedKey),
        encryption_key: storedKey
      };
    }

    // 2. Fallback: check storage manifest `_events/${slug}.json`
    let manifest = null;
    try {
      manifest = await getEventManifestFromStorage(cleanSlug);
    } catch (_) {}

    if (!manifest) {
      // Event does not exist on Supabase Cloud (or was deleted by host)
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`luminafeed_guest_${cleanSlug}`);
        localStorage.removeItem(`caps_guest_${cleanSlug}`);
      }
      throw new Error('Event not found. This event may have ended or was deleted by the host.');
    }

    const storedKey = getStoredEventKey(cleanSlug) || manifest.encryption_key || '';
    return {
      slug: manifest.slug || cleanSlug,
      name: manifest.name || cleanSlug,
      host_name: manifest.host_name || 'Host',
      date: manifest.date || new Date().toISOString().split('T')[0],
      tagline: manifest.tagline || 'Memories Shared in Real-Time',
      moderation_enabled: manifest.moderation_enabled !== false,
      auto_approve: Boolean(manifest.auto_approve),
      e2ee_enabled: Boolean(manifest.is_encrypted || manifest.e2ee_enabled),
      allow_guest_downloads: manifest.allow_guest_downloads !== false,
      frame_url: manifest.frame_url || null,
      frame_config: manifest.frame_config || { enabled: false, preset: 'none', text: '' },
      guest_upload_limit: Number(manifest.guest_upload_limit) || 20,
      max_photos: Number(manifest.max_photos) || 100,
      exif_strip: manifest.exif_strip !== false,
      is_encrypted: Boolean(manifest.is_encrypted || storedKey),
      encryption_key: storedKey,
      status: manifest.status || 'active',
      created_at: manifest.created_at || new Date().toISOString()
    };
  }

  throw new Error('Cloud storage is not configured.');
}

/**
 * Get single event with live aggregates from Supabase Database
 */
export async function getEvent(slug) {
  const event = await validateAndFetchEvent(slug);
  const cleanSlug = event.slug || slug;

  let approved_photos = 0;
  let pending_photos = 0;
  let total_photos = 0;
  let total_guests = 0;

  if (isStorageConfigured()) {
    try {
      const client = getSupabaseClient();
      const [photosRes, guestsRes] = await Promise.all([
        client.from('photos').select('id, status, guest_name').eq('event_slug', cleanSlug),
        client.from('guests').select('id, name').eq('event_slug', cleanSlug)
      ]);

      const photos = photosRes.data || [];
      const guests = guestsRes.data || [];

      approved_photos = photos.filter(p => p.status === 'approved').length;
      pending_photos = photos.filter(p => p.status === 'pending').length;
      total_photos = photos.length;

      const guestNamesSet = new Set(photos.map(p => (p.guest_name || '').trim().toLowerCase()).filter(Boolean));
      guests.forEach(g => { if (g.name) guestNamesSet.add(g.name.trim().toLowerCase()); });
      total_guests = Math.max(guests.length, guestNamesSet.size);
    } catch (_) {}
  }

  const max_photos = Number(event.max_photos) || 100;

  return {
    success: true,
    event: {
      ...event,
      max_photos,
      total_photos,
      approved_photos,
      pending_photos,
      total_guests
    }
  };
}

/**
 * Create a new event space in Supabase Database and Storage
 */
export async function createEvent(data, hostName = '') {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Event name is required');

  const resolvedHost = (hostName || data.host_name || localStorage.getItem('luminafeed_host_name') || 'Host').trim();
  const slug = await getUniqueSlug(name);
  const now = new Date().toISOString();

  const isEncrypted = Boolean(data.is_encrypted || data.e2ee_enabled);
  let encryptionKey = (data.encryption_key || '').trim();
  let adminWrappedKey = '';

  if (isEncrypted) {
    if (!encryptionKey) {
      encryptionKey = generateEventKey();
    }
    setStoredEventKey(slug, encryptionKey);
    try {
      adminWrappedKey = await wrapEventKeyForAdmin(encryptionKey);
    } catch (_) {}
  }

  const eventRecord = {
    slug,
    name,
    host_name: resolvedHost,
    date: data.date || now.split('T')[0],
    tagline: data.tagline || 'Memories Shared in Real-Time',
    moderation_enabled: data.moderation_enabled !== false,
    auto_approve: Boolean(data.auto_approve),
    e2ee_enabled: isEncrypted,
    allow_guest_downloads: data.allow_guest_downloads !== false,
    frame_url: data.frame_url || null,
    frame_config: data.frame_config || { enabled: false, preset: 'none', text: '' },
    guest_upload_limit: Math.min(100, Math.max(1, parseInt(data.guest_upload_limit, 10) || 15)),
    max_photos: 100,
    exif_strip: Boolean(data.exif_strip),
    is_encrypted: isEncrypted,
    encryption_key: encryptionKey,
    admin_wrapped_key: adminWrappedKey,
    status: 'active',
    created_at: now
  };

  if (isStorageConfigured()) {
    const cloudRes = await createCloudEvent(eventRecord, resolvedHost);
    syncEventManifestToStorage(eventRecord, resolvedHost).catch(() => {});
    return { success: true, event: cloudRes?.event || eventRecord };
  }

  return { success: true, event: eventRecord };
}

/**
 * Update event settings in Supabase Database and Storage
 */
export async function updateEvent(slugOrId, updates = {}) {
  const cleanSlug = String(slugOrId).trim();
  const patch = {};

  if (updates.name !== undefined) patch.name = updates.name.trim();
  if (updates.tagline !== undefined) patch.tagline = updates.tagline.trim();
  if (updates.guest_upload_limit !== undefined) {
    patch.guest_upload_limit = Math.min(100, Math.max(1, Number(updates.guest_upload_limit) || 15));
  }
  if (updates.moderation_enabled !== undefined) patch.moderation_enabled = Boolean(updates.moderation_enabled);
  if (updates.auto_approve !== undefined) patch.auto_approve = Boolean(updates.auto_approve);
  if (updates.e2ee_enabled !== undefined || updates.is_encrypted !== undefined) {
    const isEnc = Boolean(updates.e2ee_enabled !== undefined ? updates.e2ee_enabled : updates.is_encrypted);
    patch.e2ee_enabled = isEnc;
    patch.is_encrypted = isEnc;
    if (isEnc) {
      let existingKey = getStoredEventKey(cleanSlug);
      if (!existingKey) {
        existingKey = generateEventKey();
        setStoredEventKey(cleanSlug, existingKey);
      }
      patch.encryption_key = existingKey;
    }
  }
  if (updates.allow_guest_downloads !== undefined) patch.allow_guest_downloads = Boolean(updates.allow_guest_downloads);
  if (updates.frame_url !== undefined) patch.frame_url = updates.frame_url;
  if (updates.frame_config !== undefined) patch.frame_config = updates.frame_config;
  if (updates.exif_strip !== undefined) patch.exif_strip = Boolean(updates.exif_strip);

  if (isStorageConfigured()) {
    const client = getSupabaseClient();
    const { data: updated, error } = await safeSupabaseUpdate(client, 'events', patch, { slug: cleanSlug });

    if (!error && updated) {
      syncEventManifestToStorage(updated, updated.host_name).catch(() => {});
      return { success: true, event: updated };
    }
  }

  return { success: true, event: { slug: cleanSlug, ...patch } };
}

/**
 * Update event status (e.g. active, archived) in Supabase Database
 */
export async function updateEventStatus(slug, status) {
  const cleanSlug = String(slug).trim();
  if (isStorageConfigured()) {
    const client = getSupabaseClient();
    const { data: updated, error } = await safeSupabaseUpdate(client, 'events', { status }, { slug: cleanSlug });

    if (!error && updated) {
      syncEventManifestToStorage(updated, updated.host_name).catch(() => {});
      return {
        success: true,
        status,
        event: updated,
        message: status === 'archived' ? 'Event closed and archived. Guest uploads are now disabled.' : 'Event reopened! Guest uploads are now active.'
      };
    }
  }

  return {
    success: true,
    status,
    message: status === 'archived' ? 'Event closed and archived.' : 'Event reopened!'
  };
}

/**
 * Delete an event, cascading across Supabase Storage and PostgreSQL tables
 */
export async function deleteEvent(slug) {
  const cleanSlug = String(slug).trim();
  let supabaseDeleted = 0;

  if (isStorageConfigured()) {
    // 1. Purge all photo files, thumbnails, frames, and manifests from Supabase Storage
    try {
      const storageResult = await deleteEventFilesFromStorage(cleanSlug);
      supabaseDeleted = storageResult?.deletedCount || 0;
    } catch (storageErr) {
      console.warn('Error deleting event files from Supabase Storage:', storageErr);
    }

    // 2. Cascade delete database records
    await deleteCloudEvent(cleanSlug).catch(() => {});
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`luminafeed_guest_${cleanSlug}`);
    localStorage.removeItem(`caps_guest_${cleanSlug}`);
  }

  return { success: true, supabaseDeleted };
}

/**
 * Generate QR code data URL for guest joining
 */
export async function getEventQR(slug, options = {}) {
  const hostIp = typeof options === 'string' ? '' : (options?.hostIp || '');
  let eventKey = getStoredEventKey(slug);

  if (!eventKey && isStorageConfigured()) {
    try {
      const client = getSupabaseClient();
      const { data } = await client.from('events').select('encryption_key').eq('slug', slug).maybeSingle();
      if (data?.encryption_key) eventKey = data.encryption_key;
    } catch (_) {}
  }

  const join_url = buildDynamicEventJoinUrl(slug, { hostIp, eventKey });
  const qr_data_url = await QRCode.toDataURL(join_url, {
    width: 400,
    margin: 2,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF'
    }
  });

  return {
    success: true,
    qr_data_url,
    join_url,
    event_key: eventKey,
    host_ip: hostIp || getStoredHostIP() || null,
    host_type: typeof options === 'string' ? options : (options?.hostType || 'web')
  };
}

// -----------------------------------------------------------------------------
// 3. GUEST SESSIONS & DIRECTORY (Pure Cloud Supabase DB)
// -----------------------------------------------------------------------------

/**
 * Guest join event - registers and authenticates directly in Supabase `guests` table
 */
export async function joinEvent(slug, name, passcode = '') {
  const event = await validateAndFetchEvent(slug);
  const cleanSlug = event.slug || slug;
  const guestName = (name || '').trim() || 'Guest';
  const cleanPasscode = String(passcode || '').trim();

  let pin_hash = null;
  if (cleanPasscode) {
    pin_hash = await sha256(cleanPasscode);
  }

  const cloudRes = await registerOrVerifyGuestInCloud(cleanSlug, guestName, pin_hash);
  if (!cloudRes || cloudRes.success === false) {
    const err = new Error(cloudRes?.error || 'Failed to join event');
    err.needsPin = Boolean(cloudRes?.needsPin);
    throw err;
  }

  const token = cloudRes.token;
  const guestRecord = cloudRes.guest;

  localStorage.setItem(`luminafeed_guest_${cleanSlug}`, token);
  localStorage.setItem(`caps_guest_${cleanSlug}`, token);
  localStorage.setItem(`luminafeed_guest_name_${cleanSlug}`, guestName);

  const eventLimit = Number(event.max_photos) || 100;
  const limit = Math.min(Number(event.guest_upload_limit) || 15, eventLimit);
  const used = Number(guestRecord.upload_count) || 0;
  const guestRemaining = Math.max(0, limit - used);

  return {
    success: true,
    guest: guestRecord,
    isReturning: Boolean(cloudRes.isReturning),
    event: {
      ...event,
      max_photos: eventLimit
    },
    quota: {
      used,
      limit,
      remaining: guestRemaining,
      event_total: 0,
      event_limit: eventLimit,
      event_remaining: eventLimit
    }
  };
}

/**
 * Get guest session from Supabase Database
 */
export async function getGuestSession(slug, guestToken) {
  const event = await validateAndFetchEvent(slug);
  const cleanSlug = event.slug || slug;

  if (!guestToken) {
    return { success: false, error: 'No guest token provided' };
  }

  let guest = null;
  let eventTotalPhotos = 0;

  if (isStorageConfigured()) {
    try {
      const client = getSupabaseClient();
      const [guestRes, photosRes] = await Promise.all([
        client.from('guests').select('*').eq('event_slug', cleanSlug).eq('token', guestToken).maybeSingle(),
        client.from('photos').select('id, guest_token').eq('event_slug', cleanSlug)
      ]);

      guest = guestRes.data;
      const allPhotos = photosRes.data || [];
      eventTotalPhotos = allPhotos.length;

      if (guest) {
        const realCount = allPhotos.filter(p => p.guest_token === guestToken).length;
        if (guest.upload_count !== realCount) {
          await client.from('guests').update({ upload_count: realCount, last_seen: new Date().toISOString() }).eq('id', guest.id);
          guest.upload_count = realCount;
        }
      }
    } catch (_) {}
  }

  if (!guest) {
    return { success: false, error: 'Guest session expired or not found' };
  }

  const eventLimit = Number(event.max_photos) || 100;
  const limit = Math.min(Number(event.guest_upload_limit) || 20, eventLimit);
  const used = Number(guest.upload_count) || 0;
  const guestRemaining = Math.max(0, limit - used);
  const eventRemaining = Math.max(0, eventLimit - eventTotalPhotos);

  return {
    success: true,
    guest,
    event: {
      ...event,
      max_photos: eventLimit,
      total_photos: eventTotalPhotos
    },
    quota: {
      used,
      limit,
      remaining: Math.min(guestRemaining, eventRemaining),
      event_total: eventTotalPhotos,
      event_limit: eventLimit,
      event_remaining: eventRemaining
    }
  };
}

/**
 * Get guest directory for an event directly from Supabase Database
 */
export async function getGuests(slug) {
  if (!isStorageConfigured() || !slug) return { success: true, guests: [] };
  try {
    const guests = await getCloudGuestsForEvent(String(slug).trim());
    return { success: true, guests: guests || [] };
  } catch (err) {
    console.warn('getGuests error:', err);
    return { success: true, guests: [] };
  }
}

// -----------------------------------------------------------------------------
// 4. PHOTO UPLOADS & MODERATION (Direct Cloud Storage & Supabase DB)
// -----------------------------------------------------------------------------

/**
 * Upload photo directly to Supabase Storage and register in `public.photos` table
 */
export async function uploadPhoto(slug, file, guestToken, options = {}) {
  const event = await validateAndFetchEvent(slug);
  const cleanSlug = event.slug || slug;

  if (event.status === 'archived') throw new Error('Event is archived. Uploads are disabled.');

  const client = getSupabaseClient();
  const hostToken = localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token');
  const isHost = Boolean(hostToken);
  let guest = null;

  if (guestToken && isStorageConfigured()) {
    const { data: g } = await client.from('guests').select('*').eq('event_slug', cleanSlug).eq('token', guestToken).maybeSingle();
    guest = g;
  }

  if (!isHost && !guest) {
    throw new Error('Please enter your name to upload photos');
  }

  // Quota checks
  if (isStorageConfigured()) {
    const { count: photoCount } = await client
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_slug', cleanSlug);

    const eventLimit = Number(event.max_photos) || 100;
    if ((photoCount || 0) >= eventLimit) {
      throw new Error(`Event photo limit reached (${eventLimit} photos maximum).`);
    }

    if (!isHost && guest) {
      const guestLimit = Number(event.guest_upload_limit) || 15;
      if ((guest.upload_count || 0) >= guestLimit) {
        throw new Error(`Upload limit reached (${guestLimit} photos).`);
      }
    }
  }

  // Client-side downscaling and thumbnail generation
  const processed = await processPhotoClient(file, {
    maxDimension: 2048,
    thumbDimension: 360,
    quality: 0.88,
    thumbQuality: 0.75,
    stripExif: event.exif_strip !== false,
    frameConfig: options.frameConfig || null,
    eventTitle: event.name,
    eventDate: event.date,
  });

  const isEncrypted = Boolean(event.is_encrypted || event.e2ee_enabled);
  const eventKey = (event.encryption_key || getStoredEventKey(cleanSlug) || '').trim();

  // Upload original and thumbnail blobs directly to Supabase Storage
  let uploadResult = null;
  if (isStorageConfigured()) {
    uploadResult = await uploadPhotoToStorage({
      eventSlug: cleanSlug,
      originalBlob: processed.blob,
      thumbBlob: processed.thumbBlob,
      filename: processed.filename,
      isEncrypted,
      encryptionKey: eventKey,
      metadata: {
        hash: processed.hash,
        guest_name: isHost ? 'Host' : (guest ? guest.name : 'Guest'),
        guest_token: guestToken || null,
        caption: options.caption || null,
        has_frame: Boolean(options.hasFrame)
      }
    });
  }

  const initialStatus = (!event.moderation_enabled || isHost || event.auto_approve) ? 'approved' : 'pending';
  const now = new Date().toISOString();

  const photoRecord = {
    event_slug: cleanSlug,
    guest_name: isHost ? 'Host' : (guest ? guest.name : 'Guest'),
    guest_token: guest ? guest.token : null,
    caption: options.caption || null,
    has_frame: Boolean(options.hasFrame),
    likes_count: 0,
    filename: processed.filename,
    hash: processed.hash,
    status: initialStatus,
    storage_orig_path: uploadResult?.origPath || `${cleanSlug}/orig_${Date.now()}_${processed.filename}`,
    storage_thumb_path: uploadResult?.thumbPath || `${cleanSlug}/thumb_${Date.now()}_${processed.filename}`,
    is_encrypted: isEncrypted,
    created_at: now
  };

  if (isStorageConfigured()) {
    const cloudPhoto = await syncPhotoToCloud(photoRecord);
    if (cloudPhoto?.id) photoRecord.id = cloudPhoto.id;

    // Increment guest count in DB
    if (guest?.id) {
      guest.upload_count = (guest.upload_count || 0) + 1;
      await client.from('guests').update({ upload_count: guest.upload_count }).eq('id', guest.id);
    }
  }

  const guestLimit = Number(event.guest_upload_limit) || 15;
  const newUsed = Number(guest?.upload_count) || 0;
  const eventLimit = Number(event.max_photos) || 100;

  return {
    success: true,
    quota: {
      used: newUsed,
      limit: guestLimit,
      remaining: Math.max(0, guestLimit - newUsed),
      event_limit: eventLimit
    },
    photo: {
      ...photoRecord,
      original_blob: processed.blob,
      thumb_blob: processed.thumbBlob,
      original_url: uploadResult?.origUrl || '',
      thumb_url: uploadResult?.thumbUrl || uploadResult?.origUrl || '',
      storage_orig_url: uploadResult?.origUrl || '',
      storage_thumb_url: uploadResult?.thumbUrl || uploadResult?.origUrl || ''
    }
  };
}

/**
 * Get photos for an event directly from Supabase Database & Storage
 */
export async function getPhotos(slug, options = {}) {
  const cleanSlug = String(slug).trim();
  if (!isStorageConfigured() || !cleanSlug) return { success: true, photos: [] };

  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();

    let query = client
      .from('photos')
      .select('*')
      .eq('event_slug', cleanSlug)
      .order('created_at', { ascending: false });

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.guest === 'me' && options.guestToken) {
      query = query.eq('guest_token', options.guestToken);
    }

    const { data: dbPhotos, error } = await query;
    if (error || !dbPhotos) {
      return { success: true, photos: [] };
    }

    const photosWithUrls = dbPhotos.map(p => {
      const origUrl = p.storage_orig_path ? client.storage.from(bucket).getPublicUrl(p.storage_orig_path).data.publicUrl : '';
      const thumbUrl = p.storage_thumb_path ? client.storage.from(bucket).getPublicUrl(p.storage_thumb_path).data.publicUrl : origUrl;

      return {
        ...p,
        original_url: origUrl,
        thumb_url: thumbUrl,
        storage_orig_url: origUrl,
        storage_thumb_url: thumbUrl
      };
    });

    return { success: true, photos: photosWithUrls };
  } catch (err) {
    console.warn('getPhotos error:', err);
    return { success: true, photos: [] };
  }
}

/**
 * Ensure photo decryption across E2EE events
 */
export async function ensurePhotoDecrypted(photo, key = '') {
  if (!photo || !photo.is_encrypted) return photo;
  if (photo.decrypted_thumb_url && photo.decrypted_orig_url) return photo;

  try {
    const eventKey = (key || getStoredEventKey(photo.event_slug) || '').trim();
    if (!eventKey) return photo;

    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();

    if (photo.storage_thumb_path && !photo.decrypted_thumb_url) {
      const { data: blob } = await client.storage.from(bucket).download(photo.storage_thumb_path);
      if (blob) {
        const decrypted = await decryptBlob(blob, eventKey);
        photo.decrypted_thumb_url = URL.createObjectURL(decrypted);
        photo.thumb_blob = decrypted;
      }
    }

    return photo;
  } catch (err) {
    return photo;
  }
}

/**
 * Get decrypted original blob for downloading or lightbox
 */
export async function getDecryptedOriginalBlob(photo, key = '') {
  if (!photo) return null;
  const eventKey = (key || getStoredEventKey(photo.event_slug) || '').trim();

  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const targetPath = photo.storage_orig_path || photo.storage_thumb_path;
    if (!targetPath) return null;

    const { data: blob } = await client.storage.from(bucket).download(targetPath);
    if (!blob) return null;

    if (photo.is_encrypted && eventKey) {
      return await decryptBlob(blob, eventKey);
    }
    return blob;
  } catch (_) {
    return null;
  }
}

/**
 * Fast cloud photo sync verification
 */
export async function syncPhotosFromCloud(slug, options = {}) {
  if (!slug) return { success: false, added: 0, total: 0 };
  const cleanSlug = String(slug).trim();

  try {
    await validateAndFetchEvent(cleanSlug);
    const photosRes = await getPhotos(cleanSlug, options);
    return { success: true, added: photosRes.photos.length, total: photosRes.photos.length, photos: photosRes.photos };
  } catch (err) {
    return { success: false, deleted: true, error: err.message };
  }
}

/**
 * Delete individual photo from Supabase Database and Storage
 */
export async function deletePhoto(slug, photoId, guestToken = null) {
  const cleanSlug = String(slug).trim();
  if (!isStorageConfigured() || !photoId) return { success: false };

  try {
    const client = getSupabaseClient();
    
    // Fetch photo paths before deletion
    const { data: photo } = await client
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .maybeSingle();

    if (photo) {
      // Purge from Storage bucket
      await deleteIndividualPhotoFromStorage(photo.storage_orig_path, photo.storage_thumb_path);

      // Delete from Database
      await client.from('photos').delete().eq('id', photoId);

      // Decrement guest upload count
      if (photo.guest_token) {
        const { data: guest } = await client.from('guests').select('id, upload_count').eq('event_slug', cleanSlug).eq('token', photo.guest_token).maybeSingle();
        if (guest) {
          const newCount = Math.max(0, (guest.upload_count || 1) - 1);
          await client.from('guests').update({ upload_count: newCount }).eq('id', guest.id);
          const { data: evt } = await client.from('events').select('guest_upload_limit,max_photos').eq('slug', cleanSlug).maybeSingle();
          const limit = Math.min(Number(evt?.guest_upload_limit) || 15, Number(evt?.max_photos) || 100);
          return {
            success: true,
            quota: { used: newCount, limit, remaining: Math.max(0, limit - newCount) }
          };
        }
      }
    }

    return { success: true, quota: { used: 0, limit: 15, remaining: 15 } };
  } catch (err) {
    console.warn('deletePhoto error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Update photo moderation status in Supabase Database
 */
export async function patchPhotoStatus(slug, photoId, status) {
  if (!isStorageConfigured() || !photoId) return { success: false };
  try {
    const client = getSupabaseClient();
    await client
      .from('photos')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', photoId);

    return { success: true, status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Bulk update photo moderation status in Supabase Database
 */
export async function bulkPatchPhotoStatus(slug, ids = [], status) {
  if (!isStorageConfigured() || !ids.length) return { success: false };
  try {
    const client = getSupabaseClient();
    await client
      .from('photos')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);

    return { success: true, updated_count: ids.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get comprehensive event analytics directly from Supabase Database
 */
export async function getEventAnalytics(slug) {
  const cleanSlug = String(slug).trim();
  if (!isStorageConfigured() || !cleanSlug) {
    return {
      success: true,
      analytics: {
        total_photos: 0,
        approved: 0,
        unique_guests: 0,
        storage_used_mb: '0.00',
        top_contributors: [],
        uploads_over_time: []
      }
    };
  }

  try {
    const client = getSupabaseClient();
    const [photosRes, guestsRes] = await Promise.all([
      client.from('photos').select('*').eq('event_slug', cleanSlug),
      client.from('guests').select('*').eq('event_slug', cleanSlug)
    ]);

    const photos = photosRes.data || [];
    const guests = guestsRes.data || [];

    const approved = photos.filter(p => p.status === 'approved').length;
    const totalBytes = photos.reduce((acc, p) => acc + (p.size || 500 * 1024), 0);
    const storage_used_mb = (totalBytes / (1024 * 1024)).toFixed(2);

    // Contributor breakdown
    const authorCounts = new Map();
    for (const p of photos) {
      const name = p.guest_name || 'Anonymous Guest';
      authorCounts.set(name, (authorCounts.get(name) || 0) + 1);
    }
    const top_contributors = Array.from(authorCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Timeline breakdown
    const hourlyCounts = new Map();
    for (const p of photos) {
      const hour = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
      hourlyCounts.set(hour, (hourlyCounts.get(hour) || 0) + 1);
    }
    const uploads_over_time = Array.from(hourlyCounts.entries()).map(([hour, count]) => ({ hour, count }));

    return {
      success: true,
      analytics: {
        total_photos: photos.length,
        approved,
        unique_guests: Math.max(guests.length, authorCounts.size),
        storage_used_mb,
        top_contributors,
        uploads_over_time
      }
    };
  } catch (err) {
    return {
      success: true,
      analytics: {
        total_photos: 0,
        approved: 0,
        unique_guests: 0,
        storage_used_mb: '0.00',
        top_contributors: [],
        uploads_over_time: []
      }
    };
  }
}

// -----------------------------------------------------------------------------
// 5. LOCAL SESSION UTILITIES & COMPATIBILITY LAYER
// -----------------------------------------------------------------------------

export async function saveLocalGuestSession(slug, name, token) {
  if (!slug) return;
  localStorage.setItem(`luminafeed_guest_${slug}`, token);
}

export async function getLocalGuestSession(slug) {
  if (!slug) return null;
  const token = localStorage.getItem(`luminafeed_guest_${slug}`);
  if (!token) return null;
  return { slug, token };
}

export async function clearLocalGuestSession(slug) {
  if (!slug) return;
  localStorage.removeItem(`luminafeed_guest_${slug}`);
}

/**
 * Pure Cloud `db` Compatibility Adapter (Replaces Dexie.js)
 */
export const db = {
  getCachedObjectURL,
  ensurePhotoDecrypted,
  getDecryptedOriginalBlob,
  settings: {
    get: async () => {
      const host_name = localStorage.getItem('luminafeed_host_name') || '';
      const session_token = localStorage.getItem('luminafeed_host_token') || '';
      return host_name ? { id: 1, host_name, session_token } : null;
    },
    clear: async () => {
      localStorage.removeItem('luminafeed_host_token');
      localStorage.removeItem('luminafeed_host_name');
    },
    update: async () => {},
    put: async () => {}
  },
  events: {
    where: (field) => ({
      equals: (val) => ({
        first: async () => {
          try {
            const res = await validateAndFetchEvent(val);
            return res;
          } catch (_) {
            return null;
          }
        },
        delete: async () => {
          if (field === 'slug') await deleteEvent(val);
        },
        modify: async (patch) => {
          if (field === 'slug') await updateEvent(val, patch);
        }
      })
    }),
    toArray: async () => {
      const res = await getEvents();
      return res.events || [];
    },
    put: async (ev) => ev,
    delete: async () => {}
  },
  photos: {
    add: async (photo) => {
      if (!photo) return null;
      if (isStorageConfigured()) {
        try {
          const client = getSupabaseClient();
          const { data } = await safeSupabaseUpsert(client, 'photos', photo);
          if (data && data[0]?.id) return data[0].id;
        } catch (_) {}
      }
      return photo.id || generateSecureToken('photo');
    },
    get: async (id) => {
      if (!isStorageConfigured() || !id) return null;
      try {
        const client = getSupabaseClient();
        const { data } = await client.from('photos').select('*').eq('id', id).maybeSingle();
        return data;
      } catch (_) {
        return null;
      }
    },
    update: async (id, patch) => {
      if (!isStorageConfigured() || !id) return;
      try {
        const client = getSupabaseClient();
        await client.from('photos').update(patch).eq('id', id);
      } catch (_) {}
    },
    delete: async (id) => {
      if (!isStorageConfigured() || !id) return;
      try {
        const client = getSupabaseClient();
        await client.from('photos').delete().eq('id', id);
      } catch (_) {}
    },
    where: (field) => ({
      equals: (val) => ({
        first: async () => {
          if (!isStorageConfigured() || !val) return null;
          try {
            const client = getSupabaseClient();
            const { data } = await client.from('photos').select('*').eq(field, val).maybeSingle();
            return data;
          } catch (_) {
            return null;
          }
        },
        toArray: async () => {
          if (field === 'event_slug') {
            const res = await getPhotos(val);
            return res.photos || [];
          }
          if (isStorageConfigured()) {
            try {
              const client = getSupabaseClient();
              const { data } = await client.from('photos').select('*').eq(field, val);
              return data || [];
            } catch (_) {}
          }
          return [];
        },
        delete: async () => {
          if (!isStorageConfigured()) return;
          try {
            const client = getSupabaseClient();
            await client.from('photos').delete().eq(field, val);
          } catch (_) {}
        },
        modify: async (patch) => {
          if (!isStorageConfigured()) return;
          try {
            const client = getSupabaseClient();
            await client.from('photos').update(patch).eq(field, val);
          } catch (_) {}
        }
      })
    }),
    toArray: async () => []
  },
  guests: {
    add: async (guest) => {
      if (!guest) return null;
      if (isStorageConfigured()) {
        try {
          const client = getSupabaseClient();
          const { data } = await safeSupabaseUpsert(client, 'guests', guest);
          if (data && data[0]?.id) return data[0].id;
        } catch (_) {}
      }
      return guest.id || generateSecureToken('guest');
    },
    update: async (id, patch) => {
      if (!isStorageConfigured() || !id) return;
      try {
        const client = getSupabaseClient();
        await client.from('guests').update(patch).eq('id', id);
      } catch (_) {}
    },
    where: (field) => ({
      equals: (val) => ({
        first: async () => {
          if (!isStorageConfigured() || !val) return null;
          try {
            const client = getSupabaseClient();
            const { data } = await client.from('guests').select('*').eq(field, val).maybeSingle();
            return data;
          } catch (_) {
            return null;
          }
        },
        toArray: async () => {
          if (field === 'event_slug') {
            const res = await getGuests(val);
            return res.guests || [];
          }
          if (isStorageConfigured()) {
            try {
              const client = getSupabaseClient();
              const { data } = await client.from('guests').select('*').eq(field, val);
              return data || [];
            } catch (_) {}
          }
          return [];
        },
        delete: async () => {
          if (!isStorageConfigured()) return;
          try {
            const client = getSupabaseClient();
            await client.from('guests').delete().eq(field, val);
          } catch (_) {}
        },
        modify: async (patch) => {
          if (!isStorageConfigured()) return;
          try {
            const client = getSupabaseClient();
            await client.from('guests').update(patch).eq(field, val);
          } catch (_) {}
        }
      })
    })
  },
  sync_logs: {
    where: () => ({
      delete: async () => {}
    })
  },
  transaction: async (mode, tables, fn) => {
    return await fn();
  }
};
