/**
 * LuminaFeed Online-First Network & Pre-Flight Probing Engine
 * 
 * Responsibilities:
 * - Real-time connectivity tracking (online / reconnecting / offline)
 * - Lightweight non-destructive latency probing (<300ms)
 * - Pre-flight upload checks to prevent hung loading spinners on spotty Wi-Fi / 4G / 5G
 * - Strict 15-second upload timeout guard with exponential backoff auto-retry
 * - Reactive state subscribers for floating UI status pill
 */

import { getBaaSConfig } from './storage.js';

let networkState = {
  status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  latencyMs: 0,
  lastChecked: Date.now(),
  failureCount: 0,
};

const listeners = new Set();
let monitorIntervalId = null;
let isProbing = false;

function notifyListeners() {
  const snapshot = { ...networkState };
  listeners.forEach(fn => {
    try { fn(snapshot); } catch (e) { console.warn('Network listener error:', e); }
  });
}

/**
 * Get current network state snapshot
 */
export function getNetworkState() {
  return { ...networkState };
}

/**
 * Subscribe to live network state updates
 */
export function subscribeNetworkState(callback) {
  listeners.add(callback);
  callback({ ...networkState });
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Perform a lightweight latency probe against the active BaaS CDN endpoint or local asset
 */
export async function probeNetworkLatency(timeoutMs = 3500) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    networkState.status = 'offline';
    networkState.isOnline = false;
    networkState.latencyMs = 0;
    networkState.lastChecked = Date.now();
    notifyListeners();
    return { ok: false, latencyMs: 0, error: 'Browser is offline' };
  }

  const { url, bucket } = getBaaSConfig();
  const cleanUrl = (url || '').replace(/\/+$/, '');
  const probeTarget = cleanUrl
    ? `${cleanUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/.probe?t=${Date.now()}`
    : `./manifest.json?t=${Date.now()}`;

  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(probeTarget, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    }).catch(() => {
      // If HEAD is blocked by CORS, try standard GET with small range
      return fetch(probeTarget, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
    });

    const elapsed = Math.round(performance.now() - startTime);
    clearTimeout(timeoutId);

    // 200, 404, or 400 all confirm the network and remote server are reachable!
    if (res && (res.ok || res.status === 404 || res.status === 400 || res.status === 403)) {
      networkState.status = elapsed > 900 ? 'reconnecting' : 'online';
      networkState.isOnline = true;
      networkState.latencyMs = elapsed;
      networkState.lastChecked = Date.now();
      networkState.failureCount = 0;
      notifyListeners();
      return { ok: true, latencyMs: elapsed };
    }

    throw new Error(`Server returned HTTP ${res?.status || 'unknown'}`);
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    networkState.failureCount += 1;
    networkState.status = networkState.failureCount >= 2 ? 'offline' : 'reconnecting';
    networkState.isOnline = networkState.status !== 'offline';
    networkState.lastChecked = Date.now();
    notifyListeners();
    return {
      ok: false,
      latencyMs: 0,
      isTimeout,
      error: isTimeout ? `Ping timed out after ${timeoutMs}ms` : (err.message || 'Network unreachable'),
    };
  }
}

/**
 * Pre-flight connectivity check before initiating a photo upload
 */
export async function preFlightUploadCheck(timeoutMs = 3000) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('You are currently offline. Please check your internet connection before uploading.');
  }

  const probe = await probeNetworkLatency(timeoutMs);
  if (!probe.ok && networkState.status === 'offline') {
    throw new Error('Unable to reach the event cloud. Please verify your Wi-Fi or cellular data signal and try again.');
  }

  return true;
}

/**
 * Execute an upload task with strict 15-second timeout and automatic retry
 */
export async function withUploadRetry(uploadFn, maxRetries = 2, timeoutMs = 15000) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const result = await Promise.race([
        uploadFn(controller.signal),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`));
          });
        }),
      ]);

      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt <= maxRetries) {
        console.warn(`[LuminaFeed Network] Upload attempt ${attempt} failed: ${err.message}. Retrying...`);
        networkState.status = 'reconnecting';
        notifyListeners();
        // Wait 1s * attempt before retry
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }

  throw lastError || new Error('Upload failed after retries.');
}

/**
 * Start periodic background network monitoring
 */
export function startNetworkMonitoring(intervalMs = 15000) {
  if (typeof window === 'undefined') return;

  // Browser online/offline event hooks
  window.addEventListener('online', () => {
    networkState.status = 'reconnecting';
    notifyListeners();
    probeNetworkLatency(3000);
  });

  window.addEventListener('offline', () => {
    networkState.status = 'offline';
    networkState.isOnline = false;
    networkState.latencyMs = 0;
    notifyListeners();
  });

  // Initial immediate probe
  probeNetworkLatency(3000);

  // Periodic heartbeat
  if (!monitorIntervalId) {
    monitorIntervalId = setInterval(() => {
      if (!isProbing) {
        isProbing = true;
        probeNetworkLatency(3500).finally(() => {
          isProbing = false;
        });
      }
    }, intervalMs);
  }
}

/**
 * Stop background network monitoring
 */
export function stopNetworkMonitoring() {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
}
