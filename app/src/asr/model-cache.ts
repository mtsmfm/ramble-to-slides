/**
 * The whisper model files transformers.js downloaded (Cache API, "transformers-cache").
 * Deleting them frees the disk; a model already in memory keeps working until the next load.
 */
const CACHE_NAME = "transformers-cache";

/** Bytes used by the cached model files, or null when the Cache API is unavailable. */
export async function modelCacheBytes(): Promise<number | null> {
  try {
    if (!(await caches.has(CACHE_NAME))) return 0;
    const cache = await caches.open(CACHE_NAME);
    let total = 0;
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const len = Number(res.headers.get("content-length"));
      total += Number.isFinite(len) && len > 0 ? len : (await res.arrayBuffer()).byteLength;
    }
    return total;
  } catch {
    return null;
  }
}

export async function clearModelCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
