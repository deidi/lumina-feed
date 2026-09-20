import * as dbMethods from './db.js';
import {
  detectLocalIP,
  getStoredHostIP,
  setStoredHostIP,
  resolveDynamicOrigin,
  buildDynamicEventJoinUrl
} from './network.js';

export function getSessionToken() {
  return localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token') || '';
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem('luminafeed_host_token', token);
    localStorage.setItem('caps_host_token', token);
  } else {
    localStorage.removeItem('luminafeed_host_token');
    localStorage.removeItem('caps_host_token');
  }
}

export function getGuestToken(slug) {
  return localStorage.getItem(`luminafeed_guest_${slug}`) || localStorage.getItem(`caps_guest_${slug}`) || '';
}

export function setGuestToken(slug, token) {
  if (token) {
    localStorage.setItem(`luminafeed_guest_${slug}`, token);
    localStorage.setItem(`caps_guest_${slug}`, token);
  } else {
    localStorage.removeItem(`luminafeed_guest_${slug}`);
    localStorage.removeItem(`caps_guest_${slug}`);
  }
}

/**
 * Unified Client-Side Engine API
 * Directly interacts with browser IndexedDB (Dexie.js) - Zero Node.js backend required!
 */
export const api = {
  // Auth & Setup
  getAuthStatus: () => dbMethods.getAuthStatus(),
  loginHost: (host_name, pin) => dbMethods.loginHost(host_name, pin),
  registerHost: (host_name, pin) => dbMethods.registerHost(host_name, pin),
  logoutHost: () => dbMethods.logoutHost(),
  setupHost: (host_name, pin) => dbMethods.setupHost(host_name, pin),
  updateHostProfile: (data) => dbMethods.updateHostProfile(data),
  verifyPin: (pin) => dbMethods.verifyPin(pin),
  resetHostSetup: () => dbMethods.resetHostSetup(),

  // Events
  getEvents: (hostName = '') => dbMethods.getEvents(hostName),
  getEvent: (slug) => dbMethods.getEvent(slug),
  validateAndFetchEvent: (slug) => dbMethods.validateAndFetchEvent(slug),
  createEvent: (eventData, hostName = '') => dbMethods.createEvent(eventData, hostName),
  updateEvent: (slug, updates) => dbMethods.updateEvent(slug, updates),
  updateEventStatus: (slug, status) => dbMethods.updateEventStatus(slug, status),
  deleteEvent: (slug) => dbMethods.deleteEvent(slug),
  getEventQR: (slug, options = {}) => dbMethods.getEventQR(slug, options),

  // Network & Host IP Resolution
  detectLocalIP,
  getStoredHostIP,
  setStoredHostIP,
  resolveDynamicOrigin,
  buildDynamicEventJoinUrl,

  // Guest actions
  joinEvent: (slug, name, passcode = '') => dbMethods.joinEvent(slug, name, passcode),
  getGuestSession: (slug, guestToken) => dbMethods.getGuestSession(slug, guestToken),
  getGuests: (slug) => dbMethods.getGuests(slug),

  // Photos (In-Browser Processing + IndexedDB Storage)
  uploadPhoto: (slug, file, guestToken, options = {}) => dbMethods.uploadPhoto(slug, file, guestToken, options),
  getPhotos: (slug, options = {}) => dbMethods.getPhotos(slug, options),
  syncPhotosFromCloud: (slug, options = {}) => dbMethods.syncPhotosFromCloud(slug, options),
  getMyQuota: async (slug, guestToken) => {
    const guest = await dbMethods.db.guests.where({ event_slug: slug, token: guestToken }).first();
    const event = await dbMethods.db.events.where('slug').equals(slug).first();
    const allPhotos = await dbMethods.db.photos.where('event_slug').equals(slug).toArray();
    const eventLimit = Number(event?.max_photos) || 100;
    const upload_count = guest ? guest.upload_count : 0;
    const limit = Math.min(event ? event.guest_upload_limit : 20, eventLimit);
    const guestRemaining = Math.max(0, limit - upload_count);
    const eventRemaining = Math.max(0, eventLimit - allPhotos.length);
    return {
      success: true,
      quota: {
        upload_count,
        limit,
        remaining: Math.min(guestRemaining, eventRemaining),
        event_total: allPhotos.length,
        event_limit: eventLimit,
        event_remaining: eventRemaining
      }
    };
  },
  deletePhoto: (slug, photoId, guestToken) => dbMethods.deletePhoto(slug, photoId, guestToken),

  // Moderation (Host Only - enhanced in Slice 4)
  patchPhotoStatus: async (slug, photoId, status) => {
    await dbMethods.db.photos.update(parseInt(photoId, 10), { status });
    return { success: true, status };
  },
  bulkPatchPhotoStatus: async (slug, ids, status) => {
    await dbMethods.db.transaction('rw', dbMethods.db.photos, async () => {
      for (const id of ids) {
        await dbMethods.db.photos.update(parseInt(id, 10), { status });
      }
    });
    return { success: true, updated_count: ids.length };
  },

  // Slideshow
  getSlideshowConfig: async (slug, options = {}) => {
    const qr = await dbMethods.getEventQR(slug, options);
    return {
      success: true,
      config: {
        interval: 5,
        transition: 'fade',
        show_qr: true,
        show_author: true,
        qr_data_url: qr.qr_data_url,
        join_url: qr.join_url
      }
    };
  },
  updateSlideshowConfig: async (slug, config) => {
    return { success: true, config };
  },

  // Lifecycle & Analytics (Host Only)
  updateEvent: (slug, data) => dbMethods.updateEvent(slug, data),
  updateEventStatus: (slug, status) => dbMethods.updateEventStatus(slug, status),
  deleteEvent: (slug) => dbMethods.deleteEvent(slug),
  getEventAnalytics: (slug) => dbMethods.getEventAnalytics(slug),

  // Per-Event Branding
  uploadEventLogo: async (slug, file) => {
    return { success: true };
  },
  deleteEventLogo: async (slug) => {
    return { success: true };
  },
  updateEventBranding: async (slug, branding) => {
    return { success: true, branding };
  }
};

import { initRealtimeHub } from './realtime.js';

/**
 * Lightweight Realtime signaling connection handle powered by MQTT & BroadcastChannel
 */
export function createWebSocketConnection(slugOrMessage, optionsOrStatus, maybeSlug) {
  let slug = '';
  let options = {};

  if (typeof slugOrMessage === 'string') {
    slug = slugOrMessage;
    options = optionsOrStatus || {};
  } else if (typeof maybeSlug === 'string') {
    slug = maybeSlug;
    options = {
      onMessage: slugOrMessage,
      onStatusChange: optionsOrStatus
    };
  }

  if (!slug) {
    return {
      send: () => {},
      disconnect: () => {},
      close: () => {}
    };
  }

  const hub = initRealtimeHub(slug, options);
  return {
    ...hub,
    close: () => hub?.disconnect()
  };
}

import { exportFullEventArchive, exportSelectedPhotosZip } from './archive.js';
import * as gdrive from './gdrive.js';
import * as storage from './storage.js';
import * as crypto from './crypto.js';

export {
  exportFullEventArchive,
  exportSelectedPhotosZip,
  gdrive,
  storage,
  crypto,
  detectLocalIP,
  getStoredHostIP,
  setStoredHostIP,
  resolveDynamicOrigin,
  buildDynamicEventJoinUrl
};

/**
 * Trigger ZIP download for selected photo IDs
 */
export async function downloadSelectedZip(slug, ids, onProgress) {
  return exportSelectedPhotosZip(slug, ids, onProgress);
}

/**
 * Trigger full event archive download (.zip)
 */
export async function downloadFullArchiveZip(slug, onProgress) {
  return exportFullEventArchive(slug, onProgress);
}
