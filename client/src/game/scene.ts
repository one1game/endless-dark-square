// Design: «Глухая тьма» — прозрачная ортографическая сцена сохраняет ощущение пустоты и фиксирует игрока в центре.
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { GameWorld } from "./GameWorld";

export type GameHandle = {
  scene: Scene;
  setMove: (x: number, y: number) => void;
  setFiring: (active: boolean) => void;
  setPaused: (paused: boolean) => void;
  setAtmosphereActive: (active: boolean) => void;
  dispose: () => void;
};

export async function createGameScene(
  _engine: Engine,
  _canvas: HTMLCanvasElement,
  onDiamondsChange?: (count: number) => void,
  onStationNearby?: (nearby: boolean) => void,
  onCafeCrewChange?: (count: number) => void,
  onPlanetNearby?: (nearby: boolean, variant: number) => void,
  onPlasmaUse?: () => boolean,
  onShoot?: (dx: number, dy: number) => void,
): Promise<GameHandle> {
  const scene = new Scene(_engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor.set(0, 0, 0);

  const camera = new FreeCamera("voidCamera", new Vector3(0, 0, -10), scene);
  camera.setTarget(Vector3.Zero());
  const world = new GameWorld(scene, camera, onDiamondsChange, onStationNearby, onCafeCrewChange, onPlanetNearby, onPlasmaUse, onShoot);

  scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
    world.update(delta);
  });

  return {
    scene,
    setMove: (x, y) => world.setMove(x, y),
    setFiring: (active) => world.setFiring(active),
    setPaused: (paused) => world.setPaused(paused),
    setAtmosphereActive: (active) => world.setAtmosphereActive(active),
    dispose: () => {
      world.dispose();
      scene.dispose();
    },
  };
}
