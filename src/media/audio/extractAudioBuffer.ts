/**
 * extractAudioBuffer.ts
 * ----------------------
 * Decodes the audio track out of a recorded video Blob and resamples it to
 * mono 16kHz Float32 samples — the exact format Whisper expects. Whisper
 * doesn't care about the video track at all; this throws it away entirely.
 */

export const WHISPER_SAMPLE_RATE = 16000;

export async function blobToWhisperAudio(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode at the file's native sample rate first...
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close();

  // ...then render through an OfflineAudioContext at 16kHz mono, which
  // handles both the resample and the stereo-to-mono downmix in one pass.
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE),
    WHISPER_SAMPLE_RATE
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
