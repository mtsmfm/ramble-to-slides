/**
 * Microphone capture + Silero VAD (via @ricky0123/vad-web, running in an AudioWorklet).
 * Emits finished utterances as Float32 16 kHz PCM and keeps the full recording for the WAV.
 */
import { MicVAD } from "@ricky0123/vad-web";
import type { Recorder, RecorderCallbacks, RecorderOptions } from "./types";

const SAMPLE_RATE = 16000;
// vad-web serves its worklet + silero model from baseAssetPath, and onnxruntime-web's wasm from onnxWASMBasePath.
// scripts/copy-vad-assets.mjs copies both into public/vad/.
const ASSET_BASE = new URL("./vad/", document.baseURI).href;

function pcm16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav(chunks: Int16Array[], totalSamples: number): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const dataBytes = totalSamples * 2;
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Blob([header, ...chunks.map((c) => c.buffer as ArrayBuffer)], { type: "audio/wav" });
}

export function createRecorder(opts: RecorderOptions = {}): Recorder {
  const pauseAfterS = opts.pauseAfterS ?? 4;
  // Long monologues never hit the VAD's silence threshold, so cut them ourselves:
  // preferably at a quiet frame after SOFT_CUT_S, unconditionally at maxUtteranceS.
  const maxUtteranceS = opts.maxUtteranceS ?? 25;
  const SOFT_CUT_S = Math.min(15, maxUtteranceS);
  let vad: MicVAD | null = null;
  let samples = 0; // frames seen so far (timeline)
  let speaking = false;
  let lastSpeechEnd: number | null = null;
  let pauseSent = false;
  let chunks: Int16Array[] = [];
  let recording = false;
  // Frames of the utterance in progress (only kept while speaking), for forced cuts.
  let speechBuf: Float32Array[] = [];
  let speechBufSamples = 0;
  let cutStartT = 0; // timeline position where the current (possibly cut) utterance began
  let emittedSamples = 0; // samples of the current VAD segment already emitted by forced cuts

  const now = () => samples / SAMPLE_RATE;

  function forceCut(cb: RecorderCallbacks) {
    if (speechBufSamples === 0) return;
    const audio = new Float32Array(speechBufSamples);
    let off = 0;
    for (const f of speechBuf) { audio.set(f, off); off += f.length; }
    speechBuf = [];
    speechBufSamples = 0;
    emittedSamples += audio.length;
    const t1 = now();
    cb.onUtterance(audio, cutStartT, t1);
    cutStartT = t1;
  }

  return {
    get elapsed() {
      return recording ? now() : 0;
    },
    get recording() {
      return recording;
    },

    async start(cb: RecorderCallbacks) {
      if (vad) throw new Error("already recording");
      samples = 0;
      speaking = false;
      lastSpeechEnd = null;
      pauseSent = false;
      chunks = [];
      try {
        vad = await MicVAD.new({
          model: "v5",
          baseAssetPath: ASSET_BASE,
          onnxWASMBasePath: ASSET_BASE,
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 700, // silence that ends an utterance
          preSpeechPadMs: 300,
          minSpeechMs: 400,
          submitUserSpeechOnPause: true,
          additionalAudioConstraints: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          onFrameProcessed: (p, frame) => {
            chunks.push(pcm16(frame));
            samples += frame.length;
            if (speaking) {
              speechBuf.push(frame);
              speechBufSamples += frame.length;
              const dur = now() - cutStartT;
              if (dur >= maxUtteranceS || (dur >= SOFT_CUT_S && p.isSpeech < 0.3)) forceCut(cb);
            }
            if (!speaking && lastSpeechEnd !== null && !pauseSent) {
              const silence = now() - lastSpeechEnd;
              if (silence >= pauseAfterS) {
                pauseSent = true;
                cb.onPause(now(), silence);
              }
            }
          },
          onSpeechStart: () => {
            speaking = true;
            pauseSent = false;
            speechBuf = [];
            speechBufSamples = 0;
            emittedSamples = 0;
            cutStartT = now();
            cb.onSpeechStart(now());
          },
          onVADMisfire: () => {
            speaking = false;
            speechBuf = [];
            speechBufSamples = 0;
          },
          onSpeechEnd: (audio) => {
            speaking = false;
            speechBuf = [];
            speechBufSamples = 0;
            const t1 = now();
            lastSpeechEnd = t1;
            // vad-web hands back the whole segment (with pre-pad); drop what forced cuts already emitted.
            const rest = emittedSamples > 0 ? audio.subarray(Math.min(audio.length, emittedSamples)) : audio;
            emittedSamples = 0;
            if (rest.length < SAMPLE_RATE * 0.4) return;
            const t0 = Math.max(0, t1 - rest.length / SAMPLE_RATE);
            cb.onUtterance(rest.slice(), t0, t1);
          },
        } as Parameters<typeof MicVAD.new>[0]);
        await vad.start();
        recording = true;
      } catch (e) {
        vad = null;
        cb.onError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },

    async stop() {
      if (vad) {
        try {
          await vad.pause(); // flushes the current utterance via submitUserSpeechOnPause
        } finally {
          vad.destroy();
          vad = null;
        }
      }
      recording = false;
      return encodeWav(chunks, samples);
    },
  };
}
