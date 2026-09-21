/**
 * gazeMath.ts
 * -----------
 * Pure functions, no MediaPipe/DOM dependency — ported from the Python
 * backend's video_analyzer.py (the production analyzer, not the
 * experimental eye_tracker.py).
 *
 * ASSUMPTION FLAGGED: uses video_analyzer.py's inner/outer corner convention
 * (LEFT_INNER=133, LEFT_OUTER=33). The Python side has TWO different
 * conventions across video_analyzer.py and eye_tracker.py that haven't been
 * verified against debug_gaze.py yet. If that verification flips which one
 * is correct, mirror the change here — this file should always match
 * whichever Python convention is confirmed correct, not the other way
 * around.
 */

import type { GazeZone } from "@/types/metrics";

export const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

export const LEFT_IRIS_IDX = 468;
export const RIGHT_IRIS_IDX = 473;

export const LEFT_INNER = 133;
export const LEFT_OUTER = 33;
export const LEFT_TOP = 159;
export const LEFT_BOT = 145;
export const RIGHT_INNER = 362;
export const RIGHT_OUTER = 263;
export const RIGHT_TOP = 386;
export const RIGHT_BOT = 374;

export const EAR_BLINK_THRESH = 0.2;
export const GAZE_H_THRESH = 0.12;
export const GAZE_V_THRESH = 0.12;

// Time-based, not frame-count-based. Frame counts tie real calibration
// duration to the device's requestAnimationFrame tick rate — usually
// synced to display refresh rate, and further gated by how fast
// detectForVideo() can actually run per tick — which varies across
// hardware (a 120Hz display with a fast GPU could finish "30 frames" in
// a fraction of the real time a slower 30Hz-effective setup takes).
// Measuring elapsed time via performance.now() deltas instead guarantees
// the same real-world calibration duration on any device. A faster
// device just collects more samples in the same window, which only
// improves the averaged baseline — never a problem.
export const DISCARD_MS = 600; // let the person settle into position
export const CALIB_MS = 1400; // average the neutral baseline
// DISCARD_MS + CALIB_MS = 2000ms total, by design.

// Same fix, same reasoning, applied to blink debounce: a fixed tick
// count for "how long must EAR stay below threshold to count as a
// blink" has the identical hardware-dependence problem. ~60ms approximates
// what "2 frames" meant at a reference ~30fps tick rate, but now holds
// steady regardless of actual tick rate.
export const BLINK_DEBOUNCE_MS = 60;

export const H_SCALE = 1.8;
export const V_SCALE_UP = 7.0;
export const V_SCALE_DOWN = 5.0;

export type Point2D = [number, number];

/** A single normalized (0..1) landmark, as returned by MediaPipe Tasks Vision. */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export function lmPx(landmarks: NormalizedLandmark[], idx: number, w: number, h: number): Point2D {
  return [landmarks[idx].x * w, landmarks[idx].y * h];
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function ear(pts: Point2D[]): number {
  const A = dist(pts[1], pts[5]);
  const B = dist(pts[2], pts[4]);
  const C = dist(pts[0], pts[3]);
  return (A + B) / (2.0 * C + 1e-6);
}

/** Signed offset of the iris from the eye's midpoint, normalized by eye width. */
export function irisOffset(iris: Point2D, inner: Point2D, outer: Point2D): Point2D {
  const eyeVec: Point2D = [outer[0] - inner[0], outer[1] - inner[1]];
  const mid: Point2D = [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2];
  const norm = Math.hypot(eyeVec[0], eyeVec[1]) + 1e-6;
  return [(iris[0] - mid[0]) / norm, (iris[1] - mid[1]) / norm];
}

export function classifyZone(
  dx: number,
  dy: number,
  hThresh: number = GAZE_H_THRESH,
  vThresh: number = GAZE_V_THRESH
): GazeZone {
  if (Math.abs(dx) < hThresh && Math.abs(dy) < vThresh) return "ON_CAMERA";

  // Compare EXCESS PAST THRESHOLD, not raw magnitude. dx and dy arrive here
  // already scaled by very different upstream factors (H_SCALE=1.8 vs
  // V_SCALE_UP/DOWN=5-7 in classifyWithCalibration), so a raw |dx| vs |dy|
  // comparison isn't apples-to-apples — ordinary vertical landmark jitter
  // can out-scale a genuine horizontal glance purely because it was
  // amplified ~3-4x more upstream, not because it's actually more
  // significant. Normalizing each axis by its own threshold first puts
  // them on the same "how many threshold-widths past the boundary" scale
  // before comparing — this was already a documented lesson from the
  // Python side that the original raw-magnitude comparison didn't
  // actually implement.
  const hExcess = Math.abs(dx) / hThresh;
  const vExcess = Math.abs(dy) / vThresh;

  if (hExcess >= vExcess) return dx < 0 ? "LEFT" : "RIGHT";
  return dy < 0 ? "UP" : "DOWN";
}

export interface FrameGazeResult {
  avgEar: number;
  isBlink: boolean;
  horiz: number;
  vert: number;
  hasIris: boolean;
}

/** One frame's worth of raw gaze signal — no calibration/classification applied yet. */
export function computeFrameGaze(landmarks: NormalizedLandmark[], w: number, h: number): FrameGazeResult {
  const leftEyePts = LEFT_EYE_IDX.map((i) => lmPx(landmarks, i, w, h));
  const rightEyePts = RIGHT_EYE_IDX.map((i) => lmPx(landmarks, i, w, h));
  const avgEar = (ear(leftEyePts) + ear(rightEyePts)) / 2.0;
  const isBlink = avgEar < EAR_BLINK_THRESH;

  const hasIris = landmarks.length > 473;
  let horiz = 0;
  let vert = 0;

  if (hasIris) {
    const lIris = lmPx(landmarks, LEFT_IRIS_IDX, w, h);
    const rIris = lmPx(landmarks, RIGHT_IRIS_IDX, w, h);
    const lOff = irisOffset(lIris, lmPx(landmarks, LEFT_INNER, w, h), lmPx(landmarks, LEFT_OUTER, w, h));
    const rOff = irisOffset(rIris, lmPx(landmarks, RIGHT_INNER, w, h), lmPx(landmarks, RIGHT_OUTER, w, h));
    horiz = (lOff[0] + rOff[0]) / 2.0;
    vert = (lOff[1] + rOff[1]) / 2.0;
  }

  return { avgEar, isBlink, horiz, vert, hasIris };
}

/** Applies the calibrated neutral baseline + scale factors to get a final gaze zone. */
export function classifyWithCalibration(
  horiz: number,
  vert: number,
  neutralHoriz: number,
  neutralVert: number
): GazeZone {
  const dx = (horiz - neutralHoriz) * H_SCALE;
  const rawDy = vert - neutralVert;
  const scale = rawDy < 0 ? V_SCALE_UP : V_SCALE_DOWN;
  const dy = rawDy * scale;
  return classifyZone(dx, dy);
}

const ALL_ZONES: GazeZone[] = ["ON_CAMERA", "LEFT", "RIGHT", "UP", "DOWN"];

/**
 * Aggregates raw per-frame gaze zones (as produced live by useFaceTracking)
 * into the summary shape scoreEngine.ts needs. Kept separate from the
 * per-frame tracking loop since it only needs to run once, after recording
 * stops — not on every frame.
 */
export function summarizeGazeFrames(frames: { zone: GazeZone }[]): {
  gazeOnScreenPct: number;
  zoneDistribution: Record<GazeZone, number>;
} {
  const total = frames.length || 1;
  const zoneDistribution = Object.fromEntries(
    ALL_ZONES.map((z) => [
      z,
      Math.round((frames.filter((f) => f.zone === z).length / total) * 1000) / 10,
    ])
  ) as Record<GazeZone, number>;

  return { gazeOnScreenPct: zoneDistribution.ON_CAMERA, zoneDistribution };
}
