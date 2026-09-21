/**
 * InstallPromptContext.tsx
 * --------------------------
 * Captures the browser's `beforeinstallprompt` event so an in-app button
 * can trigger the install flow on demand, instead of relying on people
 * noticing the small native install icon in the address bar (most don't).
 *
 * Lives above the router, same pattern as CompositorContext — the event
 * can fire at any point during page load, well before any specific page
 * component mounts, so it needs a home that persists regardless of which
 * route is currently showing.
 *
 * Firefox and Safari don't support this event or the underlying install
 * flow at all — `canInstall` simply stays false there. That's correct
 * behavior, not a gap to work around.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// Not a standard DOM lib type (still experimental/Chromium-specific),
// hence the manual interface rather than relying on a built-in one.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface InstallPromptContextValue {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
}

const InstallPromptContext = createContext<InstallPromptContextValue | null>(null);

export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevents the browser's own default mini-infobar — we control
      // exactly when/how the install offer appears instead (the banner).
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredEvent(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    try {
      await deferredEvent.prompt();
      // A captured beforeinstallprompt event can only be used once —
      // accepted or dismissed, it's spent either way, so clear it
      // regardless of the outcome rather than trying to reuse it.
      await deferredEvent.userChoice;
    } catch {
      // Non-critical — the app works fine without install support, this
      // just means that specific offer didn't complete.
    } finally {
      setDeferredEvent(null);
    }
  }, [deferredEvent]);

  return (
    <InstallPromptContext.Provider
      value={{ canInstall: !!deferredEvent && !installed, promptInstall }}
    >
      {children}
    </InstallPromptContext.Provider>
  );
}

export function useInstallPrompt(): InstallPromptContextValue {
  const ctx = useContext(InstallPromptContext);
  if (!ctx) {
    throw new Error("useInstallPrompt must be used within an InstallPromptProvider");
  }
  return ctx;
}
