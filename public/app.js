const APP_VERSION = "4.2.0";
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0b0a09");
  tg.setBackgroundColor?.("#090807");
  tg.setBottomBarColor?.("#100e0c");
  tg.disableVerticalSwipes?.();
  tg.enableClosingConfirmation?.();
  if (tg.isVersionAtLeast?.("8.0")) {
    try {
      tg.lockOrientation?.();
      setTimeout(() => tg.requestFullscreen?.(), 180);
    } catch {}
  }
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const icon = (name, className = "ui-icon") =>
  `<svg class="${className}" aria-hidden="true"><use href="/assets/icons.svg#${name}"></use></svg>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
const fmtDate = (value) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const opId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const devUser =
  new URLSearchParams(location.search).get("user") ||
  localStorage.getItem("ef_dev_user") ||
  "10001";

const prefersReducedMotion = matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const memory = Number(navigator.deviceMemory || 4);
const cores = Number(navigator.hardwareConcurrency || 4);
const lowPerformance = memory <= 2 || cores <= 2;
const savedMotion = localStorage.getItem("ef_reduce_motion");
const reduceMotion =
  savedMotion == null
    ? prefersReducedMotion || lowPerformance
    : savedMotion === "1";
document.body.classList.toggle("reduce-motion", reduceMotion);
document.body.classList.toggle("low-performance", lowPerformance);

let telegramInitData = "";
function initDataFromLaunchParams() {
  for (const raw of [
    location.hash.replace(/^#/, ""),
    location.search.replace(/^\?/, ""),
  ]) {
    if (!raw) continue;
    const params = new URLSearchParams(raw);
    const value = params.get("tgWebAppData");
    if (value) return value;
  }
  return "";
}
function resolveTelegramInitData() {
  const value =
    window.Telegram?.WebApp?.initData ||
    initDataFromLaunchParams() ||
    sessionStorage.getItem("ef_tg_init_data") ||
    "";
  if (value) {
    telegramInitData = value;
    sessionStorage.setItem("ef_tg_init_data", value);
  }
  return value;
}
async function waitForTelegramInitData(timeoutMs = 8000) {
  const started = Date.now();
  let value = resolveTelegramInitData();
  while (!value && Date.now() - started < timeoutMs) {
    await wait(100);
    value = resolveTelegramInitData();
  }
  return value;
}
function telegramDiagnostics() {
  return {
    sdk: Boolean(window.Telegram?.WebApp),
    platform: window.Telegram?.WebApp?.platform || "unknown",
    version: window.Telegram?.WebApp?.version || "unknown",
    initDataLength: resolveTelegramInitData().length,
    launchParam: Boolean(initDataFromLaunchParams()),
    visibility: document.visibilityState,
    online: navigator.onLine,
    appVersion: APP_VERSION,
  };
}

const SOUND_CUES = {
  uiTap: { assets: ["ui-tap-01", "ui-tap-02", "ui-tap-03"], bus: "ui", volume: 0.34, cooldown: 26, polyphony: 5, rateJitter: 0.025 },
  uiPrimary: { assets: ["ui-primary"], bus: "ui", volume: 0.54, cooldown: 70, polyphony: 2 },
  uiTab: { assets: ["ui-tab"], bus: "ui", volume: 0.42, cooldown: 80, polyphony: 2, rateJitter: 0.018 },
  uiBack: { assets: ["ui-back"], bus: "ui", volume: 0.44, cooldown: 80 },
  uiOpen: { assets: ["ui-open"], bus: "ui", volume: 0.48, cooldown: 90 },
  uiClose: { assets: ["ui-close"], bus: "ui", volume: 0.44, cooldown: 90 },
  uiToggleOn: { assets: ["ui-toggle-on"], bus: "ui", volume: 0.48, cooldown: 70 },
  uiToggleOff: { assets: ["ui-toggle-off"], bus: "ui", volume: 0.45, cooldown: 70 },
  uiSlider: { assets: ["ui-slider"], bus: "ui", volume: 0.22, cooldown: 55, polyphony: 1, rateJitter: 0.05 },
  uiSuccess: { assets: ["ui-success"], bus: "ui", volume: 0.58, cooldown: 260, duck: 0.06 },
  uiError: { assets: ["ui-error"], bus: "ui", volume: 0.62, cooldown: 260, duck: 0.08 },
  uiWarning: { assets: ["ui-warning"], bus: "ui", volume: 0.54, cooldown: 220 },
  uiNotification: { assets: ["ui-notification"], bus: "ui", volume: 0.45, cooldown: 250 },
  uiCard: { assets: ["ui-card"], bus: "ui", volume: 0.34, cooldown: 80 },
  uiDisabled: { assets: ["ui-disabled"], bus: "ui", volume: 0.36, cooldown: 120 },

  elevatorButton: { assets: ["elevator-button"], volume: 0.68, cooldown: 120, reverb: 0.08 },
  elevatorTravel: { assets: ["elevator-travel"], volume: 0.82, cooldown: 700, polyphony: 1, duck: 0.22, reverb: 0.08 },
  elevatorBrake: { assets: ["elevator-brake"], volume: 0.54, cooldown: 550, reverb: 0.18 },
  floorTick: { assets: ["floor-tick-01", "floor-tick-02", "floor-tick-03"], volume: 0.43, cooldown: 100, polyphony: 2, rateJitter: 0.025, reverb: 0.08 },
  elevatorArrive: { assets: ["elevator-arrive"], volume: 0.62, cooldown: 500, duck: 0.12, reverb: 0.18 },
  elevatorBell: { assets: ["elevator-bell"], volume: 0.56, cooldown: 550, reverb: 0.28 },
  doorOpen: { assets: ["door-open"], volume: 0.82, cooldown: 240, duck: 0.12, reverb: 0.3 },
  doorClose: { assets: ["door-close"], volume: 0.78, cooldown: 240, duck: 0.1, reverb: 0.27 },
  doorLock: { assets: ["door-lock"], volume: 0.6, cooldown: 150, reverb: 0.16 },
  keyTurn: { assets: ["key-turn"], volume: 0.58, cooldown: 120, reverb: 0.12 },
  roomShift: { assets: ["room-shift"], volume: 0.76, cooldown: 450, duck: 0.2, reverb: 0.3 },
  dangerHit: { assets: ["danger-hit"], volume: 0.75, cooldown: 500, duck: 0.3, reverb: 0.35 },
  camera: { assets: ["camera"], volume: 0.62, cooldown: 180, reverb: 0.12 },
  paper: { assets: ["paper"], volume: 0.48, cooldown: 120, reverb: 0.07 },
  pageTurn: { assets: ["page-turn"], volume: 0.42, cooldown: 100, reverb: 0.05 },
  itemPickup: { assets: ["item-pickup"], volume: 0.5, cooldown: 120 },
  itemPlace: { assets: ["item-place"], volume: 0.56, cooldown: 130, reverb: 0.09 },
  inventoryOpen: { assets: ["inventory-open"], volume: 0.45, cooldown: 180 },
  clueFound: { assets: ["clue-found"], volume: 0.68, cooldown: 400, duck: 0.08, reverb: 0.18 },
  nerveDrop: { assets: ["nerve-drop"], volume: 0.58, cooldown: 380, reverb: 0.22 },
  dangerRise: { assets: ["danger-rise"], volume: 0.54, cooldown: 360, reverb: 0.28 },
  escape: { assets: ["escape"], volume: 0.72, cooldown: 900, duck: 0.2, reverb: 0.18 },
  failure: { assets: ["failure"], volume: 0.8, cooldown: 900, duck: 0.34, reverb: 0.34 },
  achievement: { assets: ["achievement"], volume: 0.66, cooldown: 650, duck: 0.12 },
  collectionComplete: { assets: ["collection-complete"], volume: 0.7, cooldown: 650, duck: 0.12 },
  purchaseStars: { assets: ["purchase-stars"], volume: 0.72, cooldown: 650, duck: 0.14 },
  marks: { assets: ["marks"], volume: 0.5, cooldown: 180 },
  vote: { assets: ["vote"], volume: 0.46, cooldown: 140 },
  messageSend: { assets: ["message-send"], volume: 0.48, cooldown: 160 },
  coopJoin: { assets: ["coop-join"], volume: 0.56, cooldown: 350 },
  coopReady: { assets: ["coop-ready"], volume: 0.56, cooldown: 250 },
  coopLeave: { assets: ["coop-leave"], volume: 0.52, cooldown: 350 },
  reconnect: { assets: ["reconnect"], volume: 0.5, cooldown: 750 },
  matchStart: { assets: ["match-start"], volume: 0.68, cooldown: 900, duck: 0.16, reverb: 0.2 },
  matchEnd: { assets: ["match-end"], volume: 0.62, cooldown: 900, reverb: 0.16 },
  spectatorCamera: { assets: ["spectator-camera"], volume: 0.52, cooldown: 200 },
  spectatorLight: { assets: ["spectator-light"], volume: 0.58, cooldown: 250, reverb: 0.18 },
  radioShort: { assets: ["radio-short"], volume: 0.55, cooldown: 90, reverb: 0.23 },
  radioLong: { assets: ["radio-long"], volume: 0.6, cooldown: 180, reverb: 0.25 },
  radioSuccess: { assets: ["radio-success"], volume: 0.68, cooldown: 600 },
  radioFail: { assets: ["radio-fail"], volume: 0.6, cooldown: 600 },

  houseFootstep: { assets: ["footsteps-01", "footsteps-02", "footsteps-03"], volume: 0.3, cooldown: 2600, polyphony: 1, panRange: 0.92, rateJitter: 0.035, reverb: 0.38 },
  houseWhisper: { assets: ["whisper-01", "whisper-02", "whisper-03"], volume: 0.25, cooldown: 4200, polyphony: 1, panRange: 0.95, rateJitter: 0.02, reverb: 0.4 },
  pipeKnock: { assets: ["pipe-knock"], volume: 0.3, cooldown: 2800, panRange: 0.9, reverb: 0.42 },
  wallScratch: { assets: ["wall-scratch"], volume: 0.24, cooldown: 5000, panRange: 0.95, reverb: 0.42 },
  bulbFlicker: { assets: ["bulb-flicker"], volume: 0.3, cooldown: 1800, panRange: 0.28, reverb: 0.16 },
  waterDrip: { assets: ["water-drip"], volume: 0.25, cooldown: 2600, panRange: 0.9, reverb: 0.48 },
  distantDoor: { assets: ["distant-door"], volume: 0.22, cooldown: 4200, panRange: 0.85, reverb: 0.44 },
  distantElevator: { assets: ["distant-elevator"], volume: 0.2, cooldown: 6000, panRange: 0.65, reverb: 0.35 },
  intercom: { assets: ["intercom"], volume: 0.3, cooldown: 3200, panRange: 0.55, reverb: 0.32 },
};

const LEGACY_SOUND_CUES = {
  elevator: "elevatorTravel",
  "elevator-bell": "elevatorBell",
  door: "doorOpen",
  room: "roomShift",
  impact: "dangerHit",
  purchase: "purchaseStars",
  place: "itemPlace",
  camera: "camera",
  paper: "paper",
};

class HouseAudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.ambienceBus = null;
    this.worldBus = null;
    this.uiBus = null;
    this.compressor = null;
    this.reverb = null;
    this.reverbReturn = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.loops = new Map();
    this.unlocked = false;
    this.fallbackLoops = new Map();
    this.cooldowns = new Map();
    this.voices = new Map();
    this.scene = null;
    this.preloaded = false;
    const probe = document.createElement("audio");
    this.formats = probe.canPlayType?.('audio/mp4; codecs="mp4a.40.2"')
      ? ["m4a", "ogg", "wav"]
      : ["ogg", "m4a", "wav"];
  }

  async unlock() {
    if (this.unlocked && this.context?.state === "running") return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      if (!this.context) {
        try {
          this.context = new AudioContextClass({ latencyHint: "interactive", sampleRate: 48000 });
        } catch {
          this.context = new AudioContextClass({ latencyHint: "interactive" });
        }
        this.master = this.context.createGain();
        this.ambienceBus = this.context.createGain();
        this.worldBus = this.context.createGain();
        this.uiBus = this.context.createGain();
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -17;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 4.5;
        this.compressor.attack.value = 0.006;
        this.compressor.release.value = 0.24;
        this.reverb = this.context.createConvolver();
        this.reverbReturn = this.context.createGain();
        this.reverbReturn.gain.value = 0.18;
        this.ambienceBus.connect(this.master);
        this.worldBus.connect(this.compressor);
        this.uiBus.connect(this.compressor);
        this.reverb.connect(this.reverbReturn);
        this.reverbReturn.connect(this.compressor);
        this.compressor.connect(this.master);
        this.master.connect(this.context.destination);
        void this.loadImpulse("corridor-ir");
      }
      await this.context.resume();
      this.unlocked = true;
      this.applyVolumes();
      document.body.classList.add("sound-active");
      if (!this.preloaded) {
        this.preloaded = true;
        void this.preload([
          "ui-tap-01", "ui-primary", "ui-tab", "ui-open", "ui-close",
          "elevator-button", "elevator-travel", "floor-tick-01", "elevator-arrive",
          "door-open", "room-shift", "camera", "paper", "item-place",
        ]);
      }
      return true;
    } catch (error) {
      console.warn("AudioContext unavailable", error);
      return false;
    }
  }

  async preload(names) {
    await Promise.allSettled(names.map((name) => this.load(name)));
  }

  async fetchAudio(name) {
    for (const extension of this.formats) {
      try {
        const response = await fetch(`/audio/${name}.${extension}`, { cache: "force-cache" });
        if (!response.ok) continue;
        return await response.arrayBuffer();
      } catch {}
    }
    throw new Error(`Audio asset ${name} unavailable`);
  }

  async load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.loading.has(name)) return this.loading.get(name);
    const task = this.fetchAudio(name)
      .then((data) => this.context.decodeAudioData(data.slice(0)))
      .then((buffer) => {
        this.buffers.set(name, buffer);
        this.loading.delete(name);
        return buffer;
      })
      .catch((error) => {
        this.loading.delete(name);
        console.warn("Audio asset failed", name, error);
        return null;
      });
    this.loading.set(name, task);
    return task;
  }

  async loadImpulse(name) {
    if (!this.context || !this.reverb) return;
    try {
      const response = await fetch(`/audio/${name}.wav`, { cache: "force-cache" });
      if (!response.ok) return;
      this.reverb.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn("Reverb impulse unavailable", error);
    }
  }

  busFor(name) {
    if (name === "ambience") return this.ambienceBus;
    if (name === "ui") return this.uiBus;
    return this.worldBus;
  }

  applyVolumes() {
    const now = this.context?.currentTime || 0;
    const muted = state.audio.mute;
    const night = state.audio.night ? 0.72 : 1;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, now, 0.035);
    if (this.ambienceBus) this.ambienceBus.gain.setTargetAtTime((state.audio.ambience / 100) * (state.audio.night ? 0.8 : 1), now, 0.08);
    if (this.worldBus) this.worldBus.gain.setTargetAtTime((state.audio.effects / 100) * night, now, 0.04);
    if (this.uiBus) this.uiBus.gain.setTargetAtTime((state.audio.interface / 100) * (state.audio.night ? 0.82 : 1), now, 0.035);
    if (this.reverbReturn) this.reverbReturn.gain.setTargetAtTime(state.audio.spatial ? 0.18 : 0.04, now, 0.12);
    for (const audio of this.fallbackLoops.values()) {
      audio.volume = muted ? 0 : Math.min(1, (state.audio.ambience / 100) * Number(audio.dataset.volume || 1));
    }
  }

  duckAmbience(amount = 0.15, duration = 0.6) {
    if (!this.context || !this.ambienceBus || amount <= 0) return;
    const now = this.context.currentTime;
    const base = (state.audio.ambience / 100) * (state.audio.night ? 0.8 : 1);
    this.ambienceBus.gain.cancelScheduledValues(now);
    this.ambienceBus.gain.setTargetAtTime(base * (1 - amount), now, 0.025);
    this.ambienceBus.gain.setTargetAtTime(base, now + duration, 0.18);
  }

  async cue(name, overrides = {}) {
    if (state.audio.mute) return null;
    const cue = SOUND_CUES[name] || { assets: [name], volume: 1, bus: "world" };
    const nowMs = performance.now();
    const last = this.cooldowns.get(name) || 0;
    const cooldown = overrides.cooldown ?? cue.cooldown ?? 0;
    if (nowMs - last < cooldown) return null;
    const group = cue.group || name;
    const count = this.voices.get(group) || 0;
    if (count >= (cue.polyphony || 3)) return null;
    this.cooldowns.set(name, nowMs);
    this.voices.set(group, count + 1);
    const assets = cue.assets || [name];
    const asset = assets[Math.floor(Math.random() * assets.length)];
    const rateJitter = cue.rateJitter || 0;
    const rate = (overrides.rate || 1) * (1 + (Math.random() * 2 - 1) * rateJitter);
    const panRange = cue.panRange || 0;
    const requestedPan = overrides.pan ?? (panRange ? (Math.random() * 2 - 1) * panRange : 0);
    const pan = state.audio.spatial ? requestedPan : 0;
    if (cue.duck || overrides.duck) this.duckAmbience(overrides.duck ?? cue.duck, overrides.duckDuration || 0.62);
    try {
      return await this.playAsset(asset, {
        volume: (cue.volume ?? 1) * (overrides.volume ?? 1),
        pan,
        rate,
        bus: overrides.bus || cue.bus || "world",
        reverb: overrides.reverb ?? cue.reverb ?? 0,
        onEnded: () => this.voices.set(group, Math.max(0, (this.voices.get(group) || 1) - 1)),
      });
    } catch (error) {
      this.voices.set(group, Math.max(0, (this.voices.get(group) || 1) - 1));
      return null;
    }
  }

  async playAsset(name, { volume = 1, pan = 0, rate = 1, bus = "world", reverb = 0, onEnded } = {}) {
    const ready = await this.unlock();
    if (!ready || !this.context) return this.playFallback(name, { volume, bus, onEnded });
    const buffer = await this.load(name);
    if (!buffer) return this.playFallback(name, { volume, bus, onEnded });
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner?.();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.72, Math.min(1.35, rate));
    gain.gain.value = Math.max(0, Math.min(1.3, volume));
    source.connect(gain);
    let output = gain;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      output = panner;
    }
    output.connect(this.busFor(bus));
    if (reverb > 0 && this.reverb?.buffer) {
      const send = this.context.createGain();
      send.gain.value = Math.min(0.7, reverb);
      output.connect(send);
      send.connect(this.reverb);
    }
    source.onended = () => onEnded?.();
    source.start();
    return source;
  }

  playFallback(name, { volume = 1, bus = "world", onEnded } = {}) {
    const audio = new Audio(`/audio/${name}.m4a`);
    const level = bus === "ambience" ? state.audio.ambience : bus === "ui" ? state.audio.interface : state.audio.effects;
    audio.volume = state.audio.mute ? 0 : Math.min(1, (level / 100) * volume * (state.audio.night && bus !== "ambience" ? 0.75 : 1));
    const finish = () => onEnded?.();
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch(() => finish());
    return audio;
  }

  async ensureLoop(name, volume = 1) {
    if (state.audio.mute || state.audio.ambience === 0) return;
    const ready = await this.unlock();
    if (!ready || !this.context) {
      if (!this.fallbackLoops.has(name)) {
        const audio = new Audio(`/audio/${name}.m4a`);
        audio.loop = true;
        audio.dataset.volume = String(volume);
        this.fallbackLoops.set(name, audio);
        audio.play().catch(() => {});
      }
      this.applyVolumes();
      return;
    }
    if (this.loops.has(name)) {
      const entry = this.loops.get(name);
      entry.targetVolume = volume;
      entry.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.75);
      return;
    }
    const buffer = await this.load(name);
    if (!buffer || this.loops.has(name)) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.ambienceBus);
    source.start(0, Math.random() * Math.max(0.1, buffer.duration - 0.1));
    gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.9);
    this.loops.set(name, { source, gain, targetVolume: volume });
  }

  fadeLoop(name, stop = true) {
    const entry = this.loops.get(name);
    if (entry && this.context) {
      entry.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.5);
      if (stop) setTimeout(() => {
        try { entry.source.stop(); } catch {}
        this.loops.delete(name);
      }, 1600);
    }
    const fallback = this.fallbackLoops.get(name);
    if (fallback) {
      fallback.pause();
      fallback.currentTime = 0;
      this.fallbackLoops.delete(name);
    }
  }

  setScene(tab) {
    const scenes = {
      home: { "apartment-night": 0.44, "rain-window": 0.2, "lamp-hum": 0.1 },
      coop: { "coop-tension": 0.46, "eighth-floor": 0.2 },
      building: { "building-hall": 0.5, neighbor: 0.08 },
      archive: { "archive-room": 0.48, "lamp-hum": 0.08 },
      market: { "market-lobby": 0.44, "building-hall": 0.1 },
      more: { "apartment-night": 0.24, wind: 0.07 },
    };
    const desired = scenes[tab] || scenes.home;
    this.scene = tab;
    if (!["home", "coop"].includes(tab)) this.setTension(0);
    for (const name of new Set([...this.loops.keys(), ...this.fallbackLoops.keys()])) {
      if (!(name in desired) && !name.startsWith("tension-")) this.fadeLoop(name);
    }
    for (const [name, volume] of Object.entries(desired)) void this.ensureLoop(name, volume);
  }

  setTension(level = 0) {
    if (level >= 65) {
      this.fadeLoop("tension-low");
      void this.ensureLoop("tension-high", 0.27);
    } else if (level >= 32) {
      this.fadeLoop("tension-high");
      void this.ensureLoop("tension-low", 0.2);
    } else {
      this.fadeLoop("tension-low");
      this.fadeLoop("tension-high");
    }
  }

  stopAll() {
    for (const name of [...this.loops.keys(), ...this.fallbackLoops.keys()]) this.fadeLoop(name);
  }

  async testSpace() {
    await this.unlock();
    await this.cue("pipeKnock", { pan: -0.88, volume: 1.05 });
    await wait(680);
    await this.cue("houseFootstep", { pan: 0.84, volume: 1.08 });
    await wait(920);
    await this.cue("houseWhisper", { pan: -0.72, volume: 0.9 });
  }
}

const audioEngine = new HouseAudioEngine();


const state = {
  base: null,
  v2: null,
  v4: null,
  houseTab: "social",
  tab: "home",
  previousTab: "home",
  archiveTab: "apartment",
  marketTab: "market",
  moreTab: "settings",
  expedition: null,
  selectedItem: null,
  coop: null,
  socket: null,
  sessionId: sessionStorage.getItem("ef_session") || opId(),
  assignments: {},
  audio: {
    ambience: Number(localStorage.getItem("ef_ambience") ?? 58),
    effects: Number(localStorage.getItem("ef_effects") ?? 76),
    interface: Number(localStorage.getItem("ef_interface") ?? 48),
    mute: localStorage.getItem("ef_mute") === "1",
    vibration: localStorage.getItem("ef_vibration") !== "0",
    spatial: localStorage.getItem("ef_spatial") !== "0",
    rare: localStorage.getItem("ef_rare") !== "0",
    night: localStorage.getItem("ef_night") === "1",
  },
  motionReduced: reduceMotion,
  ambientTimer: null,
  tutorialInspect: new Set(),
  dailyOpen: false,
  bootComplete: false,
  lastFloor: 7,
  installPrompt: null,
  listening: false,
  listenHint: null,
  inspectHint: null,
  recommendedChoice: null,
  maintenance: null,
  lastObservationAction: null,
};

sessionStorage.setItem("ef_session", state.sessionId);
const view = $("#view");
const toastEl = $("#toast");
const bootScene = $("#bootScene");
const bootStatus = $("#bootStatus");
const bootFloor = $("#bootFloor");
const networkBanner = $("#networkBanner");
let bootCounter = 7;
const bootTimer = setInterval(() => {
  if (!bootFloor || state.bootComplete) return;
  bootCounter = bootCounter === 7 ? 9 : bootCounter === 9 ? 8 : 7;
  bootFloor.textContent = String(bootCounter);
}, 620);

function finishBoot(message = "Двери открываются") {
  if (state.bootComplete) return;
  state.bootComplete = true;
  clearInterval(bootTimer);
  if (bootStatus) bootStatus.textContent = message;
  if (bootFloor) bootFloor.textContent = "8";
  setTimeout(() => bootScene?.classList.add("open"), 170);
  setTimeout(
    () => bootScene?.classList.add("done"),
    state.motionReduced ? 220 : 1150,
  );
}

function setNetworkState(online) {
  const wasOffline = document.body.classList.contains("network-offline");
  document.body.classList.toggle("network-offline", !online);
  networkBanner?.classList.toggle("hidden", online);
  if (!online && !wasOffline) void audioEngine.cue("uiWarning");
  if (online && wasOffline) void audioEngine.cue("reconnect", { volume: 0.72 });
  if (online && state.base) void bootstrap({ preserveTab: true, quiet: true });
}
window.addEventListener("online", () => setNetworkState(true));
window.addEventListener("offline", () => setNetworkState(false));
setNetworkState(navigator.onLine);

async function api(path, options = {}) {
  const method = options.method || "GET";
  const idempotencyKey =
    options.headers?.["x-idempotency-key"] ||
    (options.body !== undefined && method !== "GET" ? opId() : undefined);
  const attempts = method === "GET" ? 3 : 2;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    const headers = {
      "x-telegram-init-data": resolveTelegramInitData(),
      "x-dev-user-id": devUser,
      "x-client-version": APP_VERSION,
      ...options.headers,
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    }
    try {
      const response = await fetch(path, {
        ...options,
        method,
        headers,
        signal: options.signal || controller.signal,
        cache: method === "GET" ? "no-store" : options.cache,
      });
      clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          payload.error || payload.message || `Ошибка ${response.status}`,
        );
        error.code = payload.code;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const retryable =
        error.name === "AbortError" ||
        error instanceof TypeError ||
        [408, 425, 429, 502, 503, 504].includes(error.status);
      if (!retryable || attempt === attempts - 1) break;
      await wait(300 * 2 ** attempt + Math.random() * 180);
    }
  }
  throw lastError;
}

function toast(text, tone = "neutral", withSound = true) {
  const message = String(text || "Дом не ответил");
  toastEl.innerHTML = `<span class="toast-mark" aria-hidden="true">${tone === "success" ? "✓" : tone === "error" ? "!" : tone === "warning" ? "△" : "·"}</span><span class="toast-copy">${esc(message)}</span>`;
  toastEl.dataset.tone = tone;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  const duration = Math.min(7200, Math.max(3200, 2200 + message.length * 34));
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), duration);
  if (withSound && tone === "success") void audioEngine.cue("uiSuccess");
  if (withSound && tone === "warning") void audioEngine.cue("uiWarning");
  if (withSound && tone === "error") void audioEngine.cue("uiError");
}

function haptic(type = "light") {
  if (!state.audio.vibration) return;
  if (type === "success" || type === "warning" || type === "error")
    tg?.HapticFeedback?.notificationOccurred?.(type);
  else tg?.HapticFeedback?.impactOccurred?.(type);
}
function effect(name, volume = 1, pan = 0) {
  return audioEngine.cue(LEGACY_SOUND_CUES[name] || name, { volume, pan });
}
function ambient(name, volume = 1, pan = Math.random() * 1.6 - 0.8) {
  const mapped = {
    footsteps: "houseFootstep", whisper: "houseWhisper", pipes: "pipeKnock",
    intercom: "intercom", "elevator-bell": "elevatorBell", camera: "camera",
    neighbor: "distantDoor", television: "distantElevator", wind: "wallScratch",
  }[name];
  return mapped
    ? audioEngine.cue(mapped, { volume, pan })
    : audioEngine.playAsset(name, { volume, pan, bus: "world", reverb: 0.22 });
}
function loop(name, volume = 1) {
  return audioEngine.ensureLoop(name, volume);
}
function stopLoops() {
  audioEngine.stopAll();
}
function scheduleAmbient() {
  clearTimeout(state.ambientTimer);
  if (state.audio.mute || state.audio.ambience === 0 || document.hidden || !state.audio.rare) return;
  const pools = {
    home: ["pipeKnock", "distantDoor", "waterDrip", "bulbFlicker", "distantElevator"],
    coop: ["houseFootstep", "houseWhisper", "pipeKnock", "intercom", "wallScratch"],
    building: ["distantDoor", "houseFootstep", "intercom", "pipeKnock"],
    archive: ["pageTurn", "wallScratch", "bulbFlicker", "houseWhisper"],
    market: ["houseFootstep", "distantDoor", "elevatorBell"],
    more: ["pipeKnock", "waterDrip", "intercom", "wallScratch"],
  };
  const sounds = pools[state.tab] || pools.home;
  state.ambientTimer = setTimeout(() => {
    void audioEngine.cue(sounds[Math.floor(Math.random() * sounds.length)], {
      volume: 0.72 + Math.random() * 0.34,
      pan: Math.random() * 1.8 - 0.9,
    });
    scheduleAmbient();
  }, 8500 + Math.random() * 19000);
}
function startHouseAudio() {
  if (state.audio.mute) return;
  void audioEngine.unlock().then(() => audioEngine.setScene(state.tab));
  scheduleAmbient();
}
function track(eventName, properties = {}) {
  api("/api/analytics", {
    method: "POST",
    body: JSON.stringify({
      eventName,
      properties,
      sessionId: state.sessionId,
      appVersion: state.v2?.appVersion || APP_VERSION,
      assignments: state.assignments,
    }),
  }).catch(() => {});
}

async function playFloorTransition({
  floor = 8,
  label = "Лифт движется",
  open = true,
} = {}) {
  const overlay = $("#floorTransition");
  const target = Number(floor) || 8;
  void audioEngine.cue("elevatorButton");
  if (!overlay || state.motionReduced) {
    state.lastFloor = target;
    await audioEngine.cue("elevatorTravel", { rate: 1.15, volume: 0.74 });
    if (open) void audioEngine.cue("elevatorArrive");
    return;
  }
  const floorEl = $("#transitionFloor");
  const labelEl = $("#transitionLabel");
  overlay.classList.remove("hidden", "open", "leaving");
  overlay.setAttribute("aria-hidden", "false");
  labelEl.textContent = label;
  const current = state.lastFloor || 7;
  const sequence = target === 1 ? [current, 7, 5, 3, 1] : [current, 6, 7, 9, target];
  void audioEngine.cue("elevatorTravel", { rate: 1.12, volume: 0.92 });
  haptic("medium");
  await wait(230);
  for (let index = 0; index < sequence.length; index += 1) {
    floorEl.textContent = String(sequence[index]);
    floorEl.classList.remove("floor-pulse");
    void floorEl.offsetWidth;
    floorEl.classList.add("floor-pulse");
    void audioEngine.cue("floorTick", { pan: (index - 2) * 0.08 });
    haptic("light");
    await wait(state.motionReduced ? 90 : 360 + index * 22);
  }
  floorEl.textContent = String(target);
  state.lastFloor = target;
  void audioEngine.cue("elevatorBrake");
  await wait(520);
  if (open) {
    void audioEngine.cue("elevatorArrive");
    await wait(180);
    overlay.classList.add("open");
    void audioEngine.cue("elevatorBell", { volume: 0.92 });
    void audioEngine.cue("doorOpen", { volume: 0.72 });
    haptic("success");
    await wait(980);
  }
  overlay.classList.add("leaving");
  await wait(380);
  overlay.classList.add("hidden");
  overlay.classList.remove("open", "leaving");
  overlay.setAttribute("aria-hidden", "true");
}

function animateValue(element, nextValue) {
  if (!element) return;
  const previous = Number(element.textContent);
  const next = Number(nextValue);
  if (
    !Number.isFinite(previous) ||
    !Number.isFinite(next) ||
    state.motionReduced
  ) {
    element.textContent = String(nextValue);
    return;
  }
  if (previous === next) return;
  const started = performance.now();
  const duration = 420;
  const tick = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = String(
      Math.round(previous + (next - previous) * eased),
    );
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  element.closest("div")?.classList.add("stat-flash");
  setTimeout(() => element.closest("div")?.classList.remove("stat-flash"), 760);
}

function updateTelegramNavigation() {
  const nested = state.tab !== "home" || $("#sheet")?.open;
  if (nested) tg?.BackButton?.show?.();
  else tg?.BackButton?.hide?.();
}

function handleTelegramBack() {
  if ($("#sheet")?.open) return closeSheet();
  if (!$("#soundPanel")?.classList.contains("hidden")) {
    $("#soundPanel").classList.add("hidden");
    void audioEngine.cue("uiClose");
    return;
  }
  if (state.tab !== "home") return setTab("home");
}
tg?.BackButton?.onClick?.(handleTelegramBack);
tg?.SettingsButton?.show?.();
tg?.SettingsButton?.onClick?.(() =>
  $("#soundPanel")?.classList.remove("hidden"),
);

async function publicStatus() {
  const response = await fetch(`/api/public-status?v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось проверить состояние дома");
  return response.json();
}
function renderMaintenanceScreen(status) {
  state.maintenance = status;
  stopLoops();
  document.body.classList.add("maintenance-mode");
  let screen = $("#maintenanceScreen");
  if (!screen) {
    screen = document.createElement("section");
    screen.id = "maintenanceScreen";
    screen.className = "maintenance-screen";
    document.body.appendChild(screen);
  }
  screen.innerHTML = `<div class="maintenance-card"><div class="maintenance-lift" aria-hidden="true"><div class="maintenance-panel">—</div><div class="maintenance-door left"></div><div class="maintenance-door right"></div><i></i></div><span class="eyebrow">ЛИФТ ВРЕМЕННО ОСТАНОВЛЕН</span><h1>${esc(status.title || "Дом закрыт на технические работы")}</h1><p>${esc(status.message || "Мы проверяем системы дома. Ваш прогресс сохранён.")}</p><div class="maintenance-status"><i></i><span>${esc(status.eta || "Проверьте вход немного позже")}</span></div><div class="button-row"><button class="primary" id="maintenanceRetry">Проверить двери ещё раз</button>${status.supportUrl ? '<button class="secondary" id="maintenanceSupport">Связаться с поддержкой</button>' : ""}</div><small>Версия ${esc(status.appVersion || APP_VERSION)} · проверено ${new Date(status.checkedAt || Date.now()).toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"})}</small></div>`;
  finishBoot("Лифт остановлен на технические работы");
  $("#maintenanceRetry")?.addEventListener("click", async () => {
    const button = $("#maintenanceRetry");
    button.disabled = true;
    button.textContent = "Проверяем…";
    try { const next = await publicStatus(); if (!next.maintenance) location.reload(); else { renderMaintenanceScreen(next); toast("Работы ещё продолжаются", "warning"); } }
    catch (error) { toast(error.message, "error"); }
    finally { if (button?.isConnected) { button.disabled = false; button.textContent = "Проверить двери ещё раз"; } }
  });
  $("#maintenanceSupport")?.addEventListener("click", () => tg?.openTelegramLink ? tg.openTelegramLink(status.supportUrl) : window.open(status.supportUrl, "_blank", "noopener"));
}
async function bootstrap({ preserveTab = true, quiet = false } = {}) {
  try {
    const status = await publicStatus();
    if (status.maintenance) { renderMaintenanceScreen(status); return; }
    document.body.classList.remove("maintenance-mode");
    $("#maintenanceScreen")?.remove();
    if (!quiet && bootStatus)
      bootStatus.textContent = "Telegram подтверждает квартиру…";
    await waitForTelegramInitData();
    const [base, v2, v4] = await Promise.all([
      api("/api/bootstrap"),
      api("/api/v2/bootstrap"),
      api("/api/v4/bootstrap"),
    ]);
    state.base = base;
    state.v2 = v2;
    state.v4 = v4;
    applyInterfaceAnomaly(v4.anomaly);
    state.expedition = base.activeExpedition;
    state.assignments = Object.fromEntries(
      Object.entries(v2.experiments || {}).map(([key, value]) => [
        key,
        value?.variant || String(value),
      ]),
    );
    renderStatus();
    renderDailyRibbon();
    if (v2.activeCoop) connectCoop(v2.activeCoop);
    if (!v2.tutorial.completed_at) renderTutorial();
    else $("#tutorialOverlay").classList.add("hidden");
    render();
    updateTelegramNavigation();
    finishBoot("Дом узнал вас");
    if (!quiet) setTimeout(() => void maybeOfferSmartInstall(), 1800);
    if (!quiet) {
      track("app_open", { tab: state.tab, platform: tg?.platform || "web" });
      setTimeout(() => {
        void audioEngine.load("door-open");
        void audioEngine.load("room-shift");
        void audioEngine.load("apartment-night");
      }, 300);
    }
  } catch (error) {
    if (error.code === "MAINTENANCE_MODE") {
      renderMaintenanceScreen({maintenance:true,title:"Дом закрыт на технические работы",message:error.message,eta:"Проверьте вход немного позже",appVersion:APP_VERSION,checkedAt:new Date().toISOString()});
      return;
    }
    finishBoot("Двери не открылись");
    renderLaunchError(error);
  }
}
async function maybeOfferSmartInstall(){
  try{
    if(!state.v2?.tutorial?.completed_at||state.base?.profile?.home_screen_added_at||state.base?.profile?.install_prompted_at)return;
    const hasMeaningfulMoment=Boolean(state.base?.activeExpedition)||Number(state.base?.profile?.clues||0)>0||Number(state.base?.profile?.trust||0)>0;
    if(!hasMeaningfulMoment)return;
    if(tg?.checkHomeScreenStatus)tg.checkHomeScreenStatus(async status=>{
      if(status==='added'||status==='unsupported')return;
      await api('/api/v4/home-screen',{method:'POST',body:JSON.stringify({kind:'prompted'})}).catch(()=>{});
      openSheet('Оставить ключ','Главный экран',`<div class="install-moment"><div class="v4-feature-icon">${icon('key')}</div><h3>Дом запомнил вас</h3><p>Оставить ключ на главном экране, чтобы возвращаться в квартиру без поиска чата?</p><button class="primary full" id="smartInstall">Оставить ключ</button></div>`);
      $('#smartInstall').onclick=()=>tg.addToHomeScreen?.();
    });
  }catch{}
}
async function renderLaunchError(error) {
  const diagnostic = telegramDiagnostics();
  let botUsername = "";
  try {
    botUsername =
      (
        await fetch("/api/public-config", { cache: "no-store" }).then((r) =>
          r.json(),
        )
      ).botUsername || "";
  } catch {}
  const noInitData =
    !diagnostic.initDataLength || error.code === "TELEGRAM_AUTH_REQUIRED";
  const invalidInitData =
    error.code === "TELEGRAM_AUTH_INVALID" ||
    error.code === "TELEGRAM_AUTH_EXPIRED";
  const explanation = noInitData
    ? `<p>Telegram открыл страницу без подписанного запуска. Закройте окно и войдите новой кнопкой <b>«Открыть двери лифта»</b> в личном чате с ботом.</p>`
    : invalidInitData
      ? `<p>Данные запуска получены, но подпись отклонена. Проверьте, что <code>BOT_TOKEN</code> в Railway принадлежит именно этому боту, затем отправьте боту <code>/start</code> ещё раз.</p>`
      : `<p>Дом не смог завершить загрузку. Проверьте соединение и повторите запрос.</p>`;
  view.innerHTML = `<div class="card launch-error"><div class="app-badge">${icon("warning")} ДИАГНОСТИКА ВХОДА</div><h3>Двери не открылись</h3><p>${esc(error.message)}</p>${explanation}<div class="button-row"><button class="primary" id="authRetry">${icon("elevator", "button-icon")}Проверить ещё раз</button>${botUsername ? `<button class="secondary" id="authReopen">${icon("send", "button-icon")}Открыть через бота</button>` : ""}</div><details><summary>Техническая информация</summary><pre>${esc(JSON.stringify({ ...diagnostic, serverCode: error.code || null, httpStatus: error.status || null }, null, 2))}</pre></details></div>`;
  $("#authRetry").onclick = async () => {
    sessionStorage.removeItem("ef_tg_init_data");
    telegramInitData = "";
    location.reload();
  };
  if (botUsername)
    $("#authReopen").onclick = () => {
      const link = `https://t.me/${botUsername.replace(/^@/, "")}?start=app`;
      if (tg?.openTelegramLink) tg.openTelegramLink(link);
      else location.href = link;
    };
}
function renderStatus() {
  const profile = state.base.profile;
  $("#apartmentNo").textContent = profile.apartment_no;
  animateValue($("#nerve"), profile.nerve);
  animateValue($("#trust"), profile.trust);
  animateValue($("#clues"), profile.clues);
  animateValue($("#marks"), profile.house_marks ?? 0);
}
function renderDailyRibbon() {
  const d = state.v2.daily?.scenario,
    r = $("#dailyRibbon");
  if (!d) {
    r.classList.add("hidden");
    return;
  }
  r.classList.remove("hidden");
  r.innerHTML = `<b>${esc(d.title)}</b><small>${state.v2.daily.progress?.completed_at ? "История завершена сегодня" : "Сегодня · " + esc(d.teaser)}</small>`;
}
async function setTab(tab) {
  if (!tab || tab === state.tab) return;
  void audioEngine.cue("uiTab");
  state.previousTab = state.tab;
  state.tab = tab;
  $$("#bottomNav button").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === tab),
  );
  haptic();
  view.classList.add("view-exit");
  await wait(state.motionReduced ? 1 : 150);
  startHouseAudio();
  render();
  view.classList.remove("view-exit");
  view.classList.add("view-enter");
  setTimeout(() => view.classList.remove("view-enter"), 390);
  updateTelegramNavigation();
  track("tab_open", { tab, from: state.previousTab });
}
function render() {
  if (!state.base || !state.v2 || !state.v4) return;
  const map = {
    home: renderHome,
    coop: renderCoop,
    building: renderBuilding,
    archive: renderArchive,
    market: renderMarket,
    more: renderMore,
  };
  map[state.tab]?.();
}
function section(title, text, action = "") {
  return `<div class="section-head"><div><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}</div>${action}</div>`;
}
function cinematic({
  kicker = "00:08",
  title = "Этажа нет на плане",
  text = "За дверью кто-то ждёт, пока вы первым назовёте своё имя.",
  number = "8",
  shadow = true,
  tools = true,
  ambience = "corridor",
} = {}) {
  return `<div class="cinematic ambience-${esc(ambience)}" data-parallax>
    <div class="lamp-cone"></div><div class="bulb"></div><div class="corridor-floor"></div>
    <div class="hall-door" data-number="${esc(number)}"></div>
    ${shadow ? '<div class="shadow-person"></div>' : ""}
    <div class="scene-noise"></div>
    ${tools ? `<div class="scene-tools"><button class="scene-tool" data-scene-listen aria-label="Прислушаться">${icon("sound")}</button><button class="scene-tool" data-scene-look aria-label="Осмотреть">${icon("eye")}</button></div>` : ""}
    <div class="listen-overlay"><div class="listen-radar"><i class="listen-sweep"></i><div class="listen-wave">${Array.from({ length: 19 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div></div><p class="listen-copy">У стены слышно больше, чем написано в деле.</p></div>
    <div class="scene-caption"><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
  </div>`;
}
function renderHome() {
  const e = state.base.event,
    d = state.v2.daily;
  if (state.expedition?.status === "active") return renderSoloExpedition();
  view.innerHTML = `${e ? `<div class="card daily-scene"><span class="eyebrow">ОБЩЕДОМОВОЕ ПРОИСШЕСТВИЕ</span><h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></div>` : ""}${cinematic({ kicker: "ЛИФТ · МЕЖДУ 7 И 9", title: "Восьмой этаж снова существует", text: "Один путь — тихий. Второй — короткий. Оба заканчиваются у одной двери." })}<div class="button-row" style="margin-top:9px"><button class="primary" data-action="solo-start">Войти одному</button><button class="secondary" data-action="coop-open">Позвать жильцов</button></div>${d?.scenario ? renderDailyCard(d) : ""}${section("Что изменилось", "Дом запоминает поступки, а не серию входов.")}${renderStoryPreview()}`;
  bindHome();
}
function renderDailyCard(d) {
  const progress = d.progress || {},
    scenes = d.scenario.scenes || [],
    scene = scenes[Number(progress.step) || 0];
  return `<article class="card daily-scene" style="margin-top:10px"><span class="eyebrow">СЦЕНАРИЙ ДНЯ</span><h3>${esc(d.scenario.title)}</h3><p>${esc(scene?.text || d.scenario.teaser)}</p><div class="timeline">${scenes.map((_, i) => `<i class="${i <= Number(progress.step) ? "done" : ""}"></i>`).join("")}</div>${progress.completed_at ? '<span class="pill ok">Дом записал последствия</span>' : `<div class="button-row">${(scene?.actions || []).map((a) => `<button class="secondary" data-daily-action="${esc(a.key)}" data-id="${d.scenario.id}">${esc(a.label)}</button>`).join("")}</div>`}</article>`;
}
function renderStoryPreview() {
  const items = state.v2.storylines || [];
  if (!items.length)
    return `<div class="card story-card"><h3>Дом пока наблюдает</h3><p>После нескольких решений появится личная сюжетная линия: архив, радиорубка, фотограф или поддельные документы.</p></div>`;
  return items
    .slice(0, 2)
    .map(
      (x) =>
        `<div class="card story-card"><span class="eyebrow">ЛИЧНОЕ ДЕЛО · ГЛАВА ${Number(x.chapter) + 1}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><button class="secondary" data-story="${x.id}">Продолжить</button></div>`,
    )
    .join("");
}
function bindHome() {
  bindSceneInteractions(
    { id: "home-elevator", ambience: "corridor" },
    (hint) => {
      const caption = $(".cinematic .scene-caption p");
      if (caption) caption.textContent = hint;
    },
  );
  $('[data-action="solo-start"]')?.addEventListener("click", startExpedition);
  $('[data-action="coop-open"]')?.addEventListener("click", () =>
    setTab("coop"),
  );
  $$("[data-daily-action]").forEach(
    (b) => (b.onclick = () => dailyAction(b.dataset.id, b.dataset.dailyAction)),
  );
  $$("[data-story]").forEach(
    (b) => (b.onclick = () => storyChoice(b.dataset.story)),
  );
}
async function dailyAction(id, action) {
  try {
    haptic();
    effect("paper");
    const result = await api(`/api/daily/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action, operationId: opId() }),
    });
    toast(
      result.completed
        ? "Событие завершено. Последствия останутся."
        : "Дом изменил следующую сцену",
    );
    await bootstrap();
  } catch (e) {
    toast(e.message);
  }
}
async function storyChoice(id) {
  openSheet(
    "Личное дело",
    "Дом помнит ваш характер",
    `<p>Это решение станет частью персональной линии.</p><div class="button-row"><button class="secondary" data-choice="investigate">Проверить факты</button><button class="secondary" data-choice="hide">Скрыть находку</button></div>`,
  );
  $$("[data-choice]", $("#sheetBody")).forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/storylines/${id}/choice`, {
          method: "POST",
          body: JSON.stringify({ choice: b.dataset.choice }),
        });
        closeSheet();
        toast("Запись добавлена в личное дело");
        await bootstrap();
      }),
  );
}

function roomScene(exp) {
  const room = exp.room;
  const expeditionState = exp.state;
  const hint = state.inspectHint?.roomId === room.id ? state.inspectHint.text : state.listenHint?.roomId === room.id ? state.listenHint.text : null;
  const recommended = state.recommendedChoice?.roomId === room.id ? state.recommendedChoice.choiceIndex : null;
  return `${cinematic({
    kicker: `КОМНАТА ${exp.roomIndex + 1} ИЗ ${expeditionState.maxRooms} · ${room.ambience}`,
    title: room.title,
    text: hint || room.description,
    number: String(exp.roomIndex + 8),
    shadow: expeditionState.danger > 35,
    ambience: room.ambience,
  })}
  <div class="floor-map" aria-label="Маршрут экспедиции">${Array.from({ length: expeditionState.maxRooms }, (_, index) => `<i class="${index < exp.roomIndex ? "passed" : index === exp.roomIndex ? "current" : ""}"></i>`).join("")}</div>
  <div class="meter-grid"><div class="meter"><label>Самообладание <b>${expeditionState.nerve}</b></label><i style="--v:${expeditionState.nerve}%"></i></div><div class="meter"><label>Опасность <b>${expeditionState.danger}</b></label><i style="--v:${expeditionState.danger}%"></i></div><div class="meter"><label>Шум <b>${expeditionState.noise}</b></label><i style="--v:${expeditionState.noise}%"></i></div></div>
  ${hint ? `<div class="card observation-card"><span class="eyebrow">${state.lastObservationAction === "inspect" ? "НАЙДЕННАЯ ДЕТАЛЬ" : "УСЛЫШАННАЯ ПОДСКАЗКА"}</span><p>${esc(hint)}</p></div>` : ""}
  <div class="choice-list">${room.choices.map((choice, index) => `<button class="choice-button ${recommended === index ? "choice-recommended" : ""}" data-solo-choice="${index}"><b>${esc(choice.label)}</b><small>${choice.requires ? `${icon("key", "button-icon")} нужен предмет: ${esc(choice.requires)}` : recommended === index ? "наблюдение указывает на этот вариант" : "последствия сохранятся в истории"}</small></button>`).join("")}</div>`;
}
function renderSoloExpedition() {
  view.innerHTML = roomScene(state.expedition);
  bindSceneInteractions(state.expedition.room);
  $$("[data-solo-choice]").forEach(
    (button) =>
      (button.onclick = () => chooseSolo(Number(button.dataset.soloChoice))),
  );
  void loop("eighth-floor", 0.42);
  audioEngine.setTension(state.expedition.state.danger);
  updateTelegramNavigation();
}

function bindSceneInteractions(room, onReveal = () => renderSoloExpedition()) {
  const scene = $(".cinematic");
  if (!scene) return;
  const listenButton = $("[data-scene-listen]", scene);
  const lookButton = $("[data-scene-look]", scene);
  const overlay = $(".listen-overlay", scene);
  const runObservation = async (action) => {
    const button = action === "listen" ? listenButton : lookButton;
    if (!button || button.disabled || state.listening) return;
    state.listening = true;
    button.disabled = true;
    button.classList.add("active");
    overlay?.classList.add("active");
    $(".listen-copy", overlay)?.replaceChildren(document.createTextNode(action === "listen" ? "Дом отделяет полезный звук от шума…" : "Вы отмечаете детали, которые не совпадают с планом…"));
    haptic("medium");
    if (action === "listen") void audioEngine.cue(room?.ambience === "radio" ? "intercom" : "houseWhisper", { volume: 0.55, pan: room?.ambience === "voices" ? 0.72 : -0.42 });
    else void audioEngine.cue("camera", { volume: 0.72, pan: 0.24 });
    try {
      const endpoint = state.expedition?.status === "active" && state.expedition?.room?.id === room?.id
        ? `/api/expeditions/${state.expedition.id}/observe`
        : "/api/scenes/observe";
      const body = endpoint.includes("/expeditions/")
        ? { action, operationId: opId() }
        : { sceneKey: room?.id || "home-elevator", action, operationId: opId() };
      const result = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      const observation = result.observation;
      if (result.state && state.expedition) state.expedition.state = result.state;
      if (observation?.recommendedChoiceIndex != null && state.expedition) state.recommendedChoice = { roomId: room.id, choiceIndex: observation.recommendedChoiceIndex };
      const copy = `${observation.text} ${observation.detail || ""}`.trim();
      state.lastObservationAction = action;
      if (action === "listen") state.listenHint = { roomId: room?.id, text: copy };
      else state.inspectHint = { roomId: room?.id, text: copy };
      if ($(".listen-copy", overlay)) $(".listen-copy", overlay).textContent = copy;
      if (observation.clueAwarded) {
        void audioEngine.cue("clueFound");
        toast(`Найдена дополнительная улика. ${copy}`, "success");
      } else toast(copy, observation.intensity === "urgent" ? "warning" : "neutral");
      haptic(observation.clueAwarded ? "success" : "light");
      await wait(state.motionReduced ? 180 : 780);
      onReveal(copy, action, observation);
      track(action === "listen" ? "scene_listen" : "scene_inspect", { roomId: room?.id, ambience: room?.ambience, variant: observation.key });
    } catch (error) {
      toast(error.message, error.code === "ROOM_OBSERVATION_EXHAUSTED" ? "warning" : "error");
    } finally {
      overlay?.classList.remove("active");
      button.classList.remove("active");
      button.disabled = false;
      state.listening = false;
    }
  };
  listenButton?.addEventListener("click", () => runObservation("listen"));
  lookButton?.addEventListener("click", () => runObservation("inspect"));
  bindParallax(scene);
}

function bindParallax(scene) {
  if (state.motionReduced || lowPerformance) return;
  const move = (x, y) => {
    scene.style.setProperty("--px", `${Math.max(-8, Math.min(8, x))}px`);
    scene.style.setProperty("--py", `${Math.max(-5, Math.min(5, y))}px`);
  };
  scene.onpointermove = (event) => {
    const rect = scene.getBoundingClientRect();
    move(
      ((event.clientX - rect.left) / rect.width - 0.5) * 14,
      ((event.clientY - rect.top) / rect.height - 0.5) * 8,
    );
  };
  scene.onpointerleave = () => move(0, 0);
}
async function startExpedition() {
  try {
    haptic("medium");
    const request = api("/api/expeditions/start", {
      method: "POST",
      body: "{}",
    });
    const [, expedition] = await Promise.all([
      playFloorTransition({ floor: 8, label: "Между седьмым и девятым" }),
      request,
    ]);
    state.expedition = expedition;
    state.listenHint = null;
    state.inspectHint = null;
    state.recommendedChoice = null;
    track("expedition_start");
    renderHome();
  } catch (error) {
    toast(error.message, "error");
    haptic("error");
  }
}
async function chooseSolo(choiceIndex) {
  try {
    $$('[data-solo-choice]').forEach((button) => (button.disabled = true));
    const previousState = { ...state.expedition.state };
    const door = $('.hall-door');
    door?.classList.add('door-opening');
    void audioEngine.cue('doorOpen', { pan: Math.random() * 0.34 - 0.17 });
    haptic('medium');
    const result = await api(`/api/expeditions/${state.expedition.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ choiceIndex, operationId: opId() }),
    });
    toast(result.outcome, 'neutral', false);
    if (Number(result.state?.clues) > Number(previousState.clues)) void audioEngine.cue('clueFound');
    if (Number(result.state?.danger) > Number(previousState.danger) + 3) void audioEngine.cue('dangerRise');
    if (Number(result.state?.nerve) < Number(previousState.nerve) - 3) void audioEngine.cue('nerveDrop');
    track('room_choice', {
      roomId: state.expedition.room?.id,
      choiceIndex,
      status: result.status,
      listened: state.listenHint?.roomId === state.expedition.room?.id,
    });
    state.expedition = { ...state.expedition, ...result };
    state.listenHint = null;
    if (result.status === 'active') {
      void audioEngine.cue('doorClose', { volume: 0.62 });
      await playFloorTransition({ floor: result.roomIndex + 8, label: 'Планировка меняется' });
      void audioEngine.cue('roomShift');
      renderHome();
    } else {
      void audioEngine.cue(result.status === 'escaped' ? 'escape' : 'failure');
      haptic(result.status === 'escaped' ? 'success' : 'error');
      view.innerHTML = `<div class="card" style="text-align:center;padding:30px"><div class="app-badge">${icon(result.status === 'escaped' ? 'check' : 'warning')} ВЫЛАЗКА ЗАВЕРШЕНА</div><h2 style="font-family:PT Serif">${result.status === 'escaped' ? 'Лифт вернул вас домой' : 'Коридор закрылся раньше'}</h2><p>Улики: ${result.state.clues} · опасность: ${result.state.danger}</p><div class="floor-map">${Array.from({ length: result.state.maxRooms }, () => '<i class="passed"></i>').join('')}</div><button class="primary full" id="soloReturn">${icon('home', 'button-icon')}Вернуться в квартиру</button></div>`;
      $('#soloReturn').onclick = async () => {
        if (result.status === 'escaped') await playFloorTransition({ floor: 1, label: 'Возвращение домой' });
        state.expedition = null;
        audioEngine.setTension(0);
        await bootstrap({ quiet: true });
      };
    }
  } catch (error) {
    toast(error.message, 'error');
    haptic('error');
    renderHome();
  }
}

function socketEmit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected)
      return reject(new Error("Нет соединения с домом"));
    state.socket
      .timeout(7000)
      .emit(event, payload, (err, res) =>
        err
          ? reject(new Error("Дом не ответил"))
          : res?.ok
            ? resolve(res.data)
            : reject(new Error(res?.error || "Операция не выполнена")),
      );
  });
}
function connectCoop(active = null) {
  if (!window.io) return;
  if (!state.socket) {
    state.socket = window.io({
      path: "/socket.io",
      auth: { initData: resolveTelegramInitData(), devUserId: devUser },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 650,
      reconnectionDelayMax: 4000,
      randomizationFactor: 0.35,
    });
    let connectedBefore = false;
    state.socket.on("connect", () => {
      $("#coopDot")?.classList.remove("hidden");
      if (connectedBefore) void audioEngine.cue("reconnect");
      connectedBefore = true;
      if (active?.id) socketEmit("coop:resume", { matchId: active.id }).catch(() => {});
    });
    state.socket.on("disconnect", () => {
      $("#coopDot")?.classList.add("hidden");
      void audioEngine.cue("uiWarning", { volume: 0.55 });
    });
    state.socket.on("coop:state", async (data) => {
      const previousRoom = state.coop?.roomIndex;
      const previousPhase = state.coop?.phase;
      state.coop = data;
      if (previousPhase !== "playing" && data.phase === "playing") void audioEngine.cue("matchStart");
      if (previousPhase === "playing" && ["escaped", "lost", "cancelled"].includes(data.phase))
        void audioEngine.cue(data.phase === "escaped" ? "escape" : "matchEnd");
      if (
        data.phase === "playing" &&
        (previousPhase !== "playing" ||
          (previousRoom != null && previousRoom !== data.roomIndex))
      ) {
        await playFloorTransition({
          floor: Number(data.roomIndex || 0) + 8,
          label: "Группа меняет комнату",
        });
      }
      if (state.tab === "coop") renderCoop();
    });
    state.socket.on("coop:matched", async (data) => {
      state.coop = data;
      void audioEngine.cue("coopJoin");
      toast("Лифт нашёл попутчиков", "success", false);
      await setTab("coop");
    });
    state.socket.on("connect_error", (error) => {
      console.warn("socket", error.message);
      $("#coopDot")?.classList.add("hidden");
    });
  } else if (active?.id && state.socket.connected)
    socketEmit("coop:resume", { matchId: active.id }).catch(() => {});
}
function renderCoop() {
  connectCoop(state.v2.activeCoop);
  if (!state.coop) return renderCoopEntry();
  const coop = state.coop;
  if (["escaped", "lost", "cancelled"].includes(coop.phase))
    return renderCoopEnd(coop);
  const room = coop.rooms?.[0];
  const remaining = coop.elevatorDeadlineAt
    ? Math.max(
        0,
        Math.ceil(
          (coop.elevatorDeadlineAt - (coop.serverTime || Date.now())) / 1000,
        ),
      )
    : null;
  view.innerHTML = `${section(
    coop.scenarioTitle || (coop.phase === "lobby" ? "Лифт ждёт жильцов" : "Совместная вылазка"),
    coop.phase === "lobby"
      ? (coop.scenarioTitle ? `Закрытое дело · владелец и ${Math.max(1,(coop.maxPlayers||3)-1)} гостя. Код можно отправить знакомым.` : "Код комнаты можно отправить знакомым.")
      : "Каждый видит только часть происходящего.",
  )}<div class="coop-lift">${coop.scenarioTitle?`<div class="app-badge">${icon("story")} ЗАКРЫТАЯ НОЧЬ</div>`:""}<div class="coop-code">${esc(coop.code)}</div><div class="residents-grid">${coop.players
    .map(
      (player) =>
        `<div class="resident"><span class="resident-avatar">${esc(player.name?.[0] || "?")}</span><div><b>${esc(player.name)}</b><small>${player.ready ? "готов" : "не готов"}${player.role ? ` · ${esc(player.role)}` : ""}</small></div><i class="dot ${player.connected ? "online" : ""}"></i></div>`,
    )
    .join(
      "",
    )}</div>${coop.private?.hint ? `<div class="private-note"><b>Только вы видите:</b><br>${esc(coop.private.hint)}</div>` : ""}${coop.private?.objective ? `<div class="private-note"><b>Скрытая цель:</b><br>${esc(coop.private.objective)}</div>` : ""}${coop.phase === "playing" ? `<div class="card-row"><div class="grow"><small>ДО ЗАКРЫТИЯ ЛИФТА</small><div class="countdown" data-deadline="${coop.elevatorDeadlineAt}">${formatTime(remaining)}</div></div><span class="pill warn">комната ${coop.roomIndex + 1}/${coop.roomsTotal || 6}</span></div>` : ""}</div>${coop.viewerMode === "spectator" ? renderSpectatorControls(coop) : coop.phase === "lobby" ? renderLobbyControls(coop) : renderCoopPlay(coop, room)}<div class="card"><h3>Записи группы</h3>${coop.log
    .slice(-5)
    .map((entry) => `<p>${esc(entry)}</p>`)
    .join("")}</div>`;
  bindCoop(coop);
  if (coop.phase === "playing") {
    startCoopTimer();
    bindCoopScene(coop, room);
  }
  void loop("coop-tension", 0.48);
  audioEngine.setTension(coop.shared?.danger || 0);
}

function bindCoopScene(coop, room) {
  const scene = $(".cinematic");
  if (!scene || !room) return;
  bindParallax(scene);
  const listenButton = $("[data-scene-listen]", scene);
  const lookButton = $("[data-scene-look]", scene);
  const overlay = $(".listen-overlay", scene);
  listenButton?.addEventListener("click", async () => {
    listenButton.disabled = true;
    listenButton.classList.add("active");
    overlay.classList.add("active");
    void ambient("whisper", 0.28, coop.private?.hint ? -0.7 : 0.7);
    await wait(900);
    $(".listen-copy", overlay).textContent =
      coop.private?.hint || "Вы слышите только чужое дыхание.";
    await coopAction("inspect", coop.id);
    await wait(550);
    overlay.classList.remove("active");
    listenButton.classList.remove("active");
    listenButton.disabled = false;
  });
  lookButton?.addEventListener("click", async () => {
    lookButton.disabled = true;
    $(".scene-noise", scene)?.classList.add("active");
    void effect("camera", 0.55, 0.25);
    await coopAction("mark", coop.id);
    await wait(380);
    $(".scene-noise", scene)?.classList.remove("active");
    lookButton.disabled = false;
  });
}
function renderCoopEntry() {
  view.innerHTML = `${section("Войти вместе", "2–4 реальных игрока. Один коридор, разные подсказки.")}${cinematic({ kicker: "КООПЕРАТИВНАЯ НОЧЬ", title: "Лифт не поедет с одним пассажиром", text: "Создайте комнату, введите код знакомого или доверьтесь подбору.", shadow: false })}<div class="button-row" style="margin-top:9px"><button class="primary" data-coop="create">Создать комнату</button><button class="secondary" data-coop="matchmake">Найти жильцов</button></div><div class="card form-stack"><label>Код лифта<input id="coopCode" class="input" maxlength="6" placeholder="Например: VIII08"></label><div class="button-row"><button class="secondary" data-coop="join">Войти по коду</button><button class="secondary" data-coop="spectate">Наблюдать</button></div></div><div class="card"><h3>Как это работает</h3><p>Действие одного меняет состояние комнаты у всех. Решение принимается голосованием. После обрыва соединения вы возвращаетесь в ту же вылазку.</p></div>`;
  $$("[data-coop]").forEach(
    (b) => (b.onclick = () => coopCommand(b.dataset.coop)),
  );
}
function renderLobbyControls(c) {
  const me =
    c.players.find(
      (p) => String(p.userId) === String(state.base.profile.user_id),
    ) || {};
  return `<div class="button-row" style="margin-top:8px"><button class="secondary" data-coop="ready">${me.ready ? "Снять готовность" : "Я готов"}</button>${String(c.hostId) === String(state.base.profile.user_id) ? '<button class="primary" data-coop="start">Закрыть двери</button>' : ""}<button class="danger" data-coop="leave">Выйти</button></div>`;
}
function renderSpectatorControls(c){
  const me=(c.spectators||[]).find(x=>String(x.userId)===String(state.base.profile.user_id));
  return `${cinematic({kicker:'КАМЕРЫ НАБЛЮДЕНИЯ',title:'Вы остались по эту сторону двери',text:'Смотрите с задержкой и вмешайтесь только один раз.',number:String(c.roomIndex+8),shadow:true})}<div class="card"><h3>Одно вмешательство</h3><p>${me?.usedIntervention?'Вы уже изменили эту вылазку. Теперь остаётся только смотреть.':'Выберите действие. Участники увидят результат, но не получат прямую подсказку.'}</p><div class="button-row"><button class="secondary" data-spectator="light" ${me?.usedIntervention?'disabled':''}>Аварийный свет</button><button class="secondary" data-spectator="mark" ${me?.usedIntervention?'disabled':''}>Метка на плёнке</button></div></div>`;
}
function renderCoopPlay(c, room) {
  if (!room) return '<div class="empty">Комната проявляется…</div>';
  return `${cinematic({ kicker: `ОБЩАЯ КОМНАТА ${c.roomIndex + 1}`, title: room.title, text: room.description, number: String(c.roomIndex + 8), shadow: c.shared.danger > 35 })}<div class="meter-grid"><div class="meter"><label>Нервы <b>${c.shared.nerve}</b></label><i style="--v:${c.shared.nerve}%"></i></div><div class="meter"><label>Опасность <b>${c.shared.danger}</b></label><i style="--v:${c.shared.danger}%"></i></div><div class="meter"><label>Улики <b>${c.shared.clues}</b></label><i style="--v:${Math.min(100, c.shared.clues * 12)}%"></i></div></div><div class="action-wheel"><button class="secondary" data-coop-action="inspect">Осмотреть отдельно</button><button class="secondary" data-coop-action="help">Поддержать жильца</button><button class="secondary" data-coop-action="mark">Оставить метку</button><button class="secondary" data-coop-action="light">Включить свет</button></div>${section("Общее решение", "Голос каждого видят все, но личную подсказку — только вы.")}<div class="vote-grid">${room.choices.map((choice, i) => `<button class="choice-button ${Object.values(c.votes || {}).includes(i) ? "voted" : ""}" data-coop-vote="${i}"><b>${esc(choice.label)}</b><small>${Object.values(c.votes || {}).filter((v) => v === i).length} голосов</small></button>`).join("")}</div>`;
}
function renderCoopEnd(c) {
  view.innerHTML = `<div class="card" style="text-align:center;padding:34px"><span class="eyebrow">ГРУППОВАЯ ВЫЛАЗКА</span><h2 style="font-family:PT Serif">${c.phase === "escaped" ? "Все вернулись к лифту" : c.phase === "lost" ? "Лифт закрылся" : "Комната распущена"}</h2><p>${c.log?.at(-1) || ""}</p><button class="primary" data-coop="reset">Вернуться в подъезд</button></div>`;
  $$("[data-coop]").forEach(
    (b) => (b.onclick = () => coopCommand(b.dataset.coop)),
  );
}
function bindCoop(c) {
  $$("[data-coop]").forEach(
    (b) => (b.onclick = () => coopCommand(b.dataset.coop, c)),
  );
  $$("[data-coop-action]").forEach(
    (b) => (b.onclick = () => coopAction(b.dataset.coopAction, c.id)),
  );
  $$("[data-coop-vote]").forEach(
    (b) => (b.onclick = () => coopVote(Number(b.dataset.coopVote), c.id)),
  );
}
async function coopCommand(command, c = state.coop) {
  try {
    connectCoop();
    if (command === "create") { state.coop = await socketEmit("coop:create", { maxPlayers: 4 }); void audioEngine.cue("coopJoin"); }
    if (command === "matchmake") {
      const r = await socketEmit("coop:matchmake", {});
      if (r.queued) toast(`Вы в очереди${r.position != null ? " · позиция " + (r.position + 1) : ""}`);
      else { state.coop = r.state; void audioEngine.cue("coopJoin"); }
    }
    if (command === "join") { state.coop = await socketEmit("coop:join", { code: $("#coopCode")?.value?.trim().toUpperCase() }); void audioEngine.cue("coopJoin"); }
    if (command === "spectate") { state.coop = await socketEmit("coop:spectate", { code: $("#coopCode")?.value?.trim().toUpperCase() }); void audioEngine.cue("spectatorCamera"); }
    if (command === "ready") {
      state.coop = await socketEmit("coop:ready", {
        matchId: c.id,
        ready: !c.players.find((p) => String(p.userId) === String(state.base.profile.user_id))?.ready,
      });
      void audioEngine.cue("coopReady");
    }
    if (command === "start") { state.coop = await socketEmit("coop:start", { matchId: c.id }); void audioEngine.cue("matchStart"); }
    if (command === "leave") { await socketEmit("coop:leave", { matchId: c.id }); state.coop = null; void audioEngine.cue("coopLeave"); }
    if (command === "reset") { state.coop = null; state.v2.activeCoop = null; void audioEngine.cue("uiBack"); }
    haptic("medium");
    renderCoop();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function spectatorAction(action,matchId){
  try{state.coop=await socketEmit('coop:spectator-action',{matchId,action});void audioEngine.cue(action==='light'?'spectatorLight':'spectatorCamera');haptic('medium');renderCoop();}catch(e){toast(e.message,'error');}
}
async function coopAction(action, matchId) {
  try {
    state.coop = await socketEmit("coop:action", { matchId, action });
    const sounds = { light: "spectatorLight", inspect: "camera", help: "coopReady", mark: "messageSend" };
    void audioEngine.cue(sounds[action] || "roomShift", { volume: 0.82 });
    haptic();
    renderCoop();
  } catch (e) {
    toast(e.message);
  }
}
async function coopVote(choiceIndex, matchId) {
  try {
    state.coop = await socketEmit("coop:vote", { matchId, choiceIndex });
    void audioEngine.cue("vote");
    renderCoop();
  } catch (e) {
    toast(e.message);
  }
}
function startCoopTimer() {
  clearInterval(startCoopTimer.i);
  startCoopTimer.i = setInterval(() => {
    const el = $("[data-deadline]");
    if (!el) return clearInterval(startCoopTimer.i);
    const sec = Math.max(
      0,
      Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000),
    );
    el.textContent = formatTime(sec);
  }, 1000);
}
function formatTime(sec) {
  if (sec == null) return "—";
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function renderBuilding() {
  const b = state.v2.building;
  view.innerHTML = `${section(b.building?.title || "Ваш подъезд", "Постоянное сообщество до 30 реальных жильцов.")}<div class="building-hero"><div><span class="eyebrow">${esc(b.building?.code || "П-???")}</span><div class="building-code">${b.members.length} жильцов</div><p>Старший: ${esc(b.building?.elder_name || "ещё не выбран")} · доверие дома ${b.building?.trust_score || 0}</p><div class="progress-track"><i style="width:${Math.min(100, Number(b.building?.shared_progress || 0))}%"></i></div></div><button class="round-button" data-building="invite" aria-label="Пригласить жильца">${icon("plus")}</button></div>${section("Доска объявлений", "Записи видит только ваш подъезд.", '<button class="secondary" data-building="post">Оставить запись</button>')}<div>${b.posts.length ? b.posts.map((p) => `<article class="board-post"><small>${esc(p.author_name)} · ${fmtDate(p.created_at)}</small><p>${esc(p.body)}</p></article>`).join("") : '<div class="empty">На доске пока только следы от кнопок.</div>'}</div>${section("Жильцы", "Доверие формируется поступками, его нельзя купить.")}<div class="card member-list">${b.members.map((m) => `<div class="member"><span class="resident-avatar">${esc(m.first_name?.[0] || "?")}</span><div><b>${esc(m.first_name)}</b><small>кв. ${m.apartment_no}${m.profession ? " · " + roleName(m.profession) : ""}</small></div><div style="text-align:right"><i class="dot ${m.online ? "online" : ""}"></i><small>${m.local_trust} доверия</small></div></div>`).join("")}</div>${section("Общий склад", "Предметы можно оставить соседям или взять для общей цели.")}<div class="storage-grid">${b.storage.length ? b.storage.map((x) => `<div class="storage-item"><div class="icon">${itemIcon(x.item_id)}</div><b>${esc(itemName(x.item_id))}</b><p>На складе: ${x.quantity}</p><button class="tiny-button" data-storage="withdraw" data-item="${x.item_id}" data-max="${x.quantity}">${icon("collection", "button-icon")}Взять со склада</button></div>`).join("") : '<div class="empty" style="grid-column:1/-1">Склад пуст.</div>'}</div><button class="secondary full" data-building="deposit" style="margin-top:8px">Положить предмет на склад</button>${section("Голосования", "Решения меняют последствия для всего подъезда.")}<div>${b.votes.length ? b.votes.map(renderVote).join("") : '<div class="empty">Открытых голосований нет.</div>'}</div>${section("Цель недели", "Совместный прогресс сохраняется для подъезда.")}<div>${b.goals.map((g) => `<div class="card"><h3>${esc(g.title)}</h3><div class="progress-track"><i style="width:${Math.min(100, (Number(g.progress) / Number(g.target)) * 100)}%"></i></div><p>${g.progress}/${g.target}</p></div>`).join("")}</div>`;
  bindBuilding();
}
function renderVote(v) {
  const opts = Array.isArray(v.options) ? v.options : [];
  return `<div class="card"><span class="eyebrow">${v.status === "open" ? "ГОЛОСОВАНИЕ ОТКРЫТО" : "РЕШЕНИЕ ПРИНЯТО"}</span><h3>${esc(v.title)}</h3><p>${esc(v.description)}</p><div class="button-row">${v.status === "open" ? opts.map((o) => `<button class="secondary" data-vote="${v.id}" data-option="${esc(o.key)}">${esc(o.label)}</button>`).join("") : `<span class="pill">${esc(v.result?.winner || "без решения")}</span>`}</div></div>`;
}
function bindBuilding() {
  $$("[data-building]").forEach(
    (b) => (b.onclick = () => buildingAction(b.dataset.building)),
  );
  $$("[data-storage]").forEach(
    (b) => (b.onclick = () => storageAction(b.dataset.item, b.dataset.storage)),
  );
  $$("[data-vote]").forEach(
    (b) => (b.onclick = () => castVote(b.dataset.vote, b.dataset.option)),
  );
}
async function buildingAction(action) {
  if (action === "invite") return shareInvite();
  if (action === "post") {
    openSheet(
      "Доска подъезда",
      "Запись останется у всех жильцов",
      `<div class="form-stack"><textarea id="postBody" maxlength="500" placeholder="Что произошло в доме?"></textarea><button class="primary" id="postSend">Приколоть к доске</button></div>`,
    );
    $("#postSend").onclick = async () => {
      try {
        await api("/api/building/posts", {
          method: "POST",
          body: JSON.stringify({ body: $("#postBody").value }),
        });
        closeSheet();
        toast("Запись появилась на доске");
        await bootstrap();
        setTab("building");
      } catch (e) {
        toast(e.message);
      }
    };
  }
  if (action === "deposit") {
    const items = state.base.inventory.filter((x) => x.quantity > 0);
    openSheet(
      "Общий склад",
      "Выберите предмет",
      `<div class="inventory-grid">${items.map((x) => `<button class="inventory-item" data-deposit="${x.item_id}"><span class="icon">${itemIcon(x.item_id)}</span><b>${esc(x.name || x.item_id)}</b><em>×${x.quantity}</em></button>`).join("")}</div>`,
    );
    $$("[data-deposit]", $("#sheetBody")).forEach(
      (b) => (b.onclick = () => storageAction(b.dataset.deposit, "deposit")),
    );
  }
}
async function storageAction(itemId, direction, quantity = null) {
  const available = direction === "withdraw"
    ? Number(state.v2?.building?.storage?.find((x) => x.item_id === itemId)?.quantity || 0)
    : Number(state.base?.inventory?.find((x) => x.item_id === itemId)?.quantity || 0);
  if (quantity == null) {
    if (available <= 0) return toast(direction === "withdraw" ? "На складе этот предмет уже закончился" : "У вас нет этого предмета", "warning");
    const max = Math.min(available, 20);
    openSheet(direction === "withdraw" ? "Забрать со склада" : "Положить на склад", itemName(itemId), `<div class="storage-transfer"><div class="storage-transfer-item"><span class="icon">${itemIcon(itemId)}</span><div><b>${esc(itemName(itemId))}</b><small>Доступно: ${available}</small></div></div><label>Количество<input id="storageQuantity" type="number" inputmode="numeric" min="1" max="${max}" value="1"></label><div class="quantity-quick">${[1,3,5,10].filter((x)=>x<=max).map((x)=>`<button class="secondary" data-storage-qty="${x}">${x}</button>`).join("")}</div><button class="primary full" id="storageConfirm">${direction === "withdraw" ? "Забрать в инвентарь" : "Передать соседям"}</button></div>`);
    $$('[data-storage-qty]', $("#sheetBody")).forEach((button) => button.onclick = () => { $("#storageQuantity").value = button.dataset.storageQty; });
    $("#storageConfirm").onclick = () => storageAction(itemId, direction, Math.max(1, Math.min(max, Number($("#storageQuantity").value || 1))));
    return;
  }
  const confirm = $("#storageConfirm");
  if (confirm) { confirm.disabled = true; confirm.textContent = "Проверяем склад…"; }
  try {
    const result = await api("/api/building/storage", {
      method: "POST",
      body: JSON.stringify({ itemId, quantity, direction, operationId: opId() }),
    });
    closeSheet();
    void audioEngine.cue(direction === "deposit" ? "itemPlace" : "itemPickup");
    toast(direction === "deposit" ? `Передано на склад: ${quantity}` : `Получено со склада: ${quantity}`, "success");
    await bootstrap({ quiet: true });
    state.tab = "building";
    renderBuilding();
  } catch (e) {
    toast(e.message, "error");
    if (confirm?.isConnected) { confirm.disabled = false; confirm.textContent = direction === "withdraw" ? "Забрать в инвентарь" : "Передать соседям"; }
  }
}

async function castVote(id, optionKey) {
  try {
    await api(`/api/building/votes/${id}`, {
      method: "POST",
      body: JSON.stringify({ optionKey }),
    });
    toast("Ваш голос записан");
    await bootstrap();
    setTab("building");
  } catch (e) {
    toast(e.message);
  }
}
function shareInvite() {
  const link = state.base.referralLink,
    text = "В нашем подъезде появилась дверь с твоим именем. Зайди в лифт.";
  if (tg?.openTelegramLink)
    tg.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
    );
  else
    navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"));
}

function renderArchive() {
  const tabs = [
    ["apartment", "Квартира"],
    ["collections", "Коллекции"],
    ["roles", "Профессия"],
    ["stories", "Личные дела"],
  ];
  view.innerHTML = `<div class="market-toolbar">${tabs.map(([id, label]) => `<button class="${state.archiveTab === id ? "primary" : "secondary"}" data-archive-tab="${id}">${label}</button>`).join("")}</div><div id="archiveBody"></div>`;
  $$("[data-archive-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        state.archiveTab = b.dataset.archiveTab;
        renderArchive();
      }),
  );
  renderArchiveBody();
}
function renderArchiveBody() {
  const root = $("#archiveBody");
  if (state.archiveTab === "apartment") return renderApartment(root);
  if (state.archiveTab === "collections") return renderCollections(root);
  if (state.archiveTab === "roles") return renderRoles(root);
  renderStories(root);
}
function renderApartment(root) {
  const placed = new Map(state.base.apartment.map((x) => [Number(x.slot), x]));
  root.innerHTML = `${section(`Квартира №${state.base.profile.apartment_no}`, "Предметы имеют историю владельцев и могут открывать сцены.")}<div class="apartment">${Array.from(
    { length: 12 },
    (_, i) => {
      const p = placed.get(i);
      return `<button class="apartment-slot" data-slot="${i}">${p?.icon || "·"}</button>`;
    },
  ).join(
    "",
  )}</div>${section("Вещи у двери", "Выберите предмет и свободное место.")}<div class="inventory-grid">${state.base.inventory.length ? state.base.inventory.map((x) => `<button class="inventory-item ${state.selectedItem === x.item_id ? "selected" : ""}" data-item="${x.item_id}"><span class="icon">${itemIcon(x.item_id)}</span><b>${esc(x.name || x.item_id)}</b><p>${esc(x.description || "")}</p><em>×${x.quantity}</em></button>`).join("") : '<div class="empty">Пока пусто.</div>'}</div>`;
  $$("[data-item]", root).forEach(
    (b) =>
      (b.onclick = () => {
        state.selectedItem = b.dataset.item;
        renderApartment(root);
        toast("Теперь выберите место в комнате");
      }),
  );
  $$("[data-slot]", root).forEach(
    (b) => (b.onclick = () => placeItem(Number(b.dataset.slot))),
  );
}
async function placeItem(slot) {
  if (!state.selectedItem) return toast("Сначала выберите предмет");
  try {
    await api("/api/apartment/place", {
      method: "POST",
      body: JSON.stringify({ itemId: state.selectedItem, slot, rotation: 0 }),
    });
    effect("place");
    state.selectedItem = null;
    await bootstrap();
    state.archiveTab = "apartment";
    setTab("archive");
  } catch (e) {
    toast(e.message);
  }
}
function renderCollections(root) {
  const c = state.v2.collections;
  root.innerHTML = `${section("Коллекции дома", "Завершение открывает комнату, историю или интерьер — не процент силы.")}<div class="collection-grid">${c.collections
    .map((x) => {
      const total = (x.entries || []).reduce(
        (sum, e) => sum + Number(e.needed || 0),
        0,
      );
      const found = (x.entries || []).reduce(
        (sum, e) => sum + Math.min(Number(e.owned || 0), Number(e.needed || 0)),
        0,
      );
      return `<article class="collection-card ${x.complete ? "complete" : ""}"><span class="eyebrow">${x.seasonal ? "СЕЗОННАЯ" : "АРХИВ"}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><progress max="${Math.max(1, total)}" value="${found}"></progress><small>${found}/${total}</small>${x.complete && !x.claimed ? `<button class="tiny-button full" data-claim="${x.id}">Открыть награду</button>` : ""}</article>`;
    })
    .join(
      "",
    )}</div>${section("Тихие достижения", "Часть условий раскрывается только после выполнения.")}<div>${c.achievements.map((a) => `<div class="card"><h3 class="${a.hidden && !a.unlocked_at ? "achievement-secret" : ""}">${esc(a.unlocked_at ? a.title : a.hidden ? "Запись скрыта" : a.title)}</h3><p>${esc(a.unlocked_at ? a.description : a.hidden ? "Дом ещё не разрешил прочитать условие." : a.description)}</p>${a.unlocked_at ? '<span class="pill ok">найдено</span>' : ""}</div>`).join("")}</div>`;
  $$("[data-claim]", root).forEach(
    (b) => (b.onclick = () => claimCollection(b.dataset.claim)),
  );
}
async function claimCollection(id) {
  try {
    await api(`/api/collections/${id}/claim`, { method: "POST", body: "{}" });
    toast("Коллекция открыла новую часть дома");
    await bootstrap();
    state.archiveTab = "collections";
    setTab("archive");
  } catch (e) {
    toast(e.message);
  }
}
function roleName(key) {
  return (
    state.v2?.roles?.[key]?.title ||
    {
      electrician: "Электрик",
      archivist: "Архивист",
      locksmith: "Слесарь",
      photographer: "Фотограф",
      courier: "Курьер",
      radio: "Радиолюбитель",
      chairman: "Председатель",
      observer: "Наблюдатель",
    }[key] ||
    key
  );
}
function renderRoles(root) {
  const current = state.v2.role?.role_key;
  root.innerHTML = `${section("Профессия жильца", "Это не класс с цифрами: профессия меняет решения, инструменты и социальную пользу.")}<div class="role-grid">${Object.entries(
    state.v2.roles || {},
  )
    .map(
      ([key, r]) =>
        `<article class="role-card ${current === key ? "current" : ""}"><span class="eyebrow">${current === key ? "ВАША РОЛЬ" : "ДОСТУПНАЯ РОЛЬ"}</span><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="button-row"><span class="pill">${esc(r.tool)}</span>${current !== key ? `<button class="tiny-button" data-role="${key}">Выбрать</button>` : ""}</div></article>`,
    )
    .join("")}</div>`;
  $$("[data-role]", root).forEach(
    (b) => (b.onclick = () => chooseRole(b.dataset.role)),
  );
}
async function chooseRole(role) {
  try {
    await api(`/api/roles/${role}`, { method: "POST", body: "{}" });
    toast(`Новая профессия: ${roleName(role)}`);
    await bootstrap();
    state.archiveTab = "roles";
    setTab("archive");
  } catch (e) {
    toast(e.message);
  }
}
function renderStories(root) {
  root.innerHTML = `${section("Персональные сюжетные линии", "Дом выдаёт истории по поступкам: ложь, помощь, звук, фотографии и брошенные соседи.")}<div>${state.v2.storylines.length ? state.v2.storylines.map((x) => `<article class="card story-card"><span class="eyebrow">ГЛАВА ${Number(x.chapter) + 1}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><button class="secondary" data-story="${x.id}">Сделать выбор</button></article>`).join("") : '<div class="empty">Дом ещё собирает ваше личное дело.</div>'}</div>`;
  $$("[data-story]", root).forEach(
    (b) => (b.onclick = () => storyChoice(b.dataset.story)),
  );
}

async function loadMarket() {
  try {
    state.market = await api("/api/market");
    renderMarket();
  } catch (e) {
    toast(e.message);
  }
}
function renderMarket() {
  const tabs = [
    ["market", "Лоты"],
    ["sell", "Продать"],
    ["shop", "Stars"],
    ["purchases", "Покупки"],
  ];
  view.innerHTML = `<div class="market-toolbar">${tabs.map(([id, label]) => `<button class="${state.marketTab === id ? "primary" : "secondary"}" data-market-tab="${id}">${label}</button>`).join("")}</div><div id="marketBody"></div>`;
  $$("[data-market-tab]").forEach(
    (b) =>
      (b.onclick = async () => {
        state.marketTab = b.dataset.marketTab;
        if (state.marketTab === "market" && !state.market) await loadMarket();
        else renderMarket();
      }),
  );
  if (state.marketTab === "market") renderPlayerMarket();
  if (state.marketTab === "sell") renderSell();
  if (state.marketTab === "shop") renderStarsShop();
  if (state.marketTab === "purchases") renderPurchases();
}
function renderPlayerMarket() {
  const root = $("#marketBody");
  if (!state.market) {
    root.innerHTML =
      '<div class="loading-scene"><p>Считаем записи в книге обмена…</p></div>';
    return void loadMarket();
  }
  const m = state.market;
  root.innerHTML = `${section("Рынок жильцов", `Расчёт внутренними марками. Комиссия дома ${m.commissionPercent}%. Stars не выводятся и не обмениваются.`)}<div>${m.listings.length ? m.listings.map((x) => `<article class="card listing"><div><span class="eyebrow">${x.anonymous ? "АНОНИМНЫЙ ЛОТ" : esc(x.seller_name || "Жилец")}</span><h3>${esc(itemName(x.item_id))}</h3><p>${x.remaining} шт. · до ${fmtDate(x.expires_at)}</p></div><div style="text-align:right"><div class="price">${x.price_per_unit} марок</div>${x.mine ? '<span class="pill">ваш лот</span>' : `<button class="tiny-button" data-buy-listing="${x.id}">Купить 1</button>`}</div></article>`).join("") : '<div class="empty">Активных лотов нет.</div>'}</div>${
    m.history.length
      ? `<div class="card"><h3>История цен</h3><div class="history-line">${m.history
          .slice(0, 30)
          .reverse()
          .map(
            (x) =>
              `<i style="height:${Math.max(5, Math.min(100, Number(x.avg_price)))}%" title="${x.avg_price}"></i>`,
          )
          .join("")}</div></div>`
      : ""
  }`;
  $$("[data-buy-listing]", root).forEach(
    (b) => (b.onclick = () => buyListing(b.dataset.buyListing)),
  );
}
async function buyListing(id) {
  try {
    await api(`/api/market/listings/${id}/buy`, {
      method: "POST",
      body: JSON.stringify({ quantity: 1, operationId: opId() }),
    });
    toast("Сделка записана в книгу владельцев");
    state.market = null;
    await bootstrap();
    state.marketTab = "market";
    setTab("market");
  } catch (e) {
    toast(e.message);
  }
}
function renderSell() {
  const items = state.base.inventory.filter(
    (x) => x.quantity > 0 && !x.item_id.startsWith("story_"),
  );
  $("#marketBody").innerHTML =
    `${section("Выставить находку", "Сюжетные предметы и билеты продавать нельзя.")}<form id="sellForm" class="card form-stack"><label>Предмет<select name="itemId">${items.map((x) => `<option value="${x.item_id}">${esc(x.name || x.item_id)} · ${x.quantity} шт.</option>`).join("")}</select></label><label>Количество<input type="number" name="quantity" min="1" max="100" value="1"></label><label>Цена за единицу, марки<input type="number" name="price" min="1" max="100000" value="10"></label><label class="switch-row"><span>Скрыть имя продавца</span><input type="checkbox" name="anonymous"></label><button class="primary">Опубликовать лот</button></form>`;
  $("#sellForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/api/market/listings", {
        method: "POST",
        body: JSON.stringify({
          itemId: f.get("itemId"),
          quantity: Number(f.get("quantity")),
          price: Number(f.get("price")),
          anonymous: f.get("anonymous") === "on",
          operationId: opId(),
        }),
      });
      toast("Лот появился на рынке");
      state.market = null;
      state.marketTab = "market";
      renderMarket();
    } catch (err) {
      toast(err.message);
    }
  };
}
function renderStarsShop() {
  const products = state.base.shop || [];
  $("#marketBody").innerHTML =
    `${section("Сюжетные покупки", "Полные главы, кооперативные ночи, интерьеры и подарки. Никакой покупки победы.")}<div class="shop-grid">${products.map((x) => `<article class="shop-item"><span class="eyebrow">${x.limited_until ? `ДО ${fmtDate(x.limited_until)}` : "TELEGRAM STARS"}</span><div class="shop-product-visual">${productIcon(x)}</div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p>${x.full_contents ? `<small>${esc(Array.isArray(x.full_contents) ? x.full_contents.join(" · ") : JSON.stringify(x.full_contents))}</small>` : ""}<div class="button-row"><button class="tiny-button" data-buy="${x.sku}">★ ${x.stars}</button><button class="tiny-button secondary" data-gift="${x.sku}">Подарить</button></div></article>`).join("")}</div>`;
  $$("[data-buy]").forEach((b) => (b.onclick = () => buyStars(b.dataset.buy)));
  $$("[data-gift]").forEach(
    (b) => (b.onclick = () => giftProduct(b.dataset.gift)),
  );
}
async function buyStars(sku) {
  try {
    const { invoiceLink, purchaseId } = await api(`/api/shop/${sku}/invoice`, {
      method: "POST",
      body: "{}",
    });
    if (!tg?.openInvoice)
      throw new Error("Счёт Stars открывается только внутри Telegram");
    tg.openInvoice(invoiceLink, (status) => {
      if (status === "paid") {
        effect("purchase");
        toast("Оплата подтверждена. Проверяем выдачу…");
        pollPurchase(purchaseId);
      } else if (status === "cancelled") toast("Счёт закрыт");
    });
  } catch (e) {
    toast(e.message);
  }
}
async function pollPurchase(id) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 850));
    try {
      const p = await api(`/api/purchases/${id}/status`);
      if (p.status === "paid") {
        toast("Покупка выдана");
        await bootstrap();
        return;
      }
    } catch {}
  }
  toast("Платёж принят. История обновится позже.");
}
function giftProduct(sku) {
  const members = state.v2.building.members.filter(
    (x) => String(x.id) !== String(state.base.profile.user_id),
  );
  openSheet(
    "Подарок жильцу",
    "Telegram Stars",
    `<div class="form-stack"><label>Получатель<select id="giftTarget">${members.map((m) => `<option value="${m.id}">${esc(m.first_name)} · кв. ${m.apartment_no}</option>`).join("")}</select></label><label>Подпись<textarea id="giftMessage" maxlength="160" placeholder="Оставьте короткую записку"></textarea></label><label class="switch-row"><span>Анонимно</span><input id="giftAnonymous" type="checkbox"></label><button class="primary" id="giftPay">Выставить счёт</button></div>`,
  );
  $("#giftPay").onclick = async () => {
    try {
      const r = await api(`/api/gifts/${sku}/invoice`, {
        method: "POST",
        body: JSON.stringify({
          targetId: Number($("#giftTarget").value),
          message: $("#giftMessage").value,
          anonymous: $("#giftAnonymous").checked,
        }),
      });
      tg.openInvoice(r.invoiceLink, (status) => {
        if (status === "paid") {
          closeSheet();
          toast("Подарок отправлен");
        }
      });
    } catch (e) {
      toast(e.message);
    }
  };
}
function renderPurchases() {
  const p = state.v2.purchases || [];
  $("#marketBody").innerHTML =
    `${section("История покупок", "Статус, выдача, возврат и восстановление после сбоя.")}<div class="card">${p.length ? p.map((x) => `<div class="purchase-row"><div><b>${esc(x.title || x.sku)}</b><small>${fmtDate(x.created_at)} · ${x.stars} ★</small></div><div style="text-align:right"><span class="pill ${x.status === "paid" ? "ok" : x.status === "refunded" ? "bad" : ""}">${esc(x.status)}</span>${x.status === "paid" && !x.revoked_at ? `<button class="tiny-button" data-restore="${x.id}">Восстановить</button>` : ""}</div></div>`).join("") : "<p>Покупок пока нет.</p>"}</div><button class="secondary full" data-more="support-payment">Проблема с оплатой</button>`;
  $$("[data-restore]").forEach(
    (b) => (b.onclick = () => restorePurchase(b.dataset.restore)),
  );
  $('[data-more="support-payment"]')?.addEventListener("click", () => {
    state.tab = "more";
    state.moreTab = "support";
    render();
  });
}
async function restorePurchase(id) {
  try {
    await api(`/api/purchases/${id}/restore`, { method: "POST", body: "{}" });
    toast("Сервер повторно проверил выдачу");
    await bootstrap();
    state.marketTab = "purchases";
    setTab("market");
  } catch (e) {
    toast(e.message);
  }
}
function itemIconName(id) {
  const map = {
    matchbox: "spark",
    chalk: "note",
    cassette: "radio",
    brass_key: "key",
    torn_photo: "camera",
    fuse: "signal",
    spare_key: "key",
    black_thread: "clue",
    archive_stamp: "archive",
    blackout_ticket: "door",
    company_night_ticket: "coop",
    radio: "radio",
    plant_fern: "spark",
    darkroom_wallpaper: "collection",
    old_door_collection: "door",
  };
  return map[id] || "collection";
}
function itemIcon(id, className = "ui-icon") {
  return icon(itemIconName(id), className);
}
function productIcon(product) {
  const type = product?.product_type || product?.type || "pack";
  return icon(
    type.includes("coop")
      ? "coop"
      : type.includes("chapter")
        ? "archive"
        : type.includes("limited")
          ? "collection"
          : "gift",
    "shop-product-icon",
  );
}

function itemName(id) {
  return (
    state.base?.inventory?.find((x) => x.item_id === id)?.name ||
    id.replaceAll("_", " ")
  );
}

function renderMore() {
  const tabs = [
    ["settings", "Система", "settings"],
    ["signal", "Радио", "radio"],
    ["notes", "Записки", "note"],
    ["gifts", "Подарки", "gift"],
    ["support", "Связь", "support"],
    ["houseplus", "Дом+", "spark"],
  ];
  view.innerHTML = `<div class="market-toolbar">${tabs
    .map(
      ([id, label, iconName]) =>
        `<button class="${state.moreTab === id ? "primary" : "secondary"}" data-more-tab="${id}">${icon(iconName, "button-icon")}${label}</button>`,
    )
    .join("")}</div><div id="moreBody"></div>`;
  $$("[data-more-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        state.moreTab = button.dataset.moreTab;
        renderMore();
      }),
  );
  renderMoreBody();
}
function renderMoreBody() {
  if (state.moreTab === "settings") return renderSettings();
  if (state.moreTab === "signal") return renderSignalRitual();
  if (state.moreTab === "support") return renderSupport();
  if (state.moreTab === "notes") return renderNotes();
  if (state.moreTab === "houseplus") return renderHousePlus();
  return renderGifts();
}

function applyInterfaceAnomaly(anomaly) {
  document.body.classList.remove("anomaly-mislabel", "anomaly-shift", "anomaly-clock", "anomaly-ghost", "anomaly-neighbor");
  if (!anomaly) return;
  const map = { mislabel: "anomaly-mislabel", shift_button: "anomaly-shift", wrong_clock: "anomaly-clock", ghost_inventory: "anomaly-ghost", false_neighbor: "anomaly-neighbor" };
  document.body.classList.add(map[anomaly.anomaly_type] || "anomaly-mislabel");
}
function tgCallback(target, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!target?.[method]) return reject(new Error("Функция недоступна в этой версии Telegram"));
    target[method](...args, (...callbackArgs) => {
      const first = callbackArgs[0];
      if (first instanceof Error || typeof first === "string" && /error|failed/i.test(first)) reject(first instanceof Error ? first : new Error(first));
      else resolve(callbackArgs.length > 1 ? callbackArgs : first);
    });
  });
}
function v4Card(title, text, iconName, action = "") {
  return `<article class="v4-feature-card"><div class="v4-feature-icon">${icon(iconName)}</div><div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div></article>`;
}
function renderHousePlus() {
  const tabs = [["social","Жильцы"],["premium","Дела"],["night","00:08"],["identity","Ключ"],["creator","Создать"],["chronicle","Хроника"]];
  const root = $("#moreBody");
  root.innerHTML = `${section("Скрытые системы дома", "Функции, которые связывают игру с реальными чатами, устройством и историей жильцов.")}
    <div class="subnav v4-subnav">${tabs.map(([id,label])=>`<button class="${state.houseTab===id?'active':''}" data-house-tab="${id}">${label}</button>`).join("")}</div>
    <div id="housePlusBody"></div>`;
  $$('[data-house-tab]').forEach(b=>b.onclick=()=>{state.houseTab=b.dataset.houseTab;renderHousePlus();});
  if(state.houseTab==="social") return renderV4Social();
  if(state.houseTab==="premium") return renderV4Premium();
  if(state.houseTab==="night") return renderV4Night();
  if(state.houseTab==="identity") return renderV4Identity();
  if(state.houseTab==="creator") return renderV4Creator();
  renderV4Chronicle();
}
function renderV4Social(){
  const root=$("#housePlusBody"),v=state.v4;
  const traces=(v.traces||[]).slice(0,6);
  const rels=(v.relationships||[]).slice(0,5);
  const cases=v.chatCases||[];
  root.innerHTML=`<div class="v4-grid">
    ${v4Card("Следы жильцов","Чужие маршруты остаются в комнатах и иногда лгут.","eye",`<button class="secondary small" id="leaveTrace">Оставить след</button>`)}
    ${v4Card("Карточка ночи","Поделитесь итогом вылазки как нативным сообщением или историей Telegram.","send",`<div class="button-row"><button class="primary small" id="shareResult">В чат</button><button class="secondary small" id="shareStory">В историю</button></div>`)}
    ${v4Card("Дело для чата","Выберите существующую группу и создайте расследование для всей компании.","coop",`<button class="primary small" id="prepareChatCase">Выбрать чат</button>`)}
  </div>
  <div class="card"><h3>Следы рядом</h3><div class="trace-list">${traces.length?traces.map(t=>`<div><span class="trace-symbol">${icon(t.trace_type==='sound'?'sound':t.trace_type==='camera'?'camera':'eye')}</span><p><b>${esc(t.room_id)}</b><small>${esc(t.payload?.outcome||t.payload?.choice||'Кто-то прошёл здесь раньше.')}</small></p></div>`).join(''):'<p>Следов пока нет. Дом ждёт первого решения.</p>'}</div></div>
  <div class="card"><h3>Связи</h3>${rels.length?rels.map(r=>`<div class="relationship-row"><span>${esc(r.first_name)} · кв. ${esc(r.apartment_no||'—')}</span><b>${Number(r.trust)>=0?'+':''}${r.trust}</b><small>${(r.labels||[]).map(String).join(', ')||'сосед'}</small></div>`).join(''):'<p>Совместные вылазки создадут долги, доверие и секреты.</p>'}</div>
  <div class="card"><h3>Активные дела</h3>${cases.length?cases.map(c=>`<div class="case-row"><b>${esc(c.chat_title||'Чат ещё не выбран')}</b><span>${esc(c.invite_code)}</span><small>${esc(c.status)} · участников ${c.members}</small></div>`).join(''):'<p>Ни одного дела для чата.</p>'}<form id="joinCaseForm" class="inline-form"><input name="code" maxlength="20" placeholder="Код дела"><button class="secondary">Войти</button></form></div>`;
  $("#leaveTrace").onclick=async()=>{try{await api('/api/v4/traces',{method:'POST',body:JSON.stringify({roomId:state.expedition?.state?.route?.[state.expedition?.roomIndex]?.id||'home-corridor',type:'message',payload:{outcome:'На стене осталось: «я вернулся»'}})});toast('След останется для другого жильца','success');await refreshV4();}catch(e){toast(e.message,'error');}};
  let sharePayload=null;
  async function preparedShare(){if(sharePayload)return sharePayload;sharePayload=await api('/api/v4/share',{method:'POST',body:JSON.stringify({kind:'night_result',title:'ВОСЬМОГО ЭТАЖА НЕТ',subtitle:`Квартира №${state.base.profile.apartment_no} вернулась из вылазки`,facts:[`Улики: ${state.base.profile.clues}`,`Доверие: ${state.base.profile.trust}`,`Самообладание: ${state.base.profile.nerve}`,state.v4.antagonist?.publicMessage||'Управляющий наблюдает']})});return sharePayload;}
  $("#shareResult").onclick=async()=>{try{const p=await preparedShare();if(p.preparedMessageId&&tg?.shareMessage)tg.shareMessage(p.preparedMessageId,ok=>toast(ok?'Карточка отправлена':'Отправка отменена'));else shareInvite();}catch(e){toast(e.message,'error');}};
  $("#shareStory").onclick=async()=>{try{const p=await preparedShare();if(tg?.shareToStory&&p.storyUrl)tg.shareToStory(p.storyUrl,{text:p.storyText,widget_link:{url:p.inviteUrl,name:'Открыть дом'}});else toast('Истории недоступны в этой версии Telegram');}catch(e){toast(e.message,'error');}};
  $("#prepareChatCase").onclick=async()=>{try{const p=await api('/api/v4/chat-cases/prepare',{method:'POST',body:JSON.stringify({scenarioKey:'missing-tenant'})});if(!tg?.requestChat)throw new Error('Обновите Telegram: нужен Bot API 9.6+');tg.requestChat(p.requestId,ok=>{toast(ok?`Чат выбран. Код дела: ${p.inviteCode}`:'Выбор чата отменён',ok?'success':'neutral');setTimeout(()=>refreshV4(),1000);});}catch(e){toast(e.message,'error');}};
  $("#joinCaseForm").onsubmit=async e=>{e.preventDefault();try{const code=new FormData(e.currentTarget).get('code');const r=await api('/api/v4/chat-cases/join',{method:'POST',body:JSON.stringify({code})});toast(`Вы вошли как: ${r.role}`,'success');await refreshV4();}catch(err){toast(err.message,'error');}};
}
function premiumKindLabel(type){return type==='story_chapter'?'СЮЖЕТНАЯ ГЛАВА':type==='coop_case'?'КООПЕРАТИВНОЕ ДЕЛО':'ИНТЕРЬЕР';}
function premiumSlug(item){return String(item.content_key||'').replace(/^chapter-/,'').replace(/^coop-/,'');}
function renderV4Premium(){
  const root=$("#housePlusBody"),items=state.v4.premium||[];
  const stories=items.filter(x=>x.content_type==='story_chapter'),cases=items.filter(x=>x.content_type==='coop_case'),interiors=items.filter(x=>x.content_type==='interior');
  const card=item=>`<article class="premium-case ${item.owned?'owned':''}"><span class="app-badge">${premiumKindLabel(item.content_type)}</span><h3>${esc(item.title)}</h3><p>${item.content_type==='story_chapter'?`${item.metadata?.scenes||'Несколько'} сцен · ${item.metadata?.durationMinutes||45} минут`:item.content_type==='coop_case'?`${item.metadata?.durationMinutes||35} минут · владелец + ${item.metadata?.guestSlots||2} гостя`:`${item.metadata?.objects||16} интерактивных объектов`}</p><div class="premium-status">${item.owned?`<span class="pill ok">Ключ получен</span>${item.completed_at?'<span class="pill">Пройдено</span>':''}`:'<span class="pill warn">Нужен билет Stars</span>'}</div><button class="${item.owned?'primary':'secondary'} full" data-premium="${esc(item.content_key)}" data-type="${item.content_type}">${item.owned?(item.content_type==='story_chapter'?(item.current_node_id?'Продолжить главу':'Начать главу'):item.content_type==='coop_case'?'Создать закрытую ночь':'Применить интерьер'):'Открыть в магазине'}</button></article>`;
  root.innerHTML=`${cinematic({kicker:'ЛИЧНЫЙ АРХИВ',title:'Истории, которые остаются у владельца',text:'Билет открывает полную главу или ночь. В кооперативное дело владелец бесплатно берёт двух друзей.',number:'8',ambience:'archive'})}
  <h3 class="premium-heading">Сюжетные главы</h3><div class="premium-grid">${stories.map(card).join('')||'<div class="empty">Главы ещё не опубликованы.</div>'}</div>
  <h3 class="premium-heading">Закрытые ночи</h3><div class="premium-grid">${cases.map(card).join('')||'<div class="empty">Закрытых дел пока нет.</div>'}</div>
  <h3 class="premium-heading">Квартиры</h3><div class="premium-grid">${interiors.map(card).join('')||'<div class="empty">Интерьеры готовятся.</div>'}</div>`;
  $$('[data-premium]').forEach(button=>button.onclick=async()=>{const item=items.find(x=>x.content_key===button.dataset.premium);if(!item)return;if(!item.owned){state.marketTab='shop';await setTab('market');return;}if(item.content_type==='story_chapter')return playPremiumStory(premiumSlug(item));if(item.content_type==='coop_case')return createPremiumCoop(item.content_key);return applyPremiumInterior(item.content_key);});
}
async function playPremiumStory(slug,nodeOverride){
  try{
    const document=await api(`/api/content/${slug}`),graph=document.graph||{},nodes=graph.nodes||[],edges=graph.edges||[];
    const progress=(state.v4.premium||[]).find(x=>premiumSlug(x)===slug);
    const nodeId=nodeOverride||progress?.current_node_id||graph.startNodeId;
    const node=nodes.find(x=>x.id===nodeId);if(!node)throw new Error('Сцена главы не найдена');
    const outgoing=edges.filter(x=>x.from===node.id);
    openSheet(node.title||document.title,'СЮЖЕТНАЯ ГЛАВА',`<div class="story-reader"><div class="story-scene-noise"></div><p>${esc(node.text||node.config?.text||'')}</p>${node.type==='ending'?`<div class="private-note"><b>Дело закрыто</b><br>Награда сохранена в квартире и архиве.</div><button class="primary full" id="storyClose">Вернуться в дом</button>`:`<div class="story-choices">${outgoing.map(edge=>`<button class="choice-button" data-story-to="${esc(edge.to)}"><b>${esc(edge.label||'Продолжить')}</b></button>`).join('')}</div>`}</div>`);
    void ambient(node.config?.audio||'floor-ambience',.28);
    if(node.type==='ending'){ $("#storyClose").onclick=async()=>{closeSheet();await refreshV4();renderV4Premium();};return; }
    $$('[data-story-to]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const result=await api(`/api/v4/content/${slug}/advance`,{method:'POST',body:JSON.stringify({fromNodeId:node.id,toNodeId:button.dataset.storyTo})});const item=(state.v4.premium||[]).find(x=>premiumSlug(x)===slug);if(item){item.current_node_id=result.currentNodeId;if(result.completed)item.completed_at=new Date().toISOString();}void effect(result.completed?'purchase':'door',.55);await playPremiumStory(slug,result.currentNodeId);}catch(error){button.disabled=false;toast(error.message,'error');}});
  }catch(error){toast(error.message,'error');}
}
async function applyPremiumInterior(contentKey){
  try{const result=await api(`/api/v4/interiors/${contentKey}/apply`,{method:'POST'});void effect('place',.65);haptic('success');toast(`Интерьер «${result.title}» применён`,'success');await bootstrap({quiet:true});state.houseTab='premium';setTab('more');}catch(error){toast(error.message,'error');}
}
async function createPremiumCoop(contentKey){
  try{connectCoop();state.coop=await socketEmit('coop:create',{maxPlayers:3,scenarioSku:contentKey});await setTab('coop');toast(`Закрытая ночь создана · код ${state.coop.code}`,'success');}catch(error){toast(error.message,'error');}
}
function renderV4Night(){
  const root=$("#housePlusBody"),n=state.v4.liveNight?.night,a=state.v4.antagonist||{};
  const start=n?new Date(n.starts_at).getTime():0,end=n?new Date(n.ends_at).getTime():0,now=Date.now();const live=n&&start<=now&&end>now;
  root.innerHTML=`${cinematic({kicker:'ЕЖЕНЕДЕЛЬНО · 00:08',title:n?.title||'Ночь готовится',text:live?'Свет погас во всех подъездах одновременно. Каждый найденный фрагмент меняет общий финал.':`Следующее открытие: ${n?fmtDate(n.starts_at):'не назначено'}`,number:'8',ambience:'corridor'})}
  <div class="card live-night-card"><div class="progress-head"><b>${n?`${n.global_progress} / ${n.global_target}`:'0 / 0'}</b><span>${live?'СОБЫТИЕ ИДЁТ':'ОЖИДАНИЕ'}</span></div><div class="meter"><i style="width:${n?Math.min(100,n.global_progress/n.global_target*100):0}%"></i></div>${live?'<button class="primary full" id="nightContribute">Передать найденный фрагмент</button>':'<p>Опоздавшие увидят последствия, но не смогут изменить решение.</p>'}</div>
  <div class="card manager-card"><span class="app-badge">${icon('eye')} УПРАВЛЯЮЩИЙ</span><h3>${a.mode==='player'?'Он среди жильцов':'Он меняет записи сам'}</h3><p>${esc(a.publicMessage||'Не отвечайте на объявления после полуночи.')}</p>${a.isYou?`<div class="button-grid"><button data-manager="forge_notice">Подделать объявление</button><button data-manager="lock_room">Закрыть комнату</button><button data-manager="move_item">Переложить предмет</button><button data-manager="false_vote">Изменить бюллетень</button></div>`:''}</div>
  <div class="card"><h3>Комнаты движения</h3><p>Редкие сцены используют акселерометр и ориентацию. На компьютере остаётся кодовый способ.</p><div class="button-grid"><button data-motion-room="tilt">Не наклоняй</button><button data-motion-room="still">Не двигайся</button><button data-motion-room="peephole">Глазок</button><button data-motion-room="tune">Настроить частоту</button></div><div id="motionResult"></div></div>`;
  if($("#nightContribute"))$("#nightContribute").onclick=async()=>{try{state.v4.liveNight=await api('/api/v4/live-night/contribute',{method:'POST',body:JSON.stringify({amount:5,fragment:`Квартира ${state.base.profile.apartment_no}: код ${Math.floor(Math.random()*90+10)}`})});toast('Фрагмент передан всему дому','success');renderV4Night();}catch(e){toast(e.message,'error');}};
  $$('[data-manager]').forEach(b=>b.onclick=async()=>{try{await api('/api/v4/antagonist/action',{method:'POST',body:JSON.stringify({action:b.dataset.manager})});toast('Правило дома изменено','success');await refreshV4();}catch(e){toast(e.message,'error');}});
  $$('[data-motion-room]').forEach(b=>b.onclick=()=>runMotionRoom(b.dataset.motionRoom));
}
async function runMotionRoom(type){const output=$("#motionResult");try{const ch=await api('/api/v4/motion',{method:'POST',body:JSON.stringify({type})});const instructions={tilt:'Держите телефон ровно три секунды.',still:'Замрите и не двигайте телефон три секунды.',peephole:'Медленно поверните телефон влево и вправо, осматривая глазок.',tune:'Сделайте широкий плавный поворот, пока сигнал не станет чистым.'};output.innerHTML=`<div class="motion-challenge"><b>Комната слушает датчики…</b><p>${instructions[type]}</p><button class="secondary small" id="motionFallback">Ввести резервный код ${esc(ch.fallback)}</button></div>`;let passed=false,samples=[];const sensor=type==='peephole'||type==='tune'?tg?.DeviceOrientation:tg?.Accelerometer;if(sensor?.start){sensor.start({refresh_rate:100,need_absolute:false},ok=>{if(!ok)return;const timer=setInterval(()=>{samples.push(type==='peephole'||type==='tune'?{alpha:sensor.alpha,beta:sensor.beta,gamma:sensor.gamma}:{x:sensor.x,y:sensor.y,z:sensor.z});},110);setTimeout(async()=>{clearInterval(timer);sensor.stop?.();if(samples.length>=8){const r=await api(`/api/v4/motion/${ch.id}/verify`,{method:'POST',body:JSON.stringify({result:{passed:true,samples:samples.slice(-20)}})});output.innerHTML=`<p class="success-copy">Комната отпустила вас. +${r.reward.clues} улика.</p>`;}},3200);});}else output.insertAdjacentHTML('beforeend','<p>Датчики недоступны — используйте резервный код.</p>');$("#motionFallback").onclick=async()=>{const r=await api(`/api/v4/motion/${ch.id}/verify`,{method:'POST',body:JSON.stringify({result:{fallback:true},fallbackCode:ch.fallback})});output.innerHTML=`<p class="success-copy">Альтернативное испытание пройдено. +${r.reward.clues} улика.</p>`;};}catch(e){output.innerHTML=`<p>${esc(e.message)}</p>`;}}
function renderV4Identity(){
 const root=$("#housePlusBody"),safe=state.v4.biometricSafe||{},statuses=state.v4.emojiStatuses?.items||[];
 root.innerHTML=`<div class="v4-grid">${v4Card("Биометрический сейф",safe.enrolled?'Документ запечатан на этом устройстве.':'Привяжите сейф к отпечатку или Face ID.',"lock",`<button class="primary small" id="biometricAction">${safe.enrolled?'Открыть':'Настроить'}</button>`)}${v4Card("Ключ на главном экране","Дом предложит установку только после важного момента.","key",`<button class="secondary small" id="smartInstall">Оставить ключ</button>`)}${v4Card("Статус жильца","Покажите профессию или находку в emoji-статусе Telegram.","spark",`<button class="secondary small" id="emojiAccess">Разрешить статусы</button>`)}</div>
 <div class="card"><h3>Доступные статусы</h3><div class="status-grid">${statuses.map(x=>`<button data-emoji-status="${esc(x.custom_emoji_id||'')}" ${x.custom_emoji_id?'':'disabled'}><b>${esc(x.title)}</b><small>${x.custom_emoji_id?'Установить':'ID задаётся в админке'}</small></button>`).join('')}</div></div>
 ${state.v4.anomaly?`<div class="card anomaly-card"><h3>Интерфейс ведёт себя неправильно</h3><p>Это безопасная сюжетная аномалия: платежи, поддержка и настройки не затрагиваются.</p><button class="secondary" id="ackAnomaly">Зафиксировать в архиве</button></div>`:''}`;
 $("#biometricAction").onclick=()=>safe.enrolled?unlockSafe():enrollSafe();
 $("#smartInstall").onclick=async()=>{try{await api('/api/v4/home-screen',{method:'POST',body:JSON.stringify({kind:'prompted'})});if(tg?.checkHomeScreenStatus)tg.checkHomeScreenStatus(status=>{if(status==='added')toast('Ключ уже лежит на главном экране');else tg.addToHomeScreen?.();});else if(state.installPrompt)state.installPrompt.prompt();else toast('Функция недоступна на этом устройстве');}catch(e){toast(e.message,'error');}};
 $("#emojiAccess").onclick=()=>{if(!tg?.requestEmojiStatusAccess)return toast('Обновите Telegram для emoji-статусов');tg.requestEmojiStatusAccess(async allowed=>{await api('/api/v4/emoji-statuses/access',{method:'POST',body:JSON.stringify({allowed:Boolean(allowed)})});toast(allowed?'Доступ разрешён':'Доступ не предоставлен');});};
 $$('[data-emoji-status]').forEach(b=>b.onclick=()=>tg?.setEmojiStatus?.(b.dataset.emojiStatus,{duration:86400},ok=>toast(ok?'Статус установлен':'Статус не изменён')));
 if($("#ackAnomaly"))$("#ackAnomaly").onclick=async()=>{await api(`/api/v4/anomalies/${state.v4.anomaly.id}/ack`,{method:'POST',body:'{}'});state.v4.anomaly=null;applyInterfaceAnomaly(null);renderV4Identity();};
}
async function enrollSafe(){const bm=tg?.BiometricManager;if(!bm)return toast('Биометрия недоступна');bm.init(()=>bm.requestAccess({reason:'Запечатать личный архив квартиры'},async allowed=>{if(!allowed)return toast('Доступ не предоставлен');const secret=crypto.randomUUID()+crypto.randomUUID();bm.updateBiometricToken(secret,async saved=>{if(!saved)return toast('Не удалось сохранить ключ');const result=await api('/api/v4/biometric/enroll',{method:'POST',body:JSON.stringify({deviceId:bm.deviceId||'telegram-device',biometricToken:secret})});tg?.SecureStorage?.setItem?.('ef_safe_recovery',result.recoveryCode);toast(`Сейф настроен. Код восстановления: ${result.recoveryCode}`,'success');await refreshV4();});}));}
async function unlockSafe(){const bm=tg?.BiometricManager;if(!bm)return toast('Биометрия недоступна');bm.init(()=>bm.authenticate({reason:'Открыть личный документ'},async(ok,biometricToken)=>{if(!ok)return toast('Сейф остался закрыт');try{const r=await api('/api/v4/biometric/unlock',{method:'POST',body:JSON.stringify({biometricToken})});openSheet('Личный сейф','ТОЛЬКО ВЛАДЕЛЕЦ',`<div class="sealed-document"><h3>${esc(r.payload.document)}</h3><p>${esc(r.payload.line)}</p></div>`);}catch(e){toast(e.message,'error');}}));}
function renderV4Creator(){
 const root=$("#housePlusBody"),voices=state.v4.voices?.own||[],rooms=state.v4.userRooms||[];
 root.innerHTML=`<div class="card"><h3>Голос соседа</h3><p>Запишите одну разрешённую фразу до 4 секунд. Запись появится у друзей только после модерации.</p><select id="voicePhrase"><option value="dont_open">Не открывай</option><option value="im_here">Я здесь</option><option value="lift_arrived">Лифт приехал</option><option value="not_my_flat">Это не моя квартира</option><option value="look_back">Посмотри назад</option></select><button class="primary full" id="recordVoice">Записать 3 секунды</button><div class="voice-list">${voices.map(v=>`<div><b>${esc(v.phrase_key)}</b><span>${esc(v.status)}</span><button data-delete-voice="${v.id}">Удалить</button></div>`).join('')}</div>${state.v4.voices?.neighbor?`<div class="voice-neighbor"><b>Сообщение от ${esc(state.v4.voices.neighbor.first_name)}</b><p>Запись прошла модерацию и доступна только жильцам этого дома.</p><button class="secondary small" id="playNeighborVoice">Прослушать</button></div>`:''}</div>
 <form id="roomBuilder" class="card form-stack"><h3>Архитектор комнаты</h3><input name="title" required minlength="3" maxlength="80" placeholder="Название комнаты"><select name="layout"><option value="corridor">Коридор</option><option value="flat">Квартира</option><option value="archive">Архив</option><option value="utility">Служебное помещение</option></select><div class="component-checks">${['door','window','table','radio','mirror','lamp','wardrobe','camera','mailbox','pipes'].map(x=>`<label><input type="checkbox" name="components" value="${x}">${x}</label>`).join('')}</div><select name="sound"><option>pipes</option><option>wind</option><option>camera</option><option>voices</option><option>radio</option><option>elevator</option><option>water</option><option>glass</option></select><input name="choice1" required value="Осмотреть комнату"><input name="outcome1" required value="Вы нашли чужой след."><input name="choice2" required value="Уйти тихо"><input name="outcome2" required value="Комната запомнила ваше решение."><button class="primary">Сохранить комнату</button></form>
 <div class="card"><h3>Комнаты жильцов</h3>${rooms.length?rooms.map(r=>`<div class="creator-room"><b>${esc(r.title)}</b><span>${esc(r.status)} · ${r.plays} прохождений · ${r.likes} отметок</span><div class="button-row">${r.own&&['draft','rejected'].includes(r.status)?`<button data-submit-room="${r.id}">На модерацию</button>`:''}${r.status==='published'?`<button data-play-room="${r.id}">Пройти</button><button data-like-room="${r.id}">Нравится</button>`:''}</div></div>`).join(''):'<p>Опубликованных комнат пока нет.</p>'}</div>`;
 $("#recordVoice").onclick=recordNeighborVoice;
 $$('[data-delete-voice]').forEach(b=>b.onclick=async()=>{await api(`/api/v4/voices/${b.dataset.deleteVoice}`,{method:'DELETE'});await refreshV4();renderV4Creator();});
 $("#roomBuilder").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),components=f.getAll('components');try{await api('/api/v4/user-rooms',{method:'POST',body:JSON.stringify({title:f.get('title'),layout:f.get('layout'),components,sound:f.get('sound'),light:'flicker',puzzle:'sequence',choices:[{label:f.get('choice1'),outcome:f.get('outcome1')},{label:f.get('choice2'),outcome:f.get('outcome2')}]})});toast('Черновик комнаты сохранён','success');await refreshV4();renderV4Creator();}catch(err){toast(err.message,'error');}};
 $$('[data-submit-room]').forEach(b=>b.onclick=async()=>{await api(`/api/v4/user-rooms/${b.dataset.submitRoom}/submit`,{method:'POST',body:'{}'});toast('Комната отправлена на модерацию','success');await refreshV4();renderV4Creator();});
 $$('[data-play-room]').forEach(b=>b.onclick=async()=>{const room=await api(`/api/v4/user-rooms/${b.dataset.playRoom}/play`,{method:'POST',body:'{}'});openSheet(room.title,'КОМНАТА ЖИЛЬЦА',`<div class="user-room-preview"><p>${esc(room.template?.components?.join(' · '))}</p><p>Звук: ${esc(room.template?.sound)}</p></div>`);});
 $$('[data-like-room]').forEach(b=>b.onclick=async()=>{await api(`/api/v4/user-rooms/${b.dataset.likeRoom}/review`,{method:'POST',body:JSON.stringify({liked:true})});toast('Отметка оставлена');});
}
async function recordNeighborVoice(){try{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Запись недоступна на этом устройстве');const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});const preferred=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';const recorder=new MediaRecorder(stream,{mimeType:preferred,audioBitsPerSecond:32000});const chunks=[];recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);recorder.start();toast('Говорите. Запись закончится через 3 секунды.');await wait(3000);recorder.stop();await new Promise(r=>recorder.onstop=r);stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:preferred});const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});await api('/api/v4/voices',{method:'POST',body:JSON.stringify({phraseKey:$("#voicePhrase").value,mimeType:blob.type,audioBase64:base64,durationMs:3000,consent:true})});toast('Запись отправлена на модерацию','success');await refreshV4();renderV4Creator();}catch(e){toast(e.message,'error');}}
function renderV4Chronicle(){
 const root=$("#housePlusBody"),seasons=state.v4.seasonArchive||[],payments=state.v4.payments||[];
 root.innerHTML=`<div class="archive-timeline">${seasons.map(s=>`<section><header><span>${esc(s.status)}</span><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p></header>${(s.entries||[]).map(e=>`<article><time>${esc(e.date)}</time><div><b>${esc(e.title)}</b><p>${esc(e.body)}</p><button data-remember="${e.id}">Это было со мной</button></div></article>`).join('')}</section>`).join('')}</div>
 <div class="card"><h3>Покупки и восстановление</h3>${payments.length?payments.map(p=>`<div class="purchase-row"><b>${esc(p.sku)}</b><span>${p.stars} Stars · ${esc(p.status)}</span><small>${fmtDate(p.created_at)} ${p.fulfillment_created?'· выдано':'· ожидает восстановления'}</small><button data-pay-support="${p.id}">Проблема с покупкой</button></div>`).join(''):'<p>Покупок пока нет.</p>'}<p><code>/paysupport</code> также создаёт обращение прямо в боте.</p></div>`;
 $$('[data-remember]').forEach(b=>b.onclick=async()=>{await api(`/api/v4/season-archive/${b.dataset.remember}/remember`,{method:'POST',body:JSON.stringify({state:{witnessed:true,at:new Date().toISOString()}})});toast('Личная отметка добавлена в архив','success');});
 $$('[data-pay-support]').forEach(b=>b.onclick=async()=>{const text=prompt('Кратко опишите проблему с этой покупкой');if(!text)return;await api('/api/v4/payment-support',{method:'POST',body:JSON.stringify({purchaseId:b.dataset.paySupport,body:text})});toast('Обращение по оплате создано','success');});
}
async function refreshV4(){state.v4=await api('/api/v4/bootstrap');applyInterfaceAnomaly(state.v4.anomaly);}

function renderSettings() {
  $("#moreBody").innerHTML =
    `${section("Дом звучит слоями", "Звуковая сцена сводится в реальном времени и меняется вместе с этажом.")}
  <div class="card form-stack">
    <div class="headphone-callout">${icon("headphones")}<div><b>Пространственный звук</b><p>Шаги, лифт и голоса получают направление. Для полной сцены используйте наушники.</p></div></div>
    <label>Окружение <output>${state.audio.ambience}</output><input data-audio="ambience" type="range" min="0" max="100" value="${state.audio.ambience}"></label>
    <label>Игровые действия <output>${state.audio.effects}</output><input data-audio="effects" type="range" min="0" max="100" value="${state.audio.effects}"></label>
    <label>Интерфейс <output>${state.audio.interface}</output><input data-audio="interface" type="range" min="0" max="100" value="${state.audio.interface}"></label>
    <label class="switch-row"><span>Пространственный звук</span><input data-audio="spatial" type="checkbox" ${state.audio.spatial ? "checked" : ""}></label>
    <label class="switch-row"><span>Редкие звуки дома</span><input data-audio="rare" type="checkbox" ${state.audio.rare ? "checked" : ""}></label>
    <label class="switch-row"><span>Ночной режим громкости</span><input data-audio="night" type="checkbox" ${state.audio.night ? "checked" : ""}></label>
    <label class="switch-row"><span>Вибрация</span><input data-audio="vibration" type="checkbox" ${state.audio.vibration ? "checked" : ""}></label>
    <label class="switch-row"><span>Полная тишина</span><input data-audio="mute" type="checkbox" ${state.audio.mute ? "checked" : ""}></label>
    <label class="switch-row"><span>Уменьшить анимации</span><input data-motion type="checkbox" ${state.motionReduced ? "checked" : ""}></label>
    <button class="secondary" id="settingsAudioTest">${icon("signal", "button-icon")}Проверить левую и правую стену</button>
  </div>
  <div class="card"><div class="app-badge">${icon("spark")} ПРИЛОЖЕНИЕ</div><h3>Установить вход в дом</h3><p>Telegram поддерживает полноэкранный режим и добавление Mini App на главный экран на совместимых устройствах.</p><div class="button-row"><button class="secondary" id="fullscreenRequest">На весь экран</button><button class="secondary" id="homeScreenRequest">На главный экран</button></div></div>
  <div class="card"><h3>Аккаунт жильца</h3><p>Версия ${esc(state.v2.appVersion || APP_VERSION)} · сессия ${esc(state.sessionId.slice(0, 8))} · устройство ${lowPerformance ? "бережный режим" : "полная графика"}</p><button class="secondary full" id="shareInvite">${icon("send", "button-icon")}Пригласить знакомого</button></div>`;
  $$("[data-audio]").forEach(
    (input) =>
      (input.oninput = () =>
        updateAudio(
          input.dataset.audio,
          input.type === "checkbox" ? input.checked : Number(input.value),
        )),
  );
  $("[data-motion]").onchange = (event) => {
    state.motionReduced = event.target.checked;
    localStorage.setItem("ef_reduce_motion", state.motionReduced ? "1" : "0");
    document.body.classList.toggle("reduce-motion", state.motionReduced);
  };
  $("#settingsAudioTest").onclick = () => audioEngine.testSpace();
  $("#shareInvite").onclick = shareInvite;
  $("#fullscreenRequest").onclick = () => tg?.requestFullscreen?.();
  $("#homeScreenRequest").onclick = () => {
    if (tg?.addToHomeScreen) tg.addToHomeScreen();
    else if (state.installPrompt) state.installPrompt.prompt();
    else toast("Установка недоступна в этой версии Telegram");
  };
}
function updateAudio(key, value) {
  state.audio[key] = value;
  localStorage.setItem(
    `ef_${key}`,
    ["mute", "vibration", "spatial", "rare", "night"].includes(key)
      ? (value ? "1" : "0")
      : String(value),
  );
  audioEngine.applyVolumes();
  if (key === "mute" && value) audioEngine.stopAll();
  else startHouseAudio();
  const use = $("#soundIconUse");
  use?.setAttribute(
    "href",
    `/assets/icons.svg#${state.audio.mute ? "mute" : "sound"}`,
  );
  if (state.moreTab === "settings" && $("#moreBody")) renderSettings();
}

async function playKnock(long = false, pan = 0) {
  await audioEngine.cue(long ? "radioLong" : "radioShort", { pan });
  haptic(long ? "medium" : "light");
}

async function renderSignalRitual() {
  const root = $("#moreBody");
  if (!state.signalRitual) {
    root.innerHTML =
      '<div class="loading-scene"><i></i><p>Приёмник ищет частоту…</p></div>';
    try {
      state.signalRitual = await api("/api/ritual/signal");
      state.signalAnswer = [];
    } catch (error) {
      root.innerHTML = `<div class="card"><h3>Радиорубка закрыта</h3><p>${esc(error.message)}</p></div>`;
      return;
    }
  }
  const ritual = state.signalRitual;
  const remaining = Math.max(0, ritual.maxAttempts - ritual.attempts);
  root.innerHTML = `${section("Частота между этажами", "Раз в ночь дом передаёт ритм. Услышьте его и повторите короткие и длинные удары.")}
  <div class="signal-console">
    <div class="app-badge">${icon("radio")} РАДИОРУБКА · 00:08</div>
    <div class="signal-screen"><div class="signal-trace"></div></div>
    <div class="timeline" id="signalAnswer">${Array.from({ length: 5 }, (_, index) => `<i class="${state.signalAnswer?.[index] != null ? "done" : ""}" style="height:${state.signalAnswer?.[index] === 1 ? 18 : 7}px"></i>`).join("")}</div>
    ${ritual.completedAt ? `<div class="card"><span class="pill ok">Сигнал расшифрован</span><p>Вы получили ${ritual.reward.clues} улику и ${ritual.reward.marks} марок дома. В архиве появилась скрытая запись.</p></div>` : `<p>Попыток осталось: <b>${remaining}</b></p><div class="button-row"><button class="secondary" id="signalPlay">${icon("sound", "button-icon")}Прослушать</button><button class="secondary" id="signalShort">Короткий</button><button class="secondary" id="signalLong">Длинный</button></div><div class="button-row" style="margin-top:8px"><button class="secondary" id="signalReset">Сбросить</button><button class="primary" id="signalSubmit" ${state.signalAnswer?.length === 5 ? "" : "disabled"}>Проверить ритм</button></div>`}
  </div>`;
  if (ritual.completedAt) return;
  $("#signalPlay").onclick = async () => {
    $("#signalPlay").disabled = true;
    for (let index = 0; index < ritual.pattern.length; index += 1) {
      await playKnock(ritual.pattern[index] === 1, index % 2 ? 0.45 : -0.45);
      await wait(ritual.pattern[index] === 1 ? 520 : 330);
    }
    $("#signalPlay").disabled = false;
  };
  const add = async (value) => {
    if (state.signalAnswer.length >= 5) return;
    state.signalAnswer.push(value);
    await playKnock(value === 1, value ? 0.35 : -0.35);
    renderSignalRitual();
  };
  $("#signalShort").onclick = () => add(0);
  $("#signalLong").onclick = () => add(1);
  $("#signalReset").onclick = () => {
    state.signalAnswer = [];
    renderSignalRitual();
  };
  $("#signalSubmit").onclick = async () => {
    try {
      const result = await api("/api/ritual/signal", {
        method: "POST",
        body: JSON.stringify({ answer: state.signalAnswer }),
      });
      state.signalRitual = result;
      state.signalAnswer = [];
      if (result.correct) {
        void audioEngine.cue("radioSuccess");
        haptic("success");
        toast("Сигнал принят. Архив пополнился.", "success");
        await bootstrap({ quiet: true });
      } else {
        void audioEngine.cue("radioFail");
        haptic("warning");
        toast("Ритм не совпал. Приёмник всё ещё работает.", "warning");
      }
      state.moreTab = "signal";
      renderMore();
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
function renderSupport() {
  const s = state.v2.support;
  $("#moreBody").innerHTML =
    `${section("Служба дома", "Telegram ID, версия, последняя вылазка и покупка прикладываются автоматически.", '<button class="secondary" id="newTicket">Новое обращение</button>')}<div>${
      s.tickets.length
        ? s.tickets
            .map(
              (t) =>
                `<article class="card"><span class="eyebrow">${esc(t.category)} · ${esc(t.status)}</span><h3>${esc(t.subject)}</h3><p>${fmtDate(t.updated_at)}</p>${s.messages
                  .filter((m) => m.ticket_id === t.id)
                  .map(
                    (m) =>
                      `<div class="private-note"><b>${m.from_user ? "Вы" : m.admin_name || "Домоуправление"}</b><br>${esc(m.body)}</div>`,
                  )
                  .join(
                    "",
                  )}<button class="tiny-button" data-ticket-reply="${t.id}">Ответить</button></article>`,
            )
            .join("")
        : '<div class="empty">Обращений нет.</div>'
    }</div>`;
  $("#newTicket").onclick = openTicketForm;
  $$("[data-ticket-reply]").forEach(
    (b) => (b.onclick = () => ticketReply(b.dataset.ticketReply)),
  );
}
function openTicketForm() {
  openSheet(
    "Новое обращение",
    "Служба дома",
    `<form id="ticketForm" class="form-stack"><label>Категория<select name="category"><option value="bug">Ошибка</option><option value="payment">Оплата</option><option value="account">Аккаунт</option><option value="moderation">Жалоба</option><option value="idea">Предложение</option><option value="other">Другое</option></select></label><label>Тема<input name="subject" minlength="3" maxlength="120" required></label><label>Сообщение<textarea name="body" minlength="3" maxlength="3000" required></textarea></label><label>Скриншот<input name="screenshot" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="primary">Отправить</button></form>`,
  );
  $("#ticketForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      file = f.get("screenshot");
    let screenshot;
    if (file?.size) screenshot = await fileData(file);
    try {
      await api("/api/support", {
        method: "POST",
        body: JSON.stringify({
          category: f.get("category"),
          subject: f.get("subject"),
          body: f.get("body"),
          screenshot,
          appVersion: state.v2.appVersion,
          context: { tab: state.tab },
        }),
      });
      closeSheet();
      toast("Обращение передано домоуправлению");
      await bootstrap();
      state.moreTab = "support";
      setTab("more");
    } catch (err) {
      toast(err.message);
    }
  };
}
function fileData(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function ticketReply(id) {
  openSheet(
    "Ответить поддержке",
    "Журнал обращения",
    `<div class="form-stack"><textarea id="replyBody" maxlength="3000"></textarea><button id="replySend" class="primary">Отправить</button></div>`,
  );
  $("#replySend").onclick = async () => {
    try {
      await api(`/api/support/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: $("#replyBody").value }),
      });
      closeSheet();
      toast("Ответ добавлен");
      await bootstrap();
      state.moreTab = "support";
      setTab("more");
    } catch (e) {
      toast(e.message);
    }
  };
}
function renderNotes() {
  const notes = state.base.notes || [];
  $("#moreBody").innerHTML =
    `${section("Записки у двери", "Нежелательное сообщение можно отправить на проверку.")}<div>${notes.length ? notes.map((n) => `<article class="board-post"><small>${esc(n.author_name || "Неизвестный жилец")} · ${fmtDate(n.created_at)}</small><p>${esc(n.body)}</p><button class="tiny-button" data-report-note="${n.id}" data-author="${n.author_id}">Пожаловаться</button></article>`).join("") : '<div class="empty">Под дверью ничего нет.</div>'}</div>${section("Оставить соседу", "Записка будет доставлена асинхронно.")}<div class="card form-stack"><select id="noteTarget">${state.v2.building.members
      .filter((m) => String(m.id) !== String(state.base.profile.user_id))
      .map(
        (m) =>
          `<option value="${m.id}">${esc(m.first_name)} · кв. ${m.apartment_no}</option>`,
      )
      .join(
        "",
      )}</select><textarea id="noteBody" maxlength="280"></textarea><button id="noteSend" class="primary">Оставить у двери</button></div>`;
  $("#noteSend").onclick = sendNote;
  $$("[data-report-note]").forEach(
    (b) =>
      (b.onclick = () =>
        reportEntity(b.dataset.author, "note", b.dataset.reportNote)),
  );
}
async function sendNote() {
  try {
    await api("/api/social/note", {
      method: "POST",
      body: JSON.stringify({
        targetId: $("#noteTarget").value,
        body: $("#noteBody").value,
        mood: "strange",
      }),
    });
    effect("paper");
    toast("Записка оставлена");
    await bootstrap();
    state.moreTab = "notes";
    setTab("more");
  } catch (e) {
    toast(e.message);
  }
}
function reportEntity(targetId, entityType, entityId) {
  openSheet(
    "Жалоба",
    "Модерация подъезда",
    `<div class="form-stack"><select id="reportReason"><option value="spam">Спам</option><option value="abuse">Оскорбление</option><option value="fraud">Мошенничество</option><option value="other">Другое</option></select><textarea id="reportDetails" maxlength="1000"></textarea><button id="reportSend" class="danger">Отправить на проверку</button></div>`,
  );
  $("#reportSend").onclick = async () => {
    try {
      await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          targetId: String(targetId),
          entityType,
          entityId,
          reason: $("#reportReason").value,
          details: $("#reportDetails").value,
        }),
      });
      closeSheet();
      toast("Жалоба зарегистрирована");
    } catch (e) {
      toast(e.message);
    }
  };
}
function renderGifts() {
  const gifts = state.v2.gifts || [];
  $("#moreBody").innerHTML =
    `${section("Подарки у двери", "Билеты, интерьеры и кассеты от реальных жильцов.")}<div>${gifts.length ? gifts.map((g) => `<article class="card"><span class="eyebrow">${g.anonymous ? "АНОНИМНЫЙ ПОДАРОК" : esc(g.sender_name || "Жилец")}</span><h3>${esc(g.title || g.sku)}</h3><p>${esc(g.message || "Без записки")}</p><span class="pill ${g.status === "delivered" ? "warn" : "ok"}">${esc(g.status)}</span>${g.status === "delivered" ? `<button class="tiny-button" data-claim-gift="${g.id}">Принять</button>` : ""}</article>`).join("") : '<div class="empty">Подарков пока нет.</div>'}</div>`;
  $$("[data-claim-gift]").forEach(
    (b) => (b.onclick = () => claimGift(b.dataset.claimGift)),
  );
}
async function claimGift(id) {
  try {
    await api(`/api/gifts/${id}/claim`, { method: "POST", body: "{}" });
    toast("Подарок принят");
    await bootstrap();
    state.moreTab = "gifts";
    setTab("more");
  } catch (e) {
    toast(e.message);
  }
}

function renderTutorial() {
  const t = state.v2.tutorial,
    step = Number(t.step),
    current = t.current;
  if (!current) return $("#tutorialOverlay").classList.add("hidden");
  const overlay = $("#tutorialOverlay");
  overlay.classList.remove("hidden");
  const visual = tutorialVisual(current.action);
  overlay.innerHTML = `<div class="tutorial-frame ${current.action !== "open_door" ? "open" : ""}" data-tutorial-frame><div class="tutorial-visual">${visual}</div><div class="tutorial-copy"><div class="tutorial-progress">${t.steps.map((_, i) => `<i class="${i <= step ? "done" : ""}"></i>`).join("")}</div><span class="eyebrow">ПЕРВАЯ НОЧЬ · ${step + 1}/${t.total}</span><h1>${esc(current.title)}</h1><p>${esc(current.text)}</p><button class="primary full" id="tutorialAction" ${current.action === "inspect_room" ? "disabled" : ""}>${esc(current.cta)}</button></div></div>`;
  bindTutorial(current.action);
}
function tutorialVisual(action) {
  if (action === "open_door")
    return '<div class="tutorial-door-left"></div><div class="tutorial-door-right"></div><div class="bulb"></div>';
  if (action === "inspect_room")
    return `${cinematic({ title: "Коридор уже знает ваше имя", text: "Найдите три детали.", shadow: true, tools: false })}<button class="inspect-point" style="left:20%;top:32%" data-inspect="1"></button><button class="inspect-point" style="right:21%;top:48%" data-inspect="2"></button><button class="inspect-point" style="left:48%;top:20%" data-inspect="3"></button>`;
  if (action === "take_item")
    return '<div class="tutorial-object">▣</div><div class="lamp-cone"></div>';
  if (action === "make_choice")
    return `${cinematic({ title: "Тук · тук-тук", text: "За дверью дышат в вашем ритме.", number: "?", shadow: true, tools: false })}`;
  if (action === "lose_nerve")
    return '<div class="tutorial-object" style="font-size:90px">◉</div><div class="shadow-person" style="right:42%;top:25%"></div>';
  if (action === "return_home")
    return '<div class="tutorial-door-left" style="transform:translateX(-70%)"></div><div class="tutorial-door-right" style="transform:translateX(70%)"></div><div class="coop-code" style="padding-top:30px">00:08</div>';
  if (action === "place_item")
    return '<div class="tutorial-object">▣</div><div class="apartment" style="position:absolute;inset:12% 8% 4%;height:auto"><button class="apartment-slot">·</button></div>';
  if (action === "read_note")
    return '<div class="tutorial-note">Не отвечай консьержу.<br>Его не существует.<br><br>— квартира 8</div>';
  return '<div class="hall-door" data-number="ТВОЙ ДРУГ" style="bottom:20%;width:145px"></div><div class="lamp-cone"></div>';
}
function bindTutorial(action) {
  if (action === "inspect_room") {
    $$("[data-inspect]").forEach(
      (p) =>
        (p.onclick = () => {
          p.classList.add("done");
          state.tutorialInspect.add(p.dataset.inspect);
          effect("camera", 0.45);
          if (state.tutorialInspect.size >= 3)
            $("#tutorialAction").disabled = false;
        }),
    );
  }
  $("#tutorialAction").onclick = async () => {
    try {
      if (action === "open_door") {
        $("[data-tutorial-frame]").classList.add("open");
        effect("elevator");
        await new Promise((r) => setTimeout(r, 900));
      }
      if (action === "take_item") effect("paper");
      if (action === "make_choice") effect("door");
      if (action === "lose_nerve") {
        effect("impact");
        haptic("heavy");
      }
      if (action === "return_home") effect("elevator");
      if (action === "place_item") effect("place");
      if (action === "read_note") effect("paper");
      const result = await api("/api/tutorial/action", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      state.v2.tutorial = { ...state.v2.tutorial, ...result };
      state.tutorialInspect.clear();
      if (result.completed) {
        $("#tutorialOverlay").classList.add("hidden");
        toast("Вы заселены. Дом уже знает ваше имя.");
        await bootstrap();
      } else {
        state.v2.tutorial.current = result.current;
        renderTutorial();
      }
    } catch (e) {
      toast(e.message);
    }
  };
}

function openSheet(title, kicker, html) {
  $("#sheetTitle").textContent = title;
  $("#sheetKicker").textContent = kicker;
  $("#sheetBody").innerHTML = html;
  $("#sheet").showModal();
  void audioEngine.cue("uiOpen");
  updateTelegramNavigation();
  haptic();
}
function closeSheet() {
  if ($("#sheet").open) {
    $("#sheet").close();
    void audioEngine.cue("uiClose");
  }
  updateTelegramNavigation();
}

$("#sheetClose").onclick = closeSheet;
$("#sheet").addEventListener("click", (event) => {
  if (event.target === $("#sheet")) closeSheet();
});
$("#dailyRibbon").onclick = async () => {
  if (state.tab !== "home") await setTab("home");
  document
    .querySelector(".daily-scene")
    ?.scrollIntoView({ behavior: state.motionReduced ? "auto" : "smooth" });
};
$("#bottomNav").onclick = (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) void setTab(button.dataset.tab);
};
$("#soundButton").onclick = () => {
  const opening = $("#soundPanel").classList.contains("hidden");
  $("#soundPanel").classList.toggle("hidden");
  void audioEngine.cue(opening ? "uiOpen" : "uiClose");
  startHouseAudio();
  updateTelegramNavigation();
};
$("#soundClose").onclick = () => {
  $("#soundPanel").classList.add("hidden");
  void audioEngine.cue("uiClose");
  updateTelegramNavigation();
};
$("#ambienceVolume").value = state.audio.ambience;
$("#effectsVolume").value = state.audio.effects;
$("#interfaceVolume").value = state.audio.interface;
$("#muteToggle").checked = state.audio.mute;
$("#vibrationToggle").checked = state.audio.vibration;
$("#spatialToggle").checked = state.audio.spatial;
$("#rareToggle").checked = state.audio.rare;
$("#nightToggle").checked = state.audio.night;
$("#motionToggle").checked = state.motionReduced;
$("#ambienceValue").textContent = state.audio.ambience;
$("#effectsValue").textContent = state.audio.effects;
$("#interfaceValue").textContent = state.audio.interface;
$("#soundIconUse")?.setAttribute(
  "href",
  `/assets/icons.svg#${state.audio.mute ? "mute" : "sound"}`,
);
$("#ambienceVolume").oninput = (event) => {
  $("#ambienceValue").textContent = event.target.value;
  updateAudio("ambience", Number(event.target.value));
};
$("#effectsVolume").oninput = (event) => {
  $("#effectsValue").textContent = event.target.value;
  updateAudio("effects", Number(event.target.value));
};
$("#interfaceVolume").oninput = (event) => {
  $("#interfaceValue").textContent = event.target.value;
  updateAudio("interface", Number(event.target.value));
};
$("#spatialToggle").onchange = (event) => updateAudio("spatial", event.target.checked);
$("#rareToggle").onchange = (event) => updateAudio("rare", event.target.checked);
$("#nightToggle").onchange = (event) => updateAudio("night", event.target.checked);
$("#muteToggle").onchange = (event) =>
  updateAudio("mute", event.target.checked);
$("#vibrationToggle").onchange = (event) =>
  updateAudio("vibration", event.target.checked);
$("#motionToggle").onchange = (event) => {
  state.motionReduced = event.target.checked;
  localStorage.setItem("ef_reduce_motion", state.motionReduced ? "1" : "0");
  document.body.classList.toggle("reduce-motion", state.motionReduced);
};
$("#audioTest").onclick = () => audioEngine.testSpace();

let lastSliderSoundAt = 0;
function interactionCueFor(element) {
  if (!element) return null;
  if (element.disabled || element.getAttribute("aria-disabled") === "true") return "uiDisabled";
  if (element.dataset.sound) return element.dataset.sound;
  if (element.matches("[data-tab]")) return null;
  if (element.matches("[data-storage='withdraw'], [data-item-action='take']")) return "itemPickup";
  if (element.matches("[data-storage='deposit'], [data-place], [data-interior]")) return "itemPlace";
  if (element.matches("[data-vote], [data-coop-vote]")) return "vote";
  if (element.matches("[data-daily-action], [data-story], [data-restore]")) return "paper";
  if (element.matches("[data-gift], [data-send], [data-building='post']")) return "messageSend";
  if (element.matches("[data-scene-look]")) return "camera";
  if (element.matches("[data-scene-listen]")) return "uiCard";
  if (element.classList.contains("danger")) return "uiWarning";
  if (element.classList.contains("primary")) return "uiPrimary";
  if (element.matches(".choice-button, .story-card, .market-item, .storage-item")) return "uiCard";
  if (element.matches("#sheetClose, #soundClose")) return null;
  return "uiTap";
}

document.addEventListener("pointerdown", (event) => {
  startHouseAudio();
  const element = event.target.closest("button, a, [role='button'], .choice-button, .market-item, .storage-item");
  const cue = interactionCueFor(element);
  if (cue) void audioEngine.cue(cue);
}, { capture: true });

document.addEventListener("change", (event) => {
  if (event.target.matches("input[type='checkbox']"))
    void audioEngine.cue(event.target.checked ? "uiToggleOn" : "uiToggleOff");
  else if (event.target.matches("select")) void audioEngine.cue("uiCard");
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("input[type='range']")) return;
  const now = performance.now();
  if (now - lastSliderSoundAt < 65) return;
  lastSliderSoundAt = now;
  void audioEngine.cue("uiSlider", { rate: 0.88 + Number(event.target.value || 0) / 420 });
});

document.addEventListener("pointerdown", () => startHouseAudio(), { once: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(state.ambientTimer);
    void audioEngine.context?.suspend?.();
  } else startHouseAudio();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  $("#installButton")?.classList.remove("hidden");
});
$("#installButton").onclick = async () => {
  if (tg?.addToHomeScreen) tg.addToHomeScreen();
  else if (state.installPrompt) {
    await state.installPrompt.prompt();
    state.installPrompt = null;
    $("#installButton")?.classList.add("hidden");
  }
};
tg?.onEvent?.("homeScreenAdded", () => {
  $("#installButton")?.classList.add("hidden");
  toast("Вход в дом добавлен на главный экран", "success");
});
tg?.onEvent?.("fullscreenChanged", () => {
  document.body.classList.toggle(
    "telegram-fullscreen",
    Boolean(tg?.isFullscreen),
  );
});

setInterval(() => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  $("#buildingClock").textContent =
    `${time} · ${navigator.onLine ? "дом не спит" : "связь прервана"}`;
}, 1000);

window.addEventListener("pagehide", () => {
  navigator.sendBeacon?.(`/api/sessions/${state.sessionId}/end`);
  audioEngine.stopAll();
});
window.addEventListener("error", (event) =>
  track("client_error", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
  }),
);
window.addEventListener("unhandledrejection", (event) =>
  track("client_error", { message: String(event.reason) }),
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.warn("service worker", error)),
  );
}

bootstrap();
