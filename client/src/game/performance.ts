export type PerformanceProfile = {
  lowPower: boolean;
  hardwareScaling: number;
  starCount: number;
  leechShapeInterval: number;
  planetBiomeCount: number;
  planetWaterCount: number;
  planetForestCount: number;
  planetFaunaCount: number;
  planetShotRenderInterval: number;
};

type DeviceCapabilities = {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  devicePixelRatio?: number;
};

export function selectPerformanceProfile(capabilities: DeviceCapabilities = {}): PerformanceProfile {
  const memory = capabilities.deviceMemory ?? 4;
  const cores = capabilities.hardwareConcurrency ?? 4;
  const pixelRatio = capabilities.devicePixelRatio ?? 1;
  const lowPower = memory <= 4 || cores <= 4;

  return {
    lowPower,
    hardwareScaling: lowPower ? 1.65 : Math.min(1.25, Math.max(1, pixelRatio)),
    starCount: lowPower ? 260 : 460,
    leechShapeInterval: lowPower ? 1 / 30 : 0,
    planetBiomeCount: lowPower ? 4 : 9,
    planetWaterCount: lowPower ? 1 : 3,
    planetForestCount: lowPower ? 10 : 38,
    planetFaunaCount: lowPower ? 4 : 18,
    planetShotRenderInterval: lowPower ? 1 / 30 : 1 / 60,
  };
}

export function getBrowserPerformanceProfile(): PerformanceProfile {
  if (typeof navigator === "undefined") return selectPerformanceProfile();
  const device = navigator as Navigator & { deviceMemory?: number };
  return selectPerformanceProfile({
    deviceMemory: device.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
  });
}
