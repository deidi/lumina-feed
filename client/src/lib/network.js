/**
 * LuminaFeed Network & Dynamic Host IP Resolution Engine
 * Automatically detects and manages host IP addresses for local network photo sharing
 */

const STORAGE_KEY_HOST_IP = 'luminafeed_host_ip';

/**
 * Dynamically discover local LAN IPv4 address using WebRTC ICE candidate gathering
 */
export async function detectLocalIP() {
  // 1. Try local dev server endpoint if on localhost / local environment
  if (typeof window !== 'undefined' && isLocalhostHostname(window.location.hostname)) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 800);
      const res = await fetch('/api/host-info', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data && data.ip) {
          setStoredHostIP(data.ip);
          return data.ip;
        }
      }
    } catch (e) {
      // fallback to WebRTC / stored
    }
  }

  // 2. Try WebRTC candidate gathering
  const webRtcIp = await new Promise((resolve) => {
    if (typeof window === 'undefined' || (!window.RTCPeerConnection && !window.webkitRTCPeerConnection)) {
      resolve(null);
      return;
    }

    try {
      const RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      const pc = new RTCPC({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      let resolved = false;
      const finish = (ip) => {
        if (!resolved) {
          resolved = true;
          try { pc.close(); } catch (e) {}
          resolve(ip);
        }
      };

      pc.createDataChannel('lumina-ip-probe');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish(null));

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate) return;
        const cand = event.candidate.candidate;
        const ipMatches = cand.match(/\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/);
        if (ipMatches && ipMatches[1]) {
          const ip = ipMatches[1];
          if (ip !== '127.0.0.1' && !ip.startsWith('0.')) {
            finish(ip);
          }
        }
      };

      setTimeout(() => finish(null), 1000);
    } catch (e) {
      resolve(null);
    }
  });

  if (webRtcIp) {
    setStoredHostIP(webRtcIp);
    return webRtcIp;
  }

  const stored = getStoredHostIP();
  if (stored) return stored;

  return null;
}

/**
 * Get stored host IP from localStorage
 */
export function getStoredHostIP() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY_HOST_IP) || '';
}

/**
 * Set and persist host IP to localStorage
 */
export function setStoredHostIP(ip) {
  if (typeof window === 'undefined') return;
  const cleanIp = (ip || '').trim();
  if (cleanIp) {
    localStorage.setItem(STORAGE_KEY_HOST_IP, cleanIp);
  } else {
    localStorage.removeItem(STORAGE_KEY_HOST_IP);
  }
}

/**
 * Check if the current hostname is a local loopback (localhost or 127.0.0.1)
 */
export function isLocalhostHostname(hostname) {
  const h = (hostname || (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0';
}

/**
 * Resolve the dynamic origin for event URLs and QR codes
 * Replaces localhost with the host's actual LAN IP address so attendees on mobile can join
 */
export function resolveDynamicOrigin(overrideIp = '') {
  if (typeof window === 'undefined') return 'http://localhost:5173';

  const loc = window.location;
  const currentHostname = loc.hostname;

  // If already on a non-localhost domain/IP (e.g. GitHub Pages or opened directly via LAN IP), use it directly
  if (!isLocalhostHostname(currentHostname)) {
    return loc.origin;
  }

  // Determine the active IP for localhost replacements
  const activeIp = (overrideIp || getStoredHostIP() || '').trim();
  if (activeIp) {
    const port = loc.port ? `:${loc.port}` : '';
    const protocol = loc.protocol || 'http:';
    return `${protocol}//${activeIp}${port}`;
  }

  return loc.origin;
}

/**
 * Build the full dynamic event join URL
 */
export function buildDynamicEventJoinUrl(slug, options = {}) {
  const { hostIp = '', eventKey = '' } = options;
  const origin = resolveDynamicOrigin(hostIp);
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const basePath = path.endsWith('.html')
    ? path.substring(0, path.lastIndexOf('/'))
    : path.replace(/\/$/, '');

  const keyParam = eventKey ? `?k=${encodeURIComponent(eventKey)}` : '';
  return `${origin}${basePath}/#/event/${slug}${keyParam}`;
}

/**
 * Pre-flight network check for upload resilience
 */
export async function preFlightUploadCheck() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Robust retry wrapper for network and storage operations
 */
export async function withUploadRetry(fn, retries = 3, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }
  throw lastError;
}
