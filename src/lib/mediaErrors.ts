/**
 * mediaErrors.ts
 * ---------------
 * getUserMedia() failures are DOMExceptions with standardized `.name`
 * values — but the raw browser message text ("Permission denied" or
 * similar) doesn't tell a non-technical visitor what to actually DO
 * about it. This maps each known failure to a concrete next step.
 */

export function friendlyMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera/mic access was blocked. Check your browser's site settings (usually an icon just left of the address bar) and allow camera + microphone for this site, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found. Make sure one is connected and isn't disabled in your system settings.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera or mic couldn't be started — it might already be in use by another app (like a video call). Close anything else using it and try again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Your camera doesn't support the settings this needs. If you have another camera, try switching to it.";
    case "SecurityError":
      return "Camera/mic access needs a secure connection (https) — this won't work over plain http.";
    case "AbortError":
      return "Starting the camera/mic was interrupted. Try again.";
    default:
      return err instanceof Error
        ? `Could not access camera or microphone: ${err.message}`
        : "Could not access camera or microphone.";
  }
}
