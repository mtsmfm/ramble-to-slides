/**
 * @ricky0123/vad-web loads its AudioWorklet and the Silero model over HTTP, and
 * onnxruntime-web loads its wasm the same way. Vite only serves what is in public/,
 * so copy all of it into public/vad/ (flat) before dev / build.
 *
 * The recorder points both baseAssetPath and onnxWASMBasePath at "./vad/".
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(appRoot, "public", "vad");

const VAD_FILES = ["silero_vad_v5.onnx", "vad.worklet.bundle.min.js"];
const ORT_FILE = /^ort-wasm-simd-threaded\.(wasm|mjs)$/;

function vadDist() {
  const pkg = require.resolve("@ricky0123/vad-web/package.json");
  return join(dirname(pkg), "dist");
}

/** onnxruntime-web is a dependency of vad-web, not of this app: resolve it from there. */
function ortDist(vadDir) {
  const candidates = [];
  try {
    const fromVad = createRequire(join(vadDir, "package.json"));
    candidates.push(dirname(fromVad.resolve("onnxruntime-web/package.json")));
  } catch {
    /* the "exports" field can make package.json unresolvable */
  }
  candidates.push(join(vadDir, "node_modules", "onnxruntime-web"));
  candidates.push(join(appRoot, "node_modules", "onnxruntime-web"));

  const pnpm = join(appRoot, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm).filter((d) => d.startsWith("onnxruntime-web@")).sort()) {
      candidates.push(join(pnpm, entry, "node_modules", "onnxruntime-web"));
    }
  }

  for (const dir of candidates) {
    const dist = join(dir, "dist");
    if (existsSync(dist)) return dist;
  }
  throw new Error(
    "onnxruntime-web not found. Run pnpm install (it is a dependency of @ricky0123/vad-web).",
  );
}

function copy(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return false;
  cpSync(from, to, { force: true });
  return true;
}

const vadDir = dirname(require.resolve("@ricky0123/vad-web/package.json"));
const dist = vadDist();
const ort = ortDist(vadDir);

mkdirSync(outDir, { recursive: true });

let copied = 0;
let skipped = 0;

for (const name of VAD_FILES) {
  const from = join(dist, name);
  if (!existsSync(from)) {
    console.warn(`[vad-assets] not found: ${name}`);
    continue;
  }
  if (copy(from, join(outDir, name))) copied += 1;
  else skipped += 1;
}

for (const name of readdirSync(ort).filter((f) => ORT_FILE.test(f))) {
  if (copy(join(ort, name), join(outDir, name))) copied += 1;
  else skipped += 1;
}

console.log(`[vad-assets] copied ${copied} file(s) into public/vad/ (${skipped} already up to date)`);
