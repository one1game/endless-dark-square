// Design: «Глухая тьма» — интерфейс почти растворён в пустоте; единственная явная опора — прозрачный джойстик.
/**
 * Design note — «Глухая тьма»: интерфейс остаётся периферийным прибором; инвентарь — тонкий регистр, а не игровая панель.
 */
import { Fragment, memo, type CSSProperties, useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle } from "@/game/scene";
import { applyControlCurve } from "@/game/controls";
import { expApproach, smootherstep01 } from "@/game/graphicsMath";
import { getBrowserPerformanceProfile } from "@/game/performance";
import { getPlanetCameraScale, PLANET_WORLD_HEIGHT, PLANET_WORLD_WIDTH } from "@/game/planetCamera";
import { startMotorHum, setEngineIntensity } from "@/game/sfx";
import { SHOT_DURATION_MS, SHOT_FRONT_OFFSET, SHOT_SPEED, SHOT_WIDTH_WORLD } from "@/game/shot";

const BASE = import.meta.env.BASE_URL;

const ASSETS = {
  abyss: `${BASE}assets/endless-dark-abyss-field.png`,
  joystick: `${BASE}assets/endless-dark-joystick-halo.png`,
  logo: `${BASE}assets/endless-dark-logo.png`,
  music: `${BASE}assets/audio/bgm-kepler-loop.mp3`,
} as const;

const CAFE_BARTENDER = { x: 0, y: -3.35 };
const CAFE_TALK_RANGE = 1.55;
const CAFE_PILOT_SIDES = [
  { x: -5.2, y: -1.5, name: "риан" },
  { x: 5.25, y: -0.55, name: "тари" },
  { x: -5.0, y: 1.35, name: "векс" },
];
const cafeParams = new URLSearchParams(window.location.search);
const CAFE_PLAYER_RADIUS = 11;
const CAFE_MOVE_SPEED = 132;
const PLANET_RENDER_PROFILE = getBrowserPerformanceProfile();
const PLANET_TILE_AXIS = PLANET_RENDER_PROFILE.lowPower ? [-1, 0, 1] : [-1, 0, 1, 2];
const PLANET_WORLD_TILES = PLANET_TILE_AXIS.flatMap((tileY) => (
  PLANET_TILE_AXIS.map((tileX) => ({ tileX, tileY }))
));
const JOYSTICK_RADIUS = 46;
const JOYSTICK_DEAD_ZONE = 0.12;
const MOUSE_DEAD_ZONE = 18;
const MOUSE_FULL_REACH = 240;

function wrapSurfaceCoordinate(value: number, size: number) {
  return ((value % size) + size) % size;
}

function seededValue(seed: number, index: number, salt: number) {
  const value = Math.sin(seed * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

type CafePosition = { x: number; y: number };

type AtmosphereShot = { id: number; x: number; y: number; dx: number; dy: number; bornAt: number; alpha: number };
type PlanetMode = "space" | "entering" | "planet" | "leaving";

const PLANET_TRANSITION_RESPONSE = 10;

function getCafeBounds() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const frameLeft = width * 0.21;
  const frameRight = width * 0.21;
  const frameTop = height * 0.17;
  const frameBottom = height * 0.24;

  return {
    minX: (frameLeft + CAFE_PLAYER_RADIUS - width / 2) / 22,
    maxX: (width / 2 - frameRight - CAFE_PLAYER_RADIUS) / 22,
    minY: (frameTop + CAFE_PLAYER_RADIUS - height / 2) / 20,
    maxY: (height / 2 - frameBottom - CAFE_PLAYER_RADIUS) / 20,
  };
}

function clampCafePosition(position: CafePosition): CafePosition {
  const bounds = getCafeBounds();
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, position.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, position.y)),
  };
}

const PlanetWorld = memo(function PlanetWorld({ seed }: { seed: number }) {
  return (
    <div className="planet-world" aria-hidden="true">
      {PLANET_WORLD_TILES.map(({ tileX, tileY }) => (
        <div
          key={`planet-tile-${tileX}-${tileY}`}
          className="planet-world-tile"
          style={{
            "--tile-x": `${tileX * PLANET_WORLD_WIDTH}px`,
            "--tile-y": `${tileY * PLANET_WORLD_HEIGHT}px`,
          } as CSSProperties}
        >
          <div className="surface-field" />
          <div className="surface-wash" />
          <div className="surface-contours" />
          {Array.from({ length: PLANET_RENDER_PROFILE.planetBiomeCount }, (_, index) => (
            <span
              key={`biome-${seed}-${index}`}
              className={`biome-patch biome-patch-${index % 3}`}
              style={{
                left: `${2 + seededValue(seed, index, 31) * 90}%`,
                top: `${3 + seededValue(seed, index, 32) * 86}%`,
                width: `${110 + seededValue(seed, index, 33) * 180}px`,
                height: `${60 + seededValue(seed, index, 34) * 120}px`,
                "--biome-turn": `${-34 + seededValue(seed, index, 35) * 68}deg`,
                "--biome-scale": `${0.68 + seededValue(seed, index, 36) * 0.44}`,
              } as CSSProperties}
            />
          ))}
          {Array.from({ length: PLANET_RENDER_PROFILE.planetWaterCount }, (_, index) => (
            <div
              key={`water-${seed}-${index}`}
              className="surface-water"
              style={{
                left: `${5 + seededValue(seed, index, 11) * 66}%`,
                top: `${7 + seededValue(seed, index, 12) * 70}%`,
                width: `${112 + seededValue(seed, index, 13) * 136}px`,
                height: `${68 + seededValue(seed, index, 14) * 86}px`,
                transform: `rotate(${-34 + seededValue(seed, index, 15) * 68}deg) scale(${0.58 + seededValue(seed, index, 16) * 0.45})`,
                opacity: 0.58 + seededValue(seed, index, 17) * 0.34,
              }}
            />
          ))}
          <div className="forest-layer">
            {Array.from({ length: PLANET_RENDER_PROFILE.planetForestCount }, (_, index) => (
              <i
                key={`forest-${seed}-${index}`}
                style={{
                  left: `${3 + seededValue(seed, index, 21) * 91}%`,
                  top: `${4 + seededValue(seed, index, 22) * 89}%`,
                  transform: `rotate(${-12 + seededValue(seed, index, 23) * 24}deg) scale(${0.42 + seededValue(seed, index, 24) * 0.62})`,
                }}
              />
            ))}
          </div>
          <div className="fauna-layer" aria-hidden="true">
            {Array.from({ length: PLANET_RENDER_PROFILE.planetFaunaCount }, (_, index) => (
              <span
                key={`fauna-${seed}-${index}`}
                className={`planet-fauna planet-fauna-${index % 3}`}
                style={{
                  left: `${7 + seededValue(seed, index, 41) * 84}%`,
                  top: `${9 + seededValue(seed, index, 42) * 80}%`,
                  "--fauna-turn": `${-42 + seededValue(seed, index, 43) * 84}deg`,
                  "--fauna-scale": `${0.62 + seededValue(seed, index, 44) * 0.66}`,
                } as CSSProperties}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const activePointerId = useRef<number | null>(null);
  const firePointerId = useRef<number | null>(null);
  const shotIdRef = useRef(1);
  const mouseFlightHeldRef = useRef(false);
  const mouseFireHeldRef = useRef(false);
  const surfaceLayerRef = useRef<HTMLElement>(null);
  const atmospherePlayerRef = useRef<HTMLDivElement>(null);
  const atmosphereSurfaceOffsetRef = useRef({ x: 0, y: 0 });
  const cafeMoveRef = useRef({ x: 0, y: 0 });
  const atmosphereMoveRef = useRef({ x: 0, y: 0 });
  const atmosphereVelocityRef = useRef({ x: 0, y: 0 });
  const atmosphereLastDirectionRef = useRef({ x: 0, y: 1 });
  const startedRef = useRef(false);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [diamonds, setDiamonds] = useState(0);
  const [gameError, setGameError] = useState<string | null>(null);
  const [hp, setHp] = useState(100);
  const [plasma, setPlasma] = useState(100);
  const plasmaRef = useRef(100);
  const [inventoryOpen, setInventoryOpen] = useState(() => new URLSearchParams(window.location.search).has("inventory"));
  const [selectedResource, setSelectedResource] = useState<"diamond" | null>(() => (
    new URLSearchParams(window.location.search).get("resource") === "diamond" ? "diamond" : null
  ));
  const [stationNearby, setStationNearby] = useState(false);
  const [planetNearby, setPlanetNearby] = useState(false);
  const [planetVariant, setPlanetVariant] = useState(0);
  const [planetSeed, setPlanetSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [atmosphereOpen, setAtmosphereOpen] = useState(() => cafeParams.has("atmosphere"));
  const [planetMode, setPlanetMode] = useState<PlanetMode>(() => cafeParams.has("atmosphere") ? "planet" : "space");
  const planetModeRef = useRef<PlanetMode>(planetMode);
  const [planetTransitionProgress, setPlanetTransitionProgress] = useState(() => cafeParams.has("atmosphere") ? 1 : 0);
  const planetTransitionProgressRef = useRef(planetTransitionProgress);
  const atmosphereOpenRef = useRef(atmosphereOpen);
  const [atmospherePosition, setAtmospherePosition] = useState({ x: 0, y: 2.7 });
  const atmospherePositionRef = useRef(atmospherePosition);
  const [atmosphereShots, setAtmosphereShots] = useState<AtmosphereShot[]>([]);
  const atmosphereShotsRef = useRef<AtmosphereShot[]>([]);
  const planetFrameTimeEwmaRef = useRef(1 / 60);
  const planetQualityDebtRef = useRef(0);
  const planetLowQualityRef = useRef(false);
  const planetShotLastUpdateRef = useRef(0);
  const planetShotLastRenderRef = useRef(0);
  const [cafeCrewCount, setCafeCrewCount] = useState(() => {
    const count = Number(cafeParams.get("visitors"));
    return Number.isFinite(count) ? Math.max(0, Math.min(3, Math.floor(count))) : 0;
  });
  const [cafeOpen, setCafeOpen] = useState(() => cafeParams.has("cafe"));
  const [cafePosition, setCafePosition] = useState(() => cafeParams.has("bartender") ? CAFE_BARTENDER : { x: 0.3, y: 3.6 });
  const [dialogStep, setDialogStep] = useState<"idle" | "hello" | "farewell">(() => {
    const step = cafeParams.get("dialog");
    return step === "hello" || step === "farewell" ? step : "idle";
  });
  const [barDeclined, setBarDeclined] = useState(false);
  const bartenderDistance = Math.hypot(cafePosition.x - CAFE_BARTENDER.x, cafePosition.y - CAFE_BARTENDER.y);
  const canTalk = cafeOpen && bartenderDistance < CAFE_TALK_RANGE;
  const planetTransitionEased = smootherstep01(planetTransitionProgress);
  const planetIsTransitioning = planetMode === "entering" || planetMode === "leaving";

  useEffect(() => {
    if (canTalk) return;
    if (dialogStep !== "idle") setDialogStep("idle");
    if (barDeclined) setBarDeclined(false);
  }, [barDeclined, canTalk, dialogStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;

    const performanceProfile = getBrowserPerformanceProfile();
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      adaptToDeviceRatio: false,
      premultipliedAlpha: false,
    });
    engine.setHardwareScalingLevel(performanceProfile.hardwareScaling);

    let cancelled = false;
    createGameScene(engine, canvas, setDiamonds, setStationNearby, setCafeCrewCount, (nearby, variant) => {
      setPlanetNearby(nearby);
      if (!atmosphereOpenRef.current) setPlanetVariant(variant);
    }, () => {
      if (plasmaRef.current <= 0) return false;
      plasmaRef.current -= 1;
      setPlasma(plasmaRef.current);
      return true;
    }, (dx, dy) => {
      // Единый выстрел: GameWorld.fireWave уже сыграл звук и списал плазму.
      // На планете canvas перекрыт DOM — рисуем ту же волну-барьер прямо здесь.
      if (!atmosphereOpenRef.current) return;
      const aim = atmosphereLastDirectionRef.current;
      const aimMagnitude = Math.hypot(aim.x, aim.y);
      const direction = aimMagnitude > 0.001 ? { x: aim.x / aimMagnitude, y: aim.y / aimMagnitude } : { x: 0, y: 1 };
      const now = performance.now();
      const nextShots = [
        ...atmosphereShotsRef.current,
        {
          id: shotIdRef.current++,
          x: atmospherePositionRef.current.x + direction.x * SHOT_FRONT_OFFSET,
          y: atmospherePositionRef.current.y + direction.y * SHOT_FRONT_OFFSET,
          dx: direction.x,
          dy: direction.y,
          bornAt: now,
          alpha: 0.68,
        },
      ];
      atmosphereShotsRef.current = nextShots;
      setAtmosphereShots(nextShots);
    }).then((handle) => {
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      handle.setPaused(cafeOpen);
      handle.setAtmosphereActive(atmosphereOpenRef.current);
      setGameError(null);
      engine.runRenderLoop(() => handle.scene.render());
    }).catch(() => {
      if (!cancelled) {
        startedRef.current = false;
        setGameError("не удалось открыть игровое пространство");
      }
    });

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      handleRef.current?.dispose();
      handleRef.current = null;
      engine.dispose();
      startedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const resetHiddenInput = () => {
      activePointerId.current = null;
      firePointerId.current = null;
      mouseFlightHeldRef.current = false;
      mouseFireHeldRef.current = false;
      cafeMoveRef.current = { x: 0, y: 0 };
      atmosphereMoveRef.current = { x: 0, y: 0 };
      handleRef.current?.setMove(0, 0);
      handleRef.current?.setFiring(false);
      setEngineIntensity(0);
      if (knobRef.current) knobRef.current.style.transform = "translate3d(0, 0, 0)";
    };
    const onVisibilityChange = () => {
      if (document.hidden) resetHiddenInput();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", resetHiddenInput);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", resetHiddenInput);
    };
  }, []);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;
    let fade: number | null = null;
    const startMusic = () => {
      audio.volume = 0;
      audio.loop = true;
      audio.play().catch(() => {});
      startMotorHum();
      // Плавный фейд-ин, чтобы музыка не обрушивалась резко.
      if (fade !== null) window.clearInterval(fade);
      fade = window.setInterval(() => {
        const target = 0.16;
        audio.volume = Math.min(target, audio.volume + 0.012);
        if (audio.volume >= target && fade !== null) {
          window.clearInterval(fade);
          fade = null;
        }
      }, 120);
      window.removeEventListener("pointerdown", startMusic);
      window.removeEventListener("keydown", startMusic);
    };
    window.addEventListener("pointerdown", startMusic, { once: true });
    window.addEventListener("keydown", startMusic, { once: true });
    return () => {
      window.removeEventListener("pointerdown", startMusic);
      window.removeEventListener("keydown", startMusic);
      if (fade !== null) window.clearInterval(fade);
    };
  }, []);

  useEffect(() => {
    if (planetMode !== "entering" && planetMode !== "leaving") return;

    let frame = 0;
    let lastFrameAt = performance.now();
    const target = planetMode === "entering" ? 1 : 0;
    const animateTransition = (now: number) => {
      const deltaSeconds = Math.min(0.035, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      const nextProgress = expApproach(planetTransitionProgressRef.current, target, PLANET_TRANSITION_RESPONSE, deltaSeconds);
      planetTransitionProgressRef.current = nextProgress;
      setPlanetTransitionProgress(nextProgress);

      if (Math.abs(target - nextProgress) < 0.002) {
        planetTransitionProgressRef.current = target;
        setPlanetTransitionProgress(target);
        if (target === 1) {
          planetModeRef.current = "planet";
          setPlanetMode("planet");
        } else {
          atmosphereOpenRef.current = false;
          setAtmosphereOpen(false);
          handleRef.current?.setAtmosphereActive(false);
          planetModeRef.current = "space";
          setPlanetMode("space");
          musicRef.current?.play().catch(() => {});
        }
        return;
      }
      frame = requestAnimationFrame(animateTransition);
    };

    frame = requestAnimationFrame(animateTransition);
    return () => cancelAnimationFrame(frame);
  }, [planetMode]);

  useEffect(() => {
    if (!cafeOpen) {
      cafeMoveRef.current = { x: 0, y: 0 };
      return;
    }

    let frame = 0;
    let lastFrameAt = performance.now();
    const constrainToCafe = () => setCafePosition((position) => clampCafePosition(position));
    const moveInsideCafe = (now: number) => {
      const deltaSeconds = Math.min(0.035, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      const { x, y } = cafeMoveRef.current;
      if (Math.hypot(x, y) > 0.03) {
        setCafePosition((position) => clampCafePosition({
          x: position.x + (x * CAFE_MOVE_SPEED * deltaSeconds) / 22,
          y: position.y + (y * CAFE_MOVE_SPEED * deltaSeconds) / 20,
        }));
      }
      frame = requestAnimationFrame(moveInsideCafe);
    };
    constrainToCafe();
    window.addEventListener("resize", constrainToCafe);
    frame = requestAnimationFrame(moveInsideCafe);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", constrainToCafe);
    };
  }, [cafeOpen]);

  useEffect(() => {
    if (!atmosphereOpen) {
      atmosphereMoveRef.current = { x: 0, y: 0 };
      atmosphereVelocityRef.current = { x: 0, y: 0 };
      return;
    }

    let frame = 0;
    let lastFrameAt = performance.now();
    const moveInAtmosphere = (now: number) => {
      const deltaSeconds = Math.min(0.035, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      const target = atmosphereMoveRef.current;
      const targetMagnitude = Math.hypot(target.x, target.y);
      if (targetMagnitude > 0.12) {
        atmosphereLastDirectionRef.current = {
          x: target.x / targetMagnitude,
          y: target.y / targetMagnitude,
        };
      }

      const planetScale = getPlanetCameraScale();
      const velocity = atmosphereVelocityRef.current;
      velocity.x = expApproach(velocity.x, target.x, 5.4, deltaSeconds);
      velocity.y = expApproach(velocity.y, target.y, 5.4, deltaSeconds);
      const nextPosition = {
        x: expApproach(atmospherePositionRef.current.x, target.x * 5.4, 2.6, deltaSeconds),
        y: expApproach(atmospherePositionRef.current.y, target.y * 3.6, 2.6, deltaSeconds),
      };
      planetFrameTimeEwmaRef.current = expApproach(planetFrameTimeEwmaRef.current, deltaSeconds, 8, deltaSeconds);
      const frameIsSlow = planetFrameTimeEwmaRef.current > 0.022;
      planetQualityDebtRef.current = Math.max(-2, Math.min(2, planetQualityDebtRef.current + (frameIsSlow ? deltaSeconds : -deltaSeconds * 0.5)));
      if (planetQualityDebtRef.current > 0.75) planetLowQualityRef.current = true;
      if (planetQualityDebtRef.current < -1) planetLowQualityRef.current = false;
      atmospherePositionRef.current = nextPosition;
      if (atmospherePlayerRef.current) {
        atmospherePlayerRef.current.style.transform = `translate3d(calc(-50% + ${nextPosition.x * planetScale}px), calc(-50% - ${nextPosition.y * planetScale}px), 0)`;
      }

      const movement = 5.25 * deltaSeconds;
      atmosphereSurfaceOffsetRef.current = {
        x: wrapSurfaceCoordinate(atmosphereSurfaceOffsetRef.current.x + velocity.x * movement * planetScale, PLANET_WORLD_WIDTH),
        y: wrapSurfaceCoordinate(atmosphereSurfaceOffsetRef.current.y - velocity.y * movement * planetScale, PLANET_WORLD_HEIGHT),
      };
      if (surfaceLayerRef.current) {
        surfaceLayerRef.current.style.setProperty("--surface-x", `${atmosphereSurfaceOffsetRef.current.x}px`);
        surfaceLayerRef.current.style.setProperty("--surface-y", `${atmosphereSurfaceOffsetRef.current.y}px`);
        surfaceLayerRef.current.classList.toggle("planet-low-quality", planetLowQualityRef.current);
      }
      // Тот же отклик двигателя, что и в космосе: интенсивность равна модулю скорости.
      setEngineIntensity(Math.min(1, Math.hypot(velocity.x, velocity.y)));
      // Волны выстрелов на планете двигаются и гаснут; спавн — из onShoot (единый выстрел).
      if (atmosphereShotsRef.current.length > 0) {
        const shotDelta = planetShotLastUpdateRef.current > 0
          ? Math.min(0.05, Math.max(0, (now - planetShotLastUpdateRef.current) / 1000))
          : deltaSeconds;
        planetShotLastUpdateRef.current = now;
        atmosphereShotsRef.current = atmosphereShotsRef.current
          .map((shot) => ({
            ...shot,
            x: shot.x + shot.dx * shotDelta * SHOT_SPEED,
            y: shot.y + shot.dy * shotDelta * SHOT_SPEED,
            alpha: 0.68 * (1 - smootherstep01((now - shot.bornAt) / SHOT_DURATION_MS)),
          }))
          .filter((shot) => now - shot.bornAt < SHOT_DURATION_MS);
        if (now - planetShotLastRenderRef.current >= PLANET_RENDER_PROFILE.planetShotRenderInterval * 1000) {
          planetShotLastRenderRef.current = now;
          setAtmosphereShots(atmosphereShotsRef.current);
        }
      }
      frame = requestAnimationFrame(moveInAtmosphere);
    };
    frame = requestAnimationFrame(moveInAtmosphere);
    return () => cancelAnimationFrame(frame);
  }, [atmosphereOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cafeOpen) return;

    const isInterfaceTarget = (target: EventTarget | null) => (
      target instanceof Element
      && Boolean(target.closest("button, a, input, textarea, select, [role='button'], .joystick-zone, .inventory-panel"))
    );

    const flyTowardCursor = (event: MouseEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const offsetX = event.clientX - (bounds.left + bounds.width / 2);
      const offsetY = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(offsetX, offsetY);
      const strength = applyControlCurve(distance, MOUSE_DEAD_ZONE, MOUSE_FULL_REACH);
      if (strength === 0) {
        if (atmosphereOpen) atmosphereMoveRef.current = { x: 0, y: 0 };
        else handleRef.current?.setMove(0, 0);
        return;
      }
      const move = { x: (offsetX / distance) * strength, y: (-offsetY / distance) * strength };
      if (atmosphereOpen) atmosphereMoveRef.current = move;
      else handleRef.current?.setMove(move.x, move.y);
    };

    const stopMouseControls = () => {
      mouseFlightHeldRef.current = false;
      mouseFireHeldRef.current = false;
      firePointerId.current = null;
      atmosphereMoveRef.current = { x: 0, y: 0 };
      handleRef.current?.setMove(0, 0);
      handleRef.current?.setFiring(false);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (isInterfaceTarget(event.target)) return;
      if (event.button === 0) {
        mouseFireHeldRef.current = true;
        handleRef.current?.setFiring(true);
      }
      if (event.button === 2) {
        event.preventDefault();
        mouseFlightHeldRef.current = true;
        flyTowardCursor(event);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (mouseFlightHeldRef.current) flyTowardCursor(event);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0 && mouseFireHeldRef.current) {
        mouseFireHeldRef.current = false;
        handleRef.current?.setFiring(false);
      }
      if (event.button === 2 && mouseFlightHeldRef.current) {
        mouseFlightHeldRef.current = false;
        if (atmosphereOpen) atmosphereMoveRef.current = { x: 0, y: 0 };
        else handleRef.current?.setMove(0, 0);
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!isInterfaceTarget(event.target)) event.preventDefault();
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", stopMouseControls);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("blur", stopMouseControls);
      window.removeEventListener("contextmenu", onContextMenu, true);
      stopMouseControls();
    };
  }, [atmosphereOpen, cafeOpen]);

  const setKnob = (x: number, y: number) => {
    if (knobRef.current) {
      knobRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  };

  const resetJoystick = (pointerId?: number) => {
    if (pointerId !== undefined && activePointerId.current !== pointerId) return;
    activePointerId.current = null;
    cafeMoveRef.current = { x: 0, y: 0 };
    atmosphereMoveRef.current = { x: 0, y: 0 };
    setKnob(0, 0);
    handleRef.current?.setMove(0, 0);
  };

  const setActiveMove = (x: number, y: number) => {
    if (cafeOpen) {
      cafeMoveRef.current = { x, y };
      return;
    }
    if (atmosphereOpen) {
      atmosphereMoveRef.current = { x, y };
      return;
    }
    handleRef.current?.setMove(x, y);
  };

  const enterCafe = () => {
    firePointerId.current = null;
    handleRef.current?.setFiring(false);
    resetJoystick();
    handleRef.current?.setPaused(true);
    setCafePosition(clampCafePosition({ x: 0.3, y: 3.6 }));
    setDialogStep("idle");
    setBarDeclined(false);
    cafeMoveRef.current = { x: 0, y: 0 };
    setCafeOpen(true);
  };

  const leaveCafe = () => {
    firePointerId.current = null;
    handleRef.current?.setFiring(false);
    resetJoystick();
    setDialogStep("idle");
    setBarDeclined(false);
    cafeMoveRef.current = { x: 0, y: 0 };
    setCafeOpen(false);
    handleRef.current?.setPaused(false);
  };

  const enterAtmosphere = () => {
    if (planetMode !== "space" || cafeOpen) return;
    firePointerId.current = null;
    handleRef.current?.setFiring(false);
    resetJoystick();
    atmosphereOpenRef.current = true;
    musicRef.current?.pause();
    handleRef.current?.setAtmosphereActive(true);
    atmosphereMoveRef.current = { x: 0, y: 0 };
    atmosphereVelocityRef.current = { x: 0, y: 0 };
    atmosphereLastDirectionRef.current = { x: 0, y: 1 };
    atmosphereSurfaceOffsetRef.current = { x: 0, y: 0 };
    atmosphereShotsRef.current = [];
    planetShotLastUpdateRef.current = 0;
    planetShotLastRenderRef.current = 0;
    setAtmosphereShots([]);
    setAtmospherePosition({ x: 0, y: 0 });
    atmospherePositionRef.current = { x: 0, y: 0 };
    setPlanetVariant((variant) => (variant + 1) % 2);
    setPlanetSeed((previousSeed) => {
      const nextSeed = Math.floor(Math.random() * 1_000_000);
      return nextSeed === previousSeed ? previousSeed + 1 : nextSeed;
    });
    planetTransitionProgressRef.current = 0;
    setPlanetTransitionProgress(0);
    planetModeRef.current = "entering";
    setPlanetMode("entering");
    setAtmosphereOpen(true);
  };

  const leaveAtmosphere = () => {
    if (planetMode !== "planet") return;
    firePointerId.current = null;
    handleRef.current?.setFiring(false);
    resetJoystick();
    atmosphereMoveRef.current = { x: 0, y: 0 };
    atmosphereShotsRef.current = [];
    planetShotLastUpdateRef.current = 0;
    planetShotLastRenderRef.current = 0;
    setAtmosphereShots([]);
    planetTransitionProgressRef.current = 1;
    setPlanetTransitionProgress(1);
    planetModeRef.current = "leaving";
    setPlanetMode("leaving");
  };

  const updateJoystick = (clientX: number, clientY: number) => {
    const joystick = joystickRef.current;
    if (!joystick) return;

    const bounds = joystick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const maxDistance = JOYSTICK_RADIUS;
    const rawX = clientX - centerX;
    const rawY = clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const factor = distance > maxDistance ? maxDistance / distance : 1;
    const x = rawX * factor;
    const y = rawY * factor;
    const clampedDistance = Math.min(distance, maxDistance);

    setKnob(x, y);
    const response = applyControlCurve(distance, maxDistance * JOYSTICK_DEAD_ZONE, maxDistance);
    const directionX = clampedDistance ? (x / clampedDistance) * response : 0;
    const directionY = clampedDistance ? (y / clampedDistance) * response : 0;
    const joystickMove = { x: directionX, y: -directionY };
    setActiveMove(joystickMove.x, joystickMove.y);
  };

  const stopFiring = (pointerId?: number) => {
    if (pointerId !== undefined && firePointerId.current !== pointerId) return;
    firePointerId.current = null;
    handleRef.current?.setFiring(false);
  };

  return (
    <main
      className={`game-shell${planetIsTransitioning ? " is-planet-transitioning" : ""}`}
      style={{ backgroundImage: `url(${ASSETS.abyss})` }}
      aria-label="Игра Endless Dark Square"
    >
      <div className="void-wash" aria-hidden="true" />
      <audio ref={musicRef} src={ASSETS.music} preload="auto" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Игровое пространство"
        style={{ opacity: atmosphereOpen ? 1 - planetTransitionEased : 1 }}
      />

      {gameError ? (
        <section className="game-error" role="alert" aria-live="assertive">
          <p>{gameError}</p>
          <button type="button" onClick={() => window.location.reload()}>перезапустить</button>
        </section>
      ) : null}

      {atmosphereOpen ? (
        <section
          ref={surfaceLayerRef}
          className={`atmosphere-interior atmosphere-variant-${planetVariant}`}
          aria-label="Нижняя атмосфера планеты"
          style={{
            opacity: planetTransitionEased,
            transform: `scale(${0.94 + planetTransitionEased * 0.06})`,
            filter: `blur(${(1 - planetTransitionEased) * 5}px)`,
          }}
        >
          <PlanetWorld seed={planetSeed} />
          <div
            ref={atmospherePlayerRef}
            className="atmosphere-player"
            aria-hidden="true"
            style={{ transform: `translate3d(calc(-50% + ${atmospherePosition.x * getPlanetCameraScale()}px), calc(-50% - ${atmospherePosition.y * getPlanetCameraScale()}px), 0)` }}
          >
            <span className="atmosphere-player-inner" />
            <i className="atmosphere-player-fragment" />
          </div>
          {atmosphereShots.map((shot) => {
            const shotPixelScale = getPlanetCameraScale();
            return (
            <i
              key={`atmosphere-shot-${shot.id}`}
              className="atmosphere-shot"
              aria-hidden="true"
              style={{
                width: `${SHOT_WIDTH_WORLD * getPlanetCameraScale()}px`,
                opacity: shot.alpha,
                transform: `translate3d(calc(-50% + ${shot.x * shotPixelScale}px), calc(-50% - ${shot.y * shotPixelScale}px), 0) rotate(${(Math.atan2(-shot.dx, shot.dy) * 180) / Math.PI}deg)`,
              }}
            />
            );
          })}
          <p className="atmosphere-sign">низкая орбита · замкнутый биом</p>
          <button className="atmosphere-exit" type="button" onClick={leaveAtmosphere}>на орбиту</button>
          <p className="atmosphere-hint" aria-hidden="true">пкм / джойстик — курс · мир замкнут</p>
        </section>
      ) : null}

      {cafeOpen ? (
        <section className="cafe-interior" aria-label="Кафе на базе">
          <div className="cafe-depth" aria-hidden="true" />
          <p className="cafe-sign">coffee station</p>
          <div className="cafe-bar" aria-hidden="true"><span /><em /></div>
          <div className="cafe-bartender" aria-hidden="true"><i /></div>
          <span className="cafe-bartender-label" aria-hidden="true">бармен</span>
          {CAFE_PILOT_SIDES.slice(0, cafeCrewCount).map((pilot, index) => (
            <Fragment key={`pilot-${index}`}>
              <div
                className="cafe-pilot cafe-pilot-side"
                aria-hidden="true"
                style={{ left: `calc(50% + ${pilot.x * 22}px)`, top: `calc(50% + ${pilot.y * 20}px)` }}
              ><i /></div>
              <span
                className="cafe-pilot-label"
                aria-hidden="true"
                style={{ left: `calc(50% + ${pilot.x * 22}px)`, top: `calc(50% + ${pilot.y * 20 - 22}px)` }}
              >{pilot.name}</span>
            </Fragment>
          ))}
          <div
            className="cafe-player"
            aria-hidden="true"
            style={{ transform: `translate3d(calc(-50% + ${cafePosition.x * 22}px), calc(-50% + ${cafePosition.y * 20}px), 0)` }}
          />
          <button className="cafe-exit" type="button" onClick={leaveCafe}>наружу</button>
          {canTalk && dialogStep === "idle" && !barDeclined ? (
            <div className="bartender-choice">
              <p>бармен</p>
              <button type="button" onClick={() => setDialogStep("hello")}>говорить</button>
              <button type="button" onClick={() => setBarDeclined(true)}>отказаться</button>
            </div>
          ) : null}
          {dialogStep !== "idle" ? (
            <div className="cafe-dialog" role="dialog" aria-label="Разговор с барменом">
              {dialogStep === "hello" ? (
                <>
                  <p><span>бармен</span>как дела?</p>
                  <button type="button" onClick={() => setDialogStep("farewell")}>нормально</button>
                </>
              ) : (
                <>
                  <p><span>бармен</span>всего хорошего.</p>
                  <button type="button" onClick={() => setDialogStep("idle")}>закрыть</button>
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {!cafeOpen && !atmosphereOpen ? <p className="direction-hint" aria-hidden="true">
        держи направление
      </p> : atmosphereOpen ? null : <p className="cafe-hint" aria-hidden="true">подойди к бармену</p>}

      {!cafeOpen && !atmosphereOpen ? <p className="desktop-hint" aria-hidden="true">
        пкм — курс · лкм — импульс
      </p> : null}

      <p className="orientation-note" aria-hidden="true">
        поверни экран
      </p>

      {stationNearby && !cafeOpen && !atmosphereOpen ? (
        <button className="station-enter" type="button" onClick={enterCafe}>
          войти
        </button>
      ) : null}

      {planetNearby && !cafeOpen && !atmosphereOpen ? (
        <button className="planet-enter" type="button" onClick={enterAtmosphere}>
          в атмосферу
        </button>
      ) : null}

      {!cafeOpen && !atmosphereOpen ? (
        <button
          className="planet-test-trigger"
          type="button"
          onClick={enterAtmosphere}
        >
          планета
        </button>
      ) : null}

      <button
        className="inventory-trigger"
        type="button"
        aria-expanded={inventoryOpen}
        aria-controls="player-inventory"
        onClick={() => {
          setInventoryOpen((open) => !open);
          setSelectedResource(null);
        }}
      >
        <span>инв.</span>
      </button>

      {inventoryOpen ? (
        <section id="player-inventory" className="inventory-panel" aria-label="Инвентарь игрока">
          <p className="inventory-title">сумка</p>
          <div className="bag-grid" aria-label="Ячейки сумки">
            {Array.from({ length: 6 }, (_, index) => {
              const occupied = index === 0 && diamonds > 0;
              return occupied ? (
                <button
                  key={index}
                  type="button"
                  className={`bag-slot is-occupied${selectedResource === "diamond" ? " is-selected" : ""}`}
                  aria-label={`Кристаллы: ${diamonds}. Открыть сведения.`}
                  onClick={() => setSelectedResource("diamond")}
                >
                  <span className="diamond-glyph" aria-hidden="true" />
                  <b>{diamonds}</b>
                </button>
              ) : (
                <span key={index} className="bag-slot" aria-hidden="true" />
              );
            })}
          </div>
          {selectedResource === "diamond" ? (
            <div className="resource-note" role="status">
              <p>кристалл</p>
              <span>осколок после летуна. у базы молчит.</span>
            </div>
          ) : (
            <p className="inventory-footnote">коснись найденного</p>
          )}
        </section>
      ) : null}

      <div className="stat-bars" aria-label="Здоровье и плазма">
        <div className="stat-bar stat-bar-hp" role="meter" aria-label="Здоровье" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={100}>
          <span className="stat-bar-fill" style={{ height: `${hp}%` }} />
        </div>
        <div className="stat-bar stat-bar-plasma" role="meter" aria-label="Плазма" aria-valuenow={plasma} aria-valuemin={0} aria-valuemax={100}>
          <span className="stat-bar-fill" style={{ height: `${plasma}%` }} />
        </div>
      </div>

      <div
        ref={joystickRef}
        className="joystick-zone"
        role="application"
        aria-label="Джойстик направления"
        onPointerDown={(event) => {
          if (activePointerId.current !== null) return;
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateJoystick(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerId === activePointerId.current) {
            updateJoystick(event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerId === activePointerId.current) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            resetJoystick(event.pointerId);
          }
        }}
        onPointerCancel={(event) => resetJoystick(event.pointerId)}
        onLostPointerCapture={(event) => resetJoystick(event.pointerId)}
      >
        <img className="joystick-halo" src={ASSETS.joystick} alt="" draggable={false} />
        <span className="joystick-cardinal joystick-cardinal-north" aria-hidden="true">с</span>
        <span className="joystick-cardinal joystick-cardinal-east" aria-hidden="true">в</span>
        <span className="joystick-cardinal joystick-cardinal-south" aria-hidden="true">ю</span>
        <span className="joystick-cardinal joystick-cardinal-west" aria-hidden="true">з</span>
        <div ref={knobRef} className="joystick-knob" aria-hidden="true" />
      </div>

      {!cafeOpen ? <button
        className="fire-zone"
        type="button"
        aria-label="Огонь: удерживайте, чтобы стрелять"
        onPointerDown={(event) => {
          if (firePointerId.current !== null) return;
          firePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          handleRef.current?.setFiring(true);
        }}
        onPointerUp={(event) => {
          if (event.pointerId === firePointerId.current) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            stopFiring(event.pointerId);
          }
        }}
        onPointerCancel={(event) => stopFiring(event.pointerId)}
        onLostPointerCapture={(event) => stopFiring(event.pointerId)}
      >
        <span className="fire-ring" aria-hidden="true" />
        <span className="fire-word">имп.</span>
      </button> : null}

      <img className="void-logo" src={ASSETS.logo} alt="" draggable={false} />
    </main>
  );
}
