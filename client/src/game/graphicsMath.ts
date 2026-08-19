export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function expApproach(current: number, target: number, response: number, deltaSeconds: number) {
  const alpha = 1 - Math.exp(-Math.max(0, response) * Math.max(0, deltaSeconds));
  return current + (target - current) * alpha;
}

export function smoothstep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function smootherstep01(value: number) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function snapToDevicePixel(value: number, devicePixelRatio = window.devicePixelRatio || 1) {
  const dpr = Math.max(1, devicePixelRatio);
  return Math.round(value * dpr) / dpr;
}

export function repeat(value: number, period: number) {
  if (period <= 0) return 0;
  return ((value % period) + period) % period;
}
