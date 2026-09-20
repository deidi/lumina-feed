<script>
  import { onMount, onDestroy } from "svelte";
  import {
    api,
    setSessionToken,
    getSessionToken,
    getGuestToken,
    setGuestToken,
    createWebSocketConnection,
    downloadSelectedZip,
    downloadFullArchiveZip,
    gdrive,
    storage,
    crypto,
  } from "./lib/api.js";
  import {
    enqueueOfflinePhoto,
    getOfflineQueue,
    flushOfflineQueue,
  } from "./lib/offline-queue.js";
  import { db, blobToBase64, base64ToBlob, slugify } from "./lib/db.js";
  import { cameraController } from "./lib/camera.js";
  import { FRAME_PRESETS, renderPresetFrameToCanvas } from "./lib/frame-studio.js";
  import { composePhotoWithFrame, renderFramedPhotoToCanvas } from "./lib/photo-engine.js";
  import { downloadPrintableSign } from "./lib/print-signs.js";

  // Localhost environment check for Super Admin isolation
  const isLocalEnvironment =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]");

  // Global app state
  let loading = $state(false);
  let errorMsg = $state("");
  let successMsg = $state("");

  // Theme state: dark by default, persistent with light toggle
  let currentTheme = $state(
    typeof localStorage !== "undefined"
      ? localStorage.getItem("luminafeed_theme") || "dark"
      : "dark"
  );

  function applyTheme(theme) {
    if (typeof document !== "undefined") {
      if (theme === "light") {
        document.documentElement.classList.add("light");
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        document.documentElement.classList.remove("light");
        document.documentElement.setAttribute("data-theme", "dark");
      }
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute("content", theme === "light" ? "#f8fafc" : "#0b0f19");
      }
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("luminafeed_theme", theme);
    }
  }

  function toggleTheme() {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(currentTheme);
  }

  let authStatus = $state({
    initialized: false,
    is_authenticated: false,
    host_name: "",
  });

  // PWA & Network State
  let isOnline = $state(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  let offlineQueueCount = $state(0);
  let isFlushingQueue = $state(false);
  let deferredInstallPrompt = $state(null);
  let showInstallButton = $state(false);

  // Route state
  let currentPath = $state(window.location.pathname);
  let isLandingRoute = $state(true);
  let isAppRoute = $state(false);
  let isGuestRoute = $state(false);
  let isSlideshowRoute = $state(false);
  let isPrivacyRoute = $state(false);
  let isTermsRoute = $state(false);
  let isSuperAdminRoute = $state(false);
  let isSuperAdminAuthenticated = $state(
    isLocalEnvironment &&
      typeof sessionStorage !== "undefined" &&
      (sessionStorage.getItem("luminafeed_super_admin") === "true" ||
        sessionStorage.getItem("luminafeed_super_admin") === "authenticated")
  );
  let superAdminPinInput = $state("");
  let superAdminError = $state("");
  let globalEvents = $state([]);
  let isLoadingGlobalEvents = $state(false);
  let globalSearchQuery = $state("");
  let inspectedGlobalEvent = $state(null);
  let inspectedPhotos = $state([]);
  let isLoadingInspectedPhotos = $state(false);
  let inspectedEventKey = $state("");
  let inspectedKeyStatus = $state(""); // "escrow" | "manual" | "none" | "unencrypted"
  let manualKeyInput = $state("");
  let currentEventSlug = $state("");

  // Host setup & unlock form state
  let hostAuthTab = $state("login"); // "login" | "register"
  let setupName = $state("");
  let setupPin = $state("");
  let setupPinConfirm = $state("");
  let unlockPin = $state("");

  // Host dashboard state
  let events = $state([]);
  let isCreateModalOpen = $state(false);
  let isDeleteModalOpen = $state(false);
  let deleteConfirmInput = $state("");
  let isSubmitting = $state(false);
  let isProfileModalOpen = $state(false);
  let editHostName = $state("");
  let currentPinInput = $state("");
  let newPinInput = $state("");
  let confirmNewPinInput = $state("");
  let profileErrorMsg = $state("");
  let profileSuccessMsg = $state("");

  // New event form
  let newEvent = $state({
    name: "",
    date: new Date().toISOString().split("T")[0],
    tagline: "",
    moderation_enabled: false,
    guest_upload_limit: 20,
    exif_strip: true,
    is_encrypted: false,
  });

  // Host View: 'dashboard' | 'event_detail'
  let hostView = $state("dashboard");
  let selectedEvent = $state(null);
  let hostDetailTab = $state("queue"); // 'queue' | 'gallery' | 'analytics' | 'settings'
  let pendingPhotos = $state([]);
  let approvedPhotos = $state([]);
  let eventAnalytics = $state(null);
  let eventGuests = $state([]);
  let isLoadingGuests = $state(false);

  // 24-Hour Ephemeral Retention State
  let hostRemainingText = $state("");
  let isTtlInfoModalOpen = $state(false);

  // QR Modal & Projection Mode
  let isQrModalOpen = $state(false);
  let isProjectionMode = $state(false);
  let qrData = $state(null);
  let qrHostType = $state("ip"); // 'ip' | 'mdns' | 'current'

  // Dynamic Host IP Resolution
  let detectedHostIp = $state(api.getStoredHostIP() || "");
  let isDetectingIp = $state(false);

  // Guest State
  let guestSession = $state(null);
  let guestNameInput = $state("");
  let guestPasscodeInput = $state("");
  let guestEventData = $state(null);
  let myUploads = $state([]);
  let liveGalleryPhotos = $state([]);
  let isUploading = $state(false);
  let uploadCurrentIndex = $state(0);
  let uploadTotalCount = $state(0);
  let uploadProgressText = $state("");
  let selectedPreviewPhoto = $state(null);
  let wsConnectionStatus = $state("disconnected");

  // Multi-selection & Batch Download State
  let isSelectionMode = $state(false);
  let selectedPhotoIds = $state(new Set());
  let isDownloadingZip = $state(false);

  // Slideshow / TV Mode State
  let slideshowPhotos = $state([]);
  let currentSlideIndex = $state(0);
  let isSlideshowPaused = $state(false);
  let slideshowConfig = $state({
    interval: 5,
    transition: "fade",
    show_qr: true,
    show_author: true,
    qr_data_url: "",
    join_url: "",
  });
  let slideshowTimer = null;
  let isSlideshowSyncing = $state(false);
  let slideshowRefreshTimer = null;
  let lastCloudSyncTime = $state(null);

  // Host Cloud Sync State
  let isHostPhotoSyncing = $state(false);
  let hostPhotoSyncTimer = null;
  let lastHostSyncTime = $state(null);

  // Guest Cloud Sync State
  let isGuestPhotoSyncing = $state(false);
  let guestPhotoSyncTimer = null;
  let lastGuestSyncTime = $state(null);

  // DOM file input references
  let cameraInputEl = $state();
  let fileInputEl = $state();

  let wsHandle = null;
  let studioCanvasEl = $state(null);

  // In-App Camera Viewfinder State
  let isCameraOpen = $state(false);
  let cameraVideoEl = $state(null);
  let cameraFacingMode = $state("environment");
  let isTorchOn = $state(false);
  let hasTorch = $state(false);
  let hasMultipleCameras = $state(false);
  let cameraErrorMsg = $state("");
  let isSnapping = $state(false);

  // Photo Studio & Frame Preview State
  let isPhotoStudioOpen = $state(false);
  let studioFile = $state(null);
  let studioPreviewBlobUrl = $state("");
  let studioUseFrame = $state(true);
  let studioCaption = $state("");
  let isSubmittingStudio = $state(false);

  // Floating Social Reactions State
  let floatingReactions = $state([]);

  function triggerFloatingReaction(reaction) {
    if (!reaction || !reaction.emoji) return;
    const item = {
      id: reaction.id || "rx_" + Math.random().toString(36).substring(2, 9),
      emoji: reaction.emoji,
      senderName: reaction.senderName || "",
      leftPercent: reaction.leftPercent || (20 + Math.random() * 60),
    };
    floatingReactions = [...floatingReactions, item];
    setTimeout(() => {
      floatingReactions = floatingReactions.filter((r) => r.id !== item.id);
    }, 2800);
  }

  function sendPhotoReaction(emoji, photoId = null) {
    if (wsHandle && typeof wsHandle.sendReaction === "function") {
      wsHandle.sendReaction(emoji, photoId, guestSession?.guest?.name || "Guest");
    }
  }

  function getPhotoSrc(photo, isThumb = true) {
    if (!photo) return "";
    if (typeof photo === "string") return photo;
    if (isThumb) {
      if (photo.decrypted_thumb_url) return photo.decrypted_thumb_url;
      if (photo.thumb_blob) return db.getCachedObjectURL(photo.thumb_blob, `thumb_${photo.id}`);
      if (photo.thumbDataUrl) return photo.thumbDataUrl;
      if (photo.decrypted_orig_url) return photo.decrypted_orig_url;
      if (photo.original_blob) return db.getCachedObjectURL(photo.original_blob, `orig_${photo.id}`);

      const rawThumbUrl = photo.storage_thumb_url || photo.thumb_url || photo.thumbnail_path || "";
      const rawOrigUrl = photo.storage_orig_url || photo.original_url || photo.original_path || "";
      const primaryUrl = rawThumbUrl || rawOrigUrl;

      // Only treat as encrypted if the actual storage file path/URL is a .enc encrypted ciphertext blob
      const isEncFile = Boolean(
        (primaryUrl && primaryUrl.includes(".enc")) ||
        (photo.filename && photo.filename.endsWith(".enc")) ||
        (photo.storage_thumb_path && photo.storage_thumb_path.includes(".enc")) ||
        (photo.storage_orig_path && photo.storage_orig_path.includes(".enc"))
      );

      if (isEncFile) {
        const key = currentEventSlug ? crypto.getStoredEventKey(currentEventSlug) : "";
        if (key && photo.id && !photo._isDecrypting) {
          photo._isDecrypting = true;
          db.ensurePhotoDecrypted(photo, key).then((res) => {
            if (res && res.thumb_blob) {
              const url = db.getCachedObjectURL(res.thumb_blob, `thumb_${photo.id}`);
              photo.decrypted_thumb_url = url;
              if (isGuestRoute) {
                liveGalleryPhotos = [...liveGalleryPhotos];
                myUploads = [...myUploads];
              } else if (isSlideshowRoute) {
                slideshowPhotos = [...slideshowPhotos];
              } else {
                approvedPhotos = [...approvedPhotos];
                pendingPhotos = [...pendingPhotos];
              }
            }
          }).catch(() => {});
        }
        return "";
      }

      return primaryUrl;
    }

    if (photo.decrypted_orig_url) return photo.decrypted_orig_url;
    if (photo.original_blob) return db.getCachedObjectURL(photo.original_blob, `orig_${photo.id}`);
    if (photo.decrypted_thumb_url) return photo.decrypted_thumb_url;
    if (photo.thumb_blob) return db.getCachedObjectURL(photo.thumb_blob, `thumb_${photo.id}`);

    const rawOrigUrl = photo.storage_orig_url || photo.original_url || photo.original_path || "";
    const rawThumbUrl = photo.storage_thumb_url || photo.thumb_url || photo.thumbnail_path || "";
    const primaryUrl = rawOrigUrl || rawThumbUrl;

    const isEncFile = Boolean(
      (primaryUrl && primaryUrl.includes(".enc")) ||
      (photo.filename && photo.filename.endsWith(".enc")) ||
      (photo.storage_orig_path && photo.storage_orig_path.includes(".enc"))
    );

    if (isEncFile) {
      const key = currentEventSlug ? crypto.getStoredEventKey(currentEventSlug) : "";
      if (key && !photo._isDecryptingOrig) {
        photo._isDecryptingOrig = true;
        db.getDecryptedOriginalBlob(photo, key).then((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            photo.decrypted_orig_url = url;
            if (isSlideshowRoute) {
              slideshowPhotos = [...slideshowPhotos];
            }
          }
        }).catch(() => {});
      }
      return photo.decrypted_thumb_url || (photo.thumb_blob ? db.getCachedObjectURL(photo.thumb_blob, `thumb_${photo.id}`) : "");
    }

    return primaryUrl;
  }

  async function decryptPhotosList(photosList) {
    if (!photosList || photosList.length === 0) return photosList;
    const key = currentEventSlug ? crypto.getStoredEventKey(currentEventSlug) : "";
    if (!key) return photosList;

    let hasUpdates = false;
    const updated = await Promise.all(
      photosList.map(async (p) => {
        if (p.decrypted_thumb_url) return p;
        if (p.thumb_blob) {
          const url = db.getCachedObjectURL(p.thumb_blob, `thumb_${p.id}`);
          hasUpdates = true;
          return { ...p, decrypted_thumb_url: url };
        }
        const isEnc = Boolean(
          p.filename?.endsWith(".enc") ||
          p.storage_thumb_path?.includes(".enc") ||
          p.storage_orig_path?.includes(".enc")
        );
        if (!isEnc) return p;
        try {
          const decrypted = await db.ensurePhotoDecrypted(p, key);
          if (decrypted && decrypted.thumb_blob) {
            hasUpdates = true;
            return { ...p, ...decrypted, decrypted_thumb_url: decrypted.decrypted_thumb_url || decrypted.thumb_url };
          }
        } catch (e) {
          console.warn("Thumbnail decryption error:", p.filename, e);
        }
        return p;
      })
    );
    return hasUpdates ? updated : photosList;
  }

  // Reactive automatic decryption for high-res photo in lightbox modal
  $effect(() => {
    if (
      selectedPreviewPhoto &&
      selectedPreviewPhoto.is_encrypted &&
      !selectedPreviewPhoto.decrypted_orig_url &&
      !selectedPreviewPhoto.original_blob
    ) {
      const p = selectedPreviewPhoto;
      const key = currentEventSlug ? crypto.getStoredEventKey(currentEventSlug) : "";
      db.getDecryptedOriginalBlob(p, key)
        .then((blob) => {
          if (blob && selectedPreviewPhoto && selectedPreviewPhoto.id === p.id) {
            const url = URL.createObjectURL(blob);
            selectedPreviewPhoto = { ...p, decrypted_orig_url: url };
          }
        })
        .catch((e) => console.warn("Could not decrypt full original for preview:", e));
    }
  });

  // Reactive automatic decryption for high-res photo in venue slideshow
  $effect(() => {
    if (
      isSlideshowRoute &&
      slideshowPhotos.length > 0 &&
      slideshowPhotos[currentSlideIndex]
    ) {
      const p = slideshowPhotos[currentSlideIndex];
      const isEnc = Boolean(p.is_encrypted || p.filename?.includes(".enc") || p.storage_orig_url?.includes(".enc") || p.original_url?.includes(".enc"));
      if (isEnc && !p.decrypted_orig_url && !p.original_blob && !p._isDecryptingOrig) {
        p._isDecryptingOrig = true;
        const key = currentEventSlug ? crypto.getStoredEventKey(currentEventSlug) : "";
        db.getDecryptedOriginalBlob(p, key)
          .then((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              slideshowPhotos[currentSlideIndex] = { ...p, decrypted_orig_url: url };
            }
          })
          .catch((e) => console.warn("Could not decrypt full original for slideshow slide:", e));
      }
    }
  });

  function parseRoute() {
    let path = "/";

    // 1. Prioritize hash route (SPA on GitHub Pages)
    if (window.location.hash && window.location.hash.startsWith("#")) {
      const hashPart = window.location.hash.replace(/^#\/?/, "/");
      if (hashPart) {
        path = hashPart;
      }
    } else {
      // 2. Fall back to pathname (stripping repository directory if deployed under subdirectory)
      const pathname = window.location.pathname;
      if (pathname.includes("/event/")) {
        path = pathname.substring(pathname.indexOf("/event/"));
      } else if (pathname.includes("/app")) {
        path = pathname.substring(pathname.indexOf("/app"));
      } else if (pathname.includes("/privacy")) {
        path = pathname.substring(pathname.indexOf("/privacy"));
      } else if (pathname.includes("/terms")) {
        path = pathname.substring(pathname.indexOf("/terms"));
      }
    }

    // Extract query parameters (either from hash like #/event/abc?k=123 or search like ?k=123#/event/abc)
    let queryString = "";
    if (path.includes("?")) {
      const parts = path.split("?");
      path = parts[0];
      queryString = parts.slice(1).join("?");
    }

    const hashParams = new URLSearchParams(queryString);
    const searchParams = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const keyParam = hashParams.get("k") || searchParams.get("k");

    // Clean any trailing slashes except for root
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    currentPath = path;

    if (path === "/super-admin" || path.startsWith("/super-admin")) {
      if (!isLocalEnvironment) {
        // Enforce Super Admin runs ONLY on local computer
        navigate("/");
        return;
      }
      isLandingRoute = false;
      isAppRoute = false;
      isSuperAdminRoute = true;
      isPrivacyRoute = false;
      isTermsRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    if (path === "/privacy" || path.startsWith("/privacy")) {
      isLandingRoute = false;
      isAppRoute = false;
      isSuperAdminRoute = false;
      isPrivacyRoute = true;
      isTermsRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    if (path === "/terms" || path.startsWith("/terms")) {
      isLandingRoute = false;
      isAppRoute = false;
      isSuperAdminRoute = false;
      isTermsRoute = true;
      isPrivacyRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    isPrivacyRoute = false;
    isTermsRoute = false;
    isSuperAdminRoute = false;

    const slideshowMatch = path.match(
      /^\/event\/([a-zA-Z0-9_-]+)\/(slideshow|tv)/,
    );
    if (slideshowMatch) {
      isLandingRoute = false;
      isAppRoute = false;
      isSuperAdminRoute = false;
      isSlideshowRoute = true;
      isGuestRoute = false;
      currentEventSlug = slideshowMatch[1];
      if (keyParam) {
        crypto.setStoredEventKey(currentEventSlug, keyParam);
      }
      return;
    }

    const eventMatch = path.match(/^\/event\/([a-zA-Z0-9_-]+)/);
    if (eventMatch) {
      isLandingRoute = false;
      isAppRoute = false;
      isSuperAdminRoute = false;
      isGuestRoute = true;
      isSlideshowRoute = false;
      currentEventSlug = eventMatch[1];
      if (keyParam) {
        crypto.setStoredEventKey(currentEventSlug, keyParam);
      }
      return;
    }

    if (path === "/app" || path.startsWith("/app")) {
      isLandingRoute = false;
      isAppRoute = true;
      isSuperAdminRoute = false;
      isGuestRoute = false;
      isSlideshowRoute = false;
      currentEventSlug = "";
      return;
    }

    // Default route is Landing Page at `/`
    isLandingRoute = true;
    isAppRoute = false;
    isSuperAdminRoute = false;
    isGuestRoute = false;
    isSlideshowRoute = false;
    currentEventSlug = "";
  }

  function navigate(url) {
    const cleanUrl = url.startsWith("/") ? url : `/${url}`;
    window.location.hash = `#${cleanUrl}`;
    parseRoute();
    initView();
  }

  function openSlideshow(slug) {
    const origin = api.resolveDynamicOrigin(detectedHostIp);
    const path = window.location.pathname;
    const basePath = path.endsWith(".html")
      ? path.substring(0, path.lastIndexOf("/"))
      : path.replace(/\/$/, "");
    const url = `${origin}${basePath}/#/event/${slug}/slideshow`;
    window.open(url, "_blank");
  }

  async function initView() {
    errorMsg = "";
    successMsg = "";
    isSelectionMode = false;
    selectedPhotoIds = new Set();
    parseRoute();

    if (wsHandle) {
      try {
        wsHandle.disconnect();
      } catch (e) {}
      wsHandle = null;
    }

    try {
      if (isSlideshowRoute && currentEventSlug) {
        stopGuestAutoSync();
        await loadSlideshowExperience(currentEventSlug);
        setupWebSocket(currentEventSlug, false);
      } else {
        stopSlideshowAutoRefresh();
        if (isGuestRoute && currentEventSlug) {
          await loadGuestExperience(currentEventSlug);
          setupWebSocket(currentEventSlug, false);
        } else if (isAppRoute) {
          stopGuestAutoSync();
          await checkAuth();
        } else if (isSuperAdminRoute) {
          stopGuestAutoSync();
          if (isSuperAdminAuthenticated) {
            await loadGlobalTracker();
          }
        } else {
          stopGuestAutoSync();
        }
      }
    } catch (err) {
      console.error("InitView error:", err);
      errorMsg = err.message || "Failed to load event";
    } finally {
      loading = false;
    }
  }

  function setupWebSocket(slug, isHost = false) {
    if (!slug) return;
    try {
      wsHandle = createWebSocketConnection(slug, {
        isHost,
        onStatusChange: (status) => {
          wsConnectionStatus = status;
        },
        onMessage: (msg) => {
          handleWebSocketMessage(msg);
        },
      });
    } catch (err) {
      console.warn("P2P Mesh initialization skipped or failed:", err);
    }
  }

  function handleWebSocketMessage(msg) {
    if (msg.type === "reaction:sent") {
      triggerFloatingReaction(msg.payload);
      return;
    }

    if (msg.type === "event:status-changed") {
      if (guestEventData && guestEventData.slug === msg.payload.slug) {
        guestEventData.status = msg.payload.status;
      }
      if (selectedEvent && selectedEvent.slug === msg.payload.slug) {
        selectedEvent.status = msg.payload.status;
      }
    } else if (msg.type === "event:settings-updated") {
      const targetSlug = msg.payload.slug || (guestEventData && guestEventData.slug) || (selectedEvent && selectedEvent.slug);
      if (msg.payload.event_settings) {
        const settings = msg.payload.event_settings;
        if (guestEventData && (!msg.payload.slug || guestEventData.slug === msg.payload.slug)) {
          guestEventData = { ...guestEventData, ...settings };
          if (guestSession) {
            const limit = Number(settings.guest_upload_limit) || 20;
            const used = Number(guestSession.guest?.upload_count) || 0;
            guestSession.event = { ...guestSession.event, ...settings };
            guestSession.quota = {
              used,
              limit,
              remaining: Math.max(0, limit - used),
            };
          }
        }
        if (selectedEvent && (!msg.payload.slug || selectedEvent.slug === msg.payload.slug)) {
          selectedEvent = { ...selectedEvent, ...settings };
        }
        if (targetSlug) {
          db.events.where("slug").equals(targetSlug).modify({
            guest_upload_limit: Number(settings.guest_upload_limit) || 20,
            moderation_enabled: Boolean(settings.moderation_enabled),
            name: settings.name,
            tagline: settings.tagline
          }).catch(() => {});
        }
      }
    } else if (msg.type === "event:deleted") {
      if (
        (guestEventData && guestEventData.slug === msg.payload.slug) ||
        (selectedEvent && selectedEvent.slug === msg.payload.slug)
      ) {
        alert("This event has been deleted by the host.");
        navigate("/");
      }
    }

    if (isSlideshowRoute) {
      if (msg.type === "photo:approved") {
        const photo = msg.payload;
        if (
          !slideshowPhotos.some(
            (p) => (p.hash && p.hash === photo.hash) || p.id === photo.id,
          )
        ) {
          slideshowPhotos = [...slideshowPhotos, photo];
        }
      } else if (msg.type === "photo:bulk-approved") {
        const newlyApproved = msg.payload.photos || [];
        const existingHashes = new Set(
          slideshowPhotos.map((p) => p.hash).filter(Boolean),
        );
        const existingIds = new Set(slideshowPhotos.map((p) => p.id));
        const toAdd = newlyApproved.filter(
          (p) => !existingHashes.has(p.hash) && !existingIds.has(p.id),
        );
        slideshowPhotos = [...slideshowPhotos, ...toAdd];
      } else if (msg.type === "gallery:synced") {
        const syncedPhotos = msg.payload.photos || [];
        const syncedHashes = new Set(syncedPhotos.map((p) => p.hash).filter(Boolean));
        const syncedIds = new Set(syncedPhotos.map((p) => p.id).filter(Boolean));

        // Prune any photo no longer in syncedPhotos
        slideshowPhotos = slideshowPhotos.filter(
          (p) => (p.hash && syncedHashes.has(p.hash)) || (p.id && syncedIds.has(p.id)),
        );

        for (const photo of syncedPhotos) {
          if (
            !slideshowPhotos.some(
              (p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id),
            )
          ) {
            const origUrl = getPhotoSrc(photo, false);
            const thumbUrl = getPhotoSrc(photo, true);
            if (origUrl || thumbUrl) {
              slideshowPhotos = [
                ...slideshowPhotos,
                {
                  ...photo,
                  storage_orig_url: photo.storage_orig_url || origUrl,
                  storage_thumb_url: photo.storage_thumb_url || thumbUrl,
                  thumbnail_path: thumbUrl,
                  thumb_url: thumbUrl,
                  original_path: origUrl,
                  original_url: origUrl,
                },
              ];
            }
          }
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload.id;
        const removeHash = msg.payload.hash;
        slideshowPhotos = slideshowPhotos.filter(
          (p) => p.id !== removeId && (!removeHash || p.hash !== removeHash),
        );
        if (currentSlideIndex >= slideshowPhotos.length) {
          currentSlideIndex = Math.max(0, slideshowPhotos.length - 1);
        }
      }
    } else if (isGuestRoute) {
      if (msg.type === "photo:approved" || (msg.type === "photo:uploaded" && msg.payload?.status === "approved")) {
        const photo = msg.payload;
        // 1. Update status in myUploads
        myUploads = myUploads.map((p) =>
          ((p.hash && p.hash === photo.hash) || (p.storage_orig_path && p.storage_orig_path === photo.storage_orig_path) || p.id === photo.id || p.filename === photo.filename)
            ? { ...p, status: "approved" }
            : p,
        );

        // 2. Update status in Guest IndexedDB
        if (photo.hash) {
          db.photos
            .where("hash")
            .equals(photo.hash)
            .modify({ status: "approved" })
            .catch(() => {});
        }

        // 3. Find or construct the photo object with valid image URL
        const localMatch = myUploads.find((p) => (p.hash && p.hash === photo.hash) || (p.storage_orig_path && p.storage_orig_path === photo.storage_orig_path) || p.id === photo.id || p.filename === photo.filename);
        const thumbUrl = photo.thumb_url || photo.storage_thumb_url || photo.drive_thumb_url || photo.original_url || photo.storage_orig_url || (localMatch ? localMatch.thumb_url : "");
        const origUrl = photo.original_url || photo.storage_orig_url || photo.drive_orig_url || thumbUrl || (localMatch ? localMatch.original_url : "");

        let galleryItem = null;
        if (localMatch) {
          galleryItem = { ...localMatch, status: "approved", thumb_url: thumbUrl || localMatch.thumb_url, original_url: origUrl || localMatch.original_url, thumbnail_path: thumbUrl || localMatch.thumbnail_path, original_path: origUrl || localMatch.original_path };
        } else {
          galleryItem = {
            ...photo,
            status: "approved",
            thumb_url: thumbUrl,
            original_url: origUrl,
            thumbnail_path: thumbUrl,
            original_path: origUrl,
          };
        }

        // 4. Update liveGalleryPhotos reactively
        if (
          !liveGalleryPhotos.some(
            (p) => (p.hash && p.hash === photo.hash) || (p.storage_orig_path && p.storage_orig_path === photo.storage_orig_path) || p.id === photo.id,
          )
        ) {
          liveGalleryPhotos = [galleryItem, ...liveGalleryPhotos];
        } else {
          liveGalleryPhotos = liveGalleryPhotos.map((p) =>
            ((p.hash && p.hash === photo.hash) || (p.storage_orig_path && p.storage_orig_path === photo.storage_orig_path) || p.id === photo.id)
              ? { ...p, ...galleryItem, status: "approved" }
              : p,
          );
        }
        decryptPhotosList(liveGalleryPhotos).then((p) => {
          liveGalleryPhotos = p;
        });
      } else if (msg.type === "gallery:synced") {
        if (msg.payload.event_settings) {
          const settings = msg.payload.event_settings;
          if (guestEventData) {
            guestEventData = { ...guestEventData, ...settings };
          }
          if (guestSession) {
            const limit = Number(settings.guest_upload_limit) || 20;
            const used = Number(guestSession.guest?.upload_count) || 0;
            guestSession.event = { ...guestSession.event, ...settings };
            guestSession.quota = {
              used,
              limit,
              remaining: Math.max(0, limit - used),
            };
          }
          if (currentEventSlug) {
            db.events.where("slug").equals(currentEventSlug).modify({
              guest_upload_limit: Number(settings.guest_upload_limit) || 20,
              moderation_enabled: Boolean(settings.moderation_enabled),
              name: settings.name,
              tagline: settings.tagline
            }).catch(() => {});
          }
        }

        const syncedPhotos = msg.payload.photos || [];
        const syncedHashes = new Set(syncedPhotos.map((p) => p.hash).filter(Boolean));
        const syncedIds = new Set(syncedPhotos.map((p) => p.id).filter(Boolean));

        // Prune any photo no longer in syncedPhotos from live gallery
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => (p.hash && syncedHashes.has(p.hash)) || (p.id && syncedIds.has(p.id)),
        );

        for (const photo of syncedPhotos) {
          if (
            !liveGalleryPhotos.some(
              (p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id),
            )
          ) {
            const localMatch = myUploads.find((p) => (p.hash && p.hash === photo.hash) || (p.id && p.id === photo.id));
            if (localMatch) {
              liveGalleryPhotos = [
                ...liveGalleryPhotos,
                { ...localMatch, status: "approved" },
              ];
            } else {
              const origUrl = getPhotoSrc(photo, false);
              const thumbUrl = getPhotoSrc(photo, true);
              if (thumbUrl || origUrl) {
                liveGalleryPhotos = [
                  ...liveGalleryPhotos,
                  {
                    ...photo,
                    status: "approved",
                    storage_orig_url: photo.storage_orig_url || origUrl,
                    storage_thumb_url: photo.storage_thumb_url || thumbUrl,
                    thumbnail_path: thumbUrl,
                    thumb_url: thumbUrl,
                    original_path: origUrl,
                    original_url: origUrl,
                  },
                ];
              }
            }
          }
        }
      } else if (msg.type === "photo:bulk-approved") {
        const newApproved = msg.payload.photos || [];
        const approvedHashes = new Set(
          newApproved.map((p) => p.hash).filter(Boolean),
        );
        const approvedIds = new Set(newApproved.map((p) => p.id));

        myUploads = myUploads.map((p) =>
          approvedHashes.has(p.hash) || approvedIds.has(p.id)
            ? { ...p, status: "approved" }
            : p,
        );

        for (const hash of approvedHashes) {
          db.photos
            .where("hash")
            .equals(hash)
            .modify({ status: "approved" })
            .catch(() => {});
        }

        const existingHashes = new Set(
          liveGalleryPhotos.map((p) => p.hash).filter(Boolean),
        );
        const existingIds = new Set(liveGalleryPhotos.map((p) => p.id));

        for (const photo of newApproved) {
          if (!existingHashes.has(photo.hash) && !existingIds.has(photo.id)) {
            const localMatch = myUploads.find((p) => p.hash === photo.hash);
            if (localMatch) {
              liveGalleryPhotos = [
                ...liveGalleryPhotos,
                { ...localMatch, status: "approved" },
              ];
            } else {
              const thumbUrl = photo.thumb_url || photo.drive_thumb_url || photo.original_url || photo.drive_orig_url || (photo.thumbDataUrl ? URL.createObjectURL(base64ToBlob(photo.thumbDataUrl)) : "");
              const origUrl = photo.original_url || photo.drive_orig_url || thumbUrl;
              if (thumbUrl || origUrl) {
                liveGalleryPhotos = [
                  ...liveGalleryPhotos,
                  {
                    ...photo,
                    status: "approved",
                    thumbnail_path: thumbUrl,
                    thumb_url: thumbUrl,
                    original_path: origUrl,
                    original_url: origUrl,
                  },
                ];
              }
            }
          }
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload.id;
        const removeHash = msg.payload.hash;
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => (removeId && p.id === removeId) || (removeHash && p.hash === removeHash) ? false : true,
        );
        if (msg.type === "photo:deleted") {
          myUploads = myUploads.filter(
            (p) => (removeId && p.id === removeId) || (removeHash && p.hash === removeHash) ? false : true,
          );
        } else if (msg.type === "photo:removed") {
          myUploads = myUploads.map((p) =>
            (removeId && p.id === removeId) || (removeHash && p.hash === removeHash)
              ? { ...p, status: "pending" }
              : p,
          );
        }
        if (removeHash) {
          db.photos
            .where("hash")
            .equals(removeHash)
            .modify({ status: msg.type === "photo:deleted" ? "rejected" : "pending" })
            .catch(() => {});
        }
        if (selectedPhotoIds.has(removeId)) {
          selectedPhotoIds.delete(removeId);
          selectedPhotoIds = new Set(selectedPhotoIds);
        }
      } else if (msg.type === "photo:bulk-removed") {
        const removedIds = new Set(msg.payload.ids || []);
        liveGalleryPhotos = liveGalleryPhotos.filter(
          (p) => !removedIds.has(p.id),
        );
        myUploads = myUploads.map((p) =>
          removedIds.has(p.id) ? { ...p, status: "pending" } : p
        );
      }
    } else if (selectedEvent) {
      if (msg.type === "photo:new-pending" || msg.type === "photo:uploaded") {
        const photo = msg.payload.photo || msg.payload;
        if (photo.status === "pending") {
          if (!pendingPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
            pendingPhotos = [photo, ...pendingPhotos];
          }
        } else if (photo.status === "approved") {
          pendingPhotos = pendingPhotos.filter((p) => (p.hash && p.hash === photo.hash) ? false : p.id !== photo.id);
          if (!approvedPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
            approvedPhotos = [photo, ...approvedPhotos];
          }
        }
      } else if (msg.type === "photo:approved") {
        const photo = msg.payload.photo || msg.payload;
        pendingPhotos = pendingPhotos.filter((p) => (p.hash && p.hash === photo.hash) ? false : p.id !== photo.id);
        if (!approvedPhotos.some((p) => (p.hash && p.hash === photo.hash) || p.id === photo.id)) {
          approvedPhotos = [photo, ...approvedPhotos];
        }
      } else if (msg.type === "photo:status-changed") {
        const photo = msg.payload.photo;
        if (photo) {
          if (photo.status === "pending") {
            approvedPhotos = approvedPhotos.filter((p) => p.id !== photo.id);
            if (!pendingPhotos.some((p) => p.id === photo.id)) {
              pendingPhotos = [{ ...photo }, ...pendingPhotos];
            }
          } else if (photo.status === "approved") {
            pendingPhotos = pendingPhotos.filter((p) => p.id !== photo.id);
            if (!approvedPhotos.some((p) => p.id === photo.id)) {
              approvedPhotos = [{ ...photo }, ...approvedPhotos];
            }
          } else if (photo.status === "rejected") {
            pendingPhotos = pendingPhotos.filter((p) => p.id !== photo.id);
            approvedPhotos = approvedPhotos.filter((p) => p.id !== photo.id);
          }
        }
      } else if (msg.type === "photo:bulk-status-changed") {
        const { status, ids } = msg.payload || {};
        const idSet = new Set(ids || []);
        if (status === "pending") {
          const toMove = approvedPhotos
            .filter((p) => idSet.has(p.id))
            .map((p) => ({ ...p, status: "pending" }));
          approvedPhotos = approvedPhotos.filter((p) => !idSet.has(p.id));
          const existingPendingIds = new Set(pendingPhotos.map((p) => p.id));
          const newlyPending = toMove.filter(
            (p) => !existingPendingIds.has(p.id),
          );
          pendingPhotos = [...newlyPending, ...pendingPhotos];
        } else if (status === "approved") {
          const toMove = pendingPhotos
            .filter((p) => idSet.has(p.id))
            .map((p) => ({ ...p, status: "approved" }));
          pendingPhotos = pendingPhotos.filter((p) => !idSet.has(p.id));
          const existingApprovedIds = new Set(approvedPhotos.map((p) => p.id));
          const newlyApproved = toMove.filter(
            (p) => !existingApprovedIds.has(p.id),
          );
          approvedPhotos = [...newlyApproved, ...approvedPhotos];
        } else if (status === "rejected") {
          pendingPhotos = pendingPhotos.filter((p) => !idSet.has(p.id));
          approvedPhotos = approvedPhotos.filter((p) => !idSet.has(p.id));
        }
      } else if (msg.type === "photo:removed" || msg.type === "photo:deleted") {
        const removeId = msg.payload?.id;
        const removeHash = msg.payload?.hash;
        const removeFilename = msg.payload?.filename;
        const targetSlug = msg.payload?.event_slug || selectedEvent?.slug;

        // 1. Remove from Host active UI state
        approvedPhotos = approvedPhotos.filter(
          (p) => (removeId && (p.id == removeId || p.id === removeId)) ||
                 (removeHash && p.hash && p.hash === removeHash) ||
                 (removeFilename && p.filename && p.filename === removeFilename)
                 ? false : true,
        );
        pendingPhotos = pendingPhotos.filter(
          (p) => (removeId && (p.id == removeId || p.id === removeId)) ||
                 (removeHash && p.hash && p.hash === removeHash) ||
                 (removeFilename && p.filename && p.filename === removeFilename)
                 ? false : true,
        );

        // 2. Remove/mark deleted in Host IndexedDB
        if (removeHash) {
          db.photos.where("hash").equals(removeHash).delete().catch(() => {});
        }
        if (removeFilename && targetSlug) {
          db.photos.where({ event_slug: targetSlug, filename: removeFilename }).delete().catch(() => {});
        }
        if (removeId) {
          db.photos.delete(removeId).catch(() => {});
        }

        // 3. Decrement guest upload count in Host DB if guest_token is present
        if (msg.payload?.guest_token) {
          db.guests.where("token").equals(msg.payload.guest_token).modify(g => {
            g.upload_count = Math.max(0, (g.upload_count || 1) - 1);
          }).catch(() => {});
        }

        // 4. Update Host events / analytics counters
        loadEvents().catch(() => {});
        if (selectedEvent?.slug) {
          loadAnalytics(selectedEvent.slug).catch(() => {});
        }

        // 5. Re-broadcast the updated approved gallery so MQTT retained state & all devices update
        if (wsHandle && typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
    }
  }

  // --- HOST LOGIC ---
  async function checkAuth() {
    errorMsg = '';
    try {
      const res = await api.getAuthStatus();
      authStatus = res;
      if (res.host_name && !setupName) {
        setupName = res.host_name;
      }
      if (res.is_authenticated) {
        await loadEvents();
      }
    } catch (err) {
      errorMsg = err.message || "Failed to connect to server";
    }
  }

  async function handleHostLogin(e) {
    e.preventDefault();
    const name = (setupName || authStatus.host_name || "").trim();
    const pin = (unlockPin || setupPin || "").trim();
    if (!name || !pin) return;

    // Check if local Super Admin PIN was entered (restricted to local environment)
    const superAdminPin = (import.meta.env.VITE_SUPER_ADMIN_PIN || "").trim();
    if (isLocalEnvironment && superAdminPin && pin === superAdminPin) {
      isSuperAdminAuthenticated = true;
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("luminafeed_super_admin", "authenticated");
      }
      unlockPin = "";
      setupPin = "";
      navigate("/super-admin");
      return;
    }

    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.loginHost(name, pin);
      setSessionToken(res.session_token);
      authStatus = {
        initialized: true,
        is_authenticated: true,
        host_name: res.host_name,
      };
      unlockPin = "";
      setupPin = "";
      await loadEvents();
    } catch (err) {
      errorMsg = err.message || "Invalid Host credentials";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleHostRegister(e) {
    e.preventDefault();
    const name = setupName.trim();
    const pin = setupPin.trim();
    if (!name || !pin) return;

    if (setupPinConfirm && pin !== setupPinConfirm.trim()) {
      errorMsg = "Admin PIN confirmation does not match.";
      return;
    }

    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.registerHost(name, pin);
      setSessionToken(res.session_token);
      authStatus = {
        initialized: true,
        is_authenticated: true,
        host_name: res.host_name,
      };
      setupPin = "";
      setupPinConfirm = "";
      await loadEvents();
    } catch (err) {
      errorMsg = err.message || "Host registration failed";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleSetup(e) {
    return handleHostRegister(e);
  }

  async function handleUnlock(e) {
    return handleHostLogin(e);
  }

  function handleLogout() {
    api.logoutHost();
    setSessionToken("");
    authStatus.is_authenticated = false;
    authStatus.initialized = false;
    authStatus.host_name = "";
    hostView = "dashboard";
    selectedEvent = null;
    if (wsHandle) {
      wsHandle.disconnect();
      wsHandle = null;
    }
  }

  function openProfileModal() {
    editHostName = authStatus.host_name || "";
    currentPinInput = "";
    newPinInput = "";
    confirmNewPinInput = "";
    profileErrorMsg = "";
    profileSuccessMsg = "";
    isProfileModalOpen = true;
  }

  async function handleUpdateProfile(e) {
    e.preventDefault();
    profileErrorMsg = "";
    profileSuccessMsg = "";

    if (newPinInput && newPinInput !== confirmNewPinInput) {
      profileErrorMsg = "New PIN and confirmation do not match";
      return;
    }

    if (newPinInput && newPinInput.length < 4) {
      profileErrorMsg = "New Admin PIN must be at least 4 digits";
      return;
    }

    isSubmitting = true;
    try {
      const res = await api.updateHostProfile({
        host_name: editHostName,
        current_pin: currentPinInput,
        new_pin: newPinInput || undefined,
      });

      authStatus.host_name = res.host_name;
      profileSuccessMsg = "Profile & PIN updated successfully!";
      currentPinInput = "";
      newPinInput = "";
      confirmNewPinInput = "";
      setTimeout(() => {
        isProfileModalOpen = false;
        profileSuccessMsg = "";
      }, 1500);
    } catch (err) {
      profileErrorMsg = err.message || "Failed to update profile";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleResetHostSetup() {
    setSessionToken("");
    await api.resetHostSetup();
    authStatus = {
      initialized: false,
      is_authenticated: false,
      host_name: "",
    };
    setupName = "";
    setupPin = "";
    unlockPin = "";
  }

  async function loadEvents() {
    try {
      const currentHost = (authStatus?.host_name || "").trim();
      const res = await api.getEvents(currentHost);
      events = res.events || [];

      // 24-Hour Ephemeral Retention: Clean up expired events/hosts & update countdown
      storage.cleanupExpiredHostsAndEvents().catch(() => {});
      updateHostExpirationTimer();
    } catch (err) {
      console.error("Failed to load events", err);
    }
  }

  async function updateHostExpirationTimer() {
    if (!authStatus?.host_name || !storage.isStorageConfigured()) {
      hostRemainingText = "24h Active";
      return;
    }
    try {
      const details = await storage.getHostDetailsFromCloud(authStatus.host_name);
      if (details?.remainingMs != null) {
        if (details.remainingMs <= 0) {
          hostRemainingText = "Expired (24h)";
        } else {
          const totalMinutes = Math.floor(details.remainingMs / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const mins = totalMinutes % 60;
          hostRemainingText = `${hours}h ${mins}m left`;
        }
      } else {
        hostRemainingText = "24h Active";
      }
    } catch {
      hostRemainingText = "24h Active";
    }
  }

  async function loadEventGuests(slug) {
    if (!slug) return;
    isLoadingGuests = true;
    try {
      const res = await api.getGuests(slug);
      eventGuests = res.guests || [];
      if (selectedEvent) {
        selectedEvent = { ...selectedEvent, total_guests: eventGuests.length };
      }
    } catch (err) {
      console.warn("Failed to load guests:", err);
    } finally {
      isLoadingGuests = false;
    }
  }

  async function handleCreateEvent(e) {
    e.preventDefault();
    if (!newEvent.name.trim()) return;

    if (events.length >= 10) {
      errorMsg = "Maximum limit of 10 events reached. Please delete an existing event before creating a new one.";
      return;
    }

    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.createEvent({
        name: newEvent.name,
        date: newEvent.date,
        tagline: newEvent.tagline,
        moderation_enabled: newEvent.moderation_enabled,
        guest_upload_limit: Math.min(100, Math.max(1, Number(newEvent.guest_upload_limit) || 20)),
        max_photos: 100,
        exif_strip: newEvent.exif_strip ? 1 : 0,
        is_encrypted: newEvent.is_encrypted,
        host_name: authStatus.host_name || "Host",
      }, authStatus.host_name || "Host");

      isCreateModalOpen = false;
      newEvent = {
        name: "",
        date: new Date().toISOString().split("T")[0],
        tagline: "",
        moderation_enabled: false,
        guest_upload_limit: 20,
        exif_strip: true,
        is_encrypted: false,
      };
      await loadEvents();
      if (res.event) {
        storage.syncEventManifestToStorage(res.event, authStatus.host_name || "Host");
        await viewEvent(res.event);
      }
    } catch (err) {
      errorMsg = err.message || "Failed to create event";
    } finally {
      isSubmitting = false;
    }
  }

  async function viewEvent(event) {
    selectedEvent = event;
    hostView = "event_detail";
    hostDetailTab = "queue";
    loadEventGuests(event.slug);
    await loadHostEventPhotos(event.slug, true);
    startHostAutoSync(event.slug);
    setupWebSocket(event.slug, true);
  }

  async function loadHostEventPhotos(slug, forceCloudSync = true) {
    if (!slug) return;
    try {
      // 1. Instant local render from IndexedDB
      const [pendingRes, approvedRes] = await Promise.all([
        api.getPhotos(slug, { status: "pending" }),
        api.getPhotos(slug, { status: "approved" }),
      ]);
      pendingPhotos = pendingRes.photos || [];
      approvedPhotos = approvedRes.photos || [];
      decryptPhotosList(pendingPhotos).then((p) => { pendingPhotos = p; });
      decryptPhotosList(approvedPhotos).then((p) => { approvedPhotos = p; });

      // 2. Hydrate from Supabase Cloud Storage across networks
      if (forceCloudSync && storage.isStorageConfigured() && !isHostPhotoSyncing) {
        isHostPhotoSyncing = true;
        try {
          const syncRes = await api.syncPhotosFromCloud(slug, { isHost: true });
          if (syncRes && syncRes.success) {
            const [updatedPending, updatedApproved] = await Promise.all([
              api.getPhotos(slug, { status: "pending" }),
              api.getPhotos(slug, { status: "approved" }),
            ]);
            pendingPhotos = updatedPending.photos || [];
            approvedPhotos = updatedApproved.photos || [];
            decryptPhotosList(pendingPhotos).then((p) => { pendingPhotos = p; });
            decryptPhotosList(approvedPhotos).then((p) => { approvedPhotos = p; });
            lastHostSyncTime = new Date().toLocaleTimeString();
          }
        } catch (syncErr) {
          console.warn("Cloud photo sync warning:", syncErr);
        } finally {
          isHostPhotoSyncing = false;
        }
      }
    } catch (err) {
      console.error("Failed to load event photos for host", err);
    }
  }

  function startHostAutoSync(slug) {
    stopHostAutoSync();
    if (!slug) return;
    hostPhotoSyncTimer = setInterval(() => {
      if (hostView === "event_detail" && selectedEvent && selectedEvent.slug === slug) {
        loadHostEventPhotos(slug, true);
      }
    }, 5000);
  }

  function stopHostAutoSync() {
    if (hostPhotoSyncTimer) {
      clearInterval(hostPhotoSyncTimer);
      hostPhotoSyncTimer = null;
    }
  }

  async function loadAnalytics(slug) {
    if (!slug) return;
    try {
      const res = await api.getEventAnalytics(slug);
      eventAnalytics = res.analytics;
    } catch (err) {
      console.error("Failed to load event analytics", err);
      eventAnalytics = {
        total_photos: (pendingPhotos?.length || 0) + (approvedPhotos?.length || 0),
        approved: approvedPhotos?.length || 0,
        pending: pendingPhotos?.length || 0,
        rejected: 0,
        unique_guests: 1,
        storage_used_mb: "0.00",
        top_contributors: [],
        uploads_over_time: []
      };
    }
  }

  async function handleToggleEventStatus() {
    if (!selectedEvent) return;
    const newStatus = (selectedEvent.status || "active") === "active" ? "archived" : "active";
    const actionText = newStatus === "archived" ? "Close & Archive" : "Reopen";
    if (
      !confirm(
        `${actionText} event "${selectedEvent.name}"? ${newStatus === "archived" ? "Guest uploads will be disabled." : "Guest uploads will be re-enabled."}`,
      )
    )
      return;

    try {
      const res = await api.updateEventStatus(selectedEvent.slug, newStatus);
      selectedEvent = { ...selectedEvent, status: newStatus };
      storage.syncEventManifestToStorage(selectedEvent, authStatus.host_name || "Host");
      successMsg = res.message || `Event status updated to ${newStatus}`;
      setTimeout(() => (successMsg = ""), 3500);

      // Real-time broadcast status change to guest phones and TV slideshow
      if (wsHandle) {
        wsHandle.send({
          type: "event:status-changed",
          payload: { slug: selectedEvent.slug, status: newStatus }
        });
        if (typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to update event status: " + err.message);
    }
  }

  function openDeleteModal(event) {
    if (!event) return;
    selectedEvent = event;
    deleteConfirmInput = "";
    isDeleteModalOpen = true;
  }

  async function handleDeleteEvent() {
    if (!selectedEvent) return;
    const totalPhotos = (selectedEvent.total_photos || approvedPhotos.length + pendingPhotos.length || 0);
    const isNameConfirmed = deleteConfirmInput.trim().toLowerCase() === selectedEvent.name.trim().toLowerCase();
    
    // Only require typing the exact event name if the event contains photos
    if (totalPhotos > 0 && !isNameConfirmed) return;

    isSubmitting = true;
    const deletedEventName = selectedEvent.name;
    const deletedEventSlug = selectedEvent.slug;

    try {
      // 1. Delete from local IndexedDB
      try {
        await api.deleteEvent(deletedEventSlug);
      } catch (dbErr) {
        console.warn("api.deleteEvent notice:", dbErr);
      }

      // 2. Explicitly purge cloud manifests and files from Supabase Storage
      try {
        await storage.deleteEventFilesFromStorage(deletedEventSlug);
      } catch (storageErr) {
        console.warn("deleteEventFilesFromStorage notice:", storageErr);
      }

      // 3. Purge cloud database records from Supabase
      try {
        await storage.deleteCloudEvent(deletedEventSlug);
      } catch (cloudErr) {
        console.warn("deleteCloudEvent notice:", cloudErr);
      }

      // 4. Fallback direct local Dexie cleanup to guarantee zero remnants
      try {
        await db.events.where("slug").equals(deletedEventSlug).delete();
        await db.photos.where("event_slug").equals(deletedEventSlug).delete();
        await db.guests.where("event_slug").equals(deletedEventSlug).delete();
        await db.sync_logs.where("event_slug").equals(deletedEventSlug).delete();
      } catch (_) {}

      isDeleteModalOpen = false;
      deleteConfirmInput = "";
      selectedEvent = null;
      hostView = "dashboard";
      await loadEvents();

      successMsg = `🗑️ Event "${deletedEventName}" was permanently deleted.`;
      setTimeout(() => (successMsg = ""), 5000);
    } catch (err) {
      alert("Failed to delete event: " + (err.message || err));
    } finally {
      isSubmitting = false;
    }
  }

  // --- SUPER ADMIN GLOBAL TRACKER METHODS ---
  async function loadGlobalTracker() {
    isLoadingGlobalEvents = true;
    try {
      globalEvents = await storage.listAllGlobalEventsFromStorage();
    } catch (err) {
      console.error("Failed to load global events:", err);
    } finally {
      isLoadingGlobalEvents = false;
    }
  }

  function handleSuperAdminLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    superAdminError = "";
    if (!isLocalEnvironment) {
      superAdminError = "Super Admin is only accessible on your local computer.";
      return;
    }
    const expectedPin = (import.meta.env.VITE_SUPER_ADMIN_PIN || "").trim();
    if (!expectedPin) {
      superAdminError = "Super Admin PIN is not configured in client/.env.local (set VITE_SUPER_ADMIN_PIN)";
      return;
    }
    if (superAdminPinInput.trim() === expectedPin) {
      isSuperAdminAuthenticated = true;
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("luminafeed_super_admin", "authenticated");
      }
      superAdminPinInput = "";
      loadGlobalTracker();
    } else {
      superAdminError = "Incorrect Super Admin PIN";
    }
  }

  function handleSuperAdminLogout() {
    isSuperAdminAuthenticated = false;
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("luminafeed_super_admin");
    }
    superAdminPinInput = "";
    superAdminError = "";
    navigate("/super-admin");
  }

  async function handlePurgeGlobalEvent(ev) {
    if (!ev || !ev.slug) return;
    if (!confirm(`Are you sure you want to permanently purge "${ev.name}" (/${ev.slug}) from Supabase Storage and remove all cloud photos and manifests?`)) {
      return;
    }
    isLoadingGlobalEvents = true;
    try {
      await storage.deleteEventFilesFromStorage(ev.slug);
      await storage.deleteCloudEvent(ev.slug);
      await loadGlobalTracker();
    } catch (err) {
      alert("Failed to purge event: " + err.message);
    } finally {
      isLoadingGlobalEvents = false;
    }
  }

  async function decryptInspectedPhotosList(slug, photos, key) {
    if (!photos || photos.length === 0) return [];
    return Promise.all(
      photos.map(async (p) => {
        if (!p.is_encrypted || !key) return p;
        try {
          const decryptedBlob = await storage.fetchAndDecryptPhoto(
            p.thumb_url || p.storage_thumb_url,
            key
          );
          const decryptedUrl = URL.createObjectURL(decryptedBlob);
          return {
            ...p,
            decrypted_thumb_url: decryptedUrl,
            decrypted_orig_url: decryptedUrl,
          };
        } catch (e) {
          console.warn("Decryption of inspected thumbnail failed:", p.filename, e);
          return p;
        }
      })
    );
  }

  async function inspectGlobalEvent(ev) {
    inspectedGlobalEvent = ev;
    isLoadingInspectedPhotos = true;
    inspectedPhotos = [];
    inspectedEventKey = "";
    manualKeyInput = "";
    inspectedKeyStatus = "";

    try {
      const photos = await storage.listEventPhotosFromStorage(ev.slug);

      if (ev.is_encrypted) {
        // Option B: Attempt admin escrow key unwrapping
        if (ev.admin_wrapped_key) {
          try {
            const unwrapped = await crypto.unwrapEventKeyForAdmin(ev.admin_wrapped_key);
            if (unwrapped) {
              inspectedEventKey = unwrapped;
              inspectedKeyStatus = "escrow";
            }
          } catch (e) {
            console.warn("Option B escrow unwrap failed:", e);
          }
        }

        // Check local storage for key
        if (!inspectedEventKey) {
          const storedKey = crypto.getStoredEventKey(ev.slug);
          if (storedKey) {
            inspectedEventKey = storedKey;
            inspectedKeyStatus = "manual";
          }
        }

        if (!inspectedEventKey) {
          inspectedKeyStatus = "none";
        }
      } else {
        inspectedKeyStatus = "unencrypted";
      }

      inspectedPhotos = await decryptInspectedPhotosList(ev.slug, photos, inspectedEventKey);
    } catch (err) {
      console.error("Failed to list inspected event photos:", err);
    } finally {
      isLoadingInspectedPhotos = false;
    }
  }

  async function applyManualKeyToInspect() {
    if (!manualKeyInput.trim() || !inspectedGlobalEvent) return;
    const key = manualKeyInput.trim();
    inspectedEventKey = key;
    inspectedKeyStatus = "manual";
    crypto.setStoredEventKey(inspectedGlobalEvent.slug, key);
    isLoadingInspectedPhotos = true;
    try {
      const photos = await storage.listEventPhotosFromStorage(inspectedGlobalEvent.slug);
      inspectedPhotos = await decryptInspectedPhotosList(inspectedGlobalEvent.slug, photos, key);
    } catch (e) {
      console.error("Failed to decrypt with manual key:", e);
    } finally {
      isLoadingInspectedPhotos = false;
    }
  }

  function exportGlobalReport() {
    if (!globalEvents || globalEvents.length === 0) return;
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(globalEvents, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", jsonStr);
    dlAnchor.setAttribute("download", `luminafeed-global-events-${new Date().toISOString().split("T")[0]}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  async function syncCurrentApprovedListToStorage() {
    if (!storage.isStorageConfigured() || !selectedEvent) return;
    try {
      const paths = approvedPhotos.map((p) => p.storage_orig_path || p.filename).filter(Boolean);
      await storage.syncApprovedListToStorage(selectedEvent.slug, paths);
    } catch (e) {
      console.warn("syncApprovedList error:", e);
    }
  }

  async function handleApprovePhoto(photoId) {
    try {
      await api.patchPhotoStatus(selectedEvent.slug, photoId, "approved");
      const photo = pendingPhotos.find((p) => p.id === photoId);
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      if (photo) {
        const approvedItem = { ...photo, status: "approved" };
        approvedPhotos = [approvedItem, ...approvedPhotos];
        syncCurrentApprovedListToStorage();
        if (wsHandle) {
          const dbRecord = await db.photos.get(photoId);
          let thumbDataUrl = photo.thumbDataUrl;
          if (!thumbDataUrl && dbRecord?.thumb_blob) {
            thumbDataUrl = await blobToBase64(dbRecord.thumb_blob);
          }

          wsHandle.send({
            type: "photo:approved",
            payload: {
              id: approvedItem.id,
              hash: approvedItem.hash,
              event_slug: approvedItem.event_slug,
              guest_name: approvedItem.guest_name,
              status: "approved",
              created_at: approvedItem.created_at,
              filename: approvedItem.filename,
              storage_orig_url: approvedItem.storage_orig_url,
              storage_thumb_url: approvedItem.storage_thumb_url,
              original_url: approvedItem.original_url || approvedItem.storage_orig_url,
              thumb_url: approvedItem.thumb_url || approvedItem.storage_thumb_url,
              original_path: approvedItem.original_path || approvedItem.storage_orig_url,
              thumbnail_path: approvedItem.thumbnail_path || approvedItem.storage_thumb_url,
              thumbDataUrl,
            },
          });
        }

        // Asynchronously ensure photo is uploaded to Google Drive if connected
        if (gdrive.isDriveConnected() && selectedEvent) {
          gdrive.setupEventDriveHierarchy(selectedEvent.slug, selectedEvent.name).then(async ({ originalsFolderId, thumbnailsFolderId }) => {
            const dbRecord = await db.photos.get(photoId);
            if (!dbRecord) return;
            let driveOrigId = dbRecord.drive_orig_id;
            let driveThumbId = dbRecord.drive_thumb_id;

            if (!driveOrigId && dbRecord.original_blob) {
              const up = await gdrive.uploadBlobToDrive(originalsFolderId, dbRecord.filename, dbRecord.original_blob, dbRecord.mime_type || 'image/jpeg');
              driveOrigId = up.id;
            }
            if (!driveThumbId && dbRecord.thumb_blob) {
              const upThumb = await gdrive.uploadBlobToDrive(thumbnailsFolderId, `thumb_${dbRecord.filename}`, dbRecord.thumb_blob, 'image/jpeg');
              driveThumbId = upThumb.id;
            }

            if (driveOrigId || driveThumbId) {
              const driveOrigUrl = driveOrigId ? gdrive.getDriveCDNUrl(driveOrigId, 2048) : '';
              const driveThumbUrl = driveThumbId ? gdrive.getDriveThumbnailUrl(driveThumbId, 400) : driveOrigUrl;
              await db.photos.update(photoId, {
                drive_orig_id: driveOrigId,
                drive_thumb_id: driveThumbId,
                drive_orig_url: driveOrigUrl,
                drive_thumb_url: driveThumbUrl
              });
              if (wsHandle && typeof wsHandle.broadcastGallery === 'function') {
                wsHandle.broadcastGallery();
              }
            }
          }).catch(err => console.warn('Drive auto-upload on approve error:', err));
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to approve photo: " + err.message);
    }
  }

  async function handleToggleAutoApprove() {
    if (!selectedEvent) return;
    const newModState = !selectedEvent.moderation_enabled;
    const isAutoNow = !newModState;

    try {
      await api.updateEvent(selectedEvent.slug, {
        moderation_enabled: newModState
      });

      selectedEvent = { ...selectedEvent, moderation_enabled: newModState };

      if (isAutoNow) {
        successMsg = "⚡ Auto-Approve enabled! All new guest uploads will stream live immediately.";
        if (pendingPhotos.length > 0) {
          if (confirm(`Auto-Approve is now ON! Would you like to approve the ${pendingPhotos.length} photo(s) currently waiting in queue?`)) {
            await handleBulkApprove();
          }
        }
      } else {
        successMsg = "🛡️ Manual moderation enabled! New photos will wait for your review in this queue.";
      }
      setTimeout(() => (successMsg = ""), 4500);

      // Real-time broadcast updated settings to all guest devices and slideshows
      if (wsHandle) {
        wsHandle.send({
          type: "event:settings-updated",
          payload: {
            slug: selectedEvent.slug,
            event_settings: {
              moderation_enabled: newModState,
              name: selectedEvent.name,
              tagline: selectedEvent.tagline,
              guest_upload_limit: selectedEvent.guest_upload_limit
            }
          }
        });
        if (typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to toggle moderation mode: " + err.message);
    }
  }

  async function handleCheckboxToggleModeration(e) {
    if (!selectedEvent) return;
    const newModState = Boolean(e.target.checked);
    selectedEvent = { ...selectedEvent, moderation_enabled: newModState };

    try {
      await api.updateEvent(selectedEvent.slug || selectedEvent.id, {
        moderation_enabled: newModState
      });
      successMsg = newModState 
        ? "🛡️ Live Photo Moderation enabled!" 
        : "⚡ Auto-Approve enabled (Live Moderation turned off)";
      setTimeout(() => (successMsg = ""), 3500);

      if (wsHandle) {
        wsHandle.send({
          type: "event:settings-updated",
          payload: {
            slug: selectedEvent.slug,
            event_settings: {
              moderation_enabled: newModState,
              name: selectedEvent.name,
              tagline: selectedEvent.tagline,
              guest_upload_limit: selectedEvent.guest_upload_limit
            }
          }
        });
        if (typeof wsHandle.broadcastGallery === "function") {
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to update moderation setting: " + err.message);
    }
  }

  async function handleRejectPhoto(photoId, photoObj = null) {
    try {
      const photo = photoObj || pendingPhotos.find((p) => p.id === photoId);
      if (photo) {
        storage.deleteIndividualPhotoFromStorage(photo, selectedEvent?.slug).catch(err => {
          console.warn("Could not delete rejected photo from Supabase:", err);
        });
      }
      await api.patchPhotoStatus(selectedEvent.slug, photoId, "rejected");
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      syncCurrentApprovedListToStorage();
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: { id: photoId, hash: photo?.hash },
        });
        wsHandle.broadcastGallery();
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to reject photo: " + err.message);
    }
  }

  async function handleRevertPhoto(photoId) {
    try {
      const res = await api.patchPhotoStatus(
        selectedEvent.slug,
        photoId,
        "pending",
      );
      const photo =
        (res && res.photo) || approvedPhotos.find((p) => p.id === photoId);
      approvedPhotos = approvedPhotos.filter((p) => p.id !== photoId);
      if (photo) {
        const revertedItem = { ...photo, status: "pending" };
        pendingPhotos = [
          revertedItem,
          ...pendingPhotos.filter((p) => p.id !== photoId),
        ];
        syncCurrentApprovedListToStorage();
        if (wsHandle) {
          wsHandle.send({
            type: "photo:removed",
            payload: { id: photoId, hash: photo?.hash },
          });
          wsHandle.broadcastGallery();
        }
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to revert photo: " + err.message);
    }
  }

  async function handleDeleteLivePhoto(photoId, photoObj = null) {
    if (!confirm("Permanently delete this photo from the live gallery and Supabase Cloud Storage?")) return;
    try {
      const photo = photoObj || approvedPhotos.find((p) => p.id === photoId) || pendingPhotos.find((p) => p.id === photoId);
      
      // Delete photo assets from Supabase Cloud Storage individually
      if (photo) {
        await storage.deleteIndividualPhotoFromStorage(photo, selectedEvent?.slug);
      }

      await api.patchPhotoStatus(selectedEvent.slug, photoId, "rejected");
      approvedPhotos = approvedPhotos.filter((p) => p.id !== photoId);
      pendingPhotos = pendingPhotos.filter((p) => p.id !== photoId);
      syncCurrentApprovedListToStorage();
      if (selectedPreviewPhoto && selectedPreviewPhoto.id === photoId) {
        selectedPreviewPhoto = null;
      }
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: { id: photoId, hash: photo?.hash },
        });
        wsHandle.broadcastGallery();
      }
      await loadEvents();
      successMsg = "Photo deleted from Live Gallery and Supabase Cloud Storage!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to delete photo: " + err.message);
    }
  }

  async function handleBulkApprove() {
    if (!pendingPhotos.length) return;
    const ids = pendingPhotos.map((p) => p.id);
    try {
      await api.bulkPatchPhotoStatus(selectedEvent.slug, ids, "approved");
      const newlyApproved = [];
      for (const p of pendingPhotos) {
        let thumbDataUrl = p.thumbDataUrl;
        if (!thumbDataUrl) {
          const dbRecord = await db.photos.get(p.id);
          if (dbRecord?.thumb_blob) {
            thumbDataUrl = await blobToBase64(dbRecord.thumb_blob);
          }
        }
        newlyApproved.push({
          ...p,
          status: "approved",
          storage_orig_url: p.storage_orig_url,
          storage_thumb_url: p.storage_thumb_url,
          original_url: p.original_url || p.storage_orig_url,
          thumb_url: p.thumb_url || p.storage_thumb_url,
          original_path: p.original_path || p.storage_orig_url,
          thumbnail_path: p.thumbnail_path || p.storage_thumb_url,
          thumbDataUrl,
        });
      }
      approvedPhotos = [...newlyApproved, ...approvedPhotos];
      pendingPhotos = [];
      syncCurrentApprovedListToStorage();
      if (wsHandle && newlyApproved.length > 0) {
        wsHandle.send({
          type: "photo:bulk-approved",
          payload: { photos: newlyApproved },
        });
      }

      // Background auto-upload approved photos to Google Drive
      if (gdrive.isDriveConnected() && selectedEvent) {
        gdrive.setupEventDriveHierarchy(selectedEvent.slug, selectedEvent.name).then(async ({ originalsFolderId, thumbnailsFolderId }) => {
          for (const id of ids) {
            try {
              const dbRecord = await db.photos.get(id);
              if (!dbRecord) continue;
              let driveOrigId = dbRecord.drive_orig_id;
              let driveThumbId = dbRecord.drive_thumb_id;

              if (!driveOrigId && dbRecord.original_blob) {
                const up = await gdrive.uploadBlobToDrive(originalsFolderId, dbRecord.filename, dbRecord.original_blob, dbRecord.mime_type || 'image/jpeg');
                driveOrigId = up.id;
              }
              if (!driveThumbId && dbRecord.thumb_blob) {
                const upThumb = await gdrive.uploadBlobToDrive(thumbnailsFolderId, `thumb_${dbRecord.filename}`, dbRecord.thumb_blob, 'image/jpeg');
                driveThumbId = upThumb.id;
              }

              if (driveOrigId || driveThumbId) {
                await db.photos.update(id, {
                  drive_orig_id: driveOrigId,
                  drive_thumb_id: driveThumbId,
                  drive_orig_url: driveOrigId ? gdrive.getDriveCDNUrl(driveOrigId, 2048) : '',
                  drive_thumb_url: driveThumbId ? gdrive.getDriveThumbnailUrl(driveThumbId, 400) : ''
                });
              }
            } catch (err) {
              console.warn(`Bulk drive upload failed for photo ${id}:`, err);
            }
          }
          if (wsHandle && typeof wsHandle.broadcastGallery === 'function') {
            wsHandle.broadcastGallery();
          }
        }).catch(err => console.warn('Could not setup Drive hierarchy during bulk approve:', err));
      }      
      await loadEvents();
    } catch (err) {
      alert("Failed to bulk approve: " + err.message);
    }
  }

  async function handleBulkReject() {
    if (!pendingPhotos.length) return;
    if (!confirm(`Reject and remove all ${pendingPhotos.length} pending photos from Supabase Cloud Storage?`)) return;
    const ids = pendingPhotos.map((p) => p.id);
    const photosToPurge = [...pendingPhotos];
    try {
      for (const p of photosToPurge) {
        storage.deleteIndividualPhotoFromStorage(p, selectedEvent?.slug).catch(() => {});
      }
      await api.bulkPatchPhotoStatus(selectedEvent.slug, ids, "rejected");
      pendingPhotos = [];
      syncCurrentApprovedListToStorage();
      if (wsHandle) {
        wsHandle.send({
          type: "photo:bulk-removed",
          payload: { ids },
        });
      }
      await loadEvents();
      successMsg = "Rejected photos removed from moderation queue and Supabase Storage!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to bulk reject: " + err.message);
    }
  }

  // --- SUPABASE CLOUD STORAGE & BYOK BACKEND STATE ---
  let isStorageModalOpen = $state(false);
  let isStorageConfigured = $state(storage.isStorageConfigured());
  let currentBaaSConfig = $state(storage.getBaaSConfig());
  let storageSetupTab = $state(storage.getBaaSConfig().isCustom ? "custom" : "default"); // "default" | "custom"
  let customSupabaseUrl = $state(localStorage.getItem('luminafeed_custom_supabase_url') || "");
  let customSupabaseAnonKey = $state(localStorage.getItem('luminafeed_custom_supabase_anon_key') || "");
  let customSupabaseBucket = $state(localStorage.getItem('luminafeed_custom_supabase_bucket') || "luminafeed-photos");
  let isTestingStorage = $state(false);
  let storageTestResult = $state(null);
  let isSavingCustomStorage = $state(false);
  let sqlCopied = $state(false);

  function openStorageSettingsModal() {
    currentBaaSConfig = storage.getBaaSConfig();
    storageSetupTab = currentBaaSConfig.isCustom ? "custom" : "default";
    customSupabaseUrl = localStorage.getItem('luminafeed_custom_supabase_url') || "";
    customSupabaseAnonKey = localStorage.getItem('luminafeed_custom_supabase_anon_key') || "";
    customSupabaseBucket = localStorage.getItem('luminafeed_custom_supabase_bucket') || "luminafeed-photos";
    storageTestResult = null;
    isStorageModalOpen = true;
  }

  async function handleTestStorageConnection() {
    isTestingStorage = true;
    storageTestResult = null;
    try {
      let probe = null;
      if (storageSetupTab === "custom") {
        if (!customSupabaseUrl.trim() || !customSupabaseAnonKey.trim()) {
          storageTestResult = {
            success: false,
            message: "⚠️ Please enter your Supabase Project URL and Public Anon Key before testing.",
          };
          isTestingStorage = false;
          return;
        }
        probe = {
          url: customSupabaseUrl.trim(),
          anonKey: customSupabaseAnonKey.trim(),
          bucket: (customSupabaseBucket || 'luminafeed-photos').trim(),
        };
      }
      const res = await storage.testStorageConnection(probe, 8000);
      storageTestResult = {
        success: res.ok,
        message: res.message,
      };
    } catch (err) {
      storageTestResult = {
        success: false,
        message: "⚠️ Connection test failed: " + err.message,
      };
    } finally {
      isTestingStorage = false;
    }
  }

  async function handleSaveCustomStorage() {
    if (!customSupabaseUrl.trim() || !customSupabaseAnonKey.trim()) {
      alert("Please enter both your Supabase Project URL and Public Anon Key.");
      return;
    }
    if (!customSupabaseUrl.trim().startsWith("http://") && !customSupabaseUrl.trim().startsWith("https://")) {
      alert("Project URL must start with https:// or http://");
      return;
    }

    isSavingCustomStorage = true;
    storageTestResult = null;
    try {
      storage.setCustomBaaSConfig({
        url: customSupabaseUrl.trim(),
        anonKey: customSupabaseAnonKey.trim(),
        bucket: (customSupabaseBucket || 'luminafeed-photos').trim(),
      });
      currentBaaSConfig = storage.getBaaSConfig();
      isStorageConfigured = storage.isStorageConfigured();
      storageSetupTab = "custom";
      
      const res = await storage.testStorageConnection(null, 8000);
      storageTestResult = {
        success: res.ok,
        message: res.ok ? "⚡ Custom Supabase configuration saved and verified successfully!" : res.message,
      };
      await loadEvents();
    } catch (err) {
      storageTestResult = {
        success: false,
        message: "⚠️ Failed to save configuration: " + err.message,
      };
    } finally {
      isSavingCustomStorage = false;
    }
  }

  async function handleResetToDefaultStorage() {
    storage.resetToDefaultBaaS();
    currentBaaSConfig = storage.getBaaSConfig();
    isStorageConfigured = storage.isStorageConfigured();
    storageSetupTab = "default";
    customSupabaseUrl = "";
    customSupabaseAnonKey = "";
    customSupabaseBucket = "luminafeed-photos";
    storageTestResult = {
      success: true,
      message: "🛡️ Fail-safe activated: Successfully restored to default managed Supabase Cloud backend!",
    };
    try {
      await loadEvents();
    } catch (_) {}
  }

  function handleCopySQLScript() {
    const script = storage.get1ClickSQLSetupScript(customSupabaseBucket || 'luminafeed-photos');
    navigator.clipboard.writeText(script);
    sqlCopied = true;
    setTimeout(() => (sqlCopied = false), 3000);
  }

  // --- GOOGLE DRIVE 1-CLICK OAUTH & ZIP EXPORTS (Optional Secondary Backup) ---
  let isDriveModalOpen = $state(false);
  let gdriveClientId = $state(
    gdrive.getEffectiveClientId(),
  );
  let gdriveClientIdInput = $state(
    gdrive.getEffectiveClientId(),
  );
  let isDriveConnected = $state(Boolean(gdrive.isDriveConnected()));
  let isConnectingDrive = $state(false);
  let isSyncingDrive = $state(false);
  let driveSyncProgress = $state("");
  let driveEventFolderUrl = $state("");

  let syncingEventSlug = $state("");

  async function handleConnectGoogleDrive(forceModal = false) {
    let clientId = gdrive.getEffectiveClientId(gdriveClientIdInput || gdriveClientId);
    if (!clientId || forceModal) {
      isDriveModalOpen = true;
      return;
    }
    isConnectingDrive = true;
    errorMsg = "";
    try {
      localStorage.setItem("caps_gdrive_client_id", clientId);
      gdriveClientId = clientId;
      await gdrive.requestGoogleDriveAuth(clientId);
      isDriveConnected = true;
      isDriveModalOpen = false;

      if (selectedEvent) {
        try {
          const hierarchy = await gdrive.setupEventDriveHierarchy(selectedEvent.slug, selectedEvent.name);
          driveEventFolderUrl = hierarchy.folderUrl;
        } catch (e) {
          console.warn("Could not pre-initialize Drive hierarchy:", e);
        }
      }

      successMsg = "☁️ Google Drive connected successfully! Ready to create and host events.";
      setTimeout(() => (successMsg = ""), 4500);

      // Broadcast gallery to active peers
      if (wsHandle && typeof wsHandle.broadcastGallery === "function") {
        wsHandle.broadcastGallery();
      }
    } catch (err) {
      alert("Google Drive authorization failed: " + err.message);
    } finally {
      isConnectingDrive = false;
    }
  }

  function handleDisconnectGoogleDrive() {
    gdrive.disconnectGoogleDrive();
    isDriveConnected = false;
    driveEventFolderUrl = "";
    successMsg = "Disconnected from Google Drive.";
    setTimeout(() => (successMsg = ""), 3000);
    isDriveModalOpen = false;
  }

  async function handleBackupEventToDrive(event) {
    if (!event) return;
    const slug = event.slug;
    const eventName = event.name || slug;
    syncingEventSlug = slug;

    // If not yet connected to Google Drive, open Google login to authorize
    if (!isDriveConnected) {
      isConnectingDrive = true;
      try {
        const clientId = gdrive.getEffectiveClientId(gdriveClientIdInput || gdriveClientId);
        if (!clientId) {
          isDriveModalOpen = true;
          isConnectingDrive = false;
          syncingEventSlug = "";
          return;
        }
        localStorage.setItem("caps_gdrive_client_id", clientId);
        gdriveClientId = clientId;
        await gdrive.requestGoogleDriveAuth(clientId);
        isDriveConnected = true;
        isDriveModalOpen = false;
        successMsg = `☁️ Connected to Google! Starting backup for "${eventName}"...`;
        setTimeout(() => (successMsg = ""), 3500);
      } catch (err) {
        alert("Google Drive authorization failed: " + err.message);
        isConnectingDrive = false;
        syncingEventSlug = "";
        return;
      } finally {
        isConnectingDrive = false;
      }
    }

    // Now proceed with backing up the event photos to Google Drive
    isSyncingDrive = true;
    driveSyncProgress = `Connecting to Google Drive for "${eventName}"...`;
    try {
      const res = await gdrive.syncEventToGoogleDrive(slug, (p) => {
        driveSyncProgress = p.message || `Backing up ${p.percent || 0}%...`;
      });
      if (res.folder_url) {
        driveEventFolderUrl = res.folder_url;
      }
      successMsg = `✨ Backed up ${res.synced_count} photos from "${eventName}" to Google Drive!`;
      setTimeout(() => (successMsg = ""), 5000);
    } catch (err) {
      alert("Google Drive backup failed: " + err.message);
    } finally {
      isSyncingDrive = false;
      driveSyncProgress = "";
      syncingEventSlug = "";
    }
  }

  async function handleSyncToGoogleDrive(slug) {
    const ev = (selectedEvent && selectedEvent.slug === slug)
      ? selectedEvent
      : (events.find((e) => e.slug === slug) || { slug, name: slug });
    return handleBackupEventToDrive(ev);
  }

  let isExportingArchive = $state(false);
  async function handleExportFullArchive(slug) {
    isExportingArchive = true;
    try {
      await downloadFullArchiveZip(slug, (p) => {
        uploadProgressText = p.message || `Generating archive...`;
      });
      successMsg = "Full archive downloaded!";
      setTimeout(() => (successMsg = ""), 4000);
    } catch (err) {
      alert("Failed to export archive: " + err.message);
    } finally {
      isExportingArchive = false;
      uploadProgressText = "";
    }
  }

  async function handleSaveSlideshowConfig() {
    if (!selectedEvent) return;
    try {
      await api.updateSlideshowConfig(selectedEvent.slug, {
        interval: selectedEvent.slideshow_interval,
        transition: selectedEvent.slideshow_transition,
        show_qr: selectedEvent.slideshow_show_qr,
        show_author: selectedEvent.slideshow_show_author,
      });
      successMsg = "Slideshow settings saved!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to save slideshow settings: " + err.message);
    }
  }

  let logoFileInputEl = $state();
  let isUploadingLogo = $state(false);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !selectedEvent) return;
    isUploadingLogo = true;
    try {
      const res = await api.uploadEventLogo(selectedEvent.slug, file);
      selectedEvent.logo = res.logo;
      successMsg = "Event logo uploaded successfully!";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to upload logo: " + err.message);
    } finally {
      isUploadingLogo = false;
      e.target.value = "";
    }
  }

  async function handleRemoveLogo() {
    if (!selectedEvent || !confirm("Remove custom logo from this event?"))
      return;
    try {
      await api.deleteEventLogo(selectedEvent.slug);
      selectedEvent.logo = null;
      successMsg = "Event logo removed.";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to remove logo: " + err.message);
    }
  }

  async function handleSaveBranding() {
    if (!selectedEvent) return;
    try {
      await api.updateEventBranding(selectedEvent.slug, {
        tagline: selectedEvent.tagline,
        primary_color: selectedEvent.primary_color,
      });
      successMsg = "Event branding updated!";
      setTimeout(() => (successMsg = ""), 3000);
      await loadEvents();
    } catch (err) {
      alert("Failed to save branding: " + err.message);
    }
  }

  async function handleSaveEventSettings() {
    if (!selectedEvent) return;
    try {
      const res = await api.updateEvent(selectedEvent.slug, {
        name: selectedEvent.name,
        tagline: selectedEvent.tagline,
        guest_upload_limit: Math.min(100, Math.max(1, Number(selectedEvent.guest_upload_limit) || 20)),
        moderation_enabled: selectedEvent.moderation_enabled,
        exif_strip: selectedEvent.exif_strip,
      });
      selectedEvent = { ...selectedEvent, ...res.event };
      successMsg = "Event settings & upload limit saved successfully!";
      setTimeout(() => (successMsg = ""), 3000);

      if (wsHandle) {
        wsHandle.send({
          type: "event:settings-updated",
          payload: {
            slug: selectedEvent.slug,
            event_settings: {
              name: selectedEvent.name,
              tagline: selectedEvent.tagline,
              guest_upload_limit: selectedEvent.guest_upload_limit,
              moderation_enabled: selectedEvent.moderation_enabled,
              status: selectedEvent.status,
            },
          },
        });
      }
      await loadEvents();
    } catch (err) {
      alert("Failed to save event settings: " + err.message);
    }
  }

  async function refreshHostIp(showToast = true) {
    isDetectingIp = true;
    try {
      const ip = await api.detectLocalIP();
      if (ip) {
        detectedHostIp = ip;
        api.setStoredHostIP(ip);
        if (showToast) {
          successMsg = `📡 Host IP dynamically resolved: ${ip}`;
          setTimeout(() => (successMsg = ""), 3500);
        }
        if (isQrModalOpen && selectedEvent) {
          await fetchQrData();
        }
      }
    } catch (e) {
      console.warn("IP detection warning:", e);
    } finally {
      isDetectingIp = false;
    }
  }

  async function copyEventJoinUrl(urlToCopy = "") {
    const url = urlToCopy || qrData?.join_url || api.buildDynamicEventJoinUrl(selectedEvent?.slug, { hostIp: detectedHostIp });
    try {
      await navigator.clipboard.writeText(url);
      successMsg = "📋 Event join link copied to clipboard!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      successMsg = "📋 Event join link copied to clipboard!";
      setTimeout(() => (successMsg = ""), 3000);
    }
  }

  async function handleDownloadSign() {
    if (!selectedEvent) return;
    try {
      const joinUrl = qrData?.join_url || api.buildDynamicEventJoinUrl(selectedEvent.slug, { hostIp: detectedHostIp });
      await downloadPrintableSign(selectedEvent, joinUrl);
      successMsg = "🖨️ Printable QR table card generated and downloaded!";
      setTimeout(() => (successMsg = ""), 3500);
    } catch (err) {
      alert("Failed to generate table sign: " + err.message);
    }
  }

  async function openQrModal(event, projection = false) {
    selectedEvent = event;
    isProjectionMode = projection;
    isQrModalOpen = true;
    if (isLocalEnvironment && !detectedHostIp) {
      await refreshHostIp(false);
    }
    await fetchQrData();
  }

  async function fetchQrData() {
    if (!selectedEvent) return;
    try {
      if (isLocalEnvironment && !detectedHostIp) {
        await refreshHostIp(false);
      }
      const activeIp = detectedHostIp || api.getStoredHostIP() || "";
      qrData = await api.getEventQR(selectedEvent.slug, {
        hostIp: activeIp,
        hostType: qrHostType
      });
    } catch (err) {
      console.error("Failed to fetch QR", err);
    }
  }

  // --- GUEST LOGIC ---
  async function loadGuestExperience(slug) {
    try {
      errorMsg = "";
      const eventRes = await api.getEvent(slug);
      guestEventData = eventRes.event;

      const galleryRes = await api.getPhotos(slug, { status: "approved" });
      liveGalleryPhotos = galleryRes.photos || [];
      decryptPhotosList(liveGalleryPhotos).then((p) => { liveGalleryPhotos = p; });

      // Hydrate approved photos from Supabase Cloud Storage across networks
      if (storage.isStorageConfigured()) {
        api.syncPhotosFromCloud(slug, { isHost: false }).then(async (syncRes) => {
          if (syncRes && syncRes.deleted) {
            stopGuestAutoSync();
            guestEventData = null;
            guestSession = null;
            myUploads = [];
            liveGalleryPhotos = [];
            errorMsg = "This event has ended or was deleted by the host.";
            return;
          }
          if (syncRes && syncRes.success) {
            const updatedGallery = await api.getPhotos(slug, { status: "approved" });
            liveGalleryPhotos = updatedGallery.photos || [];
            decryptPhotosList(liveGalleryPhotos).then((p) => { liveGalleryPhotos = p; });
          }
        }).catch((err) => console.warn("Guest cloud sync warning:", err));
      }

      // Start automatic periodic cloud sync for live memories wall
      startGuestAutoSync(slug);

      const existingToken = getGuestToken(slug);
      if (existingToken) {
        try {
          const session = await api.getGuestSession(slug, existingToken);
          if (session && session.guest) {
            const eventObj = session.event ||
              guestEventData || { guest_upload_limit: 20 };
            const limit = Number(eventObj.guest_upload_limit) || 20;
            const used = Number(session.guest.upload_count) || 0;
            guestSession = {
              guest: session.guest,
              event: eventObj,
              quota: session.quota || {
                used,
                limit,
                remaining: Math.max(0, limit - used),
              },
            };
            await loadMyUploads(slug, existingToken);
          } else {
            setGuestToken(slug, "");
            guestSession = null;
          }
        } catch {
          setGuestToken(slug, "");
          guestSession = null;
        }
      } else {
        guestSession = null;
      }
    } catch (err) {
      console.error("loadGuestExperience error:", err);
      stopGuestAutoSync();
      guestEventData = null;
      guestSession = null;
      myUploads = [];
      liveGalleryPhotos = [];
      errorMsg = err.message || "Event space not found. This event may have ended or was deleted by the host.";
    }
  }

  async function syncGuestPhotos(slug) {
    if (!slug || isGuestPhotoSyncing) return;
    if (!storage.isStorageConfigured()) return;

    isGuestPhotoSyncing = true;
    try {
      const syncRes = await api.syncPhotosFromCloud(slug, { isHost: false });
      if (syncRes && syncRes.deleted) {
        stopGuestAutoSync();
        guestEventData = null;
        guestSession = null;
        myUploads = [];
        liveGalleryPhotos = [];
        errorMsg = "This event has ended or was deleted by the host.";
        return;
      }

      if (syncRes && syncRes.success) {
        const updatedGallery = await api.getPhotos(slug, { status: "approved" });
        const currentFingerprint = liveGalleryPhotos
          .map((p) => p.storage_orig_path || p.hash || p.id)
          .join("|");
        const newPhotos = updatedGallery.photos || [];
        const newFingerprint = newPhotos
          .map((p) => p.storage_orig_path || p.hash || p.id)
          .join("|");

        if (currentFingerprint !== newFingerprint) {
          liveGalleryPhotos = newPhotos;
          decryptPhotosList(newPhotos).then((p) => {
            liveGalleryPhotos = p;
          });
        }
      }
      lastGuestSyncTime = new Date();
    } catch (err) {
      console.warn("Guest auto-sync error:", err);
    } finally {
      isGuestPhotoSyncing = false;
    }
  }

  function startGuestAutoSync(slug) {
    stopGuestAutoSync();
    if (!slug) return;
    guestPhotoSyncTimer = setInterval(() => {
      if (isGuestRoute && guestEventData && guestEventData.slug === slug) {
        syncGuestPhotos(slug);
      }
    }, 5000);
  }

  function stopGuestAutoSync() {
    if (guestPhotoSyncTimer) {
      clearInterval(guestPhotoSyncTimer);
      guestPhotoSyncTimer = null;
    }
  }

  async function loadMyUploads(slug, token) {
    try {
      const res = await api.getPhotos(slug, { guest: "me", guestToken: token });
      myUploads = res.photos || [];
      decryptPhotosList(myUploads).then((p) => { myUploads = p; });
    } catch (err) {
      console.error("Failed to load guest uploads", err);
    }
  }

  async function handleGuestJoin(e) {
    e.preventDefault();
    if (!guestNameInput.trim() || !currentEventSlug) return;
    isSubmitting = true;
    errorMsg = "";
    try {
      const res = await api.joinEvent(currentEventSlug, guestNameInput, guestPasscodeInput);
      setGuestToken(currentEventSlug, res.guest.token);
      const eventObj = res.event ||
        guestEventData || {
          slug: currentEventSlug,
          name: currentEventSlug.replace(/-/g, " ").toUpperCase(),
          date: new Date().toISOString().split("T")[0],
          guest_upload_limit: 20,
          status: "active",
        };
      guestEventData = eventObj;
      const limit = Number(eventObj.guest_upload_limit) || 20;
      const used = Number(res.guest?.upload_count) || 0;
      guestSession = {
        guest: res.guest,
        event: eventObj,
        isReturning: Boolean(res.isReturning),
        quota: {
          used,
          limit,
          remaining: Math.max(0, limit - used),
        },
      };
      guestNameInput = "";
      guestPasscodeInput = "";
      await loadMyUploads(currentEventSlug, res.guest.token);
      if (wsHandle) {
        wsHandle.notifyGuestJoin({
          name: res.guest.name,
          token: res.guest.token,
        });
        if (typeof wsHandle.requestGallerySync === "function") {
          wsHandle.requestGallerySync();
        }
      }
    } catch (err) {
      console.error("handleGuestJoin error:", err);
      errorMsg = err.message || "Failed to join event";
    } finally {
      isSubmitting = false;
    }
  }

  function handleGuestLeave() {
    if (confirm("Leave this event on this device?")) {
      setGuestToken(currentEventSlug, "");
      guestSession = null;
      myUploads = [];
    }
  }

  // Header shortcut: let a host join an event as guest to submit photos.
  // Name/code only (no URLs) — normalized with slugify, mirroring event creation.
  // From own event detail jumps straight to its guest view, otherwise prompts for code.
  function handleHeaderGuestLogin() {
    if (isAppRoute && hostView === "event_detail" && selectedEvent?.slug) {
      navigate(`/event/${selectedEvent.slug}`);
      return;
    }
    const raw = prompt("Enter the event name or code:");
    if (!raw || !raw.trim()) return;
    const slug = slugify(raw) || raw.trim().toLowerCase();
    if (!slug) return;
    navigate(`/event/${slug}`);
  }

  async function refreshOfflineQueueCount() {
    if (!currentEventSlug) return;
    const queued = await getOfflineQueue(currentEventSlug);
    offlineQueueCount = queued.length;
  }

  async function checkAndFlushOfflineQueue() {
    if (!isOnline || !currentEventSlug || !guestSession || isFlushingQueue)
      return;
    const queued = await getOfflineQueue(currentEventSlug);
    if (!queued.length) return;

    isFlushingQueue = true;
    uploadProgressText = `Syncing ${queued.length} offline photo(s)...`;

    const result = await flushOfflineQueue(
      currentEventSlug,
      ({ current, total }) => {
        uploadProgressText = `Syncing offline queue (${current}/${total})...`;
      },
      (res) => {
        if (res.quota) {
          guestSession.quota = res.quota;
          guestSession.guest.upload_count = res.quota.used;
        }
      },
    );

    isFlushingQueue = false;
    uploadProgressText = "";
    await refreshOfflineQueueCount();
    await Promise.all([
      loadMyUploads(currentEventSlug, guestSession.guest.token),
      loadGuestExperience(currentEventSlug),
    ]);

    if (result.uploaded > 0) {
      successMsg = `Offline sync complete! ${result.uploaded} photo(s) uploaded.`;
      setTimeout(() => (successMsg = ""), 4000);
    }
  }

  async function handleInstallPWA() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") {
      showInstallButton = false;
    }
    deferredInstallPrompt = null;
  }

  // --- CAMERA & PHOTO STUDIO PIPELINE ---

  async function handleStartCameraCapture() {
    if (guestEventData?.status === "archived") {
      alert("This event has ended and is no longer accepting new uploads.");
      return;
    }
    if ((guestEventData?.total_photos || 0) >= (guestEventData?.max_photos || 100)) {
      alert("Event photo limit reached! This event space has reached its maximum capacity of 100 pictures.");
      return;
    }
    if (guestSession && guestSession.quota && guestSession.quota.remaining <= 0) {
      alert("You have reached your upload limit for this event.");
      return;
    }

    cameraErrorMsg = "";
    isCameraOpen = true;

    setTimeout(async () => {
      try {
        if (!cameraVideoEl) return;
        const res = await cameraController.startStream(cameraVideoEl, { facingMode: cameraFacingMode });
        hasTorch = res.hasTorch;
        hasMultipleCameras = res.hasMultipleCameras;
      } catch (err) {
        console.warn("Camera start failed, falling back to native picker:", err);
        cameraErrorMsg = err.message || "Unable to access camera";
        handleCloseCamera();
        cameraInputEl?.click();
      }
    }, 60);
  }

  function handleCloseCamera() {
    cameraController.stopStream();
    isCameraOpen = false;
    isTorchOn = false;
    cameraErrorMsg = "";
  }

  async function handleFlipCamera() {
    try {
      const res = await cameraController.flipCamera();
      cameraFacingMode = res.facingMode;
      hasTorch = cameraController.hasTorch;
      isTorchOn = cameraController.isTorchOn;
    } catch (err) {
      console.warn("Flip camera error:", err);
    }
  }

  async function handleToggleTorch() {
    try {
      isTorchOn = await cameraController.toggleTorch();
    } catch (err) {
      console.warn("Torch error:", err);
    }
  }

  async function handleSnapPhoto() {
    if (isSnapping) return;
    isSnapping = true;
    try {
      const snap = await cameraController.takeSnapshot();
      handleCloseCamera();
      openPhotoStudio(snap.file);
    } catch (err) {
      console.error("Snap photo error:", err);
      alert("Failed to capture photo: " + (err.message || "Unknown error"));
    } finally {
      isSnapping = false;
    }
  }

  function openPhotoStudio(file) {
    if (!file) return;
    if (studioPreviewBlobUrl) {
      URL.revokeObjectURL(studioPreviewBlobUrl);
    }
    studioFile = file;
    studioPreviewBlobUrl = URL.createObjectURL(file);
    const hasFrameConfigured = Boolean(
      (guestEventData?.frame_url) ||
      (guestEventData?.frame_config && guestEventData.frame_config.type && guestEventData.frame_config.type !== "none")
    );
    studioUseFrame = hasFrameConfigured;
    studioCaption = "";
    isPhotoStudioOpen = true;
    setTimeout(updateStudioCanvasPreview, 40);
  }

  function updateStudioCanvasPreview() {
    if (!studioCanvasEl || !studioPreviewBlobUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = studioPreviewBlobUrl;
    img.onload = () => {
      let frameConfig = null;
      if (studioUseFrame && guestEventData) {
        if (guestEventData.frame_config && typeof guestEventData.frame_config === "object") {
          frameConfig = guestEventData.frame_config;
        } else if (guestEventData.frame_url) {
          frameConfig = { type: "custom", url: guestEventData.frame_url };
        }
      }
      renderFramedPhotoToCanvas(img, frameConfig, studioCanvasEl, {
        eventTitle: guestEventData?.name || "",
        eventDate: guestEventData?.date || ""
      });
    };
  }

  function handleClosePhotoStudio() {
    if (studioPreviewBlobUrl) {
      URL.revokeObjectURL(studioPreviewBlobUrl);
      studioPreviewBlobUrl = "";
    }
    studioFile = null;
    isPhotoStudioOpen = false;
    isSubmittingStudio = false;
    studioCaption = "";
  }

  async function handleSubmitPhotoStudio() {
    if (!studioFile || !guestSession || !currentEventSlug || isSubmittingStudio) return;

    if (guestEventData?.status === "archived") {
      alert("This event has ended and is no longer accepting new uploads.");
      handleClosePhotoStudio();
      return;
    }

    if ((guestEventData?.total_photos || 0) >= (guestEventData?.max_photos || 100)) {
      alert("Event photo limit reached (100 photos maximum).");
      handleClosePhotoStudio();
      return;
    }

    isSubmittingStudio = true;
    const fileToUpload = studioFile;
    const captionText = studioCaption.trim();
    const useFrame = studioUseFrame;

    let frameConfig = null;
    if (useFrame && guestEventData) {
      if (guestEventData.frame_config && typeof guestEventData.frame_config === "object") {
        frameConfig = guestEventData.frame_config;
      } else if (guestEventData.frame_url) {
        frameConfig = {
          type: "custom",
          url: guestEventData.frame_url
        };
      }
    }

    handleClosePhotoStudio();

    await processSinglePhotoUpload(fileToUpload, {
      frameConfig,
      hasFrame: Boolean(useFrame && frameConfig),
      caption: captionText
    });
  }

  async function processSinglePhotoUpload(file, options = {}) {
    if (!file || !guestSession || !currentEventSlug) return;
    isUploading = true;
    uploadTotalCount = 1;
    uploadCurrentIndex = 1;
    uploadProgressText = "Optimizing, framing & hashing photo...";
    errorMsg = "";
    successMsg = "";

    try {
      uploadProgressText = "Sending photo to Host Moderation Queue...";
      const res = await api.uploadPhoto(
        currentEventSlug,
        file,
        guestSession.guest.token,
        options
      );
      if (res?.quota) {
        guestSession.quota = res.quota;
        if (guestSession.guest) guestSession.guest.upload_count = res.quota.used ?? guestSession.guest.upload_count;
      } else if (guestSession.guest) {
        const used = (Number(guestSession.guest.upload_count) || 0) + 1;
        const limit = Number(guestSession.quota?.limit) || Number(guestEventData?.guest_upload_limit) || 15;
        guestSession.guest.upload_count = used;
        guestSession.quota = { used, limit, remaining: Math.max(0, limit - used) };
      }
      if (guestEventData) {
        guestEventData.total_photos = (guestEventData.total_photos || 0) + 1;
      }

      if (res.processed) {
        let cloudUploaded = false;
        try {
          uploadProgressText = "Uploading photo to Cloud Storage...";
          const uploadRes = await storage.uploadPhotoToStorage({
            eventSlug: currentEventSlug,
            fileName: res.processed.filename,
            origBlob: res.processed.originalBlob,
            thumbBlob: res.processed.thumbBlob,
            mimeType: res.processed.mimeType,
          });

          if (uploadRes && uploadRes.origUrl) {
            const cloudFilename = uploadRes.origPath.split("/").pop();
            await db.photos.update(res.photo.id, {
              storage_orig_path: uploadRes.origPath,
              storage_thumb_path: uploadRes.thumbPath,
              storage_orig_url: uploadRes.origUrl,
              storage_thumb_url: uploadRes.thumbUrl,
              original_url: uploadRes.origUrl,
              thumb_url: uploadRes.thumbUrl,
              original_path: uploadRes.origUrl,
              thumbnail_path: uploadRes.thumbUrl,
              filename: cloudFilename,
              hash: res.processed.hash,
              guest_name: guestSession.guest.name,
              guest_token: guestSession.guest.token,
            });

            storage.syncPhotoToCloud({
              ...res.photo,
              event_slug: currentEventSlug,
              filename: cloudFilename,
              hash: res.processed.hash,
              guest_name: guestSession.guest.name,
              guest_token: guestSession.guest.token,
              storage_orig_path: uploadRes.origPath,
              storage_thumb_path: uploadRes.thumbPath,
              caption: options.caption || null,
              has_frame: options.hasFrame || false,
              status: res.photo.status,
            }).catch(() => {});

            if (wsHandle) {
              const photoPayload = {
                origUrl: uploadRes.origUrl,
                thumbUrl: uploadRes.thumbUrl,
                origPath: uploadRes.origPath,
                thumbPath: uploadRes.thumbPath,
                filename: cloudFilename,
                hash: res.processed.hash,
                width: res.processed.width,
                height: res.processed.height,
                size: res.processed.size,
                mimeType: res.processed.mimeType,
                guest_name: guestSession.guest.name,
                guest_token: guestSession.guest.token,
                caption: options.caption || null,
                has_frame: options.hasFrame || false,
                status: res.photo.status,
              };
              wsHandle.notifyPhotoUploaded(photoPayload);

              if (res.photo.status === "approved") {
                wsHandle.send({
                  type: "photo:approved",
                  payload: {
                    ...photoPayload,
                    id: res.photo.id,
                    thumb_url: uploadRes.thumbUrl,
                    original_url: uploadRes.origUrl,
                    storage_thumb_url: uploadRes.thumbUrl,
                    storage_orig_url: uploadRes.origUrl,
                  },
                });
              }
            }
            cloudUploaded = true;
          }
        } catch (storageErr) {
          console.warn("Direct cloud upload failed, using preview:", storageErr);
        }

        if (!cloudUploaded && wsHandle) {
          try {
            uploadProgressText = "Delivering preview to Host Queue...";
            const thumbDataUrl = await blobToBase64(res.processed.thumbBlob);
            const fallbackPayload = {
              origUrl: "",
              thumbUrl: thumbDataUrl,
              origPath: "",
              thumbPath: "",
              filename: res.processed.filename,
              hash: res.processed.hash,
              width: res.processed.width,
              height: res.processed.height,
              size: res.processed.size,
              mimeType: res.processed.mimeType,
              guest_name: guestSession.guest.name,
              guest_token: guestSession.guest.token,
              caption: options.caption || null,
              has_frame: options.hasFrame || false,
              thumbDataUrl,
              status: res.photo.status,
            };
            wsHandle.notifyPhotoUploaded(fallbackPayload);
          } catch (e) {}
        }
      }

      successMsg = "🎉 Photo delivered to Host Moderation Queue!";
      setTimeout(() => (successMsg = ""), 5000);
    } catch (err) {
      console.error("Upload error:", err);
      errorMsg = err.message || "Failed to upload photo";
    } finally {
      isUploading = false;
      uploadTotalCount = 0;
      uploadCurrentIndex = 0;
      uploadProgressText = "";
      if (currentEventSlug && guestSession?.guest?.token) {
        await loadMyUploads(currentEventSlug, guestSession.guest.token);
      }
    }
  }

  // --- PHOTO UPLOAD & DELETE LOGIC ---
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !guestSession || !currentEventSlug) return;
    e.target.value = "";

    if (guestEventData?.status === "archived") {
      alert("This event has ended and is no longer accepting new uploads.");
      return;
    }

    if ((guestEventData?.total_photos || 0) >= (guestEventData?.max_photos || 100)) {
      alert("Event photo limit reached! This event space has reached its maximum capacity of 100 pictures.");
      return;
    }

    // If single photo selected, open Photo Studio for preview, framing & captioning
    if (files.length === 1) {
      openPhotoStudio(files[0]);
      return;
    }

    // Batch upload for multiple photos
    isUploading = true;
    uploadTotalCount = files.length;
    uploadCurrentIndex = 0;
    errorMsg = "";
    successMsg = "";

    let successCount = 0;
    let offlineQueuedCount = 0;
    let failMsg = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      uploadCurrentIndex = i + 1;
      uploadProgressText = `Optimizing & hashing photo ${i + 1} of ${files.length}...`;

      if (!isOnline) {
        try {
          await enqueueOfflinePhoto(
            currentEventSlug,
            file,
            guestSession.guest.token,
          );
          offlineQueuedCount++;
          uploadProgressText = `Queued photo ${i + 1} of ${files.length} (offline)`;
        } catch (err) {
          console.error("Offline queue failed:", err);
          failMsg = "Failed to queue offline photo";
        }
      } else {
        try {
          uploadProgressText = `Sending photo ${i + 1} of ${files.length} to Host Moderation Queue...`;
          const res = await api.uploadPhoto(
            currentEventSlug,
            file,
            guestSession.guest.token,
          );
          successCount++;
          if (res?.quota) {
            guestSession.quota = res.quota;
            if (guestSession.guest) guestSession.guest.upload_count = res.quota.used ?? guestSession.guest.upload_count;
          } else if (guestSession.guest) {
            const used = (Number(guestSession.guest.upload_count) || 0) + 1;
            const limit = Number(guestSession.quota?.limit) || Number(guestEventData?.guest_upload_limit) || 15;
            guestSession.guest.upload_count = used;
            guestSession.quota = { used, limit, remaining: Math.max(0, limit - used) };
          }
          if (guestEventData) {
            guestEventData.total_photos = (guestEventData.total_photos || 0) + 1;
          }

          if (res.processed) {
            let cloudUploaded = false;

            // 1. Direct Supabase Cloud Storage Upload
            try {
              uploadProgressText = `Uploading photo ${i + 1} of ${files.length} to Cloud Storage...`;
              const uploadRes = await storage.uploadPhotoToStorage({
                eventSlug: currentEventSlug,
                fileName: res.processed.filename,
                origBlob: res.processed.originalBlob,
                thumbBlob: res.processed.thumbBlob,
                mimeType: res.processed.mimeType,
              });

              if (uploadRes && uploadRes.origUrl) {
                await db.photos.update(res.photo.id, {
                  storage_orig_path: uploadRes.origPath,
                  storage_thumb_path: uploadRes.thumbPath,
                  storage_orig_url: uploadRes.origUrl,
                  storage_thumb_url: uploadRes.thumbUrl,
                  original_url: uploadRes.origUrl,
                  thumb_url: uploadRes.thumbUrl,
                  original_path: uploadRes.origUrl,
                  thumbnail_path: uploadRes.thumbUrl,
                });

                storage.syncPhotoToCloud({
                  ...res.photo,
                  event_slug: currentEventSlug,
                  guest_name: guestSession.guest.name,
                  guest_token: guestSession.guest.token,
                  storage_orig_path: uploadRes.origPath,
                  storage_thumb_path: uploadRes.thumbPath,
                  status: res.photo.status,
                }).catch(() => {});

                if (wsHandle) {
                  const photoPayload = {
                    origUrl: uploadRes.origUrl,
                    thumbUrl: uploadRes.thumbUrl,
                    origPath: uploadRes.origPath,
                    thumbPath: uploadRes.thumbPath,
                    filename: res.processed.filename,
                    hash: res.processed.hash,
                    width: res.processed.width,
                    height: res.processed.height,
                    size: res.processed.size,
                    mimeType: res.processed.mimeType,
                    guest_name: guestSession.guest.name,
                    guest_token: guestSession.guest.token,
                    status: res.photo.status,
                  };
                  wsHandle.notifyPhotoUploaded(photoPayload);

                  if (res.photo.status === "approved") {
                    wsHandle.send({
                      type: "photo:approved",
                      payload: {
                        ...photoPayload,
                        id: res.photo.id,
                        thumb_url: uploadRes.thumbUrl,
                        original_url: uploadRes.origUrl,
                        storage_thumb_url: uploadRes.thumbUrl,
                        storage_orig_url: uploadRes.origUrl,
                      },
                    });
                  }
                }
                cloudUploaded = true;
              }
            } catch (storageErr) {
              console.warn("Direct Supabase cloud upload failed, using fallback preview:", storageErr);
            }

            // 2. Fallback
            if (!cloudUploaded && wsHandle) {
              try {
                uploadProgressText = `Delivering preview ${i + 1} of ${files.length} to Host Queue...`;
                const thumbDataUrl = await blobToBase64(res.processed.thumbBlob);
                const fallbackPayload = {
                  origUrl: "",
                  thumbUrl: thumbDataUrl,
                  origPath: "",
                  thumbPath: "",
                  filename: res.processed.filename,
                  hash: res.processed.hash,
                  width: res.processed.width,
                  height: res.processed.height,
                  size: res.processed.size,
                  mimeType: res.processed.mimeType,
                  guest_name: guestSession.guest.name,
                  guest_token: guestSession.guest.token,
                  thumbDataUrl,
                  status: res.photo.status,
                };
                wsHandle.notifyPhotoUploaded(fallbackPayload);
                if (res.photo.status === "approved") {
                  wsHandle.send({
                    type: "photo:approved",
                    payload: {
                      ...fallbackPayload,
                      id: res.photo.id,
                      thumb_url: thumbDataUrl,
                      original_url: thumbDataUrl,
                      storage_thumb_url: thumbDataUrl,
                      storage_orig_url: thumbDataUrl,
                    },
                  });
                }
              } catch (fallbackErr) {
                console.error("Direct fallback transmission error:", fallbackErr);
              }
            }
          }
        } catch (err) {
          if (
            err.message &&
            (err.message.includes("fetch") ||
              err.message.includes("network") ||
              err.message.includes("Failed to fetch") ||
              err.message.includes("offline"))
          ) {
            try {
              await enqueueOfflinePhoto(
                currentEventSlug,
                file,
                guestSession.guest.token,
              );
              offlineQueuedCount++;
            } catch (qErr) {
              failMsg = "Upload failed and offline queue unavailable";
            }
          } else {
            failMsg = err.message || "Upload failed";
            console.error("Photo upload failed:", err);
          }
        }
      }
    }

    isUploading = false;
    uploadTotalCount = 0;
    uploadCurrentIndex = 0;
    uploadProgressText = "";

    await refreshOfflineQueueCount();
    if (guestSession?.guest?.token) {
      await loadMyUploads(currentEventSlug, guestSession.guest.token);
    }

    if (successCount > 0) {
      successMsg =
        successCount === 1
          ? "🎉 Photo delivered to Host Moderation Queue!"
          : `🎉 All ${successCount} photos submitted to Host Moderation Queue!`;
      setTimeout(() => (successMsg = ""), 5000);
    }

    if (offlineQueuedCount > 0) {
      successMsg = `${offlineQueuedCount} photo(s) saved to offline queue! Will auto-upload when reconnected.`;
      setTimeout(() => (successMsg = ""), 5000);
    }

    if (failMsg) {
      errorMsg = failMsg;
    }
  }

  async function handleDeleteOwnPhoto(photoId, photoObj = null) {
    if (
      !confirm(
        "Remove this photo from the event? Your upload slot will be freed.",
      )
    )
      return;
    try {
      const deletedPhoto = photoObj || myUploads.find(p => p.id === photoId) || liveGalleryPhotos.find(p => p.id === photoId);
      const photoHash = deletedPhoto?.hash;
      const photoFilename = deletedPhoto?.filename;
      const res = await api.deletePhoto(
        currentEventSlug,
        photoId,
        guestSession?.guest?.token,
      );
      if (deletedPhoto) {
        storage.deleteIndividualPhotoFromStorage(deletedPhoto, currentEventSlug).catch(err => {
          console.warn("Could not delete own photo from Supabase:", err);
        });
      }
      myUploads = myUploads.filter((p) => p.id !== photoId && (!photoHash || p.hash !== photoHash));
      liveGalleryPhotos = liveGalleryPhotos.filter((p) => p.id !== photoId && (!photoHash || p.hash !== photoHash));
      if (guestSession?.quota) {
        if (res?.quota) {
          guestSession.quota = res.quota;
          if (guestSession.guest) guestSession.guest.upload_count = res.quota.used ?? guestSession.guest.upload_count;
        }
      }
      if (selectedPreviewPhoto && (selectedPreviewPhoto.id === photoId || (photoHash && selectedPreviewPhoto.hash === photoHash))) {
        selectedPreviewPhoto = null;
      }

      // Send real-time signal to host and all attendees
      if (wsHandle) {
        wsHandle.send({
          type: "photo:deleted",
          payload: {
            id: photoId,
            hash: photoHash,
            filename: photoFilename,
            event_slug: currentEventSlug,
            guest_token: guestSession?.guest?.token
          }
        });
      }

      successMsg = "Photo removed and slot freed!";
      setTimeout(() => (successMsg = ""), 3000);
    } catch (err) {
      alert("Failed to delete photo: " + err.message);
    }
  }

  // --- SELECTION & DOWNLOAD LOGIC ---
  function togglePhotoSelection(photoId) {
    if (selectedPhotoIds.has(photoId)) {
      selectedPhotoIds.delete(photoId);
    } else {
      selectedPhotoIds.add(photoId);
    }
    selectedPhotoIds = new Set(selectedPhotoIds);
  }

  async function handleDownloadSelected() {
    if (!selectedPhotoIds.size) return;
    isDownloadingZip = true;
    try {
      await downloadSelectedZip(currentEventSlug, Array.from(selectedPhotoIds));
      isSelectionMode = false;
      selectedPhotoIds = new Set();
    } catch (err) {
      alert("Failed to download ZIP: " + err.message);
    } finally {
      isDownloadingZip = false;
    }
  }

  // --- SLIDESHOW / TV MODE LOGIC ---
  async function syncSlideshowFromSupabase(slug) {
    if (!slug || isSlideshowSyncing) return;
    if (!storage.isStorageConfigured()) return;

    isSlideshowSyncing = true;
    try {
      // 1. Fetch current file listing from Supabase Storage bucket
      const [bucketPhotos, cloudPhotoMetadata] = await Promise.all([
        storage.listEventPhotosFromStorage(slug),
        storage.getCloudPhotosForEvent(slug),
      ]);

      // 2. Fetch local approved photos for author/guest metadata cross-referencing
      let localApproved = [];
      try {
        const localRes = await api.getPhotos(slug, { status: "approved" });
        localApproved = localRes.photos || [];
      } catch (e) {}

      const localMap = new Map();
      for (const p of localApproved) {
        if (p.filename) localMap.set(p.filename, p);
        if (p.storage_orig_path) localMap.set(p.storage_orig_path, p);
        if (p.hash) localMap.set(p.hash, p);
      }

      const cloudMetadataMap = new Map();
      for (const metadata of cloudPhotoMetadata || []) {
        if (metadata.storage_orig_path) cloudMetadataMap.set(metadata.storage_orig_path, metadata);
        if (metadata.filename) cloudMetadataMap.set(metadata.filename, metadata);
      }

      if (bucketPhotos) {
        const bucketPathSet = new Set(bucketPhotos.map((p) => p.storage_orig_path).filter(Boolean));
        const bucketFilenameSet = new Set(bucketPhotos.map((p) => p.filename).filter(Boolean));

        // Reconcile:
        // A. Start with bucketPhotos (authoritative source of cloud files)
        const updatedList = bucketPhotos.map((bp) => {
          const matched = localMap.get(bp.filename) || localMap.get(bp.storage_orig_path);
          const metadata = cloudMetadataMap.get(bp.storage_orig_path) || cloudMetadataMap.get(bp.filename);
          const localName = matched?.guest_name;
          return {
            ...bp,
            guest_name: localName && localName !== "Guest" ? localName : metadata?.guest_name || localName || bp.guest_name || "Guest",
            guest_id: matched?.guest_id || bp.guest_id || null,
            guest_token: matched?.guest_token || metadata?.guest_token || null,
            hash: matched?.hash || metadata?.hash || bp.hash || "",
          };
        });

        // B. Keep local-only approved photos that are not cloud-hosted (e.g. offline staged captures)
        // BUT prune photos that were cloud-hosted in Supabase and now deleted from the bucket
        for (const lp of localApproved) {
          const isCloudHosted = Boolean(
            lp.storage_orig_path ||
            (lp.storage_orig_url && lp.storage_orig_url.includes("supabase")) ||
            (lp.original_url && lp.original_url.includes("supabase"))
          );
          if (isCloudHosted) {
            // Photo deleted from Supabase Storage -> do not include in slideshow
            continue;
          }
          if (!bucketFilenameSet.has(lp.filename)) {
            updatedList.push(lp);
          }
        }

        // C. Check if the photo collection changed (new photos added or deleted photos removed)
        const currentFingerprint = slideshowPhotos.map((p) => p.storage_orig_path || p.filename || p.id).join("|");
        const newFingerprint = updatedList.map((p) => p.storage_orig_path || p.filename || p.id).join("|");

        if (currentFingerprint !== newFingerprint) {
          const currentPhoto = slideshowPhotos[currentSlideIndex];
          if (currentPhoto) {
            const preservedIdx = updatedList.findIndex(
              (p) =>
                (p.storage_orig_path && p.storage_orig_path === currentPhoto.storage_orig_path) ||
                (p.filename && p.filename === currentPhoto.filename) ||
                (p.id && p.id === currentPhoto.id)
            );
            if (preservedIdx !== -1) {
              currentSlideIndex = preservedIdx;
            } else {
              currentSlideIndex = Math.max(0, Math.min(currentSlideIndex, updatedList.length - 1));
            }
          }
          slideshowPhotos = updatedList;
          decryptPhotosList(updatedList).then((p) => {
            slideshowPhotos = p;
          });
        }
      }
      lastCloudSyncTime = new Date();
    } catch (err) {
      console.warn("Auto-sync from Supabase Storage bucket error:", err);
    } finally {
      isSlideshowSyncing = false;
    }
  }

  function startSlideshowAutoRefresh(slug) {
    stopSlideshowAutoRefresh();
    // Auto-refresh from Supabase bucket every 5 seconds to show new captures and prune removed ones
    slideshowRefreshTimer = setInterval(() => {
      if (isSlideshowRoute && slug) {
        syncSlideshowFromSupabase(slug);
      }
    }, 5000);
  }

  function stopSlideshowAutoRefresh() {
    if (slideshowRefreshTimer) {
      clearInterval(slideshowRefreshTimer);
      slideshowRefreshTimer = null;
    }
  }

  async function loadSlideshowExperience(slug) {
    try {
      const [eventRes, photosRes, configRes] = await Promise.all([
        api.getEvent(slug),
        api.getPhotos(slug, { status: "approved" }),
        api.getSlideshowConfig(slug),
      ]);
      guestEventData = eventRes.event;
      slideshowPhotos = photosRes.photos || [];
      decryptPhotosList(slideshowPhotos).then((p) => {
        slideshowPhotos = p;
      });
      slideshowConfig = configRes.config;
      currentSlideIndex = 0;
      startSlideshowTimer();

      // Immediately sync with Supabase Cloud Storage bucket
      await syncSlideshowFromSupabase(slug);

      // Start auto-refresh polling interval to pick up new & removed pictures from Supabase bucket
      startSlideshowAutoRefresh(slug);
    } catch (err) {
      errorMsg = err.message || "Failed to load slideshow";
    }
  }

  function startSlideshowTimer() {
    if (slideshowTimer) clearInterval(slideshowTimer);
    const intervalMs = (slideshowConfig.interval || 5) * 1000;
    slideshowTimer = setInterval(() => {
      if (!isSlideshowPaused && slideshowPhotos.length > 1) {
        nextSlide();
      }
    }, intervalMs);
  }

  function nextSlide() {
    if (!slideshowPhotos.length) return;
    currentSlideIndex = (currentSlideIndex + 1) % slideshowPhotos.length;
  }

  function prevSlide() {
    if (!slideshowPhotos.length) return;
    currentSlideIndex =
      (currentSlideIndex - 1 + slideshowPhotos.length) % slideshowPhotos.length;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function exitSlideshow() {
    stopSlideshowAutoRefresh();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    const hostToken = localStorage.getItem('luminafeed_host_token') || localStorage.getItem('caps_host_token');
    if (hostToken || authStatus.is_authenticated) {
      navigate('/app');
    } else {
      navigate(`/event/${currentEventSlug}`);
    }
  }

  function handleKeyDown(e) {
    if (!isSlideshowRoute) return;
    if (e.key === "ArrowRight") {
      nextSlide();
    } else if (e.key === "ArrowLeft") {
      prevSlide();
    } else if (e.key === " ") {
      isSlideshowPaused = !isSlideshowPaused;
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    } else if (e.key === "r" || e.key === "R") {
      syncSlideshowFromSupabase(currentEventSlug);
    } else if (e.key === "Escape") {
      if (!document.fullscreenElement) {
        exitSlideshow();
      }
    }
  }

  onMount(() => {
    applyTheme(currentTheme);
    if (isLocalEnvironment) {
      refreshHostIp(false);
    }
    initView();

    const handleRouteChange = () => {
      initView();
    };

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("keydown", handleKeyDown);

    const updateOnlineStatus = () => {
      isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (isOnline) {
        checkAndFlushOfflineQueue();
      }
    };

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      showInstallButton = true;
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (hostView === "event_detail" && selectedEvent) {
          loadHostEventPhotos(selectedEvent.slug, true);
        } else if (isSlideshowRoute && currentEventSlug) {
          syncSlideshowFromSupabase(currentEventSlug);
        } else if (isGuestRoute && currentEventSlug) {
          loadGuestExperience(currentEventSlug);
        }
      }
    };
    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      if (slideshowTimer) clearInterval(slideshowTimer);
      stopHostAutoSync();
      stopGuestAutoSync();
    };
  });

  onDestroy(() => {
    cameraController.stopStream();
    if (wsHandle) {
      wsHandle.disconnect();
    }
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
    }
    stopSlideshowAutoRefresh();
    stopHostAutoSync();
    stopGuestAutoSync();
  });
</script>

<div class="app-container {isSlideshowRoute ? 'slideshow-mode-container' : ''}">
  <!-- FLOATING REAL-TIME SOCIAL REACTIONS OVERLAY -->
  {#if floatingReactions.length > 0}
    <div class="floating-reactions-container" aria-hidden="true">
      {#each floatingReactions as reaction (reaction.id)}
        <div
          class="floating-reaction-item"
          style="left: {reaction.leftPercent}%;"
        >
          <span class="floating-emoji">{reaction.emoji}</span>
          {#if reaction.senderName && reaction.senderName !== "Guest"}
            <span class="floating-sender">{reaction.senderName}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- TOP HEADER (Hidden in Slideshow / TV Mode) -->
  {#if !isSlideshowRoute}
    <header class="app-header">
      <div class="header-inner">
        <button class="brand" onclick={() => navigate(isSuperAdminRoute ? "/super-admin" : isAppRoute ? "/app" : "/")}>
          {#if isGuestRoute && guestEventData?.logo}
            <img
              src={guestEventData.logo}
              alt="Event logo"
              class="custom-brand-logo"
            />
          {:else if selectedEvent?.logo && hostView === "event_detail"}
            <img
              src={selectedEvent.logo}
              alt="Event logo"
              class="custom-brand-logo"
            />
          {:else}
            <div class="logo-icon" aria-label="LuminaFeed Logo">
              <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" class="brand-svg">
                <path d="M 206 100 C 206 94 212 90 220 90 L 292 90 C 300 90 306 94 306 100 L 306 120 L 366 120 C 394 120 416 142 416 170 L 416 382 C 416 410 394 432 366 432 L 146 432 C 118 432 96 410 96 382 L 96 170 C 96 142 118 120 146 120 L 206 120 Z" stroke="currentColor" stroke-width="24" stroke-linejoin="round" />
                <line x1="126" y1="362" x2="386" y2="362" stroke="currentColor" stroke-opacity="0.75" stroke-width="18" stroke-linecap="round" />
                <circle cx="256" cy="242" r="64" stroke="currentColor" stroke-width="22" />
                <circle cx="256" cy="242" r="26" fill="currentColor" />
                <rect x="350" y="152" width="28" height="18" rx="6" fill="currentColor" opacity="0.9" />
              </svg>
            </div>
          {/if}
          <div class="text-left">
            <h1 class="brand-title">LuminaFeed</h1>
            <span class="brand-subtitle">
              {#if isGuestRoute && guestEventData}
                {guestEventData.name}
              {:else if isSuperAdminRoute}
                Super Admin Console
              {:else if isAppRoute}
                Host Console
              {:else}
                Event Photo Hub
              {/if}
            </span>
          </div>
        </button>

        <div class="header-actions">
          {#if isLandingRoute}
            <nav class="landing-nav-links">
              <a href="#features" class="landing-nav-link">Features</a>
              <a href="#how-it-works" class="landing-nav-link">How It Works</a>
              <button
                class="btn-primary btn-sm"
                onclick={() => navigate("/app")}
                style="font-weight: 700; gap: 0.35rem;"
              >
                Launch App <span>→</span>
              </button>
            </nav>
          {:else if isSuperAdminRoute}
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="status-pill pill-approved" style="font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; padding: 0.25rem 0.65rem;">
                🛡️ Super Admin
              </span>
              {#if isSuperAdminAuthenticated}
                <button
                  class="btn-secondary btn-sm"
                  onclick={handleSuperAdminLogout}
                  title="Lock Super Admin Console"
                  style="font-size: 0.8125rem; padding: 0.35rem 0.75rem;"
                >
                  🔒 Lock
                </button>
              {/if}
            </div>
          {:else if isAppRoute}
            <button
              class="btn-secondary btn-sm header-back-btn"
              onclick={() => navigate("/")}
              title="Return to LuminaFeed Home Page"
            >
              ← Website
            </button>
            <button
              class="btn-secondary btn-sm"
              onclick={handleHeaderGuestLogin}
              title={hostView === "event_detail" && selectedEvent?.slug
                ? `Join ${selectedEvent.name || selectedEvent.slug} as guest to submit photos`
                : "Join an event as guest to submit photos"}
            >
              📸 Join as Guest
            </button>
          {/if}

          {#if showInstallButton && !isSuperAdminRoute}
            <button
              class="btn-primary btn-sm install-pwa-btn"
              onclick={handleInstallPWA}
            >
              <span>📲</span> Install App
            </button>
          {/if}

          {#if !isOnline}
            <span class="offline-status-pill">
              🔴 Offline {offlineQueueCount > 0
                ? `(${offlineQueueCount} queued)`
                : ""}
            </span>
          {/if}

          {#if isAppRoute && authStatus.is_authenticated}
            <button
              class="btn-secondary btn-sm host-badge"
              onclick={openProfileModal}
              title="Edit Host Profile & PIN"
              style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;"
            >
              <span>👤</span> <strong class="host-badge-name">{authStatus.host_name}</strong> <span class="host-badge-settings">⚙️</span>
            </button>
            <button class="btn-secondary btn-sm" onclick={handleLogout} title="Sign out and switch host profile"
              >🚪 Switch Host</button
            >
          {:else if isGuestRoute && guestSession}
            <span class="guest-pill">👋 {guestSession.guest.name}</span>
            <button class="btn-secondary btn-sm" onclick={handleGuestLeave}
              >Leave</button
            >
          {:else if isGuestRoute}
            <button class="btn-secondary btn-sm" onclick={() => navigate("/app")}
              >Host Login</button
            >
          {/if}

          <a
            href="https://ko-fi.com/deidi0"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-theme-toggle kofi-header-btn"
            title="Support on Ko-fi"
            aria-label="Support on Ko-fi"
          >
            ☕
          </a>

          <button
            class="btn-theme-toggle"
            onclick={toggleTheme}
            title={currentTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label={currentTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {#if currentTheme === "dark"}
              ☀️
            {:else}
              🌙
            {/if}
          </button>
        </div>
      </div>
    </header>
  {/if}

  <!-- MAIN CONTENT -->
  <main class="main-content {isSlideshowRoute ? 'slideshow-main' : ''}">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Connecting to LuminaFeed...</p>
      </div>

      <!-- ========================================== -->
      <!-- PRIVACY POLICY VIEW                        -->
      <!-- ========================================== -->
    {:else if isPrivacyRoute}
      <div class="card policy-card text-left" style="max-width: 780px; margin: 2rem auto; padding: 2.5rem; line-height: 1.7;">
        <button class="btn-secondary btn-sm" style="margin-bottom: 1.5rem;" onclick={() => navigate("/")}>
          ← Back to LuminaFeed
        </button>
        <h2 style="font-size: 1.75rem; margin-bottom: 0.25rem;">Privacy Policy</h2>
        <p class="text-secondary" style="font-size: 0.875rem; margin-bottom: 2rem;">Last Updated: August 2026</p>

        <h3 style="margin-top: 1.5rem;">1. Overview</h3>
        <p class="text-secondary">LuminaFeed (<code>https://deidi.github.io/lumina-feed/</code>) is a zero-backend event photo sharing hub. We are committed to protecting your privacy and providing transparent information regarding how data is handled.</p>

        <h3 style="margin-top: 1.5rem;">2. Google Drive Permissions & Data Use</h3>
        <p class="text-secondary">LuminaFeed connects to your Google Account using the restricted <code>https://www.googleapis.com/auth/drive.file</code> OAuth scope. This permission is strictly used to:</p>
        <ul style="margin: 0.75rem 0 1.25rem 1.5rem; color: var(--color-text-secondary);">
          <li>Create a dedicated folder named <code>/LuminaFeed Events</code> in your personal Google Drive.</li>
          <li>Upload event photos taken and submitted by attendees during your event.</li>
          <li>Store a lightweight event manifest snapshot (<code>event_manifest.json</code>) for event metadata.</li>
        </ul>
        <p class="text-secondary"><strong>Strict Isolation:</strong> LuminaFeed does not access, view, modify, or delete any other files, documents, or folders in your Google Drive.</p>

        <h3 style="margin-top: 1.5rem;">3. Client-Side Processing</h3>
        <p class="text-secondary">All photo compression, thumbnail generation, duplicate detection, and metadata formatting are executed entirely within your web browser using HTML5 Canvas. No photos or Google access tokens are transmitted to or stored on third-party backend servers.</p>

        <h3 style="margin-top: 1.5rem;">4. Revoking Access</h3>
        <p class="text-secondary">You can disconnect Google Drive at any time from within the LuminaFeed dashboard, or revoke access from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style="color: var(--color-primary);">Google Account Security Settings</a>.</p>
      </div>

      <!-- ========================================== -->
      <!-- TERMS OF SERVICE VIEW                      -->
      <!-- ========================================== -->
    {:else if isTermsRoute}
      <div class="card policy-card text-left" style="max-width: 780px; margin: 2rem auto; padding: 2.5rem; line-height: 1.7;">
        <button class="btn-secondary btn-sm" style="margin-bottom: 1.5rem;" onclick={() => navigate("/")}>
          ← Back to LuminaFeed
        </button>
        <h2 style="font-size: 1.75rem; margin-bottom: 0.25rem;">Terms of Service</h2>
        <p class="text-secondary" style="font-size: 0.875rem; margin-bottom: 2rem;">Last Updated: August 2026</p>

        <h3 style="margin-top: 1.5rem;">1. Acceptance of Terms</h3>
        <p class="text-secondary">By accessing or using LuminaFeed, you agree to comply with and be bound by these Terms of Service.</p>

        <h3 style="margin-top: 1.5rem;">2. User-Generated Content</h3>
        <p class="text-secondary">Attendees retain rights to photos they capture and upload. Users agree not to upload harmful, offensive, or infringing material. Event hosts retain full moderation rights to approve, reject, or remove photos from their event space.</p>

        <h3 style="margin-top: 1.5rem;">3. Disclaimer & Limitation of Liability</h3>
        <p class="text-secondary">LuminaFeed is provided on an "as is" and "as available" basis without warranties of any kind. LuminaFeed is not liable for data loss or service interruptions resulting from third-party cloud services.</p>
      </div>

      <!-- ========================================== -->
      <!-- SLIDESHOW / TV MODE VIEW                   -->
      <!-- ========================================== -->
    {:else if isSlideshowRoute}
      <div class="slideshow-stage">
        {#if slideshowPhotos.length === 0}
          <div class="slideshow-empty">
            <div class="slideshow-logo" aria-label="LuminaFeed Logo">
              <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" class="slideshow-svg">
                <path d="M 206 100 C 206 94 212 90 220 90 L 292 90 C 300 90 306 94 306 100 L 306 120 L 366 120 C 394 120 416 142 416 170 L 416 382 C 416 410 394 432 366 432 L 146 432 C 118 432 96 410 96 382 L 96 170 C 96 142 118 120 146 120 L 206 120 Z" stroke="currentColor" stroke-width="24" stroke-linejoin="round" />
                <line x1="126" y1="362" x2="386" y2="362" stroke="currentColor" stroke-opacity="0.75" stroke-width="18" stroke-linecap="round" />
                <circle cx="256" cy="242" r="64" stroke="currentColor" stroke-width="22" />
                <circle cx="256" cy="242" r="26" fill="currentColor" />
                <rect x="350" y="152" width="28" height="18" rx="6" fill="currentColor" opacity="0.9" />
              </svg>
            </div>
            <h1>{guestEventData?.name || "LuminaFeed Slideshow"}</h1>
            {#if guestEventData?.tagline}
              <p class="slideshow-tagline">{guestEventData.tagline}</p>
            {/if}
            <p class="slideshow-waiting">
              Waiting for approved photos from attendees...
            </p>
            {#if slideshowConfig.qr_data_url}
              <div class="slideshow-empty-qr">
                <img
                  src={slideshowConfig.qr_data_url}
                  alt="Join QR"
                  class="empty-qr-img"
                />
                <p>Scan with phone to share photos</p>
              </div>
            {/if}
          </div>
        {:else}
          <!-- ACTIVE PHOTO DISPLAY WITH AMBIENT BLURRED BACKDROP -->
          {#key currentSlideIndex}
            <div
              class="slide-item-wrapper transition-{slideshowConfig.transition ||
                'fade'}"
            >
              <div
                class="slide-backdrop-blur"
                style="background-image: url('{getPhotoSrc(slideshowPhotos[currentSlideIndex], false)}');"
              ></div>
              <img
                src={getPhotoSrc(slideshowPhotos[currentSlideIndex], false)}
                alt="Slideshow memory"
                class="slide-img"
              />
            </div>
          {/key}

          <!-- CAPTION & AUTHOR GLASSMORPHISM BANNER -->
          {#if slideshowPhotos[currentSlideIndex]?.caption || (slideshowConfig.show_author && slideshowPhotos[currentSlideIndex]?.guest_name)}
            <div class="slideshow-info-banner">
              {#if slideshowPhotos[currentSlideIndex]?.caption}
                <div class="slideshow-caption">
                  "{slideshowPhotos[currentSlideIndex].caption}"
                </div>
              {/if}
              {#if slideshowConfig.show_author && slideshowPhotos[currentSlideIndex]?.guest_name}
                <div class="slideshow-author">
                  <span>📸 Captured by <strong>{slideshowPhotos[currentSlideIndex].guest_name}</strong></span>
                </div>
              {/if}
            </div>
          {/if}

          <!-- CORNER QR CODE OVERLAY (PIP) -->
          {#if slideshowConfig.show_qr && slideshowConfig.qr_data_url}
            <div class="slideshow-qr-pip">
              {#if guestEventData?.logo}
                <img
                  src={guestEventData.logo}
                  alt="Event logo"
                  style="max-height: 24px; max-width: 100px; object-fit: contain; margin-bottom: 0.25rem;"
                />
              {/if}
              <img
                src={slideshowConfig.qr_data_url}
                alt="Join Event QR"
                class="pip-qr-img"
              />
              <span class="pip-label">Scan to Share</span>
            </div>
          {/if}

          <!-- CLOUD AUTO-SYNC STATUS BADGE -->
          {#if storage.isStorageConfigured()}
            <div class="slideshow-cloud-pill" title="Live auto-refreshing from Supabase Cloud Storage">
              <span class="pulse-dot {isSlideshowSyncing ? 'syncing' : ''}"></span>
              <span>Cloud Sync</span>
            </div>
          {/if}

          <!-- SLIDE COUNTER PILL -->
          <div class="slideshow-counter-pill">
            <span>{currentSlideIndex + 1} / {slideshowPhotos.length}</span>
          </div>

          <!-- FLOATING CONTROLS (Hover) -->
          <div class="slideshow-controls-overlay">
            <button
              class="slide-ctrl-btn"
              onclick={() => syncSlideshowFromSupabase(currentEventSlug)}
              title="Sync from Cloud Storage (R)"
            >
              <span style={isSlideshowSyncing ? "display: inline-block; animation: spin 1s linear infinite;" : ""}>🔄</span>
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={prevSlide}
              title="Previous photo (←)"
            >
              &#10094;
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={() => (isSlideshowPaused = !isSlideshowPaused)}
              title="Pause / Play (Space)"
            >
              {isSlideshowPaused ? "▶" : "⏸"}
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={nextSlide}
              title="Next photo (→)"
            >
              &#10095;
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={toggleFullscreen}
              title="Fullscreen (F)"
            >
              ⛶
            </button>
            <button
              class="slide-ctrl-btn"
              onclick={exitSlideshow}
              title="Exit (Esc)"
            >
              &times;
            </button>
          </div>
        {/if}

        <!-- FLOATING REAL-TIME REACTIONS OVERLAY (SLIDESHOW) -->
        {#if floatingReactions.length > 0}
          <div class="floating-reactions-layer slideshow-reactions-layer" aria-hidden="true">
            {#each floatingReactions as r (r.id)}
              <div
                class="floating-reaction-item"
                style="left: {r.leftPercent}%;"
              >
                <span class="floating-emoji">{r.emoji}</span>
                {#if r.senderName}
                  <span class="floating-sender">{r.senderName}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- ========================================== -->
      <!-- GUEST EXPERIENCE VIEW                     -->
      <!-- ========================================== -->
    {:else if isGuestRoute}
      {#if !guestEventData && errorMsg}
        <!-- 0. EVENT NOT FOUND / DELETED SCREEN -->
        <div class="card auth-card guest-join-card" style="margin: 3rem auto; text-align: center; max-width: 480px;">
          <div class="auth-icon" style="font-size: 2.75rem; margin-bottom: 0.75rem;">🚫</div>
          <h2 style="color: var(--color-danger); margin-bottom: 0.5rem;">Event Not Found</h2>
          <p class="text-secondary" style="margin: 0.5rem 0 1.75rem 0; line-height: 1.5; font-size: 0.9375rem;">
            {errorMsg}
          </p>
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn-primary" onclick={() => navigate("/")}>
              <span>🏠</span> Return to Home
            </button>
            {#if isLocalEnvironment}
              <button class="btn-secondary" onclick={() => navigate("/app")}>
                <span>⚙️</span> Host Console
              </button>
            {/if}
          </div>
        </div>
      {:else if !guestSession}
        <!-- 1. GUEST JOIN SCREEN -->
        <div class="card auth-card guest-join-card">
          {#if guestEventData?.logo}
            <div style="margin-bottom: 1rem;">
              <img
                src={guestEventData.logo}
                alt="Event logo"
                style="max-height: 80px; max-width: 200px; object-fit: contain;"
              />
            </div>
          {/if}
          <div class="event-badge-top">Event Space</div>
          <h2 class="event-hero-title">
            {guestEventData?.name ||
              currentEventSlug.replace(/-/g, " ").toUpperCase()}
          </h2>
          {#if guestEventData?.tagline}
            <p class="event-hero-tagline">{guestEventData.tagline}</p>
          {/if}
          <p class="event-hero-date">
            📅 {guestEventData?.date || new Date().toISOString().split("T")[0]}
          </p>

          <div class="join-divider"></div>

          {#if guestEventData?.status === "archived"}
            <div class="alert-archived-banner">
              🔒 <strong>This event has concluded.</strong> You can browse and download
              all shared memories below.
            </div>
          {:else}
            <p
              class="text-secondary"
              style="font-size: 0.9375rem; margin-bottom: 1.25rem;"
            >
              Enter your name to share photos and view the live gallery. No
              password required!
            </p>
          {/if}

          {#if errorMsg}
            <div class="alert-error" style="margin-bottom: 1rem;">
              {errorMsg}
            </div>
          {/if}

          <form onsubmit={handleGuestJoin} class="form-stack">
            <div>
              <label class="form-label" for="guestName">Your Name</label>
              <input
                id="guestName"
                type="text"
                class="input-field"
                placeholder="e.g. Sarah / David Miller"
                bind:value={guestNameInput}
                required
              />
            </div>

            <div>
              <label class="form-label" for="guestPasscode">4-Digit Passcode <span class="text-secondary" style="font-size: 0.8rem; font-weight: normal;">(Optional - locks your photo uploads)</span></label>
              <input
                id="guestPasscode"
                type="password"
                class="input-field"
                placeholder="••••"
                maxlength="4"
                bind:value={guestPasscodeInput}
              />
              <p class="text-secondary" style="font-size: 0.75rem; margin-top: 0.25rem;">
                Locks your photos and lets you seamlessly reconnect to your uploads from any device.
              </p>
            </div>

            <button
              type="submit"
              class="btn-primary btn-lg"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Joining..."
                : guestEventData?.status === "archived"
                  ? "Enter Event Gallery →"
                  : "Join & Share Photos →"}
            </button>
          </form>

          <div class="guest-join-footer">
            <span
              >🔒 Photos shared in real-time over peer-to-peer connection</span
            >
          </div>
        </div>

        <!-- 2. GUEST EVENT SPACE (Active Session) -->
      {:else}
        <div class="guest-space-container">
          <!-- Hidden File Inputs -->
          <input
            type="file"
            accept="image/*"
            capture="environment"
            bind:this={cameraInputEl}
            onchange={handleFileSelect}
            style="display: none;"
          />
          <input
            type="file"
            accept="image/*"
            multiple
            bind:this={fileInputEl}
            onchange={handleFileSelect}
            style="display: none;"
          />

          <!-- Notification Banners -->
          {#if successMsg}
            <div class="alert-success">✨ {successMsg}</div>
          {/if}
          {#if errorMsg}
            <div class="alert-error">⚠️ {errorMsg}</div>
          {/if}

          <!-- ARCHIVED BANNER -->
          {#if guestEventData.status === "archived"}
            <div class="alert-archived-banner">
              🏁 <strong>This event has concluded.</strong> Thank you for capturing
              memories! New uploads are closed, but you can view and download all
              approved photos below.
            </div>
          {/if}

          <!-- Event Header Banner -->
          <div class="card event-banner-card">
            <div class="event-banner-flex">
              <div>
                <span class="event-status status-{guestEventData.status}">
                  {guestEventData.status === "active"
                    ? "Live Event"
                    : "Concluded"}
                </span>
                <h2>{guestEventData.name}</h2>
                {#if guestEventData.tagline}
                  <p class="text-secondary" style="margin-top: 0.25rem;">
                    {guestEventData.tagline}
                  </p>
                {/if}
                <p
                  class="text-secondary"
                  style="font-size: 0.8125rem; margin-top: 0.25rem;"
                >
                  📅 {guestEventData.date}
                </p>
              </div>

              <!-- Upload Quota Card -->
              <div class="quota-badge">
                <span class="quota-count"
                  >{guestSession.quota?.used ?? 0} / {guestSession.quota?.limit ?? 15}</span
                >
                <span class="quota-label">Photos Uploaded</span>
              </div>
            </div>

            <!-- Upload Action Bar -->
            {#if (guestEventData.total_photos || 0) >= (guestEventData.max_photos || 100)}
              <div
                class="event-limit-reached-banner"
                style="margin-bottom: 1rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-md); padding: 0.85rem 1rem; text-align: center; color: var(--color-danger);"
              >
                <strong>📸 Event Capacity Reached (100 / 100 Photos)</strong>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.8125rem; opacity: 0.9;">
                  This event space has reached its maximum limit of 100 photos. Further uploads are paused.
                </p>
              </div>
            {/if}

            <div class="guest-action-bar">
              <div class="action-buttons-group">
                <button
                  class="btn-primary"
                  disabled={isUploading ||
                    (guestSession.quota?.remaining ?? 0) <= 0 ||
                    guestEventData.status === "archived" ||
                    (guestEventData.total_photos || 0) >= (guestEventData.max_photos || 100)}
                  onclick={handleStartCameraCapture}
                >
                  <span>📷</span>
                  {guestEventData.status === "archived"
                    ? "Uploads Closed"
                    : (guestEventData.total_photos || 0) >= (guestEventData.max_photos || 100)
                    ? "Capacity Full (100/100)"
                    : "Take Photo"}
                </button>
                <button
                  class="btn-secondary"
                  disabled={isUploading ||
                    (guestSession.quota?.remaining ?? 0) <= 0 ||
                    guestEventData.status === "archived" ||
                    (guestEventData.total_photos || 0) >= (guestEventData.max_photos || 100)}
                  onclick={() => fileInputEl?.click()}
                >
                  <span>🖼️</span> Camera Roll
                </button>
                <button
                  class="btn-secondary"
                  onclick={() => openSlideshow(guestEventData.slug)}
                >
                  <span>📺</span> TV Slideshow
                </button>
              </div>

              {#if isUploading}
                <div class="batch-upload-banner">
                  <div class="batch-upload-header">
                    <div class="batch-upload-title">
                      <div class="mini-spinner"></div>
                      <span>Uploading Photos ({uploadCurrentIndex} of {uploadTotalCount})</span>
                    </div>
                    <span class="batch-upload-percent">
                      {uploadTotalCount > 0 ? Math.round((uploadCurrentIndex / uploadTotalCount) * 100) : 0}%
                    </span>
                  </div>
                  <div class="batch-progress-track">
                    <div
                      class="batch-progress-fill"
                      style="width: {uploadTotalCount > 0 ? Math.max(8, (uploadCurrentIndex / uploadTotalCount) * 100) : 0}%;"
                    ></div>
                  </div>
                  <p class="batch-upload-status">
                    🔄 {uploadProgressText || "Sending to Host Moderation Queue..."}
                  </p>
                </div>
              {:else if guestEventData.status !== "archived"}
                <span class="quota-helper">
                  {#if (guestEventData.total_photos || 0) >= (guestEventData.max_photos || 100)}
                    <span style="color: var(--color-danger); font-weight: 600;">Event photo capacity reached (100/100)</span>
                  {:else}
                    Remaining slots: <strong>{guestSession.quota?.remaining ?? 0}</strong> • Event total: <strong>{guestEventData.total_photos || 0} / 100</strong>
                  {/if}
                </span>
              {/if}
            </div>
          </div>

          <!-- MY UPLOADS SECTION -->
          {#if myUploads.length > 0}
            <div class="card uploads-section">
              <div class="section-title-row">
                <h3>My Shared Photos ({myUploads.length})</h3>
                <span class="text-secondary" style="font-size: 0.8125rem;"
                  >Uploaded by you</span
                >
              </div>

              <div class="uploads-grid">
                {#each myUploads as photo}
                  <div class="upload-item-card">
                    <button
                      class="upload-thumb-click"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={getPhotoSrc(photo, true)}
                        alt="Uploaded thumbnail"
                        class="upload-thumb"
                      />
                    </button>
                    <div class="upload-badge-overlay">
                      {#if photo.status === "pending"}
                        <span class="status-pill pill-pending">🟡 Pending</span>
                      {:else if photo.status === "approved"}
                        <span class="status-pill pill-approved">🟢 Live</span>
                      {:else}
                        <span class="status-pill pill-rejected"
                          >🔴 Rejected</span
                        >
                      {/if}
                    </div>
                    <button
                      class="delete-photo-btn"
                      title="Remove photo & free slot"
                      onclick={(e) => {
                        e.stopPropagation();
                        handleDeleteOwnPhoto(photo.id, photo);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- LIVE GALLERY SECTION -->
          <div class="card gallery-section">
            <div class="gallery-header">
              <div>
                <h3>Live Memories Wall ({liveGalleryPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.8125rem;">
                  Real-time feed of approved photos from everyone
                </p>
              </div>

              <div class="gallery-controls">
                {#if liveGalleryPhotos.length > 0}
                  <button
                    class="btn-secondary btn-sm"
                    onclick={() => {
                      isSelectionMode = !isSelectionMode;
                      selectedPhotoIds = new Set();
                    }}
                  >
                    {isSelectionMode ? "Cancel Selection" : "Select Photos"}
                  </button>

                  <button
                    class="btn-secondary btn-sm"
                    disabled={isExportingArchive}
                    onclick={() => handleExportFullArchive(guestEventData.slug)}
                  >
                    <span>💾</span>
                    {isExportingArchive
                      ? "Packaging ZIP..."
                      : "Download All (.ZIP)"}
                  </button>
                {/if}

                <div class="live-dot-badge">
                  <span
                    class="pulse-dot"
                    style="background: {wsConnectionStatus === 'connected' ? '#10b981' : wsConnectionStatus === 'connecting' ? '#f59e0b' : '#34d399'};"
                  ></span>
                  <span>
                    {wsConnectionStatus === "connected"
                      ? "Live Sync"
                      : wsConnectionStatus === "connecting"
                      ? "Connecting..."
                      : wsConnectionStatus === "reconnecting"
                      ? "Reconnecting..."
                      : "Cloud Sync"}
                  </span>
                </div>
              </div>
            </div>

            <!-- Multi-Selection Action Toolbar -->
            {#if isSelectionMode}
              <div class="selection-toolbar">
                <span
                  >Selected: <strong>{selectedPhotoIds.size}</strong> photos</span
                >
                <div class="selection-actions">
                  <button
                    class="btn-primary btn-sm"
                    disabled={selectedPhotoIds.size === 0 || isDownloadingZip}
                    onclick={handleDownloadSelected}
                  >
                    {isDownloadingZip
                      ? "Archiving..."
                      : `Download Selected (${selectedPhotoIds.size}) .ZIP`}
                  </button>
                </div>
              </div>
            {/if}

            {#if liveGalleryPhotos.length === 0}
              <div class="empty-gallery">
                <div class="empty-icon">✨</div>
                <h4>No memories live yet!</h4>
                <p
                  class="text-secondary"
                  style="max-width: 420px; margin: 0.5rem auto 0 auto;"
                >
                  Photos uploaded by guests will appear here as soon as approved
                  by staff.
                </p>
                {#if guestEventData.status === "active"}
                  <div style="margin-top: 1.25rem;">
                    <button
                      class="btn-primary"
                      onclick={handleStartCameraCapture}
                    >
                      <span>📷</span> Take Photo
                    </button>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="live-gallery-grid">
                {#each liveGalleryPhotos as photo}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="gallery-item-card {isSelectionMode &&
                    selectedPhotoIds.has(photo.id)
                      ? 'selected-card'
                      : ''}"
                    onclick={() =>
                      isSelectionMode
                        ? togglePhotoSelection(photo.id)
                        : (selectedPreviewPhoto = photo)}
                  >
                    <img
                      src={getPhotoSrc(photo, true)}
                      alt="Event memory"
                      class="gallery-thumb"
                      loading="lazy"
                    />

                    {#if isSelectionMode}
                      <div class="select-checkbox-overlay">
                        <input
                          type="checkbox"
                          checked={selectedPhotoIds.has(photo.id)}
                          onchange={() => togglePhotoSelection(photo.id)}
                        />
                      </div>
                    {/if}

                    <div class="gallery-info-overlay">
                      <span class="gallery-author"
                        >📸 {photo.guest_name || "Guest"}</span
                      >
                      {#if photo.caption}
                        <span class="gallery-card-caption">"{photo.caption}"</span>
                      {/if}
                    </div>

                    <!-- Quick Floating Reactions on Card -->
                    <div class="gallery-card-reactions" onclick={(e) => e.stopPropagation()}>
                      {#each ["❤️", "🔥", "🥂", "🎉"] as emoji}
                        <button
                          type="button"
                          class="card-reaction-btn"
                          onclick={() => sendPhotoReaction(emoji, photo.id)}
                          title="Send {emoji}"
                        >
                          {emoji}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ========================================== -->
      <!-- DEDICATED DEFAULT LANDING PAGE (at /)      -->
      <!-- ========================================== -->
    {:else if isLandingRoute}
      <div class="landing-page-wrapper">
        <!-- 1. MODERN HERO SECTION -->
        <section class="hero-section">
          <div class="hero-pill-badge">
            <span class="pulse-dot"></span>
            <span>Next-Gen Event Experience</span>
          </div>

          <h1 class="hero-title">
            The Live Photo Stream <br />
            <span class="hero-title-gradient">Your Guests Will Love</span>
          </h1>

          <p class="hero-description">
            Transform attendee smartphone snaps into a breathtaking live venue slideshow in real time. 
            Zero apps to download, zero server fees, and powered directly by Supabase Cloud Storage.
          </p>

          <div class="hero-cta-group">
            <button
              class="btn-primary btn-hero-launch"
              onclick={() => navigate("/app")}
            >
              <span>🚀</span> Launch Host Console <span>→</span>
            </button>
            <a
              href="#how-it-works"
              class="btn-secondary btn-hero-secondary"
            >
              <span>✨</span> See How It Works
            </a>
          </div>

          <!-- Live Metrics Strip -->
          <div class="hero-metrics-strip">
            <div class="hero-metric-item">
              <span class="metric-val">0</span>
              <span class="metric-lbl">Apps to Install</span>
            </div>
            <div class="metric-sep"></div>
            <div class="hero-metric-item">
              <span class="metric-val">&lt; 1s</span>
              <span class="metric-lbl">CDN Live Delivery</span>
            </div>
            <div class="metric-sep"></div>
            <div class="hero-metric-item">
              <span class="metric-val">100%</span>
              <span class="metric-lbl">Free & Open Source</span>
            </div>
            <div class="metric-sep"></div>
            <div class="hero-metric-item">
              <span class="metric-val">4K</span>
              <span class="metric-lbl">Slideshow Display</span>
            </div>
          </div>

          <!-- Interactive Live Showcase Mockup -->
          <div class="hero-preview-wrapper">
            <div class="hero-preview-window">
              <div class="preview-window-header">
                <div class="preview-dots">
                  <div class="preview-dot dot-red"></div>
                  <div class="preview-dot dot-yellow"></div>
                  <div class="preview-dot dot-green"></div>
                </div>
                <div class="preview-url-bar">
                  <span style="opacity: 0.6;">🔒 https://</span>luminafeed.app/event/grand-gala-2026
                </div>
                <div class="preview-header-meta">
                  <span class="live-pulse-badge">● LIVE STREAM</span>
                </div>
              </div>

              <div class="preview-content">
                <div class="preview-feed-header">
                  <div style="text-align: left;">
                    <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                      <h3 style="font-size: 1.15rem; font-weight: 800; margin: 0; color: var(--color-text);">Grand Gala Celebration</h3>
                      <span class="preview-live-badge">🎉 Active Event</span>
                    </div>
                    <span style="font-size: 0.8125rem; color: var(--color-text-secondary);">
                      148 guest captures synced to Supabase CDN • Auto-moderation active
                    </span>
                  </div>
                  <div style="display: flex; gap: 0.5rem;">
                    <button
                      class="btn-primary btn-sm"
                      style="font-size: 0.75rem; padding: 0.4rem 0.8rem; font-weight: 600;"
                      onclick={() => navigate("/app")}
                    >
                      Open Console ⚙️
                    </button>
                  </div>
                </div>

                <div class="preview-grid">
                  <div class="preview-card-item card-champagne">
                    <span class="preview-emoji">🥂</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">Rachel M.</span>
                      <span class="preview-time-ago">just now</span>
                    </div>
                  </div>
                  <div class="preview-card-item card-sparkler">
                    <span class="preview-emoji">✨</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">Marcus K.</span>
                      <span class="preview-time-ago">12s ago</span>
                    </div>
                  </div>
                  <div class="preview-card-item card-party">
                    <span class="preview-emoji">🎉</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">Elena T.</span>
                      <span class="preview-time-ago">35s ago</span>
                    </div>
                  </div>
                  <div class="preview-card-item card-dance">
                    <span class="preview-emoji">💃</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">Sofia & Dan</span>
                      <span class="preview-time-ago">1m ago</span>
                    </div>
                  </div>
                  <div class="preview-card-item card-camera">
                    <span class="preview-emoji">📸</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">David L.</span>
                      <span class="preview-time-ago">2m ago</span>
                    </div>
                  </div>
                  <div class="preview-card-item card-cake">
                    <span class="preview-emoji">🎂</span>
                    <div class="preview-card-info">
                      <span class="preview-guest-name">Chloe H.</span>
                      <span class="preview-time-ago">3m ago</span>
                    </div>
                  </div>
                </div>

                <div class="preview-interactive-bar">
                  <div class="preview-qr-hint">
                    <span class="qr-mini-icon">📲</span>
                    <span>Guests scan table QR to add memories instantly</span>
                  </div>
                  <button
                    class="btn-secondary btn-sm"
                    style="font-size: 0.75rem;"
                    onclick={() => navigate("/app")}
                  >
                    View TV Slideshow ↗
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. FEATURES GRID SECTION -->
        <section id="features" class="landing-section">
          <div class="section-header">
            <div class="section-tag">Engineered for Hosts</div>
            <h2 class="section-title">Everything Needed for Stellar Event Photos</h2>
            <p class="section-desc">
              Built from the ground up for modern gatherings, weddings, galas, and tech conferences.
            </p>
          </div>

          <div class="features-grid-3">
            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">☁️</div>
              <h3 class="feature-card-title">Direct Supabase Cloud CDN</h3>
              <p class="feature-card-body">
                Smartphone captures stream straight from guest phones into your Supabase Storage bucket. Fast, secure, and immune to host bandwidth throttles.
              </p>
            </div>

            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6;">📺</div>
              <h3 class="feature-card-title">Dedicated Multi-Tab Slideshow</h3>
              <p class="feature-card-body">
                Open presentation mode in a separate tab for projectors or TVs. Keep your host moderation console active and logged in without disruption.
              </p>
            </div>

            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">🛡️</div>
              <h3 class="feature-card-title">Real-Time Moderation & Auto-Approve</h3>
              <p class="feature-card-body">
                Preview incoming photos with guest attribution. Switch between 1-click Auto-Approve for seamless parties or manual vetting for corporate galas.
              </p>
            </div>

            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">📱</div>
              <h3 class="feature-card-title">Zero App Downloads</h3>
              <p class="feature-card-body">
                No app store barriers. Attendees simply point their default phone camera at the QR code and are sharing memories in under 5 seconds.
              </p>
            </div>

            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(236, 72, 153, 0.15); color: #ec4899;">📶</div>
              <h3 class="feature-card-title">Offline-Resilient Queue</h3>
              <p class="feature-card-body">
                Spotty venue Wi-Fi? Uploads are safely held in local IndexedDB storage and automatically flushed the moment network connectivity resumes.
              </p>
            </div>

            <div class="landing-feature-card">
              <div class="feature-icon-wrapper" style="background: rgba(14, 165, 233, 0.15); color: #0ea5e9;">📁</div>
              <h3 class="feature-card-title">Google Drive & ZIP Backups</h3>
              <p class="feature-card-body">
                Preserve all raw original memories forever. Export instant full-album ZIP archives or connect Google Drive for automatic background syncing.
              </p>
            </div>
          </div>
        </section>

        <!-- 3. HOW IT WORKS SECTION -->
        <section id="how-it-works" class="landing-section" style="background: var(--color-surface); border-radius: var(--radius-lg); border: 1px solid var(--color-border); margin-top: 1rem; padding: 3.5rem 1.5rem;">
          <div class="section-header">
            <div class="section-tag">Effortless Flow</div>
            <h2 class="section-title">Up and Running in 3 Simple Steps</h2>
            <p class="section-desc">
              No server installations or database setup. Launch your first live event hub in 90 seconds.
            </p>
          </div>

          <div class="steps-grid">
            <div class="step-card">
              <div class="step-number-badge">1</div>
              <h3 class="step-title">Create Event & Get QR</h3>
              <p class="step-desc">
                Launch the host console at <code>/app</code>, name your celebration, and generate high-res printable table QR codes.
              </p>
            </div>

            <div class="step-card">
              <div class="step-number-badge">2</div>
              <h3 class="step-title">Guests Snap & Upload</h3>
              <p class="step-desc">
                Attendees scan the code, enter their name, and capture memories right from their smartphone's native camera.
              </p>
            </div>

            <div class="step-card">
              <div class="step-number-badge">3</div>
              <h3 class="step-title">Stream Live & Download</h3>
              <p class="step-desc">
                Watch approved photos automatically appear on venue TV screens, and download the full uncompressed archive at the end of the night.
              </p>
            </div>
          </div>
        </section>

        <!-- 4. COMPARISON / VALUE SECTION -->
        <section class="landing-section">
          <div class="section-header">
            <div class="section-tag">Why LuminaFeed</div>
            <h2 class="section-title">A Smarter Alternative to Legacy Apps</h2>
            <p class="section-desc">
              Compare traditional event photo apps with LuminaFeed's zero-backend architecture.
            </p>
          </div>

          <div class="comparison-table-wrapper">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th class="col-highlight">LuminaFeed</th>
                  <th>Traditional Photo Apps</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Guest App Download</strong></td>
                  <td class="col-highlight"><span class="badge-check">✓ Zero (Web QR)</span></td>
                  <td><span class="badge-cross">✗ Requires App Store Install</span></td>
                </tr>
                <tr>
                  <td><strong>Guest Account Creation</strong></td>
                  <td class="col-highlight"><span class="badge-check">✓ None (Name only)</span></td>
                  <td><span class="badge-cross">✗ Requires email / password</span></td>
                </tr>
                <tr>
                  <td><strong>Hosting & Server Costs</strong></td>
                  <td class="col-highlight"><span class="badge-check">✓ $0 (Cloud Native SPA)</span></td>
                  <td><span class="badge-cross">✗ Monthly subscription fees</span></td>
                </tr>
                <tr>
                  <td><strong>TV Slideshow Mode</strong></td>
                  <td class="col-highlight"><span class="badge-check">✓ Included (Dedicated Tab)</span></td>
                  <td><span class="badge-cross">✗ Paid add-on or unavailable</span></td>
                </tr>
                <tr>
                  <td><strong>Photo Ownership</strong></td>
                  <td class="col-highlight"><span class="badge-check">✓ 100% Yours (Supabase/Drive)</span></td>
                  <td><span class="badge-cross">✗ Locked behind proprietary walls</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 5. CALL TO ACTION BANNER -->
        <section class="hero-preview-wrapper" style="margin-bottom: 2.5rem;">
          <div class="landing-cta-banner">
            <h2 style="font-size: clamp(1.75rem, 4vw, 2.5rem); margin-bottom: 1rem; color: #ffffff;">Ready to Capture Every Angle?</h2>
            <p style="font-size: 1.125rem; color: #cbd5e1; max-width: 580px; margin: 0 auto 2rem auto;">
              Start streaming live memories from all your guests in under 2 minutes. Free and open source forever.
            </p>
            <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
              <button
                class="btn-primary btn-hero-launch"
                style="background: #3b82f6; border-color: #3b82f6; font-size: 1.1rem; padding: 0.9rem 2.25rem;"
                onclick={() => navigate("/app")}
              >
                Launch LuminaFeed Console <span>→</span>
              </button>
            </div>
          </div>
        </section>

        <!-- 6. FOOTER -->
        <footer class="landing-footer">
          <div class="landing-footer-inner">
            <div class="footer-copy">
              <strong>LuminaFeed</strong> — Real-Time Cloud Event Photo Hub. Free & Open Source.
            </div>
            <div class="footer-links">
              <button onclick={() => navigate("/app")}>Host Console</button>
              <button onclick={() => navigate("/privacy")}>Privacy Policy</button>
              <button onclick={() => navigate("/terms")}>Terms of Service</button>
              {#if isLocalEnvironment}
                <button onclick={() => navigate("/super-admin")}>Super Admin</button>
              {/if}
              <a href="https://github.com/deidi/lumina-feed" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://ko-fi.com/deidi0" target="_blank" rel="noopener noreferrer" class="kofi-footer-link" title="Support creator on Ko-fi">☕ Support on Ko-fi</a>
            </div>
          </div>
        </footer>
      </div>

      <!-- ========================================== -->
      <!-- SUPER ADMIN ROUTE (at /super-admin)        -->
      <!-- ========================================== -->
    {:else if isSuperAdminRoute}
      <div class="super-admin-container" style="max-width: 1200px; margin: 0 auto; padding: 2rem 1rem;">
        {#if !isSuperAdminAuthenticated}
          <div class="card auth-card" style="margin: 4rem auto; max-width: 440px; text-align: center;">
            <div class="auth-icon">🛡️</div>
            <h2>Super Admin Portal</h2>
            <p class="text-secondary" style="margin: 0.5rem 0 1.5rem 0; font-size: 0.875rem;">
              Enter your local Master PIN to access the cross-host Global Event Tracker.
            </p>

            {#if superAdminError}
              <div class="alert-error" style="margin-bottom: 1rem; font-size: 0.875rem;">{superAdminError}</div>
            {/if}

            <form onsubmit={handleSuperAdminLogin} class="form-stack" style="text-align: left;">
              <div>
                <label class="form-label" for="superAdminPinInput">Super Admin PIN</label>
                <input
                  id="superAdminPinInput"
                  type="password"
                  class="input-field"
                  placeholder="••••••"
                  maxlength="12"
                  bind:value={superAdminPinInput}
                  required
                />
              </div>

              <button
                type="submit"
                class="btn-primary"
                style="width: 100%; margin-top: 0.75rem;"
              >
                Access Global Tracker
              </button>
            </form>
          </div>
        {:else}
          <!-- Super Admin Console -->
          <div class="super-admin-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <h2 style="margin: 0;">🛡️ Global Event Tracker</h2>
                <span class="status-pill pill-approved" style="font-size: 0.75rem;">Super Admin</span>
              </div>
              <p class="text-secondary" style="margin: 0.25rem 0 0 0; font-size: 0.875rem;">
                Tracking events and cloud assets created across GitHub Pages and web instances.
              </p>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
              <button
                class="btn-secondary btn-sm"
                onclick={loadGlobalTracker}
                disabled={isLoadingGlobalEvents}
              >
                <span>🔄</span> {isLoadingGlobalEvents ? "Scanning..." : "Refresh Tracker"}
              </button>
              <button
                class="btn-secondary btn-sm"
                onclick={exportGlobalReport}
                disabled={globalEvents.length === 0}
              >
                <span>📥</span> Export JSON
              </button>
              <button
                class="btn-secondary btn-sm"
                onclick={handleSuperAdminLogout}
              >
                Lock
              </button>
            </div>
          </div>

          <!-- KPI Summary Cards -->
          <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div class="card" style="padding: 1.25rem;">
              <div class="text-secondary" style="font-size: 0.8125rem; font-weight: 500;">TOTAL TRACKED EVENTS</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: var(--color-primary); margin-top: 0.25rem;">
                {globalEvents.length}
              </div>
              <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.25rem;">Discovered in Supabase Storage</div>
            </div>

            <div class="card" style="padding: 1.25rem;">
              <div class="text-secondary" style="font-size: 0.8125rem; font-weight: 500;">TOTAL PHOTOS UPLOADED</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #10b981; margin-top: 0.25rem;">
                {globalEvents.reduce((sum, e) => sum + (e.total_photos || 0), 0)}
              </div>
              <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.25rem;">Across all host spaces</div>
            </div>

            <div class="card" style="padding: 1.25rem;">
              <div class="text-secondary" style="font-size: 0.8125rem; font-weight: 500;">TOTAL CLOUD STORAGE</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #8b5cf6; margin-top: 0.25rem;">
                {(globalEvents.reduce((sum, e) => sum + (e.total_bytes || 0), 0) / (1024 * 1024)).toFixed(2)} MB
              </div>
              <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.25rem;">In luminafeed-photos bucket</div>
            </div>

            <div class="card" style="padding: 1.25rem;">
              <div class="text-secondary" style="font-size: 0.8125rem; font-weight: 500;">ACTIVE EVENT SPACES</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #3b82f6; margin-top: 0.25rem;">
                {globalEvents.filter(e => e.status === "active").length}
              </div>
              <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.25rem;">Open for guest uploads</div>
            </div>
          </div>

          <!-- Search filter -->
          <div style="margin-bottom: 1rem;">
            <input
              type="text"
              class="input-field"
              placeholder="🔍 Search events by name, slug, or host..."
              bind:value={globalSearchQuery}
              style="width: 100%; max-width: 420px;"
            />
          </div>

          <!-- Events Table -->
          {#if isLoadingGlobalEvents && globalEvents.length === 0}
            <div class="loading-state" style="padding: 3rem; text-align: center;">
              <div class="spinner"></div>
              <p style="margin-top: 1rem;">Scanning Supabase Storage for global events...</p>
            </div>
          {:else if globalEvents.length === 0}
            <div class="card" style="padding: 3rem; text-align: center;">
              <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📭</div>
              <h3>No Global Events Detected</h3>
              <p class="text-secondary" style="margin: 0.5rem 0 1rem 0;">
                No event folders or manifests found in the Supabase Storage bucket yet.
              </p>
              <button class="btn-primary" onclick={loadGlobalTracker}>Scan Storage</button>
            </div>
          {:else}
            <div class="card" style="padding: 0; overflow: hidden; border: 1px solid var(--color-border);">
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-surface);">
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Event</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Host Origin</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Photos</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Storage</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Status</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600;">Last Activity</th>
                      <th style="padding: 0.875rem 1rem; font-weight: 600; text-align: right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each globalEvents.filter(e => !globalSearchQuery.trim() || e.name.toLowerCase().includes(globalSearchQuery.toLowerCase()) || e.slug.toLowerCase().includes(globalSearchQuery.toLowerCase()) || e.host_name.toLowerCase().includes(globalSearchQuery.toLowerCase())) as ev}
                      <tr style="border-bottom: 1px solid var(--color-border); transition: background 0.15s ease;">
                        <td style="padding: 0.875rem 1rem;">
                          <div style="font-weight: 600; color: var(--color-text);">{ev.name}</div>
                          <div style="font-size: 0.75rem; color: var(--color-text-secondary); font-family: monospace;">/{ev.slug}</div>
                        </td>
                        <td style="padding: 0.875rem 1rem; color: var(--color-text-secondary);">
                          {ev.host_name}
                        </td>
                        <td style="padding: 0.875rem 1rem; font-weight: 500;">
                          {ev.total_photos} photos
                          <span style="font-size: 0.75rem; color: var(--color-text-secondary);">({ev.thumb_count} thumbs)</span>
                        </td>
                        <td style="padding: 0.875rem 1rem; font-family: monospace; font-size: 0.8125rem;">
                          {ev.storage_mb} MB
                        </td>
                        <td style="padding: 0.875rem 1rem;">
                          <span class="status-pill {ev.status === 'active' ? 'pill-approved' : 'pill-rejected'}" style="font-size: 0.75rem;">
                            {ev.status}
                          </span>
                        </td>
                        <td style="padding: 0.875rem 1rem; font-size: 0.75rem; color: var(--color-text-secondary);">
                          {ev.last_activity ? new Date(ev.last_activity).toLocaleString() : 'N/A'}
                        </td>
                        <td style="padding: 0.875rem 1rem; text-align: right; white-space: nowrap;">
                          <button
                            class="btn-secondary btn-sm"
                            style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-right: 0.35rem;"
                            onclick={() => inspectGlobalEvent(ev)}
                            title="Inspect cloud photos for this event"
                          >
                            👁️ Inspect
                          </button>
                          <button
                            class="btn-secondary btn-sm"
                            style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-right: 0.35rem;"
                            onclick={() => openSlideshow(ev.slug)}
                            title="Open TV Slideshow"
                          >
                            📺 TV Mode
                          </button>
                          <button
                            class="btn-secondary btn-sm"
                            style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.4);"
                            onclick={() => handlePurgeGlobalEvent(ev)}
                            title="Permanently purge event and cloud manifests from storage"
                          >
                            🗑️ Purge
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- ========================================== -->
      <!-- HOST CONSOLE / APP ROUTE (at /app)         -->
      <!-- ========================================== -->
    {:else if isAppRoute}
      {#if errorMsg && !authStatus.initialized}
        <div class="card auth-card">
          <h2 style="color: var(--color-danger)">Connection Error</h2>
          <p class="text-secondary" style="margin: 0.5rem 0 1.5rem 0">
            {errorMsg}
          </p>
          <button class="btn-primary" onclick={checkAuth}>Retry</button>
        </div>

      <!-- UNIFIED HOST AUTHENTICATION (SIGN IN & REGISTER) -->
      {:else if !authStatus.is_authenticated}
        <div class="card auth-card" style="margin: 3rem auto; text-align: left; max-width: 480px;">
          <div class="auth-icon" style="text-align: center;">☁️</div>
          <h2 style="text-align: center;">Host Portal</h2>
          <p class="text-secondary" style="margin: 0.5rem 0 1.25rem 0; text-align: center;">
            Access your LuminaFeed event spaces, live moderation queues, and cloud storage from any device.
          </p>

          <!-- Tab Switcher -->
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; background: rgba(255, 255, 255, 0.05); padding: 0.25rem; border-radius: 8px; border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));">
            <button
              type="button"
              class="btn-sm"
              style="flex: 1; border-radius: 6px; font-weight: 600; background: {hostAuthTab === 'login' ? 'var(--color-primary, #6366f1)' : 'transparent'}; color: {hostAuthTab === 'login' ? '#fff' : 'var(--color-text-secondary, #a1a1aa)'}; border: none; padding: 0.5rem; cursor: pointer; transition: all 0.2s ease;"
              onclick={() => { hostAuthTab = 'login'; errorMsg = ''; }}
            >
              🔑 Sign In
            </button>
            <button
              type="button"
              class="btn-sm"
              style="flex: 1; border-radius: 6px; font-weight: 600; background: {hostAuthTab === 'register' ? 'var(--color-primary, #6366f1)' : 'transparent'}; color: {hostAuthTab === 'register' ? '#fff' : 'var(--color-text-secondary, #a1a1aa)'}; border: none; padding: 0.5rem; cursor: pointer; transition: all 0.2s ease;"
              onclick={() => { hostAuthTab = 'register'; errorMsg = ''; }}
            >
              ✨ Create Host
            </button>
          </div>

          {#if errorMsg}
            <div class="alert-error" style="margin-bottom: 1rem;">{errorMsg}</div>
          {/if}

          {#if hostAuthTab === 'login'}
            <form onsubmit={handleHostLogin} class="form-stack">
              <div>
                <label class="form-label" for="loginHostName">Host Name / Role</label>
                <input
                  id="loginHostName"
                  type="text"
                  class="input-field"
                  placeholder="e.g. Pastor John / Media Team"
                  bind:value={setupName}
                  required
                />
              </div>

              <div>
                <label class="form-label" for="loginPin">Admin PIN (4+ digits)</label>
                <input
                  id="loginPin"
                  type="password"
                  class="input-field"
                  placeholder="••••"
                  maxlength="8"
                  bind:value={setupPin}
                  required
                />
              </div>

              <button
                type="submit"
                class="btn-primary"
                style="width: 100%; margin-top: 0.5rem;"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Signing in..." : "Sign In to Host Console →"}
              </button>
            </form>
          {:else}
            <form onsubmit={handleHostRegister} class="form-stack">
              <div>
                <label class="form-label" for="regHostName">Host Name / Role</label>
                <input
                  id="regHostName"
                  type="text"
                  class="input-field"
                  placeholder="e.g. Pastor John / Media Team"
                  bind:value={setupName}
                  required
                />
              </div>

              <div>
                <label class="form-label" for="regHostPin">Admin PIN (4+ digits)</label>
                <input
                  id="regHostPin"
                  type="password"
                  class="input-field"
                  placeholder="••••"
                  maxlength="8"
                  bind:value={setupPin}
                  required
                />
              </div>

              <div>
                <label class="form-label" for="regHostPinConfirm">Confirm Admin PIN</label>
                <input
                  id="regHostPinConfirm"
                  type="password"
                  class="input-field"
                  placeholder="••••"
                  maxlength="8"
                  bind:value={setupPinConfirm}
                  required
                />
              </div>

              <button
                type="submit"
                class="btn-primary"
                style="width: 100%; margin-top: 0.5rem;"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating Profile..." : "Create Host Profile →"}
              </button>
            </form>
          {/if}
        </div>

      <!-- 3. HOST DASHBOARD -->
    {:else if hostView === "dashboard"}
      <div class="dashboard-view">
        <div class="dashboard-toolbar">
          <div>
            <h2>Event Spaces</h2>
            <p class="text-secondary">
              Manage gatherings, generate QR codes, and moderate captures.
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
            {#if isStorageConfigured}
              <button
                class="status-pill"
                style="cursor: pointer; border: {currentBaaSConfig.isCustom ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)'}; background: {currentBaaSConfig.isCustom ? 'rgba(99, 102, 241, 0.12)' : 'rgba(16, 185, 129, 0.12)'}; color: {currentBaaSConfig.isCustom ? '#818cf8' : '#10b981'}; font-size: 0.875rem;"
                onclick={openStorageSettingsModal}
                title="Configure Supabase Cloud Storage (Default vs Custom BYOK)"
              >
                ⚡ Supabase Cloud: <strong>{currentBaaSConfig.isCustom ? 'Custom (BYOK)' : 'Managed'}</strong> ⚙️
              </button>
            {:else}
              <button
                class="btn-secondary btn-sm"
                onclick={openStorageSettingsModal}
                title="Configure Supabase Cloud Storage"
              >
                ⚙️ Setup Cloud Storage
              </button>
            {/if}

            <!-- 24-Hour Ephemeral Space Retention Status Pill -->
            <button
              class="status-pill"
              style="cursor: pointer; border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.12); color: #f59e0b; font-size: 0.875rem; display: flex; align-items: center; gap: 0.35rem;"
              onclick={() => (isTtlInfoModalOpen = true)}
              title="Click for details on 24-hour ephemeral retention"
            >
              <span>⏳</span>
              <strong>24h Retention: {hostRemainingText || 'Active'}</strong>
              <span style="opacity: 0.7; font-size: 0.75rem;">ℹ️</span>
            </button>

            <button
              class="btn-primary"
              onclick={() => {
                if (events.length >= 10) {
                  alert("Maximum limit of 10 events reached for your host space. Please delete an existing event before creating a new one.");
                  return;
                }
                isCreateModalOpen = true;
              }}
              title={events.length >= 10 ? "Maximum limit of 10 events reached" : "Create a new event space"}
            >
              <span>+</span> Create New Event ({events.length}/10)
            </button>
          </div>
        </div>

        {#if !isStorageConfigured}
          <div class="card" style="margin-top: 1.5rem; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; border: 1px solid #334155; padding: 1.5rem; border-radius: var(--radius-lg);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.25rem;">
              <div style="max-width: 620px;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.5rem;">⚡</span>
                  <h3 style="margin: 0; color: white;">Configure Supabase Cloud Storage</h3>
                </div>
                <p style="margin: 0; font-size: 0.9375rem; color: #cbd5e1; line-height: 1.5;">
                  Connect your Supabase project to store photos directly in the cloud and deliver instant high-res memories to your live gallery and TV screens.
                </p>
              </div>
              <button
                class="btn-primary"
                style="background: #2563eb; border-color: #2563eb; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 700; white-space: nowrap;"
                onclick={openStorageSettingsModal}
              >
                <span>⚙️</span> Configure Storage
              </button>
            </div>
          </div>
        {/if}

        {#if events.length === 0}
          <div class="card empty-state" style="margin-top: 1.5rem;">
            <div class="empty-icon">📁</div>
            <h3>No events created yet</h3>
            <p class="text-secondary">
              Click '+ Create New Event' above to set up your event space and generate QR codes.
            </p>
          </div>
        {:else}
          <div class="events-grid" style="margin-top: 1.5rem;">
            {#each events as event}
              <div class="card event-card text-left">
                <div class="event-card-header">
                  <div>
                    <span class="event-status status-{event.status}"
                      >{event.status}</span
                    >
                    <h3 class="event-title">{event.name}</h3>
                    {#if event.tagline}
                      <p class="event-tagline">{event.tagline}</p>
                    {/if}
                  </div>
                  <span class="event-date">📅 {event.date}</span>
                </div>

                <div class="event-stats">
                  <div class="stat-item">
                    <span class="stat-value" style={(event.total_photos || 0) >= 100 ? "color: var(--color-danger); font-weight: 800;" : ""}>{event.total_photos || 0} / 100</span>
                    <span class="stat-label">Photos (Max 100)</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" style="color: var(--color-success)"
                      >{event.approved_photos || 0}</span
                    >
                    <span class="stat-label">Approved</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" style="color: var(--color-primary)"
                      >{event.pending_photos || 0}</span
                    >
                    <span class="stat-label">Pending</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value">{event.total_guests || 0}</span>
                    <span class="stat-label">Guests</span>
                  </div>
                </div>

                <div class="event-card-actions">
                  <div class="event-card-actions-row">
                    <button
                      class="btn-secondary btn-sm"
                      onclick={() => openQrModal(event)}
                    >
                      <span>📱</span> QR Code
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      onclick={() => openSlideshow(event.slug)}
                    >
                      <span>📺</span> Slideshow
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      disabled={isSyncingDrive && syncingEventSlug === event.slug}
                      onclick={() => handleBackupEventToDrive(event)}
                      title="Backup event photos to Google Drive (connects to Google)"
                    >
                      <span>☁️</span> {isSyncingDrive && syncingEventSlug === event.slug ? (driveSyncProgress || "Backing up...") : "GDrive"}
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3);"
                      onclick={() => openDeleteModal(event)}
                      title="Delete Event Space"
                    >
                      <span>🗑️</span>
                    </button>
                  </div>
                  <button
                    class="btn-primary btn-sm event-card-manage-btn"
                    onclick={() => viewEvent(event)}
                  >
                    Manage &rarr;
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 4. EVENT DETAIL VIEW (Host) -->
    {:else if hostView === "event_detail" && selectedEvent}
      <div class="event-detail-view">
        <button
          class="btn-secondary btn-sm"
          style="margin-bottom: 1rem;"
          onclick={() => {
            stopHostAutoSync();
            hostView = "dashboard";
            loadEvents();
          }}
        >
          &larr; Back to Events
        </button>

        {#if successMsg}
          <div class="alert-success" style="margin-bottom: 1rem;">
            ✨ {successMsg}
          </div>
        {/if}

        <div class="card detail-header-card">
          <div class="detail-header-flex">
            <div>
              <div
                style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"
              >
                <span class="event-status status-{selectedEvent.status}"
                  >{selectedEvent.status}</span
                >
                <button
                  class="btn-secondary btn-sm"
                  style="font-size: 0.75rem; padding: 0.15rem 0.6rem;"
                  onclick={handleToggleEventStatus}
                >
                  {(selectedEvent.status || "active") === "active"
                    ? "🔒 Close Event"
                    : "🟢 Reopen Event"}
                </button>
              </div>

              <h2>{selectedEvent.name}</h2>
              {#if selectedEvent.tagline}
                <p class="text-secondary" style="margin-top: 0.25rem;">
                  {selectedEvent.tagline}
                </p>
              {/if}
              <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.35rem;">
                <p
                  class="text-secondary"
                  style="font-size: 0.875rem; margin: 0;"
                >
                  Date: <strong>{selectedEvent.date}</strong> • Join URL:
                  <code>/event/{selectedEvent.slug}</code>
                </p>
                <span
                  class="status-pill"
                  style="font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.65rem; border-radius: 9999px; background: {(approvedPhotos.length + pendingPhotos.length) >= 100 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.12)'}; color: {(approvedPhotos.length + pendingPhotos.length) >= 100 ? 'var(--color-danger)' : '#3b82f6'}; border: 1px solid {(approvedPhotos.length + pendingPhotos.length) >= 100 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.25)'};"
                >
                  📸 {approvedPhotos.length + pendingPhotos.length} / 100 Photos {(approvedPhotos.length + pendingPhotos.length) >= 100 ? '(Capacity Full)' : 'Capacity'}
                </span>
              </div>
            </div>

            <div class="detail-actions-box">
              <div class="detail-actions-row">
                <button
                  class="btn-primary btn-sm"
                  onclick={() => openSlideshow(selectedEvent.slug)}
                >
                  <span>📺</span> Launch Slideshow
                </button>
                <button
                  class="btn-secondary btn-sm"
                  disabled={isExportingArchive}
                  onclick={() => handleExportFullArchive(selectedEvent.slug)}
                  title="Full Archive: metadata.json + photos"
                >
                  <span>📦</span>
                  {isExportingArchive
                    ? "Packaging..."
                    : "Export Archive"}
                </button>
                <button
                  class="btn-secondary btn-sm"
                  disabled={isSyncingDrive}
                  onclick={() => handleBackupEventToDrive(selectedEvent)}
                  title="Backup event photos to Google Drive (connects to Google)"
                >
                  <span>☁️</span>
                  {isSyncingDrive
                    ? driveSyncProgress || "Backing up..."
                    : isDriveConnected
                      ? "Backup to GDrive"
                      : "GDrive (Connect)"}
                </button>
                {#if isDriveConnected && driveEventFolderUrl}
                  <a
                    href={driveEventFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn-secondary btn-sm"
                    style="text-decoration: none;"
                    title="Open Event Album in Google Drive"
                  >
                    <span>📁</span> Open Drive ↗
                  </a>
                {/if}
                <button
                  class="btn-secondary btn-sm"
                  onclick={() => openQrModal(selectedEvent, false)}
                >
                  <span>📱</span> QR Code
                </button>
                <button
                  class="btn-secondary btn-sm"
                  onclick={() => navigate(`/event/${selectedEvent.slug}`)}
                >
                  <span>👀</span> Guest View
                </button>
                <button
                  class="btn-secondary btn-sm"
                  style="color: var(--color-danger);"
                  onclick={() => openDeleteModal(selectedEvent)}
                >
                  <span>🗑️</span> Delete
                </button>
              </div>
            </div>
          </div>

          <!-- Host Tabs -->
          <div class="host-tabs-bar">
            <button
              class="host-tab-btn {hostDetailTab === 'queue' ? 'active' : ''}"
              onclick={() => (hostDetailTab = "queue")}
            >
              <span>Moderation Queue</span>
              {#if pendingPhotos.length > 0}
                <span class="tab-badge">{pendingPhotos.length}</span>
              {/if}
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'gallery' ? 'active' : ''}"
              onclick={() => (hostDetailTab = "gallery")}
            >
              <span>Live Gallery ({approvedPhotos.length})</span>
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'guests' ? 'active' : ''}"
              onclick={() => {
                hostDetailTab = "guests";
                loadEventGuests(selectedEvent.slug);
              }}
            >
              <span>👥 Guests ({eventGuests.length || selectedEvent.total_guests || 0})</span>
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'analytics'
                ? 'active'
                : ''}"
              onclick={() => {
                hostDetailTab = "analytics";
                loadAnalytics(selectedEvent.slug);
              }}
            >
              <span>📊 Analytics</span>
            </button>
            <button
              class="host-tab-btn {hostDetailTab === 'settings'
                ? 'active'
                : ''}"
              onclick={() => (hostDetailTab = "settings")}
            >
              <span>⚙️ Branding & Settings</span>
            </button>
          </div>
        </div>

        <!-- TAB 1: MODERATION QUEUE -->
        {#if hostDetailTab === "queue"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Pending Review ({pendingPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  {selectedEvent.moderation_enabled 
                    ? "Review and approve attendee photos before they appear on the live wall." 
                    : "⚡ Auto-Approve is ON: New guest photos stream directly to the live wall without manual review."}
                </p>
              </div>

              <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onclick={() => loadHostEventPhotos(selectedEvent.slug, true)}
                  disabled={isHostPhotoSyncing}
                  title="Sync photos directly from Supabase Cloud Storage"
                  style="display: inline-flex; align-items: center; gap: 0.35rem;"
                >
                  <span style={isHostPhotoSyncing ? 'display: inline-block; animation: spin 1s linear infinite;' : ''}>🔄</span>
                  <span>{isHostPhotoSyncing ? "Syncing..." : "Sync Cloud"}</span>
                </button>

                <button
                  type="button"
                  class="auto-approve-toggle-btn {selectedEvent.moderation_enabled ? 'mode-manual' : 'mode-auto'}"
                  onclick={handleToggleAutoApprove}
                  title={selectedEvent.moderation_enabled 
                    ? "Turn ON Auto-Approve (All new photos stream live instantly)" 
                    : "Turn OFF Auto-Approve (Review incoming photos manually)"}
                >
                  {#if selectedEvent.moderation_enabled}
                    <span>🛡️ Auto-Approve: <strong>OFF</strong></span>
                  {:else}
                    <span>⚡ Auto-Approve: <strong>ON</strong></span>
                  {/if}
                </button>

                {#if pendingPhotos.length > 0}
                  <div class="bulk-actions">
                    <button
                      class="btn-secondary btn-sm"
                      onclick={handleBulkReject}>Reject All</button
                    >
                    <button class="btn-primary btn-sm" onclick={handleBulkApprove}
                      >Approve All ({pendingPhotos.length})</button
                    >
                  </div>
                {/if}
              </div>
            </div>

            {#if pendingPhotos.length === 0}
              <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">🎉</div>
                <h4>Queue is Clear!</h4>
                <p class="text-secondary">
                  No photos are waiting for review. New guest uploads will
                  appear here in real-time.
                </p>
              </div>
            {:else}
              <div class="moderation-grid">
                {#each pendingPhotos as photo}
                  <div class="mod-card">
                    <button
                      class="mod-thumb-btn"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={getPhotoSrc(photo, true)}
                        alt="Pending upload"
                        class="mod-thumb"
                      />
                    </button>
                    <div class="mod-body">
                      <div class="mod-author-info">
                        <strong>{photo.guest_name || "Anonymous Guest"}</strong>
                        <span
                          class="text-secondary"
                          style="font-size: 0.75rem;"
                        >
                          {new Date(photo.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div class="mod-btn-row">
                        <button
                          class="mod-btn btn-reject"
                          onclick={() => handleRejectPhoto(photo.id)}
                        >
                          Reject
                        </button>
                        <button
                          class="mod-btn btn-approve"
                          onclick={() => handleApprovePhoto(photo.id)}
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- TAB 2: LIVE GALLERY (Host View) -->
        {:else if hostDetailTab === "gallery"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Published Live Photos ({approvedPhotos.length})</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Photos currently visible to all event attendees.
                </p>
              </div>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onclick={() => loadHostEventPhotos(selectedEvent.slug, true)}
                  disabled={isHostPhotoSyncing}
                  title="Sync photos directly from Supabase Cloud Storage"
                  style="display: inline-flex; align-items: center; gap: 0.35rem;"
                >
                  <span style={isHostPhotoSyncing ? 'display: inline-block; animation: spin 1s linear infinite;' : ''}>🔄</span>
                  <span>{isHostPhotoSyncing ? "Syncing..." : "Sync Cloud"}</span>
                </button>
              </div>
            </div>

            {#if approvedPhotos.length === 0}
              <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-icon">📷</div>
                <h4>No Live Photos Yet</h4>
                <p class="text-secondary">
                  Approve photos from the moderation queue to make them visible
                  here.
                </p>
              </div>
            {:else}
              <div class="moderation-grid">
                {#each approvedPhotos as photo}
                  <div class="mod-card">
                    <button
                      class="mod-thumb-btn"
                      onclick={() => (selectedPreviewPhoto = photo)}
                    >
                      <img
                        src={getPhotoSrc(photo, true)}
                        alt="Approved upload"
                        class="mod-thumb"
                      />
                    </button>
                    <div class="mod-body">
                      <div class="mod-author-info">
                        <strong>{photo.guest_name || "Anonymous Guest"}</strong>
                        <span class="status-pill pill-approved">🟢 Live</span>
                      </div>
                      <div style="display: flex; gap: 0.35rem; margin-top: 0.5rem;">
                        <button
                          class="btn-secondary btn-sm"
                          style="flex: 1;"
                          onclick={() => handleRevertPhoto(photo.id)}
                          title="Revert back to moderation queue"
                        >
                          ↩️ Revert
                        </button>
                        <button
                          class="btn-secondary btn-sm"
                          style="color: var(--color-danger); padding: 0.375rem 0.65rem;"
                          onclick={() => handleDeleteLivePhoto(photo.id, photo)}
                          title="Delete photo permanently from Live Gallery and Supabase Cloud Storage"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- TAB: GUEST DIRECTORY -->
        {:else if hostDetailTab === "guests"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>👥 Guest Directory</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Attendees who have joined or contributed photos to this event space across all devices.
                </p>
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <button
                  class="btn-secondary btn-sm"
                  onclick={() => loadEventGuests(selectedEvent.slug)}
                  disabled={isLoadingGuests}
                >
                  <span class:spin={isLoadingGuests}>🔄</span> Refresh Guests
                </button>
              </div>
            </div>

            {#if isLoadingGuests && eventGuests.length === 0}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading guest directory...</p>
              </div>
            {:else if eventGuests.length === 0}
              <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
                <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">👥</div>
                <h4 style="margin-bottom: 0.35rem;">No Guests Joined Yet</h4>
                <p class="text-secondary" style="font-size: 0.9rem; max-width: 380px; margin: 0 auto;">
                  When attendees scan the event QR code, join with their name, or upload photos, their profiles will appear here in real-time.
                </p>
              </div>
            {:else}
              <div class="guests-directory-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem;">
                {#each eventGuests as guest}
                  <div class="guest-card" style="background: var(--color-surface, rgba(255, 255, 255, 0.04)); border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1)); border-radius: var(--radius-md, 12px); padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <div style="display: flex; align-items: center; gap: 0.85rem;">
                      <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.15rem; flex-shrink: 0; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);">
                        {(guest.name || "G").charAt(0).toUpperCase()}
                      </div>
                      <div style="flex: 1; min-width: 0;">
                        <h4 style="margin: 0; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text);">
                          {guest.name}
                        </h4>
                        <span style="font-size: 0.75rem; color: var(--color-text-secondary, #94a3b8); display: block; margin-top: 0.15rem;">
                          Joined {guest.created_at ? new Date(guest.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                        </span>
                      </div>
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem; padding: 0.6rem 0.85rem; background: rgba(0,0,0,0.18); border-radius: var(--radius-sm, 8px); border: 1px solid rgba(255, 255, 255, 0.05);">
                      <span style="color: var(--color-text-secondary, #94a3b8);">Photos Contributed</span>
                      <span style="font-weight: 700; color: #3b82f6; font-size: 0.9rem;">
                        📸 {guest.upload_count || 0} {guest.upload_count === 1 ? 'photo' : 'photos'}
                      </span>
                    </div>

                    {#if guest.upload_count > 0}
                      <button
                        class="btn-secondary btn-sm"
                        style="width: 100%; justify-content: center; font-size: 0.8rem; margin-top: 0.25rem;"
                        onclick={() => {
                          hostDetailTab = "gallery";
                        }}
                      >
                        View Photos in Gallery &rarr;
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- TAB 3: ANALYTICS -->
        {:else if hostDetailTab === "analytics"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Event Engagement & Analytics</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Real-time metrics on guest participation, moderation ratios,
                  and storage.
                </p>
              </div>
              <button
                class="btn-secondary btn-sm"
                onclick={() => loadAnalytics(selectedEvent.slug)}
              >
                🔄 Refresh Metrics
              </button>
            </div>

            {#if !eventAnalytics}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading analytics...</p>
              </div>
            {:else}
              <div class="analytics-grid">
                <div class="analytics-stat-card">
                  <span class="analytics-num"
                    >{eventAnalytics.total_photos}</span
                  >
                  <span class="analytics-label">Total Uploads</span>
                </div>
                <div class="analytics-stat-card">
                  <span
                    class="analytics-num"
                    style="color: var(--color-success)"
                    >{eventAnalytics.approved}</span
                  >
                  <span class="analytics-label">Approved & Live</span>
                </div>
                <div class="analytics-stat-card">
                  <span
                    class="analytics-num"
                    style="color: var(--color-primary)"
                    >{eventAnalytics.unique_guests}</span
                  >
                  <span class="analytics-label">Active Guests</span>
                </div>
                <div class="analytics-stat-card">
                  <span class="analytics-num"
                    >{eventAnalytics.storage_used_mb} MB</span
                  >
                  <span class="analytics-label">Disk Storage Used</span>
                </div>
              </div>

              <!-- Top Contributors & Activity Breakdown -->
              <div class="analytics-columns">
                <div class="analytics-sub-card">
                  <h4>🏆 Top Guest Contributors</h4>
                  {#if !eventAnalytics.top_contributors || eventAnalytics.top_contributors.length === 0}
                    <p
                      class="text-secondary"
                      style="font-size: 0.875rem; margin-top: 0.5rem;"
                    >
                      No contributor data yet.
                    </p>
                  {:else}
                    <div class="contributors-list">
                      {#each eventAnalytics.top_contributors as contributor, idx}
                        <div class="contributor-row">
                          <span class="contributor-rank">#{idx + 1}</span>
                          <span class="contributor-name"
                            >{contributor.name}</span
                          >
                          <span class="contributor-count"
                            >{contributor.count} photos</span
                          >
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <div class="analytics-sub-card">
                  <h4>⏱️ Uploads by Hour</h4>
                  {#if !eventAnalytics.uploads_over_time || eventAnalytics.uploads_over_time.length === 0}
                    <p
                      class="text-secondary"
                      style="font-size: 0.875rem; margin-top: 0.5rem;"
                    >
                      No timeline activity recorded yet.
                    </p>
                  {:else}
                    <div class="timeline-bars-list">
                      {#each eventAnalytics.uploads_over_time as slot}
                        <div class="timeline-row">
                          <span class="timeline-hour">{slot.hour}</span>
                          <div class="timeline-bar-wrapper">
                            <div
                              class="timeline-bar-fill"
                              style="width: {Math.min(
                                100,
                                Math.max(
                                  8,
                                  (slot.count /
                                    (eventAnalytics.total_photos || 1)) *
                                    100,
                                ),
                              )}%"
                            ></div>
                          </div>
                          <span class="timeline-count">{slot.count}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- TAB 4: GOOGLE DRIVE BACKUP -->
        {:else if hostDetailTab === "drive"}
          <div class="card moderation-panel">
            <div class="panel-header-row">
              <div>
                <h3>Google Drive Cloud Backup</h3>
                <p class="text-secondary" style="font-size: 0.875rem;">
                  Backup high-resolution approved photos to your Google Drive
                  folder.
                </p>
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                {#if driveGlobalStatus.is_connected}
                  <span class="status-pill pill-approved"
                    >🟢 {driveGlobalStatus.email || "Connected"}</span
                  >
                  <button
                    class="btn-secondary btn-sm"
                    onclick={handleDisconnectDrive}>Disconnect</button
                  >
                {:else}
                  <span
                    class="status-pill"
                    style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary);"
                    >⚪ Not Connected</span
                  >
                {/if}
              </div>
            </div>

            <div class="drive-sync-panel-grid">
              <div class="card drive-sync-stat-card">
                <span class="analytics-label">Backup Destination Folder</span>
                <strong
                  style="font-size: 1.125rem; color: var(--color-primary); display: block; margin-top: 0.25rem;"
                >
                  📁 Google Drive / Caps - {selectedEvent.name}
                </strong>

                <div
                  style="margin-top: 1.25rem; border-top: 1px solid var(--color-border); padding-top: 1rem;"
                >
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem;"
                  >
                    <span class="text-secondary">Approved Photos:</span>
                    <strong>{eventDriveSyncStatus.total_approved}</strong>
                  </div>
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem;"
                  >
                    <span class="text-secondary">Synced to Cloud:</span>
                    <strong style="color: var(--color-success)"
                      >{eventDriveSyncStatus.total_synced}</strong
                    >
                  </div>
                  <div
                    style="display: flex; justify-content: space-between; font-size: 0.875rem;"
                  >
                    <span class="text-secondary">Pending Cloud Sync:</span>
                    <strong style="color: var(--color-primary)"
                      >{eventDriveSyncStatus.unsynced_count}</strong
                    >
                  </div>
                </div>

                <div
                  style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;"
                >
                  {#if !driveGlobalStatus.is_connected}
                    <button
                      class="btn-primary"
                      style="width: 100%;"
                      onclick={handleConnectRealGoogleDrive}
                    >
                      <span>🔗</span> Connect Google Account (OAuth)
                    </button>
                    <button
                      class="btn-secondary"
                      style="width: 100%;"
                      onclick={handleMockConnectDrive}
                    >
                      <span>⚡</span> Fast Testing Mode (Simulated Sync)
                    </button>
                    <button
                      class="btn-secondary btn-sm"
                      style="width: 100%; font-size: 0.8125rem;"
                      onclick={() => (isDriveCredentialsModalOpen = true)}
                    >
                      <span>⚙️</span> Configure Google OAuth Keys
                    </button>
                  {:else if eventDriveSyncStatus.total_approved === 0}
                    <div
                      class="empty-state"
                      style="padding: 1rem; border: 1px dashed var(--color-border); border-radius: var(--radius-md); font-size: 0.875rem; background: var(--color-surface);"
                    >
                      ℹ️ No approved photos yet! Go to the <strong
                        >Moderation Queue</strong
                      >
                      tab and click <strong>Approve</strong> on photos before syncing.
                    </div>
                  {:else if eventDriveSyncStatus.unsynced_count === 0}
                    <div
                      style="padding: 0.75rem 1rem; background: var(--color-success-bg); border: 1px solid var(--color-success); color: var(--color-success); border-radius: var(--radius-md); font-size: 0.875rem; text-align: center; font-weight: 600;"
                    >
                      ✅ All {eventDriveSyncStatus.total_approved} approved photos
                      are backed up to Google Drive!
                    </div>
                  {:else}
                    <button
                      class="btn-primary"
                      style="width: 100%;"
                      disabled={isSyncingDrive}
                      onclick={handleTriggerDriveSync}
                    >
                      <span>☁️</span>
                      {isSyncingDrive
                        ? "Syncing in Background..."
                        : `Sync ${eventDriveSyncStatus.unsynced_count} Photos to Google Drive`}
                    </button>
                  {/if}
                </div>
              </div>

              <div class="card drive-sync-info-card">
                <h4>Drive Sync Features</h4>
                <ul class="drive-features-list">
                  <li>
                    ✅ <strong>Incremental Sync</strong>: Only newly approved
                    photos are uploaded.
                  </li>
                  <li>
                    ✅ <strong>Original Quality</strong>: Preserves
                    full-resolution camera captures.
                  </li>
                  <li>
                    ✅ <strong>Automatic Organization</strong>: Files are stored
                    under <code>Caps - {selectedEvent.name}</code>.
                  </li>
                  <li>
                    ✅ <strong>Drive Sync Log</strong>: Every upload is tracked
                    in the local database.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- TAB 5: SLIDESHOW & SETTINGS -->
        {:else if hostDetailTab === "settings"}
          <div class="card moderation-panel">
            <h3 style="margin-bottom: 1.25rem;">Event Branding & Identity</h3>

            <!-- Custom Logo & Tagline Editor -->
            <div
              style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.75rem; max-width: 540px;"
            >
              <h4 style="margin-bottom: 0.75rem;">Custom Event Logo</h4>
              <div
                style="display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.25rem;"
              >
                {#if selectedEvent.logo}
                  <div
                    style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 0.5rem; border-radius: var(--radius-md);"
                  >
                    <img
                      src={selectedEvent.logo}
                      alt="Event logo"
                      style="max-height: 50px; max-width: 140px; object-fit: contain;"
                    />
                  </div>
                {:else}
                  <div
                    style="width: 50px; height: 50px; background: var(--color-primary-light); color: var(--color-primary); display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); font-size: 1.5rem;"
                  >
                    📸
                  </div>
                {/if}

                <div style="display: flex; gap: 0.5rem;">
                  <input
                    type="file"
                    accept="image/*"
                    bind:this={logoFileInputEl}
                    onchange={handleLogoUpload}
                    style="display: none;"
                  />
                  <button
                    class="btn-secondary btn-sm"
                    disabled={isUploadingLogo}
                    onclick={() => logoFileInputEl?.click()}
                  >
                    <span>🖼️</span>
                    {isUploadingLogo
                      ? "Uploading..."
                      : selectedEvent.logo
                        ? "Change Logo"
                        : "Upload Logo"}
                  </button>
                  {#if selectedEvent.logo}
                    <button
                      class="btn-secondary btn-sm"
                      style="color: var(--color-danger);"
                      onclick={handleRemoveLogo}
                    >
                      Remove
                    </button>
                  {/if}
                </div>
              </div>

              <div>
                <label class="form-label" for="eventTaglineEdit"
                  >Event Tagline</label
                >
                <div style="display: flex; gap: 0.5rem;">
                  <input
                    id="eventTaglineEdit"
                    type="text"
                    class="input-field"
                    placeholder="e.g. New Event"
                    bind:value={selectedEvent.tagline}
                  />
                  <button
                    class="btn-primary btn-sm"
                    onclick={handleSaveBranding}
                  >
                    Save Tagline
                  </button>
                </div>
              </div>
            </div>

            <!-- Event Rules & Upload Limits -->
            <div
              style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.75rem; max-width: 540px;"
            >
              <h4 style="margin-bottom: 0.75rem;">Event Rules & Limits</h4>
              
              <div class="form-stack">
                <div>
                  <label class="form-label" for="eventLimitInput">Per-Guest Upload Limit (photos)</label>
                  <input
                    id="eventLimitInput"
                    type="number"
                    min="1"
                    max="100"
                    class="input-field"
                    bind:value={selectedEvent.guest_upload_limit}
                  />
                  <span class="helper-text">Number of photos each attendee can share (event capacity: 100 photos maximum).</span>
                </div>

                <div class="checkbox-row" style="margin-top: 0.5rem;">
                  <input
                    id="eventModToggle"
                    type="checkbox"
                    bind:checked={selectedEvent.moderation_enabled}
                    onchange={handleCheckboxToggleModeration}
                  />
                  <label for="eventModToggle">
                    <strong>Enable Live Photo Moderation</strong>
                    <span class="helper-text">When checked, photos require admin approval before appearing on the live wall.</span>
                  </label>
                </div>

                <div class="checkbox-row">
                  <input
                    id="eventExifToggle"
                    type="checkbox"
                    bind:checked={selectedEvent.exif_strip}
                  />
                  <label for="eventExifToggle">
                    <strong>Strip GPS & EXIF Metadata</strong>
                    <span class="helper-text">Removes GPS location and private camera metadata for attendee privacy.</span>
                  </label>
                </div>

                <div class="checkbox-row" style="background: rgba(59, 130, 246, 0.05); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid rgba(59, 130, 246, 0.2); margin-top: 0.5rem;">
                  <div style="display: flex; flex-direction: column; gap: 0.25rem; width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <strong>🔒 End-to-End Photo Encryption</strong>
                      <span class="badge" style="background: {selectedEvent.is_encrypted ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)'}; color: {selectedEvent.is_encrypted ? '#34d399' : '#94a3b8'}; border: 1px solid {selectedEvent.is_encrypted ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.3)'}; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px;">
                        {selectedEvent.is_encrypted ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <span class="helper-text" style="font-size: 0.8125rem;">
                      {selectedEvent.is_encrypted
                        ? "Original photos and thumbnails are encrypted with AES-256-GCM. The decryption key is embedded in event QR codes."
                        : "Photos for this event are uploaded in standard web format."}
                    </span>
                    {#if selectedEvent.is_encrypted && selectedEvent.encryption_key}
                      <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center;">
                        <input
                          type="password"
                          readonly
                          value={selectedEvent.encryption_key}
                          style="font-family: monospace; font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); flex: 1;"
                          id="eventKeyDisplay"
                        />
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          onclick={() => {
                            navigator.clipboard.writeText(selectedEvent.encryption_key);
                            alert("Event decryption key copied to clipboard!");
                          }}
                        >
                          Copy Key
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>

                <button
                  type="button"
                  class="btn-primary btn-sm"
                  style="align-self: flex-start; margin-top: 0.75rem;"
                  onclick={handleSaveEventSettings}
                >
                  Save Limit & Rules
                </button>
              </div>
            </div>

            <h3 style="margin-bottom: 1.25rem;">Slideshow Display Settings</h3>

            <form
              onsubmit={(e) => {
                e.preventDefault();
                handleSaveSlideshowConfig();
              }}
              class="form-stack"
              style="max-width: 540px;"
            >
              <div class="form-row">
                <div>
                  <label class="form-label" for="slideInterval"
                    >Slide Interval (seconds)</label
                  >
                  <input
                    id="slideInterval"
                    type="number"
                    min="2"
                    max="60"
                    class="input-field"
                    bind:value={selectedEvent.slideshow_interval}
                  />
                </div>
                <div>
                  <label class="form-label" for="slideTrans"
                    >Transition Style</label
                  >
                  <select
                    id="slideTrans"
                    class="input-field"
                    bind:value={selectedEvent.slideshow_transition}
                  >
                    <option value="fade">Smooth Fade</option>
                    <option value="slide">Horizontal Slide</option>
                    <option value="zoom">Ken Burns Zoom</option>
                  </select>
                </div>
              </div>

              <div class="checkbox-row">
                <input
                  id="slideQrToggle"
                  type="checkbox"
                  bind:checked={selectedEvent.slideshow_show_qr}
                />
                <label for="slideQrToggle">
                  <strong>Show Picture-in-Picture QR Code</strong>
                  <span class="helper-text"
                    >Displays a small QR in the corner so venue attendees can
                    scan while watching.</span
                  >
                </label>
              </div>

              <div class="checkbox-row">
                <input
                  id="slideAuthorToggle"
                  type="checkbox"
                  bind:checked={selectedEvent.slideshow_show_author}
                />
                <label for="slideAuthorToggle">
                  <strong>Show "Captured by [Name]" attribution overlay</strong>
                  <span class="helper-text"
                    >Displays subtle attendee name on slide.</span
                  >
                </label>
              </div>

              <button
                type="submit"
                class="btn-primary"
                style="align-self: flex-start; margin-top: 0.5rem;"
              >
                Save Slideshow Settings
              </button>
            </form>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
  </main>

  <!-- DELETE EVENT CONFIRMATION MODAL -->
  {#if isDeleteModalOpen && selectedEvent}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isDeleteModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isDeleteModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3 style="color: var(--color-danger);">Delete Event Space</h3>
          <button class="close-btn" onclick={() => (isDeleteModalOpen = false)}
            >&times;</button
          >
        </div>

        {#if (selectedEvent.total_photos || (hostView === 'event_detail' && selectedEvent.slug === selectedEvent?.slug ? (approvedPhotos.length + pendingPhotos.length) : 0) || 0) > 0}
          <!-- Supabase Cloud Storage Deletion Warning -->
          <div
            class="alert-warning"
            style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 1rem; color: var(--color-danger);"
          >
            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
              <span style="font-size: 1.25rem; line-height: 1;">⚠️</span>
              <div style="font-size: 0.875rem; line-height: 1.45;">
                <strong style="display: block; margin-bottom: 0.25rem;">Supabase Cloud Storage Files Will Be Deleted</strong>
                Deleting <strong>{selectedEvent.name}</strong> will permanently delete all uploaded original photos, thumbnails, and guest media stored in <strong>Supabase Cloud Storage</strong> (<code>{selectedEvent.slug}/*</code>) and local cache. This action cannot be reversed.
              </div>
            </div>
          </div>

          <!-- Google Drive Backup Reminder -->
          <div
            class="alert-info"
            style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 1.25rem; color: var(--color-text);"
          >
            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
              <span style="font-size: 1.25rem; line-height: 1;">💡</span>
              <div style="font-size: 0.85rem; line-height: 1.45; width: 100%;">
                <strong style="display: block; margin-bottom: 0.25rem; color: #3b82f6;">Reminder: Backup Before Deleting!</strong>
                Please ensure you have backed up your event memories to Google Drive or downloaded the full ZIP archive before deleting so no photos are lost.
                <div style="margin-top: 0.65rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    disabled={isSyncingDrive}
                    onclick={() => handleBackupEventToDrive(selectedEvent)}
                    style="font-size: 0.78rem; padding: 0.35rem 0.75rem;"
                    title="Connect to Google & Backup Event Photos"
                  >
                    <span>☁️</span> {isSyncingDrive ? (driveSyncProgress || "Backing up...") : "Backup to Google Drive"}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    disabled={isExportingArchive}
                    onclick={() => handleExportFullArchive(selectedEvent.slug)}
                    style="font-size: 0.78rem; padding: 0.35rem 0.75rem;"
                  >
                    <span>📦</span> {isExportingArchive ? "Packaging..." : "Download ZIP Archive"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <!-- Fresh/Empty Event Notice -->
          <div
            class="alert-info"
            style="background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-md); padding: 0.9rem 1rem; margin-bottom: 1.25rem;"
          >
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 1.5rem;">🗑️</span>
              <div style="font-size: 0.9rem; color: var(--color-text); line-height: 1.4;">
                Are you sure you want to permanently delete <strong>{selectedEvent.name}</strong>?
                <span class="text-secondary" style="display: block; font-size: 0.8125rem; margin-top: 0.2rem;">
                  This fresh event contains 0 photos and its space can be safely removed immediately.
                </span>
              </div>
            </div>
          </div>
        {/if}

        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleDeleteEvent();
          }}
          class="form-stack"
        >
          {#if (selectedEvent.total_photos || (hostView === 'event_detail' && selectedEvent.slug === selectedEvent?.slug ? (approvedPhotos.length + pendingPhotos.length) : 0) || 0) > 0}
            <div>
              <label class="form-label" for="confirmName">
                Type <strong>{selectedEvent.name}</strong> to confirm:
              </label>
              <input
                id="confirmName"
                type="text"
                class="input-field"
                placeholder={selectedEvent.name}
                bind:value={deleteConfirmInput}
                required
              />
            </div>
          {/if}

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isDeleteModalOpen = false)}>Cancel</button
            >
            <button
              type="submit"
              class="btn-primary"
              style="background: var(--color-danger); border-color: var(--color-danger);"
              disabled={((selectedEvent.total_photos || (hostView === 'event_detail' && selectedEvent.slug === selectedEvent?.slug ? (approvedPhotos.length + pendingPhotos.length) : 0) || 0) > 0 &&
                deleteConfirmInput.trim().toLowerCase() !== selectedEvent.name.trim().toLowerCase()) ||
                isSubmitting}
            >
              {isSubmitting ? "Deleting..." : (selectedEvent.total_photos || (hostView === 'event_detail' && selectedEvent.slug === selectedEvent?.slug ? (approvedPhotos.length + pendingPhotos.length) : 0) || 0) > 0 ? "Delete Event & Cloud Files" : "Delete Event Space"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- IN-APP CAMERA VIEWFINDER MODAL -->
  {#if isCameraOpen}
    <div class="camera-modal-backdrop" role="dialog" aria-modal="true">
      <div class="camera-viewport-container">
        <!-- Live Camera Stream -->
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={cameraVideoEl}
          autoplay
          playsinline
          muted
          class="camera-live-video"
        ></video>

        <!-- Live Frame Overlay Preview on Camera -->
        {#if guestEventData?.frame_url}
          <img
            src={guestEventData.frame_url}
            alt="Live frame overlay"
            class="camera-live-frame-overlay"
          />
        {:else if guestEventData?.frame_config && guestEventData.frame_config.type === "preset"}
          <div class="camera-preset-frame-overlay preset-{guestEventData.frame_config.presetId || 'polaroid'}">
            {#if guestEventData.frame_config.presetId === "polaroid"}
              <div class="polaroid-overlay-chin">
                <span class="polaroid-chin-title">{guestEventData.frame_config.text || guestEventData.name}</span>
                {#if guestEventData.frame_config.subText || guestEventData.date}
                  <span class="polaroid-chin-sub">{guestEventData.frame_config.subText || guestEventData.date}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Top Navigation Bar -->
        <div class="camera-top-bar">
          <button
            type="button"
            class="camera-icon-btn"
            onclick={handleCloseCamera}
            title="Close Camera"
          >
            ✕
          </button>
          <div class="camera-top-actions">
            {#if hasTorch}
              <button
                type="button"
                class="camera-icon-btn {isTorchOn ? 'active' : ''}"
                onclick={handleToggleTorch}
                title="Toggle Flashlight"
              >
                {isTorchOn ? "🔦" : "⚡"}
              </button>
            {/if}
            {#if hasMultipleCameras}
              <button
                type="button"
                class="camera-icon-btn"
                onclick={handleFlipCamera}
                title="Flip Camera"
              >
                🔄
              </button>
            {/if}
          </div>
        </div>

        <!-- Bottom Shutter & Gallery Bar -->
        <div class="camera-bottom-bar">
          <button
            type="button"
            class="camera-icon-btn"
            onclick={() => {
              handleCloseCamera();
              fileInputEl?.click();
            }}
            title="Open Camera Roll"
          >
            🖼️
          </button>
          <button
            type="button"
            class="camera-shutter-btn"
            onclick={handleSnapPhoto}
            disabled={isSnapping}
            title="Take Photo"
          >
            <div class="camera-shutter-inner"></div>
          </button>
          <div style="width: 44px;"></div>
        </div>
      </div>
    </div>
  {/if}

  <!-- PHOTO STUDIO PREVIEW & CAPTION MODAL -->
  {#if isPhotoStudioOpen && studioFile}
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card photo-studio-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.25rem;">✨</span>
            <h3 style="margin: 0;">Photo Studio</h3>
          </div>
          <button class="close-btn" onclick={handleClosePhotoStudio}>&times;</button>
        </div>

        <div class="photo-studio-body" style="padding: 1rem 1.25rem;">
          <!-- Preview Canvas / Image -->
          <div class="photo-studio-preview-wrapper">
            {#if studioUseFrame && (guestEventData?.frame_url || (guestEventData?.frame_config && guestEventData.frame_config.type !== "none"))}
              <canvas
                bind:this={studioCanvasEl}
                width="600"
                height="750"
                class="photo-studio-canvas-preview"
              ></canvas>
            {:else}
              <img
                src={studioPreviewBlobUrl}
                alt="Raw capture preview"
                class="photo-studio-raw-img"
              />
            {/if}
          </div>

          <!-- Framing Toggle -->
          {#if guestEventData?.frame_url || (guestEventData?.frame_config && guestEventData.frame_config.type !== "none")}
            <div class="photo-studio-frame-toggle-row">
              <span class="toggle-label">Framing:</span>
              <div class="frame-toggle-pills">
                <button
                  type="button"
                  class="frame-toggle-btn {studioUseFrame ? 'active' : ''}"
                  onclick={() => {
                    studioUseFrame = true;
                    setTimeout(updateStudioCanvasPreview, 40);
                  }}
                >
                  🖼️ Framed Photo
                </button>
                <button
                  type="button"
                  class="frame-toggle-btn {!studioUseFrame ? 'active' : ''}"
                  onclick={() => {
                    studioUseFrame = false;
                  }}
                >
                  📷 Direct Photo (No Frame)
                </button>
              </div>
            </div>
          {/if}

          <!-- Optional 1-Line Caption Section -->
          <div class="photo-studio-caption-section">
            <div class="caption-label">
              <span>Add a Caption (Optional)</span>
              <span class="caption-char-count">{studioCaption.length}/120</span>
            </div>
            <div class="caption-input-wrapper">
              <input
                type="text"
                maxlength="120"
                placeholder="Write a message or wish for the event... ✨"
                bind:value={studioCaption}
                class="studio-caption-input"
              />
              <div class="caption-quick-emojis">
                {#each ["❤️", "🔥", "🥂", "🎉", "✨", "🥳"] as emoji}
                  <button
                    type="button"
                    class="quick-emoji-btn"
                    onclick={() => {
                      if (studioCaption.length + emoji.length <= 120) {
                        studioCaption = (studioCaption ? studioCaption + " " : "") + emoji;
                      }
                    }}
                  >
                    {emoji}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="modal-footer" style="padding: 1rem 1.25rem; display: flex; gap: 0.75rem; border-top: 1px solid var(--color-border);">
          <button
            type="button"
            class="btn-secondary"
            disabled={isSubmittingStudio}
            onclick={handleClosePhotoStudio}
            style="flex: 1;"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={isSubmittingStudio}
            onclick={handleSubmitPhotoStudio}
            style="flex: 2;"
          >
            <span>🚀</span> {isSubmittingStudio ? "Processing & Uploading..." : "Share to Live Feed"}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- PHOTO PREVIEW LIGHTBOX -->
  {#if selectedPreviewPhoto}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (selectedPreviewPhoto = null)}
      onkeydown={(e) => {
        if (e.key === "Escape") selectedPreviewPhoto = null;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lightbox-card" onclick={(e) => e.stopPropagation()}>
        <div class="lightbox-header">
          <div>
            <strong>Photo Preview</strong>
            {#if selectedPreviewPhoto.status === "pending"}
              <span
                class="status-pill pill-pending"
                style="margin-left: 0.5rem;">🟡 Pending Review</span
              >
            {:else if selectedPreviewPhoto.status === "approved"}
              <span
                class="status-pill pill-approved"
                style="margin-left: 0.5rem;">🟢 Live</span
              >
            {/if}
            {#if selectedPreviewPhoto.guest_name}
              <span
                class="text-secondary"
                style="margin-left: 0.5rem; font-size: 0.8125rem;"
                >by {selectedPreviewPhoto.guest_name}</span
              >
            {/if}
          </div>
          <button
            class="close-btn"
            onclick={() => (selectedPreviewPhoto = null)}>&times;</button
          >
        </div>

        <div class="lightbox-img-wrapper">
          <img
            src={getPhotoSrc(selectedPreviewPhoto, false)}
            alt="Full resolution capture"
            class="lightbox-img"
          />
        </div>

        {#if selectedPreviewPhoto.caption}
          <div class="lightbox-caption-box">
            <p>"{selectedPreviewPhoto.caption}"</p>
          </div>
        {/if}

        <div class="lightbox-reactions-row">
          <span class="lightbox-reactions-label">React:</span>
          {#each ["❤️", "🔥", "🥂", "🎉", "✨", "🥳"] as emoji}
            <button
              type="button"
              class="quick-emoji-btn"
              onclick={() => sendPhotoReaction(emoji, selectedPreviewPhoto.id)}
              title="React {emoji}"
            >
              {emoji}
            </button>
          {/each}
        </div>

        <div class="lightbox-footer">
          <div style="display: flex; gap: 0.75rem;">
            {#if isGuestRoute && guestSession && (selectedPreviewPhoto.guest_id === guestSession.guest.id || selectedPreviewPhoto.guest_name === guestSession.guest.name)}
              <button
                class="btn-secondary btn-sm"
                style="color: var(--color-danger); border-color: var(--color-danger);"
                onclick={() => handleDeleteOwnPhoto(selectedPreviewPhoto.id, selectedPreviewPhoto)}
              >
                🗑️ Delete Photo
              </button>
            {:else if !isGuestRoute && authStatus?.is_authenticated}
              <button
                class="btn-secondary btn-sm"
                style="color: var(--color-danger); border-color: var(--color-danger);"
                onclick={() => handleDeleteLivePhoto(selectedPreviewPhoto.id, selectedPreviewPhoto)}
                title="Permanently delete from live gallery and Supabase Cloud Storage"
              >
                🗑️ Delete Photo
              </button>
            {/if}
            <a
              href={getPhotoSrc(selectedPreviewPhoto, false)}
              download={selectedPreviewPhoto.filename || "photo.jpg"}
              class="btn-primary btn-sm"
            >
              <span>💾</span> Download Full-Res Original
            </a>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- CREATE EVENT MODAL -->
  {#if isCreateModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isCreateModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isCreateModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Create Event Space</h3>
          <button class="close-btn" onclick={() => (isCreateModalOpen = false)}
            >&times;</button
          >
        </div>

        {#if errorMsg}
          <div class="alert-error" style="margin-bottom: 1rem;">{errorMsg}</div>
        {/if}

        <form onsubmit={handleCreateEvent} class="form-stack">
          <!-- Event Limits Callout (100 Photos / 10 Events Max) -->
          <div
            class="event-limit-callout"
            style="background: {events.length >= 10 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.08)'}; border: 1px solid {events.length >= 10 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(59, 130, 246, 0.25)'}; border-radius: var(--radius-md); padding: 0.85rem 1rem; display: flex; align-items: flex-start; gap: 0.75rem;"
          >
            <span style="font-size: 1.35rem; line-height: 1;">{events.length >= 10 ? '⚠️' : '📸'}</span>
            <div style="font-size: 0.85rem; color: var(--color-text); line-height: 1.45;">
              <strong style="display: block; margin-bottom: 0.2rem; color: {events.length >= 10 ? '#ef4444' : '#3b82f6'};">
                {events.length >= 10 ? 'Event Space Quota Reached (10/10)' : 'Event Limits: 100 Photos • Max 10 Events • 24h Retention'}
              </strong>
              Each event space holds up to <strong>100 pictures</strong> and remains active for <strong>24 hours</strong> before automatic ephemeral cleanup. You are currently hosting <strong>{events.length} of 10</strong> allowed event spaces.
              {#if events.length >= 10}
                <span style="display: block; margin-top: 0.25rem; color: #ef4444; font-weight: 600;">Please delete an existing event to free up space before creating a new one.</span>
              {/if}
            </div>
          </div>

          <div>
            <label class="form-label" for="eventName">Event Name *</label>
            <input
              id="eventName"
              type="text"
              class="input-field"
              placeholder="New Event"
              bind:value={newEvent.name}
              required
            />
          </div>

          <div class="form-row">
            <div>
              <label class="form-label" for="eventDate">Date</label>
              <input
                id="eventDate"
                type="date"
                class="input-field"
                bind:value={newEvent.date}
              />
            </div>
            <div>
              <label class="form-label" for="uploadLimit"
                >Per-Guest Upload Limit</label
              >
              <input
                id="uploadLimit"
                type="number"
                min="1"
                max="100"
                class="input-field"
                bind:value={newEvent.guest_upload_limit}
              />
              <span class="helper-text" style="display: block; margin-top: 0.25rem; font-size: 0.75rem;">Max 100 photos total for this event.</span>
            </div>
          </div>

          <div>
            <label class="form-label" for="eventTagline"
              >Tagline / Subtitle (optional)</label
            >
            <input
              id="eventTagline"
              type="text"
              class="input-field"
              placeholder="e.g. New Event"
              bind:value={newEvent.tagline}
            />
          </div>

          <div class="checkbox-row">
            <input
              id="modToggle"
              type="checkbox"
              bind:checked={newEvent.moderation_enabled}
            />
            <label for="modToggle">
              <strong>Enable photo moderation queue</strong>
              <span class="helper-text"
                >You must approve photos before they appear on the live gallery.</span
              >
            </label>
          </div>

          <div class="checkbox-row">
            <input
              id="exifToggle"
              type="checkbox"
              bind:checked={newEvent.exif_strip}
            />
            <label for="exifToggle">
              <strong>Strip EXIF metadata (GPS location & device info)</strong>
              <span class="helper-text">Recommended for attendee privacy.</span>
            </label>
          </div>

          <div class="checkbox-row" style="background: rgba(59, 130, 246, 0.05); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid rgba(59, 130, 246, 0.2);">
            <input
              id="encryptToggle"
              type="checkbox"
              bind:checked={newEvent.is_encrypted}
            />
            <label for="encryptToggle">
              <strong>🔒 End-to-End Encryption (E2EE)</strong>
              <span class="helper-text">Original photos & thumbnails are encrypted client-side with AES-256-GCM. Decryption key is embedded in event QR codes.</span>
            </label>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isCreateModalOpen = false)}>Cancel</button
            >
            <button type="submit" class="btn-primary" disabled={isSubmitting || events.length >= 10}>
              {isSubmitting ? "Creating..." : events.length >= 10 ? "Limit Reached (10/10)" : "Create Event Space"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- HOST PROFILE & SECURITY MODAL -->
  {#if isProfileModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isProfileModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isProfileModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>👤 Host Profile & Security Settings</h3>
          <button class="close-btn" onclick={() => (isProfileModalOpen = false)}
            >&times;</button
          >
        </div>

        {#if profileErrorMsg}
          <div class="alert alert-error" style="margin-bottom: 1rem;">
            {profileErrorMsg}
          </div>
        {/if}

        {#if profileSuccessMsg}
          <div class="alert alert-success" style="margin-bottom: 1rem; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #10b981; padding: 0.75rem 1rem; border-radius: var(--radius-md, 8px);">
            {profileSuccessMsg}
          </div>
        {/if}

        <form onsubmit={handleUpdateProfile} class="form-stack">
          <div>
            <label class="form-label" for="editHostName"
              >Host Name / Role</label
            >
            <input
              id="editHostName"
              type="text"
              class="input-field"
              placeholder="e.g. Pastor John / Media Team"
              bind:value={editHostName}
              required
            />
            <span class="helper-text"
              >This name is shown across host controls and management headers.</span
            >
          </div>

          <div style="border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 0.5rem;">
            <h4 style="font-size: 0.9375rem; margin-bottom: 0.5rem; font-weight: 600;">Change Admin PIN (Optional)</h4>
            <div>
              <label class="form-label" for="currentPin"
                >Current Admin PIN</label
              >
              <input
                id="currentPin"
                type="password"
                class="input-field"
                placeholder="Enter current PIN"
                maxlength="8"
                bind:value={currentPinInput}
              />
              <span class="helper-text"
                >Required only if you are setting a new PIN.</span
              >
            </div>

            <div style="margin-top: 0.75rem;">
              <label class="form-label" for="newPin">New Admin PIN (4+ digits)</label>
              <input
                id="newPin"
                type="password"
                class="input-field"
                placeholder="Leave blank to keep current PIN"
                maxlength="8"
                bind:value={newPinInput}
              />
            </div>

            <div style="margin-top: 0.75rem;">
              <label class="form-label" for="confirmNewPin">Confirm New Admin PIN</label>
              <input
                id="confirmNewPin"
                type="password"
                class="input-field"
                placeholder="Re-enter new PIN"
                maxlength="8"
                bind:value={confirmNewPinInput}
              />
            </div>
          </div>

          <div style="margin-top: 1rem; padding: 0.75rem 1rem; border-radius: var(--radius-sm, 8px); background: rgba(255, 94, 91, 0.08); border: 1px solid rgba(255, 94, 91, 0.25); display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.15rem;">☕</span>
              <div style="font-size: 0.8125rem; color: var(--color-text-secondary);">
                Loving LuminaFeed? Support development on Ko-fi!
              </div>
            </div>
            <a
              href="https://ko-fi.com/deidi0"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-secondary btn-sm"
              style="color: #ff5e5b; border-color: rgba(255, 94, 91, 0.4); text-decoration: none; font-weight: 600; font-size: 0.75rem; padding: 0.3rem 0.65rem;"
            >
              Support on Ko-fi ↗
            </a>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (isProfileModalOpen = false)}>Cancel</button
            >
            <button type="submit" class="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- 24-HOUR EPHEMERAL RETENTION INFO MODAL -->
  {#if isTtlInfoModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isTtlInfoModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isTtlInfoModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" onclick={(e) => e.stopPropagation()} style="max-width: 520px;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.5rem;">⏳</span>
            <h3 style="margin: 0;">24-Hour Ephemeral Lifecycle</h3>
          </div>
          <button class="close-btn" onclick={() => (isTtlInfoModalOpen = false)}>&times;</button>
        </div>

        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; line-height: 1.55; font-size: 0.925rem;">
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-md, 10px); padding: 1rem; display: flex; align-items: flex-start; gap: 0.75rem;">
            <span style="font-size: 1.35rem; line-height: 1;">🛡️</span>
            <div>
              <strong style="color: #f59e0b; display: block; margin-bottom: 0.25rem;">
                Privacy-First & Lean Cloud Storage
              </strong>
              <span>
                To ensure attendee privacy and maintain lean cloud infrastructure, host accounts and all associated event spaces, attendee uploads, and storage folders in Supabase are retained for <strong>24 hours</strong> from creation.
              </span>
            </div>
          </div>

          <div>
            <h4 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--color-text);">What happens after 24 hours?</h4>
            <ul style="margin: 0; padding-left: 1.25rem; color: var(--color-text-secondary, #94a3b8); display: flex; flex-direction: column; gap: 0.35rem;">
              <li>The host account and all owned event spaces are removed from Supabase Database.</li>
              <li>All uploaded original photos and micro-thumbnails are permanently purged from Supabase Cloud Storage.</li>
              <li>No orphaned storage assets or personal records remain in the cloud.</li>
            </ul>
          </div>

          <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-md, 10px); padding: 0.9rem 1rem;">
            <strong style="color: #3b82f6; display: block; margin-bottom: 0.25rem;">💡 Safeguarding Your Memories</strong>
            <span style="color: var(--color-text-secondary, #94a3b8); font-size: 0.85rem;">
              Before the 24 hours expire, organizers can use <strong>1-Click Backup to Google Drive</strong> or click <strong>Export Archive (.ZIP)</strong> in any event detail view to download all full-resolution photos and metadata.
            </span>
          </div>

          <div class="modal-footer" style="margin-top: 0.5rem; padding: 0; display: flex; justify-content: flex-end;">
            <button
              class="btn-primary"
              style="width: auto; min-width: 120px;"
              onclick={() => (isTtlInfoModalOpen = false)}
            >
              Understood
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- QR CODE MODAL & PROJECTION MODE -->
  {#if isQrModalOpen && selectedEvent}
    <div
      class="modal-backdrop {isProjectionMode ? 'projection-backdrop' : ''}"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isQrModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isQrModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="modal-card {isProjectionMode ? 'projection-card' : 'qr-card'}"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <div>
            {#if selectedEvent.logo}
              <div style="margin-bottom: 0.75rem;">
                <img
                  src={selectedEvent.logo}
                  alt="Event logo"
                  style="max-height: 60px; max-width: 160px; object-fit: contain;"
                />
              </div>
            {/if}
            <h3 style="font-size: {isProjectionMode ? '2rem' : '1.25rem'};">
              {selectedEvent.name}
            </h3>
            {#if selectedEvent.tagline}
              <p class="text-secondary">{selectedEvent.tagline}</p>
            {/if}
          </div>
          <button class="close-btn" onclick={() => (isQrModalOpen = false)}
            >&times;</button
          >
        </div>

        <div class="qr-content-wrapper">
          {#if qrData}
            <div
              class="qr-image-container {isProjectionMode
                ? 'projection-qr'
                : ''}"
            >
              <img
                src={qrData.qr_data_url}
                alt="Event QR Code"
                class="qr-img"
              />
            </div>

            <div class="qr-info-block">
              <p class="qr-instruction">
                📱 <strong>Scan with any phone camera to share photos</strong>
              </p>
              
              <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
                <p class="qr-url-badge" style="margin: 0; word-break: break-all;">{qrData.join_url}</p>
                <button
                  class="btn-secondary btn-sm"
                  onclick={() => copyEventJoinUrl(qrData.join_url)}
                  title="Copy Event Join Link"
                  style="padding: 0.35rem 0.75rem;"
                >
                  📋 Copy Link
                </button>
              </div>

              {#if isLocalEnvironment}
                <div
                  style="margin-top: 1rem; padding: 0.75rem 1rem; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-md); text-align: left; font-size: 0.85rem;"
                >
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                      <span style="font-size: 1.1rem;">📡</span>
                      <span>
                        Host Network IP: <strong>{detectedHostIp || "Resolving..."}</strong>
                      </span>
                    </div>

                    <button
                      class="btn-secondary btn-sm"
                      disabled={isDetectingIp}
                      onclick={() => refreshHostIp(true)}
                      title="Auto-detect current computer LAN IP"
                      style="padding: 0.25rem 0.6rem; font-size: 0.75rem;"
                    >
                      🔄 {isDetectingIp ? "Detecting..." : "Refresh IP"}
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            {#if !isProjectionMode}
              <div class="qr-modal-footer">
                <a
                  href={qrData.qr_data_url}
                  download="luminafeed-qr-{selectedEvent?.slug || 'code'}.png"
                  class="btn-secondary qr-btn"
                >
                  <span>💾</span> Download PNG
                </a>
                <button
                  class="btn-secondary qr-btn"
                  onclick={handleDownloadSign}
                >
                  <span>🖨️</span> Print Table Card
                </button>
                <button
                  class="btn-primary qr-btn qr-btn-primary"
                  onclick={() => (isProjectionMode = true)}
                >
                  <span>📺</span> Full-Screen TV Mode
                </button>
              </div>
            {/if}
          {:else}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Generating QR Code...</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- SUPABASE CLOUD STORAGE SETTINGS MODAL -->
  {#if isStorageModalOpen}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (isStorageModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") isStorageModalOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-card" style="max-width: 620px;" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.5rem;">⚡</span>
            <div>
              <h3 style="margin: 0;">Supabase Cloud Backend</h3>
              <span class="text-secondary" style="font-size: 0.8125rem;">Storage Bucket, Direct CDN & Database Configuration</span>
            </div>
          </div>
          <button class="close-btn" onclick={() => (isStorageModalOpen = false)}>&times;</button>
        </div>

        <div class="form-stack">
          <!-- Setup Mode Tabs -->
          <div style="display: flex; gap: 0.5rem; background: var(--color-surface); padding: 0.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <button
              type="button"
              class="btn-secondary"
              style="flex: 1; padding: 0.5rem; font-size: 0.8125rem; font-weight: {storageSetupTab === 'default' ? '700' : '400'}; background: {storageSetupTab === 'default' ? 'var(--color-primary)' : 'transparent'}; color: {storageSetupTab === 'default' ? 'white' : 'var(--color-text)'}; border: none;"
              onclick={() => { storageSetupTab = 'default'; storageTestResult = null; }}
            >
              ☁️ Managed Cloud (Default)
            </button>
            <button
              type="button"
              class="btn-secondary"
              style="flex: 1; padding: 0.5rem; font-size: 0.8125rem; font-weight: {storageSetupTab === 'custom' ? '700' : '400'}; background: {storageSetupTab === 'custom' ? 'var(--color-primary)' : 'transparent'}; color: {storageSetupTab === 'custom' ? 'white' : 'var(--color-text)'}; border: none;"
              onclick={() => { storageSetupTab = 'custom'; storageTestResult = null; }}
            >
              🛠️ Use My Own Setup (BYOK)
            </button>
          </div>

          <!-- TAB 1: DEFAULT MANAGED CLOUD -->
          {#if storageSetupTab === 'default'}
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                <span style="font-size: 1.75rem;">🚀</span>
                <div>
                  <strong style="font-size: 0.9375rem;">Pre-Configured Managed Supabase Cloud</strong>
                  <p class="text-secondary" style="margin: 0.25rem 0 0 0; font-size: 0.8125rem; line-height: 1.4;">
                    Zero setup required. Photo uploads, moderation queues, and real-time feeds are served through the pre-configured LuminaFeed cloud backend.
                  </p>
                </div>
              </div>

              <!-- Masked Configuration Details -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.875rem; margin-top: 0.75rem; font-size: 0.8125rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
                  <span class="text-secondary">Project URL:</span>
                  <span style="font-family: monospace; color: var(--color-text);">https://••••••••••••••••••••.supabase.co</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
                  <span class="text-secondary">Public Anon Key:</span>
                  <span style="font-family: monospace; color: var(--color-text);">••••••••••••••••••••••••••••••••</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
                  <span class="text-secondary">Storage Bucket:</span>
                  <span style="font-family: monospace; color: var(--color-text);">luminafeed-photos</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span class="text-secondary">Lifecycle Retention:</span>
                  <span style="color: #10b981; font-weight: 500;">24h Ephemeral Auto-Purge Active</span>
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.875rem; font-size: 0.775rem; color: #10b981;">
                <span>🔒</span>
                <span>Default credentials remain securely masked and protected.</span>
              </div>
            </div>

            {#if currentBaaSConfig.isCustom}
              <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: var(--radius-md); padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                  <strong style="font-size: 0.875rem; color: #818cf8;">Custom Setup Currently Active</strong>
                  <p class="text-secondary" style="margin: 0.25rem 0 0 0; font-size: 0.8rem;">
                    You are currently using custom Supabase credentials. Click below to return to the default cloud backend.
                  </p>
                </div>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  style="border-color: #818cf8; color: #818cf8; font-weight: 600;"
                  onclick={handleResetToDefaultStorage}
                >
                  🛡️ Use Default Setup (Fail-Safe)
                </button>
              </div>
            {/if}

          <!-- TAB 2: CUSTOM SETUP (BYOK) -->
          {:else}
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                <span style="font-size: 1.75rem;">🛠️</span>
                <div>
                  <strong style="font-size: 0.9375rem;">Bring Your Own Supabase Backend</strong>
                  <p class="text-secondary" style="margin: 0.25rem 0 0 0; font-size: 0.8125rem; line-height: 1.4;">
                    Connect your own Supabase project for complete data ownership, unlimited storage quotas, and private PostgreSQL instances.
                  </p>
                </div>
              </div>

              <!-- Input Form -->
              <div class="form-stack" style="gap: 0.875rem;">
                <div>
                  <label for="custom-supabase-url" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem;">
                    Supabase Project URL <span style="color: #ef4444;">*</span>
                  </label>
                  <input
                    id="custom-supabase-url"
                    type="url"
                    class="form-control"
                    placeholder="https://your-project-id.supabase.co"
                    bind:value={customSupabaseUrl}
                    style="width: 100%; font-family: monospace; font-size: 0.8125rem;"
                  />
                </div>

                <div>
                  <label for="custom-supabase-anon-key" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem;">
                    Supabase Public Anon Key <span style="color: #ef4444;">*</span>
                  </label>
                  <input
                    id="custom-supabase-anon-key"
                    type="password"
                    class="form-control"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    bind:value={customSupabaseAnonKey}
                    style="width: 100%; font-family: monospace; font-size: 0.8125rem;"
                  />
                </div>

                <div>
                  <label for="custom-supabase-bucket" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem;">
                    Storage Bucket Name
                  </label>
                  <input
                    id="custom-supabase-bucket"
                    type="text"
                    class="form-control"
                    placeholder="luminafeed-photos"
                    bind:value={customSupabaseBucket}
                    style="width: 100%; font-family: monospace; font-size: 0.8125rem;"
                  />
                </div>
              </div>

              <!-- 1-Click SQL Setup Script Helper -->
              <div style="margin-top: 1rem; padding: 0.875rem; background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: var(--radius-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                  <div>
                    <strong style="font-size: 0.8125rem;">📋 Initializing a fresh Supabase project?</strong>
                    <p class="text-secondary" style="margin: 0.15rem 0 0 0; font-size: 0.775rem;">
                      Copy our 1-click SQL script to create tables (`hosts`, `events`, `guests`, `photos`) and storage policies.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    onclick={handleCopySQLScript}
                    style="font-size: 0.75rem;"
                  >
                    {sqlCopied ? "✅ Copied SQL!" : "📋 Copy 1-Click SQL"}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          {#if storageTestResult}
            <div class={storageTestResult.success ? "alert-success" : "alert-error"} style="margin-top: 0.5rem; font-size: 0.875rem;">
              {storageTestResult.message}
            </div>
          {/if}

          <!-- Modal Action Footer -->
          <div class="modal-footer" style="margin-top: 1rem; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button
                type="button"
                class="btn-secondary"
                disabled={isTestingStorage}
                onclick={handleTestStorageConnection}
              >
                {isTestingStorage ? "Testing..." : "🧪 Test Connection"}
              </button>

              {#if storageSetupTab === 'custom' || currentBaaSConfig.isCustom}
                <button
                  type="button"
                  class="btn-secondary"
                  onclick={handleResetToDefaultStorage}
                  title="Reset to default managed Supabase configuration"
                  style="border-color: rgba(239, 68, 68, 0.4); color: #ef4444;"
                >
                  🛡️ Use Default Setup (Fail-Safe)
                </button>
              {/if}
            </div>

            <div style="display: flex; gap: 0.5rem;">
              {#if storageSetupTab === 'custom'}
                <button
                  type="button"
                  class="btn-primary"
                  disabled={isSavingCustomStorage}
                  onclick={handleSaveCustomStorage}
                >
                  {isSavingCustomStorage ? "Saving..." : "💾 Save & Connect Setup"}
                </button>
              {/if}
              <button
                type="button"
                class={storageSetupTab === 'custom' ? "btn-secondary" : "btn-primary"}
                onclick={() => (isStorageModalOpen = false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- SUPER ADMIN GLOBAL EVENT PHOTO INSPECTOR MODAL -->
  {#if inspectedGlobalEvent}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={() => (inspectedGlobalEvent = null)}
      onkeydown={(e) => {
        if (e.key === "Escape") inspectedGlobalEvent = null;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="modal-card"
        style="max-width: 840px; max-height: 85vh; overflow-y: auto;"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <div>
            <h3 style="margin: 0;">Cloud Gallery: {inspectedGlobalEvent.name}</h3>
            <span class="text-secondary" style="font-size: 0.8125rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem;">
              <span>Slug: <code>{inspectedGlobalEvent.slug}</code> • {inspectedPhotos.length} photos in Supabase Storage</span>
              {#if inspectedGlobalEvent.is_encrypted}
                <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">
                  🔒 E2EE Active
                </span>
                {#if inspectedKeyStatus === "escrow"}
                  <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">
                    ✓ Option B Escrow Unwrapped
                  </span>
                {:else if inspectedKeyStatus === "manual"}
                  <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">
                    ✓ Decrypted with Key
                  </span>
                {/if}
              {/if}
            </span>
          </div>
          <button class="close-btn" onclick={() => (inspectedGlobalEvent = null)}>&times;</button>
        </div>

        {#if isLoadingInspectedPhotos}
          <div class="loading-state" style="padding: 2rem; text-align: center;">
            <div class="spinner"></div>
            <p style="margin-top: 0.5rem;">Loading cloud photos...</p>
          </div>
        {:else if inspectedPhotos.length === 0}
          <div style="padding: 2rem; text-align: center; color: var(--color-text-secondary);">
            No photos found in Supabase Storage for this event yet.
          </div>
        {:else}
          {#if inspectedGlobalEvent.is_encrypted && !inspectedEventKey}
            <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-top: 1rem; font-size: 0.875rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <strong>🔒 Event Photos are Encrypted</strong>
                  <p style="margin: 0.25rem 0 0; color: var(--color-text-secondary); font-size: 0.8125rem;">
                    Admin escrow unwrapping was not available. Enter the 32-character event key to inspect images.
                  </p>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <input
                    type="text"
                    placeholder="Enter 32-char hex key..."
                    bind:value={manualKeyInput}
                    style="padding: 0.375rem 0.625rem; font-size: 0.8125rem; font-family: monospace; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text);"
                  />
                  <button class="btn-secondary" style="font-size: 0.8125rem; padding: 0.375rem 0.75rem;" onclick={applyManualKeyToInspect}>
                    Decrypt
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.75rem; margin-top: 1rem;">
            {#each inspectedPhotos as p}
              <a
                href={p.decrypted_orig_url || p.original_url || p.storage_orig_url}
                target="_blank"
                rel="noopener noreferrer"
                style="display: block; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--color-border); position: relative; aspect-ratio: 1; background: var(--color-surface);"
              >
                <img
                  src={p.decrypted_thumb_url || p.thumb_url || p.storage_thumb_url || p.original_url}
                  alt={p.filename}
                  style="width: 100%; height: 100%; object-fit: cover;"
                  loading="lazy"
                />
                {#if p.is_encrypted && !p.decrypted_thumb_url}
                  <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); color: #fff; font-size: 0.75rem; text-align: center; padding: 0.5rem;">
                    <span style="font-size: 1.25rem;">🔒</span>
                    <span>Encrypted</span>
                  </div>
                {/if}
              </a>
            {/each}
          </div>
        {/if}

        <div class="modal-footer" style="margin-top: 1.5rem; justify-content: flex-end;">
          <button class="btn-secondary" onclick={() => (inspectedGlobalEvent = null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- GLOBAL FLOATING SOCIAL REACTIONS OVERLAY -->
  {#if !isSlideshowRoute && floatingReactions.length > 0}
    <div class="floating-reactions-layer" aria-hidden="true">
      {#each floatingReactions as r (r.id)}
        <div
          class="floating-reaction-item"
          style="left: {r.leftPercent}%;"
        >
          <span class="floating-emoji">{r.emoji}</span>
          {#if r.senderName}
            <span class="floating-sender">{r.senderName}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .app-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .slideshow-mode-container {
    background: #000;
    overflow: hidden;
  }

  .app-header {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    padding: 0.875rem 1.5rem;
    position: sticky;
    top: 0;
    z-index: 10;
    overflow: hidden;
  }

  .header-inner {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    min-width: 0;
    flex-shrink: 1;
  }

  .text-left {
    min-width: 0;
    overflow: hidden;
  }

  .logo-icon {
    background: var(--color-primary-light);
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
  }

  .brand-svg {
    width: 26px;
    height: 26px;
    color: var(--color-primary);
    display: block;
  }

  .brand-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-primary);
    line-height: 1.1;
  }

  .brand-subtitle {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .install-pwa-btn {
    background: #10b981;
    color: white;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    animation: pulseGlow 2.5s infinite;
  }

  @keyframes pulseGlow {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
    }
  }

  .offline-status-pill {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-danger);
    background: var(--color-danger-bg);
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-danger);
  }

  .drive-connected-pill {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-success);
    background: var(--color-success-bg);
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-pill);
  }

  .host-badge {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    background: var(--color-surface);
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
  }

  .guest-pill {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary-dark);
    background: var(--color-primary-light);
    padding: 0.375rem 0.875rem;
    border-radius: var(--radius-pill);
  }

  .main-content {
    flex: 1;
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .slideshow-main {
    max-width: 100vw;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  .slideshow-stage {
    position: relative;
    width: 100vw;
    height: 100vh;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .slide-item-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .slide-backdrop-blur {
    position: absolute;
    inset: -30px;
    background-size: cover;
    background-position: center;
    filter: blur(50px) brightness(0.35) saturate(1.4);
    transform: scale(1.15);
    pointer-events: none;
    z-index: 1;
  }

  .slide-img {
    position: relative;
    z-index: 2;
    max-width: 100vw;
    max-height: 100vh;
    width: 100%;
    height: 100%;
    object-fit: contain;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.75);
  }

  /* Transition Animations */
  .transition-fade {
    animation: fadeIn 0.9s ease-in-out;
  }

  .transition-slide {
    animation: slideIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .transition-zoom {
    animation: kenBurns 7s ease-out forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes kenBurns {
    0% {
      transform: scale(1);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      transform: scale(1.08);
      opacity: 1;
    }
  }

  .slideshow-info-banner {
    position: absolute;
    bottom: 2.5rem;
    left: 2.5rem;
    max-width: min(650px, calc(100vw - 220px));
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 0.85rem 1.35rem;
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 10;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    animation: fadeIn 0.5s ease-out;
  }

  .slideshow-caption {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f8fafc;
    line-height: 1.4;
    word-break: break-word;
  }

  .slideshow-author {
    font-size: 0.9375rem;
    color: #cbd5e1;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .slideshow-author strong {
    color: #38bdf8;
  }

  .slideshow-author-badge {
    position: absolute;
    bottom: 2rem;
    left: 2rem;
    background: rgba(0, 0, 0, 0.65);
    color: white;
    backdrop-filter: blur(8px);
    padding: 0.625rem 1.25rem;
    border-radius: var(--radius-pill);
    font-size: 1.125rem;
    z-index: 10;
    pointer-events: none;
  }

  .slideshow-qr-pip {
    position: absolute;
    bottom: 2.5rem;
    right: 2.5rem;
    background: rgba(255, 255, 255, 0.95);
    padding: 0.85rem;
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    text-align: center;
    z-index: 10;
    pointer-events: none;
    animation: fadeIn 0.5s ease-out;
  }

  .pip-qr-img {
    width: 140px;
    height: 140px;
    display: block;
    border-radius: var(--radius-sm);
  }

  .pip-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 700;
    color: #0f172a;
    margin-top: 0.45rem;
    letter-spacing: 0.02em;
  }

  .slideshow-counter-pill {
    position: absolute;
    top: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #cbd5e1;
    font-size: 0.875rem;
    font-weight: 700;
    padding: 0.4rem 1rem;
    border-radius: 9999px;
    z-index: 15;
    pointer-events: none;
    user-select: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .slideshow-controls-overlay {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    display: flex;
    gap: 0.75rem;
    opacity: 0;
    transition: opacity 0.25s ease;
    z-index: 20;
  }

  .slideshow-stage:hover .slideshow-controls-overlay {
    opacity: 1;
  }

  .slide-ctrl-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(15, 23, 42, 0.75);
    color: white;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  }

  .slide-ctrl-btn:hover {
    background: rgba(37, 99, 235, 0.95);
    transform: scale(1.05);
  }

  .slideshow-cloud-pill {
    position: absolute;
    top: 1.5rem;
    left: 1.5rem;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #94a3b8;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 15;
    pointer-events: none;
    user-select: none;
  }

  .slideshow-cloud-pill .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
    transition: background-color 0.3s ease;
  }

  .slideshow-cloud-pill .pulse-dot.syncing {
    background: #38bdf8;
    box-shadow: 0 0 10px #38bdf8;
    animation: pulse 1s infinite;
  }

  /* Floating Social Reactions Layer */
  .floating-reactions-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 999;
    overflow: hidden;
  }

  .slideshow-reactions-layer {
    position: absolute;
    z-index: 30;
  }

  .floating-reaction-item {
    position: absolute;
    bottom: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    animation: floatUpReaction 2.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }

  .floating-emoji {
    font-size: clamp(2.5rem, 5vw, 4rem);
    filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.45));
    animation: wobbleEmoji 2.8s ease-in-out infinite alternate;
  }

  .floating-sender {
    font-size: 0.8125rem;
    font-weight: 700;
    color: #ffffff;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(6px);
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
  }

  @keyframes floatUpReaction {
    0% {
      opacity: 0;
      transform: translateY(20px) scale(0.6);
    }
    15% {
      opacity: 1;
      transform: translateY(-40px) scale(1.15);
    }
    30% {
      transform: translateY(-120px) scale(1);
    }
    70% {
      opacity: 0.95;
      transform: translateY(-380px) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-600px) scale(0.9);
    }
  }

  @keyframes wobbleEmoji {
    0% { transform: rotate(-8deg); }
    100% { transform: rotate(8deg); }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .slideshow-empty {
    text-align: center;
    color: white;
    max-width: 500px;
    padding: 2rem;
  }

  .slideshow-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .slideshow-svg {
    width: 80px;
    height: 80px;
    color: #60a5fa;
    display: block;
  }

  .slideshow-tagline {
    color: #9ca3af;
    font-size: 1.25rem;
    margin-top: 0.5rem;
  }

  .slideshow-waiting {
    color: #60a5fa;
    margin-top: 1.5rem;
    font-size: 1.125rem;
  }

  .slideshow-empty-qr {
    margin-top: 2rem;
    background: white;
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    display: inline-block;
    color: #111827;
  }

  .empty-qr-img {
    width: 180px;
    height: 180px;
    display: block;
    margin: 0 auto 0.75rem auto;
  }

  .alert-success {
    background: var(--color-success-bg);
    color: var(--color-success);
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .alert-archived-banner {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
    padding: 0.875rem 1.25rem;
    border-radius: var(--radius-md);
    font-size: 0.9375rem;
    margin-bottom: 1rem;
    text-align: left;
  }

  .auth-card {
    max-width: 440px;
    margin: 4rem auto;
    padding: 2.5rem;
    text-align: center;
  }

  .guest-join-card {
    margin: 2rem auto;
    box-shadow: var(--shadow-lg);
  }

  .event-badge-top {
    display: inline-block;
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-pill);
    margin-bottom: 0.75rem;
  }

  .event-hero-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--color-text);
    line-height: 1.2;
  }

  .event-hero-tagline {
    font-size: 1rem;
    color: var(--color-text-secondary);
    margin-top: 0.375rem;
  }

  .event-hero-date {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-primary);
    margin-top: 0.5rem;
  }

  .join-divider {
    height: 1px;
    background: var(--color-border);
    margin: 1.5rem 0;
  }

  .guest-join-footer {
    margin-top: 1.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .btn-lg {
    padding: 0.875rem 1.5rem;
    font-size: 1.0625rem;
    width: 100%;
  }

  .guest-space-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .event-banner-card {
    padding: 1.75rem;
  }

  .event-banner-flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 1.25rem;
  }

  .quota-badge {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0.75rem 1.25rem;
    border-radius: var(--radius-md);
    text-align: center;
  }

  .quota-count {
    display: block;
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--color-primary);
  }

  .quota-label {
    font-size: 0.6875rem;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .guest-action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1.25rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .action-buttons-group {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .quota-helper {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .auto-approve-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.875rem;
    border-radius: var(--radius-pill);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .auto-approve-toggle-btn.mode-auto {
    background: var(--color-success-bg);
    color: var(--color-success);
    border-color: rgba(16, 185, 129, 0.4);
  }

  .auto-approve-toggle-btn.mode-auto:hover {
    background: var(--color-success-bg);
    border-color: var(--color-success);
  }

  .auto-approve-toggle-btn.mode-manual {
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .auto-approve-toggle-btn.mode-manual:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-text-secondary);
  }

  .batch-upload-banner {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.875rem 1.125rem;
    margin-top: 0.75rem;
    animation: fadeIn 0.2s ease-out;
  }

  .batch-upload-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .batch-upload-title {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    color: #166534;
    font-size: 0.9375rem;
    font-weight: 700;
  }

  .batch-upload-percent {
    font-size: 0.8125rem;
    font-weight: 800;
    color: #15803d;
    background: #dcfce7;
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-pill);
    border: 1px solid #bbf7d0;
  }

  .batch-progress-track {
    width: 100%;
    height: 8px;
    background: #dcfce7;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 0.4rem;
  }

  .batch-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #16a34a);
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .batch-upload-status {
    font-size: 0.8125rem;
    color: #166534;
    margin: 0;
    font-weight: 500;
  }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-primary);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .uploads-section {
    padding: 1.5rem;
  }

  .section-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .uploads-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.875rem;
  }

  .upload-item-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0;
  }

  .upload-thumb-click {
    width: 100%;
    height: 100%;
    padding: 0;
    cursor: pointer;
    background: transparent;
  }

  .upload-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .upload-badge-overlay {
    position: absolute;
    bottom: 6px;
    left: 6px;
  }

  .delete-photo-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    line-height: 1;
    transition: background 0.15s ease;
  }

  .delete-photo-btn:hover {
    background: var(--color-danger);
  }

  .status-pill {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.6875rem;
    font-weight: 700;
    backdrop-filter: blur(4px);
  }

  .pill-pending {
    background: rgba(254, 240, 138, 0.9);
    color: #854d0e;
  }

  .pill-approved {
    background: rgba(209, 250, 229, 0.9);
    color: #065f46;
  }

  .pill-rejected {
    background: rgba(254, 226, 226, 0.9);
    color: #991b1b;
  }

  .gallery-section {
    padding: 1.75rem;
  }

  .gallery-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .gallery-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .selection-toolbar {
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
    padding: 0.75rem 1.25rem;
    border-radius: var(--radius-md);
    margin-bottom: 1.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .live-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
  }

  .gallery-item-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .gallery-item-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .selected-card {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  .select-checkbox-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
  }

  .select-checkbox-overlay input {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .gallery-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gallery-info-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.5rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .gallery-author {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-dot-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-success);
    background: var(--color-success-bg);
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-pill);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--color-success);
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.8);
    }
  }

  .empty-gallery {
    text-align: center;
    padding: 3.5rem 1.5rem;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border);
  }

  .auth-icon {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }

  .form-stack {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
    text-align: left;
  }

  .form-label {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.375rem;
    color: var(--color-text);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  .checkbox-row input {
    margin-top: 0.25rem;
  }

  .helper-text {
    display: block;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .alert-error {
    background: var(--color-danger-bg);
    color: var(--color-danger);
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .dashboard-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .drive-banner-card {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
    border: 1px solid var(--color-border);
    padding: 1.25rem 1.5rem;
  }

  .drive-banner-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .drive-logo {
    font-size: 2rem;
  }

  .events-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.25rem;
  }

  .text-left {
    text-align: left;
  }

  .event-card {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 100%;
  }

  .event-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
  }

  .event-status {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    margin-bottom: 0.5rem;
  }

  .status-active {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .status-archived {
    background: var(--color-surface-hover);
    color: var(--color-text-secondary);
  }

  .event-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .event-tagline {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin-top: 0.25rem;
  }

  .event-date {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    font-weight: 500;
    white-space: nowrap;
  }

  .event-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    padding: 0.75rem;
    margin: 1.25rem 0;
    text-align: center;
    width: 100%;
  }

  .stat-value {
    display: block;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .stat-label {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    font-weight: 600;
  }

  .event-card-actions {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    border-top: 1px solid var(--color-border);
    padding-top: 0.875rem;
    width: 100%;
    box-sizing: border-box;
  }

  .event-card-actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .event-card-actions-row button {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    text-align: center;
    justify-content: center;
  }

  .event-card-manage-btn {
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .detail-header-card {
    padding: 2rem;
  }

  .detail-header-flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  .detail-actions-box {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.875rem;
    box-sizing: border-box;
    margin-top: 0.25rem;
  }

  .detail-actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .detail-actions-row button,
  .detail-actions-row a {
    white-space: nowrap;
    text-align: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .host-tabs-bar {
    display: flex;
    gap: 0.25rem;
    margin-top: 1.5rem;
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .host-tabs-bar::-webkit-scrollbar {
    display: none;
  }

  .host-tab-btn {
    padding: 0.75rem 1rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    border-bottom: 2px solid transparent;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    transition: all 0.15s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .host-tab-btn.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }

  .tab-badge {
    background: var(--color-primary);
    color: white;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-pill);
  }

  .moderation-panel {
    margin-top: 1.5rem;
    padding: 1.75rem;
  }

  .panel-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .bulk-actions {
    display: flex;
    gap: 0.75rem;
  }

  .moderation-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1.25rem;
  }

  .mod-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .mod-thumb-btn {
    width: 100%;
    aspect-ratio: 4/3;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: #000;
  }

  .mod-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.15s ease;
  }

  .mod-thumb-btn:hover .mod-thumb {
    transform: scale(1.03);
  }

  .mod-body {
    padding: 0.875rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex: 1;
  }

  .mod-author-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .mod-btn-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .mod-btn {
    padding: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: var(--radius-sm);
    text-align: center;
  }

  .btn-approve {
    background: var(--color-success);
    color: white;
  }

  .btn-approve:hover {
    background: #059669;
  }

  .btn-reject {
    background: var(--color-surface);
    color: var(--color-danger);
    border: 1px solid var(--color-danger);
  }

  .btn-reject:hover {
    background: var(--color-danger-bg);
  }

  /* Analytics Dashboard Styles */
  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.75rem;
  }

  .analytics-stat-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.25rem;
    text-align: center;
  }

  .analytics-num {
    display: block;
    font-size: 2rem;
    font-weight: 800;
    color: var(--color-text);
  }

  .analytics-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-top: 0.25rem;
  }

  .analytics-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .analytics-sub-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.25rem;
  }

  .contributors-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .contributor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
  }

  .contributor-rank {
    font-weight: 700;
    color: var(--color-primary);
    width: 24px;
  }

  .contributor-name {
    flex: 1;
    font-weight: 600;
    color: var(--color-text);
  }

  .contributor-count {
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .timeline-bars-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .timeline-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8125rem;
  }

  .timeline-hour {
    width: 48px;
    font-family: monospace;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .timeline-bar-wrapper {
    flex: 1;
    background: var(--color-surface-hover);
    height: 12px;
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .timeline-bar-fill {
    background: var(--color-primary);
    height: 100%;
    border-radius: var(--radius-pill);
  }

  .timeline-count {
    font-weight: 700;
    width: 28px;
    text-align: right;
  }

  /* Drive Sync Tab Styles */
  .drive-sync-panel-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .drive-sync-stat-card {
    padding: 1.5rem;
  }

  .drive-sync-info-card {
    padding: 1.5rem;
    background: var(--color-surface);
  }

  .drive-features-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .projection-backdrop {
    background: rgba(17, 24, 39, 0.95);
  }

  .modal-card {
    background: var(--color-surface);
    width: 100%;
    max-width: 540px;
    border-radius: var(--radius-lg);
    padding: 2rem;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--color-border);
    box-sizing: border-box;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    overflow-x: hidden;
  }

  .qr-card {
    max-width: 560px;
    width: 100%;
    text-align: center;
    box-sizing: border-box;
  }

  .projection-card {
    max-width: 680px;
    padding: 3rem;
    text-align: center;
    background: var(--color-surface);
    border-radius: 24px;
    border: 1px solid var(--color-border);
  }

  .lightbox-card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    max-width: 720px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--color-border);
  }

  .lightbox-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .lightbox-img-wrapper {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    border-radius: var(--radius-md);
  }

  .lightbox-img {
    max-width: 100%;
    max-height: 65vh;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .lightbox-details {
    margin-top: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .lightbox-author {
    font-weight: 600;
    font-size: 1.1rem;
  }

  .lightbox-date {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .qr-content-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .qr-image-container {
    background: white;
    padding: 1rem;
    border-radius: var(--radius-lg);
    display: inline-block;
    box-shadow: var(--shadow-md);
    max-width: 100%;
    box-sizing: border-box;
  }

  .qr-img {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .projection-qr {
    padding: 2rem;
    transform: scale(1.1);
  }

  .qr-info-block {
    text-align: center;
    width: 100%;
    box-sizing: border-box;
  }

  .qr-instruction {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .qr-url-badge {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--color-primary);
    word-break: break-all;
    display: inline-block;
    max-width: 100%;
    box-sizing: border-box;
  }

  .net-toggle-group {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .net-btn {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .net-btn.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary-dark);
  }

  .qr-modal-footer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 1.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .qr-modal-footer .qr-btn,
  .qr-modal-footer button,
  .qr-modal-footer a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25;
    white-space: normal;
    word-break: normal;
    box-sizing: border-box;
    text-decoration: none;
    border-radius: var(--radius-md);
    width: 100%;
    min-height: 46px;
    overflow: hidden;
  }

  .qr-modal-footer .qr-btn-primary {
    grid-column: 1 / -1;
    font-size: 0.95rem;
    padding: 0.85rem 1.25rem;
    min-height: 48px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .close-btn {
    font-size: 1.5rem;
    color: var(--color-text-secondary);
    line-height: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.25rem;
    width: 100%;
    box-sizing: border-box;
  }

  .modal-footer button,
  .modal-footer .btn-primary,
  .modal-footer .btn-secondary {
    max-width: 100%;
    white-space: normal;
    word-break: break-word;
    text-align: center;
    line-height: 1.35;
    box-sizing: border-box;
  }

  .btn-sm {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
  }

  .loading-state {
    text-align: center;
    margin-top: 4rem;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem auto;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* ========================================== */
  /* ANALYTICS STYLES                           */
  /* ========================================== */
  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.25rem;
    margin-bottom: 2rem;
  }

  .analytics-stat-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.5rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .analytics-num {
    font-size: 2rem;
    font-weight: 800;
    line-height: 1.1;
    color: var(--color-text);
  }

  .analytics-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .analytics-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  .analytics-sub-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
  }

  .analytics-sub-card h4 {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--color-text);
  }

  .contributors-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .contributor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
  }

  .contributor-rank {
    font-weight: 700;
    color: var(--color-primary);
    width: 28px;
  }

  .contributor-name {
    font-weight: 600;
    flex: 1;
    margin: 0 0.5rem;
    color: var(--color-text);
  }

  .contributor-count {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .timeline-bars-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .timeline-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8125rem;
  }

  .timeline-hour {
    width: 70px;
    color: var(--color-text-secondary);
    font-weight: 500;
    text-align: right;
  }

  .timeline-bar-wrapper {
    flex: 1;
    background: var(--color-surface-hover);
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
  }

  .timeline-bar-fill {
    background: var(--color-primary);
    height: 100%;
    border-radius: 6px;
    transition: width 0.3s ease;
  }

  .timeline-count {
    width: 30px;
    font-weight: 600;
    color: var(--color-text);
  }

  /* ========================================== */
  /* RESPONSIVE MODAL & FOOTER STYLES           */
  /* ========================================== */
  @media (max-width: 640px) {
    .host-tab-btn {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      gap: 0.25rem;
    }

    .app-header {
      padding: 0.625rem 0.75rem;
    }

    .header-inner {
      gap: 0.375rem;
    }

    .brand {
      gap: 0.5rem;
    }

    .logo-icon {
      width: 34px;
      height: 34px;
    }

    .brand-svg {
      width: 20px;
      height: 20px;
    }

    .brand-title {
      font-size: 1rem;
    }

    .brand-subtitle {
      font-size: 0.6875rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }

    .header-actions {
      gap: 0.375rem;
    }

    .host-badge {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
    }

    .host-badge span:last-child {
      display: none;
    }

    .guest-pill {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
    }

    .header-back-btn {
      display: none;
    }

    .brand-title {
      display: none;
    }

    .brand-subtitle {
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .host-badge-name {
      max-width: 72px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      vertical-align: middle;
    }

    .host-badge-settings {
      display: none;
    }

    .modal-backdrop {
      padding: 0.75rem;
    }

    .modal-card {
      padding: 1.25rem 1rem;
      max-width: 100%;
      border-radius: var(--radius-md);
    }

    .modal-footer {
      flex-direction: column-reverse;
      align-items: stretch;
      gap: 0.5rem;
    }

    .modal-footer button,
    .modal-footer .btn-primary,
    .modal-footer .btn-secondary {
      width: 100%;
    }

    .qr-modal-footer {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.65rem;
      width: 100%;
    }

    .qr-modal-footer a,
    .qr-modal-footer button,
    .qr-modal-footer .qr-btn {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      white-space: normal;
      grid-column: 1 / -1;
    }

    .form-row {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .events-grid {
      grid-template-columns: 1fr;
    }

    .event-card-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      width: 100%;
    }

    .event-card-actions-row button {
      flex: 1 1 calc(50% - 0.4rem);
      min-width: 0;
      white-space: nowrap;
      padding: 0.45rem 0.5rem;
      font-size: 0.8rem;
    }

    .detail-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      width: 100%;
    }

    .detail-actions-row button,
    .detail-actions-row a {
      flex: 1 1 calc(50% - 0.4rem);
      min-width: 0;
      white-space: nowrap;
      padding: 0.45rem 0.6rem;
      font-size: 0.8rem;
    }

    .detail-header-flex {
      flex-direction: column;
    }

    .dashboard-toolbar {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
  }

  @media (max-width: 480px) {
    .host-tab-btn {
      padding: 0.5rem 0.625rem;
      font-size: 0.75rem;
    }

    .event-card-actions-row button,
    .detail-actions-row button,
    .detail-actions-row a {
      flex: 1 1 100%;
      width: 100%;
    }
  }
</style>
