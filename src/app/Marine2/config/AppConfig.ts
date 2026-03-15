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
  // ── Network ────────────────────────────────────────────────────────────
  signalkHost: string
  signalkPort: number

  // ── Notifications (SignalK PUT path) ───────────────────────────────────
  notifPrefix: string // e.g. "notifications.marine2"

  // ── Node-RED ───────────────────────────────────────────────────────────
  nodeRedPort: number // Node-RED HTTP port (default 1880)
  alarmPath: string // Legacy HTTP webhook — kept for compat

  // ── Alarm audio ────────────────────────────────────────────────────────
  volEmergency: number // 0–100
  volAlarm: number
  volWarn: number
  volNormal: number
  repeatEmergency: number // repeat interval seconds (0 = no repeat)
  repeatAlarm: number

  // ── Yarrboard ──────────────────────────────────────────────────────────
  yarrboardHost: string
  yarrboardUser: string
  yarrboardPass: string

  // ── PowerView — SignalK device paths ──────────────────────────────────
  // signalk-venus-plugin uses numeric instance IDs from Cerbo GX D-Bus.
  // Check your live SignalK Data Browser to find your actual instance IDs.
  pvBatteryPath: string // e.g. "electrical.batteries.0"
  pvSolarPath: string // e.g. "electrical.solar.288"
  pvInverterPath: string // e.g. "electrical.inverters.288"
  pvBmvRelayPath: string // e.g. "electrical.switches.1"
  pvRecBmsWsUrl: string // REC BMS WebSocket URL e.g. "ws://192.168.76.x:8080"
  // ── PowerView — alarm thresholds ──────────────────────────────────────
  pvAlarmSocLow: number // % — fire alarm below this SoC (default 20)
  pvAlarmSocHigh: number // % — fire warn above this SoC (default 98)
  pvAlarmCellDelta: number // mV — fire warn above this cell spread (default 50)
  pvAlarmLoadWatts: number // W  — fire warn above this Quattro AC out (default 3500)
  pvAlarmTempHigh: number // °C — fire alarm above this battery temp (default 45)

  // ── Display ────────────────────────────────────────────────────────────
  fontScale: number // 0.8 – 1.4 recommended range
}

// ─── STORAGE KEY ─────────────────────────────────────────────────────────────
const STORAGE_KEY = "marine2_config"

// ─── DEFAULT VALUES ───────────────────────────────────────────────────────────
export const CONFIG_DEFAULTS: AppConfigShape = {
  // Network
  signalkHost: "192.168.76.171",
  signalkPort: 3000,
  // Notifications
  notifPrefix: "notifications.marine2",
  // Node-RED
  nodeRedPort: 1880,
  alarmPath: "/marine-alarm",
  // Alarm audio
  volEmergency: 100,
  volAlarm: 85,
  volWarn: 70,
  volNormal: 50,
  repeatEmergency: 30,
  repeatAlarm: 120,
  // Yarrboard
  yarrboardHost: "192.168.76.171:1880", // Brineomatic Yarrboard — update if IP changes
  yarrboardUser: "admin",
  yarrboardPass: "admin",
  // PowerView paths — update these from SignalK Data Browser
  pvBatteryPath: "electrical.batteries.0",
  pvSolarPath: "electrical.solar.288",
  pvInverterPath: "electrical.inverters.288",
  pvBmvRelayPath: "electrical.switches.1",
  pvRecBmsWsUrl: "ws://192.168.76.x:8080",
  // PowerView alarm thresholds
  pvAlarmSocLow: 20,
  pvAlarmSocHigh: 98,
  pvAlarmCellDelta: 50,
  pvAlarmLoadWatts: 3500,
  pvAlarmTempHigh: 45,
  // Display
  fontScale: 1.0,
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
/** Build the SignalK REST base URL */
export function skApiUrl(cfg: AppConfigShape): string {
  return `http://${cfg.signalkHost}:${cfg.signalkPort}/signalk/v1/api/vessels/self`
}

/** Build the Node-RED alarm base URL (legacy, kept for compat) */
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
