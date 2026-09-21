import { useState } from "react";
import type { ScoredMetric } from "@/types/metrics";

const GRADE_COLOR: Record<ScoredMetric["grade"], string> = {
  excellent: "bg-sage",
  good: "bg-teal",
  fair: "bg-orange",
  needs_work: "bg-orange",
};

// Short "why this matters" text, keyed by the exact label strings
// scoreEngine.ts produces. No automatic link between the two — if a
// metric label ever changes there, this map needs a manual update too.
// Click-to-toggle rather than hover, deliberately: hover doesn't work on
// touch devices, and this needs to work equally well on mobile.
const METRIC_INFO: Record<string, string> = {
  "Filler words":
    "Words like \"um\" and \"uh\" that fill natural pauses. A few are normal — frequent ones can make you sound less prepared or confident.",
  "Vocabulary richness":
    "How varied your word choice was. Repeating the same words often can make speech feel less engaging, even when the content itself is strong.",
  "Speaking pace":
    "How fast you spoke, excluding pauses. Too fast can be hard to follow; too slow can lose an audience's attention.",
  "Speech ratio":
    "How much of the recording was actual speech versus silence. Long pauses can feel like lost momentum, even if they're natural thinking time.",
  "Eye contact":
    "The percentage of time you looked at the camera. In a real conversation or presentation, this is what reads as direct eye contact with your audience.",
};

export default function MetricCard({ metric }: { metric: ScoredMetric }) {
  const [showInfo, setShowInfo] = useState(false);
  const info = METRIC_INFO[metric.label];

  return (
    <div className="rounded-xl border border-teal/10 bg-white/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${GRADE_COLOR[metric.grade]}`} />
          <span className="font-mono text-xs text-teal-dark/50">{metric.label}</span>
        </div>
        {info && (
          <button
            onClick={() => setShowInfo((v) => !v)}
            aria-label={`Why ${metric.label} matters`}
            aria-expanded={showInfo}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-teal-dark/20 font-mono text-[10px] text-teal-dark/40 hover:border-teal-dark/40 hover:text-teal-dark/70"
          >
            i
          </button>
        )}
      </div>
      <div className="mt-1 font-display text-2xl font-bold text-teal-dark">
        {metric.value}
        {metric.unit && (
          <span className="ml-1 text-sm font-normal text-teal-dark/40">{metric.unit}</span>
        )}
      </div>
      {showInfo && info && (
        <p className="mt-2 font-body text-xs leading-relaxed text-teal-dark/60">{info}</p>
      )}
    </div>
  );
}
