/** Diferença de contadores cumulativos. Reinício não vira um pico falso. */
export function diffCounter(
  current: number | null,
  previous: number | null,
): { delta: number | null; reset: boolean } {
  if (current === null || previous === null) return { delta: null, reset: false };
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { delta: null, reset: false };
  if (current < previous) return { delta: null, reset: true };
  return { delta: current - previous, reset: false };
}

/** Taxa por segundo. Intervalo inválido ou divisão por zero devolve null, não zero. */
export function perSecond(delta: number | null, dtMs: number | null): number | null {
  if (delta === null || dtMs === null) return null;
  if (!Number.isFinite(delta) || !Number.isFinite(dtMs)) return null;
  if (dtMs < 200 || dtMs > 5000) return null;
  if (delta < 0) return null;
  return delta / (dtMs / 1000);
}

export function bitrateFromBytes(bytesDelta: number | null, dtMs: number | null): number | null {
  const bytesPerSec = perSecond(bytesDelta, dtMs);
  if (bytesPerSec === null) return null;
  return Math.round(bytesPerSec * 8);
}

/** Percentual de perda no intervalo. Sem pacotes, a taxa não existe (null), não é 0%. */
export function lossPercent(lostDelta: number | null, receivedDelta: number | null): number | null {
  if (lostDelta === null || receivedDelta === null) return null;
  if (!Number.isFinite(lostDelta) || !Number.isFinite(receivedDelta)) return null;
  if (lostDelta < 0 || receivedDelta < 0) return null;
  const total = lostDelta + receivedDelta;
  if (total <= 0) return null;
  return (lostDelta / total) * 100;
}

/** totalSecondsDelta é o delta de totalEncodeTime/totalDecodeTime (segundos). */
export function avgMsPerFrame(totalSecondsDelta: number | null, frameDelta: number | null): number | null {
  if (totalSecondsDelta === null || frameDelta === null) return null;
  if (!Number.isFinite(totalSecondsDelta) || !Number.isFinite(frameDelta)) return null;
  if (frameDelta <= 0 || totalSecondsDelta < 0) return null;
  return (totalSecondsDelta / frameDelta) * 1000;
}

export function median(values: number[]): number | null {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function roundTo(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
