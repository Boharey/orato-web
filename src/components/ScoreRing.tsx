import { useEffect, useState } from "react";
import { scoreColor } from "@/lib/scoreColor";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

interface ScoreRingProps {
  score: number; // 0-100
  size?: number;
}

const ANIMATION_MS = 900;

export default function ScoreRing({ score, size = 160 }: ScoreRingProps) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const color = scoreColor(clamped);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Drives both the number and the ring fill together via rAF — the
  // previous CSS `transition` on strokeDashoffset never actually animated
  // on mount, since React set the final value on the very first render
  // with nothing prior for the transition to animate from. This fixes
  // that and adds the count-up at the same time, since both need the
  // same underlying "animated progress" value.
  const [displayValue, setDisplayValue] = useState(prefersReducedMotion ? clamped : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayValue(clamped);
      return;
    }

    let rafId: number;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayValue(Math.round(eased * clamped));
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [clamped, prefersReducedMotion]);

  const offset = circumference * (1 - displayValue / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#2E4F4F1A"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-bold text-teal-dark">{displayValue}</span>
        <span className="font-mono text-xs text-teal-dark/40">/ 100</span>
      </div>
    </div>
  );
}
