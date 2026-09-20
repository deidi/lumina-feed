import exifr from 'exifr';
import { renderPresetFrameToCanvas } from './frame-studio.js';
import { computeSha256 } from './crypto.js';

/**
 * Compute SHA-256 hash from an ArrayBuffer, Uint8Array, or Blob
 * Works across both secure contexts (HTTPS/localhost) and insecure HTTP LAN contexts.
 */
export async function computePhotoHash(blobOrBuffer) {
  return computeSha256(blobOrBuffer);
}

/**
 * Helper to load an image element safely from a File, Blob, or URL string
 */
export async function loadImageElement(srcOrBlob) {
  const isUrl = typeof srcOrBlob === 'string';
  const url = isUrl ? srcOrBlob : URL.createObjectURL(srcOrBlob);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;

  try {
    if (typeof img.decode === 'function') {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(new Error(`Failed to load image: ${err?.message || 'unknown error'}`));
      });
    }
    return {
      img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => {
        if (!isUrl) URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    if (!isUrl) URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Draw an image filling the target rectangle with object-fit: cover (crop to fill)
 */
export function drawCoverImage(ctx, img, targetX, targetY, targetW, targetH) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const srcAspect = srcW / srcH;
  const targetAspect = targetW / targetH;

  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (srcAspect > targetAspect) {
    // Source is wider than target -> crop left and right
    sh = srcH;
    sw = srcH * targetAspect;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    // Source is taller than target -> crop top and bottom
    sw = srcW;
    sh = srcW / targetAspect;
    sx = 0;
    sy = (srcH - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, targetX, targetY, targetW, targetH);
}

/**
 * Helper to render an image source into a resized Blob via Canvas
 */
async function renderToBlob(canvasOrImg, targetWidth, targetHeight, quality = 0.88, mimeType = 'image/jpeg') {
  let canvas;
  if (canvasOrImg instanceof HTMLCanvasElement) {
    if (canvasOrImg.width === targetWidth && canvasOrImg.height === targetHeight) {
      canvas = canvasOrImg;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(targetWidth));
      canvas.height = Math.max(1, Math.round(targetHeight));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context not available');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvasOrImg, 0, 0, canvas.width, canvas.height);
    }
  } else {
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(targetWidth));
    canvas.height = Math.max(1, Math.round(targetHeight));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvasOrImg, 0, 0, canvas.width, canvas.height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0) resolve(blob);
      else reject(new Error('Failed to generate image blob'));
    }, mimeType, quality);
  });
}

/**
 * Render a photo with its frame overlay onto a 2D Canvas
 * Useful for real-time viewfinder preview and frame composition
 */
export async function renderFramedPhotoToCanvas(photoImg, frameConfig, targetCanvas, options = {}) {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');

  const width = targetCanvas.width;
  const height = targetCanvas.height;

  // 1. Fill base canvas with clean white
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 2. Draw photo depending on frame type
  if (!frameConfig || frameConfig.type === 'none' || !frameConfig.type) {
    // Direct photo without frame
    drawCoverImage(ctx, photoImg, 0, 0, width, height);
    return;
  }

  if (frameConfig.type === 'preset') {
    const presetId = frameConfig.presetId || 'polaroid';
    if (presetId === 'polaroid') {
      // Polaroid inner photo cutout (5% side/top margin, 16% bottom chin)
      const sideMargin = Math.round(width * 0.05);
      const topMargin = Math.round(height * 0.05);
      const bottomMargin = Math.round(height * 0.16);
      const innerW = width - sideMargin * 2;
      const innerH = height - topMargin - bottomMargin;

      drawCoverImage(ctx, photoImg, sideMargin, topMargin, innerW, innerH);
      renderPresetFrameToCanvas(ctx, width, height, 'polaroid', {
        text: frameConfig.text || options.eventTitle,
        subText: frameConfig.subText || options.eventDate,
      });
    } else {
      // Full background photo + preset overlay
      drawCoverImage(ctx, photoImg, 0, 0, width, height);
      renderPresetFrameToCanvas(ctx, width, height, presetId, {
        text: frameConfig.text || options.eventTitle,
        subText: frameConfig.subText || options.eventDate,
      });
    }
  } else if (frameConfig.type === 'custom' && (frameConfig.url || frameConfig.blob)) {
    // Custom transparent PNG overlay
    drawCoverImage(ctx, photoImg, 0, 0, width, height);
    try {
      const { img: frameImg, cleanup } = await loadImageElement(frameConfig.url || frameConfig.blob);
      ctx.drawImage(frameImg, 0, 0, width, height);
      cleanup();
    } catch (err) {
      console.warn('Failed to draw custom frame overlay:', err);
    }
  } else {
    // Fallback direct photo
    drawCoverImage(ctx, photoImg, 0, 0, width, height);
  }
}

/**
 * High-performance Frame Compositor:
 * - Composes raw photo captures with custom PNG frames or procedural presets
 * - Strips EXIF GPS and computes SHA-256 duplicate hash
 * - Produces dual output: Full-Res (max 2048px @ 88% JPEG) and micro-thumbnail (360px @ 75% JPEG)
 */
export async function composePhotoWithFrame(fileOrBlob, frameConfig = null, options = {}) {
  const maxDimension = options.maxDimension || 2048;
  const thumbDimension = options.thumbDimension || 360;
  const quality = options.quality || 0.88;
  const thumbQuality = options.thumbQuality || 0.75;

  // 1. Compute SHA-256 duplicate fingerprint
  const hash = await computePhotoHash(fileOrBlob);

  // 2. Safely decode user photo
  const { img: photoImg, width: srcW, height: srcH, cleanup: photoCleanup } = await loadImageElement(fileOrBlob);

  // 3. Determine canvas aspect ratio & dimensions
  let targetW = srcW;
  let targetH = srcH;

  const hasActiveFrame = frameConfig && frameConfig.type && frameConfig.type !== 'none';

  if (hasActiveFrame) {
    if (frameConfig.type === 'preset') {
      const presetId = frameConfig.presetId || 'polaroid';
      if (presetId === 'polaroid' || presetId === 'wedding_gold') {
        // Standard 4:5 portrait celebration ratio
        targetW = 1600;
        targetH = 2000;
      } else if (presetId === 'neon_party') {
        // 9:16 mobile story ratio
        targetW = 1125;
        targetH = 2000;
      } else if (presetId === 'minimal_dark') {
        // 1:1 square ratio
        targetW = 1600;
        targetH = 1600;
      }
    } else if (frameConfig.type === 'custom' && (frameConfig.url || frameConfig.blob)) {
      try {
        const { width: fw, height: fh } = await loadImageElement(frameConfig.url || frameConfig.blob);
        if (fw && fh) {
          const ratio = fh / fw;
          targetW = 1600;
          targetH = Math.round(1600 * ratio);
        }
      } catch (err) {
        console.warn('Could not inspect custom frame dimensions, keeping source aspect:', err);
      }
    }
  }

  // Clamp target dimensions to maxDimension
  if (targetW > maxDimension || targetH > maxDimension) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxDimension) / targetW);
      targetW = maxDimension;
    } else {
      targetW = Math.round((targetW * maxDimension) / targetH);
      targetH = maxDimension;
    }
  }

  // 4. Render composite onto high-res canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, targetW);
  canvas.height = Math.max(1, targetH);

  await renderFramedPhotoToCanvas(photoImg, frameConfig, canvas, options);
  photoCleanup();

  // 5. Calculate thumbnail dimensions
  let thumbW = targetW;
  let thumbH = targetH;
  if (targetW >= targetH) {
    thumbW = thumbDimension;
    thumbH = Math.round((targetH * thumbDimension) / targetW);
  } else {
    thumbH = thumbDimension;
    thumbW = Math.round((targetW * thumbDimension) / targetH);
  }

  // 6. Generate high-res and thumbnail blobs
  const originalBlob = await renderToBlob(canvas, targetW, targetH, quality, 'image/jpeg');
  const thumbBlob = await renderToBlob(canvas, thumbW, thumbH, thumbQuality, 'image/jpeg');

  return {
    hash,
    filename: fileOrBlob.name || `photo_${Date.now()}.jpg`,
    originalBlob,
    thumbBlob,
    width: targetW,
    height: targetH,
    size: originalBlob.size,
    mimeType: 'image/jpeg',
    hasFrame: hasActiveFrame,
  };
}

/**
 * Process a raw photo file client-side:
 * - Computes SHA-256 duplicate hash
 * - Auto-corrects orientation and strips unwanted GPS metadata
 * - Routes to composePhotoWithFrame if frame is configured
 * - Downscales to high-res (max 2048px) & generates fast 360px thumbnail
 */
export async function processPhotoClient(file, options = {}) {
  if (options.frameConfig && options.frameConfig.type && options.frameConfig.type !== 'none') {
    return composePhotoWithFrame(file, options.frameConfig, options);
  }

  const maxDimension = options.maxDimension || 2048;
  const thumbDimension = options.thumbDimension || 360;
  const quality = options.quality || 0.88;
  const thumbQuality = options.thumbQuality || 0.75;

  // 1. Compute SHA-256 duplicate hash
  const hash = await computePhotoHash(file);

  let imageSource = null;
  let srcWidth = 0;
  let srcHeight = 0;
  let objectUrlToRevoke = null;

  // 2. Load via HTMLImageElement
  try {
    objectUrlToRevoke = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrlToRevoke;

    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Failed to decode image file'));
        });
      }
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to decode image file'));
      });
    }

    srcWidth = img.naturalWidth || img.width;
    srcHeight = img.naturalHeight || img.height;
    imageSource = img;
  } catch (imgErr) {
    console.warn('HTMLImageElement decode failed, trying createImageBitmap:', imgErr);
    if (typeof createImageBitmap === 'function') {
      try {
        imageSource = await createImageBitmap(file, { imageOrientation: 'from-image' });
        srcWidth = imageSource.width;
        srcHeight = imageSource.height;
      } catch (bitmapErr) {
        console.warn('createImageBitmap failed:', bitmapErr);
        imageSource = null;
      }
    }
  }

  // Graceful fallback if image decoding completely failed
  if (!imageSource || !srcWidth || !srcHeight) {
    return {
      hash,
      filename: file.name || `photo_${Date.now()}.jpg`,
      originalBlob: file,
      thumbBlob: file,
      width: 1920,
      height: 1080,
      size: file.size,
      mimeType: file.type || 'image/jpeg',
      hasFrame: false,
    };
  }

  // 3. Calculate high-res dimensions
  let targetWidth = srcWidth;
  let targetHeight = srcHeight;

  if (srcWidth > maxDimension || srcHeight > maxDimension) {
    if (srcWidth >= srcHeight) {
      targetWidth = maxDimension;
      targetHeight = Math.round((srcHeight * maxDimension) / srcWidth);
    } else {
      targetHeight = maxDimension;
      targetWidth = Math.round((srcWidth * maxDimension) / srcHeight);
    }
  }

  // 4. Calculate thumbnail dimensions
  let thumbWidth = srcWidth;
  let thumbHeight = srcHeight;
  if (srcWidth >= srcHeight) {
    thumbWidth = thumbDimension;
    thumbHeight = Math.round((srcHeight * thumbDimension) / srcWidth);
  } else {
    thumbHeight = thumbDimension;
    thumbWidth = Math.round((srcWidth * thumbDimension) / srcHeight);
  }

  // 5. Render High-Res Blob & Thumbnail Blob
  let originalBlob;
  let thumbBlob;

  try {
    originalBlob = await renderToBlob(imageSource, targetWidth, targetHeight, quality, 'image/jpeg');
    thumbBlob = await renderToBlob(imageSource, thumbWidth, thumbHeight, thumbQuality, 'image/jpeg');
  } catch (renderErr) {
    console.warn('Canvas rendering error, using raw file as original:', renderErr);
    originalBlob = file;
    thumbBlob = file;
  }

  // Clean up
  if (imageSource && typeof imageSource.close === 'function') {
    try { imageSource.close(); } catch (_) {}
  }
  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
  }

  return {
    hash,
    filename: file.name || `photo_${Date.now()}.jpg`,
    originalBlob,
    thumbBlob,
    width: targetWidth,
    height: targetHeight,
    size: originalBlob.size || file.size,
    mimeType: 'image/jpeg',
    hasFrame: false,
  };
}
