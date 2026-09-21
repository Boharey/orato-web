import { useEffect, useState } from "react";

/**
 * usePrefersReducedMotion.ts
 * ---------------------------
 * Shared across any component with a nontrivial animation (ScoreRing's
 * count-up, Home's hero hover morph) so reduced-motion support doesn't
 * get implemented three slightly-different ways.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setPrefersReduced(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}
