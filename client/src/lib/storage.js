import { createClient } from '@supabase/supabase-js';
import { encryptBlob, decryptBlob, getStoredEventKey } from './crypto.js';

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

let cachedClient = null;

export function getSupabaseConfig() {
  const url = (import.meta.env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const anonKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
  const bucket = (import.meta.env?.VITE_SUPABASE_BUCKET || DEFAULT_BUCKET).trim();
  return { url, anonKey, bucket };
}

export function setSupabaseConfig() {
  // Config is managed exclusively via .env
  cachedClient = null;
}

export function resetSupabaseConfig() {
  localStorage.removeItem('luminafeed_supabase_url');
  localStorage.removeItem('caps_supabase_url');
  localStorage.removeItem('luminafeed_supabase_anon_key');
  localStorage.removeItem('caps_supabase_anon_key');
  localStorage.removeItem('luminafeed_supabase_bucket');
  localStorage.removeItem('caps_supabase_bucket');
  cachedClient = null;
  return getSupabaseConfig();
}

export function isStorageConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase Storage is not configured. Please set your Project URL and Anon Key in Settings.');
  }
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

/**
 * Test connectivity to Supabase with fast, lightweight zero-write verification.
 * 1. Checks reachability of public CDN bucket endpoint (verifies host, TLS, and bucket existence).
 * 2. Queries list endpoint using anon API key (verifies permissions).
 */
export async function testStorageConnection(timeoutMs = 8000) {
  const { url, anonKey, bucket } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase Storage is not configured. Project URL or Anon Key is missing.');
  }

  const cleanUrl = url.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Fast zero-write verification via public CDN endpoint to check bucket existence
    const probePath = `.probe_${Date.now()}`;
    const publicUrl = `${cleanUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${probePath}`;

    try {
      const pubRes = await fetch(publicUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      if (pubRes.ok || pubRes.status === 404) {
        const text = await pubRes.text().catch(() => '');
        if (text.includes('NoSuchBucket') || text.includes('Bucket not found')) {
          throw new Error(`Storage bucket '${bucket}' does not exist or is not public in your Supabase project.`);
        }
      } else if (pubRes.status === 400) {
        const text = await pubRes.text().catch(() => '');
        if (text.includes('NoSuchBucket') || text.includes('Bucket not found')) {
          throw new Error(`Storage bucket '${bucket}' was not found in project ${cleanUrl}.`);
        }
      }
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        throw fetchErr;
      }
      if (fetchErr.message && fetchErr.message.includes('bucket')) {
        throw fetchErr;
      }
      // If public endpoint failed due to network/DNS/offline
      if (fetchErr instanceof TypeError || (fetchErr.message && fetchErr.message.includes('Failed to fetch'))) {
        throw new Error(`Unable to reach Supabase project at ${cleanUrl}. Check your internet connection or project URL.`);
      }
    }

    // 2. Verify Anon Key & bucket read permissions via Supabase Client
    const client = getSupabaseClient();
    const { error: listError } = await client.storage.from(bucket).list('', {
      limit: 1,
      offset: 0,
    });

    if (listError) {
      throw new Error(`Supabase Storage Error: ${listError.message || 'Access denied'}. Check your Anon Key.`);
    }

    return {
      success: true,
      bucket,
      message: `Connected to Supabase Cloud Storage (Bucket: "${bucket}")`
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Connection timed out (${timeoutMs}ms). Supabase project is unreachable or offline.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Upload an original photo + thumbnail directly from phone to Supabase Storage
 */
export async function uploadPhotoToStorage({
  eventSlug,
  fileName,
  origBlob,
  thumbBlob,
  mimeType = 'image/jpeg',
  encryptionKey = '',
}) {
  const client = getSupabaseClient();
  const { bucket } = getSupabaseConfig();

  const safeSlug = (eventSlug || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeName = (fileName || `photo_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);

  const key = (encryptionKey || getStoredEventKey(eventSlug) || '').trim();
  const isEncrypted = Boolean(key);

  let finalOrigBlob = origBlob;
  let finalThumbBlob = thumbBlob;

  if (isEncrypted) {
    try {
      finalOrigBlob = await encryptBlob(origBlob, key);
      finalThumbBlob = await encryptBlob(thumbBlob, key);
    } catch (encErr) {
      console.warn('Client-side photo encryption failed, falling back to unencrypted:', encErr);
      finalOrigBlob = origBlob;
      finalThumbBlob = thumbBlob;
    }
  }

  const extSuffix = isEncrypted ? '.enc' : '';
  const origPath = `${safeSlug}/orig_${timestamp}_${rand}_${safeName}${extSuffix}`;
  const thumbPath = `${safeSlug}/thumb_${timestamp}_${rand}_${safeName}${extSuffix}`;
  const uploadContentType = isEncrypted ? 'application/octet-stream' : mimeType;

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
  };
}

/**
 * Fetch and optionally decrypt a photo from Supabase Storage
 */
export async function fetchAndDecryptPhoto(urlOrPath, encryptionKey = '') {
  if (!urlOrPath) return null;
  const client = getSupabaseClient();
  const { bucket } = getSupabaseConfig();
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
 * Helper to extract Supabase storage object path from a URL or raw path string
 */
export function extractStoragePath(pathOrUrl, bucketName = null) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  const trimmed = pathOrUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return '';

  const bucket = bucketName || getSupabaseConfig().bucket;

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    let p = trimmed.replace(/^\/+/, '');
    if (p.startsWith(bucket + '/')) {
      p = p.substring(bucket.length + 1);
    }
    return p;
  }

  try {
    const urlObj = new URL(trimmed);
    const pathname = urlObj.pathname;

    const marker = `/object/public/${bucket}/`;
    const markerIdx = pathname.indexOf(marker);
    if (markerIdx !== -1) {
      return decodeURIComponent(pathname.substring(markerIdx + marker.length));
    }

    const signMarker = `/object/sign/${bucket}/`;
    const signIdx = pathname.indexOf(signMarker);
    if (signIdx !== -1) {
      return decodeURIComponent(pathname.substring(signIdx + signMarker.length));
    }

    const genericMarker = `/${bucket}/`;
    const genericIdx = pathname.indexOf(genericMarker);
    if (genericIdx !== -1) {
      return decodeURIComponent(pathname.substring(genericIdx + genericMarker.length));
    }
  } catch (e) {
    // Ignore URL parse error and return trimmed string
  }

  return trimmed;
}

/**
 * Delete a photo from Supabase Storage by raw paths or URLs
 */
export async function deletePhotoFromStorage(paths = []) {
  if (!paths || !paths.length) return { success: true, deletedCount: 0 };
  if (!isStorageConfigured()) return { success: true, deletedCount: 0 };

  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const validPaths = paths
      .map(p => extractStoragePath(p, bucket))
      .filter(p => Boolean(p && !p.startsWith('data:') && !p.startsWith('blob:')));

    if (validPaths.length > 0) {
      const { data, error } = await client.storage.from(bucket).remove(validPaths);
      if (error) {
        console.warn('Failed to delete photo from Supabase:', error.message);
        return { success: false, error: error.message };
      }
      return { success: true, deletedCount: validPaths.length, data };
    }
    return { success: true, deletedCount: 0 };
  } catch (err) {
    console.warn('Failed to delete photo from Supabase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete an individual photo's assets (both full-resolution and micro-thumbnail) from Supabase Storage
 */
export async function deleteIndividualPhotoFromStorage(photoOrPaths, eventSlug = '') {
  if (!photoOrPaths) return { success: false, deletedCount: 0, paths: [] };
  if (!isStorageConfigured()) return { success: true, deletedCount: 0, paths: [] };

  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const pathsToPurge = new Set();

    if (Array.isArray(photoOrPaths)) {
      for (const item of photoOrPaths) {
        const extracted = extractStoragePath(item, bucket);
        if (extracted) pathsToPurge.add(extracted);
      }
    } else if (typeof photoOrPaths === 'string') {
      const extracted = extractStoragePath(photoOrPaths, bucket);
      if (extracted) pathsToPurge.add(extracted);
    } else if (typeof photoOrPaths === 'object') {
      const p = photoOrPaths;
      // 1. Direct path fields
      if (p.storage_orig_path) pathsToPurge.add(extractStoragePath(p.storage_orig_path, bucket));
      if (p.storage_thumb_path) pathsToPurge.add(extractStoragePath(p.storage_thumb_path, bucket));
      if (p.origPath) pathsToPurge.add(extractStoragePath(p.origPath, bucket));
      if (p.thumbPath) pathsToPurge.add(extractStoragePath(p.thumbPath, bucket));

      // 2. URL fields
      if (p.original_url) pathsToPurge.add(extractStoragePath(p.original_url, bucket));
      if (p.thumb_url) pathsToPurge.add(extractStoragePath(p.thumb_url, bucket));
      if (p.origUrl) pathsToPurge.add(extractStoragePath(p.origUrl, bucket));
      if (p.thumbUrl) pathsToPurge.add(extractStoragePath(p.thumbUrl, bucket));
      if (p.original_path) pathsToPurge.add(extractStoragePath(p.original_path, bucket));
      if (p.thumbnail_path) pathsToPurge.add(extractStoragePath(p.thumbnail_path, bucket));

      // 3. File name / paired thumbnail derivation
      const slug = eventSlug || p.event_slug || '';
      if (slug && p.filename) {
        if (p.filename.startsWith(`${slug}/`)) {
          pathsToPurge.add(p.filename);
        }
      }

      // Automatically pair original and thumb if only one was present
      for (const path of Array.from(pathsToPurge)) {
        if (path.includes('/orig_')) {
          pathsToPurge.add(path.replace('/orig_', '/thumb_'));
        } else if (path.includes('/thumb_')) {
          pathsToPurge.add(path.replace('/thumb_', '/orig_'));
        }
      }
    }

    const validPaths = Array.from(pathsToPurge).filter(
      p => Boolean(p && typeof p === 'string' && !p.startsWith('data:') && !p.startsWith('blob:'))
    );

    if (validPaths.length === 0) {
      return { success: true, deletedCount: 0, paths: [] };
    }

    const { data, error } = await client.storage.from(bucket).remove(validPaths);
    if (error) {
      console.warn('Failed to delete individual photo from Supabase:', error.message);
      return { success: false, error: error.message, paths: validPaths };
    }

    // Keep the metadata directory in step with Storage. A failed metadata cleanup
    // is harmless: cloud sync only renders records that still have a Storage file.
    const origPath = validPaths.find(path => !path.includes('/thumb_'));
    const metadataEventSlug = eventSlug || (typeof photoOrPaths === 'object' ? photoOrPaths.event_slug : '');
    if (origPath && metadataEventSlug) {
      await client.from('photos').delete().eq('event_slug', metadataEventSlug).eq('storage_orig_path', origPath);
    }

    return { success: true, deletedCount: validPaths.length, paths: validPaths, data };
  } catch (err) {
    console.warn('Error deleting individual photo from Supabase:', err);
    return { success: false, error: err.message, paths: [] };
  }
}

/**
 * Delete all files belonging to an event from Supabase Storage
 */
export async function deleteEventFilesFromStorage(eventSlug, specificPaths = []) {
  if (!eventSlug) return { success: false, deletedCount: 0 };
  if (!isStorageConfigured()) return { success: true, deletedCount: 0 };

  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const allPaths = new Set(specificPaths.filter(Boolean));

    // Query the event's folder in Supabase bucket to include all files
    try {
      const { data: files, error: listError } = await client.storage.from(bucket).list(safeSlug, {
        limit: 1000,
        offset: 0,
      });

      if (!listError && files && files.length > 0) {
        for (const file of files) {
          if (file.name) {
            allPaths.add(`${safeSlug}/${file.name}`);
          }
        }
      }
    } catch (listErr) {
      console.warn('Could not list folder in Supabase:', listErr);
    }

    // Also scan and include event manifests and approved photo registry in _events/
    try {
      const { data: manifestFiles } = await client.storage.from(bucket).list('_events', {
        limit: 200,
      });
      if (manifestFiles && manifestFiles.length > 0) {
        manifestFiles.forEach(f => {
          if (
            f.name &&
            (f.name === `${safeSlug}.json` ||
              f.name === `${safeSlug}_approved.json` ||
              f.name === `${eventSlug}.json` ||
              f.name === `${eventSlug}_approved.json` ||
              f.name.startsWith(`${safeSlug}_`) ||
              f.name.startsWith(`${eventSlug}_`))
          ) {
            allPaths.add(`_events/${f.name}`);
          }
        });
      }
    } catch (_) {}

    // Explicitly add candidate manifest file paths
    allPaths.add(`_events/${safeSlug}.json`);
    allPaths.add(`_events/${safeSlug}_approved.json`);
    allPaths.add(`_events/${eventSlug}.json`);
    allPaths.add(`_events/${eventSlug}_approved.json`);

    const pathsToDelete = Array.from(allPaths);
    if (pathsToDelete.length > 0) {
      try {
        const { error: removeError } = await client.storage.from(bucket).remove(pathsToDelete);
        if (removeError) {
          console.warn('Notice while removing event files from Supabase Storage:', removeError.message);
        }
      } catch (remErr) {
        console.warn('client.storage.remove notice:', remErr);
      }
      return { success: true, deletedCount: pathsToDelete.length };
    }

    return { success: true, deletedCount: 0 };
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
    const { bucket } = getSupabaseConfig();
    const safeSlug = eventSlug.replace(/[^a-zA-Z0-9-_]/g, '_');

    const { data: files, error } = await client.storage.from(bucket).list(safeSlug, {
      limit: 500,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error || !files) {
      console.warn('Could not list files from Supabase Storage:', error);
      return [];
    }

    // Filter out hidden files and directory placeholders
    const validFiles = files.filter(f => f && f.name && !f.name.startsWith('.'));
    // Separate full photos and micro-thumbnails (thumbnails start with thumb_)
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
      const isEncrypted = file.name.includes('.enc') || file.name.endsWith('.enc');

      return {
        id: `supabase_${origPath}`,
        storage_orig_path: origPath,
        storage_thumb_path: thumbPath,
        storage_orig_url: origUrl,
        storage_thumb_url: thumbUrl,
        original_url: origUrl,
        thumb_url: thumbUrl,
        original_path: origUrl,
        thumbnail_path: thumbUrl,
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
 * Sync an event manifest to Supabase Storage so the Super Admin can track it across hosts
 */
export async function syncEventManifestToStorage(eventData, hostName = 'Host') {
  if (!eventData || !eventData.slug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const safeSlug = eventData.slug.replace(/[^a-zA-Z0-9-_]/g, '_');
    const manifest = {
      slug: eventData.slug,
      name: eventData.name,
      date: eventData.date || new Date().toISOString().split('T')[0],
      tagline: eventData.tagline || '',
      max_photos: Number(eventData.max_photos) || 100,
      guest_upload_limit: Number(eventData.guest_upload_limit) || 20,
      moderation_enabled: eventData.moderation_enabled !== false,
      is_encrypted: Boolean(eventData.is_encrypted),
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
 * List all global events created across all GitHub hosts and local instances
 */
export async function listAllGlobalEventsFromStorage() {
  if (!isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();

    // 1. Fetch active events from Supabase Database if table is available
    let dbEventsMap = null;
    try {
      const { data: dbEvents, error: dbErr } = await client.from('events').select('*');
      if (!dbErr && dbEvents && Array.isArray(dbEvents)) {
        dbEventsMap = new Map(dbEvents.map(e => [e.slug, e]));
      }
    } catch (_) {}

    // 2. Fetch all manifests from _events/
    const manifestsMap = new Map();
    try {
      const { data: manifestList } = await client.storage.from(bucket).list('_events', {
        limit: 200,
      });

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

    // 3. Discover all event folders in the bucket root
    const { data: rootItems, error: rootErr } = await client.storage.from(bucket).list('', {
      limit: 200,
    });

    const folderSlugs = (rootItems || [])
      .filter(item => item && item.name && !item.name.startsWith('.') && !item.name.startsWith('_'))
      .map(item => item.name);

    const dbSlugs = dbEventsMap ? Array.from(dbEventsMap.keys()) : [];
    const allSlugs = Array.from(new Set([...manifestsMap.keys(), ...folderSlugs, ...dbSlugs]));

    // 4. Scan each event folder to compute exact metrics
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
                if (f.name.startsWith('thumb_')) {
                  thumbCount++;
                } else {
                  photoCount++;
                }
                const fileTime = f.created_at || f.updated_at || f.metadata?.lastModified;
                if (fileTime && (!latestTimestamp || new Date(fileTime) > new Date(latestTimestamp))) {
                  latestTimestamp = fileTime;
                }
              });
            }
          } catch (_) {}

          const hasManifest = Boolean(manifest.slug);
          const hasDbRecord = Boolean(dbEvent);

          // FILTER: If an event has 0 photos, 0 thumbs, no manifest, and no active DB record,
          // it was purged/deleted and is merely an empty S3 prefix/ghost. Drop it.
          if (photoCount === 0 && thumbCount === 0 && !hasManifest && !hasDbRecord) {
            return null;
          }

          // FILTER: If an event was marked deleted in manifest
          if (manifest.status === 'deleted') {
            return null;
          }

          // FILTER: If events DB table is active and the event has 0 photos and is not in the DB,
          // it was deleted from the database. Drop it.
          if (dbEventsMap && !hasDbRecord && photoCount === 0 && thumbCount === 0) {
            return null;
          }

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
            is_encrypted: Boolean(manifest.is_encrypted),
            admin_wrapped_key: manifest.admin_wrapped_key || null,
            has_manifest: hasManifest,
          };
        })
      )
    ).filter(Boolean);

    // Sort by latest activity / created_at descending
    return results.sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0));
  } catch (err) {
    console.warn('listAllGlobalEventsFromStorage error:', err);
    return [];
  }
}

/**
 * Fetch an individual event manifest from Supabase Storage (_events/${slug}.json)
 */
export async function getEventManifestFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
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
 * Persist the list of host-approved photo paths to Supabase Storage (_events/${slug}_approved.json)
 * so that all clients, guest devices, and hosts on separate networks stay synchronized.
 */
export async function syncApprovedListToStorage(eventSlug, approvedPaths) {
  if (!eventSlug || !isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
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
 * Fetch the list of host-approved photo paths from Supabase Storage (_events/${slug}_approved.json)
 */
export async function getApprovedListFromStorage(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
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
 * ==============================================================================
 * Supabase Database Layer (Hosts, Event Ownership, Guests & 24h Ephemeral TTL)
 * ==============================================================================
 */

/**
 * Register or verify host credentials in Supabase Database ('hosts' table)
 * Enforces 24-hour expiration lifecycle.
 */
export async function registerOrVerifyHostInCloud(hostName, pinHash) {
  if (!isStorageConfigured() || !hostName) return null;
  try {
    const client = getSupabaseClient();
    const cleanHost = hostName.trim();

    // Check if host already exists
    const { data: existing, error: fetchErr } = await client
      .from('hosts')
      .select('*')
      .ilike('host_name', cleanHost)
      .maybeSingle();

    if (fetchErr) {
      // Table doesn't exist yet (PGRST205) or database error: log and fallback
      console.info('Supabase Database hosts table not yet migrated or reachable:', fetchErr.message);
      return null;
    }

    const now = new Date();

    if (existing) {
      // Check if existing host space is past 24-hour expiration
      const expiresAt = new Date(existing.expires_at);
      if (expiresAt < now) {
        // Expired! Delete and re-register fresh 24h space
        await client.from('hosts').delete().eq('id', existing.id);
      } else {
        // Active host: verify PIN
        if (existing.pin_hash && existing.pin_hash !== pinHash) {
          return { success: false, error: 'Incorrect Host PIN for this account.' };
        }
        return {
          success: true,
          host: existing,
          isNew: false,
          remainingMs: Math.max(0, expiresAt.getTime() - now.getTime())
        };
      }
    }

    // Create fresh host space (24-hour TTL)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const newRecord = {
      host_name: cleanHost,
      pin_hash: pinHash || '',
      created_at: now.toISOString(),
      expires_at: expiresAt
    };

    const { data: created, error: insertErr } = await client
      .from('hosts')
      .insert(newRecord)
      .select()
      .single();

    if (insertErr) {
      console.warn('Failed to insert host in Supabase DB:', insertErr.message);
      return null;
    }

    return {
      success: true,
      host: created,
      isNew: true,
      remainingMs: 24 * 60 * 60 * 1000
    };
  } catch (err) {
    console.warn('registerOrVerifyHostInCloud error:', err);
    return null;
  }
}

/**
 * Fetch host details and 24-hour expiration status from Supabase Database
 */
export async function getHostDetailsFromCloud(hostName) {
  if (!isStorageConfigured() || !hostName) return null;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('hosts')
      .select('*')
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
 * Create or sync event ownership in Supabase Database ('events' table)
 * Enforces 10-event quota per host and 24-hour expiration.
 */
export async function createCloudEvent(eventData, hostName) {
  if (!isStorageConfigured() || !eventData?.slug) return null;
  try {
    const client = getSupabaseClient();
    const cleanHost = (hostName || eventData.host_name || 'Host').trim();

    // Check host's existing event count in Supabase Database
    const { data: hostEvents, error: countErr } = await client
      .from('events')
      .select('slug')
      .ilike('host_name', cleanHost);

    if (!countErr && hostEvents && hostEvents.length >= 10) {
      throw new Error('Host space quota reached (maximum 10 events allowed).');
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
      guest_upload_limit: Number(eventData.guest_upload_limit) || 20,
      max_photos: 100,
      created_at: new Date().toISOString(),
      expires_at: expiresAt
    };

    const { data, error } = await client
      .from('events')
      .upsert(record, { onConflict: 'slug' })
      .select()
      .single();

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
 * Query active events from Supabase Database strictly belonging to a specific host
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
 * Delete event record from Supabase Database and cascade to Supabase Storage
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
 * Register/Sync guest attendee in Supabase Database ('guests' table)
 * Ensures cross-device guest attendance and upload stats are accurately tracked.
 */
export async function syncGuestToCloud(eventSlug, guestData) {
  if (!eventSlug || !guestData?.name || !isStorageConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const record = {
      event_slug: eventSlug,
      name: guestData.name.trim(),
      token: guestData.token || `token_${Date.now()}`,
      upload_count: Number(guestData.upload_count) || 0,
      created_at: guestData.created_at || new Date().toISOString(),
      last_seen: new Date().toISOString()
    };

    const { data, error } = await client
      .from('guests')
      .upsert(record, { onConflict: 'event_slug, token' })
      .select()
      .maybeSingle();

    if (error) {
      return null;
    }
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Fetch all registered guests for an event from Supabase Database
 */
export async function getCloudGuestsForEvent(eventSlug) {
  if (!eventSlug || !isStorageConfigured()) return [];
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('guests')
      .select('*')
      .eq('event_slug', eventSlug)
      .order('last_seen', { ascending: false });

    if (error || !data) return [];
    return data;
  } catch (err) {
    return [];
  }
}

/**
 * Save a photo's durable attribution and metadata. Storage files intentionally
 * contain no personal data, so this table is the cross-device source of truth.
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
      status: photoData.status || 'pending',
      width: Number(photoData.width) || null,
      height: Number(photoData.height) || null,
      size: Number(photoData.size) || null,
      mime_type: photoData.mime_type || 'image/jpeg',
      created_at: photoData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await client
      .from('photos')
      .upsert(record, { onConflict: 'event_slug,storage_orig_path' })
      .select()
      .maybeSingle();
    return error ? null : data;
  } catch (_) {
    // Events created before the schema migration continue to work with the
    // legacy Storage-only fallback.
    return null;
  }
}

/** Fetch durable photo metadata for cross-device gallery hydration. */
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
 * Automated 24-Hour Ephemeral Lifecycle Cleanup:
 * Scans for expired hosts and events (expires_at <= now()).
 * Purges associated photo folders and manifests from Supabase Storage,
 * deletes DB rows from events and guests tables.
 */
export async function cleanupExpiredHostsAndEvents() {
  if (!isStorageConfigured()) return;
  try {
    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();

    // 1. Find expired events and purge their storage files + DB rows
    const { data: expiredEvents } = await client
      .from('events')
      .select('slug')
      .lte('expires_at', nowIso);

    if (expiredEvents && expiredEvents.length > 0) {
      for (const ev of expiredEvents) {
        console.log(`[LuminaFeed TTL] Purging expired event storage assets: ${ev.slug}`);
        await deleteEventFilesFromStorage(ev.slug);
      }
      await client.from('guests').delete().in('event_slug', expiredEvents.map(e => e.slug));
      await client.from('events').delete().lte('expires_at', nowIso);
    }

    // 2. Find expired hosts, purge their events' storage files, and remove host accounts
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

      console.log(`[LuminaFeed TTL] Purging ${expiredHosts.length} expired host account(s).`);
      await client.from('hosts').delete().lte('expires_at', nowIso);
    }
  } catch (err) {
    // Silent fail if tables aren't present
  }
}
