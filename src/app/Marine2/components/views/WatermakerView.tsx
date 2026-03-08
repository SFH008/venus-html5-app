/**
 * WatermakerView.tsx
 * Brineomatic watermaker control panel for Venus OS dashboard
 *
 * Data source: SignalK WebSocket (signalk-brineomatic-plugin)
 *   Subscribes to: vessels.self.watermaker.{BRINEOMATIC_HOSTNAME}.*
 *   All SI values from SignalK are converted back to display units here.
 *
 * Commands: still sent direct to Yarrboard HTTP API
 *   POST http://{YARRBOARD_HOST}/api/endpoint
 *
 * Integration:
 *   1. Add WATERMAKER_VIEW = "watermaker-view" to AppViews enum
 *   2. Add title key to AppViewTitleKeys: "watermakerView": "Watermaker"
 *   3. Import and add case to renderView() in Marine2.tsx, wrapped in <MainLayout>
 *   4. Add nav item to Footer.tsx: { view: AppViews.WATERMAKER_VIEW, icon: "🌊", label: "Water" }
 *   5. Set BRINEOMATIC_HOSTNAME to match what the plugin reports (config.hostname)
 *   6. Set YARRBOARD_HOST to the board's hostname/IP for sending commands
 */

import React, { useState, useEffect, useCallback, useRef } from "react"

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// SignalK server — same host/port as the Venus OS app is served from.
// The plugin publishes under: vessels.self.watermaker.{hostname}.*
// Set BRINEOMATIC_HOSTNAME to match what the plugin reports (config.hostname).
import { getConfig } from "../../config/AppConfig"
const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()

const BRINEOMATIC_HOSTNAME = "brineomatic" // matches config.hostname in the plugin
const SK_BASE = `vessels.self.watermaker.${BRINEOMATIC_HOSTNAME}`

// Yarrboard credentials loaded from AppConfig / SettingsView — not hardcoded
const { yarrboardHost: YARRBOARD_HOST, yarrboardUser: YARRBOARD_USER, yarrboardPass: YARRBOARD_PASS } = getConfig()

// ─── TYPES ───────────────────────────────────────────────────────────────────
type BOMStatus =
  | "STARTUP"
  | "IDLE"
  | "RUNNING"
  | "STOPPING"
  | "FLUSHING"
  | "PICKLING"
  | "DEPICKLING"
  | "PICKLED"
  | "MANUAL"
  | "UNKNOWN"

// Internal state — all values in display units (°C, PSI, LPH, L, PPM, %, ms)
interface BOMState {
  status: BOMStatus
  run_result: string
  flush_result: string
  pickle_result: string
  depickle_result: string
  motor_temperature: number // °C
  water_temperature: number // °C
  product_flowrate: number // LPH
  brine_flowrate: number // LPH
  total_flowrate: number // LPH
  volume: number // litres
  flush_volume: number // litres (not in SK plugin — kept for compat)
  product_salinity: number // PPM (mg/L)
  brine_salinity: number // PPM (mg/L)
  filter_pressure: number // PSI
  membrane_pressure: number // PSI
  tank_level: number // 0–100 (ratio × 100)
  boost_pump_on?: boolean
  high_pressure_pump_on?: boolean
  diverter_valve_open?: boolean
  flush_valve_open?: boolean
  cooling_fan_on?: boolean
  next_flush_countdown: number // ms
  runtime_elapsed: number // ms
  finish_countdown: number // ms
  flush_elapsed?: number // ms
  flush_countdown?: number // ms
  pickle_elapsed?: number // ms
  pickle_countdown?: number // ms
  depickle_elapsed?: number // ms
  depickle_countdown?: number // ms
}

type ModalType = "start" | "flush" | "pickle" | "depickle" | "stop" | "manual" | null

// ─── UNIT CONVERSIONS (SignalK → display) ────────────────────────────────────
// The signalk-brineomatic-plugin stores values in SI units.
// We convert back to human-readable display units here.
const K_TO_C = (k: number) => k - 273.15 // Kelvin  → °C
const PA_TO_PSI = (pa: number) => pa / 6894.76 // Pascal  → PSI
const M3S_TO_LPH = (m3s: number) => m3s * 3_600_000 // m³/s    → LPH
const M3_TO_L = (m3: number) => m3 * 1000 // m³      → litres
const S_TO_MS = (s: number) => s * 1000 // seconds → ms (for formatDuration)
// tank_level is stored as ratio (0–1), display as percent
const RATIO_TO_PCT = (r: number) => r * 100

// ─── SIGNALK PATHS → BOMState FIELD MAP ─────────────────────────────────────
// Each entry: [skSuffix, stateKey, conversionFn]
type Converter = (v: number) => number
const PATH_MAP: Array<[string, keyof BOMState, Converter | null]> = [
  ["status", "status", null],
  ["run_result", "run_result", null],
  ["flush_result", "flush_result", null],
  ["pickle_result", "pickle_result", null],
  ["depickle_result", "depickle_result", null],
  ["motor_temperature", "motor_temperature", K_TO_C],
  ["water_temperature", "water_temperature", K_TO_C],
  ["product_flowrate", "product_flowrate", M3S_TO_LPH],
  ["brine_flowrate", "brine_flowrate", M3S_TO_LPH],
  ["total_flowrate", "total_flowrate", M3S_TO_LPH],
  ["volume", "volume", M3_TO_L],
  ["product_salinity", "product_salinity", null],
  ["brine_salinity", "brine_salinity", null],
  ["filter_pressure", "filter_pressure", PA_TO_PSI],
  ["membrane_pressure", "membrane_pressure", PA_TO_PSI],
  ["tank_level", "tank_level", RATIO_TO_PCT],
  ["boost_pump_on", "boost_pump_on", null],
  ["high_pressure_pump_on", "high_pressure_pump_on", null],
  ["diverter_valve_open", "diverter_valve_open", null],
  ["flush_valve_open", "flush_valve_open", null],
  ["cooling_fan_on", "cooling_fan_on", null],
  ["next_flush_countdown", "next_flush_countdown", S_TO_MS],
  ["runtime_elapsed", "runtime_elapsed", S_TO_MS],
  ["finish_countdown", "finish_countdown", S_TO_MS],
  ["flush_elapsed", "flush_elapsed", S_TO_MS],
  ["flush_countdown", "flush_countdown", S_TO_MS],
  ["pickle_elapsed", "pickle_elapsed", S_TO_MS],
  ["pickle_countdown", "pickle_countdown", S_TO_MS],
  ["depickle_elapsed", "depickle_elapsed", S_TO_MS],
  ["depickle_countdown", "depickle_countdown", S_TO_MS],
]

// Build the full SK subscribe paths list
const SK_PATHS = PATH_MAP.map(([suffix]) => `${SK_BASE}.${suffix}`)

// ─── SIGNALK WEBSOCKET HOOK ───────────────────────────────────────────────────
function useSignalKBrineomatic() {
  const [state, setState] = useState<BOMState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }

    const url = `ws://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/stream?subscribe=none`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Subscribe to all brineomatic paths
      ws.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: SK_PATHS.map((path) => ({
            path: path.replace("vessels.self.", ""),
            period: 1000,
            policy: "instant",
          })),
        }),
      )
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (!msg.updates) return
        setState((prev) => {
          const next: BOMState = prev
            ? { ...prev }
            : {
                status: "UNKNOWN",
                run_result: "",
                flush_result: "",
                pickle_result: "",
                depickle_result: "",
                motor_temperature: 0,
                water_temperature: 0,
                product_flowrate: 0,
                brine_flowrate: 0,
                total_flowrate: 0,
                volume: 0,
                flush_volume: 0,
                product_salinity: 0,
                brine_salinity: 0,
                filter_pressure: 0,
                membrane_pressure: 0,
                tank_level: 0,
                next_flush_countdown: 0,
                runtime_elapsed: 0,
                finish_countdown: 0,
              }

          for (const update of msg.updates) {
            for (const val of update.values || []) {
              const fullPath = `vessels.self.${val.path}`
              const entry = PATH_MAP.find(([suffix]) => `${SK_BASE}.${suffix}` === fullPath)
              if (!entry) continue
              const [, key, conv] = entry
              const raw = val.value
              ;(next as any)[key] = conv && typeof raw === "number" ? conv(raw) : raw
            }
          }
          return next
        })
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => setConnected(false)

    ws.onclose = () => {
      setConnected(false)
      reconnectRef.current = setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  return { state, connected }
}

// ─── COMMAND API (still direct to Yarrboard — plugin has no PUT handler yet) ─
async function apiCmd(cmd: string, extra?: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`http://${YARRBOARD_HOST}/api/endpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, user: YARRBOARD_USER, pass: YARRBOARD_PASS, ...extra }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0:00"
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`
  return `${m}:${s.toString().padStart(2, "0")}`
}

function fmt1(n: number): string {
  if (n == null) return "—"
  return n.toFixed(1)
}

function fmt0(n: number): string {
  if (n == null) return "—"
  return n.toFixed(0)
}

// ─── STATUS COLOURS ──────────────────────────────────────────────────────────
const STATUS_STYLE: Record<BOMStatus, { bg: string; text: string; glow: string }> = {
  STARTUP: { bg: "#1a2a1a", text: "#4ade80", glow: "0 0 12px #4ade8066" },
  IDLE: { bg: "#1a1a2e", text: "#60a5fa", glow: "0 0 12px #60a5fa66" },
  RUNNING: { bg: "#1a2e1a", text: "#4ade80", glow: "0 0 16px #4ade8088" },
  STOPPING: { bg: "#2e1a1a", text: "#f97316", glow: "0 0 12px #f9731666" },
  FLUSHING: { bg: "#1a2240", text: "#38bdf8", glow: "0 0 14px #38bdf888" },
  PICKLING: { bg: "#2a1f10", text: "#fbbf24", glow: "0 0 12px #fbbf2466" },
  DEPICKLING: { bg: "#2a1f10", text: "#fbbf24", glow: "0 0 12px #fbbf2466" },
  PICKLED: { bg: "#261020", text: "#a78bfa", glow: "0 0 12px #a78bfa66" },
  MANUAL: { bg: "#1e1e1e", text: "#9ca3af", glow: "0 0 8px #9ca3af44" },
  UNKNOWN: { bg: "#1a1a1a", text: "#6b7280", glow: "none" },
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600&display=swap');

  .wm-root {
    width: 100%;
    height: 100%;
    background: #080e18;
    color: #c8d8e8;
    font-family: 'Rajdhani', sans-serif;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* scan lines */
  .wm-root::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg, transparent, transparent 2px,
      rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px
    );
    pointer-events: none;
    z-index: 1;
  }

  /* vignette */
  .wm-root::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.6) 100%);
    pointer-events: none;
    z-index: 1;
  }

  .wm-content {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 6px 8px 4px;
    gap: 6px;
    overflow: hidden;
  }

  /* ── Header row ── */
  .wm-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .wm-title {
    font-family: 'Cinzel', serif;
    font-size: 20px;
    letter-spacing: 0.12em;
    color: #7eb8d4;
    text-transform: uppercase;
    flex: 1;
  }

  .wm-status-badge {
    font-family: 'Share Tech Mono', monospace;
    font-size: 18px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 3px;
    letter-spacing: 0.08em;
    border: 1px solid currentColor;
    transition: all 0.3s ease;
  }

  .wm-conn {
    font-family: 'Share Tech Mono', monospace;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 2px;
  }
  .wm-conn.ok   { color: #4ade80; background: #0a1e0a; border: 1px solid #4ade8033; }
  .wm-conn.err  { color: #f87171; background: #1e0a0a; border: 1px solid #f8717133; }

  /* ── Gauges grid ── */
  .wm-gauges {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    flex-shrink: 0;
  }

  .wm-gauge {
    background: linear-gradient(135deg, #0d1824 0%, #0a1420 100%);
    border: 1px solid #1a3a5a;
    border-radius: 8px;
    padding: 8px 8px 35px;
    text-align: center;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 0;
  }

  .wm-gauge::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, #2a6a9a55, transparent);
  }

  .wm-gauge-label {
    font-family: 'Rajdhani', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #4a7a9a;
    text-transform: uppercase;
    margin-bottom: 1px;
  }

  .wm-arc-wrap {
    position: relative;
    width: 160px;
    height: 88px;
    overflow: visible;
  }

  .wm-arc-wrap svg {
    overflow: visible;
  }

  .wm-arc-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-top: 16px;
  }

  .wm-arc-value {
    font-family: 'Share Tech Mono', monospace;
    font-size: 28px;
    font-weight: 400;
    line-height: 1;
    color: #e2f4ff;
    transition: color 0.3s;
  }

  .wm-arc-value.warn  { color: #fbbf24; }
  .wm-arc-value.alert { color: #f87171; }

  .wm-arc-unit {
    font-family: 'Rajdhani', sans-serif;
    font-size: 13px;
    color: #3a6a8a;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }

  /* ── Middle row: info + controls ── */
  .wm-middle {
    display: flex;
    gap: 6px;
    flex: 1;
    min-height: 0;
  }

  /* Info panel */
  .wm-info {
    flex: 1;
    background: linear-gradient(135deg, #0d1824 0%, #0a1420 100%);
    border: 1px solid #1a3a5a;
    border-radius: 4px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .wm-info-title {
    font-family: 'Cinzel', serif;
    font-size: 13px;
    letter-spacing: 0.12em;
    color: #3a6a8a;
    text-transform: uppercase;
    border-bottom: 1px solid #1a3a5a;
    padding-bottom: 3px;
    margin-bottom: 2px;
  }

  .wm-info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 16px;
  }

  .wm-info-key {
    color: #4a7a9a;
    font-weight: 500;
  }

  .wm-info-val {
    font-family: 'Share Tech Mono', monospace;
    font-size: 16px;
    color: #c8d8e8;
  }

  .wm-progress-wrap {
    margin-top: 2px;
  }

  .wm-progress-label {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: #4a7a9a;
    margin-bottom: 2px;
  }

  .wm-progress-bar {
    height: 8px;
    background: #0a1a2a;
    border-radius: 2px;
    overflow: hidden;
    border: 1px solid #1a3a5a;
  }

  .wm-progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .wm-progress-fill.run    { background: linear-gradient(90deg, #1d6a3a, #4ade80); }
  .wm-progress-fill.flush  { background: linear-gradient(90deg, #1a4a70, #38bdf8); }
  .wm-progress-fill.pickle { background: linear-gradient(90deg, #5a3a10, #fbbf24); }

  /* Component status */
  .wm-components {
    width: 200px;
    flex-shrink: 0;
    background: linear-gradient(135deg, #0d1824 0%, #0a1420 100%);
    border: 1px solid #1a3a5a;
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .wm-comp-title {
    font-family: 'Cinzel', serif;
    font-size: 13px;
    letter-spacing: 0.12em;
    color: #3a6a8a;
    text-transform: uppercase;
    border-bottom: 1px solid #1a3a5a;
    padding-bottom: 3px;
    margin-bottom: 2px;
  }

  .wm-comp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 15px;
    gap: 6px;
  }

  .wm-comp-name {
    color: #4a7a9a;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wm-comp-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: all 0.3s;
  }
  .wm-comp-dot.on  { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
  .wm-comp-dot.off { background: #1a3a2a; border: 1px solid #2a4a3a; }
  .wm-comp-dot.na  { background: #2a3a4a; border: 1px solid #1a2a3a; }

  /* ── Control buttons ── */
  .wm-controls {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
    flex-shrink: 0;
  }

  .wm-btn {
    padding: 6px 4px;
    border-radius: 4px;
    border: 1px solid;
    cursor: pointer;
    font-family: 'Rajdhani', sans-serif;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    transition: all 0.15s ease;
    background: transparent;
    min-height: 56px;
    justify-content: center;
  }

  .wm-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    filter: brightness(1.15);
  }

  .wm-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .wm-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .wm-btn svg { flex-shrink: 0; }

  .wm-btn.start  { color: #4ade80; border-color: #4ade8055; background: #0a1e0a; }
  .wm-btn.start:hover:not(:disabled)  { background: #0d2a0d; border-color: #4ade80aa; box-shadow: 0 0 12px #4ade8033; }

  .wm-btn.flush  { color: #38bdf8; border-color: #38bdf855; background: #0a1820; }
  .wm-btn.flush:hover:not(:disabled)  { background: #0d2030; border-color: #38bdf8aa; box-shadow: 0 0 12px #38bdf833; }

  .wm-btn.pickle { color: #fbbf24; border-color: #fbbf2455; background: #1e1508; }
  .wm-btn.pickle:hover:not(:disabled) { background: #261c08; border-color: #fbbf24aa; box-shadow: 0 0 12px #fbbf2433; }

  .wm-btn.depickle { color: #a78bfa; border-color: #a78bfa55; background: #130e1e; }
  .wm-btn.depickle:hover:not(:disabled) { background: #180e26; border-color: #a78bfaaa; box-shadow: 0 0 12px #a78bfa33; }

  .wm-btn.stop   { color: #f87171; border-color: #f8717155; background: #1e0a0a; }
  .wm-btn.stop:hover:not(:disabled)   { background: #2a0d0d; border-color: #f87171aa; box-shadow: 0 0 12px #f8717133; }

  .wm-btn.manual { color: #9ca3af; border-color: #9ca3af55; background: #111820; }
  .wm-btn.manual:hover:not(:disabled) { background: #161e28; border-color: #9ca3afaa; }

  .wm-btn.idle   { color: #60a5fa; border-color: #60a5fa55; background: #0a1020; }
  .wm-btn.idle:hover:not(:disabled)   { background: #0d162a; border-color: #60a5faaa; }

  /* ── Modal overlay ── */
  .wm-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.75);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(3px);
  }

  .wm-modal {
    background: #0d1824;
    border: 1px solid #2a5a8a;
    border-radius: 6px;
    padding: 16px;
    width: 340px;
    max-width: 90%;
    box-shadow: 0 0 40px rgba(0,0,0,0.8), 0 0 20px rgba(42,90,138,0.3);
    position: relative;
  }

  .wm-modal-title {
    font-family: 'Cinzel', serif;
    font-size: 18px;
    letter-spacing: 0.1em;
    color: #7eb8d4;
    text-transform: uppercase;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1a3a5a;
  }

  .wm-modal-body {
    font-size: 15px;
    color: #8aacbe;
    line-height: 1.5;
    margin-bottom: 12px;
  }

  .wm-modal-warn {
    background: #2a1e08;
    border: 1px solid #5a3a1055;
    border-radius: 3px;
    padding: 6px 8px;
    color: #fbbf24;
    font-size: 14px;
    margin-bottom: 10px;
  }

  /* start mode cards */
  .wm-start-modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .wm-mode-card {
    background: #0a1420;
    border: 1px solid #1a3a5a;
    border-radius: 4px;
    padding: 8px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .wm-mode-card h4 {
    font-family: 'Cinzel', serif;
    font-size: 13px;
    letter-spacing: 0.1em;
    color: #7eb8d4;
    text-transform: uppercase;
    margin: 0;
  }

  .wm-mode-card p {
    font-size: 13px;
    color: #4a7a9a;
    margin: 0;
    line-height: 1.4;
    min-height: 28px;
  }

  .wm-input-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .wm-input {
    flex: 1;
    background: #060e18;
    border: 1px solid #1a3a5a;
    border-radius: 3px;
    color: #e2f4ff;
    font-family: 'Share Tech Mono', monospace;
    font-size: 15px;
    padding: 5px 7px;
    width: 100%;
  }

  .wm-input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .wm-input-unit {
    font-size: 14px;
    color: #3a6a8a;
    white-space: nowrap;
  }

  /* modal footer */
  .wm-modal-footer {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .wm-modal-btn {
    padding: 5px 14px;
    border-radius: 3px;
    border: 1px solid;
    cursor: pointer;
    font-family: 'Rajdhani', sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transition: all 0.15s;
    background: transparent;
  }

  .wm-modal-btn.cancel {
    color: #4a7a9a;
    border-color: #1a3a5a;
  }
  .wm-modal-btn.cancel:hover { background: #0a1a2a; }

  .wm-modal-btn.confirm-green  { color: #4ade80; border-color: #4ade8055; }
  .wm-modal-btn.confirm-green:hover { background: #0a1e0a; }

  .wm-modal-btn.confirm-blue   { color: #38bdf8; border-color: #38bdf855; }
  .wm-modal-btn.confirm-blue:hover  { background: #0a1820; }

  .wm-modal-btn.confirm-yellow { color: #fbbf24; border-color: #fbbf2455; }
  .wm-modal-btn.confirm-yellow:hover { background: #1e1508; }

  .wm-modal-btn.confirm-purple { color: #a78bfa; border-color: #a78bfa55; }
  .wm-modal-btn.confirm-purple:hover { background: #130e1e; }

  .wm-modal-btn.confirm-red    { color: #f87171; border-color: #f8717155; }
  .wm-modal-btn.confirm-red:hover { background: #1e0a0a; }

  /* result tag */
  .wm-result {
    font-family: 'Share Tech Mono', monospace;
    font-size: 13px;
    padding: 1px 5px;
    border-radius: 2px;
    border: 1px solid currentColor;
  }
  .wm-result.success { color: #4ade80; background: #0a1e0a; }
  .wm-result.error   { color: #f87171; background: #1e0a0a; }
  .wm-result.neutral { color: #60a5fa; background: #0a1020; }

  /* pulse animation for running */
  @keyframes pulseGlow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .wm-pulse { animation: pulseGlow 1.5s ease-in-out infinite; }

  /* stats row */
  .wm-stats {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .wm-stat {
    flex: 1;
    background: #0a1218;
    border: 1px solid #152030;
    border-radius: 3px;
    padding: 3px 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .wm-stat-key {
    font-size: 13px;
    color: #2a5a7a;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .wm-stat-val {
    font-family: 'Share Tech Mono', monospace;
    font-size: 16px;
    color: #7ab8d4;
  }
`

// ─── ICONS ───────────────────────────────────────────────────────────────────
const IconPlay = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445" />
  </svg>
)
const IconDrop = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M7.21.8C7.69.295 8 0 8 0q.164.544.371 1.038c.812 1.946 2.073 3.35 3.197 4.6C12.878 7.096 14 8.345 14 10a6 6 0 0 1-12 0C2 6.668 5.58 2.517 7.21.8"
    />
  </svg>
)
const IconShield = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M5.338 1.59a61 61 0 0 0-2.837.856.48.48 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.7 10.7 0 0 0 2.287 2.233c.346.244.652.42.893.533q.18.085.293.118a1 1 0 0 0 .201 0q.114-.034.294-.118c.24-.113.547-.29.893-.533a10.7 10.7 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524z" />
  </svg>
)
const IconStop = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h3A1.5 1.5 0 0 1 11 6.5v3A1.5 1.5 0 0 1 9.5 11h-3A1.5 1.5 0 0 1 5 9.5z" />
  </svg>
)
const IconWrench = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M1 0 0 1l2.2 3.081a1 1 0 0 0 .815.419h.07a1 1 0 0 1 .708.293l2.675 2.675-2.617 2.654A3.003 3.003 0 0 0 0 13a3 3 0 1 0 5.878-.851l2.654-2.617.968.968-.305.914a1 1 0 0 0 .242 1.023l3.27 3.27a.997.997 0 0 0 1.414 0l1.586-1.586a.997.997 0 0 0 0-1.414l-3.27-3.27a1 1 0 0 0-1.023-.242L10.5 9.5l-.96-.96 2.68-2.643A3.005 3.005 0 0 0 16 3q0-.405-.102-.777l-2.14 2.141L12 4l-.364-1.757L13.777.102a3 3 0 0 0-3.675 3.68L7.462 6.46 4.793 3.793a1 1 0 0 1-.293-.707v-.071a1 1 0 0 0-.419-.814z" />
  </svg>
)
const IconBack = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z" />
    <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" />
  </svg>
)
const IconUnshield = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M1.093 3.093c-.465 4.275.885 7.46 2.513 9.589a11.8 11.8 0 0 0 2.517 2.453c.386.273.744.482 1.048.625.28.132.581.24.829.24s.548-.108.829-.24a7 7 0 0 0 1.048-.625 11.3 11.3 0 0 0 1.733-1.525l-.745-.745a10.3 10.3 0 0 1-1.578 1.392c-.346.244-.652.42-.893.533q-.18.085-.293.118a1 1 0 0 1-.101.025 1 1 0 0 1-.1-.025 2 2 0 0 1-.294-.118 6 6 0 0 1-.893-.533 10.7 10.7 0 0 1-2.287-2.233C3.053 10.228 1.879 7.594 2.06 4.06zM3.98 1.98l-.852-.852A59 59 0 0 1 5.072.559C6.157.266 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.483 3.626-.332 6.491-1.551 8.616l-.77-.77c1.042-1.915 1.72-4.469 1.29-7.702a.48.48 0 0 0-.33-.39c-.65-.213-1.75-.56-2.836-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524a50 50 0 0 0-1.357.39zm9.666 12.374-13-13 .708-.708 13 13z"
    />
  </svg>
)

// ─── ARC GAUGE ────────────────────────────────────────────────────────────────
interface ArcGaugeProps {
  value: number // current value (use -999 for sensor error)
  min: number
  max: number
  unit: string
  label: string
  color?: string // normal arc colour
  warnColor?: string // colour when value >= warnAt
  alertColor?: string // colour when value >= alertAt OR value === -999
  warnAt?: number
  alertAt?: number
  fmt?: (n: number) => string
  inverse?: boolean // warn when value is LOW (e.g. filter pressure)
}

function ArcGauge({
  value,
  min,
  max,
  unit,
  label,
  color = "#38bdf8",
  warnColor = "#fbbf24",
  alertColor = "#f87171",
  warnAt,
  alertAt,
  fmt = (n) => n.toFixed(1),
  inverse = false,
}: ArcGaugeProps) {
  const isError = value === -999 || value == null

  // Arc geometry — 240° sweep, open at bottom
  // cy is set so the arc top sits ~6px from the SVG top edge
  // top of arc = cy - r, so cy = r + 6 = 74
  // bottom of arc at the open ends ≈ cy + r*sin(30°) = 74 + 34 = 108 → H = 88 clips cleanly
  const W = 160,
    H = 88
  const cx = W / 2,
    cy = 74
  const r = 68
  const startAngle = -210 // degrees from 3-o-clock
  const sweepAngle = 240

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const polarX = (angle: number) => cx + r * Math.cos(toRad(angle))
  const polarY = (angle: number) => cy + r * Math.sin(toRad(angle))

  // SVG arc path helper
  const arcPath = (fromDeg: number, toDeg: number) => {
    const x1 = polarX(fromDeg),
      y1 = polarY(fromDeg)
    const x2 = polarX(toDeg),
      y2 = polarY(toDeg)
    const sweep = toDeg - fromDeg
    const large = Math.abs(sweep) > 180 ? 1 : 0
    const dir = sweep > 0 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${dir} ${x2} ${y2}`
  }

  // Track arc (full sweep)
  const trackPath = arcPath(startAngle, startAngle + sweepAngle)

  // Fill arc
  const clampedVal = Math.min(Math.max(isError ? min : value, min), max)
  const fillFraction = (clampedVal - min) / (max - min)
  const fillDeg = sweepAngle * fillFraction
  const fillPath = fillDeg > 1 ? arcPath(startAngle, startAngle + fillDeg) : ""

  // Colour logic
  let arcColor = color
  if (!isError) {
    if (inverse) {
      if (alertAt !== undefined && value <= alertAt) arcColor = alertColor
      else if (warnAt !== undefined && value <= warnAt) arcColor = warnColor
    } else {
      if (alertAt !== undefined && value >= alertAt) arcColor = alertColor
      else if (warnAt !== undefined && value >= warnAt) arcColor = warnColor
    }
  } else {
    arcColor = alertColor
  }

  const valClass = isError
    ? "alert"
    : alertAt !== undefined && !inverse && value >= alertAt
      ? "alert"
      : alertAt !== undefined && inverse && value <= alertAt
        ? "alert"
        : warnAt !== undefined && !inverse && value >= warnAt
          ? "warn"
          : warnAt !== undefined && inverse && value <= warnAt
            ? "warn"
            : ""

  const displayVal = isError ? "ERR" : fmt(value)

  return (
    <div className="wm-gauge">
      <div className="wm-gauge-label">{label}</div>
      <div className="wm-arc-wrap" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* Track */}
          <path d={trackPath} fill="none" stroke="#0e2a40" strokeWidth={10} strokeLinecap="round" />
          {/* Fill */}
          {fillPath && (
            <path
              d={fillPath}
              fill="none"
              stroke={arcColor}
              strokeWidth={10}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 5px ${arcColor}88)`, transition: "all 0.5s ease" }}
            />
          )}
          {/* Needle dot at tip */}
          {fillPath && (
            <circle
              cx={polarX(startAngle + fillDeg)}
              cy={polarY(startAngle + fillDeg)}
              r={6}
              fill={arcColor}
              style={{ filter: `drop-shadow(0 0 7px ${arcColor})`, transition: "all 0.5s ease" }}
            />
          )}
          {/* Min/max tick marks */}
          {[0, sweepAngle].map((offset, i) => {
            const angle = startAngle + offset
            return (
              <line
                key={i}
                x1={cx + r * 0.72 * Math.cos(toRad(angle))}
                y1={cy + r * 0.72 * Math.sin(toRad(angle))}
                x2={cx + r * 0.88 * Math.cos(toRad(angle))}
                y2={cy + r * 0.88 * Math.sin(toRad(angle))}
                stroke="#1a4a6a"
                strokeWidth={3}
                strokeLinecap="round"
              />
            )
          })}
        </svg>
        {/* Value overlay */}
        <div className="wm-arc-center">
          <span className={`wm-arc-value ${valClass}`}>{displayVal}</span>
          <span className="wm-arc-unit">{unit}</span>
        </div>
      </div>
    </div>
  )
}

// ─── RESULT BADGE ─────────────────────────────────────────────────────────────
function ResultBadge({ result }: { result: string }) {
  if (!result || result === "STARTUP" || result === "UNKNOWN") return null
  const isSuccess = result.startsWith("SUCCESS")
  const isUser = result === "USER_STOP"
  const cls = isSuccess ? "success" : isUser ? "neutral" : "error"
  return <span className={`wm-result ${cls}`}>{result.replace(/_/g, " ")}</span>
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
function ProgressBar({ elapsed, total, label, type }: { elapsed: number; total: number; label: string; type: string }) {
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0
  return (
    <div className="wm-progress-wrap">
      <div className="wm-progress-label">
        <span>{label}</span>
        <span>
          {formatDuration(elapsed)} / {formatDuration(total)}
        </span>
      </div>
      <div className="wm-progress-bar">
        <div className={`wm-progress-fill ${type}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({
  type,
  onClose,
  onCmd,
}: {
  type: ModalType
  onClose: () => void
  onCmd: (cmd: string, extra?: Record<string, unknown>) => void
}) {
  const [runDuration, setRunDuration] = useState("3.5")
  const [runVolume, setRunVolume] = useState("250")
  const [flushDuration, setFlushDuration] = useState("5")
  const [pickleDuration, setPickleDuration] = useState("5")
  const [depickleDuration, setDepickleDuration] = useState("15")

  if (!type) return null

  const hoursToMs = (h: string) => Math.round(parseFloat(h) * 3600 * 1000)
  const minsToMs = (m: string) => Math.round(parseFloat(m) * 60 * 1000)

  return (
    <div className="wm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wm-modal">
        {type === "start" && (
          <>
            <div className="wm-modal-title">⚡ Start Watermaker — Choose Mode</div>
            <div className="wm-start-modes">
              <div className="wm-mode-card">
                <h4>Manual</h4>
                <p>Run until stopped by user or external script</p>
                <button
                  className="wm-modal-btn confirm-green"
                  onClick={() => {
                    onCmd("start_brineomatic")
                    onClose()
                  }}
                >
                  START
                </button>
              </div>
              <div className="wm-mode-card">
                <h4>Duration</h4>
                <p>Run for the time below</p>
                <div className="wm-input-row">
                  <input className="wm-input" value={runDuration} onChange={(e) => setRunDuration(e.target.value)} />
                  <span className="wm-input-unit">hrs</span>
                </div>
                <button
                  className="wm-modal-btn confirm-green"
                  onClick={() => {
                    onCmd("start_brineomatic_duration", { duration: hoursToMs(runDuration) })
                    onClose()
                  }}
                >
                  START
                </button>
              </div>
              <div className="wm-mode-card">
                <h4>Volume</h4>
                <p>Produce the amount below</p>
                <div className="wm-input-row">
                  <input className="wm-input" value={runVolume} onChange={(e) => setRunVolume(e.target.value)} />
                  <span className="wm-input-unit">L</span>
                </div>
                <button
                  className="wm-modal-btn confirm-green"
                  onClick={() => {
                    onCmd("start_brineomatic_volume", { volume: parseFloat(runVolume) })
                    onClose()
                  }}
                >
                  START
                </button>
              </div>
            </div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {type === "flush" && (
          <>
            <div className="wm-modal-title">💧 Flush Watermaker</div>
            <div className="wm-modal-body">Flush the watermaker membranes with fresh water.</div>
            <div className="wm-input-row" style={{ marginBottom: 12 }}>
              <input
                className="wm-input"
                value={flushDuration}
                onChange={(e) => setFlushDuration(e.target.value)}
                style={{ width: 70 }}
              />
              <span className="wm-input-unit">minutes</span>
            </div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="wm-modal-btn confirm-blue"
                onClick={() => {
                  onCmd("flush_brineomatic", { duration: minsToMs(flushDuration) })
                  onClose()
                }}
              >
                Flush
              </button>
            </div>
          </>
        )}

        {type === "pickle" && (
          <>
            <div className="wm-modal-title">🛡 Pickle Watermaker</div>
            <div className="wm-modal-warn">
              ⚠️ Ensure plumbing is configured for pickling — input and output should lead to a bucket with pickling
              solution.
            </div>
            <div className="wm-input-row" style={{ marginBottom: 12 }}>
              <input
                className="wm-input"
                value={pickleDuration}
                onChange={(e) => setPickleDuration(e.target.value)}
                style={{ width: 70 }}
              />
              <span className="wm-input-unit">minutes</span>
            </div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="wm-modal-btn confirm-yellow"
                onClick={() => {
                  onCmd("pickle_brineomatic", { duration: minsToMs(pickleDuration) })
                  onClose()
                }}
              >
                Pickle
              </button>
            </div>
          </>
        )}

        {type === "depickle" && (
          <>
            <div className="wm-modal-title">🔓 De-pickle Watermaker</div>
            <div className="wm-modal-warn">
              ⚠️ De-pickling flushes the membrane with salt water to remove pickling solution.
            </div>
            <div className="wm-input-row" style={{ marginBottom: 12 }}>
              <input
                className="wm-input"
                value={depickleDuration}
                onChange={(e) => setDepickleDuration(e.target.value)}
                style={{ width: 70 }}
              />
              <span className="wm-input-unit">minutes</span>
            </div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="wm-modal-btn confirm-purple"
                onClick={() => {
                  onCmd("depickle_brineomatic", { duration: minsToMs(depickleDuration) })
                  onClose()
                }}
              >
                De-Pickle
              </button>
            </div>
          </>
        )}

        {type === "stop" && (
          <>
            <div className="wm-modal-title">🛑 Stop Watermaker</div>
            <div className="wm-modal-body">
              If currently <strong>RUNNING</strong>, a flush cycle will start automatically.
              <br />
              If <strong>FLUSHING</strong> or <strong>PICKLING</strong>, it will stop immediately.
            </div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="wm-modal-btn confirm-red"
                onClick={() => {
                  onCmd("stop_brineomatic")
                  onClose()
                }}
              >
                Stop
              </button>
            </div>
          </>
        )}

        {type === "manual" && (
          <>
            <div className="wm-modal-title">🔧 Manual Mode</div>
            <div className="wm-modal-body">
              Manual mode gives low-level access to individual components. Autoflush, fan/temperature control will be
              disabled.
            </div>
            <div className="wm-modal-warn">⚠️ No safety checks in manual mode — proceed with caution.</div>
            <div className="wm-modal-footer">
              <button className="wm-modal-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="wm-modal-btn confirm-green"
                onClick={() => {
                  onCmd("manual_brineomatic")
                  onClose()
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export const WatermakerView: React.FC = () => {
  const { state, connected } = useSignalKBrineomatic()
  const [modal, setModal] = useState<ModalType>(null)

  const sendCmd = useCallback(async (cmd: string, extra?: Record<string, unknown>) => {
    await apiCmd(cmd, extra)
  }, [])

  const status: BOMStatus = state?.status ?? "UNKNOWN"
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN

  const isIdle = status === "IDLE"
  const isRunning = status === "RUNNING"
  const isFlushing = status === "FLUSHING"
  const isPickling = status === "PICKLING"
  const isDepickling = status === "DEPICKLING"
  const isPickled = status === "PICKLED"
  const isManual = status === "MANUAL"
  const isStopping = status === "STOPPING"
  const isActive = isRunning || isFlushing || isPickling || isDepickling || isStopping

  return (
    <>
      <style>{styles}</style>
      <div className="wm-root">
        <div className="wm-content">
          {/* ── Header ── */}
          <div className="wm-header">
            <div className="wm-title">💧 Watermaker</div>
            <div
              className={`wm-status-badge ${isRunning ? "wm-pulse" : ""}`}
              style={{ color: st.text, borderColor: st.text + "88", background: st.bg, boxShadow: st.glow }}
            >
              {status}
            </div>
            <div className={`wm-conn ${connected ? "ok" : "err"}`}>{connected ? "LIVE" : "OFFLINE"}</div>
          </div>

          {/* ── Gauges ── */}
          <div className="wm-gauges">
            <ArcGauge
              label="Filter Press"
              unit="PSI"
              value={state?.filter_pressure ?? -999}
              min={0}
              max={120}
              color="#38bdf8"
              warnAt={80}
              warnColor="#fbbf24"
              alertAt={100}
              alertColor="#f87171"
              fmt={fmt1}
            />
            <ArcGauge
              label="Membrane Press"
              unit="PSI"
              value={state?.membrane_pressure ?? -999}
              min={0}
              max={1200}
              color="#60a5fa"
              warnAt={900}
              warnColor="#fbbf24"
              alertAt={1100}
              alertColor="#f87171"
              fmt={fmt0}
            />
            <ArcGauge
              label="Salinity"
              unit="PPM"
              value={state?.product_salinity ?? 0}
              min={0}
              max={1000}
              color="#4ade80"
              warnAt={600}
              warnColor="#fbbf24"
              alertAt={800}
              alertColor="#f87171"
              fmt={fmt0}
            />
            <ArcGauge
              label="Flow Rate"
              unit="LPH"
              value={state?.product_flowrate ?? 0}
              min={0}
              max={100}
              color="#34d399"
              fmt={fmt1}
            />
            <ArcGauge
              label="Motor Temp"
              unit="°C"
              value={state?.motor_temperature ?? 0}
              min={0}
              max={80}
              color="#38bdf8"
              warnAt={60}
              warnColor="#fbbf24"
              alertAt={70}
              alertColor="#f87171"
              fmt={fmt1}
            />
            <ArcGauge
              label="Water Temp"
              unit="°C"
              value={state?.water_temperature ?? 0}
              min={0}
              max={40}
              color="#7dd3fc"
              fmt={fmt1}
            />
            <ArcGauge
              label="Tank Level"
              unit="%"
              value={state?.tank_level ?? 0}
              min={0}
              max={100}
              color="#60a5fa"
              warnAt={90}
              warnColor="#4ade80"
              fmt={fmt0}
            />
            <ArcGauge
              label="Produced"
              unit="L"
              value={state?.volume ?? 0}
              min={0}
              max={500}
              color="#a78bfa"
              fmt={fmt1}
            />
          </div>

          {/* ── Middle: info + components ── */}
          <div className="wm-middle">
            <div className="wm-info">
              <div className="wm-info-title">Status</div>

              {/* Results */}
              {state?.run_result && state.run_result !== "STARTUP" && (
                <div className="wm-info-row">
                  <span className="wm-info-key">Run Result</span>
                  <ResultBadge result={state.run_result} />
                </div>
              )}
              {state?.flush_result && state.flush_result !== "STARTUP" && (
                <div className="wm-info-row">
                  <span className="wm-info-key">Flush Result</span>
                  <ResultBadge result={state.flush_result} />
                </div>
              )}

              {/* Timers */}
              {(isRunning || isStopping || isIdle) && (state?.runtime_elapsed ?? 0) > 0 && (
                <div className="wm-info-row">
                  <span className="wm-info-key">Runtime</span>
                  <span className="wm-info-val">{formatDuration(state?.runtime_elapsed ?? 0)}</span>
                </div>
              )}
              {isRunning && (state?.finish_countdown ?? 0) > 0 && (
                <div className="wm-info-row">
                  <span className="wm-info-key">Remaining</span>
                  <span className="wm-info-val" style={{ color: "#4ade80" }}>
                    {formatDuration(state?.finish_countdown ?? 0)}
                  </span>
                </div>
              )}
              {isIdle && (state?.next_flush_countdown ?? 0) > 0 && (
                <div className="wm-info-row">
                  <span className="wm-info-key">Next Autoflush</span>
                  <span className="wm-info-val" style={{ color: "#38bdf8" }}>
                    {formatDuration(state?.next_flush_countdown ?? 0)}
                  </span>
                </div>
              )}
              {isFlushing && (
                <>
                  <div className="wm-info-row">
                    <span className="wm-info-key">Flush Elapsed</span>
                    <span className="wm-info-val">{formatDuration(state?.flush_elapsed ?? 0)}</span>
                  </div>
                  {(state?.flush_countdown ?? 0) > 0 && (
                    <div className="wm-info-row">
                      <span className="wm-info-key">Flush Remaining</span>
                      <span className="wm-info-val" style={{ color: "#38bdf8" }}>
                        {formatDuration(state?.flush_countdown ?? 0)}
                      </span>
                    </div>
                  )}
                </>
              )}
              {isPickling && (
                <>
                  <div className="wm-info-row">
                    <span className="wm-info-key">Pickle Elapsed</span>
                    <span className="wm-info-val">{formatDuration(state?.pickle_elapsed ?? 0)}</span>
                  </div>
                  <div className="wm-info-row">
                    <span className="wm-info-key">Pickle Remaining</span>
                    <span className="wm-info-val" style={{ color: "#fbbf24" }}>
                      {formatDuration(state?.pickle_countdown ?? 0)}
                    </span>
                  </div>
                </>
              )}
              {isDepickling && (
                <>
                  <div className="wm-info-row">
                    <span className="wm-info-key">Depickle Elapsed</span>
                    <span className="wm-info-val">{formatDuration(state?.depickle_elapsed ?? 0)}</span>
                  </div>
                  <div className="wm-info-row">
                    <span className="wm-info-key">Remaining</span>
                    <span className="wm-info-val" style={{ color: "#a78bfa" }}>
                      {formatDuration(state?.depickle_countdown ?? 0)}
                    </span>
                  </div>
                </>
              )}

              {/* Progress bars */}
              {isRunning && (state?.finish_countdown ?? 0) > 0 && (
                <ProgressBar
                  elapsed={state?.runtime_elapsed ?? 0}
                  total={(state?.runtime_elapsed ?? 0) + (state?.finish_countdown ?? 0)}
                  label="Run Progress"
                  type="run"
                />
              )}
              {isFlushing && (state?.flush_countdown ?? 0) > 0 && (
                <ProgressBar
                  elapsed={state?.flush_elapsed ?? 0}
                  total={(state?.flush_elapsed ?? 0) + (state?.flush_countdown ?? 0)}
                  label="Flush Progress"
                  type="flush"
                />
              )}
              {isPickling && (
                <ProgressBar
                  elapsed={state?.pickle_elapsed ?? 0}
                  total={(state?.pickle_elapsed ?? 0) + (state?.pickle_countdown ?? 0)}
                  label="Pickle Progress"
                  type="pickle"
                />
              )}
              {isDepickling && (
                <ProgressBar
                  elapsed={state?.depickle_elapsed ?? 0}
                  total={(state?.depickle_elapsed ?? 0) + (state?.depickle_countdown ?? 0)}
                  label="Depickle Progress"
                  type="pickle"
                />
              )}
            </div>

            {/* Component status */}
            <div className="wm-components">
              <div className="wm-comp-title">Components</div>
              {[
                { label: "Boost Pump", key: "boost_pump_on", val: state?.boost_pump_on },
                { label: "HP Pump", key: "high_pressure_pump_on", val: state?.high_pressure_pump_on },
                { label: "Diverter Vlv", key: "diverter_valve_open", val: state?.diverter_valve_open },
                { label: "Flush Valve", key: "flush_valve_open", val: state?.flush_valve_open },
                { label: "Cooling Fan", key: "cooling_fan_on", val: state?.cooling_fan_on },
              ].map(({ label, key, val }) => (
                <div className="wm-comp-row" key={key}>
                  <span className="wm-comp-name">{label}</span>
                  <div className={`wm-comp-dot ${val === undefined ? "na" : val ? "on" : "off"}`} />
                </div>
              ))}

              <div style={{ flex: 1 }} />

              {/* Brine salinity */}
              <div className="wm-info-title" style={{ marginTop: 8 }}>
                Brine
              </div>
              <div className="wm-comp-row">
                <span className="wm-comp-name">Salinity</span>
                <span style={{ fontFamily: "'Share Tech Mono'", fontSize: 15, color: "#7ab8d4" }}>
                  {state ? fmt0(state.brine_salinity) : "—"}
                </span>
              </div>
              <div className="wm-comp-row">
                <span className="wm-comp-name">Flow</span>
                <span style={{ fontFamily: "'Share Tech Mono'", fontSize: 15, color: "#7ab8d4" }}>
                  {state ? fmt1(state.brine_flowrate) : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Control buttons ── */}
          <div className="wm-controls">
            <button className="wm-btn start" disabled={!isIdle} onClick={() => setModal("start")}>
              <IconPlay />
              <span>START</span>
            </button>

            <button className="wm-btn flush" disabled={!(isIdle || isPickled)} onClick={() => setModal("flush")}>
              <IconDrop />
              <span>FLUSH</span>
            </button>

            <button className="wm-btn pickle" disabled={!isIdle} onClick={() => setModal("pickle")}>
              <IconShield />
              <span>PICKLE</span>
            </button>

            <button className="wm-btn depickle" disabled={!isPickled} onClick={() => setModal("depickle")}>
              <IconUnshield />
              <span>DEPICKLE</span>
            </button>

            <button className="wm-btn stop" disabled={!isActive} onClick={() => setModal("stop")}>
              <IconStop />
              <span>STOP</span>
            </button>

            <button className="wm-btn manual" disabled={!isIdle} onClick={() => setModal("manual")}>
              <IconWrench />
              <span>MANUAL</span>
            </button>

            <button className="wm-btn idle" disabled={!isManual} onClick={() => sendCmd("idle_brineomatic")}>
              <IconBack />
              <span>IDLE</span>
            </button>

            {/* Spacer */}
            <div />
          </div>

          {/* ── Stats footer ── */}
          <div className="wm-stats">
            <div className="wm-stat">
              <span className="wm-stat-key">Session Vol</span>
              <span className="wm-stat-val">{state ? fmt1(state.volume) : "—"} L</span>
            </div>
            <div className="wm-stat">
              <span className="wm-stat-key">Flush Vol</span>
              <span className="wm-stat-val">{state ? fmt1(state.flush_volume) : "—"} L</span>
            </div>
            <div className="wm-stat">
              <span className="wm-stat-key">Total Flow</span>
              <span className="wm-stat-val">{state ? fmt1(state.total_flowrate) : "—"} LPH</span>
            </div>
          </div>
        </div>

        {/* ── Modal ── */}
        {modal && <Modal type={modal} onClose={() => setModal(null)} onCmd={sendCmd} />}
      </div>
    </>
  )
}

export default WatermakerView
