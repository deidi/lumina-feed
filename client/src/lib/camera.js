/**
 * LuminaFeed In-App Camera Engine
 * 
 * Provides:
 * - Direct camera stream access via WebRTC getUserMedia
 * - Front/back camera toggle (facingMode)
 * - Hardware torch / flashlight toggle
 * - High-resolution frame grab from video feed
 * - Graceful permission and capability error handling
 */

export class CameraController {
  constructor() {
    this.stream = null;
    this.videoElement = null;
    this.facingMode = 'environment'; // 'environment' | 'user'
    this.isTorchOn = false;
    this.hasTorch = false;
    this.hasMultipleCameras = false;
  }

  async checkCapabilities() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return { hasMultipleCameras: false };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      this.hasMultipleCameras = videoDevices.length > 1;
      return { hasMultipleCameras: this.hasMultipleCameras, videoDevices };
    } catch (e) {
      return { hasMultipleCameras: false };
    }
  }

  async startStream(videoEl, options = {}) {
    this.videoElement = videoEl;
    this.facingMode = options.facingMode || this.facingMode || 'environment';

    this.stopStream();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access is not supported on this browser or device.');
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Fallback if ideal constraints fail on some mobile webviews
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.warn('Video auto-play interrupted:', playErr);
      }
    }

    // Inspect torch capability
    const track = this.getVideoTrack();
    if (track && typeof track.getCapabilities === 'function') {
      const caps = track.getCapabilities();
      this.hasTorch = Boolean(caps.torch);
    } else {
      this.hasTorch = false;
    }

    await this.checkCapabilities();

    return {
      stream: this.stream,
      facingMode: this.facingMode,
      hasTorch: this.hasTorch,
      hasMultipleCameras: this.hasMultipleCameras
    };
  }

  getVideoTrack() {
    if (!this.stream) return null;
    const tracks = this.stream.getVideoTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  async flipCamera() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    if (this.videoElement) {
      return this.startStream(this.videoElement, { facingMode: this.facingMode });
    }
    return { facingMode: this.facingMode };
  }

  async toggleTorch() {
    const track = this.getVideoTrack();
    if (!track || !this.hasTorch) return false;

    this.isTorchOn = !this.isTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      return this.isTorchOn;
    } catch (e) {
      console.warn('Torch toggle error:', e);
      this.isTorchOn = false;
      return false;
    }
  }

  takeSnapshot(options = {}) {
    if (!this.videoElement) throw new Error('No active video element');

    const video = this.videoElement;
    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    // If selfie camera, mirror snapshot horizontally for natural preview
    if (this.facingMode === 'user' && options.mirrorUserCamera !== false) {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, vw, vh);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
          resolve({ blob, file, width: vw, height: vh });
        } else {
          reject(new Error('Failed to capture frame from video'));
        }
      }, 'image/jpeg', 0.95);
    });
  }

  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.stream = null;
    }
    if (this.videoElement) {
      try {
        this.videoElement.srcObject = null;
      } catch (e) {}
    }
    this.isTorchOn = false;
  }
}

export const cameraController = new CameraController();
