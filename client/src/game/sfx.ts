// Синтез звуков через Web Audio API — нулевая задержка, точная синхронизация.
let shotContext: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getShotContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!shotContext) {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    shotContext = new AudioContextClass();
    // Короткий белый шум — база для "хлопка" выстрела.
    const length = Math.floor(shotContext.sampleRate * 0.12);
    noiseBuffer = shotContext.createBuffer(1, length, shotContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (shotContext.state === "suspended") shotContext.resume().catch(() => {});
  return shotContext;
}

// Лёгкое гудение вибро-двигателя: низкий тон + амплитудное дрожание, как моторчик.
// intensity (0..1) — тяга: на месте гудит ровно и тихо, в полёте — выше тон и дрожание сильнее.
let engineIntensity = 0;

interface HumNodes {
  osc: OscillatorNode;
  gain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
}

let humNodes: HumNodes | null = null;

export function startMotorHum() {
  const context = getShotContext();
  if (!context || humNodes) return;

  // Низкий гул — базовая вибрация.
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 56;
  const gain = context.createGain();
  gain.gain.value = 0;

  // LFO дёргает громкость — имитация неровной вибрации моторчика.
  const lfo = context.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 8.5;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  osc.connect(gain);
  gain.connect(context.destination);

  // Плавное появление, чтобы гул не "прихлопывал" по ушам.
  const now = context.currentTime;
  gain.gain.linearRampToValueAtTime(0.03, now + 4.5);

  osc.start();
  lfo.start();
  humNodes = { osc, gain, lfo, lfoGain };
}

// Плавно подстраивает звук двигателя под текущую тягу (0 — стоит, 1 — полный ход).
export function setEngineIntensity(intensity: number) {
  if (!humNodes) return;
  engineIntensity = Math.max(0, Math.min(1, intensity));
  const { osc, gain, lfo, lfoGain } = humNodes;
  const now = shotContext?.currentTime ?? 0;

  osc.frequency.setTargetAtTime(52 + engineIntensity * 40, now, 0.1);
  lfo.frequency.setTargetAtTime(7.5 + engineIntensity * 12, now, 0.1);
  lfoGain.gain.setTargetAtTime(0.012 + engineIntensity * 0.055, now, 0.1);
  gain.gain.setTargetAtTime(0.018 + engineIntensity * 0.085, now, 0.1);
}

export function stopMotorHum() {
  if (!humNodes) return;
  engineIntensity = 0;
  const { osc, gain, lfo, lfoGain } = humNodes;
  const now = shotContext?.currentTime ?? 0;
  gain.gain.setTargetAtTime(0, now, 0.4);
  osc.stop(now + 2);
  lfo.stop(now + 2);
  lfoGain.disconnect();
  humNodes = null;
}

export function playShot(lifespan = 0.72) {
  const context = getShotContext();
  if (!context || !noiseBuffer) return;

  const now = context.currentTime;
  const end = now + lifespan;
  const attack = 0.012;

  // Общая огибающая: резкий пуск, тело держится и гаснет к концу жизни волны.
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(0.24, now + attack);
  envelope.gain.exponentialRampToValueAtTime(0.055, now + lifespan * 0.35);
  envelope.gain.exponentialRampToValueAtTime(0.001, end);
  envelope.connect(context.destination);

  // 1. Хлопок атаки — короткий шумовой транзиент, даёт "удар" вылета пучка.
  const noiseSource = context.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 2400;
  noiseFilter.Q.value = 0.9;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(envelope);
  noiseSource.start(now);
  noiseSource.stop(now + 0.08);

  // 2. Плазменный свип — плотный sawtooth, стремительный спуск 900→90 Гц.
  const plasmaOsc = context.createOscillator();
  plasmaOsc.type = "sawtooth";
  plasmaOsc.frequency.setValueAtTime(900, now);
  plasmaOsc.frequency.exponentialRampToValueAtTime(90, now + lifespan * 0.6);
  const plasmaFilter = context.createBiquadFilter();
  plasmaFilter.type = "lowpass";
  plasmaFilter.frequency.setValueAtTime(2600, now);
  plasmaFilter.frequency.exponentialRampToValueAtTime(320, now + lifespan * 0.6);
  const plasmaGain = context.createGain();
  plasmaGain.gain.value = 0.3;
  plasmaOsc.connect(plasmaFilter);
  plasmaFilter.connect(plasmaGain);
  plasmaGain.connect(envelope);
  plasmaOsc.start(now);
  plasmaOsc.stop(end);

  // 2б. "Мясо" — второй слой того же свипа октавой выше, даёт толщину, а не писк.
  const meatOsc = context.createOscillator();
  meatOsc.type = "sawtooth";
  meatOsc.frequency.setValueAtTime(1800, now);
  meatOsc.frequency.exponentialRampToValueAtTime(180, now + lifespan * 0.6);
  const meatFilter = context.createBiquadFilter();
  meatFilter.type = "lowpass";
  meatFilter.frequency.setValueAtTime(1800, now);
  meatFilter.frequency.exponentialRampToValueAtTime(240, now + lifespan * 0.6);
  const meatGain = context.createGain();
  meatGain.gain.value = 0.12;
  meatOsc.connect(meatFilter);
  meatFilter.connect(meatGain);
  meatGain.connect(envelope);
  meatOsc.start(now);
  meatOsc.stop(end);

  // 3. Суб-бас удар — глубина, чтобы выстрел ощущался телом, а не пищал.
  const subOsc = context.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.setValueAtTime(130, now);
  subOsc.frequency.exponentialRampToValueAtTime(36, now + lifespan * 0.55);
  const subGain = context.createGain();
  subGain.gain.value = 0.7;
  subOsc.connect(subGain);
  subGain.connect(envelope);
  subOsc.start(now);
  subOsc.stop(end);

  // 4. Короткий "звон" ствола — стальная гармоника на самом пуске.
  const pingOsc = context.createOscillator();
  pingOsc.type = "square";
  pingOsc.frequency.setValueAtTime(320, now);
  pingOsc.frequency.exponentialRampToValueAtTime(90, now + 0.09);
  const pingGain = context.createGain();
  pingGain.gain.setValueAtTime(0.1, now);
  pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  pingOsc.connect(pingGain);
  pingGain.connect(envelope);
  pingOsc.start(now);
  pingOsc.stop(now + 0.15);
}

export function disposeShotAudio() {
  stopMotorHum();
  shotContext?.close().catch(() => {});
  shotContext = null;
  noiseBuffer = null;
}

// Тактильный отклик на полёт: вибрация телефона пропорциональна скорости.
// Тикаем не чаще раза в ~200мс — браузерные паттерны вибрации не бесконечные,
// и частые вызовы лишь перезапускают одну и ту же вибрацию.
let lastVibrationAt = 0;

export function vibrateForSpeed(speed: number) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const clamped = Math.max(0, Math.min(1, speed));
  const now = performance.now();
  if (clamped < 0.05) {
    lastVibrationAt = 0;
    navigator.vibrate(0);
    return;
  }
  if (now - lastVibrationAt < 200) return;
  lastVibrationAt = now;
  // Чем выше скорость — тем дольше импульс: 10мс на месте, ~48мс на полном ходу.
  navigator.vibrate(Math.round(8 + clamped * 40));
}
