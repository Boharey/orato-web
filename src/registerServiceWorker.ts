/**
 * registerServiceWorker.ts
 * -------------------------
 * Production-only, deliberately. A service worker intercepting fetches
 * during `npm run dev` would fight with Vite's hot module reload in
 * confusing ways — import.meta.env.PROD (Vite's built-in flag) keeps
 * this inert entirely in dev.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Non-fatal — the app works fine without offline support, this
      // just means that specific enhancement didn't activate.
      console.warn("Service worker registration failed:", err);
    });
  });
}
