/**
 * LuminaFeed 1-Click Printable QR Table Card & Poster Generator
 * 
 * Generates high-resolution, print-ready table cards and posters (1200x1600px)
 * for event organizers to print and place on guest tables or venue entrance boards.
 */

import QRCode from 'qrcode';
import { resolveDynamicOrigin, buildDynamicEventJoinUrl } from './network.js';

/**
 * Generate a high-resolution printable table card Canvas / Blob
 */
export async function generatePrintableSignBlob({
  eventName = 'Special Event',
  tagline = 'Memories Shared in Real-Time',
  joinUrl = '',
  date = '',
  theme = 'dark', // 'dark' | 'light'
}) {
  const width = 1200;
  const height = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const isDark = theme !== 'light';

  // 1. Background
  if (isDark) {
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0B0F19');
    bgGrad.addColorStop(0.5, '#111827');
    bgGrad.addColorStop(1, '#0B0F19');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative subtle top glow
    const topGlow = ctx.createRadialGradient(width / 2, 0, 50, width / 2, 0, width * 0.75);
    topGlow.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
    topGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, width, height * 0.4);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    // Subtle border
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 12;
    ctx.strokeRect(20, 20, width - 40, height - 40);
  }

  // 2. Header Brand
  ctx.textAlign = 'center';
  ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
  ctx.font = '700 24px "Inter", sans-serif';
  ctx.fillText('📸 LUMINA FEED', width / 2, 110);

  // 3. Main Event Title
  ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
  ctx.font = '800 52px "Outfit", sans-serif';
  const cleanName = eventName.length > 30 ? `${eventName.substring(0, 28)}...` : eventName;
  ctx.fillText(cleanName, width / 2, 185);

  // 4. Tagline & Date
  if (tagline || date) {
    ctx.fillStyle = isDark ? '#38BDF8' : '#0284C7';
    ctx.font = '500 28px "Inter", sans-serif';
    const sub = [tagline, date].filter(Boolean).join(' • ');
    ctx.fillText(sub, width / 2, 235);
  }

  // 5. Generate & Draw QR Code
  let qrTarget = joinUrl;
  if (!qrTarget) {
    qrTarget = window.location.href;
  }
  if (qrTarget.includes('localhost') || qrTarget.includes('127.0.0.1')) {
    const dynamicOrigin = resolveDynamicOrigin();
    qrTarget = qrTarget.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, dynamicOrigin);
  }
  const qrDataUrl = await QRCode.toDataURL(qrTarget, {
    width: 520,
    margin: 2,
    color: {
      dark: isDark ? '#000000' : '#0F172A',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'H',
  });

  const qrImg = new Image();
  qrImg.src = qrDataUrl;
  await new Promise((resolve, reject) => {
    qrImg.onload = resolve;
    qrImg.onerror = reject;
  });

  // Draw QR Card Container with rounded corners
  const qrCardW = 580;
  const qrCardH = 580;
  const qrCardX = (width - qrCardW) / 2;
  const qrCardY = 300;

  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.beginPath();
  ctx.roundRect(qrCardX, qrCardY, qrCardW, qrCardH, 32);
  ctx.fill();
  ctx.restore();

  // Draw QR image centered inside white card
  ctx.drawImage(qrImg, qrCardX + 30, qrCardY + 30, 520, 520);

  // 6. Action Callout
  ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
  ctx.font = '800 38px "Outfit", sans-serif';
  ctx.fillText('Scan to Share Your Photos!', width / 2, 940);

  // 7. Step-by-Step Instructions Card
  const stepsY = 1000;
  const steps = [
    { num: '1', title: 'Open Phone Camera', desc: 'Point your camera at the QR code above' },
    { num: '2', title: 'Snap & Apply Frame', desc: 'Take photos and choose an event frame' },
    { num: '3', title: 'Watch the Live Screen', desc: 'See your memories live on the big screen!' },
  ];

  steps.forEach((step, idx) => {
    const y = stepsY + idx * 135;
    const badgeX = 220;

    // Number Badge
    ctx.save();
    ctx.fillStyle = isDark ? '#3B82F6' : '#2563EB';
    ctx.beginPath();
    ctx.arc(badgeX, y + 20, 28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 24px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(step.num, badgeX, y + 20);
    ctx.restore();

    // Step Title & Description
    ctx.textAlign = 'left';
    ctx.fillStyle = isDark ? '#F1F5F9' : '#1E293B';
    ctx.font = '700 26px "Outfit", sans-serif';
    ctx.fillText(step.title, badgeX + 48, y + 10);

    ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
    ctx.font = '400 20px "Inter", sans-serif';
    ctx.fillText(step.desc, badgeX + 48, y + 38);
  });

  // 8. Footer Link
  ctx.textAlign = 'center';
  ctx.fillStyle = isDark ? '#64748B' : '#94A3B8';
  ctx.font = '500 20px "Inter", sans-serif';
  ctx.fillText('Zero App Installs Required • Instant Cloud Sync', width / 2, 1510);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate printable sign blob'));
    }, 'image/png');
  });
}

/**
 * Trigger 1-Click PNG Download of Printable Table Card
 */
export async function downloadPrintableSign(eventData, joinUrl) {
  const blob = await generatePrintableSignBlob({
    eventName: eventData.name || 'Event',
    tagline: eventData.tagline || '',
    date: eventData.date || '',
    joinUrl: joinUrl || window.location.href,
    theme: 'dark',
  });

  const safeSlug = (eventData.slug || 'event').replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `${safeSlug}_table_sign.png`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
