export function applyControlCurve(distance: number, deadZone: number, fullReach: number) {
  if (distance <= deadZone) return 0;
  const normalized = Math.min(1, (distance - deadZone) / (fullReach - deadZone));
  return normalized ** 1.18;
}
