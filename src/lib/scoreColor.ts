/**
 * scoreColor.ts
 * --------------
 * Single source of truth for score -> color mapping, so ScoreRing and
 * any other score visualization (e.g. the progress history bars) stay
 * visually consistent instead of each defining their own thresholds.
 */

export function scoreColor(score: number): string {
  if (score >= 80) return "#7FA69A"; // sage — excellent
  if (score >= 65) return "#2E4F4F"; // teal — good
  return "#FF6B35"; // orange — fair/needs work
}
