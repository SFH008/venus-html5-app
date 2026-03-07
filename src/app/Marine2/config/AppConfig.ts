/**
 * AppConfig.ts
 * Central configuration for Marine2 app.
 *
 * Usage in any view:
 *   import { getConfig } from "../../config/AppConfig"
 *   const cfg = getConfig()
 *   const ws = new WebSocket(`ws://${cfg.signalkHost}:${cfg.signalkPort}/signalk/v1/stream`)
 *
 * Settings are loaded from localStorage at runtime, falling back to defaults.
 * Call saveConfig(partial) to persist changes — no app restart required.
 */

// ─── TYPE — declared first so CONFIG_DEFAULTS can reference it ────────────────
export interface AppConfigShape {
  signalkHost: string
  signalkPort: number
  fontScale: number // 0.8 – 1.4 recommended range
}

// ─── STORAGE KEY ─────────────────────────────────────────────────────────────
const STORAGE_KEY = "marine2_config"

// ─── DEFAULT VALUES ───────────────────────────────────────────────────────────
export const CONFIG_DEFAULTS: AppConfigShape = {
  signalkHost: "192.168.76.171",
  signalkPort: 3000,
  fontScale: 1.0,
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────
function loadConfig(): AppConfigShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...CONFIG_DEFAULTS }
    const saved = JSON.parse(raw) as Partial<AppConfigShape>
    // Merge with defaults so new keys added in future are always present
    return { ...CONFIG_DEFAULTS, ...saved }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

// ─── ACCESSOR ─────────────────────────────────────────────────────────────────
export function getConfig(): AppConfigShape {
  return loadConfig()
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
export function saveConfig(partial: Partial<AppConfigShape>): AppConfigShape {
  const current = loadConfig()
  const next = { ...current, ...partial }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    console.warn("AppConfig: localStorage unavailable, settings not persisted")
  }
  return next
}

// ─── RESET ────────────────────────────────────────────────────────────────────
export function resetConfig(): AppConfigShape {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return { ...CONFIG_DEFAULTS }
}

// ─── FONT SCALE HELPER ────────────────────────────────────────────────────────
// Usage: const fs = makeFs(fontScale); fs(13) → 13 * fontScale
export function makeFs(fontScale: number) {
  return (base: number) => Math.round(base * fontScale)
}
