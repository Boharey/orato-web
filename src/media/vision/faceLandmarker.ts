/**
 * faceLandmarker.ts
 * -----------------
 * Thin wrapper around @mediapipe/tasks-vision's FaceLandmarker. Owns model
 * loading only — no gaze math here, that lives in gazeMath.ts.
 *
 * The model file itself (face_landmarker.task) is NOT bundled — it's a
 * ~3.7MB binary that must be downloaded separately into public/models/.
 * See README.md for the download command.
 *
 * GPU delegate hardening: originally requested `delegate: "GPU"` with a
 * comment claiming it "falls back to CPU automatically" — that was an
 * UNVERIFIED assumption, the same mistake that caused the earlier
 * Whisper/WebGPU crash-loop in Brave. MediaPipe's GPU delegate uses
 * WebGL, a different pathway from the WebGPU one already hardened in
 * whisperTranscriber.ts, so it was never actually protected. Confirmed:
 * Brave under Wayland can spawn a GPU-process crash-loop (multiple
 * processes pinned at 100% CPU) when this delegate misbehaves — same
 * symptom class, different code path. Fixed with three layers, since a
 * single check isn't reliable here:
 *   1. Probe actual WebGL availability before ever requesting GPU delegate.
 *   2. Race GPU delegate creation against a timeout, in case it hangs
 *      rather than cleanly rejecting (the failure mode that broke the
 *      simple try/catch approach for WebGPU too).
 *   3. try/catch as a backstop for the cases where it DOES reject cleanly.
 * Browser-name sniffing was deliberately avoided — Brave mimics Chrome's
 * user-agent string specifically to resist fingerprinting, so it's not a
 * reliable signal. Feature detection also protects against any other
 * browser with the same underlying issue, not just Brave.
 *
 * Honest limitation: "timing out and moving on" stops OUR code from
 * waiting, but can't force-cancel a GPU process Brave has already
 * spawned at the OS level — same class of limitation as the compositor's
 * generation-counter fix (discard stale JS state, can't un-launch
 * already-running native work). This significantly improves the app's
 * behavior (no more indefinite hang) even though it can't fully control
 * Brave's own process management.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const MODEL_PATH = "/models/face_landmarker.task";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// How long to wait for GPU-delegate creation before giving up and using
// CPU instead. Long enough for legitimate (if slow) GPU init on typical
// hardware; short enough that a genuinely hung attempt doesn't leave the
// person staring at "loading model…" indefinitely.
const GPU_INIT_TIMEOUT_MS = 6000;

let landmarkerInstance: FaceLandmarker | null = null;
let loadingPromise: Promise<FaceLandmarker> | null = null;

/** Cheap first-pass filter — if WebGL can't even be created, don't bother
 * attempting the GPU delegate at all. Doesn't catch every failure mode
 * (see the timeout layer below for that), but avoids the attempt
 * entirely in the clearest-cut cases. */
function canCreateWebGLContext(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function createLandmarker(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: "GPU" | "CPU"
) {
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * Lazily creates (or returns the cached) FaceLandmarker instance.
 * Safe to call multiple times — subsequent calls reuse the same instance.
 */
export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerInstance) return landmarkerInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

    if (canCreateWebGLContext()) {
      const gpuAttempt = createLandmarker(vision, "GPU");
      try {
        const landmarker = await withTimeout(
          gpuAttempt,
          GPU_INIT_TIMEOUT_MS,
          "GPU FaceLandmarker init"
        );
        landmarkerInstance = landmarker;
        return landmarker;
      } catch (err) {
        console.warn(
          "[faceLandmarker] GPU delegate failed or timed out — falling back to CPU.",
          err
        );
        // The timeout stops US from waiting, but doesn't cancel the
        // underlying attempt — if it eventually resolves anyway (slow
        // but not truly hung), close the abandoned instance instead of
        // silently leaking a native resource we're never going to use.
        gpuAttempt.then((lateLandmarker) => lateLandmarker.close()).catch(() => {});
      }
    } else {
      console.warn("[faceLandmarker] WebGL unavailable — using CPU delegate.");
    }

    const landmarker = await createLandmarker(vision, "CPU");
    landmarkerInstance = landmarker;
    return landmarker;
  })();

  return loadingPromise;
}

/** Call this if the model file is missing so the error message is actionable. */
export async function checkModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(MODEL_PATH, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export function disposeFaceLandmarker() {
  landmarkerInstance?.close();
  landmarkerInstance = null;
  loadingPromise = null;
}
