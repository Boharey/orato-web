/**
 * composeFinalVideo.ts
 * ---------------------
 * Replays the recorded video into a hidden <video> element, draws overlays
 * onto a <canvas> in sync via requestAnimationFrame, and re-records the
 * canvas (video track) combined with the original clip's audio track (via
 * HTMLVideoElement.captureStream()) into a new downloadable file.
 *
 * This is the direct browser replacement for the backend's ffmpeg-based
 * video_compositor.py — no binary dependency, no server round-trip.
 *
 * Known limitation: canvas frames come from a rAF loop, audio comes
 * straight from the source track — sync is good but not frame-perfect the
 * way a deterministic ffmpeg pass would be. Fine for a coaching-feedback
 * video; would matter more for something like broadcast delivery.
 */

import { drawOverlayFrame, type OverlayContext } from "./drawOverlays";

export interface ComposeResult {
  blob: Blob;
  url: string;
  mimeType: string;
}

const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  // Same Safari reasoning as useMediaRecorder.ts — see that file's
  // comment for the full explanation. This compositor re-records the
  // canvas independently of whatever format the original recording
  // used, so it needs this fallback checked separately, not inherited.
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

function pickSupportedMimeType(): string {
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
}

/** Derives a sane download file extension from a MediaRecorder mimeType
 * string like "video/mp4;codecs=avc1,mp4a" -> "mp4". Used so the download
 * link's filename matches what the file actually is, instead of a
 * hardcoded ".webm" that would be silently wrong on Safari. */
export function mimeTypeToExtension(mimeType: string): string {
  const base = mimeType.split(";")[0]; // strip codec parameters
  const subtype = base.split("/")[1];
  return subtype || "webm";
}

export async function composeFinalVideo(
  recordedBlob: Blob,
  overlay: OverlayContext,
  onProgress?: (pct: number) => void,
  sourceFrameRate?: number | null
): Promise<ComposeResult> {
  const sourceUrl = URL.createObjectURL(recordedBlob);

  const video = document.createElement("video");
  video.src = sourceUrl;
  video.muted = false; // must stay false — captureStream()'s audio track
  video.volume = 0; //   goes silent in some browsers if `muted` is true;
  video.playsInline = true; //   `volume = 0` silences playback without that side effect

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load recorded video for compositing."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");

  const canvasStream = canvas.captureStream(
    // Match the actual source camera's negotiated capture rate rather
    // than assuming one — a hardcoded 30 would needlessly cap export
    // quality on a device that genuinely captured at 60fps or higher.
    // 30 remains a sane fallback when the real rate isn't known.
    sourceFrameRate && sourceFrameRate > 0 ? sourceFrameRate : 30
  );

  const captureStreamFn = (
    video as HTMLVideoElement & { captureStream?: () => MediaStream }
  ).captureStream;
  const audioTracks = captureStreamFn ? captureStreamFn.call(video).getAudioTracks() : [];
  if (audioTracks.length === 0) {
    console.warn(
      "composeFinalVideo: no audio track captured — output will be silent. " +
        "This can happen if HTMLVideoElement.captureStream() isn't supported in this browser."
    );
  }

  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const resultPromise = new Promise<ComposeResult>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      resolve({ blob, url, mimeType });
    };
    recorder.onerror = () => reject(new Error("Recording the composited video failed."));
  });

  let rafId = 0;
  const drawLoop = () => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawOverlayFrame(ctx, canvas.width, canvas.height, video.currentTime, overlay);

    if (onProgress && video.duration > 0) {
      onProgress(Math.min(100, Math.round((video.currentTime / video.duration) * 100)));
    }

    if (!video.ended) {
      rafId = requestAnimationFrame(drawLoop);
    }
  };

  video.onended = () => {
    cancelAnimationFrame(rafId);
    recorder.stop();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  };

  recorder.start(250);
  await video.play();
  rafId = requestAnimationFrame(drawLoop);

  return resultPromise;
}
