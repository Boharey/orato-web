/**
 * pauseDetection.ts
 * ------------------
 * Finds meaningful pauses by looking at gaps between consecutive words'
 * end/start timestamps. Note: since word timestamps are interpolated within
 * Whisper segments (see whisperTranscriber.ts), gaps WITHIN a segment are
 * synthetic and won't reflect real pauses — this only detects pauses at
 * segment boundaries, which is where Whisper's own silence detection
 * already draws the line. That's actually the right behavior: it means
 * every detected pause here corresponds to real silence Whisper found,
 * not an artifact of the interpolation.
 */

import type { WordTimestamp, PauseMetrics, PauseOccurrence } from "@/types/metrics";

// Gaps shorter than this are normal speech rhythm — only longer gaps
// count as a meaningful, noticeable pause.
export const PAUSE_THRESHOLD_SEC = 0.5;

export function detectPauses(words: WordTimestamp[]): PauseMetrics {
  const occurrences: PauseOccurrence[] = [];

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= PAUSE_THRESHOLD_SEC) {
      occurrences.push({
        start: words[i - 1].end,
        end: words[i].start,
        durationSec: Math.round(gap * 100) / 100,
      });
    }
  }

  const count = occurrences.length;
  const avgPauseDurationSec =
    count > 0
      ? Math.round((occurrences.reduce((s, p) => s + p.durationSec, 0) / count) * 100) / 100
      : 0;
  const longestPauseSec =
    count > 0 ? Math.round(Math.max(...occurrences.map((p) => p.durationSec)) * 100) / 100 : 0;

  return { count, occurrences, avgPauseDurationSec, longestPauseSec };
}
