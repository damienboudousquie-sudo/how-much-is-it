/**
 * At most `max` actions per key in a sliding window. Kept in memory: a restart forgets it,
 * which is fine for slowing down abuse. Past `maxKeys` visitors the oldest are dropped.
 */
export function createLimiter(max: number, windowMs: number, maxKeys = 10_000): (key: string) => boolean {
  const recent = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const times = (recent.get(key) ?? []).filter((at) => now - at < windowMs);
    if (times.length >= max) {
      recent.set(key, times);
      return false;
    }
    times.push(now);
    // Re-inserting keeps the Map in least-recently-used order.
    recent.delete(key);
    recent.set(key, times);
    for (const old of recent.keys()) {
      if (recent.size <= maxKeys) break;
      recent.delete(old);
    }
    return true;
  };
}
