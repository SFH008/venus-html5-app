/**
 * AppConfig.ts
 * Central configuration for Marine2 app.
 *
 * Usage in any view:
 *   import { getConfig } from "../../config/AppConfig"
 *   const { signalkHost, signalkPort } = getConfig()
 */

// ─── TYPE — declared first ────────────────────────────────────────────────────
export interface AppConfigShape {
  signalkHost: string
  signalkPort: number
  nodeRedPort: number // Node-RED HTTP port (default 1880)
  alarmPath: string // Node-RED webhook path (default /marine-alarm)
  yarrboardHost: string // Yarrboard hostname or IP (default brineomatic.local)
  yarrboardUser: string // Yarrboard API username
  yarrboardPass: string // Yarrboard API password
  fontScale: number // 0.8 – 1.4 recommended range
}

// ─── STORAGE KEY ─────────────────────────────────────────────────────────────
const STORAGE_KEY = "marine2_config"

// ─── DEFAULT VALUES ───────────────────────────────────────────────────────────
export const CONFIG_DEFAULTS: AppConfigShape = {
  signalkHost: "192.168.76.171",
  signalkPort: 3000,
  nodeRedPort: 1880,
  alarmPath: "/marine-alarm",
  yarrboardHost: "brineomatic.local",
  yarrboardUser: "admin",
  yarrboardPass: "admin",
  fontScale: 1.0,
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
/** Build the Node-RED alarm base URL from config */
export function nrAlarmUrl(cfg: AppConfigShape): string {
  return `http://${cfg.signalkHost}:${cfg.nodeRedPort}${cfg.alarmPath}`
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────
function loadConfig(): AppConfigShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...CONFIG_DEFAULTS }
    const saved = JSON.parse(raw) as Partial<AppConfigShape>
    return { ...CONFIG_DEFAULTS, ...saved }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

export function getConfig(): AppConfigShape {
  return loadConfig()
}

export function saveConfig(partial: Partial<AppConfigShape>): AppConfigShape {
  const next = { ...loadConfig(), ...partial }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    console.warn("AppConfig: localStorage unavailable")
  }
  return next
}

export function resetConfig(): AppConfigShape {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return { ...CONFIG_DEFAULTS }
}

export function makeFs(fontScale: number) {
  return (base: number) => Math.round(base * fontScale)
}
