/**
 * coachFeedback.ts
 * -----------------
 * Generates short, actionable feedback purely from the scored metrics —
 * no LLM call, since there's no backend to make one from. This is
 * intentionally template-based rather than trying to sound "smart"; a
 * flat, honest rule engine that's clearly labeled as such is more
 * trustworthy than feedback that pretends to be more insightful than it is.
 *
 * If a backend LLM feedback service gets added later, this becomes the
 * fallback for when that call fails or before it resolves — not something
 * to throw away.
 */

import type { ScoreBreakdown, ScoredMetric } from "@/types/metrics";

const TIPS: Record<string, string> = {
  "Filler words":
    "Try pausing silently instead of saying \"um\" or \"like\" — a brief silence reads as confidence, not hesitation.",
  "Vocabulary richness":
    "Mix in more varied word choices instead of repeating the same terms — swapping a few nouns or verbs each rehearsal helps.",
  "Speaking pace":
    "Aim for a steady, conversational pace — not rushed, not dragging. Recording and listening back is the fastest way to feel this.",
  "Speech ratio":
    "Long stretches of silence can feel like a lost train of thought — outlining key points beforehand helps transitions feel natural.",
  "Eye contact":
    "Try returning your gaze to the camera lens itself (not the screen) between glances at notes — it reads as direct eye contact.",
};

const PRAISE: Record<string, string> = {
  "Filler words": "Your speech was refreshingly free of filler words.",
  "Vocabulary richness": "You used a strong range of vocabulary — nothing felt repetitive.",
  "Speaking pace": "Your pace was well-controlled and easy to follow.",
  "Speech ratio": "You kept a steady flow with minimal dead air.",
  "Eye contact": "You maintained excellent eye contact with the camera.",
};

function gradeRank(g: ScoredMetric["grade"]): number {
  switch (g) {
    case "excellent":
      return 3;
    case "good":
      return 2;
    case "fair":
      return 1;
    case "needs_work":
      return 0;
  }
}

export interface CoachFeedbackItem {
  type: "praise" | "tip";
  text: string;
}

export function generateCoachFeedback(score: ScoreBreakdown): CoachFeedbackItem[] {
  const items: CoachFeedbackItem[] = [];

  const best = [...score.metrics].sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade))[0];
  if (best && gradeRank(best.grade) >= 2 && PRAISE[best.label]) {
    items.push({ type: "praise", text: PRAISE[best.label] });
  }

  const weakest = score.metrics
    .filter((m) => gradeRank(m.grade) <= 1)
    .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))
    .slice(0, 2);

  for (const m of weakest) {
    if (TIPS[m.label]) items.push({ type: "tip", text: TIPS[m.label] });
  }

  if (items.length === 0) {
    items.push({
      type: "praise",
      text: "Solid session across the board — keep practicing to build consistency.",
    });
  }

  return items;
}
