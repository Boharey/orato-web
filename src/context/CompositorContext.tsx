/**
 * CompositorContext.tsx
 * -----------------------
 * Lives ABOVE the router (see App.tsx), not inside Practice.tsx, for one
 * specific reason: video composition is the slowest step in the pipeline
 * (it plays back in real time), and it shouldn't block the person from
 * seeing their score — which is ready much earlier, right after
 * transcription finishes.
 *
 * composeFinalVideo() itself doesn't depend on React's component tree —
 * it creates its own detached <video>/<canvas> elements and drives them
 * with requestAnimationFrame — so it keeps running correctly even if the
 * component that started it (Practice) unmounts because the person
 * navigated to Results. This context just gives Results a place to
 * subscribe to that ongoing progress instead of only reading a static,
 * already-finished result.
 *
 * Known limitation: this holds ONE compositor job at a time, matching the
 * app's existing single-session, no-persistence design. If the person
 * starts a new recording (Practice again) before the previous video
 * finished, the new job overwrites this context's state — there's no
 * per-session tracking. Worth revisiting only if multi-session history
 * gets built later.
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { composeFinalVideo } from "@/media/compositor/composeFinalVideo";
import type { OverlayContext } from "@/media/compositor/drawOverlays";

export type CompositorStatus = "idle" | "composing" | "done" | "error";

interface CompositorContextValue {
  status: CompositorStatus;
  progress: number;
  error: string | null;
  resultUrl: string | null;
  resultMimeType: string | null;
  startComposing: (recordedBlob: Blob, overlay: OverlayContext, sourceFrameRate?: number | null) => void;
  resetCompositor: () => void;
}

const CompositorContext = createContext<CompositorContextValue | null>(null);

export function CompositorProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CompositorStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultMimeType, setResultMimeType] = useState<string | null>(null);

  // Invalidates stale in-flight compose jobs. Necessary because "Record
  // again" is deliberately reachable WHILE a previous compose is still
  // running (that's the whole point of decoupling results from video
  // generation) — so a reset can't just flip status back to "idle" and
  // call it done; the old job's promise is still out there and will
  // eventually resolve. Each compose call captures the generation it
  // started with; if that no longer matches the current generation by
  // the time it resolves, its result is stale and gets discarded instead
  // of overwriting a newer session's state.
  const generationRef = useRef(0);

  const startComposing = useCallback(
    (recordedBlob: Blob, overlay: OverlayContext, sourceFrameRate?: number | null) => {
      const myGeneration = ++generationRef.current;

      setStatus("composing");
      setProgress(0);
      setError(null);
      setResultUrl(null);
      setResultMimeType(null);

      composeFinalVideo(
        recordedBlob,
        overlay,
        (pct) => {
          if (myGeneration === generationRef.current) setProgress(pct);
        },
        sourceFrameRate
      )
        .then(({ url, mimeType }) => {
          if (myGeneration !== generationRef.current) {
            // A newer session started (new recording, or an explicit
            // reset) while this was still composing. Discard rather
            // than overwrite — and revoke the now-unwanted blob URL so
            // it doesn't leak.
            URL.revokeObjectURL(url);
            return;
          }
          setResultUrl(url);
          setResultMimeType(mimeType);
          setStatus("done");
        })
        .catch((err) => {
          if (myGeneration !== generationRef.current) return; // stale, ignore
          // Deliberately does NOT throw or bubble up — a failed video
          // composite should never take the score/transcript/feedback down
          // with it. This is the whole point of the isolation this context
          // provides.
          setError(err instanceof Error ? err.message : "Failed to create annotated video.");
          setStatus("error");
        });
    },
    []
  );

  // Called when a new recording session starts (see Practice.tsx's
  // recordAgain wiring). Bumps the generation so any still-in-flight
  // compose job from the PREVIOUS take becomes a no-op when it resolves,
  // and clears visible state immediately so the old video doesn't keep
  // looking like a current, valid result.
  const resetCompositor = useCallback(() => {
    generationRef.current += 1;
    setStatus("idle");
    setProgress(0);
    setError(null);
    setResultMimeType(null);
    setResultUrl((prevUrl) => {
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      return null;
    });
  }, []);

  return (
    <CompositorContext.Provider
      value={{ status, progress, error, resultUrl, resultMimeType, startComposing, resetCompositor }}
    >
      {children}
    </CompositorContext.Provider>
  );
}

export function useCompositorContext(): CompositorContextValue {
  const ctx = useContext(CompositorContext);
  if (!ctx) {
    throw new Error("useCompositorContext must be used within a CompositorProvider");
  }
  return ctx;
}
