import * as THREE from 'three';

export type WeatherState = 'clear' | 'overcast' | 'rain' | 'storm';

interface WeatherConfig {
  fogDensity:    number;
  ambientIntensity: number;
  ambientColor:  number;
  sunIntensity:  number;
  sunColor:      number;
  rainRate:      number;   // particles per frame, 0 = off
  windX:         number;
  windZ:         number;
}

const WEATHER_CONFIGS: Record<WeatherState, WeatherConfig> = {
  clear: {
    fogDensity: 0.008, ambientIntensity: 1.2, ambientColor: 0x334466,
    sunIntensity: 2.5, sunColor: 0xfff8e8, rainRate: 0, windX: 0, windZ: 0,
  },
  overcast: {
    fogDensity: 0.018, ambientIntensity: 0.9, ambientColor: 0x445566,
    sunIntensity: 0.8, sunColor: 0xaabbcc, rainRate: 0, windX: 0.001, windZ: 0,
  },
  rain: {
    fogDensity: 0.03,  ambientIntensity: 0.6, ambientColor: 0x334455,
    sunIntensity: 0.4, sunColor: 0x8899aa, rainRate: 200, windX: 0.003, windZ: 0.001,
  },
  storm: {
    fogDensity: 0.055, ambientIntensity: 0.3, ambientColor: 0x223344,
    sunIntensity: 0.1, sunColor: 0x667788, rainRate: 600, windX: 0.008, windZ: 0.003,
  },
};

// Time of day light colours (hour 0-23)
const DAY_CYCLE: Array<{ hour: number; ambient: number; sun: number; intensity: number }> = [
  { hour:  0, ambient: 0x111122, sun: 0x222244, intensity: 0.1 },  // midnight
  { hour:  5, ambient: 0x221133, sun: 0x553322, intensity: 0.3 },  // pre-dawn
  { hour:  7, ambient: 0x334466, sun: 0xff8844, intensity: 1.2 },  // dawn
  { hour: 10, ambient: 0x334466, sun: 0xfff0cc, intensity: 2.0 },  // morning
  { hour: 14, ambient: 0x334466, sun: 0xfff8e8, intensity: 2.5 },  // noon
  { hour: 18, ambient: 0x443322, sun: 0xff6633, intensity: 1.8 },  // dusk
  { hour: 20, ambient: 0x221133, sun: 0x552244, intensity: 0.5 },  // evening
  { hour: 23, ambient: 0x111122, sun: 0x222244, intensity: 0.1 },  // night
];

export class WeatherSystem {
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private fog: THREE.FogExp2;

  // Rain particles
  private rain: THREE.Points | null = null;
  private rainGeo: THREE.BufferGeometry | null = null;
  private rainVelocities: Float32Array | null = null;
  private readonly RAIN_COUNT = 8000;

  // State
  private currentWeather: WeatherState = 'clear';
  private targetWeather:  WeatherState = 'clear';
  private transitionT = 1;  // 0→1 transition progress
  private transitionDur = 8; // seconds

  // Time of day (0-24, advances in real time at configurable speed)
  private timeOfDay = 14;   // start at noon
  private readonly REAL_SECONDS_PER_GAME_HOUR = 120; // 2 min real = 1 game hour

  // Lightning (storm only)
  private lightningLight: THREE.PointLight;
  private lightningTimer = 0;

  constructor(
    scene: THREE.Scene,
    sun: THREE.DirectionalLight,
    ambient: THREE.AmbientLight,
    fog: THREE.FogExp2,
  ) {
    this.scene   = scene;
    this.sun     = sun;
    this.ambient = ambient;
    this.fog     = fog;

    // Lightning fill light (storm only)
    this.lightningLight = new THREE.PointLight(0xaaccff, 0, 50);
    this.lightningLight.position.set(0, 20, 0);
    scene.add(this.lightningLight);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  setWeather(state: WeatherState, immediate = false) {
    if (state === this.targetWeather) return;
    this.targetWeather = state;
    this.transitionT = immediate ? 1 : 0;

    if (state === 'rain' || state === 'storm') this.ensureRain();
    else if (immediate) this.destroyRain();
  }

  /** Call in the main render loop */
  update(delta: number) {
    // Advance time of day
    this.timeOfDay = (this.timeOfDay + delta / this.REAL_SECONDS_PER_GAME_HOUR) % 24;

    // Progress weather transition
    if (this.transitionT < 1) {
      this.transitionT = Math.min(this.transitionT + delta / this.transitionDur, 1);
    }

    this.applyDayCycle();
    this.applyWeatherBlend();
    this.updateRain(delta);
    this.updateLightning(delta);
  }

  getTimeOfDay(): number { return this.timeOfDay; }
  getCurrentWeather(): WeatherState { return this.currentWeather; }

  // ── Day cycle ───────────────────────────────────────────────────────────

  private applyDayCycle() {
    const h = this.timeOfDay;

    // Find surrounding keyframes
    let before = DAY_CYCLE[DAY_CYCLE.length - 1];
    let after  = DAY_CYCLE[0];
    for (let i = 0; i < DAY_CYCLE.length - 1; i++) {
      if (h >= DAY_CYCLE[i].hour && h < DAY_CYCLE[i + 1].hour) {
        before = DAY_CYCLE[i];
        after  = DAY_CYCLE[i + 1];
        break;
      }
    }

    const range = after.hour - before.hour;
    const t = range > 0 ? (h - before.hour) / range : 0;
    const ease = t * t * (3 - 2 * t); // smoothstep

    this.sun.color.lerpColors(
      new THREE.Color(before.sun), new THREE.Color(after.sun), ease
    );
    this.sun.intensity = before.intensity + (after.intensity - before.intensity) * ease;

    // Sun position arc
    const sunAngle = ((h - 6) / 12) * Math.PI; // rises at 6, sets at 18
    this.sun.position.set(
      Math.cos(sunAngle) * 30,
      Math.max(Math.sin(sunAngle) * 25, -5),
      10
    );
  }

  // ── Weather blend ───────────────────────────────────────────────────────

  private applyWeatherBlend() {
    const from = WEATHER_CONFIGS[this.currentWeather];
    const to   = WEATHER_CONFIGS[this.targetWeather];
    const t = this.transitionT;

    const lerpN = (a: number, b: number) => a + (b - a) * t;
    const lerpC = (a: number, b: number) => {
      const ca = new THREE.Color(a), cb = new THREE.Color(b);
      return ca.lerp(cb, t);
    };

    this.fog.density = lerpN(from.fogDensity, to.fogDensity);
    this.ambient.intensity = lerpN(from.ambientIntensity, to.ambientIntensity);
    this.ambient.color.copy(lerpC(from.ambientColor, to.ambientColor));
    // Don't override sun colour here — day cycle owns it, just modulate intensity
    this.sun.intensity *= lerpN(1, to.sunIntensity / Math.max(from.sunIntensity, 0.01));

    // Show/hide rain particles based on rate
    if (this.rain) {
      const targetRate = lerpN(from.rainRate, to.rainRate);
      this.rain.visible = targetRate > 10;
    }

    if (t >= 1) this.currentWeather = this.targetWeather;
  }

  // ── Rain particles ──────────────────────────────────────────────────────

  private ensureRain() {
    if (this.rain) return;

    const positions  = new Float32Array(this.RAIN_COUNT * 3);
    const velocities = new Float32Array(this.RAIN_COUNT * 3);

    for (let i = 0; i < this.RAIN_COUNT; i++) {
      positions[i*3]   = (Math.random() - 0.5) * 60;
      positions[i*3+1] = Math.random() * 30;
      positions[i*3+2] = (Math.random() - 0.5) * 60;
      velocities[i*3]   = (Math.random() - 0.5) * 0.01; // wind X
      velocities[i*3+1] = -(0.3 + Math.random() * 0.2); // fall speed
      velocities[i*3+2] = (Math.random() - 0.5) * 0.005;
    }

    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainVelocities = velocities;

    const mat = new THREE.PointsMaterial({
      color: 0x8899bb,
      size: 0.06,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });

    this.rain = new THREE.Points(this.rainGeo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  private updateRain(_delta: number) {
    if (!this.rain || !this.rainGeo || !this.rainVelocities) return;

    const cfg  = WEATHER_CONFIGS[this.targetWeather];
    const pos  = this.rainGeo.attributes.position.array as Float32Array;
    const vel  = this.rainVelocities;
    const wind = { x: cfg.windX, z: cfg.windZ };

    for (let i = 0; i < this.RAIN_COUNT; i++) {
      pos[i*3]   += vel[i*3]   + wind.x;
      pos[i*3+1] += vel[i*3+1];
      pos[i*3+2] += vel[i*3+2] + wind.z;

      // Reset to top when hitting ground
      if (pos[i*3+1] < 0) {
        pos[i*3]   = (Math.random() - 0.5) * 60;
        pos[i*3+1] = 25 + Math.random() * 5;
        pos[i*3+2] = (Math.random() - 0.5) * 60;
      }
    }
    this.rainGeo.attributes.position.needsUpdate = true;
  }

  private destroyRain() {
    if (!this.rain) return;
    this.scene.remove(this.rain);
    this.rainGeo?.dispose();
    this.rain = null;
    this.rainGeo = null;
  }

  // ── Lightning ───────────────────────────────────────────────────────────

  private updateLightning(delta: number) {
    if (this.currentWeather !== 'storm' && this.targetWeather !== 'storm') return;

    this.lightningTimer -= delta;
    if (this.lightningTimer <= 0) {
      // Trigger lightning flash
      this.lightningLight.intensity = 8 + Math.random() * 12;
      this.lightningLight.position.set(
        (Math.random() - 0.5) * 30,
        15,
        (Math.random() - 0.5) * 30
      );

      // Flash sequence: bright → off → brief secondary flash → off
      setTimeout(() => { this.lightningLight.intensity = 0; }, 80);
      setTimeout(() => { this.lightningLight.intensity = 4; }, 140);
      setTimeout(() => { this.lightningLight.intensity = 0; }, 200);

      // Schedule next strike (4-15 seconds)
      this.lightningTimer = 4 + Math.random() * 11;
    }
  }
}
