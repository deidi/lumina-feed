import Dexie from 'dexie';
import QRCode from 'qrcode';
import { processPhotoClient } from './photo-engine.js';
import {
  generateEventKey,
  wrapEventKeyForAdmin,
  getStoredEventKey,
  setStoredEventKey,
  decryptBlob,
} from './crypto.js';
import {
  deleteEventFilesFromStorage,
  listEventPhotosFromStorage,
  getApprovedListFromStorage,
  getEventManifestFromStorage,
  syncGuestToCloud,
  getCloudGuestsForEvent,
  syncPhotoToCloud,
  getCloudPhotosForEvent,
  createCloudEvent,
  deleteCloudEvent
} from './storage.js';

export const db = new Dexie('caps_v2_db');

db.version(1).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at, [event_slug+token]',
  photos: '++id, event_slug, guest_id, guest_name, hash, status, created_at, [event_slug+status], [event_slug+hash]',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});

db.version(2).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at, [event_slug+token]',
  photos: '++id, event_slug, guest_id, guest_name, guest_token, hash, status, created_at, [event_slug+status], [event_slug+hash], [event_slug+guest_token]',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});

db.version(3).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, date, tagline, moderation_enabled, guest_upload_limit, exif_strip, status, is_encrypted, encryption_key, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at, [event_slug+token]',
  photos: '++id, event_slug, guest_id, guest_name, guest_token, hash, status, is_encrypted, created_at, [event_slug+status], [event_slug+hash], [event_slug+guest_token]',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});

db.version(4).stores({
  settings: '++id, host_name, pin_hash',
  events: '++id, slug, name, host_name, date, tagline, moderation_enabled, auto_approve, e2ee_enabled, allow_guest_downloads, frame_url, frame_config, guest_upload_limit, max_photos, status, is_encrypted, encryption_key, created_at',
  guests: '++id, event_slug, name, token, upload_count, created_at, last_seen, [event_slug+token]',
  photos: '++id, event_slug, guest_id, guest_name, guest_token, caption, has_frame, likes_count, hash, status, is_encrypted, created_at, [event_slug+status], [event_slug+hash], [event_slug+guest_token]',
  guest_sessions: '++id, event_slug, name, token, upload_count, last_seen, [event_slug+token]',
  baas_settings: '++id, key, url, anon_key, bucket, is_custom, created_at',
  sync_logs: '++id, event_slug, photo_id, status, error, timestamp'
});


export function blobToBase64(blob) {
  if (!blob) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(';base64,')) return null;
  const parts = dataUrl.split(';base64,');
  const contentType = parts[0].split(':')[1] || 'image/jpeg';
  const raw = window.atob(parts[1] || '');
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return new Blob([uInt8Array], { type: contentType });
}

// Cache for Object URLs to avoid memory leaks and excessive URL creation
const objectUrlCache = new Map();

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
 * Compute SHA-256 hash using native browser SubtleCrypto
 */
export async function sha256(text) {
  if (!text) return '';
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate clean URL slug from title
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
 * Generate unique slug if duplicate exists
 */
export async function getUniqueSlug(baseName) {
  let baseSlug = slugify(baseName) || 'event';
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db.events.where('slug').equals(slug).first();
    if (!existing) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

/**
 * Get host setup and authentication status
 */
export async function getAuthStatus() {
  const setting = await db.settings.get(1);
  if (!setting || !setting.pin_hash) {
    return {
      initialized: false,
      is_authenticated: false,
      host_name: ''
    };
  }

  const sessionToken = localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token');
  const isAuthenticated = Boolean(sessionToken && sessionToken === setting.session_token);

  return {
    initialized: true,
    is_authenticated: isAuthenticated,
    host_name: setting.host_name || 'Host'
  };
}

/**
 * Setup host credentials (first run)
 */
export async function setupHost(host_name, pin) {
  const pin_hash = await sha256(pin);
  const session_token = 'host_token_' + Math.random().toString(36).substring(2) + Date.now();

  const existing = await db.settings.get(1);
  if (existing) {
    await db.settings.update(1, {
      host_name: host_name.trim(),
      pin_hash,
      session_token
    });
  } else {
    await db.settings.put({
      id: 1,
      host_name: host_name.trim(),
      pin_hash,
      session_token
    });
  }

  localStorage.setItem('luminafeed_host_token', session_token);
  localStorage.setItem('caps_host_token', session_token);
  return { success: true, host_name, token: session_token };
}

/**
 * Update Host Name / Role and Admin PIN
 */
export async function updateHostProfile({ host_name, current_pin, new_pin }) {
  const setting = await db.settings.get(1);
  if (!setting) throw new Error('Host not initialized');

  if (current_pin) {
    const currentHash = await sha256(current_pin);
    if (currentHash !== setting.pin_hash) {
      throw new Error('Current Admin PIN is incorrect');
    }
  }

  const updates = {};
  if (host_name && host_name.trim()) {
    updates.host_name = host_name.trim();
  }
  if (new_pin && new_pin.trim()) {
    updates.pin_hash = await sha256(new_pin.trim());
  }

  await db.settings.update(1, updates);
  const updated = await db.settings.get(1);
  return {
    success: true,
    host_name: updated.host_name
  };
}

/**
 * Verify host PIN
 */
export async function verifyPin(pin) {
  const setting = await db.settings.get(1);
  if (!setting) {
    throw new Error('Host is not configured yet');
  }

  const inputHash = await sha256(pin);
  if (inputHash !== setting.pin_hash) {
    throw new Error('Invalid PIN');
  }

  const session_token = 'host_token_' + Math.random().toString(36).substring(2) + Date.now();
  await db.settings.update(1, { session_token });
  localStorage.setItem('luminafeed_host_token', session_token);
  localStorage.setItem('caps_host_token', session_token);

  return { success: true, token: session_token, host_name: setting.host_name };
}

/**
 * Get all events with summary stats
 */
export async function getEvents(hostName = '') {
  let events = await db.events.orderBy('created_at').reverse().toArray();

  if (hostName) {
    const cleanHost = hostName.trim().toLowerCase();
    events = events.filter(e => !e.host_name || e.host_name.trim().toLowerCase() === cleanHost);
  }

  const eventsWithStats = await Promise.all(events.map(async (e) => {
    const allPhotos = await db.photos.where('event_slug').equals(e.slug).toArray();
    const approved_photos = allPhotos.filter(p => p.status === 'approved').length;
    const pending_photos = allPhotos.filter(p => p.status === 'pending').length;
    
    // Reconcile guest count across local guests and photo authors
    const localGuests = await db.guests.where('event_slug').equals(e.slug).toArray();
    const guestNamesSet = new Set(allPhotos.map(p => (p.guest_name || '').trim().toLowerCase()).filter(Boolean));
    localGuests.forEach(g => { if (g.name) guestNamesSet.add(g.name.trim().toLowerCase()); });
    const total_guests = Math.max(localGuests.length, guestNamesSet.size);

    return {
      ...e,
      max_photos: Number(e.max_photos) || 100,
      total_photos: allPhotos.length,
      approved_photos,
      pending_photos,
      total_guests
    };
  }));

  return { success: true, events: eventsWithStats };
}

/**
 * Get single event by slug
 */
export async function getEvent(slug) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    // Attempt to pull authoritative event manifest from Supabase Cloud Storage
    let manifest = null;
    try {
      manifest = await getEventManifestFromStorage(slug);
    } catch (_) {}

    const formattedName = manifest?.name || slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');

    const storedKey = getStoredEventKey(slug);
    const newGuestEvent = {
      slug,
      name: formattedName,
      host_name: manifest?.host_name || '',
      date: manifest?.date || new Date().toISOString().split('T')[0],
      tagline: manifest?.tagline || 'Memories Shared in Real-Time',
      moderation_enabled: Boolean(manifest?.moderation_enabled),
      guest_upload_limit: Number(manifest?.guest_upload_limit) || 20,
      max_photos: Number(manifest?.max_photos) || 100,
      is_encrypted: Boolean(manifest?.is_encrypted),
      encryption_key: storedKey || '',
      status: manifest?.status || 'active',
      created_at: manifest?.created_at || new Date().toISOString()
    };
    await db.events.put(newGuestEvent);
    event = newGuestEvent;
  } else if (!event.encryption_key) {
    const storedKey = getStoredEventKey(slug);
    if (storedKey) {
      await db.events.update(event.id, { encryption_key: storedKey, is_encrypted: true });
      event.encryption_key = storedKey;
      event.is_encrypted = true;
    }
  }

  const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const approved_photos = allPhotos.filter(p => p.status === 'approved').length;
  const pending_photos = allPhotos.filter(p => p.status === 'pending').length;

  // Reconcile guest count across local guests and photo authors
  const localGuests = await db.guests.where('event_slug').equals(slug).toArray();
  const guestNamesSet = new Set(allPhotos.map(p => (p.guest_name || '').trim().toLowerCase()).filter(Boolean));
  localGuests.forEach(g => { if (g.name) guestNamesSet.add(g.name.trim().toLowerCase()); });
  const total_guests = Math.max(localGuests.length, guestNamesSet.size);

  const max_photos = Number(event.max_photos) || 100;

  return {
    success: true,
    event: {
      ...event,
      max_photos,
      total_photos: allPhotos.length,
      approved_photos,
      pending_photos,
      total_guests
    }
  };
}

/**
 * Create a new event (limited to 10 events per host space, 100 photos maximum each)
 */
export async function createEvent(data, hostName = '') {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Event name is required');

  const resolvedHost = (hostName || data.host_name || '').trim();
  const cleanHost = resolvedHost.toLowerCase();

  // Enforce 5-event quota per host space (Free Tier Protection)
  const currentEvents = await db.events.toArray();
  const hostEvents = cleanHost 
    ? currentEvents.filter(e => !e.host_name || e.host_name.trim().toLowerCase() === cleanHost)
    : currentEvents;

  if (hostEvents.length >= 5) {
    throw new Error('Maximum limit of 5 concurrent events reached. Please delete an existing event before creating a new one.');
  }

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
    host_name: resolvedHost || 'Host',
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

  const id = await db.events.add(eventRecord);
  createCloudEvent(eventRecord, resolvedHost || 'Host').catch(() => {});
  return { success: true, event: { id, ...eventRecord } };
}

/**
 * Update event settings (e.g. upload limit, moderation, frame config, tagline)
 */
export async function updateEvent(slug, updates = {}) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const patch = {};
  if (updates.name !== undefined) patch.name = updates.name.trim();
  if (updates.tagline !== undefined) patch.tagline = updates.tagline.trim();
  if (updates.guest_upload_limit !== undefined) {
    patch.guest_upload_limit = Math.min(100, Math.max(1, Number(updates.guest_upload_limit) || 15));
  }
  if (updates.moderation_enabled !== undefined) patch.moderation_enabled = Boolean(updates.moderation_enabled);
  if (updates.auto_approve !== undefined) patch.auto_approve = Boolean(updates.auto_approve);
  if (updates.e2ee_enabled !== undefined) patch.e2ee_enabled = Boolean(updates.e2ee_enabled);
  if (updates.allow_guest_downloads !== undefined) patch.allow_guest_downloads = Boolean(updates.allow_guest_downloads);
  if (updates.frame_url !== undefined) patch.frame_url = updates.frame_url;
  if (updates.frame_config !== undefined) patch.frame_config = updates.frame_config;
  if (updates.exif_strip !== undefined) patch.exif_strip = Boolean(updates.exif_strip);
  patch.max_photos = 100;

  await db.events.update(event.id, patch);
  const updated = await db.events.get(event.id);
  createCloudEvent(updated, updated.host_name).catch(() => {});
  return { success: true, event: updated };
}

/**
 * Update event status (e.g. active, archived)
 */
export async function updateEventStatus(slug, status) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  await db.events.where('slug').equals(slug).modify({ status });
  const updated = await db.events.where('slug').equals(slug).first();
  return { 
    success: true, 
    status, 
    event: updated,
    message: status === 'archived' ? 'Event closed and archived. Guest uploads are now disabled.' : 'Event reopened! Guest uploads are now active.'
  };
}

/**
 * Delete an event, its associated photos/guests, and all files from Supabase Storage
 */
export async function deleteEvent(slug) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    deleteCloudEvent(slug).catch(() => {});
    return { success: true, supabaseDeleted: 0 };
  }

  // Collect any Supabase storage paths before deleting photos from IndexedDB
  const photos = await db.photos.where('event_slug').equals(slug).toArray();
  const storagePaths = photos
    .flatMap(p => [p.storage_orig_path, p.storage_thumb_path])
    .filter(Boolean);

  // Delete files from Supabase Storage
  let storageResult = null;
  try {
    storageResult = await deleteEventFilesFromStorage(slug, storagePaths);
  } catch (storageErr) {
    console.warn('Error deleting event files from Supabase:', storageErr);
  }

  await db.transaction('rw', [db.events, db.photos, db.guests, db.sync_logs], async () => {
    await db.events.where('slug').equals(slug).delete();
    await db.photos.where('event_slug').equals(slug).delete();
    await db.guests.where('event_slug').equals(slug).delete();
    await db.sync_logs.where('event_slug').equals(slug).delete();
  });

  deleteCloudEvent(slug).catch(() => {});

  return { success: true, supabaseDeleted: storageResult?.deletedCount || 0 };
}

/**
 * Generate QR code data URL for guest joining
 */
export async function getEventQR(slug) {
  const origin = window.location.origin;
  const path = window.location.pathname;
  const basePath = path.endsWith('.html')
    ? path.substring(0, path.lastIndexOf('/'))
    : path.replace(/\/$/, '');

  const event = await db.events.where('slug').equals(slug).first();
  const eventKey = event?.encryption_key || getStoredEventKey(slug);
  const keyParam = eventKey ? `?k=${encodeURIComponent(eventKey)}` : '';

  const join_url = `${origin}${basePath}/#/event/${slug}${keyParam}`;
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
    host_type: 'web'
  };
}

/**
 * Guest join event
 */
export async function joinEvent(slug, name) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    const formattedName = slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');

    const storedKey = getStoredEventKey(slug);
    event = {
      slug,
      name: formattedName,
      date: new Date().toISOString().split('T')[0],
      tagline: 'Memories Shared in Real-Time',
      moderation_enabled: true,
      guest_upload_limit: 20,
      max_photos: 100,
      is_encrypted: Boolean(storedKey),
      encryption_key: storedKey || '',
      status: 'active',
      created_at: new Date().toISOString()
    };
    await db.events.put(event);
  } else if (!event.encryption_key) {
    const storedKey = getStoredEventKey(slug);
    if (storedKey) {
      await db.events.update(event.id, { encryption_key: storedKey, is_encrypted: true });
      event.encryption_key = storedKey;
      event.is_encrypted = true;
    }
  }

  const guestName = (name || '').trim() || 'Guest';
  
  // Check if this guest already exists for this event on this device
  const existingGuests = await db.guests.where('event_slug').equals(slug).toArray();
  const existingGuest = existingGuests.find(g => g.name.toLowerCase() === guestName.toLowerCase());

  let guestRecord;
  let token;

  // Calculate real photo count from IndexedDB
  const allEventPhotos = await db.photos.where('event_slug').equals(slug).toArray();

  if (existingGuest) {
    const realUploadCount = allEventPhotos.filter(
      p => p.guest_id === existingGuest.id || p.guest_name.toLowerCase() === guestName.toLowerCase()
    ).length;

    await db.guests.update(existingGuest.id, { upload_count: realUploadCount });
    existingGuest.upload_count = realUploadCount;
    token = existingGuest.token;
    guestRecord = existingGuest;
  } else {
    token = 'guest_' + Math.random().toString(36).substring(2) + Date.now();
    const realUploadCount = allEventPhotos.filter(
      p => (p.guest_name || '').toLowerCase() === guestName.toLowerCase()
    ).length;

    guestRecord = {
      event_slug: slug,
      name: guestName,
      token,
      upload_count: realUploadCount,
      created_at: new Date().toISOString()
    };
    const id = await db.guests.add(guestRecord);
    guestRecord.id = id;
  }

  localStorage.setItem(`luminafeed_guest_${slug}`, token);
  localStorage.setItem(`caps_guest_${slug}`, token);
  saveLocalGuestSession(slug, guestRecord.name, token).catch(() => {});
  syncGuestToCloud(slug, guestRecord).catch(() => {});

  const eventLimit = Number(event.max_photos) || 100;
  const limit = Math.min(Number(event.guest_upload_limit) || 15, eventLimit);

  const used = Number(guestRecord.upload_count) || 0;
  const guestRemaining = Math.max(0, limit - used);
  const eventRemaining = Math.max(0, eventLimit - allEventPhotos.length);

  return {
    success: true,
    guest: guestRecord,
    event: {
      ...event,
      max_photos: eventLimit,
      total_photos: allEventPhotos.length
    },
    quota: {
      used,
      limit,
      remaining: Math.min(guestRemaining, eventRemaining),
      event_total: allEventPhotos.length,
      event_limit: eventLimit,
      event_remaining: eventRemaining
    }
  };
}

/**
 * Get guest session
 */
export async function getGuestSession(slug, guestToken) {
  let event = await db.events.where('slug').equals(slug).first();
  if (!event) {
    const formattedName = slug
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');

    event = {
      slug,
      name: formattedName,
      date: new Date().toISOString().split('T')[0],
      tagline: 'Memories Shared in Real-Time',
      moderation_enabled: false,
      guest_upload_limit: 20,
      max_photos: 100,
      status: 'active',
      created_at: new Date().toISOString()
    };
    await db.events.put(event);
  }

  if (!guestToken) {
    return { success: false, error: 'No guest token provided' };
  }

  const guest = await db.guests.where('token').equals(guestToken).first();
  if (!guest) {
    return { success: false, error: 'Guest session expired or not found' };
  }

  // Ensure photo count reflects actual photos in IndexedDB
  const allEventPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const realUploadCount = allEventPhotos.filter(
    p => p.guest_id === guest.id || (p.guest_name && p.guest_name.toLowerCase() === guest.name.toLowerCase())
  ).length;

  if (guest.upload_count !== realUploadCount) {
    await db.guests.update(guest.id, { upload_count: realUploadCount });
    guest.upload_count = realUploadCount;
  }

  const eventLimit = Number(event.max_photos) || 100;
  const limit = Math.min(Number(event.guest_upload_limit) || 20, eventLimit);
  const used = Number(guest.upload_count) || 0;
  const guestRemaining = Math.max(0, limit - used);
  const eventRemaining = Math.max(0, eventLimit - allEventPhotos.length);

  return {
    success: true,
    guest,
    event: {
      ...event,
      max_photos: eventLimit,
      total_photos: allEventPhotos.length
    },
    quota: {
      used,
      limit,
      remaining: Math.min(guestRemaining, eventRemaining),
      event_total: allEventPhotos.length,
      event_limit: eventLimit,
      event_remaining: eventRemaining
    }
  };
}

/**
 * Upload & process photo client-side (enforcing 100 photos limit per event)
 */
export async function uploadPhoto(slug, file, guestToken, options = {}) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');
  if (event.status === 'archived') throw new Error('Event is archived. Uploads are disabled.');

  // Enforce event total capacity (100 pictures maximum per event)
  const allEventPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  const eventLimit = Number(event.max_photos) || 100;
  if (allEventPhotos.length >= eventLimit) {
    throw new Error(`Event photo limit reached (${eventLimit} photos maximum). This event has reached its capacity.`);
  }

  const hostToken = localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token');
  const isHost = Boolean(hostToken);
  let guest = null;

  if (guestToken) {
    guest = await db.guests.where('token').equals(guestToken).first();
  }

  if (!isHost && !guest) {
    throw new Error('Please enter your name to upload photos');
  }

  // Check guest quota
  if (!isHost && guest) {
    const guestLimit = Number(event.guest_upload_limit) || 15;
    if (guest.upload_count >= guestLimit) {
      throw new Error(`Upload limit reached (${guestLimit} photos). Delete earlier photos to free up slots.`);
    }
  }

  // Process photo client-side (resizing, thumbnails, duplicate hash, EXIF stripping, frame compositing)
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

  // Duplicate check
  const existing = await db.photos.where('hash').equals(processed.hash).first();
  if (existing) {
    throw new Error('This photo has already been uploaded to this event.');
  }

  const initialStatus = (!event || !event.moderation_enabled || isHost || event.auto_approve) ? 'approved' : 'pending';
  const now = new Date().toISOString();

  const photoRecord = {
    event_slug: slug,
    guest_id: guest ? guest.id : null,
    guest_name: isHost ? 'Host' : (guest ? guest.name : 'Guest'),
    guest_token: guest ? guest.token : null,
    caption: options.caption || null,
    has_frame: Boolean(options.hasFrame),
    likes_count: 0,
    filename: processed.filename,
    hash: processed.hash,
    status: initialStatus,
    width: processed.width,
    height: processed.height,
    size: processed.size,
    mime_type: processed.mimeType,
    original_blob: processed.originalBlob,
    thumb_blob: processed.thumbBlob,
    created_at: now
  };

  const id = await db.photos.add(photoRecord);


  if (guest) {
    await db.guests.update(guest.id, {
      upload_count: (guest.upload_count || 0) + 1
    });
    guest.upload_count = (guest.upload_count || 0) + 1;
    syncGuestToCloud(slug, guest).catch(() => {});
  }

  const originalUrl = getCachedObjectURL(processed.originalBlob, `orig_${id}`);
  const thumbUrl = getCachedObjectURL(processed.thumbBlob, `thumb_${id}`);

  const eventRemaining = Math.max(0, eventLimit - (allEventPhotos.length + 1));
  const guestRemaining = guest ? Math.max(0, event.guest_upload_limit - guest.upload_count) : 999;

  const quota = guest ? {
    used: guest.upload_count,
    limit: event.guest_upload_limit,
    remaining: Math.min(guestRemaining, eventRemaining),
    event_total: allEventPhotos.length + 1,
    event_limit: eventLimit,
    event_remaining: eventRemaining
  } : {
    used: 0,
    limit: 999,
    remaining: eventRemaining,
    event_total: allEventPhotos.length + 1,
    event_limit: eventLimit,
    event_remaining: eventRemaining
  };

  return {
    success: true,
    photo: {
      id,
      ...photoRecord,
      original_url: originalUrl,
      thumb_url: thumbUrl,
      original_path: originalUrl,
      thumbnail_path: thumbUrl,
      original_blob: undefined,
      thumb_blob: undefined
    },
    processed,
    quota
  };
}

/**
 * Get photos for an event
 */
export async function getPhotos(slug, options = {}) {
  let query = db.photos.where('event_slug').equals(slug);
  let photos = await query.toArray();

  if (options.status) {
    photos = photos.filter(p => p.status === options.status);
  }

  if (options.guest === 'me' && options.guestToken) {
    const guest = await db.guests.where('token').equals(options.guestToken).first();
    if (guest) {
      photos = photos.filter(p => p.guest_id === guest.id || (p.guest_name && p.guest_name.toLowerCase() === guest.name.toLowerCase()));
    }
  }

  photos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const result = photos.map(p => {
    const isEncrypted = Boolean(p.is_encrypted || p.filename?.includes('.enc') || p.storage_thumb_url?.includes('.enc') || p.storage_orig_path?.includes('.enc'));
    const origBlobUrl = p.original_blob ? getCachedObjectURL(p.original_blob, `orig_${p.id}`) : '';
    const thumbBlobUrl = p.thumb_blob ? getCachedObjectURL(p.thumb_blob, `thumb_${p.id}`) : '';

    const origUrl = origBlobUrl || p.storage_orig_url || p.original_url || p.original_path || p.drive_orig_url || '';
    const thumbUrl = thumbBlobUrl || p.storage_thumb_url || p.thumb_url || p.thumbnail_path || p.drive_thumb_url || origUrl;
    return {
      ...p,
      id: p.id,
      event_slug: p.event_slug,
      guest_id: p.guest_id,
      guest_name: p.guest_name,
      filename: p.filename,
      hash: p.hash,
      status: p.status,
      width: p.width,
      height: p.height,
      size: p.size,
      mime_type: p.mime_type,
      is_encrypted: isEncrypted,
      storage_orig_path: p.storage_orig_path || '',
      storage_thumb_path: p.storage_thumb_path || '',
      storage_orig_url: p.storage_orig_url || '',
      storage_thumb_url: p.storage_thumb_url || '',
      drive_orig_id: p.drive_orig_id,
      drive_thumb_id: p.drive_thumb_id,
      drive_orig_url: p.drive_orig_url,
      drive_thumb_url: p.drive_thumb_url,
      created_at: p.created_at,
      original_url: origUrl,
      thumb_url: thumbUrl,
      original_path: origUrl,
      thumbnail_path: thumbUrl,
      decrypted_thumb_url: thumbBlobUrl || '',
      decrypted_orig_url: origBlobUrl || '',
      original_blob: p.original_blob,
      thumb_blob: p.thumb_blob
    };
  });

  return { success: true, photos: result };
}

/**
 * Ensure a photo's micro-thumbnail is decrypted and cached in IndexedDB
 */
export async function ensurePhotoDecrypted(photo, keyString = '') {
  if (!photo) return photo;
  if (photo.thumb_blob) {
    const thumbUrl = getCachedObjectURL(photo.thumb_blob, `thumb_${photo.id}`);
    return { ...photo, thumb_blob: photo.thumb_blob, thumb_url: thumbUrl, decrypted_thumb_url: thumbUrl };
  }

  const thumbSourceUrl = photo.storage_thumb_url || photo.thumb_url;
  if (!thumbSourceUrl) return photo;

  const isEnc = Boolean(photo.is_encrypted || photo.filename?.includes('.enc') || thumbSourceUrl.includes('.enc'));
  if (!isEnc) {
    return photo;
  }

  const key = (keyString || (photo.event_slug && getStoredEventKey(photo.event_slug)) || '').trim();
  if (!key) return photo;

  try {
    const res = await fetch(thumbSourceUrl);
    if (!res.ok) return photo;
    const rawBlob = await res.blob();
    const decryptedBlob = await decryptBlob(rawBlob, key, photo.mime_type || 'image/jpeg');
    const thumbUrl = getCachedObjectURL(decryptedBlob, `thumb_${photo.id}`);

    if (photo.id) {
      await db.photos.update(photo.id, {
        thumb_blob: decryptedBlob
      });
    }

    return {
      ...photo,
      thumb_blob: decryptedBlob,
      thumb_url: thumbUrl,
      decrypted_thumb_url: thumbUrl
    };
  } catch (err) {
    console.warn('ensurePhotoDecrypted failed:', photo.filename, err);
    return photo;
  }
}

/**
 * Get or fetch decrypted full-resolution photo Blob for lightbox, TV mode, and zip export
 */
export async function getDecryptedOriginalBlob(photo, keyString = '') {
  if (!photo) return null;
  if (photo.original_blob) {
    return photo.original_blob;
  }

  const origUrl = photo.storage_orig_url || photo.original_url || photo.original_path;
  if (!origUrl) return null;

  const key = (keyString || (photo.event_slug && getStoredEventKey(photo.event_slug)) || '').trim();

  try {
    const res = await fetch(origUrl);
    if (!res.ok) return null;
    const rawBlob = await res.blob();
    if (key) {
      const decrypted = await decryptBlob(rawBlob, key, photo.mime_type || 'image/jpeg');
      if (photo.id && decrypted) {
        db.photos.update(photo.id, { original_blob: decrypted }).catch(() => {});
      }
      return decrypted;
    }
    return rawBlob;
  } catch (err) {
    console.warn('getDecryptedOriginalBlob failed:', err);
    return null;
  }
}

/**
 * Synchronize photos between Supabase Cloud Storage and local IndexedDB.
 * This guarantees cross-network visibility: photos uploaded from remote devices/networks
 * are discovered, hydrated into IndexedDB, and reconciled with moderation state.
 */
export async function syncPhotosFromCloud(slug, { isHost = false } = {}) {
  if (!slug) return { success: false, added: 0, total: 0 };
  
  try {
    const [cloudPhotos, cloudMetadata] = await Promise.all([
      listEventPhotosFromStorage(slug),
      getCloudPhotosForEvent(slug)
    ]);
    if (!cloudPhotos || !Array.isArray(cloudPhotos)) {
      return { success: false, added: 0, total: 0 };
    }

    let event = await db.events.where('slug').equals(slug).first();
    if (!event) {
      try {
        const manifest = await getEventManifestFromStorage(slug);
        if (manifest) {
          event = manifest;
        }
      } catch (_) {}
    }
    const eventKey = (event?.encryption_key || getStoredEventKey(slug) || '').trim();
    if (event && !event.encryption_key && eventKey && event.id) {
      await db.events.update(event.id, { encryption_key: eventKey, is_encrypted: true }).catch(() => {});
    }
    const isModerated = event ? event.moderation_enabled !== false : false;

    // Fetch list of host-approved paths from cloud manifest (if present)
    let cloudApprovedList = null;
    try {
      cloudApprovedList = await getApprovedListFromStorage(slug);
    } catch (_) {}
    const cloudApprovedSet = new Set(cloudApprovedList || []);
    const metadataByPath = new Map();
    const metadataByFilename = new Map();
    for (const metadata of cloudMetadata) {
      if (metadata.storage_orig_path) metadataByPath.set(metadata.storage_orig_path, metadata);
      if (metadata.filename) metadataByFilename.set(metadata.filename, metadata);
    }

    const localPhotos = await db.photos.where('event_slug').equals(slug).toArray();
    
    // Map local photos by storage path, filename, and hash
    const localMap = new Map();
    for (const p of localPhotos) {
      if (p.storage_orig_path) localMap.set(p.storage_orig_path, p);
      if (p.filename) localMap.set(p.filename, p);
      if (p.hash) localMap.set(p.hash, p);
    }

    const cloudPathSet = new Set(cloudPhotos.map(p => p.storage_orig_path).filter(Boolean));
    const cloudFilenameSet = new Set(cloudPhotos.map(p => p.filename).filter(Boolean));

    let addedCount = 0;
    const decryptQueue = [];

    for (const cp of cloudPhotos) {
      const metadata = metadataByPath.get(cp.storage_orig_path) || metadataByFilename.get(cp.filename);
      const match = localMap.get(cp.storage_orig_path) || localMap.get(cp.filename);
      
      if (match) {
        // Photo exists locally. If URLs were missing, update them.
        const needsUrlUpdate = !match.storage_orig_url || !match.storage_thumb_url;
        // If the cloud explicitly marks this photo approved and locally it was still pending:
        const shouldApproveFromCloud = cloudApprovedSet.has(cp.storage_orig_path) || cloudApprovedSet.has(cp.filename) || metadata?.status === 'approved' || !isModerated;
        const updates = {};
        
        if (needsUrlUpdate) {
          updates.storage_orig_path = cp.storage_orig_path;
          updates.storage_thumb_path = cp.storage_thumb_path;
          updates.storage_orig_url = cp.storage_orig_url;
          updates.storage_thumb_url = cp.storage_thumb_url;
          updates.original_url = match.original_url || cp.storage_orig_url;
          updates.thumb_url = match.thumb_url || cp.storage_thumb_url;
        }
        if (metadata) {
          if (metadata.guest_name && match.guest_name !== metadata.guest_name) updates.guest_name = metadata.guest_name;
          if (metadata.guest_token && match.guest_token !== metadata.guest_token) updates.guest_token = metadata.guest_token;
        }
        if (shouldApproveFromCloud && match.status === 'pending') {
          updates.status = 'approved';
        }
        
        if (Object.keys(updates).length > 0) {
          await db.photos.update(match.id, updates);
        }
        if (!metadata && match.guest_name && match.guest_name !== 'Guest') {
          syncPhotoToCloud({ ...match, ...updates }).catch(() => {});
        }

        // Check if thumbnail needs decryption
        const isEncrypted = Boolean(match.is_encrypted || cp.is_encrypted || cp.filename?.includes('.enc') || cp.storage_orig_path?.includes('.enc'));
        if (isEncrypted && eventKey && !match.thumb_blob) {
          decryptQueue.push(ensurePhotoDecrypted({ ...match, ...updates, event_slug: slug }, eventKey));
        }
      } else {
        // NEW photo from remote device/network!
        // Determine status:
        // 1. If explicitly in cloudApprovedSet or metadata is approved -> 'approved'
        // 2. If auto-approve is active (!isModerated) -> 'approved'
        // 3. Otherwise, pending moderation review -> 'pending'
        let status = 'pending';
        if (
          cloudApprovedSet.has(cp.storage_orig_path) ||
          cloudApprovedSet.has(cp.filename) ||
          metadata?.status === 'approved' ||
          !isModerated
        ) {
          status = 'approved';
        }

        const isEncrypted = Boolean(cp.is_encrypted || cp.filename?.includes('.enc') || cp.storage_orig_path?.includes('.enc'));
        const newPhotoRecord = {
          event_slug: slug,
          guest_id: null,
          guest_name: metadata?.guest_name || 'Guest',
          guest_token: metadata?.guest_token || null,
          filename: cp.filename,
          hash: metadata?.hash || cp.hash || cp.filename,
          status,
          is_encrypted: isEncrypted,
          width: metadata?.width || cp.width || 2048,
          height: metadata?.height || cp.height || 1536,
          size: metadata?.size || cp.size || 0,
          mime_type: metadata?.mime_type || cp.mime_type || 'image/jpeg',
          storage_orig_path: cp.storage_orig_path,
          storage_thumb_path: cp.storage_thumb_path,
          storage_orig_url: cp.storage_orig_url,
          storage_thumb_url: cp.storage_thumb_url,
          original_url: cp.storage_orig_url,
          thumb_url: cp.storage_thumb_url,
          original_path: cp.storage_orig_url,
          thumbnail_path: cp.storage_thumb_url,
          created_at: metadata?.created_at || cp.created_at || new Date().toISOString(),
        };

        const addedId = await db.photos.add(newPhotoRecord);
        addedCount++;

        if (isEncrypted && eventKey && cp.storage_thumb_url) {
          decryptQueue.push(ensurePhotoDecrypted({ id: addedId, ...newPhotoRecord }, eventKey));
        }
      }
    }

    if (decryptQueue.length > 0) {
      try {
        await Promise.allSettled(decryptQueue);
      } catch (_) {}
    }

    // Prune deleted photos:
    // If a photo in local IndexedDB was hosted in Supabase Storage (has storage_orig_path),
    // but is NO LONGER present in cloudPhotos, it was deleted from Supabase Storage -> prune it.
    for (const lp of localPhotos) {
      if (lp.storage_orig_path && !cloudPathSet.has(lp.storage_orig_path) && !cloudFilenameSet.has(lp.filename)) {
        await db.photos.delete(lp.id);
      }
    }

    return { success: true, added: addedCount, total: cloudPhotos.length };
  } catch (err) {
    console.warn('syncPhotosFromCloud error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a photo
 */
export async function deletePhoto(slug, photoId, guestToken) {
  const photo = await db.photos.get(parseInt(photoId, 10));
  if (!photo) throw new Error('Photo not found');

  const event = await db.events.where('slug').equals(slug).first();
  const limit = event ? event.guest_upload_limit : 20;
  let remaining = limit;
  let used = 0;

  if (photo.guest_id) {
    const guest = await db.guests.get(photo.guest_id);
    if (guest) {
      const newCount = Math.max(0, (guest.upload_count || 1) - 1);
      await db.guests.update(guest.id, { upload_count: newCount });
      used = newCount;
      remaining = Math.max(0, limit - newCount);
    }
  }

  await db.photos.delete(photo.id);

  return {
    success: true,
    quota: {
      used,
      limit,
      remaining
    }
  };
}

/**
 * Get event analytics summary
 */
export async function getEventAnalytics(slug) {
  const event = await db.events.where('slug').equals(slug).first();
  if (!event) throw new Error('Event not found');

  const photos = await db.photos.where('event_slug').equals(slug).toArray();
  const guests = await db.guests.where('event_slug').equals(slug).toArray();

  const total_photos = photos.length;
  const approved = photos.filter(p => p.status === 'approved').length;
  const pending = photos.filter(p => p.status === 'pending').length;
  const rejected = photos.filter(p => p.status === 'rejected').length;

  const uniqueGuestsSet = new Set();
  guests.forEach(g => { if (g.name) uniqueGuestsSet.add(g.name.toLowerCase()); });
  photos.forEach(p => { if (p.guest_name) uniqueGuestsSet.add(p.guest_name.toLowerCase()); });
  const unique_guests = Math.max(guests.length, uniqueGuestsSet.size);

  const totalBytes = photos.reduce((acc, p) => acc + (p.size || (p.original_blob ? p.original_blob.size : 0)), 0);
  const storage_used_mb = (totalBytes / (1024 * 1024)).toFixed(2);

  // Top Contributors
  const contributorMap = new Map();
  photos.forEach(p => {
    const name = (p.guest_name || 'Guest').trim();
    contributorMap.set(name, (contributorMap.get(name) || 0) + 1);
  });
  guests.forEach(g => {
    const name = (g.name || 'Guest').trim();
    if (!contributorMap.has(name) && g.upload_count) {
      contributorMap.set(name, g.upload_count);
    }
  });

  const top_contributors = Array.from(contributorMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Uploads by Hour
  const hourlyMap = new Map();
  photos.forEach(p => {
    try {
      const d = new Date(p.created_at || Date.now());
      const hourStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      hourlyMap.set(hourStr, (hourlyMap.get(hourStr) || 0) + 1);
    } catch {
      hourlyMap.set('Recent', (hourlyMap.get('Recent') || 0) + 1);
    }
  });

  const uploads_over_time = Array.from(hourlyMap.entries())
    .map(([hour, count]) => ({ hour, count }));

  return {
    success: true,
    analytics: {
      total_photos,
      approved,
      pending,
      rejected,
      unique_guests,
      storage_used_mb,
      storage_size_bytes: totalBytes,
      top_contributors,
      uploads_over_time
    }
  };
}

/**
 * Retrieve complete guest directory for an event, reconciling local IndexedDB,
 * Supabase Database cloud guests, and photos.
 */
export async function getGuests(slug) {
  const localGuests = await db.guests.where('event_slug').equals(slug).toArray();
  const allPhotos = await db.photos.where('event_slug').equals(slug).toArray();
  
  // Fetch cloud guests if available
  let cloudGuests = [];
  try {
    cloudGuests = await getCloudGuestsForEvent(slug);
  } catch (_) {}

  // Map to consolidate guest records
  const guestMap = new Map();

  // 1. Add cloud guests
  cloudGuests.forEach(cg => {
    const key = cg.token ? `token:${cg.token}` : `name:${(cg.name || 'Guest').trim().toLowerCase()}`;
    guestMap.set(key, {
      name: cg.name,
      token: cg.token,
      upload_count: cg.upload_count || 0,
      created_at: cg.created_at,
      last_seen: cg.last_seen || cg.created_at
    });
  });

  // 2. Merge local guests
  localGuests.forEach(lg => {
    const key = lg.token ? `token:${lg.token}` : `name:${(lg.name || 'Guest').trim().toLowerCase()}`;
    const existing = guestMap.get(key);
    if (!existing) {
      guestMap.set(key, {
        name: lg.name,
        token: lg.token,
        upload_count: lg.upload_count || 0,
        created_at: lg.created_at,
        last_seen: lg.created_at
      });
    } else {
      existing.upload_count = Math.max(existing.upload_count, lg.upload_count || 0);
    }
  });

  // 3. Reconcile with actual photos (crucial when guest uploaded and logged out or from another device)
  allPhotos.forEach(p => {
    const rawName = (p.guest_name || '').trim();
    if (!rawName) return;
    const key = p.guest_token ? `token:${p.guest_token}` : `name:${rawName.toLowerCase()}`;
    const existing = guestMap.get(key);
    if (!existing) {
      guestMap.set(key, {
        name: rawName,
        token: '',
        upload_count: 1,
        created_at: p.created_at || new Date().toISOString(),
        last_seen: p.created_at || new Date().toISOString()
      });
    } else {
      const photoCountForGuest = allPhotos.filter(ph => {
        if (p.guest_token) return ph.guest_token === p.guest_token;
        return !ph.guest_token && (ph.guest_name || '').trim().toLowerCase() === rawName.toLowerCase();
      }).length;
      existing.upload_count = Math.max(existing.upload_count, photoCountForGuest);
      if (p.created_at && (!existing.last_seen || new Date(p.created_at) > new Date(existing.last_seen))) {
        existing.last_seen = p.created_at;
      }
    }
  });

  const guestList = Array.from(guestMap.values()).sort((a, b) => {
    if (b.upload_count !== a.upload_count) return b.upload_count - a.upload_count;
    return new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
  });

  return { success: true, guests: guestList };
}

/**
 * Persist guest session locally in localStorage & Dexie guest_sessions table
 */
export async function saveLocalGuestSession(slug, name, token) {
  if (!slug || !token) return;
  const sessionKey = `guest_session_${slug}`;
  const record = {
    event_slug: slug,
    name: (name || 'Guest').trim(),
    token: token.trim(),
    last_seen: new Date().toISOString()
  };
  localStorage.setItem(sessionKey, JSON.stringify(record));
  try {
    const existing = await db.guest_sessions.where('[event_slug+token]').equals([slug, token]).first();
    if (existing) {
      await db.guest_sessions.update(existing.id, record);
    } else {
      await db.guest_sessions.add(record);
    }
  } catch (_) {}
}

/**
 * Retrieve persisted guest session locally
 */
export async function getLocalGuestSession(slug) {
  if (!slug) return null;
  const sessionKey = `guest_session_${slug}`;
  const raw = localStorage.getItem(sessionKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name && parsed.token) return parsed;
    } catch (_) {}
  }
  try {
    const fromDb = await db.guest_sessions.where('event_slug').equals(slug).last();
    if (fromDb && fromDb.name && fromDb.token) return fromDb;
  } catch (_) {}
  return null;
}

/**
 * Clear local guest session on explicit logout/leave
 */
export async function clearLocalGuestSession(slug) {
  if (!slug) return;
  localStorage.removeItem(`guest_session_${slug}`);
  try {
    await db.guest_sessions.where('event_slug').equals(slug).delete();
  } catch (_) {}
}

