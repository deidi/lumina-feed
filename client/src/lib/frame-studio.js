/**
 * LuminaFeed Host Frame Studio & Preset Engine
 * 
 * Provides:
 * - Built-in celebration presets (Polaroid, Wedding Gold, Neon Party, Minimal Dark)
 * - Dynamic procedural canvas rendering with custom event text, date, and hashtags
 * - Export of preset overlays to transparent PNG blobs
 */

export const FRAME_PRESETS = {
  none: {
    id: 'none',
    name: 'No Frame (Direct Photos)',
    description: 'Clean, unbordered photos with direct streaming',
    aspectRatio: 'any',
  },
  polaroid: {
    id: 'polaroid',
    name: 'Polaroid Classic',
    description: 'Retro instant film frame with bottom caption area',
    aspectRatio: '4:5',
    defaultText: 'Memories ✨',
  },
  wedding_gold: {
    id: 'wedding_gold',
    name: 'Elegant Gold Wedding',
    description: 'Luxurious double gold-foil border with corner accents',
    aspectRatio: '4:5',
    defaultText: 'Forever & Always',
  },
  neon_party: {
    id: 'neon_party',
    name: 'Neon Party Glow',
    description: 'Vibrant neon gradient border with celebration accents',
    aspectRatio: '9:16',
    defaultText: 'Party Night 🎉',
  },
  minimal_dark: {
    id: 'minimal_dark',
    name: 'Minimal Modern',
    description: 'Sleek dark framing with elegant typography',
    aspectRatio: '1:1',
    defaultText: 'Special Moments',
  },
  custom: {
    id: 'custom',
    name: 'Custom PNG Overlay',
    description: 'Organizer-uploaded custom transparent PNG frame',
    aspectRatio: 'custom',
  },
};

/**
 * Render a procedural preset frame overlay onto a 2D Canvas context
 */
export function renderPresetFrameToCanvas(ctx, width, height, presetId, options = {}) {
  const text = (options.text || options.eventTitle || '').trim();
  const subText = (options.subText || options.eventDate || '').trim();

  ctx.save();

  if (presetId === 'polaroid') {
    // Polaroid Frame: white borders with extended bottom chin
    const sideMargin = Math.round(width * 0.05);
    const topMargin = Math.round(height * 0.05);
    const bottomMargin = Math.round(height * 0.16);

    ctx.fillStyle = '#FFFFFF';

    // Top border
    ctx.fillRect(0, 0, width, topMargin);
    // Left border
    ctx.fillRect(0, 0, sideMargin, height);
    // Right border
    ctx.fillRect(width - sideMargin, 0, sideMargin, height);
    // Bottom chin
    ctx.fillRect(0, height - bottomMargin, width, bottomMargin);

    // Inner subtle drop shadow line around photo cutout
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sideMargin, topMargin, width - sideMargin * 2, height - topMargin - bottomMargin);

    // Bottom text
    if (text || subText) {
      ctx.fillStyle = '#1A1A1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.max(16, Math.round(width * 0.042));
      ctx.font = `600 ${fontSize}px "Outfit", "Segoe UI", sans-serif`;
      ctx.fillText(text || 'Special Memories', width / 2, height - bottomMargin * 0.62);

      if (subText) {
        ctx.fillStyle = '#666666';
        ctx.font = `400 ${Math.round(fontSize * 0.65)}px "Inter", sans-serif`;
        ctx.fillText(subText, width / 2, height - bottomMargin * 0.28);
      }
    }
  } else if (presetId === 'wedding_gold') {
    // Elegant Gold Foil Border
    const borderThickness = Math.max(8, Math.round(width * 0.035));
    const inset = Math.round(width * 0.025);

    // Gold gradient stroke
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#D4AF37');
    grad.addColorStop(0.3, '#FFF2B2');
    grad.addColorStop(0.6, '#AA771C');
    grad.addColorStop(1, '#E6CA65');

    ctx.strokeStyle = grad;
    ctx.lineWidth = borderThickness;
    ctx.strokeRect(borderThickness / 2, borderThickness / 2, width - borderThickness, height - borderThickness);

    // Thin inner pinstripe
    ctx.lineWidth = 2;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

    // Corner diamond filigrees
    const cornerSize = Math.round(width * 0.03);
    const drawDiamond = (cx, cy) => {
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy - cornerSize);
      ctx.lineTo(cx + cornerSize, cy);
      ctx.lineTo(cx, cy + cornerSize);
      ctx.lineTo(cx - cornerSize, cy);
      ctx.closePath();
      ctx.fill();
    };

    drawDiamond(inset, inset);
    drawDiamond(width - inset, inset);
    drawDiamond(inset, height - inset);
    drawDiamond(width - inset, height - inset);

    // Bottom banner
    if (text) {
      const bannerHeight = Math.round(height * 0.09);
      ctx.fillStyle = 'rgba(15, 15, 20, 0.75)';
      ctx.fillRect(0, height - bannerHeight, width, bannerHeight);

      ctx.fillStyle = '#FFF2B2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.max(16, Math.round(width * 0.038));
      ctx.font = `600 ${fontSize}px "Outfit", serif`;
      ctx.fillText(text, width / 2, height - bannerHeight * 0.6);

      if (subText) {
        ctx.fillStyle = '#D4AF37';
        ctx.font = `400 ${Math.round(fontSize * 0.65)}px sans-serif`;
        ctx.fillText(subText, width / 2, height - bannerHeight * 0.25);
      }
    }
  } else if (presetId === 'neon_party') {
    // Neon Party Gradient Border
    const borderThickness = Math.max(10, Math.round(width * 0.03));
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#FF007F');
    grad.addColorStop(0.5, '#7928CA');
    grad.addColorStop(1, '#00F0FF');

    ctx.strokeStyle = grad;
    ctx.lineWidth = borderThickness;
    ctx.strokeRect(borderThickness / 2, borderThickness / 2, width - borderThickness, height - borderThickness);

    // Bottom Neon Badge
    if (text) {
      const badgeHeight = Math.round(height * 0.085);
      ctx.fillStyle = 'rgba(10, 10, 18, 0.85)';
      ctx.fillRect(borderThickness, height - badgeHeight - borderThickness, width - borderThickness * 2, badgeHeight);

      ctx.fillStyle = '#00F0FF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.max(16, Math.round(width * 0.04));
      ctx.font = `700 ${fontSize}px "Outfit", sans-serif`;
      ctx.fillText(text, width / 2, height - borderThickness - badgeHeight * 0.6);

      if (subText) {
        ctx.fillStyle = '#FF007F';
        ctx.font = `500 ${Math.round(fontSize * 0.65)}px sans-serif`;
        ctx.fillText(subText, width / 2, height - borderThickness - badgeHeight * 0.25);
      }
    }
  } else if (presetId === 'minimal_dark') {
    // Sleek Minimal Dark Border
    const borderThickness = Math.max(6, Math.round(width * 0.025));
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = borderThickness;
    ctx.strokeRect(borderThickness / 2, borderThickness / 2, width - borderThickness, height - borderThickness);

    if (text) {
      const footerH = Math.round(height * 0.075);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(0, height - footerH, width, footerH);

      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.max(14, Math.round(width * 0.035));
      ctx.font = `500 ${fontSize}px "Inter", sans-serif`;
      ctx.fillText(text, width / 2, height - footerH * 0.55);
    }
  }

  ctx.restore();
}

/**
 * Generate a transparent PNG blob of a preset frame overlay
 */
export async function generatePresetFramePNG(presetId, width = 1600, height = 2000, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Draw preset overlay directly on transparent background
  renderPresetFrameToCanvas(ctx, width, height, presetId, options);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate preset frame PNG'));
    }, 'image/png');
  });
}
