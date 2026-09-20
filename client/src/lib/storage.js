import { createClient } from '@supabase/supabase-js';
import { encryptBlob, decryptBlob, getStoredEventKey, generateSecureToken } from './crypto.js';
import { preFlightUploadCheck, withUploadRetry } from './network.js';

export const DEFAULT_SUPABASE_URL = (
  import.meta.env?.VITE_SUPABASE_URL ||
  'https://zraiiydadpagbxqqezkm.supabase.co'
).trim();

export const DEFAULT_SUPABASE_ANON_KEY = (
  import.meta.env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyYWlpeWRhZHBhZ2J4cXFlemttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDMwNjIsImV4cCI6MjEwNDExOTA2Mn0.QOOParHXXuqSnXmePel6rDyPCt9RLjdxskby-8yBvCg'
).trim();

export const DEFAULT_BUCKET = (
  import.meta.env?.VITE_SUPABASE_BUCKET ||
  'luminafeed-photos'
).trim();

// Quota Limits (Free-Tier Guard)
export const EVENT_MAX_PHOTOS_LIMIT = 100;
export const HOST_MAX_EVENTS_LIMIT = 5;
export const GUEST_MAX_PHOTOS_LIMIT = 15;

let cachedClient = null;
let currentClientKey = '';

/**
 * Retrieve current BaaS configuration (detects custom BYOK vs default environment)
 */
export function getBaaSConfig() {
  const customUrl = localStorage.getItem('luminafeed_custom_supabase_url');
  const customAnonKey = localStorage.getItem('luminafeed_custom_supabase_anon_key');
  const customBucket = localStorage.getItem('luminafeed_custom_supabase_bucket');

  if (customUrl && customAnonKey) {
    return {
      url: customUrl.trim(),
      anonKey: customAnonKey.trim(),
      bucket: (customBucket || DEFAULT_BUCKET).trim(),
      isCustom: true,
    };
  }

  const url = (import.meta.env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const anonKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
  const bucket = (import.meta.env?.VITE_SUPABASE_BUCKET || DEFAULT_BUCKET).trim();
  return { url, anonKey, bucket, isCustom: false };
}

export const getSupabaseConfig = getBaaSConfig;

/**
 * Set custom Supabase / BaaS credentials (BYOK)
 */
export function setCustomBaaSConfig({ url, anonKey, bucket = 'luminafeed-photos' }) {
  if (!url || !anonKey) {
    throw new Error('Project URL and Public Anon Key are required.');
  }
  localStorage.setItem('luminafeed_custom_supabase_url', url.trim());
  localStorage.setItem('luminafeed_custom_supabase_anon_key', anonKey.trim());
  localStorage.setItem('luminafeed_custom_supabase_bucket', (bucket || DEFAULT_BUCKET).trim());
  cachedClient = null;
  currentClientKey = '';
  return getBaaSConfig();
}

/**
 * Reset to default pre-configured Supabase Cloud backend
 */
export function resetToDefaultBaaS() {
  localStorage.removeItem('luminafeed_custom_supabase_url');
  localStorage.removeItem('luminafeed_custom_supabase_anon_key');
  localStorage.removeItem('luminafeed_custom_supabase_bucket');
  cachedClient = null;
  currentClientKey = '';
  return getBaaSConfig();
}

export const resetSupabaseConfig = resetToDefaultBaaS;

export function isStorageConfigured() {
  const { url, anonKey } = getBaaSConfig();
  return Boolean(url && anonKey);
}

/**
 * Get dynamic Supabase client instance
 */
export function getSupabaseClient() {
  const config = getBaaSConfig();
  const configKey = `${config.url}_${config.anonKey}`;
  if (cachedClient && currentClientKey === configKey) {
    return cachedClient;
  }

  if (!config.url || !config.anonKey) {
    throw new Error('Supabase BaaS is not configured. Please set Project URL and Anon Key.');
  }

  cachedClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  currentClientKey = configKey;
  return cachedClient;
}

/**
 * 1-Click SQL Setup Script Generator for BYOK Hosts
 */
export function get1ClickSQLSetupScript() {
  return `-- ==============================================================================
-- LuminaFeed Supabase Setup Script (1-Click Initialization)
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Hosts Table (24-Hour Ephemeral Lifecycle)
create table if not exists public.hosts (
  id uuid primary key default gen_random_uuid(),
  host_name text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 2. Events Table (Ownership, Custom Frames, Quotas & Settings)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  host_name text not null references public.hosts(host_name) on delete cascade,
  tagline text default 'Memories Shared in Real-Time',
  date date default current_date,
  moderation_enabled boolean default true,
  auto_approve boolean default false,
  e2ee_enabled boolean default false,
  allow_guest_downloads boolean default true,
  frame_url text,
  frame_config jsonb default '{"enabled": false, "preset": "none", "text": ""}'::jsonb,
  guest_upload_limit integer default 15,
  max_photos integer default 100,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 3. Guests Table (Cross-Device Session Tokens & Attendance)
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  name text not null,
  token text not null,
  pin_hash text,
  upload_count integer default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint unique_event_guest_token unique(event_slug, token)
);

-- 4. Photos Table (Metadata, Moderation Status, Captions, Likes & Frames)
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  storage_orig_path text not null,
  storage_thumb_path text,
  filename text not null,
  hash text,
  guest_token text,
  guest_name text not null default 'Guest',
  caption text,
  has_frame boolean default false,
  likes_count integer default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  width integer,
  height integer,
  size bigint,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_event_photo_path unique(event_slug, storage_orig_path)
);

-- 5. Migration Alterations (for existing databases)
alter table if exists public.events add column if not exists e2ee_enabled boolean default false;
alter table if exists public.events add column if not exists allow_guest_downloads boolean default true;
alter table if exists public.events add column if not exists frame_url text;
alter table if exists public.events add column if not exists frame_config jsonb default '{"enabled": false, "preset": "none", "text": ""}'::jsonb;
alter table if exists public.guests add column if not exists pin_hash text;
alter table if exists public.photos add column if not exists caption text;
alter table if exists public.photos add column if not exists has_frame boolean default false;
alter table if exists public.photos add column if not exists likes_count integer default 0;
alter table if exists public.events add column if not exists status text not null default 'active';

-- 6. Fast Retrieval Indexes
create index if not exists idx_hosts_name on public.hosts(host_name);
create index if not exists idx_hosts_expires on public.hosts(expires_at);
create index if not exists idx_events_host on public.events(host_name);
create index if not exists idx_events_slug on public.events(slug);
create index if not exists idx_events_expires on public.events(expires_at);
create index if not exists idx_guests_event on public.guests(event_slug);
create index if not exists idx_guests_token on public.guests(token);
create index if not exists idx_photos_event on public.photos(event_slug);
create index if not exists idx_photos_event_status on public.photos(event_slug, status);
create index if not exists idx_photos_guest_token on public.photos(event_slug, guest_token);
create index if not exists idx_photos_path on public.photos(storage_orig_path);

-- 7. Enable Row Level Security (RLS)
alter table public.hosts enable row level security;
alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.photos enable row level security;

-- Row Level Security Policies for Anon Key (Active 24-hour records only)
drop policy if exists "Allow all actions for anon on hosts" on public.hosts;
drop policy if exists "Anon read active hosts" on public.hosts;
drop policy if exists "Anon insert hosts" on public.hosts;
drop policy if exists "Anon update hosts" on public.hosts;
drop policy if exists "Anon delete hosts" on public.hosts;

create policy "Anon read active hosts" on public.hosts
  for select using (expires_at > now());

create policy "Anon insert hosts" on public.hosts
  for insert with check (expires_at > now());

create policy "Anon update hosts" on public.hosts
  for update using (expires_at > now()) with check (expires_at > now());

create policy "Anon delete hosts" on public.hosts
  for delete using (true);

drop policy if exists "Allow all actions for anon on events" on public.events;
drop policy if exists "Anon read active events" on public.events;
drop policy if exists "Anon mutate events" on public.events;

create policy "Anon read active events" on public.events
  for select using (expires_at > now());

create policy "Anon mutate events" on public.events
  for all using (expires_at > now()) with check (expires_at > now());

drop policy if exists "Allow all actions for anon on guests" on public.guests;
drop policy if exists "Anon access guests" on public.guests;

create policy "Anon access guests" on public.guests
  for all using (true) with check (true);

drop policy if exists "Allow all actions for anon on photos" on public.photos;
drop policy if exists "Anon access photos" on public.photos;

create policy "Anon access photos" on public.photos
  for all using (true) with check (true);

-- 8. Storage Bucket Setup (luminafeed-photos) with Quota & MIME Constraints
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'luminafeed-photos',
  'luminafeed-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'application/octet-stream']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/octet-stream'];

-- Storage RLS Policies for Anon Key
drop policy if exists "Public Access for luminafeed-photos" on storage.objects;
create policy "Public Access for luminafeed-photos" on storage.objects
  for all using (bucket_id = 'luminafeed-photos') with check (bucket_id = 'luminafeed-photos');

-- 9. Cleanup Function for Expired Records
create or replace function public.cleanup_expired_luminafeed_records()
returns integer as $$
declare
  deleted_count integer;
begin
  with deleted as (
    delete from public.hosts where expires_at < now() returning id
  )
  select count(*) into deleted_count from deleted;
  delete from public.events where expires_at < now();
  return deleted_count;
end;
$$ language plpgsql security definer;
`;
}

/**
 * Comprehensive Non-Destructive Schema & Storage Health Probe
 */
export async function testBaaSConnection(customConfig = null, timeoutMs = 8000) {
  const config = customConfig || getBaaSConfig();
  if (!config.url || !config.anonKey) {
    return {
      ok: false,
      apiOk: false,
      bucketOk: false,
      tables: { hosts: false, events: false, guests: false, photos: false },
      missingTables: ['hosts', 'events', 'guests', 'photos'],
      message: 'Supabase URL or Public Anon Key is missing.',
    };
  }

  const cleanUrl = config.url.replace(/\/+$/, '');
  const bucket = config.bucket || 'luminafeed-photos';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let apiOk = false;
  let bucketOk = false;
  const tables = { hosts: false, events: false, guests: false, photos: false };

  try {
    const probeClient = createClient(cleanUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Test Storage Bucket Accessibility
    try {
      const { data: listData, error: listErr } = await probeClient.storage.from(bucket).list('', {
        limit: 1,
      });
      if (!listErr) {
        bucketOk = true;
        apiOk = true;
      }
    } catch (_) {}

    // 2. Test PostgreSQL Tables
    const tableKeys = ['hosts', 'events', 'guests', 'photos'];
    await Promise.all(
      tableKeys.map(async tbl => {
        try {
          const { error } = await probeClient.from(tbl).select('id').limit(1);
          if (!error) {
            tables[tbl] = true;
            apiOk = true;
          }
        } catch (_) {}
      })
    );

    const missingTables = tableKeys.filter(t => !tables[t]);
    const allTablesOk = missingTables.length === 0;
    const isFullyReady = apiOk && bucketOk && allTablesOk;

    let message = '🟢 Supabase Backend is ready and all tables are configured!';
    if (!apiOk) {
      message = '❌ Unable to connect to Supabase. Check your Project URL and Anon Key.';
    } else if (!bucketOk && !allTablesOk) {
      message = '⚠️ Connected, but Storage Bucket and SQL tables are missing. Please run the 1-Click SQL Script.';
    } else if (!allTablesOk) {
      message = `⚠️ Missing database tables (${missingTables.join(', ')}). Please run the 1-Click SQL Script.`;
    } else if (!bucketOk) {
      message = `⚠️ Storage bucket "${bucket}" not found or not public.`;
    }

    return {
      ok: isFullyReady,
      apiOk,
      bucketOk,
      tables,
      missingTables,
      message,
    };
  } catch (err) {
    return {
      ok: false,
      apiOk: false,
      bucketOk: false,
      tables,
      missingTables: ['hosts', 'events', 'guests', 'photos'],
      message: err.message || 'Connection failed.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const testStorageConnection = testBaaSConnection;

/**
 * Check if the event has reached its maximum photo quota (100 photos limit)
 */
export async function checkEventPhotoQuota(eventSlug, maxAllowed = EVENT_MAX_PHOTOS_LIMIT) {
  if (!eventSlug || !isStorageConfigured()) return { allowed: true, count: 0, limit: maxAllowed };
  try {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_slug', eventSlug);

    if (!error && count !== null) {
      return {
        allowed: count < maxAllowed,
        count,
        limit: maxAllowed,
        remaining: Math.max(0, maxAllowed - count),
      };
    }

    // Fallback to storage file listing if DB table is unpopulated
    const files = await listEventPhotosFromStorage(eventSlug);
    const photoCount = files.length;
    return {
      allowed: photoCount < maxAllowed,
      count: photoCount,
      limit: maxAllowed,
      remaining: Math.max(0, maxAllowed - photoCount),
    };
  } catch (_) {
    return { allowed: true, count: 0, limit: maxAllowed };
  }
}

/**
 * Check if the host has reached the 5 concurrent active events quota
 */
export async function checkHostEventQuota(hostName, maxAllowed = HOST_MAX_EVENTS_LIMIT) {
  if (!hostName || !isStorageConfigured()) return { allowed: true, count: 0, limit: maxAllowed };
  try {
    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();
    const { count, error } = await client
      .from('events')
      .select('*', { count: 'exact', head: true })
      .ilike('host_name', hostName.trim())
      .gt('expires_at', nowIso);

    if (!error && count !== null) {
      return {
        allowed: count < maxAllowed,
        count,
        limit: maxAllowed,
        remaining: Math.max(0, maxAllowed - count),
      };
    }
    return { allowed: true, count: 0, limit: maxAllowed };
  } catch (_) {
    return { allowed: true, count: 0, limit: maxAllowed };
  }
}

/**
 * Check if a guest has reached their personal upload quota (15 photos limit)
 */
export async function checkGuestUploadQuota(eventSlug, guestToken, maxAllowed = GUEST_MAX_PHOTOS_LIMIT) {
  if (!eventSlug || !guestToken || !isStorageConfigured()) {
    return { allowed: true, count: 0, limit: maxAllowed };
  }
  try {
    const client = getSupabaseClient();
    const { data: guestData, error } = await client
      .from('guests')
      .select('upload_count')
      .eq('event_slug', eventSlug)
      .eq('token', guestToken)
      .maybeSingle();

    if (!error && guestData) {
      const count = Number(guestData.upload_count) || 0;
      return {
        allowed: count < maxAllowed,
        count,
        limit: maxAllowed,
        remaining: Math.max(0, maxAllowed - count),
      };
    }
    return { allowed: true, count: 0, limit: maxAllowed };
  } catch (_) {
    return { allowed: true, count: 0, limit: maxAllowed };
  }
}

/**
 * Custom Host Frame Management (Upload frame PNG overlay)
 */
export async function uploadEventFrame(eventSlug, frameFileOrBlob) {
  if (!eventSlug || !frameFileOrBlob || !isStorageConfigured()) {
    throw new Error('Event slug and frame file are required.');
  }
  const client = getSupabaseClient();
  const { bucket } = getBaaSConfig();
  const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
  const path = `_frames/${safeSlug}/frame.png`;

  const { error } = await client.storage.from(bucket).upload(path, frameFileOrBlob, {
    contentType: 'image/png',
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload custom frame: ${error.message}`);
  }

  const { data: urlData } = client.storage.from(bucket).getPublicUrl(path);
  const frameUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  // Update event record in DB if available
  try {
    await client
      .from('events')
      .update({
        frame_url: frameUrl,
        frame_config: { enabled: true, preset: 'custom' },
      })
      .eq('slug', eventSlug);
  } catch (_) {}

  return { path, frameUrl };
}

/**
 * Delete custom event frame
 */
export async function deleteEventFrame(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const path = `_frames/${safeSlug}/frame.png`;
    await client.storage.from(bucket).remove([path]);

    try {
      await client
        .from('events')
        .update({
          frame_url: null,
          frame_config: { enabled: false, preset: 'none' },
        })
        .eq('slug', eventSlug);
    } catch (_) {}
  } catch (err) {
    console.warn('deleteEventFrame warning:', err);
  }
}

/**
 * Extract storage path from a public CDN URL
 */
function extractStoragePath(urlOrPath, bucket) {
  if (!urlOrPath) return '';
  const bucketPrefix = `/storage/v1/object/public/${bucket}/`;
  const idx = urlOrPath.indexOf(bucketPrefix);
  if (idx !== -1) {
    return decodeURIComponent(urlOrPath.substring(idx + bucketPrefix.length).split('?')[0]);
  }
  return urlOrPath.replace(/^\/+/, '').split('?')[0];
}

/**
 * Upload an original photo + thumbnail directly from phone to Supabase Storage
 */
export async function uploadPhotoToStorage({
  eventSlug,
  fileName,
  filename,
  origBlob,
  originalBlob,
  thumbBlob,
  mimeType = 'image/jpeg',
  encryptionKey = '',
  caption = '',
  hasFrame = false,
  guestName = 'Guest',
  guestToken = '',
}) {
  // Pre-Flight Connectivity Check
  await preFlightUploadCheck(3500);

  // Check Event Quota
  const quotaCheck = await checkEventPhotoQuota(eventSlug);
  if (!quotaCheck.allowed) {
    throw new Error(`Event photo quota reached (maximum ${EVENT_MAX_PHOTOS_LIMIT} photos).`);
  }

  // Check Guest Quota
  if (guestToken) {
    const guestQuota = await checkGuestUploadQuota(eventSlug, guestToken);
    if (!guestQuota.allowed) {
      throw new Error(`Guest upload quota reached (maximum ${GUEST_MAX_PHOTOS_LIMIT} photos per guest).`);
    }
  }

  const client = getSupabaseClient();
  const { bucket } = getBaaSConfig();

  const safeSlug = (eventSlug || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
  const rawFileName = fileName || filename || `photo_${Date.now()}.jpg`;
  const safeName = rawFileName.replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const timestamp = Date.now();
  const rand = generateSecureToken();

  const key = (encryptionKey || getStoredEventKey(eventSlug) || '').trim();
  const isEncrypted = Boolean(key);

  let rawOrigBlob = origBlob || originalBlob;
  let rawThumbBlob = thumbBlob;

  let finalOrigBlob = rawOrigBlob;
  let finalThumbBlob = rawThumbBlob;

  if (isEncrypted && rawOrigBlob) {
    try {
      finalOrigBlob = await encryptBlob(rawOrigBlob, key);
      if (rawThumbBlob) {
        finalThumbBlob = await encryptBlob(rawThumbBlob, key);
      }
    } catch (encErr) {
      console.warn('Client-side photo encryption failed, falling back to unencrypted:', encErr);
      finalOrigBlob = rawOrigBlob;
      finalThumbBlob = rawThumbBlob;
    }
  }

  const extSuffix = isEncrypted ? '.lenc' : '';
  const origPath = `${safeSlug}/orig_${timestamp}_${rand}_${safeName}${extSuffix}`;
  const thumbPath = `${safeSlug}/thumb_${timestamp}_${rand}_${safeName}${extSuffix}`;
  const uploadContentType = isEncrypted ? 'application/octet-stream' : mimeType;

  // Execute upload with strict 15s timeout and automatic retry
  return await withUploadRetry(async () => {
    // 1. Upload original photo
    const { error: origError } = await client.storage.from(bucket).upload(origPath, finalOrigBlob, {
      contentType: uploadContentType,
      upsert: true,
    });

    if (origError) {
      throw new Error(`Original photo upload failed: ${origError.message}`);
    }

    // 2. Upload micro-thumbnail
    const { error: thumbError } = await client.storage.from(bucket).upload(thumbPath, finalThumbBlob, {
      contentType: uploadContentType,
      upsert: true,
    });

    if (thumbError) {
      console.warn(`Thumbnail upload warning: ${thumbError.message}`);
    }

    // 3. Get Public CDN URLs
    const { data: origUrlData } = client.storage.from(bucket).getPublicUrl(origPath);
    const { data: thumbUrlData } = client.storage.from(bucket).getPublicUrl(thumbPath);

    const origUrl = origUrlData?.publicUrl || '';
    const thumbUrl = thumbUrlData?.publicUrl || origUrl;

    return {
      origPath,
      thumbPath,
      origUrl,
      thumbUrl,
      bucket,
      isEncrypted,
      caption,
      hasFrame,
      guestName,
      guestToken,
    };
  }, 2, 15000);
}


/**
 * Fetch and optionally decrypt a photo from Supabase Storage
 */
export async function fetchAndDecryptPhoto(urlOrPath, encryptionKey = '') {
  if (!urlOrPath) return null;
  const client = getSupabaseClient();
  const { bucket } = getBaaSConfig();
  let blob = null;

  try {
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const res = await fetch(urlOrPath);
      if (res.ok) {
        blob = await res.blob();
      }
    } else {
      const storagePath = extractStoragePath(urlOrPath, bucket);
      const { data, error } = await client.storage.from(bucket).download(storagePath);
      if (!error && data) {
        blob = data;
      }
    }
  } catch (err) {
    console.warn('fetchAndDecryptPhoto fetch failed:', err);
    return null;
  }

  if (!blob) return null;

  if (encryptionKey) {
    try {
      return await decryptBlob(blob, encryptionKey);
    } catch (decErr) {
      console.warn('Decryption failed, returning raw blob:', decErr);
      return blob;
    }
  }

  return blob;
}

/**
 * Delete a single photo from Supabase Storage and database
 */
export async function deleteIndividualPhotoFromStorage(origPathOrUrl, thumbPathOrUrl) {
  if (!isStorageConfigured()) return { success: false, error: 'Storage not configured' };
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const paths = [];

    if (origPathOrUrl) {
      const p = extractStoragePath(origPathOrUrl, bucket);
      if (p) paths.push(p);
    }
    if (thumbPathOrUrl) {
      const p = extractStoragePath(thumbPathOrUrl, bucket);
      if (p) paths.push(p);
    }

    if (paths.length > 0) {
      await client.storage.from(bucket).remove(paths);
      try {
        await client.from('photos').delete().in('storage_orig_path', paths);
      } catch (_) {}
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Permanently purge all photos, thumbnails, frames and manifests for an event
 */
export async function deleteEventFilesFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return { success: false };
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const allPaths = new Set();

    // 1. Collect all photo assets
    try {
      const { data: files } = await client.storage.from(bucket).list(safeSlug, { limit: 500 });
      if (files && files.length > 0) {
        files.forEach(f => {
          if (f && f.name && !f.name.startsWith('.')) {
            allPaths.add(`${safeSlug}/${f.name}`);
          }
        });
      }
    } catch (_) {}

    // 2. Collect frame assets
    try {
      const { data: frameFiles } = await client.storage.from(bucket).list(`_frames/${safeSlug}`, { limit: 10 });
      if (frameFiles && frameFiles.length > 0) {
        frameFiles.forEach(f => {
          if (f && f.name) allPaths.add(`_frames/${safeSlug}/${f.name}`);
        });
      }
    } catch (_) {}

    // 3. Manifests
    allPaths.add(`_events/${safeSlug}.json`);
    allPaths.add(`_events/${safeSlug}_approved.json`);
    allPaths.add(`_events/${eventSlug}.json`);
    allPaths.add(`_events/${eventSlug}_approved.json`);

    const pathsToDelete = Array.from(allPaths);
    if (pathsToDelete.length > 0) {
      await client.storage.from(bucket).remove(pathsToDelete);
    }

    return { success: true, deletedCount: pathsToDelete.length };
  } catch (err) {
    console.warn('deleteEventFilesFromStorage error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * List all photo assets for an event directly from the Supabase Storage bucket
 */
export async function listEventPhotosFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');

    const { data: files, error } = await client.storage.from(bucket).list(safeSlug, {
      limit: 500,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error || !files) {
      return [];
    }

    const validFiles = files.filter(f => f && f.name && !f.name.startsWith('.'));
    const photoFiles = validFiles.filter(f => !f.name.startsWith('thumb_'));

    return photoFiles.map(file => {
      const origPath = `${safeSlug}/${file.name}`;
      const thumbName = file.name.startsWith('orig_')
        ? file.name.replace(/^orig_/, 'thumb_')
        : `thumb_${file.name}`;

      const hasThumb = validFiles.some(f => f.name === thumbName);
      const thumbPath = hasThumb ? `${safeSlug}/${thumbName}` : origPath;

      const { data: origUrlData } = client.storage.from(bucket).getPublicUrl(origPath);
      const { data: thumbUrlData } = client.storage.from(bucket).getPublicUrl(thumbPath);

      const origUrl = origUrlData?.publicUrl || '';
      const thumbUrl = thumbUrlData?.publicUrl || origUrl;
      const isEncrypted = file.name.includes('.enc') || file.name.includes('.lenc');

      return {
        id: `supabase_${origPath}`,
        storage_orig_path: origPath,
        storage_thumb_path: thumbPath,
        storage_orig_url: origUrl,
        storage_thumb_url: thumbUrl,
        original_url: origUrl,
        thumb_url: thumbUrl,
        filename: file.name,
        is_encrypted: isEncrypted,
        created_at: file.created_at || file.updated_at || new Date().toISOString(),
        event_slug: eventSlug,
        status: 'approved',
      };
    });
  } catch (err) {
    console.warn('listEventPhotosFromStorage error:', err);
    return [];
  }
}

/**
 * Sync an event manifest to Supabase Storage
 */
export async function syncEventManifestToStorage(eventData, hostName = 'Host') {
  if (!eventData || !eventData.slug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventData.slug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const manifest = {
      slug: eventData.slug,
      name: eventData.name,
      date: eventData.date || new Date().toISOString().split('T')[0],
      tagline: eventData.tagline || '',
      max_photos: Number(eventData.max_photos) || EVENT_MAX_PHOTOS_LIMIT,
      guest_upload_limit: Number(eventData.guest_upload_limit) || GUEST_MAX_PHOTOS_LIMIT,
      moderation_enabled: eventData.moderation_enabled !== false,
      auto_approve: Boolean(eventData.auto_approve),
      e2ee_enabled: Boolean(eventData.e2ee_enabled),
      allow_guest_downloads: eventData.allow_guest_downloads !== false,
      frame_url: eventData.frame_url || null,
      frame_config: eventData.frame_config || { enabled: false, preset: 'none' },
      is_encrypted: Boolean(eventData.is_encrypted || eventData.e2ee_enabled),
      admin_wrapped_key: eventData.admin_wrapped_key || null,
      status: eventData.status || 'active',
      host_name: hostName || 'Host',
      created_at: eventData.created_at || new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    await client.storage.from(bucket).upload(`_events/${safeSlug}.json`, blob, {
      contentType: 'application/json',
      upsert: true,
    });
  } catch (err) {
    console.warn('syncEventManifestToStorage error:', err);
  }
}

/**
 * Fetch an individual event manifest from Supabase Storage (_events/${slug}.json)
 */
export async function getEventManifestFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const { data: blob, error } = await client.storage.from(bucket).download(`_events/${safeSlug}.json`);
    if (error || !blob) return null;
    const text = await blob.text();
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

/**
 * Save approved photo list to storage manifest
 */
export async function syncApprovedListToStorage(eventSlug, approvedPaths) {
  if (!eventSlug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const payload = {
      slug: eventSlug,
      approved: Array.from(new Set(approvedPaths || [])),
      updated_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    await client.storage.from(bucket).upload(`_events/${safeSlug}_approved.json`, blob, {
      contentType: 'application/json',
      upsert: true,
    });
  } catch (err) {
    console.warn('syncApprovedListToStorage error:', err);
  }
}

/**
 * Fetch approved photo list from storage manifest
 */
export async function getApprovedListFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const { data: blob, error } = await client.storage.from(bucket).download(`_events/${safeSlug}_approved.json`);
    if (error || !blob) return null;
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.approved) ? parsed.approved : null;
  } catch (err) {
    return null;
  }
}

/**
 * Database Layer: Host explicit Sign In against Supabase Database
 */
export async function loginHostInCloud(hostName, pinHash) {
  if (!isStorageConfigured() || !hostName) return { success: false, error: 'Storage is not configured or Host name is missing.' };
  try {
    const client = getSupabaseClient();
    const cleanHost = hostName.trim();

    // Query for host matching both name and pin_hash directly to avoid leaking pin_hash across network
    const { data: existing, error: fetchErr } = await client
      .from('hosts')
      .select('id, host_name, created_at, expires_at')
      .ilike('host_name', cleanHost)
      .eq('pin_hash', pinHash || '')
      .maybeSingle();

    if (fetchErr || !existing) {
      return { success: false, error: 'Invalid Host Name or Admin PIN. Please verify your credentials or register a new profile.' };
    }

    const now = new Date();
    const expiresAt = new Date(existing.expires_at);
    if (expiresAt < now) {
      await client.from('hosts').delete().eq('id', existing.id);
      return { success: false, error: `Host session for "${cleanHost}" has expired (24h lifecycle). Please register a new profile.` };
    }

    return {
      success: true,
      host: existing,
      remainingMs: Math.max(0, expiresAt.getTime() - now.getTime())
    };
  } catch (err) {
    return { success: false, error: err.message || 'Host login failed' };
  }
}

/**
 * Database Layer: Host explicit Registration in Supabase Database
 */
export async function registerHostInCloud(hostName, pinHash) {
  if (!isStorageConfigured() || !hostName) return { success: false, error: 'Storage is not configured or Host name is missing.' };
  try {
    const client = getSupabaseClient();
    const cleanHost = hostName.trim();

    const { data: existing } = await client
      .from('hosts')
      .select('id, host_name, expires_at')
      .ilike('host_name', cleanHost)
      .maybeSingle();

    const now = new Date();

    if (existing) {
      const expiresAt = new Date(existing.expires_at);
      if (expiresAt >= now) {
        return {
          success: false,
          error: `Host Name "${cleanHost}" is already in use. If this is your account, please use the "Sign In" tab with your PIN.`
        };
      }
      // Purge expired host record
      await client.from('hosts').delete().eq('id', existing.id);
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const newRecord = {
      host_name: cleanHost,
      pin_hash: pinHash || '',
      created_at: now.toISOString(),
      expires_at: expiresAt,
    };

    const { data: created, error: insertErr } = await safeSupabaseUpsert(client, 'hosts', newRecord, { onConflict: 'host_name' });

    if (insertErr) {
      return { success: false, error: insertErr.message || 'Failed to create host profile' };
    }

    return {
      success: true,
      host: created ? { id: created.id, host_name: created.host_name, created_at: created.created_at, expires_at: created.expires_at } : { host_name: cleanHost, created_at: now.toISOString(), expires_at: expiresAt },
      isNew: true,
      remainingMs: 24 * 60 * 60 * 1000,
    };
  } catch (err) {
    return { success: false, error: err.message || 'Host registration failed' };
  }
}

/**
 * Database Layer: Host registration & 24h expiration (Backward-compatible wrapper)
 */
export async function registerOrVerifyHostInCloud(hostName, pinHash) {
  const loginRes = await loginHostInCloud(hostName, pinHash);
  if (loginRes && loginRes.success) return loginRes;
  return registerHostInCloud(hostName, pinHash);
}

/**
 * Fetch host details and 24-hour expiration status from Supabase Database (omits pin_hash)
 */
export async function getHostDetailsFromCloud(hostName) {
  if (!isStorageConfigured() || !hostName) return null;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('hosts')
      .select('id, host_name, created_at, expires_at')
      .ilike('host_name', hostName.trim())
      .maybeSingle();

    if (error || !data) return null;

    const expiresAt = new Date(data.expires_at).getTime();
    const now = Date.now();
    const remainingMs = Math.max(0, expiresAt - now);

    return {
      ...data,
      remainingMs,
      isExpired: remainingMs <= 0
    };
  } catch (err) {
    return null;
  }
}

/**
 * Update host profile in Supabase Database (e.g. Host Name / Admin PIN)
 */
export async function updateHostInCloud(oldHostName, updates = {}, currentPinHash = null) {
  if (!isStorageConfigured() || !oldHostName) return { success: false };
  try {
    const client = getSupabaseClient();
    const cleanOld = oldHostName.trim();
    const patch = {};
    if (updates.host_name) patch.host_name = updates.host_name.trim();
    if (updates.pin_hash) patch.pin_hash = updates.pin_hash;

    let query = client
      .from('hosts')
      .update(patch)
      .ilike('host_name', cleanOld);

    if (currentPinHash) {
      query = query.eq('pin_hash', currentPinHash);
    }

    const { data, error } = await query
      .select('id, host_name, created_at, expires_at')
      .maybeSingle();

    if (error) {
      console.warn('updateHostInCloud error:', error);
      return { success: false, error: error.message };
    }
    return { success: true, host: data };
  } catch (err) {
    console.warn('updateHostInCloud exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete host profile from Supabase Database
 */
export async function deleteHostFromCloud(hostName, pinHash = null) {
  if (!isStorageConfigured() || !hostName) return { success: false };
  try {
    const client = getSupabaseClient();
    let query = client
      .from('hosts')
      .delete()
      .ilike('host_name', hostName.trim());

    if (pinHash) {
      query = query.eq('pin_hash', pinHash);
    }

    const { error } = await query;
    return { success: !error };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * List all global events created across all hosts from storage manifests and database
 */
export async function listAllGlobalEventsFromStorage() {
  if (!isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { bucket } = getBaaSConfig();

    let dbEventsMap = null;
    try {
      const { data: dbEvents, error: dbErr } = await client.from('events').select('*');
      if (!dbErr && dbEvents && Array.isArray(dbEvents)) {
        dbEventsMap = new Map(dbEvents.map(e => [e.slug, e]));
      }
    } catch (_) {}

    const manifestsMap = new Map();
    try {
      const { data: manifestList } = await client.storage.from(bucket).list('_events', { limit: 200 });
      if (manifestList && manifestList.length > 0) {
        await Promise.all(
          manifestList
            .filter(f => f && f.name && f.name.endsWith('.json') && !f.name.includes('_approved'))
            .map(async file => {
              try {
                const { data: blob, error } = await client.storage.from(bucket).download(`_events/${file.name}`);
                if (!error && blob) {
                  const text = await blob.text();
                  const parsed = JSON.parse(text);
                  if (parsed && parsed.slug && parsed.status !== 'deleted') {
                    manifestsMap.set(parsed.slug, parsed);
                  }
                }
              } catch (_) {}
            })
        );
      }
    } catch (_) {}

    const { data: rootItems } = await client.storage.from(bucket).list('', { limit: 200 });
    const folderSlugs = (rootItems || [])
      .filter(item => item && item.name && !item.name.startsWith('.') && !item.name.startsWith('_'))
      .map(item => item.name);

    const dbSlugs = dbEventsMap ? Array.from(dbEventsMap.keys()) : [];
    const allSlugs = Array.from(new Set([...manifestsMap.keys(), ...folderSlugs, ...dbSlugs]));

    const results = (
      await Promise.all(
        allSlugs.map(async slug => {
          const manifest = manifestsMap.get(slug) || {};
          const dbEvent = dbEventsMap?.get(slug) || null;
          const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '_');

          let photoCount = 0;
          let thumbCount = 0;
          let totalBytes = 0;
          let latestTimestamp = manifest.created_at || dbEvent?.created_at || null;

          try {
            const { data: files } = await client.storage.from(bucket).list(safeSlug, {
              limit: 500,
              sortBy: { column: 'created_at', order: 'desc' },
            });
            if (files && files.length > 0) {
              const valid = files.filter(f => f && f.name && !f.name.startsWith('.'));
              valid.forEach(f => {
                const size = f.metadata?.size || 0;
                totalBytes += size;
                if (f.name.startsWith('thumb_')) thumbCount++;
                else photoCount++;
                const fileTime = f.created_at || f.updated_at || f.metadata?.lastModified;
                if (fileTime && (!latestTimestamp || new Date(fileTime) > new Date(latestTimestamp))) {
                  latestTimestamp = fileTime;
                }
              });
            }
          } catch (_) {}

          if (photoCount === 0 && thumbCount === 0 && !manifest.slug && !dbEvent) return null;
          if (manifest.status === 'deleted') return null;

          const formattedName = manifest.name || dbEvent?.name || slug
            .split('-')
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ');

          return {
            slug,
            name: formattedName,
            date: manifest.date || dbEvent?.date || (latestTimestamp ? latestTimestamp.split('T')[0] : 'N/A'),
            tagline: manifest.tagline || dbEvent?.tagline || '',
            host_name: manifest.host_name || dbEvent?.host_name || 'Host',
            status: manifest.status || 'active',
            max_photos: manifest.max_photos || dbEvent?.max_photos || 100,
            total_photos: photoCount,
            thumb_count: thumbCount,
            total_bytes: totalBytes,
            storage_mb: (totalBytes / (1024 * 1024)).toFixed(2),
            created_at: manifest.created_at || dbEvent?.created_at || latestTimestamp || new Date().toISOString(),
            last_activity: latestTimestamp || manifest.created_at || dbEvent?.created_at || 'N/A',
            is_encrypted: Boolean(manifest.is_encrypted || dbEvent?.e2ee_enabled),
            has_manifest: Boolean(manifest.slug),
          };
        })
      )
    ).filter(Boolean);

    return results.sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0));
  } catch (err) {
    return [];
  }
}


/**
 * Schema-Adaptive Supabase Upsert Helper
 * Automatically detects missing column errors (PGRST204) from older database schemas,
 * omits the unsupported columns from the payload, and successfully completes the query.
 */
export async function safeSupabaseUpsert(client, table, record, options = {}) {
  let payload = { ...record };
  for (let attempt = 0; attempt < 6; attempt++) {
    const query = client.from(table).upsert(payload, options).select();
    const { data, error } = options.maybeSingle !== false ? await query.maybeSingle() : await query;
    if (!error) {
      return { data, error: null };
    }
    if (error.code === 'PGRST204' || (error.message && error.message.includes("Could not find the '"))) {
      const match = error.message.match(/Could not find the '([^']+)' column/);
      if (match && match[1]) {
        console.warn(`[Supabase Schema Adaptive] Column '${match[1]}' does not exist in table '${table}'. Omit and retry.`);
        delete payload[match[1]];
        continue;
      }
    }
    return { data: null, error };
  }
  return { data: null, error: new Error(`Failed to upsert to ${table} after schema fallbacks`) };
}

/**
 * Schema-Adaptive Supabase Update Helper
 */
export async function safeSupabaseUpdate(client, table, patch, matchFilter = {}) {
  let payload = { ...patch };
  for (let attempt = 0; attempt < 6; attempt++) {
    let query = client.from(table).update(payload);
    for (const [k, v] of Object.entries(matchFilter)) {
      query = query.eq(k, v);
    }
    const { data, error } = await query.select().maybeSingle();
    if (!error) {
      return { data, error: null };
    }
    if (error.code === 'PGRST204' || (error.message && error.message.includes("Could not find the '"))) {
      const match = error.message.match(/Could not find the '([^']+)' column/);
      if (match && match[1]) {
        console.warn(`[Supabase Schema Adaptive] Column '${match[1]}' does not exist in table '${table}'. Omit and retry.`);
        delete payload[match[1]];
        continue;
      }
    }
    return { data: null, error };
  }
  return { data: null, error: new Error(`Failed to update ${table} after schema fallbacks`) };
}

/**
 * Database Layer: Create or sync event with quotas and frame config
 */
export async function createCloudEvent(eventData, hostName) {
  if (!isStorageConfigured() || !eventData?.slug) return null;
  try {
    const client = getSupabaseClient();
    const cleanHost = (hostName || eventData.host_name || 'Host').trim();

    // Check host quota (max 10 active events)
    const hostQuota = await checkHostEventQuota(cleanHost, HOST_MAX_EVENTS_LIMIT);
    if (!hostQuota.allowed) {
      throw new Error(`Host quota reached (maximum ${HOST_MAX_EVENTS_LIMIT} concurrent active events allowed on free tier).`);
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const record = {
      slug: eventData.slug,
      name: eventData.name,
      host_name: cleanHost,
      tagline: eventData.tagline || 'Memories Shared in Real-Time',
      date: eventData.date || new Date().toISOString().split('T')[0],
      moderation_enabled: eventData.moderation_enabled !== false,
      auto_approve: Boolean(eventData.auto_approve),
      e2ee_enabled: Boolean(eventData.e2ee_enabled || eventData.is_encrypted),
      is_encrypted: Boolean(eventData.is_encrypted || eventData.e2ee_enabled),
      encryption_key: eventData.encryption_key || '',
      allow_guest_downloads: eventData.allow_guest_downloads !== false,
      frame_url: eventData.frame_url || null,
      frame_config: eventData.frame_config || { enabled: false, preset: 'none', text: '' },
      guest_upload_limit: Number(eventData.guest_upload_limit) || GUEST_MAX_PHOTOS_LIMIT,
      max_photos: Number(eventData.max_photos) || EVENT_MAX_PHOTOS_LIMIT,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };

    const { data, error } = await safeSupabaseUpsert(client, 'events', record, { onConflict: 'slug' });

    if (error) {
      console.warn('createCloudEvent db error:', error.message);
    }
    return data || record;
  } catch (err) {
    console.warn('createCloudEvent error:', err);
    return null;
  }
}

/**
 * Database Layer: Query active events for a specific host
 */
export async function getCloudEventsForHost(hostName) {
  if (!isStorageConfigured() || !hostName) return null;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('events')
      .select('*')
      .ilike('host_name', hostName.trim())
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) return null;
    return data || [];
  } catch (err) {
    return null;
  }
}

/**
 * Database Layer: Delete event and cascade deletion
 */
export async function deleteCloudEvent(slug) {
  if (!slug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    try { await client.from('photos').delete().eq('event_slug', slug); } catch (_) {}
    try { await client.from('guests').delete().eq('event_slug', slug); } catch (_) {}
    try { await client.from('events').delete().eq('slug', slug); } catch (_) {}
    await deleteEventFilesFromStorage(slug);
  } catch (err) {
    console.warn('deleteCloudEvent db error:', err);
  }
}

/**
 * Database Layer: Register/sync guest session
 */
export async function syncGuestToCloud(eventSlug, guestData) {
  if (!eventSlug || !guestData?.name || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const record = {
      event_slug: eventSlug,
      name: guestData.name.trim(),
      token: guestData.token || `token_${Date.now()}`,
      pin_hash: guestData.pin_hash || null,
      upload_count: Number(guestData.upload_count) || 0,
      created_at: guestData.created_at || new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };

    const { data, error } = await safeSupabaseUpsert(client, 'guests', record, { onConflict: 'event_slug, token' });

    if (error) return null;
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Database Layer: Reconnect returning guest or register new guest with 4-digit passcode protection (Option B)
 */
export async function registerOrVerifyGuestInCloud(eventSlug, guestName, pinHash = null) {
  if (!eventSlug || !guestName || !isStorageConfigured()) {
    const fallbackToken = generateSecureToken('guest');
    return {
      success: true,
      guest: { event_slug: eventSlug, name: guestName, token: fallbackToken, upload_count: 0 },
      token: fallbackToken,
      isReturning: false
    };
  }

  try {
    const client = getSupabaseClient();
    const cleanSlug = eventSlug.trim();
    const cleanName = guestName.trim();

    // Query for existing guest in this event with matching name
    const { data: existing, error: fetchErr } = await client
      .from('guests')
      .select('id, event_slug, name, token, pin_hash, upload_count, created_at, last_seen')
      .eq('event_slug', cleanSlug)
      .ilike('name', cleanName)
      .maybeSingle();

    if (!fetchErr && existing) {
      // If guest has a registered passcode
      if (existing.pin_hash) {
        if (!pinHash) {
          return {
            success: false,
            needsPin: true,
            error: `"${cleanName}" is protected with a 4-digit passcode. Please enter your passcode to reconnect.`
          };
        }
        if (existing.pin_hash !== pinHash) {
          return {
            success: false,
            needsPin: true,
            error: 'Incorrect 4-digit passcode for this guest name. Please check your passcode or choose a different name.'
          };
        }
      } else if (pinHash) {
        // Backfill passcode for previously unprotected guest
        await safeSupabaseUpdate(client, 'guests', { pin_hash: pinHash }, { id: existing.id });
      }

      // Update last seen timestamp
      await safeSupabaseUpdate(client, 'guests', { last_seen: new Date().toISOString() }, { id: existing.id });

      const safeGuest = { ...existing };
      delete safeGuest.pin_hash;

      return {
        success: true,
        guest: safeGuest,
        token: existing.token,
        isReturning: true
      };
    }

    // Register new guest record with cryptographically secure token
    const sessionToken = generateSecureToken('guest');
    const now = new Date().toISOString();
    const newRecord = {
      event_slug: cleanSlug,
      name: cleanName,
      token: sessionToken,
      pin_hash: pinHash || null,
      upload_count: 0,
      created_at: now,
      last_seen: now
    };

    const { data: created, error: insertErr } = await safeSupabaseUpsert(client, 'guests', newRecord, { onConflict: 'event_slug, token' });

    const safeCreated = created ? { ...created } : { ...newRecord };
    delete safeCreated.pin_hash;

    return {
      success: true,
      guest: safeCreated,
      token: sessionToken,
      isReturning: false
    };
  } catch (err) {
    console.warn('registerOrVerifyGuestInCloud error:', err);
    const fallbackToken = generateSecureToken('guest');
    return {
      success: true,
      guest: { event_slug: eventSlug, name: guestName, token: fallbackToken, upload_count: 0 },
      token: fallbackToken,
      isReturning: false
    };
  }
}

/**
 * Database Layer: Fetch registered guests for an event (omits pin_hash)
 */
export async function getCloudGuestsForEvent(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('guests')
      .select('id, event_slug, name, token, upload_count, created_at, last_seen')
      .eq('event_slug', eventSlug)
      .order('last_seen', { ascending: false });

    if (error || !data) return [];
    return data;
  } catch (err) {
    return [];
  }
}

/**
 * Database Layer: Save photo metadata (supports captions, frame tags, likes, status)
 */
export async function syncPhotoToCloud(photoData) {
  if (!photoData?.event_slug || !photoData?.storage_orig_path || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const record = {
      event_slug: photoData.event_slug,
      storage_orig_path: photoData.storage_orig_path,
      storage_thumb_path: photoData.storage_thumb_path || null,
      filename: photoData.filename || photoData.storage_orig_path.split('/').pop(),
      hash: photoData.hash || null,
      guest_token: photoData.guest_token || null,
      guest_name: (photoData.guest_name || 'Guest').trim() || 'Guest',
      caption: photoData.caption || null,
      has_frame: Boolean(photoData.has_frame),
      likes_count: Number(photoData.likes_count) || 0,
      status: photoData.status || 'pending',
      is_encrypted: Boolean(photoData.is_encrypted || photoData.filename?.includes('.enc') || photoData.storage_orig_path?.includes('.enc')),
      width: Number(photoData.width) || null,
      height: Number(photoData.height) || null,
      size: Number(photoData.size) || null,
      mime_type: photoData.mime_type || 'image/jpeg',
      created_at: photoData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await safeSupabaseUpsert(client, 'photos', record, { onConflict: 'event_slug,storage_orig_path' });
    return error ? null : data;
  } catch (_) {
    return null;
  }
}

/**
 * Database Layer: Fetch photos for event
 */
export async function getCloudPhotosForEvent(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('photos')
      .select('*')
      .eq('event_slug', eventSlug)
      .order('created_at', { ascending: false });
    return error || !data ? [] : data;
  } catch (_) {
    return [];
  }
}

/**
 * Automated 24-Hour Ephemeral Lifecycle Cleanup
 */
export async function cleanupExpiredHostsAndEvents() {
  if (!isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data: expiredEvents } = await client
      .from('events')
      .select('slug')
      .lte('expires_at', nowIso);

    if (expiredEvents && expiredEvents.length > 0) {
      for (const ev of expiredEvents) {
        await deleteEventFilesFromStorage(ev.slug);
      }
      await client.from('guests').delete().in('event_slug', expiredEvents.map(e => e.slug));
      await client.from('events').delete().lte('expires_at', nowIso);
    }

    const { data: expiredHosts } = await client
      .from('hosts')
      .select('id, host_name')
      .lte('expires_at', nowIso);

    if (expiredHosts && expiredHosts.length > 0) {
      const expiredNames = expiredHosts.map(h => h.host_name);
      const { data: hostEvents } = await client
        .from('events')
        .select('slug')
        .in('host_name', expiredNames);

      if (hostEvents && hostEvents.length > 0) {
        for (const ev of hostEvents) {
          await deleteEventFilesFromStorage(ev.slug);
        }
      }
      await client.from('hosts').delete().lte('expires_at', nowIso);
    }
  } catch (_) {}
}
