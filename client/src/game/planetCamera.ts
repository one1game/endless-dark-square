export const PLANET_WORLD_WIDTH = 1600;
export const PLANET_WORLD_HEIGHT = 900;
export const PLANET_CAMERA_VERTICAL_EXTENT = 31.8;

export type PlanetViewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
};

export function getPlanetViewport(): PlanetViewport {
  const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
  return {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  };
}

export function getPlanetCameraScale(height = getPlanetViewport().height) {
  return height / (PLANET_CAMERA_VERTICAL_EXTENT * 2);
}

export function getPlanetTileTransform(tileX: number, tileY: number, offsetX: number, offsetY: number) {
  return `translate3d(calc(-50% + ${tileX * PLANET_WORLD_WIDTH - offsetX}px), calc(-50% + ${tileY * PLANET_WORLD_HEIGHT - offsetY}px), 0)`;
}
