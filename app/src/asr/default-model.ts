/**
 * Which whisper model a new project starts with.
 *
 * Order: a choice the user (or the agent) made earlier on this device, remembered in
 * localStorage; otherwise a quick guess from the hardware. The guess only looks at WebGPU:
 * without it nothing is guessed (see detectAsrModel), and on integrated / mobile GPUs the
 * large model is usually too slow so the small one is picked. Anything unknown gets the
 * accurate model; the choice is easy to change in the project settings.
 */
import { isAsrModel, type AsrModel } from "./types";

const STORAGE_KEY = "rts.asrModel";

// Minimal shapes of the WebGPU API we touch (the project does not ship @webgpu/types).
interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
}
interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

export function rememberedAsrModel(): AsrModel | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isAsrModel(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberAsrModel(model: AsrModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch {
    /* private mode etc.: the choice still applies to this page load */
  }
}

/** Integrated and mobile GPUs, as reported by GPUAdapterInfo (lower-cased). */
const WEAK_GPU = /\b(intel|mali|adreno|valhall|bifrost|powervr|videocore|swiftshader|llvmpipe|lavapipe)\b|^gen-?\d|^xe-?lp/;

/**
 * Hardware-based guess. Never throws; resolves within a few milliseconds.
 * null when there is no WebGPU adapter: whisper would run on WASM (too slow to be useful) and the
 * alternative is the browser's recognizer, which sends audio elsewhere or needs Chrome — a choice
 * the user must make, not a guess.
 */
export async function detectAsrModel(): Promise<AsrModel | null> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) return null;
  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return null;
  const info = adapter.info ?? {};
  const desc = [info.vendor, info.architecture, info.device, info.description]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase();
  return WEAK_GPU.test(desc) ? "small" : "turbo";
}

/** The remembered choice if there is one, otherwise the hardware guess (null = the user has to choose). */
export async function defaultAsrModel(): Promise<AsrModel | null> {
  return rememberedAsrModel() ?? (await detectAsrModel());
}
