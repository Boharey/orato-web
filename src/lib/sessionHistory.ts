/**
 * sessionHistory.ts
 * ------------------
 * Lightweight session history stored in localStorage — NOT the full
 * SessionResult (transcript, gaze frames, video), just enough to show a
 * "your progress over time" view: score + when. Deliberately small and
 * disposable — this doesn't replace real persistence, it just stops
 * every refresh from losing everything, per the known limitation noted
 * repeatedly in UNDERSTANDING.md.
 */

import type { ScoreBreakdown } from "@/types/metrics";

const STORAGE_KEY = "orato_session_history";
const MAX_ENTRIES = 10;

export interface SessionHistoryEntry {
  recordedAt: string; // ISO timestamp
  combinedScore: number;
  audioScore: number;
  eyeContactMultiplier: number;
  durationSec: number;
}

function readHistory(): SessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted data, private browsing, storage disabled, quota issues —
    // fail quietly and behave as if there's no history yet. This is a
    // nice-to-have feature; it should never be able to break the results
    // page over a storage quirk.
    return [];
  }
}

export function getSessionHistory(): SessionHistoryEntry[] {
  return readHistory().sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  );
}

export function saveSessionToHistory(
  score: ScoreBreakdown,
  recordedAt: string,
  durationSec: number
): void {
  try {
    const history = readHistory();
    const entry: SessionHistoryEntry = {
      recordedAt,
      combinedScore: score.combinedScore,
      audioScore: score.audioScore,
      eyeContactMultiplier: score.eyeContactMultiplier,
      durationSec,
    };
    const updated = [entry, ...history].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage full/disabled — silently skip saving rather than breaking
    // the results page over a non-essential feature.
  }
}

export function clearSessionHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
