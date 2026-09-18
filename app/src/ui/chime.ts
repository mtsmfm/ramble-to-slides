/** Short two-note chime (Web Audio, no asset) played when the agent posts a question. */
let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    for (const [freq, at] of [[880, 0], [1320, 0.14]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + at);
      gain.gain.linearRampToValueAtTime(0.25, t + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.4);
    }
  } catch (e) {
    console.warn("chime failed", e);
  }
}
