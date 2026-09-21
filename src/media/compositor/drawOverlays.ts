/**
 * drawOverlays.ts
 * ----------------
 * Pure canvas-drawing functions — given a timestamp and the session's
 * gaze/transcript data, draws what should appear on screen at that instant.
 * No video/recording logic here; composeFinalVideo.ts owns the playback
 * loop and calls this once per frame.
 */

import type { GazeFrame, GazeZone, WordTimestamp, FillerOccurrence } from "@/types/metrics";

// Displayed as a simple binary, matching Practice.tsx's live overlay —
// ON_CAMERA reads "Focus: On" (sage/green), every other direction reads
// "Focus: Off" (orange/red). The underlying per-frame zone data (still
// LEFT/RIGHT/UP/DOWN/ON_CAMERA) is untouched — this only changes what's
// drawn on screen, not what's measured or scored.
const SAGE = "#7FA69A";
const ORANGE = "#FF6B35";

function isFocusOn(zone: GazeZone): boolean {
  return zone === "ON_CAMERA";
}

const CAPTION_WINDOW_WORDS = 10;

export interface OverlayContext {
  gazeFrames: GazeFrame[];
  words: WordTimestamp[];
  fillers: FillerOccurrence[];
}

/** Linear scan is fine at the frame counts a short practice clip produces;
 * revisit with a binary search only if compositing starts feeling slow on
 * longer recordings. */
function findNearestGazeZone(gazeFrames: GazeFrame[], t: number): GazeZone | null {
  if (gazeFrames.length === 0) return null;
  let nearest = gazeFrames[0];
  for (const f of gazeFrames) {
    if (f.time > t) break;
    nearest = f;
  }
  return nearest.zone;
}

function isFillerWord(word: WordTimestamp, fillers: FillerOccurrence[]): boolean {
  return fillers.some((f) => word.start >= f.start && word.start < f.end);
}

export function drawOverlayFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentTime: number,
  overlay: OverlayContext
) {
  // ── Gaze badge, top-left — same visual language as the live recording overlay ──
  const zone = findNearestGazeZone(overlay.gazeFrames, currentTime);
  if (zone) {
    const focusOn = isFocusOn(zone);
    const badgeText = `Focus: ${focusOn ? "On" : "Off"}`;
    ctx.font = "600 16px 'IBM Plex Mono', monospace";
    const textWidth = ctx.measureText(badgeText).width;
    const pad = 10;
    const badgeW = textWidth + pad * 2 + 18;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(16, 16, badgeW, 34);

    ctx.fillStyle = focusOn ? SAGE : ORANGE;
    ctx.beginPath();
    ctx.arc(16 + pad + 5, 16 + 17, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(badgeText, 16 + pad + 18, 16 + 22);
  }

  // ── Rolling caption, bottom-center — last N spoken words, fillers highlighted ──
  const spoken = overlay.words.filter((w) => w.start <= currentTime);
  const windowWords = spoken.slice(-CAPTION_WINDOW_WORDS);
  if (windowWords.length === 0) return;

  const fontSize = Math.max(16, Math.round(width / 45));
  ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
  ctx.textBaseline = "alphabetic";

  const lineText = windowWords.map((w) => w.word).join(" ");
  const totalTextWidth = ctx.measureText(lineText).width;
  const boxHeight = fontSize + 24;
  const boxY = height - boxHeight - 20;
  // Clamped to canvas width — if the caption line is wider than this, text
  // will overflow the box edges rather than wrap. Known limitation for a
  // first pass; fine at 10-word windows on typical recording resolutions.
  const boxWidth = Math.min(width - 40, totalTextWidth + 40);
  const boxX = (width - boxWidth) / 2;

  ctx.fillStyle = "rgba(27,43,43,0.75)"; // teal-dark, translucent
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  let cursorX = boxX + 20;
  const textY = boxY + boxHeight / 2 + fontSize / 3;
  for (const w of windowWords) {
    const wordText = w.word + " ";
    ctx.fillStyle = isFillerWord(w, overlay.fillers) ? "#FF6B35" : "#FAF7F2";
    ctx.fillText(wordText, cursorX, textY);
    cursorX += ctx.measureText(wordText).width;
  }
}
