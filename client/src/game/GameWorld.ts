// Design: «Глухая тьма» — квадрат неподвижен, а бесконечность чувствуется только через медленный дрейф редких огней.
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/color.fragment";
import "@babylonjs/core/Shaders/color.vertex";
import { InputManager, type MoveVector } from "./InputManager";
import { getBrowserPerformanceProfile, type PerformanceProfile } from "./performance";
import { playShot, disposeShotAudio, setEngineIntensity } from "./sfx";
import { SHOT_DURATION_SECONDS, SHOT_FRONT_OFFSET, SHOT_SPEED, SHOT_WIDTH_WORLD } from "./shot";
import { expApproach, smootherstep01 } from "./graphicsMath";

type Star = {
  mesh: LinesMesh;
  radius: number;
  speed: number;
  baseVisibility: number;
  phase: number;
};

type ShootingStar = {
  mesh: LinesMesh;
  age: number;
  duration: number;
  velocity: { x: number; y: number };
};

type Anomaly = {
  outer: LinesMesh;
  inner: LinesMesh;
  direction: Vector3;
  age: number;
  duration: number;
  spin: number;
};

type Wave = {
  mesh: LinesMesh;
  direction: MoveVector;
  age: number;
  duration: number;
  speed: number;
};

type Leech = {
  mesh: LinesMesh;
  heading: number;
  speed: number;
  phase: number;
  age: number;
  frozen: boolean;
  frozenVelocity: Vector3;
  baseAlpha: number;
};

type TransitPilot = {
  mesh: LinesMesh;
  velocity: Vector3;
  age: number;
  duration: number;
  baseAlpha: number;
};

type Diamond = {
  mesh: LinesMesh;
  age: number;
  phase: number;
};

type Station = {
  meshes: LinesMesh[];
  alphas: number[];
  position: Vector3;
  crewCount: number;
  age: number;
};

type Planet = {
  mesh: LinesMesh;
  halo: LinesMesh;
  position: Vector3;
  variant: number;
  age: number;
};

type EncounterKind = "cafe" | "planet";

const TEAL = new Color3(0.486, 0.878, 0.835);
const MIST = new Color3(0.55, 0.63, 0.67);
const WHITE = new Color3(0.9, 0.94, 0.94);

export class GameWorld {
  readonly input = new InputManager();

  private readonly stars: Star[] = [];
  private readonly shootingStars: ShootingStar[] = [];
  private nextShootingStarAt = 12;
  private readonly waves: Wave[] = [];
  private readonly leeches: Leech[] = [];
  private readonly transitPilots: TransitPilot[] = [];
  private readonly diamonds: Diamond[] = [];
  private readonly playerInner: LinesMesh;
  private readonly playerOuter: LinesMesh;
  private readonly playerFragment: LinesMesh;
  private velocity: MoveVector = { x: 0, y: 0 };
  private playerPosition = new Vector3(0, 0, 0);
  private elapsed = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private anomaly: Anomaly | null = null;
  private anomalyCount = 0;
  private nextAnomalyAt = 0;
  private lastDirection: MoveVector = { x: 0, y: 1 };
  private shotCooldown = 0;
  private shotCount = 0;
  private nextLeechAt = 0;
  private leechCount = 0;
  private nextTransitPilotAt = 0;
  private transitPilotCount = 0;
  private station: Station | null = null;
  private planet: Planet | null = null;
  private travelCourse: MoveVector | null = null;
  private continuousDistance = 0;
  private stationDistanceTarget = 0;
  private stationAttempt = 0;
  private nextEncounterKind: EncounterKind = "cafe";
  private planetChanceDenominator = 4;
  private planetAttempt = 0;
  private planetNearby = false;
  private readonly performanceProfile: PerformanceProfile;
  private leechShapeBudget = 0;
  private diamondCount = 0;
  private stationNearby = false;
  private paused = false;
  private atmosphereActive = false;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly onDiamondsChange?: (count: number) => void,
    private readonly onStationNearby?: (nearby: boolean) => void,
    private readonly onCafeCrewChange?: (count: number) => void,
    private readonly onPlanetNearby?: (nearby: boolean, variant: number) => void,
    private readonly onPlasmaUse?: () => boolean,
    private readonly onShoot?: (dx: number, dy: number) => void,
  ) {
    this.performanceProfile = getBrowserPerformanceProfile();
    this.configureCamera();

    this.playerOuter = this.makePlayer("playerOuter", 1.93, TEAL, 0.96);
    this.playerInner = this.makePlayer("playerInner", 1.63, WHITE, 1);
    this.playerFragment = this.makePlayerFragment(1.52);
    this.createStarField();
    this.nextLeechAt = 8.5;
    this.nextTransitPilotAt = 25;
    this.stationDistanceTarget = this.nextStationDistance();
    this.onDiamondsChange?.(0);
    this.onStationNearby?.(false);
    this.onPlanetNearby?.(false, 0);
  }

  setMove(x: number, y: number) {
    this.input.setTouchMove(x, y);
  }

  setFiring(active: boolean) {
    this.input.setTouchFiring(active);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.input.setTouchMove(0, 0);
      this.input.setTouchFiring(false);
    }
  }

  // Передаёт из UI, что открыта планета: космос больше не управляет гулом.
  setAtmosphereActive(active: boolean) {
    this.atmosphereActive = active;
    if (active) {
      for (const wave of this.waves) wave.mesh.dispose();
      this.waves.splice(0, this.waves.length);
      this.shotCooldown = 0;
    }
  }

  update(delta: number) {
    if (this.paused) return;
    this.elapsed += delta;
    this.configureCamera();

    if (this.atmosphereActive) {
      this.shotCooldown = Math.max(0, this.shotCooldown - delta);
      if (this.input.isFiring() && this.shotCooldown === 0) {
        this.fireWave();
        this.shotCooldown = 0.28;
      }
      return;
    }

    const target = this.input.getMove();
    const targetMagnitude = Math.hypot(target.x, target.y);
    if (targetMagnitude > 0.12) {
      this.lastDirection = { x: target.x / targetMagnitude, y: target.y / targetMagnitude };
    }
    this.velocity.x = expApproach(this.velocity.x, target.x, 5.4, delta);
    this.velocity.y = expApproach(this.velocity.y, target.y, 5.4, delta);
    this.playerPosition.x = expApproach(this.playerPosition.x, target.x * 5.4, 2.6, delta);
    this.playerPosition.y = expApproach(this.playerPosition.y, target.y * 3.6, 2.6, delta);

    // Тяга двигателя = модуль скорости (0..1): в полёте рёв пропорционален разгону.
    // На планете гул управляется извне (движение по поверхности).
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (!this.atmosphereActive) setEngineIntensity(speed);

    const movement = 5.25 * delta;
    for (const star of this.stars) {
      star.mesh.position.x -= this.velocity.x * movement * star.speed;
      star.mesh.position.y -= this.velocity.y * movement * star.speed;
      this.recycleStar(star);
      star.mesh.visibility = star.baseVisibility * (0.7 + Math.sin(this.elapsed * (0.8 + star.speed) + star.phase) * 0.3);
    }

    this.updatePlanetTravel(delta, movement);
    this.updateStationTravel(target, targetMagnitude, delta, movement);
    this.updateLeeches(delta, movement);
    this.updateTransitPilots(delta, movement);
    this.updateDiamonds(delta, movement);
    this.updateShootingStars(delta, movement);
    this.updateWaves(delta);
    this.shotCooldown = Math.max(0, this.shotCooldown - delta);
    if (this.input.isFiring() && this.shotCooldown === 0) {
      this.fireWave();
      this.shotCooldown = 0.28;
    }

    const facingTarget = Math.atan2(-this.lastDirection.x, this.lastDirection.y);
    const turnDelta = Math.atan2(Math.sin(facingTarget - this.playerInner.rotation.z), Math.cos(facingTarget - this.playerInner.rotation.z));
    this.playerInner.rotation.z += turnDelta * Math.min(1, delta * 6.2);
    this.playerOuter.rotation.z = this.playerInner.rotation.z;
    this.playerFragment.rotation.z = this.playerInner.rotation.z;
    this.playerInner.position.set(this.playerPosition.x, this.playerPosition.y, 1);
    this.playerOuter.position.set(this.playerPosition.x, this.playerPosition.y, 0.98);
    this.playerFragment.position.set(this.playerPosition.x, this.playerPosition.y, 1.12);
    const pulse = 0.96 + Math.sin(this.elapsed * 1.1) * 0.035;
    this.playerInner.scaling.set(pulse, pulse, pulse);
    this.playerOuter.scaling.set(pulse, pulse, pulse);
    this.playerFragment.scaling.set(pulse, pulse, pulse);
  }

  dispose() {
    this.input.dispose();
    disposeShotAudio();
    this.waves.forEach((wave) => wave.mesh.dispose());
    this.leeches.forEach((leech) => leech.mesh.dispose());
    this.transitPilots.forEach((pilot) => pilot.mesh.dispose());
    this.diamonds.forEach((diamond) => diamond.mesh.dispose());
    this.shootingStars.forEach((meteor) => meteor.mesh.dispose());
    this.station?.meshes.forEach((mesh) => mesh.dispose());
    this.planet?.mesh.dispose();
    this.planet?.halo.dispose();
    this.onStationNearby?.(false);
    this.onCafeCrewChange?.(0);
    this.onPlanetNearby?.(false, 0);
  }

  private configureCamera() {
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    if (!width || !height || (width === this.lastWidth && height === this.lastHeight)) return;
    this.lastWidth = width;
    this.lastHeight = height;
    const verticalExtent = 31.8;
    const horizontalExtent = verticalExtent * (width / height);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.orthoLeft = -horizontalExtent;
    this.camera.orthoRight = horizontalExtent;
    this.camera.orthoTop = verticalExtent;
    this.camera.orthoBottom = -verticalExtent;
  }

  private makePlayer(name: string, scale: number, color: Color3, alpha: number) {
    const points = [
      new Vector3(-0.56 * scale, -0.61 * scale, 0),
      new Vector3(0.66 * scale, -0.47 * scale, 0),
      new Vector3(0.5 * scale, 0.59 * scale, 0),
      new Vector3(-0.61 * scale, 0.51 * scale, 0),
      new Vector3(-0.56 * scale, -0.61 * scale, 0),
    ];
    const line = MeshBuilder.CreateLines(name, { points, updatable: false }, this.scene);
    line.color = color;
    line.alpha = alpha;
    line.position.z = 1;
    return line;
  }

  private makePlayerFragment(scale: number) {
    const fragment = MeshBuilder.CreateLines("playerFragment", {
      points: [
        new Vector3(0.18 * scale, 0.61 * scale, 0),
        new Vector3(0.53 * scale, 0.58 * scale, 0),
        new Vector3(0.64 * scale, 0.37 * scale, 0),
      ],
    }, this.scene);
    fragment.color = TEAL;
    fragment.alpha = 0.96;
    fragment.position.z = 1.12;
    return fragment;
  }

  private createStarField() {
    const xLimit = Math.max(Math.abs(this.camera.orthoRight ?? 0) + 3, 95);
    const yLimit = Math.max(Math.abs(this.camera.orthoTop ?? 0) + 3, 35);
    const starCount = this.performanceProfile.starCount;
    for (let index = 0; index < starCount; index += 1) {
      const roll = this.seed(index * 11.37);
      const radius = roll > 0.97 ? 0.13 : roll > 0.83 ? 0.075 : 0.034 + this.seed(index * 5.1) * 0.026;
      const star = MeshBuilder.CreateLines(`star-${index}`, {
        points: [new Vector3(-radius, 0, 0), new Vector3(radius, 0, 0)],
      }, this.scene);
      star.position.set(
        this.range(index * 2.8, -xLimit, xLimit),
        this.range(index * 8.1, -yLimit, yLimit),
        this.range(index * 13.2, -0.2, 0.2),
      );
      star.color = roll > 0.97 ? WHITE : roll > 0.83 ? TEAL : MIST;
      star.alpha = roll > 0.97 ? 1 : roll > 0.83 ? 0.86 : 0.5;
      this.stars.push({
        mesh: star,
        radius,
        speed: 0.62 + this.seed(index * 9.7) * 1.75,
        baseVisibility: roll > 0.97 ? 1 : roll > 0.83 ? 0.86 : 0.5,
        phase: this.seed(index * 4.3) * Math.PI * 2,
      });
    }
  }

  private createShootingStar(): ShootingStar {
    const count = this.shootingStars.length;
    const xLimit = Math.abs(this.camera.orthoRight ?? 68) + 12;
    const yLimit = Math.abs(this.camera.orthoTop ?? 32) + 12;
    const length = 1.1 + this.seed(count * 7.3) * 1.6;
    const mesh = MeshBuilder.CreateLines(`shooting-star-${count}`, {
      points: [new Vector3(0, 0, 0), new Vector3(-length, 0, 0)],
    }, this.scene);
    mesh.color = WHITE;
    mesh.alpha = 0;
    mesh.position.set(
      this.range(count * 5.9, -xLimit, xLimit),
      this.range(count * 3.1, yLimit * 0.2, yLimit),
      0.25 + this.seed(count * 9.4) * 0.2,
    );
    // Диагональный пролёт: вниз-вправо или вниз-влево.
    const slope = 0.55 + this.seed(count * 6.7) * 0.4;
    const direction = this.seed(count * 2.2) > 0.5 ? 1 : -1;
    return {
      mesh,
      age: 0,
      duration: 1.1 + this.seed(count * 4.9) * 0.9,
      velocity: { x: 24 * direction * slope, y: -22 },
    };
  }

  private updateShootingStars(delta: number, movement: number) {
    // Иногда — падающая звезда.
    if (this.shootingStars.length < 2 && this.elapsed >= this.nextShootingStarAt) {
      this.shootingStars.push(this.createShootingStar());
      this.nextShootingStarAt = this.elapsed + 9 + this.seed(this.elapsed) * 21;
    }

    for (let index = this.shootingStars.length - 1; index >= 0; index -= 1) {
      const meteor = this.shootingStars[index];
      meteor.age += delta;
      meteor.mesh.position.x += meteor.velocity.x * delta;
      meteor.mesh.position.y += meteor.velocity.y * delta;
      // Движение корабля сдвигает метеор, как и звёзды.
      meteor.mesh.position.x -= this.velocity.x * movement;
      meteor.mesh.position.y -= this.velocity.y * movement;
      // Вспышка: быстрое появление, плавное затухание к концу полёта.
      const fadeIn = smootherstep01(meteor.age / 0.18);
      const fadeOut = smootherstep01((meteor.duration - meteor.age) / 0.4);
      meteor.mesh.alpha = 0.95 * fadeIn * fadeOut;

      if (meteor.age >= meteor.duration) {
        meteor.mesh.dispose();
        this.shootingStars.splice(index, 1);
      }
    }
  }

  private updateAnomaly(delta: number, movement: number) {
    if (!this.anomaly && this.elapsed >= this.nextAnomalyAt) {
      this.anomaly = this.createAnomaly();
      const interval = 18 + this.seed(this.anomalyCount * 21.3) * 14;
      this.nextAnomalyAt = this.elapsed + interval;
    }

    const anomaly = this.anomaly;
    if (!anomaly) return;

    anomaly.age += delta;
    anomaly.outer.position.x += anomaly.direction.x * delta;
    anomaly.outer.position.y += anomaly.direction.y * delta;
    anomaly.inner.position.x = anomaly.outer.position.x;
    anomaly.inner.position.y = anomaly.outer.position.y;
    anomaly.outer.position.x -= this.velocity.x * movement * 0.18;
    anomaly.outer.position.y -= this.velocity.y * movement * 0.18;
    anomaly.inner.position.x = anomaly.outer.position.x;
    anomaly.inner.position.y = anomaly.outer.position.y;
    anomaly.outer.rotation.z += anomaly.spin * delta;
    anomaly.inner.rotation.z = anomaly.outer.rotation.z * 1.08;

    const fadeIn = smootherstep01(anomaly.age / 1.4);
    const fadeOut = smootherstep01((anomaly.duration - anomaly.age) / 2.3);
    const alpha = fadeIn * fadeOut;
    anomaly.outer.alpha = alpha * 0.31;
    anomaly.inner.alpha = alpha * 0.13;

    if (anomaly.age >= anomaly.duration) {
      anomaly.outer.dispose();
      anomaly.inner.dispose();
      this.anomaly = null;
    }
  }

  private fireWave() {
    // Плазма расходуется на каждый выстрел; если закончилась — пушка молчит.
    if (this.onPlasmaUse && !this.onPlasmaUse()) return;
    const duration = SHOT_DURATION_SECONDS;
    playShot(duration);
    this.onShoot?.(this.lastDirection.x, this.lastDirection.y);
    if (this.atmosphereActive) return;
    const count = this.shotCount++;
    const width = SHOT_WIDTH_WORLD;
    const frontOffset = SHOT_FRONT_OFFSET;
    const points = [
      new Vector3(-width / 2, 0, 0),
      new Vector3(width / 2, 0, 0),
    ];
    const wave = MeshBuilder.CreateLines(`wave-${count}`, { points }, this.scene);
    wave.color = TEAL;
    wave.alpha = 0.68;
    wave.position.set(
      this.playerPosition.x + this.lastDirection.x * frontOffset,
      this.playerPosition.y + this.lastDirection.y * frontOffset,
      0.76,
    );
    wave.rotation.z = Math.atan2(-this.lastDirection.x, this.lastDirection.y);
    this.waves.push({
      mesh: wave,
      direction: { ...this.lastDirection },
      age: 0,
      duration,
      speed: SHOT_SPEED,
    });
  }

  private updateWaves(delta: number) {
    for (let index = this.waves.length - 1; index >= 0; index -= 1) {
      const wave = this.waves[index];
      wave.age += delta;
      wave.mesh.position.x += wave.direction.x * delta * wave.speed;
      wave.mesh.position.y += wave.direction.y * delta * wave.speed;
      const progress = wave.age / wave.duration;
      wave.mesh.alpha = 0.68 * (1 - smootherstep01(progress));
      this.checkWaveHit(wave);
      if (progress >= 1) {
        wave.mesh.dispose();
        this.waves.splice(index, 1);
      }
    }
  }

  private updateLeeches(delta: number, movement: number) {
    if (this.elapsed >= this.nextLeechAt && this.leeches.length < 1) {
      this.leeches.push(this.createLeech());
      const interval = 6 + this.seed(this.leechCount * 17.2) * 3;
      this.nextLeechAt = this.elapsed + interval;
    }

    const viewRadius = Math.hypot(Math.abs(this.camera.orthoRight ?? 68), Math.abs(this.camera.orthoTop ?? 32));
    this.leechShapeBudget += delta;
    const updateShape = this.performanceProfile.leechShapeInterval === 0
      || this.leechShapeBudget >= this.performanceProfile.leechShapeInterval;
    if (updateShape) this.leechShapeBudget = 0;
    const vanishingDistance = viewRadius * 1.45;
    for (let index = this.leeches.length - 1; index >= 0; index -= 1) {
      const leech = this.leeches[index];
      leech.age += delta;
      if (leech.frozen) {
        leech.mesh.position.x += leech.frozenVelocity.x * delta;
        leech.mesh.position.y += leech.frozenVelocity.y * delta;
        leech.heading = Math.atan2(leech.frozenVelocity.y, leech.frozenVelocity.x);
      } else {
        leech.heading += Math.sin(leech.age * 0.38 + leech.phase) * delta * 0.13;
        leech.mesh.position.x += Math.cos(leech.heading) * leech.speed * delta;
        leech.mesh.position.y += Math.sin(leech.heading) * leech.speed * delta;
        leech.mesh.position.x -= this.velocity.x * movement * 0.42;
        leech.mesh.position.y -= this.velocity.y * movement * 0.42;
      }

      const distance = Math.hypot(
        leech.mesh.position.x - this.playerPosition.x,
        leech.mesh.position.y - this.playerPosition.y,
      );
      const emergingFromDarkness = Math.min(1, Math.max(0, (viewRadius * 1.12 - distance) / 10));
      const fade = leech.frozen
        ? Math.max(0, 1 - Math.max(0, distance - viewRadius * 0.7) / (vanishingDistance - viewRadius * 0.7))
        : emergingFromDarkness * (0.82 + Math.sin(leech.age * 0.55 + leech.phase) * 0.18);
      leech.mesh.alpha = leech.baseAlpha * fade;
      if (updateShape) this.updateLeechShape(leech);
      else leech.mesh.rotation.z = leech.heading - Math.PI / 2;

      if (distance > vanishingDistance) {
        leech.mesh.dispose();
        this.leeches.splice(index, 1);
      }
    }
  }

  private updateTransitPilots(delta: number, movement: number) {
    if (this.elapsed >= this.nextTransitPilotAt && this.transitPilots.length < 1) {
      this.transitPilots.push(this.createTransitPilot());
      const interval = 24 + this.seed(this.transitPilotCount * 23.7 + 5.2) * 15;
      this.nextTransitPilotAt = this.elapsed + interval;
    }

    for (let index = this.transitPilots.length - 1; index >= 0; index -= 1) {
      const pilot = this.transitPilots[index];
      pilot.age += delta;
      pilot.mesh.position.x += pilot.velocity.x * delta;
      pilot.mesh.position.y += pilot.velocity.y * delta;
      pilot.mesh.position.x -= this.velocity.x * movement * 0.16;
      pilot.mesh.position.y -= this.velocity.y * movement * 0.16;

      const fadeIn = Math.min(1, pilot.age / 0.7);
      const fadeOut = Math.min(1, Math.max(0, pilot.duration - pilot.age) / 0.8);
      pilot.mesh.alpha = pilot.baseAlpha * fadeIn * fadeOut;

      if (pilot.age >= pilot.duration) {
        pilot.mesh.dispose();
        this.transitPilots.splice(index, 1);
      }
    }
  }

  private updateStationTravel(target: MoveVector, magnitude: number, delta: number, movement: number) {
    if (this.planet) return;
    if (this.station) {
      this.station.age += delta;
      for (let index = 0; index < this.station.meshes.length; index += 1) {
        const mesh = this.station.meshes[index];
        mesh.position.x -= this.velocity.x * movement;
        mesh.position.y -= this.velocity.y * movement;
        mesh.alpha = Math.min(this.station.alphas[index], this.station.age * 0.16);
      }
      this.station.position.x -= this.velocity.x * movement;
      this.station.position.y -= this.velocity.y * movement;
      const stationDistance = Math.hypot(
        this.station.position.x - this.playerPosition.x,
        this.station.position.y - this.playerPosition.y,
      );
      this.setStationNearby(stationDistance < 15.5);
      const discardDistance = Math.hypot(Math.abs(this.camera.orthoRight ?? 68), Math.abs(this.camera.orthoTop ?? 32)) * 1.5;
      if (stationDistance > discardDistance) {
        this.station.meshes.forEach((mesh) => mesh.dispose());
        this.station = null;
        this.travelCourse = null;
        this.continuousDistance = 0;
        this.scheduleNextEncounter("cafe");
        this.stationDistanceTarget = this.nextStationDistance();
        this.setStationNearby(false);
      }
      return;
    }

    if (magnitude < 0.32) return;
    const direction = { x: target.x / magnitude, y: target.y / magnitude };
    if (!this.travelCourse) {
      this.travelCourse = direction;
      this.continuousDistance = 0;
    } else {
      const alignment = this.travelCourse.x * direction.x + this.travelCourse.y * direction.y;
      if (alignment < 0.94) {
        this.travelCourse = direction;
        this.continuousDistance = 0;
        this.stationDistanceTarget = this.nextStationDistance();
      }
    }

    this.continuousDistance += magnitude * 12 * delta;
    if (this.continuousDistance >= this.stationDistanceTarget && this.travelCourse) {
      if (this.nextEncounterKind === "planet") {
        this.planet = this.createPlanet(this.travelCourse);
      } else {
        this.station = this.createStation(this.travelCourse);
      }
    }
  }

  private nextStationDistance() {
    const attempt = this.stationAttempt++;
    const baseDistance = 72 + this.seed(attempt * 19.41 + 2.7) * 34;
    return this.nextEncounterKind === "planet" ? baseDistance * 2 : baseDistance;
  }

  private updatePlanetTravel(delta: number, movement: number) {
    const planet = this.planet;
    if (!planet) return;

    planet.age += delta;
    planet.mesh.position.x -= this.velocity.x * movement * 0.72;
    planet.mesh.position.y -= this.velocity.y * movement * 0.72;
    planet.halo.position.copyFrom(planet.mesh.position);
    planet.position.copyFrom(planet.mesh.position);
    planet.mesh.rotation.z += delta * (planet.variant === 0 ? 0.012 : -0.017);
    planet.halo.rotation.z = planet.mesh.rotation.z * 0.76;

    const distance = Math.hypot(
      planet.position.x - this.playerPosition.x,
      planet.position.y - this.playerPosition.y,
    );
    this.setPlanetNearby(distance < 25, planet.variant);
    const discardDistance = Math.hypot(Math.abs(this.camera.orthoRight ?? 68), Math.abs(this.camera.orthoTop ?? 32)) * 1.65;
    if (distance > discardDistance) {
      planet.mesh.dispose();
      planet.halo.dispose();
      this.planet = null;
      this.travelCourse = null;
      this.continuousDistance = 0;
      this.scheduleNextEncounter("planet");
      this.stationDistanceTarget = this.nextStationDistance();
      this.setPlanetNearby(false, 0);
    }
  }

  private scheduleNextEncounter(lastEncounter: EncounterKind) {
    const chanceDenominator = lastEncounter === "planet" ? 5 : this.planetChanceDenominator;
    const success = this.seed((this.planetAttempt++ + 1) * 31.7 + chanceDenominator) < 1 / chanceDenominator;
    this.nextEncounterKind = success ? "planet" : "cafe";
    this.planetChanceDenominator = success ? 5 : Math.max(2, chanceDenominator - 1);
  }

  private setStationNearby(nearby: boolean) {
    if (this.stationNearby === nearby) return;
    this.stationNearby = nearby;
    this.onStationNearby?.(nearby);
    this.onCafeCrewChange?.(nearby && this.station ? this.station.crewCount : 0);
  }

  private createStation(course: MoveVector): Station {
    const forward = 22;
    const position = new Vector3(
      this.playerPosition.x + course.x * forward,
      this.playerPosition.y + course.y * forward,
      0.44,
    );
    const rotation = Math.atan2(-course.x, course.y);
    const meshes: LinesMesh[] = [];
    const alphas: number[] = [];
    const crewCount = Math.floor(this.seed((this.stationAttempt + 1) * 27.31) * 4);
    const addLine = (name: string, points: Vector3[], color: Color3, alpha: number) => {
      const line = MeshBuilder.CreateLines(name, { points }, this.scene);
      line.color = color;
      line.alpha = 0;
      line.position.copyFrom(position);
      line.rotation.z = rotation;
      meshes.push(line);
      alphas.push(alpha);
    };
    const addLineSystem = (name: string, lines: Vector3[][], color: Color3, alpha: number) => {
      const line = MeshBuilder.CreateLineSystem(name, { lines }, this.scene);
      line.color = color;
      line.alpha = 0;
      line.position.copyFrom(position);
      line.rotation.z = rotation;
      meshes.push(line);
      alphas.push(alpha);
    };

    addLine("station-shell", [
      new Vector3(-7.2, -3.1, 0), new Vector3(7.2, -3.1, 0), new Vector3(8.8, 0, 0),
      new Vector3(7.2, 3.1, 0), new Vector3(-7.2, 3.1, 0), new Vector3(-8.8, 0, 0), new Vector3(-7.2, -3.1, 0),
    ], MIST, 0.84);
    addLine("station-awning", [
      new Vector3(-5.8, 0.6, 0), new Vector3(0, 2.5, 0), new Vector3(5.8, 0.6, 0),
    ], TEAL, 0.66);
    addLine("station-signal", [
      new Vector3(0, 3.1, 0), new Vector3(0, 6, 0), new Vector3(1.1, 7.1, 0),
    ], WHITE, 0.72);
    addLine("station-counter", [
      new Vector3(-3.2, -0.8, 0), new Vector3(3.2, -0.8, 0), new Vector3(3.2, 0.75, 0),
      new Vector3(-3.2, 0.75, 0), new Vector3(-3.2, -0.8, 0),
    ], new Color3(0.93, 0.62, 0.28), 0.62);
    addLine("station-lamp", [
      new Vector3(-0.5, 3.25, 0), new Vector3(0, 4.45, 0), new Vector3(0.5, 3.25, 0),
    ], TEAL, 0.92);
    const amber = new Color3(0.96, 0.66, 0.31);
    const letters: Vector3[][] = [];
    const baseX = -5.3;
    const y = 2.05;
    const h = 1.25;
    const c = (x: number) => letters.push([
      new Vector3(x + 0.72, y + h, 0), new Vector3(x, y + h, 0), new Vector3(x - 0.22, y + h * 0.5, 0),
      new Vector3(x, y, 0), new Vector3(x + 0.72, y, 0),
    ]);
    const o = (x: number) => letters.push([
      new Vector3(x, y, 0), new Vector3(x + 0.65, y, 0), new Vector3(x + 0.82, y + h * 0.5, 0),
      new Vector3(x + 0.65, y + h, 0), new Vector3(x, y + h, 0), new Vector3(x - 0.17, y + h * 0.5, 0), new Vector3(x, y, 0),
    ]);
    const f = (x: number) => {
      letters.push([new Vector3(x, y, 0), new Vector3(x, y + h, 0)]);
      letters.push([new Vector3(x, y + h, 0), new Vector3(x + 0.75, y + h, 0)]);
      letters.push([new Vector3(x, y + h * 0.53, 0), new Vector3(x + 0.58, y + h * 0.53, 0)]);
    };
    const e = (x: number) => {
      letters.push([new Vector3(x, y, 0), new Vector3(x, y + h, 0)]);
      letters.push([new Vector3(x, y + h, 0), new Vector3(x + 0.74, y + h, 0)]);
      letters.push([new Vector3(x, y + h * 0.52, 0), new Vector3(x + 0.57, y + h * 0.52, 0)]);
      letters.push([new Vector3(x, y, 0), new Vector3(x + 0.74, y, 0)]);
    };
    c(baseX); o(baseX + 1.45); f(baseX + 2.86); f(baseX + 4.06); e(baseX + 5.26); e(baseX + 6.46);
    addLineSystem("station-coffee", letters, amber, 0.94);

    const parkedColors = [
      new Color3(0.42, 0.63, 0.72),
      new Color3(0.73, 0.53, 0.3),
      new Color3(0.65, 0.47, 0.56),
      new Color3(0.39, 0.63, 0.47),
    ];
    parkedColors.slice(0, crewCount).forEach((color, index) => {
      const x = -5.1 + index * 3.35;
      const size = index % 2 === 0 ? 0.84 : 0.68;
      addLine(`traveler-${index}`, [
        new Vector3(x - size, -5.1 - size, 0), new Vector3(x + size, -5.1 - size * 0.72, 0),
        new Vector3(x + size * 0.72, -5.1 + size, 0), new Vector3(x - size, -5.1 + size * 0.72, 0), new Vector3(x - size, -5.1 - size, 0),
      ], color, 0.78);
    });
    return { meshes, alphas, position, crewCount, age: 0 };
  }

  private createPlanet(course: MoveVector, forward = 42): Planet {
    const variant = this.planetAttempt % 2;
    const position = new Vector3(
      this.playerPosition.x + course.x * forward,
      this.playerPosition.y + course.y * forward,
      0.34,
    );
    const planetRadius = 13.35;
    const outline: Vector3[] = [];
    const latitudeA: Vector3[] = [];
    const latitudeB: Vector3[] = [];
    const fracture: Vector3[] = [];
    for (let index = 0; index <= 44; index += 1) {
      const t = index / 44;
      const angle = t * Math.PI * 2;
      const wobble = Math.sin(angle * 5 + variant) * 0.42 + Math.sin(angle * 9 + variant * 2) * 0.16;
      const radius = planetRadius + wobble;
      outline.push(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
      latitudeA.push(new Vector3((t - 0.5) * planetRadius * 1.4, Math.sin(t * Math.PI) * 2.6 - 2.6, 0));
      latitudeB.push(new Vector3((t - 0.5) * planetRadius * 1.16, Math.sin(t * Math.PI) * 1.9 + 2.8, 0));
      if (index < 15) fracture.push(new Vector3(-5 + index * 0.72, -4 + Math.sin(index * 1.4 + variant) * 1.15, 0));
    }
    const mesh = MeshBuilder.CreateLineSystem(`planet-${this.planetAttempt}`, { lines: [outline, latitudeA, latitudeB, fracture] }, this.scene);
    mesh.color = variant === 0 ? new Color3(0.83, 0.43, 0.24) : new Color3(0.4, 0.86, 0.82);
    mesh.alpha = 0.86;
    mesh.position.copyFrom(position);
    mesh.position.z = 0.52;
    mesh.rotation.z = variant === 0 ? -0.18 : 0.24;

    const haloPoints: Vector3[] = [];
    const haloRadius = 14.1;
    for (let index = 0; index <= 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      haloPoints.push(new Vector3(Math.cos(angle) * haloRadius, Math.sin(angle) * haloRadius, 0));
    }
    const halo = MeshBuilder.CreateLines(`planet-halo-${this.planetAttempt}`, { points: haloPoints }, this.scene);
    halo.color = variant === 0 ? new Color3(0.84, 0.57, 0.31) : TEAL;
    halo.alpha = 0.22;
    halo.position.copyFrom(position);
    halo.position.z = 0.16;

    return { mesh, halo, position: mesh.position, variant, age: 0 };
  }

  private setPlanetNearby(nearby: boolean, variant: number) {
    if (this.planetNearby === nearby && (!nearby || this.planet?.variant === variant)) return;
    this.planetNearby = nearby;
    this.onPlanetNearby?.(nearby, variant);
  }

  private createLeech(): Leech {
    const count = this.leechCount++;
    const points = this.makeLeechPoints(0, false);
    const mesh = MeshBuilder.CreateLines(`leech-${count}`, { points, updatable: true }, this.scene);
    mesh.color = new Color3(0.67, 0.82, 0.83);
    mesh.alpha = 0;
    mesh.position.z = 0.6;

    let heading = this.range(count * 9.7, -Math.PI, Math.PI);
    const xLimit = Math.abs(this.camera.orthoRight ?? 68) + 7;
    const yLimit = Math.abs(this.camera.orthoTop ?? 32) + 7;
    const side = Math.floor(this.seed(count * 13.9) * 4);
    const lane = this.range(count * 4.2 + 0.7, -0.62, 0.62);
    if (side === 0) mesh.position.set(this.playerPosition.x - xLimit, this.playerPosition.y + lane * yLimit, 0.6);
    else if (side === 1) mesh.position.set(this.playerPosition.x + xLimit, this.playerPosition.y + lane * yLimit, 0.6);
    else if (side === 2) mesh.position.set(this.playerPosition.x + lane * xLimit, this.playerPosition.y + yLimit, 0.6);
    else mesh.position.set(this.playerPosition.x + lane * xLimit, this.playerPosition.y - yLimit, 0.6);
    heading = Math.atan2(
      this.playerPosition.y - mesh.position.y,
      this.playerPosition.x - mesh.position.x,
    ) + this.range(count * 7.8, -0.18, 0.18);
    return {
      mesh,
      heading,
      speed: 2.45 + this.seed(count * 5.5) * 0.8,
      phase: this.seed(count * 3.1) * Math.PI * 2,
      age: 0,
      frozen: false,
      frozenVelocity: Vector3.Zero(),
      baseAlpha: 0.94,
    };
  }

  private createTransitPilot(): TransitPilot {
    const count = this.transitPilotCount++;
    const xLimit = Math.abs(this.camera.orthoRight ?? 68) + 5;
    const yLimit = Math.abs(this.camera.orthoTop ?? 32) + 5;
    const side = Math.floor(this.seed(count * 15.7 + 1.3) * 4);
    const laneStart = this.range(count * 4.1 + 2.7, -0.62, 0.62);
    const laneEnd = this.range(count * 8.3 + 6.1, -0.48, 0.48);
    const start = new Vector3(0, 0, 0.56);
    const finish = new Vector3(0, 0, 0.56);

    if (side === 0) {
      start.set(-xLimit, laneStart * yLimit, 0.56);
      finish.set(xLimit, laneEnd * yLimit, 0.56);
    } else if (side === 1) {
      start.set(xLimit, laneStart * yLimit, 0.56);
      finish.set(-xLimit, laneEnd * yLimit, 0.56);
    } else if (side === 2) {
      start.set(laneStart * xLimit, yLimit, 0.56);
      finish.set(laneEnd * xLimit, -yLimit, 0.56);
    } else {
      start.set(laneStart * xLimit, -yLimit, 0.56);
      finish.set(laneEnd * xLimit, yLimit, 0.56);
    }

    const direction = finish.subtract(start);
    const distance = direction.length();
    const speed = 9.2 + this.seed(count * 11.9 + 3.2) * 12.8;
    const velocity = direction.scale(1 / Math.max(distance, 0.001)).scale(speed);
    const colors = [
      new Color3(0.46, 0.74, 0.73),
      new Color3(0.69, 0.61, 0.42),
      new Color3(0.53, 0.63, 0.76),
    ];
    const mesh = MeshBuilder.CreateLineSystem(`transit-pilot-${count}`, {
      lines: [
        [new Vector3(0, 1.25, 0), new Vector3(0.92, 0.18, 0), new Vector3(0.46, -1.02, 0), new Vector3(-0.78, -0.64, 0), new Vector3(0, 1.25, 0)],
        [new Vector3(-0.35, -0.45, 0), new Vector3(0.18, -1.88, 0)],
        [new Vector3(-0.72, 0.14, 0), new Vector3(-1.2, -0.42, 0)],
      ],
    }, this.scene);
    mesh.color = colors[count % colors.length];
    mesh.alpha = 0;
    mesh.position.copyFrom(start);
    mesh.rotation.z = Math.atan2(velocity.y, velocity.x) - Math.PI / 2;
    mesh.scaling.set(1.45, 1.45, 1.45);

    return {
      mesh,
      velocity,
      age: 0,
      duration: distance / speed,
      baseAlpha: 0.58 + this.seed(count * 3.7 + 0.4) * 0.18,
    };
  }

  private updateLeechShape(leech: Leech) {
    const points = this.makeLeechPoints(leech.age + leech.phase, leech.frozen);
    MeshBuilder.CreateLines(leech.mesh.name, { points, instance: leech.mesh }, this.scene);
    leech.mesh.rotation.z = leech.heading - Math.PI / 2;
  }

  private makeLeechPoints(time: number, frozen: boolean) {
    const points: Vector3[] = [];
    const segments = 13;
    for (let index = 0; index < segments; index += 1) {
      const t = index / (segments - 1);
      const taper = Math.sin(t * Math.PI);
      const sway = frozen ? Math.sin(t * Math.PI * 1.3) * 0.14 : Math.sin(t * Math.PI * 3.1 + time * 3.7) * 1.12 * taper;
      points.push(new Vector3(sway, (t - 0.5) * 16.4, 0));
    }
    return points;
  }

  private checkWaveHit(wave: Wave) {
    for (let index = this.leeches.length - 1; index >= 0; index -= 1) {
      const leech = this.leeches[index];
      if (leech.frozen) continue;
      const distance = Math.hypot(
        leech.mesh.position.x - wave.mesh.position.x,
        leech.mesh.position.y - wave.mesh.position.y,
      );
      if (distance < 2.8) {
        this.dropDiamond(leech.mesh.position);
        leech.mesh.dispose();
        this.leeches.splice(index, 1);
      }
    }
  }

  private dropDiamond(source: Vector3) {
    const count = this.diamonds.length + this.diamondCount;
    const diamond = MeshBuilder.CreateLines(`diamond-${count}`, {
      points: [
        new Vector3(0, 0.72, 0), new Vector3(0.48, 0, 0), new Vector3(0, -0.72, 0),
        new Vector3(-0.48, 0, 0), new Vector3(0, 0.72, 0),
      ],
    }, this.scene);
    diamond.color = new Color3(0.67, 0.95, 0.94);
    diamond.alpha = 0.95;
    diamond.position.copyFrom(source);
    diamond.position.z = 0.98;
    this.diamonds.push({ mesh: diamond, age: 0, phase: this.seed(count * 7.3) * Math.PI * 2 });
  }

  private updateDiamonds(delta: number, movement: number) {
    for (let index = this.diamonds.length - 1; index >= 0; index -= 1) {
      const diamond = this.diamonds[index];
      diamond.age += delta;
      const offsetX = this.playerPosition.x - diamond.mesh.position.x;
      const offsetY = this.playerPosition.y - diamond.mesh.position.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (diamond.age < 0.22) {
        diamond.mesh.position.x -= this.velocity.x * movement * 0.3;
        diamond.mesh.position.y -= this.velocity.y * movement * 0.3;
      } else {
        const pull = Math.min(1, delta * (1.7 + distance * 0.92));
        diamond.mesh.position.x += offsetX * pull;
        diamond.mesh.position.y += offsetY * pull;
      }
      diamond.mesh.rotation.z += delta * 2.4;
      diamond.mesh.alpha = 0.74 + Math.sin(diamond.age * 5 + diamond.phase) * 0.2;
      if (distance < 1.05) {
        diamond.mesh.dispose();
        this.diamonds.splice(index, 1);
        this.diamondCount += 1;
        this.onDiamondsChange?.(this.diamondCount);
      }
    }
  }

  private freezeLeech(leech: Leech) {
    leech.frozen = true;
    leech.mesh.color = new Color3(0.64, 0.78, 0.8);
    const outX = leech.mesh.position.x - this.playerPosition.x;
    const outY = leech.mesh.position.y - this.playerPosition.y;
    const length = Math.hypot(outX, outY) || 1;
    leech.frozenVelocity = new Vector3((outX / length) * 6.3, (outY / length) * 6.3, 0);
  }

  private createAnomaly(): Anomaly {
    const count = this.anomalyCount++;
    const roll = this.seed(count * 31.7 + 4.9);
    const side = Math.floor(roll * 4);
    const xLimit = Math.abs(this.camera.orthoRight ?? 10) + 3.2;
    const yLimit = Math.abs(this.camera.orthoTop ?? 10) + 3.2;
    const offset = this.range(count * 18.2, -0.44, 0.44);
    const position = new Vector3(0, 0, 0.45);
    const direction = new Vector3(0, 0, 0);

    if (side === 0) {
      position.set(-xLimit, offset * yLimit, 0.45);
      direction.set(1.25, offset * 0.38, 0);
    } else if (side === 1) {
      position.set(xLimit, offset * yLimit, 0.45);
      direction.set(-1.25, offset * 0.38, 0);
    } else if (side === 2) {
      position.set(offset * xLimit, yLimit, 0.45);
      direction.set(offset * 0.38, -1.25, 0);
    } else {
      position.set(offset * xLimit, -yLimit, 0.45);
      direction.set(offset * 0.38, 1.25, 0);
    }

    const outer = this.makeAnomalyLine(`anomalyOuter-${count}`, 7.6, TEAL, 0.31);
    const inner = this.makeAnomalyLine(`anomalyInner-${count}`, 5.95, MIST, 0.13);
    outer.position.copyFrom(position);
    inner.position.copyFrom(position);
    return {
      outer,
      inner,
      direction,
      age: 0,
      duration: 16,
      spin: (this.seed(count * 5.9) - 0.5) * 0.075,
    };
  }

  private makeAnomalyLine(name: string, scale: number, color: Color3, alpha: number) {
    const points = [
      new Vector3(-0.72 * scale, -1.04 * scale, 0),
      new Vector3(1.12 * scale, -0.65 * scale, 0),
      new Vector3(0.84 * scale, 0.92 * scale, 0),
      new Vector3(-1.12 * scale, 1.16 * scale, 0),
      new Vector3(-0.72 * scale, -1.04 * scale, 0),
    ];
    const line = MeshBuilder.CreateLines(name, { points }, this.scene);
    line.color = color;
    line.alpha = 0;
    return line;
  }

  private recycleStar(star: Star) {
    const xLimit = Math.abs(this.camera.orthoRight ?? 10) + 2.6;
    const yLimit = Math.abs(this.camera.orthoTop ?? 10) + 2.6;
    if (star.mesh.position.x < -xLimit) star.mesh.position.x = xLimit;
    if (star.mesh.position.x > xLimit) star.mesh.position.x = -xLimit;
    if (star.mesh.position.y < -yLimit) star.mesh.position.y = yLimit;
    if (star.mesh.position.y > yLimit) star.mesh.position.y = -yLimit;
  }

  private seed(value: number) {
    const next = Math.sin(value * 12.9898) * 43758.5453;
    return next - Math.floor(next);
  }

  private range(seedValue: number, min: number, max: number) {
    return min + this.seed(seedValue) * (max - min);
  }
}
