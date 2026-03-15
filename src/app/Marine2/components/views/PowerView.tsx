/**
 * PowerView.tsx  v2
 *
 * Layout — 2 rows, no scrolling:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ STATUS + ALARM BANNER (collapses when clear)                        │
 *   ├──────────────┬──────────────┬─────────────────────────────────────┤
 *   │ ROW 1 (55%)  │              │                                      │
 *   │ [SOC + Flow] │ [REC BMS]    │ [BMV712 + Relay]                     │
 *   ├──────────────┼──────────────┼─────────────────────────────────────┤
 *   │ ROW 2 (45%)  │              │                                      │
 *   │ [Quattro]    │ [MPPT]       │ [Energy Balance]                     │
 *   └──────────────┴──────────────┴─────────────────────────────────────┘
 *
 * Alarms (fire SignalK PUT notifications):
 *   1. Low SoC            — below pvAlarmSocLow  (default 20%)
 *   2. High SoC           — above pvAlarmSocHigh (default 98%)
 *   3. Cell delta         — REC BMS spread above pvAlarmCellDelta (default 50 mV)
 *   4. Quattro load high  — AC out power above pvAlarmLoadWatts (default 3500 W)
 *   5. Battery high temp  — above pvAlarmTempHigh (default 45 °C)
 *
 * Alarm thresholds are configurable in SettingsView → PowerView.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import type React from "react"
import { getConfig } from "../../config/AppConfig"

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const _cfg = getConfig()
const SK_WS_URL = `ws://${_cfg.signalkHost}:${_cfg.signalkPort}/signalk/v1/stream?subscribe=none`
const SK_API = `http://${_cfg.signalkHost}:${_cfg.signalkPort}/signalk/v1/api/vessels/self`
const BAT = _cfg.pvBatteryPath
const SOL = _cfg.pvSolarPath
const INV = _cfg.pvInverterPath
const BMVR = _cfg.pvBmvRelayPath
const REC_WS = _cfg.pvRecBmsWsUrl
const N_PFX = _cfg.notifPrefix

// Alarm thresholds — fall back to safe defaults if not yet in AppConfig
const TH_SOC_LO = _cfg.pvAlarmSocLow
const TH_SOC_HI = _cfg.pvAlarmSocHigh
const TH_DELTA = _cfg.pvAlarmCellDelta
const TH_LOAD = _cfg.pvAlarmLoadWatts
const TH_TEMP = _cfg.pvAlarmTempHigh

// ─── PALETTE — matches WeatherView ───────────────────────────────────────────
const MONO = "'Share Tech Mono', monospace"
const C = {
  bg: "#000509",
  panel: "rgba(0,8,20,0.88)",
  border: "rgba(0,210,255,0.08)",
  accent: "rgba(0,210,255,0.45)",
  text: "#e8f8ff",
  dim: "rgba(200,220,255,0.55)",
  faint: "rgba(200,220,255,0.3)",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  blue: "#38bdf8",
  teal: "#2dd4bf",
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const f1 = (v: number | null, u = "") => (v === null ? "—" : `${v.toFixed(1)}${u}`)
const f0 = (v: number | null, u = "") => (v === null ? "—" : `${Math.round(v)}${u}`)
const kC = (k: number | null) => (k === null ? null : Math.round((k - 273.15) * 10) / 10)
const ttg = (s: number | null) => {
  if (s === null || s <= 0) return "—"
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
const socCol = (soc: number | null) => {
  if (soc === null) return C.dim
  if (soc > 0.7) return C.green
  if (soc > 0.4) return C.amber
  return C.red
}

// ─── STATE TYPES ─────────────────────────────────────────────────────────────
interface BatS {
  v: number | null
  a: number | null
  soc: number | null
  tempC: number | null
  remAh: number | null
  ttgS: number | null
  cMin: number | null
  cMax: number | null
  cDelta: number | null
  balancing: boolean | null
  recConn: boolean
  bmvRelay: boolean | null
}
interface InvS {
  dcV: number | null
  dcA: number | null
  acOV: number | null
  acOA: number | null
  acOW: number | null
  acIV: number | null
  acIA: number | null
  acIW: number | null
  mode: string | null
  state: string | null
}
interface SolS {
  pV: number | null
  pA: number | null
  pW: number | null
  yWh: number | null
  mode: string | null
}
interface FC {
  hour: number
  wh: number
}

// ─── ALARM DEFINITIONS ───────────────────────────────────────────────────────
type Level = "alarm" | "warn" | "normal"
interface AD {
  id: string
  label: string
  level: Level
  check: (b: BatS, i: InvS) => boolean
  msg: (b: BatS, i: InvS) => string
}

const ALARMS: AD[] = [
  {
    id: "pv-soc-low",
    label: "Low Battery",
    level: "alarm",
    check: (b) => b.soc !== null && b.soc * 100 < TH_SOC_LO,
    msg: (b) => `SoC ${b.soc !== null ? Math.round(b.soc * 100) : "?"}% — below ${TH_SOC_LO}%`,
  },
  {
    id: "pv-soc-high",
    label: "SoC High",
    level: "warn",
    check: (b) => b.soc !== null && b.soc * 100 > TH_SOC_HI,
    msg: (b) => `SoC ${b.soc !== null ? Math.round(b.soc * 100) : "?"}% — above ${TH_SOC_HI}% (overcharge risk)`,
  },
  {
    id: "pv-cell-delta",
    label: "Cell Imbalance",
    level: "warn",
    check: (b) => b.cDelta !== null && b.cDelta * 1000 > TH_DELTA,
    msg: (b) => `Cell spread ${b.cDelta !== null ? Math.round(b.cDelta * 1000) : "?"}mV — above ${TH_DELTA}mV`,
  },
  {
    id: "pv-load-high",
    label: "High Load",
    level: "warn",
    check: (_b, i) => i.acOW !== null && i.acOW > TH_LOAD,
    msg: (_b, i) => `Load ${i.acOW !== null ? Math.round(i.acOW) : "?"}W — above ${TH_LOAD}W limit`,
  },
  {
    id: "pv-temp-high",
    label: "Battery Temp",
    level: "alarm",
    check: (b) => b.tempC !== null && b.tempC > TH_TEMP,
    msg: (b) => `Battery ${b.tempC}°C — above ${TH_TEMP}°C limit`,
  },
]

// ─── SK HELPERS ──────────────────────────────────────────────────────────────
const skPut = (dot: string, val: unknown) =>
  fetch(`${SK_API}/${dot.replace(/\./g, "/")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: val }),
  }).catch(() => {})

const fireAlarm = (id: string, level: Level, msg: string) => {
  skPut(`notifications/${N_PFX.replace(/\./g, "/")}/power/${id}`, {
    state: level,
    method: ["sound", "visual"],
    message: msg,
    source: "marine2.power",
    timestamp: new Date().toISOString(),
    volAlarm: _cfg.volAlarm,
    volWarn: _cfg.volWarn,
    zone: "all",
  })
}
const clearAlarm = (id: string) => {
  skPut(`notifications/${N_PFX.replace(/\./g, "/")}/power/${id}`, { state: "normal", method: [], message: "cleared" })
}

// ─── SK SUBSCRIPTIONS ────────────────────────────────────────────────────────
const SUBS = [
  { path: `${BAT}.voltage`, period: 2000 },
  { path: `${BAT}.current`, period: 2000 },
  { path: `${BAT}.stateOfCharge`, period: 5000 },
  { path: `${BAT}.temperature`, period: 10000 },
  { path: `${BAT}.capacity.remaining`, period: 5000 },
  { path: `${BAT}.capacity.timeRemaining`, period: 10000 },
  { path: `${BMVR}.state`, period: 5000 },
  { path: `${INV}.dc.voltage`, period: 2000 },
  { path: `${INV}.dc.current`, period: 2000 },
  { path: `${INV}.ac.output.voltage`, period: 2000 },
  { path: `${INV}.ac.output.current`, period: 2000 },
  { path: `${INV}.ac.output.power`, period: 2000 },
  { path: `${INV}.ac.input.voltage`, period: 2000 },
  { path: `${INV}.ac.input.current`, period: 2000 },
  { path: `${INV}.ac.input.power`, period: 2000 },
  { path: `${INV}.mode`, period: 5000 },
  { path: `${INV}.state`, period: 5000 },
  { path: `${SOL}.panelVoltage`, period: 5000 },
  { path: `${SOL}.panelCurrent`, period: 5000 },
  { path: `${SOL}.panelPower`, period: 5000 },
  { path: `${SOL}.yieldToday`, period: 60000 },
  { path: `${SOL}.state`, period: 5000 },
  { path: "navigation.position", period: 30000 },
]

async function fetchFC(lat: number, lon: number): Promise<FC[]> {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=shortwave_radiation&forecast_days=1&timezone=auto`,
  )
  const j = await r.json()
  return (j.hourly.time as string[]).map((t, i) => ({
    hour: new Date(t).getHours(),
    wh: Math.round((j.hourly.shortwave_radiation[i] ?? 0) * 0.18),
  }))
}

// ─── MINI COMPONENTS ─────────────────────────────────────────────────────────

// Label/value row
const R = ({ label, value, unit, color = C.dim }: { label: string; value: string; unit?: string; color?: string }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "1px 0",
      borderBottom: `1px solid rgba(0,150,255,0.06)`,
    }}
  >
    <span style={{ fontSize: 13, color: C.dim, fontFamily: MONO, letterSpacing: "0.06em" }}>{label}</span>
    <span style={{ fontSize: 11, color, fontFamily: MONO }}>
      {value}
      {unit && <span style={{ fontSize: 11, color: C.faint }}> {unit}</span>}
    </span>
  </div>
)

// SOC arc gauge (compact 76px)
const SocArc = ({ soc }: { soc: number | null }) => {
  const p = soc === null ? 0 : Math.min(1, Math.max(0, soc))
  const r = 35,
    cx = 48,
    cy = 48,
    sA = -210,
    tA = 240
  const toR = (d: number) => (d * Math.PI) / 180
  const ax = (a: number) => cx + r * Math.cos(toR(a))
  const ay = (a: number) => cy + r * Math.sin(toR(a))
  const aEnd = sA + p * tA,
    la = p * tA > 180 ? 1 : 0
  const col = socCol(soc)
  return (
    <svg width={96} height={96} style={{ flexShrink: 0 }}>
      <path
        d={`M ${ax(sA)} ${ay(sA)} A ${r} ${r} 0 1 1 ${ax(sA + tA)} ${ay(sA + tA)}`}
        fill="none"
        stroke="rgba(0,210,255,0.08)"
        strokeWidth={7}
        strokeLinecap="round"
      />
      {p > 0 && (
        <path
          d={`M ${ax(sA)} ${ay(sA)} A ${r} ${r} 0 ${la} 1 ${ax(aEnd)} ${ay(aEnd)}`}
          fill="none"
          stroke={col}
          strokeWidth={7}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${col}80)` }}
        />
      )}
      <text x={cx} y={cy + 1} textAnchor="middle" fill={col} fontSize={20} fontWeight={700} fontFamily={MONO}>
        {soc === null ? "—" : Math.round(p * 100)}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" fill={C.faint} fontSize={11} fontFamily={MONO}>
        %SOC
      </text>
    </svg>
  )
}

// Cell delta bar
const DeltaBar = ({ delta }: { delta: number | null }) => {
  const mv = delta === null ? null : Math.round(delta * 1000)
  const pct = mv === null ? 0 : Math.min(1, mv / 200)
  const col = mv === null ? C.faint : mv < 20 ? C.green : mv < 50 ? C.amber : C.red
  return (
    <div style={{ padding: "1px 0", borderBottom: `1px solid rgba(0,150,255,0.06)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
        <span style={{ fontSize: 13, color: C.dim, fontFamily: MONO, letterSpacing: "0.06em" }}>Cell Δ</span>
        <span style={{ fontSize: 11, color: col, fontFamily: MONO }}>
          {mv === null ? "—" : mv}
          <span style={{ fontSize: 11, color: C.faint }}> mV</span>
        </span>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
        <div
          style={{
            height: "100%",
            width: `${pct * 100}%`,
            background: col,
            borderRadius: 2,
            boxShadow: `0 0 4px ${col}80`,
            transition: "width 0.5s",
          }}
        />
      </div>
    </div>
  )
}

// Power flow line
const Flow = ({ w }: { w: number | null }) => {
  if (w === null) return <span style={{ color: C.dim, fontFamily: MONO, fontSize: 13 }}>— W</span>
  const chg = w >= 0,
    abs = Math.abs(w)
  const label = abs >= 1000 ? `${(abs / 1000).toFixed(2)} kW` : `${Math.round(abs)} W`
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: chg ? C.green : C.amber, fontSize: 11 }}>{chg ? "▲" : "▼"}</span>
      <span style={{ color: chg ? C.green : C.amber, fontFamily: MONO, fontSize: 15, fontWeight: 700 }}>{label}</span>
      <span style={{ color: C.faint, fontFamily: MONO, fontSize: 9 }}>{chg ? "CHG" : "DIS"}</span>
    </div>
  )
}

// Relay button
const RelayBtn = ({
  label,
  state,
  onToggle,
  disabled,
  color = C.blue,
}: {
  label: string
  state: boolean | null
  onToggle: () => void
  disabled: boolean
  color?: string
}) => (
  <button
    onClick={onToggle}
    disabled={disabled || state === null}
    style={{
      padding: "4px 8px",
      borderRadius: 5,
      cursor: disabled || state === null ? "default" : "pointer",
      background: state ? `${color}18` : "rgba(255,255,255,0.03)",
      border: `1px solid ${state ? color : "rgba(255,255,255,0.1)"}`,
      color: state ? color : C.dim,
      fontFamily: MONO,
      fontSize: 12,
      boxShadow: state ? `0 0 5px ${color}30` : "none",
      transition: "all 0.2s",
      opacity: disabled || state === null ? 0.4 : 1,
    }}
  >
    {state === null ? "…" : state ? `● ${label}` : `○ ${label}`}
  </button>
)

// Card wrapper
const Card = ({
  title,
  icon,
  accent = C.blue,
  children,
}: {
  title: string
  icon: string
  accent?: string
  children: React.ReactNode
}) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderTop: `2px solid ${accent}`,
      borderRadius: 8,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
    }}
  >
    <div
      style={{
        padding: "4px 8px",
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span
        style={{
          fontSize: 11,
          fontFamily: MONO,
          color: accent,
          letterSpacing: "0.15em",
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        {title}
      </span>
    </div>
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: "6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  </div>
)

// Forecast bars
const FCBars = ({ fc, posLat }: { fc: FC[]; posLat: number | null }) => {
  if (posLat === null || fc.length === 0)
    return (
      <div style={{ fontSize: 11, color: C.faint, fontFamily: MONO, textAlign: "center", paddingTop: 6 }}>
        GPS unavailable
      </div>
    )
  const now = new Date().getHours()
  const day = fc.filter((f) => f.hour >= 5 && f.hour <= 21)
  const maxWh = Math.max(...day.map((f) => f.wh), 1)
  const total = day.reduce((s, f) => s + f.wh, 0)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 30 }}>
        {day.map((f) => {
          const past = f.hour < now,
            curr = f.hour === now
          const h = Math.max(2, Math.round((f.wh / maxWh) * 26))
          return (
            <div key={f.hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: "100%",
                  height: h,
                  borderRadius: 1,
                  transition: "height 0.4s",
                  background: curr ? C.amber : past ? "rgba(255,255,255,0.07)" : C.teal,
                  boxShadow: curr ? `0 0 3px ${C.amber}60` : "none",
                  opacity: past ? 0.4 : 1,
                }}
              />
            </div>
          )
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faint, fontFamily: MONO }}>
        <span style={{ fontSize: 11, fontFamily: MONO }}>5h</span>
        <span style={{ fontSize: 11, color: C.amber, fontFamily: MONO }}>now</span>
        <span style={{ fontSize: 11, fontFamily: MONO }}>21h</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, fontFamily: MONO }}>
        <span>Est {total >= 1000 ? `${(total / 1000).toFixed(1)} kWh` : `${total} Wh`}</span>
        <span>Peak {f0(Math.max(...day.map((f) => f.wh)), " Wh")}</span>
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function PowerView() {
  const [bat, setBat] = useState<BatS>({
    v: null,
    a: null,
    soc: null,
    tempC: null,
    remAh: null,
    ttgS: null,
    cMin: null,
    cMax: null,
    cDelta: null,
    balancing: null,
    recConn: false,
    bmvRelay: null,
  })
  const [inv, setInv] = useState<InvS>({
    dcV: null,
    dcA: null,
    acOV: null,
    acOA: null,
    acOW: null,
    acIV: null,
    acIA: null,
    acIW: null,
    mode: null,
    state: null,
  })
  const [sol, setSol] = useState<SolS>({ pV: null, pA: null, pW: null, yWh: null, mode: null })
  const [fc, setFc] = useState<FC[]>([])
  const [posLat, setPosLat] = useState<number | null>(null)
  const [posLon, setPosLon] = useState<number | null>(null)
  const [skConn, setSkConn] = useState(false)
  const [relPend, setRelPend] = useState<Record<string, boolean>>({})
  const [alarmOn, setAlarmOn] = useState<Record<string, boolean>>({})

  const alarmRef = useRef<Record<string, boolean>>({})
  const buf = useRef<Record<string, number | string | boolean | null>>({})
  const recWsRef = useRef<WebSocket | null>(null)

  // ── SignalK WebSocket
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const connect = () => {
      const ws = new WebSocket(SK_WS_URL)
      ws.onopen = () => {
        setSkConn(true)
        ws.send(
          JSON.stringify({
            context: "vessels.self",
            subscribe: SUBS.map((s) => ({ path: s.path, period: s.period, policy: "instant" })),
          }),
        )
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (!msg.updates) return
          for (const upd of msg.updates)
            for (const { path, value } of upd.values ?? []) {
              buf.current[path] = value
              if (path === "navigation.position" && value?.latitude != null) {
                setPosLat(value.latitude)
                setPosLon(value.longitude)
              }
            }
          const b = buf.current
          const num = (k: string) => (b[k] as number) ?? null
          setBat((prev) => ({
            ...prev,
            v: num(`${BAT}.voltage`) ?? prev.v,
            a: num(`${BAT}.current`) ?? prev.a,
            soc: num(`${BAT}.stateOfCharge`) ?? prev.soc,
            tempC: kC(num(`${BAT}.temperature`)) ?? prev.tempC,
            remAh: ((n) => (n != null ? n / 3600 : null))(num(`${BAT}.capacity.remaining`)) ?? prev.remAh,
            ttgS: num(`${BAT}.capacity.timeRemaining`) ?? prev.ttgS,
            bmvRelay: (b[`${BMVR}.state`] as boolean) ?? prev.bmvRelay,
          }))
          setInv((prev) => ({
            ...prev,
            dcV: num(`${INV}.dc.voltage`) ?? prev.dcV,
            dcA: num(`${INV}.dc.current`) ?? prev.dcA,
            acOV: num(`${INV}.ac.output.voltage`) ?? prev.acOV,
            acOA: num(`${INV}.ac.output.current`) ?? prev.acOA,
            acOW: num(`${INV}.ac.output.power`) ?? prev.acOW,
            acIV: num(`${INV}.ac.input.voltage`) ?? prev.acIV,
            acIA: num(`${INV}.ac.input.current`) ?? prev.acIA,
            acIW: num(`${INV}.ac.input.power`) ?? prev.acIW,
            mode: (b[`${INV}.mode`] as string) ?? prev.mode,
            state: (b[`${INV}.state`] as string) ?? prev.state,
          }))
          setSol((prev) => ({
            ...prev,
            pV: num(`${SOL}.panelVoltage`) ?? prev.pV,
            pA: num(`${SOL}.panelCurrent`) ?? prev.pA,
            pW: num(`${SOL}.panelPower`) ?? prev.pW,
            yWh: num(`${SOL}.yieldToday`) ?? prev.yWh,
            mode: (b[`${SOL}.state`] as string) ?? prev.mode,
          }))
        } catch {
          /**/
        }
      }
      ws.onclose = () => {
        setSkConn(false)
        timer = setTimeout(connect, 5000)
      }
      ws.onerror = () => ws.close()
      return ws
    }
    const ws = connect()
    return () => {
      clearTimeout(timer)
      ws.close()
    }
  }, [])

  // ── REC BMS WebSocket
  useEffect(() => {
    if (!REC_WS || REC_WS.includes("x:8080")) return
    let timer: ReturnType<typeof setTimeout>
    const connect = () => {
      const ws = new WebSocket(REC_WS)
      recWsRef.current = ws
      ws.onopen = () => setBat((prev) => ({ ...prev, recConn: true }))
      ws.onclose = () => {
        setBat((prev) => ({ ...prev, recConn: false }))
        timer = setTimeout(connect, 8000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          setBat((prev) => ({
            ...prev,
            cMin: d.cell_voltage_min ?? prev.cMin,
            cMax: d.cell_voltage_max ?? prev.cMax,
            cDelta:
              d.cell_voltage_max != null && d.cell_voltage_min != null
                ? d.cell_voltage_max - d.cell_voltage_min
                : prev.cDelta,
            balancing: d.balancing_active ?? prev.balancing,
            v: d.voltage ?? prev.v,
            a: d.current ?? prev.a,
            soc: d.soc != null ? d.soc / 100 : prev.soc,
          }))
        } catch {
          /**/
        }
      }
      return ws
    }
    connect()
    // Listen for contactor commands from buttons
    const handler = (e: Event) => {
      const cmd = (e as CustomEvent).detail
      if (recWsRef.current?.readyState === WebSocket.OPEN) recWsRef.current.send(JSON.stringify({ command: cmd }))
    }
    window.addEventListener("rec-bms-cmd", handler)
    return () => {
      clearTimeout(timer)
      recWsRef.current?.close()
      window.removeEventListener("rec-bms-cmd", handler)
    }
  }, [])

  // ── Solar forecast
  useEffect(() => {
    if (posLat === null || posLon === null) return
    fetchFC(posLat, posLon)
      .then(setFc)
      .catch(() => {})
  }, [posLat, posLon])

  // ── Alarm evaluation
  useEffect(() => {
    const eval_ = () => {
      const next: Record<string, boolean> = {}
      for (const def of ALARMS) {
        const fired = def.check(bat, inv)
        next[def.id] = fired
        const was = alarmRef.current[def.id] ?? false
        if (fired && !was) fireAlarm(def.id, def.level, def.msg(bat, inv))
        if (!fired && was) clearAlarm(def.id)
      }
      alarmRef.current = next
      setAlarmOn({ ...next })
    }
    eval_()
    const id = setInterval(eval_, 10000)
    return () => clearInterval(id)
  }, [bat, inv])

  // ── Relay controls
  const toggleBmvRelay = useCallback(async () => {
    const next = !bat.bmvRelay
    setRelPend((p) => ({ ...p, bmv: true }))
    await skPut(`${BMVR}.state`, next)
    setBat((prev) => ({ ...prev, bmvRelay: next }))
    setRelPend((p) => ({ ...p, bmv: false }))
  }, [bat.bmvRelay])

  const recContactor = (cmd: "open" | "close") =>
    window.dispatchEvent(new CustomEvent("rec-bms-cmd", { detail: cmd === "close" ? "relay_close" : "relay_open" }))

  const setInvMode = useCallback(async (mode: string) => {
    await skPut(`${INV}.mode`, mode)
    setInv((prev) => ({ ...prev, mode }))
  }, [])

  const batW = bat.v !== null && bat.a !== null ? bat.v * bat.a : null
  const activeAlarms = ALARMS.filter((d) => alarmOn[d.id])

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        boxSizing: "border-box",
        fontFamily: MONO,
        overflow: "hidden",
      }}
    >
      {/* ── Status / alarm bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          paddingBottom: 3,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {/* Connection dots */}
        {[
          { ok: skConn, label: "SK" },
          { ok: bat.recConn, label: "REC" },
        ].map(({ ok, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: ok ? C.green : "rgba(100,100,100,0.4)",
                boxShadow: ok ? `0 0 3px ${C.green}` : "none",
              }}
            />
            <span style={{ fontSize: 11, color: ok ? C.green : C.faint }}>{label}</span>
          </div>
        ))}
        {/* Active alarm badges */}
        <div style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap" }}>
          {activeAlarms.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                borderRadius: 3,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.35)",
              }}
            >
              <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>⚠ {d.label}</span>
              <span style={{ fontSize: 11, color: C.dim }}>{d.msg(bat, inv)}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 11, color: C.faint, letterSpacing: "0.12em" }}>POWER SYSTEMS</span>
      </div>

      {/* ═══════════════ ROW 1 — BATTERIES (55%) ═══════════════ */}
      <div style={{ flex: 55, display: "flex", gap: 5, minHeight: 0 }}>
        {/* 1A: House bank — SOC + power flow + key metrics */}
        <Card title="HOUSE BANK" icon="🔋" accent={socCol(bat.soc)}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <SocArc soc={bat.soc} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Flow w={batW} />
              <div style={{ fontSize: 24, fontWeight: 700, color: C.text, fontFamily: MONO, marginTop: 2 }}>
                {f1(bat.v, " V")}
              </div>
              <div
                style={{
                  fontSize: 15,
                  color: bat.a !== null ? (bat.a >= 0 ? C.green : C.amber) : C.dim,
                  fontFamily: MONO,
                }}
              >
                {bat.a === null ? "—" : `${bat.a >= 0 ? "+" : ""}${bat.a.toFixed(1)} A`}
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <R label="Remaining" value={f1(bat.remAh)} unit="Ah" />
            <R label="Time left" value={ttg(bat.ttgS)} color={C.blue} />
            <R
              label="Temp"
              value={f1(bat.tempC)}
              unit="°C"
              color={bat.tempC !== null && bat.tempC > TH_TEMP ? C.red : C.dim}
            />
          </div>
        </Card>

        {/* 1B: REC BMS */}
        <Card title="REC BMS" icon="⚡" accent={C.teal}>
          <R
            label="Cell min"
            value={bat.cMin !== null ? f1(bat.cMin * 1000) : "—"}
            unit="mV"
            color={bat.cMin !== null && bat.cMin < 2.8 ? C.red : C.text}
          />
          <R
            label="Cell max"
            value={bat.cMax !== null ? f1(bat.cMax * 1000) : "—"}
            unit="mV"
            color={bat.cMax !== null && bat.cMax > 3.65 ? C.red : C.text}
          />
          <DeltaBar delta={bat.cDelta} />
          <R
            label="Balancing"
            value={bat.balancing === null ? "—" : bat.balancing ? "ACTIVE" : "IDLE"}
            color={bat.balancing ? C.teal : C.dim}
          />
          <R label="Temp" value={f1(bat.tempC)} unit="°C" />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => recContactor("close")}
              disabled={!bat.recConn}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 4,
                cursor: "pointer",
                background: "rgba(34,197,94,0.1)",
                border: `1px solid ${C.green}`,
                color: C.green,
                fontFamily: MONO,
                fontSize: 12,
                opacity: bat.recConn ? 1 : 0.4,
              }}
            >
              ● Close
            </button>
            <button
              onClick={() => recContactor("open")}
              disabled={!bat.recConn}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 4,
                cursor: "pointer",
                background: "rgba(239,68,68,0.1)",
                border: `1px solid ${C.red}`,
                color: C.red,
                fontFamily: MONO,
                fontSize: 12,
                opacity: bat.recConn ? 1 : 0.4,
              }}
            >
              ○ Open
            </button>
          </div>
        </Card>

        {/* 1C: BMV712 */}
        <Card title="BMV712" icon="📊" accent={C.blue}>
          <R label="Voltage" value={f1(bat.v)} unit="V" color={C.text} />
          <R
            label="Current"
            value={bat.a !== null ? `${bat.a >= 0 ? "+" : ""}${bat.a.toFixed(1)}` : "—"}
            unit="A"
            color={bat.a !== null ? (bat.a >= 0 ? C.green : C.amber) : C.dim}
          />
          <R label="Power" value={f0(batW)} unit="W" color={batW !== null ? (batW >= 0 ? C.green : C.amber) : C.dim} />
          <R label="Temp" value={f1(bat.tempC)} unit="°C" />
          <R label="Remaining" value={f1(bat.remAh)} unit="Ah" />
          <R label="TTG" value={ttg(bat.ttgS)} color={C.blue} />
          <div style={{ flex: 1 }} />
          <RelayBtn label="Aux Relay" state={bat.bmvRelay} onToggle={toggleBmvRelay} disabled={!!relPend.bmv} />
        </Card>
      </div>

      {/* ═══════════════ ROW 2 — QUATTRO + SOLAR (45%) ═══════════════ */}
      <div style={{ flex: 45, display: "flex", gap: 5, minHeight: 0 }}>
        {/* 2A: Quattro — all info + mode control */}
        <Card title="QUATTRO" icon="🔌" accent={C.amber}>
          {/* Mode buttons */}
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            {(["inverter", "charger", "passthrough", "off"] as const).map((m) => {
              const cols: Record<string, string> = {
                inverter: C.amber,
                charger: C.green,
                passthrough: C.blue,
                off: C.dim,
              }
              const c = cols[m],
                active = inv.mode === m
              return (
                <button
                  key={m}
                  onClick={() => setInvMode(m)}
                  style={{
                    flex: 1,
                    padding: "4px 1px",
                    borderRadius: 3,
                    cursor: "pointer",
                    background: active ? `${c}18` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? c : "rgba(255,255,255,0.08)"}`,
                    color: active ? c : C.faint,
                    fontFamily: MONO,
                    fontSize: 11,
                    boxShadow: active ? `0 0 4px ${c}30` : "none",
                    transition: "all 0.2s",
                  }}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2, marginBottom: 2 }}>
            State: <span style={{ color: C.text, fontFamily: MONO, fontWeight: 600 }}>{inv.state ?? "—"}</span>
          </div>
          {/* DC */}
          <div
            style={{
              fontSize: 11,
              color: C.amber,
              letterSpacing: "0.15em",
              borderBottom: `1px solid rgba(245,158,11,0.2)`,
              paddingBottom: 2,
              marginBottom: 2,
            }}
          >
            DC
          </div>
          <R label="V" value={f1(inv.dcV)} unit="V" color={C.text} />
          <R label="A" value={f1(inv.dcA)} unit="A" />
          {/* AC IN */}
          <div
            style={{
              fontSize: 11,
              color: C.amber,
              letterSpacing: "0.15em",
              marginTop: 4,
              borderBottom: `1px solid rgba(245,158,11,0.2)`,
              paddingBottom: 2,
              marginBottom: 2,
            }}
          >
            AC IN (shore / gen)
          </div>
          <R label="V" value={f1(inv.acIV)} unit="V" color={C.text} />
          <R label="W" value={f0(inv.acIW)} unit="W" color={C.green} />
          {/* AC OUT */}
          <div
            style={{
              fontSize: 11,
              color: C.amber,
              letterSpacing: "0.15em",
              marginTop: 4,
              borderBottom: `1px solid rgba(245,158,11,0.2)`,
              paddingBottom: 2,
              marginBottom: 2,
            }}
          >
            AC OUT (load)
          </div>
          <R label="V" value={f1(inv.acOV)} unit="V" color={C.text} />
          <R label="A" value={f1(inv.acOA)} unit="A" />
          <R
            label="W"
            value={f0(inv.acOW)}
            unit="W"
            color={inv.acOW !== null && inv.acOW > TH_LOAD ? C.red : C.amber}
          />
        </Card>

        {/* 2B: MPPT + forecast */}
        <Card title="MPPT SOLAR" icon="☀️" accent={C.teal}>
          {/* Big panel power */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: C.faint, letterSpacing: "0.15em", marginBottom: 2 }}>PANEL POWER</div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                fontFamily: MONO,
                color: sol.pW !== null && sol.pW > 0 ? C.teal : C.dim,
              }}
            >
              {sol.pW !== null ? f0(sol.pW) : "—"}
              <span style={{ fontSize: 14, color: C.faint }}> W</span>
            </div>
          </div>
          <R label="Panel V" value={f1(sol.pV)} unit="V" color={C.text} />
          <R label="Panel A" value={f1(sol.pA)} unit="A" color={C.teal} />
          <R
            label="Mode"
            value={sol.mode ?? "—"}
            color={
              sol.mode === "float"
                ? C.green
                : sol.mode === "absorption"
                  ? C.amber
                  : sol.mode === "bulk"
                    ? C.teal
                    : C.dim
            }
          />
          <R label="Yield today" value={sol.yWh !== null ? f0(sol.yWh) : "—"} unit="Wh" color={C.green} />
          <div style={{ flex: 1, minHeight: 0, marginTop: 4 }}>
            <FCBars fc={fc} posLat={posLat} />
          </div>
        </Card>

        {/* 2C: Energy balance */}
        <Card title="ENERGY BALANCE" icon="⚖️" accent={C.teal}>
          {(() => {
            const solar = sol.pW ?? 0,
              load = inv.acOW ?? 0,
              bW = batW ?? 0,
              net = solar - load
            const mx = Math.max(solar, load, Math.abs(bW), 1)
            return (
              <>
                {[
                  { label: "Solar", val: solar, color: C.teal },
                  { label: "Load", val: load, color: C.amber },
                  { label: "Battery", val: bW, color: bW >= 0 ? C.green : C.red },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ marginBottom: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
                      <span style={{ fontSize: 13, color: C.dim, fontFamily: MONO }}>{label}</span>
                      <span style={{ fontSize: 15, color, fontFamily: MONO, fontWeight: 600 }}>
                        {f0(val)} <span style={{ fontSize: 11, color: C.faint }}>W</span>
                      </span>
                    </div>
                    <div style={{ height: 6, background: "rgba(0,210,255,0.06)", borderRadius: 3 }}>
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 2,
                          transition: "width 0.5s",
                          width: `${Math.min(100, (Math.abs(val) / mx) * 100)}%`,
                          background: color,
                          boxShadow: `0 0 4px ${color}60`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div style={{ height: 1, background: C.border, margin: "3px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, color: C.dim, fontFamily: MONO }}>Net</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: net >= 0 ? C.green : C.red, fontFamily: MONO }}>
                    {net >= 0 ? "+" : ""}
                    {Math.round(net)} W
                  </span>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
                  Alarm thresholds: SoC &lt;{TH_SOC_LO}% · Cell Δ &gt;{TH_DELTA}mV · Load &gt;{TH_LOAD}W · Temp &gt;
                  {TH_TEMP}°C
                  <br />
                  Edit in Settings → PowerView
                </div>
              </>
            )
          })()}
        </Card>
      </div>
    </div>
  )
}
