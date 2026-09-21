import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import ScoreRing from "@/components/ScoreRing";
import MetricCard from "@/components/MetricCard";
import CoachFeedback from "@/components/CoachFeedback";
import { generateCoachFeedback } from "@/lib/coachFeedback";
import { useCompositorContext } from "@/context/CompositorContext";
import { mimeTypeToExtension } from "@/media/compositor/composeFinalVideo";
import {
  getSessionHistory,
  saveSessionToHistory,
  clearSessionHistory,
  type SessionHistoryEntry,
} from "@/lib/sessionHistory";
import { scoreColor } from "@/lib/scoreColor";
import { downloadTextFile } from "@/lib/downloadTextFile";
import { SCENARIOS } from "@/lib/scenarios";
import type { SessionResult } from "@/types/metrics";

export default function Results() {
  const location = useLocation();
  const result = location.state as SessionResult | null;
  // Live compositor state — this is what makes the video section update
  // on its own once composition finishes, independent of whatever data
  // was available at the moment of navigation. Same context Practice.tsx
  // started composing into; it kept running regardless of the navigation.
  const compositor = useCompositorContext();

  // Save this session to local history exactly once per mount — the ref
  // guard prevents a duplicate save under React StrictMode's dev-only
  // double-invoke of effects, and on any re-render this effect's deps
  // don't change anyway.
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const hasSavedRef = useRef(false);

  useEffect(() => {
    if (!result || hasSavedRef.current) return;
    hasSavedRef.current = true;
    saveSessionToHistory(result.score, result.recordedAt, result.durationSec);
    setHistory(getSessionHistory());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const handleClearHistory = () => {
    clearSessionHistory();
    setHistory([]);
  };

  const [transcriptCopied, setTranscriptCopied] = useState(false);

  const handleCopyTranscript = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.audio.transcription.text);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 1500);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — fail
      // quietly rather than showing an alarming error for a minor feature.
    }
  };

  const handleDownloadTranscript = () => {
    if (!result) return;
    downloadTextFile("orato-transcript.txt", result.audio.transcription.text);
  };

  // No backend/persistence yet, so results only exist via direct navigation
  // from a just-finished Practice session (passed as router state). A
  // refresh or a direct link here loses that state — handle it gracefully
  // rather than crashing on undefined fields.
  if (!result) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-teal-dark">No session data</h1>
        <p className="mt-3 font-body text-sm text-teal-dark/60">
          Results only exist right after finishing a practice session — sessions aren't saved yet,
          so a refresh or a direct link here won't have anything to show.
        </p>
        <Link
          to="/practice"
          className="mt-6 inline-block rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
        >
          Start a practice session
        </Link>
      </div>
    );
  }

  const feedback = generateCoachFeedback(result.score);
  const practicedScenario = result.scenarioId
    ? SCENARIOS.find((s) => s.id === result.scenarioId)
    : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-center font-display text-3xl font-bold text-teal-dark">Your results</h1>
      {practicedScenario && (
        <p className="mt-2 text-center font-mono text-xs text-teal-dark/50">
          Prompt: {practicedScenario.title}
        </p>
      )}

      <div className="mt-10 flex flex-col items-center px-4">
        <ScoreRing score={result.score.combinedScore} />
        <p className="mt-3 text-center font-mono text-xs leading-relaxed text-teal-dark/40">
          audio {result.score.audioScore}
          <span className="mx-1">×</span>
          eye-contact multiplier {result.score.eyeContactMultiplier}
        </p>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {result.score.metrics.map((m) => (
          <MetricCard key={m.label} metric={m} />
        ))}
      </div>

      <div className="mt-8">
        <CoachFeedback items={feedback} />
      </div>

      {/* Progress history — local device only, purely a nice-to-have.
          Only shown once there's more than just this single session,
          since one data point isn't really "progress". */}
      {history.length > 1 && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/50 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
              Your progress
            </h2>
            <button
              onClick={handleClearHistory}
              className="font-mono text-[10px] text-teal-dark/40 underline hover:text-teal-dark/70"
            >
              Clear local history
            </button>
          </div>
          <p className="mt-1 font-mono text-xs text-teal-dark/40">
            Stored only on this device — last {history.length} session
            {history.length === 1 ? "" : "s"}.
          </p>
          <div className="mt-4 space-y-2">
            {history.map((h) => (
              <div key={h.recordedAt} className="flex items-center gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-teal-dark/50">
                  {new Date(h.recordedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-teal/10">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(4, h.combinedScore)}%`,
                      backgroundColor: scoreColor(h.combinedScore),
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold text-teal-dark">
                  {h.combinedScore}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video section reads LIVE compositor state, not a static field from
          when the page loaded — this is the actual fix for the slow-step
          problem. Score/metrics/feedback above are already complete and
          rendered; this section updates independently once the video
          catches up, and a failure here never affects anything above it. */}
      {compositor.status === "composing" && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/50 p-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
            Your annotated recording
          </h2>
          <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-xl bg-teal-dark/5">
            <div className="text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-orange border-t-transparent" />
              <p className="mt-3 font-mono text-xs text-teal-dark/50">
                Generating your annotated video — {compositor.progress}%
              </p>
            </div>
          </div>
        </div>
      )}

      {compositor.status === "done" && compositor.resultUrl && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/50 p-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
            Your annotated recording
          </h2>
          <p className="mt-1 font-mono text-xs text-teal-dark/40">
            Gaze zone + filler-word captions overlaid — watch back to see exactly where they
            happened.
          </p>
          <video src={compositor.resultUrl} controls className="mt-4 w-full rounded-xl" />
          <a
            href={compositor.resultUrl}
            download={`orato-practice-session.${
              compositor.resultMimeType ? mimeTypeToExtension(compositor.resultMimeType) : "webm"
            }`}
            className="mt-4 inline-block rounded-full border border-teal/20 px-6 py-3 font-body font-semibold text-teal-dark hover:bg-teal/5"
          >
            Download video
          </a>
        </div>
      )}

      {compositor.status === "error" && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/50 p-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
            Your annotated recording
          </h2>
          <p className="mt-3 font-body text-sm text-orange">
            Video generation failed — your score and transcript above are unaffected. (
            {compositor.error})
          </p>
        </div>
      )}

      {result.audio.transcription.text && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/50 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
              Transcript
            </h2>
            <div className="flex gap-3">
              <button
                onClick={handleCopyTranscript}
                className="font-mono text-[10px] text-teal-dark/50 underline hover:text-teal-dark/80"
              >
                {transcriptCopied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={handleDownloadTranscript}
                className="font-mono text-[10px] text-teal-dark/50 underline hover:text-teal-dark/80"
              >
                Download .txt
              </button>
            </div>
          </div>
          <p className="mt-3 font-body text-sm text-teal-dark/80">
            {result.audio.transcription.text}
          </p>
        </div>
      )}

      <div className="mt-10 flex justify-center gap-3">
        <Link
          to="/practice"
          className="rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
        >
          Practice again
        </Link>
        <Link
          to="/"
          className="rounded-full border border-teal/20 px-6 py-3 font-body font-semibold text-teal-dark hover:bg-teal/5"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
