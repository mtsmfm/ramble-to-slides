/** Microphone capture + voice activity detection. Implemented in audio/recorder.ts. */
export interface RecorderCallbacks {
  /** VAD detected the start of speech. t = seconds since recording start. */
  onSpeechStart(t: number): void;
  /** One finished utterance: Float32 PCM mono 16 kHz, with its time range in seconds since recording start. */
  onUtterance(audio: Float32Array, t0: number, t1: number): void;
  /** No speech for `silenceS` seconds after the last utterance ended (fires once per silence). */
  onPause(t: number, silenceS: number): void;
  /** Fatal problem (mic denied, etc.). */
  onError(message: string): void;
}

export interface Recorder {
  /** Request the mic and start VAD. */
  start(cb: RecorderCallbacks): Promise<void>;
  /** Stop the mic. Resolves with the whole recording as a 16 kHz mono 16-bit WAV. */
  stop(): Promise<Blob>;
  /** Seconds since start() (0 when not recording). */
  readonly elapsed: number;
  readonly recording: boolean;
}

export interface RecorderOptions {
  /** Seconds of silence after speech that count as a pause. Default 4. */
  pauseAfterS?: number;
  /** Force-cut utterances longer than this many seconds (keeps latency bounded). Default 25. */
  maxUtteranceS?: number;
}
