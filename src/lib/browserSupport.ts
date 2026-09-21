/**
 * browserSupport.ts
 * ------------------
 * Checks for the specific browser APIs Practice actually depends on,
 * run once on mount. Without this, a visitor on an old/unusual browser
 * hits a confusing failure deep inside the recording or model-loading
 * flow instead of a clear message up front.
 */

export interface BrowserSupportResult {
  supported: boolean;
  missing: string[];
}

export function checkBrowserSupport(): BrowserSupportResult {
  const missing: string[] = [];

  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    missing.push("camera/microphone access");
  }

  if (typeof window === "undefined" || !window.MediaRecorder) {
    missing.push("video recording");
  }

  if (typeof WebAssembly === "undefined") {
    missing.push("WebAssembly (needed to run the on-device AI models)");
  }

  return { supported: missing.length === 0, missing };
}
