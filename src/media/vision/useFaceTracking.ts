/**
 * useFaceTracking.ts
 * ------------------
 * Runs a requestAnimationFrame detection loop against a live <video>
 * element, using gazeMath.ts for the actual math. Mirrors video_analyzer.py's
 * in-video calibration: the first DISCARD_MS are thrown away (letting
 * the user settle), the next CALIB_MS establish a neutral baseline, and
 * every frame after that is classified against it.
 *
 * Calibration timing is elapsed real time (performance.now() deltas), not
 * a tick count — see gazeMath.ts's DISCARD_MS/CALIB_MS comments for why
 * that distinction matters across different display refresh rates and
 * camera capabilities.
 */

import { useCallback, useRef, useState } from "react";
import { getFaceLandmarker } from "@/media/vision/faceLandmarker";
import {
  computeFrameGaze,
  classifyWithCalibration,
  DISCARD_MS,
  CALIB_MS,
  BLINK_DEBOUNCE_MS,
} from "@/media/vision/gazeMath";
import type { GazeFrame, GazeZone, CalibrationBaseline } from "@/types/metrics";

type CalibState = "discarding" | "calibrating" | "tracking";

interface UseFaceTrackingResult {
  isLoading: boolean;
  loadError: string | null;
  currentZone: GazeZone | null;
  calibState: CalibState;
  blinkCount: number;
  gazeFrames: GazeFrame[];
  calibration: CalibrationBaseline;
  startTracking: (video: HTMLVideoElement) => Promise<void>;
  stopTracking: () => void;
}

export function useFaceTracking(): UseFaceTrackingResult {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentZone, setCurrentZone] = useState<GazeZone | null>(null);
  const [calibState, setCalibState] = useState<CalibState>("discarding");
  const [blinkCount, setBlinkCount] = useState(0);

  const rafRef = useRef<number | null>(null);
  const frameNRef = useRef(0);
  const calibBufferRef = useRef<{ horiz: number; vert: number }[]>([]);
  const neutralRef = useRef({ horiz: 0, vert: 0 });
  const blinkStartMsRef = useRef<number | null>(null);
  const blinkCountRef = useRef(0);
  const gazeFramesRef = useRef<GazeFrame[]>([]);
  const startTimeRef = useRef(0);
  const calibStartMsRef = useRef(0);
  const hasFinalizedBaselineRef = useRef(false);

  const stopTracking = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startTracking = useCallback(async (video: HTMLVideoElement) => {
    setIsLoading(true);
    setLoadError(null);

    // Reset all per-session state.
    frameNRef.current = 0;
    calibBufferRef.current = [];
    neutralRef.current = { horiz: 0, vert: 0 };
    blinkStartMsRef.current = null;
    blinkCountRef.current = 0;
    gazeFramesRef.current = [];
    hasFinalizedBaselineRef.current = false;
    setBlinkCount(0);
    setCalibState("discarding");
    setCurrentZone(null);
    startTimeRef.current = performance.now();
    calibStartMsRef.current = performance.now();

    let landmarker;
    try {
      landmarker = await getFaceLandmarker();
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? `Failed to load face model: ${err.message}`
          : "Failed to load face model."
      );
      setIsLoading(false);
      return;
    }
    setIsLoading(false);

    const loop = () => {
      const nowMs = performance.now();
      const result = landmarker.detectForVideo(video, nowMs);
      const w = video.videoWidth;
      const h = video.videoHeight;

      if (result.faceLandmarks.length > 0 && w > 0 && h > 0) {
        const landmarks = result.faceLandmarks[0];
        const frame = computeFrameGaze(landmarks, w, h);

        // Blink debounce — time-based (see BLINK_DEBOUNCE_MS comment in
        // gazeMath.ts), not a tick count.
        if (frame.isBlink) {
          if (blinkStartMsRef.current === null) {
            blinkStartMsRef.current = nowMs;
          }
        } else {
          if (
            blinkStartMsRef.current !== null &&
            nowMs - blinkStartMsRef.current >= BLINK_DEBOUNCE_MS
          ) {
            blinkCountRef.current += 1;
            setBlinkCount(blinkCountRef.current);
          }
          blinkStartMsRef.current = null;
        }

        // Calibration state machine — time-based, not a tick count.
        const elapsedSinceCalibStart = nowMs - calibStartMsRef.current;

        if (elapsedSinceCalibStart < DISCARD_MS) {
          setCalibState("discarding");
        } else if (elapsedSinceCalibStart < DISCARD_MS + CALIB_MS) {
          if (frame.hasIris) {
            calibBufferRef.current.push({ horiz: frame.horiz, vert: frame.vert });
          }
          setCalibState("calibrating");
        } else {
          // Finalize the baseline exactly once — guarded by a REF, not the
          // closed-over calibState value, since `loop` is a stable closure
          // created once per recording session and never sees subsequent
          // setCalibState updates. Using calibState here would silently
          // recompute the same average every tick for the rest of the
          // session — same correct value each time, just wasteful.
          if (!hasFinalizedBaselineRef.current && calibBufferRef.current.length > 0) {
            const buf = calibBufferRef.current;
            neutralRef.current = {
              horiz: buf.reduce((s, c) => s + c.horiz, 0) / buf.length,
              vert: buf.reduce((s, c) => s + c.vert, 0) / buf.length,
            };
            hasFinalizedBaselineRef.current = true;
          }
          setCalibState("tracking");
          if (frame.hasIris && !frame.isBlink) {
            const zone = classifyWithCalibration(
              frame.horiz,
              frame.vert,
              neutralRef.current.horiz,
              neutralRef.current.vert
            );
            setCurrentZone(zone);
            gazeFramesRef.current.push({
              frame: frameNRef.current,
              time: (nowMs - startTimeRef.current) / 1000,
              zone,
            });
          }
        }
      }

      frameNRef.current += 1;
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calibration: CalibrationBaseline = {
    neutralHoriz: neutralRef.current.horiz,
    neutralVert: neutralRef.current.vert,
    neutralYaw: 0, // head-pose calibration not wired up yet — later step
    neutralPitch: 0,
    calibrated: calibState === "tracking",
  };

  return {
    isLoading,
    loadError,
    currentZone,
    calibState,
    blinkCount,
    gazeFrames: gazeFramesRef.current,
    calibration,
    startTracking,
    stopTracking,
  };
}
