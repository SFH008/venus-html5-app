/**
 * SystemOverviewView.tsx
 * Victron System Overview — 4-quadrant dashboard
 *
 * Data source: SignalK WebSocket ws://192.168.76.171:3000/signalk/v1/stream
 *   Tanks      → tanks.freshWater.*, tanks.blackWater.*, tanks.fuel.*
 *   Batteries  → electrical.batteries.*
 *   Energy     → electrical.solar.*, electrical.chargers.*, electrical.inverters.*
 *   Devices    → electrical.inverters.*, electrical.chargers.*
 *
 * Integration:
 *   1. Add SYSTEM_OVERVIEW = "system-overview" to AppViews.store.ts enum
 *   2. Import and add case to renderView() in Marine2.tsx
 *   3. Add nav item to Footer.tsx: { view: AppViews.SYSTEM_OVERVIEW, icon: "⚡", label: "System" }
 */

import React, { useState, useEffect, useCallback, useRef } from "react"

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SIGNALK_HOST = "192.168.76.171"
const SIGNALK_PORT = 3000

// ─── TANK DEFINITIONS ────────────────────────────────────────────────────────
// SignalK paths — verify at: http://192.168.76.171:3000/signalk/v1/api/vessels/self/tanks/
const VESSEL_TANKS: Array<{ id: string; name: string; type: "freshwater" | "blackwater" | "fuel"; path: string }> = [
  { id: "fw0", name: "Fresh Water Fwd", type: "freshwater", path: "tanks.freshWater.0.currentLevel" },
  { id: "fw1", name: "Fresh Water Mid", type: "freshwater", path: "tanks.freshWater.1.currentLevel" },
  { id: "fw2", name: "Fresh Water Aft", type: "freshwater", path: "tanks.freshWater.2.currentLevel" },
  { id: "bw0", name: "Black Water Fwd", type: "blackwater", path: "tanks.blackWater.0.currentLevel" },
  { id: "bw1", name: "Black Water Mid", type: "blackwater", path: "tanks.blackWater.1.currentLevel" },
  { id: "bw2", name: "Black Water Aft", type: "blackwater", path: "tanks.blackWater.2.currentLevel" },
  { id: "fuel0", name: "Diesel", type: "fuel", path: "tanks.fuel.0.currentLevel" },
]

const TANK_STYLE: Record<string, { color: string; icon: string; svgIcon?: string; warnHigh: boolean }> = {
  freshwater: { color: "#38bdf8", icon: "💧", warnHigh: false },
  blackwater: {
    color: "#8b5cf6",
    icon: "",
    svgIcon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15"><path fill="#7c4a1e" d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2z"/></svg>`,
    warnHigh: true,
  },
  fuel: { color: "#f59e0b", icon: "⛽", warnHigh: false },
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface TankState {
  id: string
  name: string
  type: string
  level: number | null
}

interface EnergyState {
  shorePower: number | null
  shoreActive: boolean
  solar: number | null
  acLoads: number | null
  dcLoads: number | null
  alternator: number | null
}

interface Battery {
  id: string
  name: string
  soc: number | null // %
  voltage: number | null // V
  current: number | null // A
  temperature: number | null // °C
  state: string
}

interface Device {
  id: string
  name: string
  state: string
  current: number | null
}

// ─── SIGNALK PATHS ───────────────────────────────────────────────────────────
// Verify battery IDs at: http://192.168.76.171:3000/signalk/v1/api/vessels/self/electrical/batteries/
// Verify device IDs at:  http://192.168.76.171:3000/signalk/v1/api/vessels/self/electrical/

const BATTERY_IDS = ["512", "1"] // 512 = House, 1 = Thruster
const BATTERY_NAMES: Record<string, string> = { "512": "House", "1": "Thruster" }
const INVERTER_IDS = ["main"] // update to match your SignalK inverter/charger instance names
const CHARGER_IDS = ["shore", "solar"] // update to match your SignalK charger instance names

// ─── UNIFIED SIGNALK HOOK ────────────────────────────────────────────────────
function useSignalK() {
  const [tanks, setTanks] = useState<TankState[]>(
    VESSEL_TANKS.map((t) => ({ id: t.id, name: t.name, type: t.type, level: null })),
  )
  const [energy, setEnergy] = useState<EnergyState>({
    shorePower: null,
    shoreActive: false,
    solar: null,
    acLoads: null,
    dcLoads: null,
    alternator: null,
  })
  const [batteries, setBatteries] = useState<Battery[]>(
    BATTERY_IDS.map((id) => ({
      id,
      name: BATTERY_NAMES[id] || id,
      soc: null,
      voltage: null,
      current: null,
      temperature: null,
      state: "—",
    })),
  )
  const [devices, setDevices] = useState<Device[]>([
    ...INVERTER_IDS.map((id) => ({ id: `inverter.${id}`, name: id, state: "—", current: null })),
    ...CHARGER_IDS.map((id) => ({ id: `charger.${id}`, name: id, state: "—", current: null })),
  ])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buf = useRef<Record<string, unknown>>({})

  const buildSubscriptions = useCallback(() => {
    const subs: Array<{ path: string; period: number; policy: string }> = []
    // Tanks
    VESSEL_TANKS.forEach((t) => subs.push({ path: t.path, period: 5000, policy: "instant" }))
    // Batteries
    BATTERY_IDS.forEach((id) => {
      ;["capacity.stateOfCharge", "voltage", "current", "temperature", "name"].forEach((p) =>
        subs.push({ path: `electrical.batteries.${id}.${p}`, period: 2000, policy: "instant" }),
      )
    })
    // Energy — solar
    CHARGER_IDS.forEach((id) => {
      ;["power", "voltage", "current", "chargingMode"].forEach((p) =>
        subs.push({ path: `electrical.solar.${id}.${p}`, period: 2000, policy: "instant" }),
      )
      ;["ac.in.voltage", "ac.in.current", "ac.in.frequency"].forEach((p) =>
        subs.push({ path: `electrical.chargers.${id}.${p}`, period: 2000, policy: "instant" }),
      )
    })
    // Inverters / AC loads
    INVERTER_IDS.forEach((id) => {
      ;["ac.out.power", "ac.out.current", "dc.current", "mode", "state"].forEach((p) =>
        subs.push({ path: `electrical.inverters.${id}.${p}`, period: 2000, policy: "instant" }),
      )
    })
    // Alternator
    subs.push({ path: "electrical.alternators.main.current", period: 2000, policy: "instant" })
    subs.push({ path: "electrical.alternators.main.voltage", period: 2000, policy: "instant" })
    return subs
  }, [])

  const processUpdate = useCallback((path: string, value: unknown) => {
    buf.current[path] = value
    const b = buf.current

    // ── Tanks ────────────────────────────────────────────────────────────────
    const tankDef = VESSEL_TANKS.find((t) => t.path === path)
    if (tankDef && typeof value === "number") {
      setTanks((prev) => prev.map((t) => (t.id === tankDef.id ? { ...t, level: value } : t)))
    }

    // ── Batteries ────────────────────────────────────────────────────────────
    const batMatch = path.match(/^electrical\.batteries\.([^.]+)\./)
    if (batMatch) {
      const id = batMatch[1]
      if (!BATTERY_IDS.includes(id)) return
      setBatteries((prev) =>
        prev.map((bat) => {
          if (bat.id !== id) return bat
          const soc = b[`electrical.batteries.${id}.capacity.stateOfCharge`]
          const volt = b[`electrical.batteries.${id}.voltage`]
          const curr = b[`electrical.batteries.${id}.current`]
          const temp = b[`electrical.batteries.${id}.temperature`]
          return {
            ...bat,
            name: BATTERY_NAMES[id] || id,
            soc: typeof soc === "number" ? Math.round(soc * 100) : bat.soc,
            voltage: typeof volt === "number" ? Math.round(volt * 10) / 10 : bat.voltage,
            current: typeof curr === "number" ? Math.round(curr * 10) / 10 : bat.current,
            temperature: typeof temp === "number" ? Math.round((temp - 273.15) * 10) / 10 : bat.temperature,
            state:
              typeof curr === "number" ? (curr > 0.5 ? "Charging" : curr < -0.5 ? "Discharging" : "Idle") : bat.state,
          }
        }),
      )
    }

    // ── Energy ────────────────────────────────────────────────────────────────
    if (path.startsWith("electrical.")) {
      // Solar power — sum all charger solar paths
      const solarPowers = CHARGER_IDS.map((id) => b[`electrical.solar.${id}.power`]).filter(
        (v) => typeof v === "number",
      ) as number[]
      const solar = solarPowers.length > 0 ? Math.round(solarPowers.reduce((a, v) => a + v, 0)) : null

      // Shore power — first charger AC in current
      const shoreId = CHARGER_IDS[0]
      const shoreI = b[`electrical.chargers.${shoreId}.ac.in.current`]
      const shoreV = b[`electrical.chargers.${shoreId}.ac.in.voltage`]
      const shoreActive = typeof shoreV === "number" && shoreV > 50

      // AC loads — sum inverter output power
      const acPowers = INVERTER_IDS.map((id) => b[`electrical.inverters.${id}.ac.out.power`]).filter(
        (v) => typeof v === "number",
      ) as number[]
      const acLoads = acPowers.length > 0 ? Math.round(acPowers.reduce((a, v) => a + v, 0)) : null

      // DC loads — inverter DC current
      const dcCurr = b[`electrical.inverters.${INVERTER_IDS[0]}.dc.current`]

      // Alternator
      const altCurr = b["electrical.alternators.main.current"]

      setEnergy({
        shorePower: typeof shoreI === "number" ? Math.round(shoreI * 10) / 10 : null,
        shoreActive,
        solar,
        acLoads,
        dcLoads: typeof dcCurr === "number" ? Math.round(dcCurr * 10) / 10 : null,
        alternator: typeof altCurr === "number" ? Math.round(altCurr * 10) / 10 : null,
      })

      // Devices
      const devList: Device[] = [
        ...INVERTER_IDS.map((id) => {
          const mode = b[`electrical.inverters.${id}.mode`]
          const curr = b[`electrical.inverters.${id}.ac.out.current`]
          return {
            id: `inverter.${id}`,
            name: `Inverter ${id}`,
            state: typeof mode === "string" ? mode : "—",
            current: typeof curr === "number" ? Math.round(curr * 10) / 10 : null,
          }
        }),
        ...CHARGER_IDS.map((id) => {
          const mode = b[`electrical.chargers.${id}.mode`] ?? b[`electrical.solar.${id}.chargingMode`]
          const curr = b[`electrical.chargers.${id}.ac.in.current`] ?? b[`electrical.solar.${id}.current`]
          return {
            id: `charger.${id}`,
            name: `${id.charAt(0).toUpperCase() + id.slice(1)} Charger`,
            state: typeof mode === "string" ? mode : "—",
            current: typeof curr === "number" ? Math.round(curr * 10) / 10 : null,
          }
        }),
      ]
      setDevices(devList)
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }
    const ws = new WebSocket(`ws://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/stream?subscribe=none`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ context: "vessels.self", subscribe: buildSubscriptions() }))
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (!msg.updates) return
        for (const update of msg.updates) {
          for (const val of update.values || []) {
            processUpdate(val.path, val.value)
          }
        }
      } catch {
        /* ignore */
      }
    }

    ws.onerror = () => setConnected(false)
    ws.onclose = () => {
      setConnected(false)
      reconnRef.current = setTimeout(connect, 3000)
    }
  }, [buildSubscriptions, processUpdate])

  useEffect(() => {
    connect()
    return () => {
      if (reconnRef.current) clearTimeout(reconnRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  return { tanks, energy, batteries, devices, connected }
}

// ─── BATTERY METRIC ROW ──────────────────────────────────────────────────────
const BatteryMetricRow = ({
  label,
  value,
  unit,
  warn,
}: {
  label: string
  value: number | null
  unit: string
  warn?: boolean
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
  >
    <span
      style={{
        flex: 1,
        fontSize: 13,
        color: "rgba(200,220,255,0.7)",
        fontFamily: "'Share Tech Mono', monospace",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
    <span style={{ fontFamily: "'Share Tech Mono', monospace" }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: warn ? "#ef4444" : "#e8f8ff" }}>
        {value !== null ? `${value}` : "—"}
      </span>
      <span style={{ fontSize: 12, color: "rgba(200,220,255,0.45)", marginLeft: 2 }}>{unit}</span>
    </span>
  </div>
)

// ─── BATTERY PANEL ────────────────────────────────────────────────────────────
const BatteryPanel = ({ battery }: { battery: Battery }) => {
  const soc = battery.soc ?? 0
  const R = 52
  const circumference = 2 * Math.PI * R
  const arcLen = (soc / 100) * circumference * 0.75
  const color = soc > 60 ? "#22c55e" : soc > 30 ? "#f59e0b" : "#ef4444"
  const tempWarn = battery.temperature !== null && battery.temperature > 40

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Battery name header */}
      <div
        style={{
          fontSize: 12,
          color: "rgba(0,210,255,0.55)",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {battery.name}
      </div>
      {/* Arc ring — compact */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <div style={{ position: "relative", width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="9"
              strokeDasharray={`${circumference * 0.75} ${circumference}`}
              strokeLinecap="round"
              transform="rotate(135 70 70)"
            />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeDasharray={`${arcLen} ${circumference}`}
              strokeLinecap="round"
              transform="rotate(135 70 70)"
              style={{ filter: `drop-shadow(0 0 5px ${color}80)`, transition: "stroke-dasharray 0.5s ease" }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#e8f8ff",
                fontFamily: "'Share Tech Mono', monospace",
                lineHeight: 1,
              }}
            >
              {battery.soc !== null ? `${battery.soc}%` : "—"}
            </div>
            <div style={{ fontSize: 11, color, fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.08em" }}>
              {battery.state}
            </div>
          </div>
        </div>
      </div>
      {/* Metric rows */}
      <BatteryMetricRow label="Voltage" value={battery.voltage} unit="V" />
      <BatteryMetricRow label="Current" value={battery.current} unit="A" />
      <BatteryMetricRow label="Temperature" value={battery.temperature} unit="°C" warn={tempWarn} />
    </div>
  )
}

// ─── TANK GROUP HEADER ────────────────────────────────────────────────────────
const TankGroupHeader = ({ label, color }: { label: string; color: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 4px" }}>
    <div style={{ width: 3, height: 13, borderRadius: 2, background: color, flexShrink: 0 }} />
    <span
      style={{
        fontSize: 12,
        color,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        fontFamily: "'Share Tech Mono', monospace",
      }}
    >
      {label}
    </span>
  </div>
)

// ─── TANK BAR ─────────────────────────────────────────────────────────────────
const TankBar = ({ tank }: { tank: TankState }) => {
  const cfg = TANK_STYLE[tank.type] || TANK_STYLE.fuel
  const pct = tank.level !== null ? Math.round(tank.level * 100) : null
  const fill = tank.level !== null ? tank.level * 100 : 0
  const alert = pct !== null && (cfg.warnHigh ? pct >= 85 : pct <= 15)
  const color = alert ? "#ef4444" : cfg.color

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 140, flexShrink: 0 }}>
        {cfg.svgIcon ? (
          <span dangerouslySetInnerHTML={{ __html: cfg.svgIcon }} style={{ display: "flex", alignItems: "center" }} />
        ) : (
          <span style={{ fontSize: 15 }}>{cfg.icon}</span>
        )}
        <span
          style={{
            fontSize: 13,
            color: "rgba(200,220,255,0.8)",
            fontFamily: "'Share Tech Mono', monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tank.name}
        </span>
      </div>
      <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${fill}%`,
            background: color,
            borderRadius: 4,
            boxShadow: alert ? `0 0 8px ${color}` : "none",
            transition: "width 0.5s ease",
          }}
        />
      </div>
      <div
        style={{
          width: 44,
          textAlign: "right",
          fontSize: 16,
          fontFamily: "'Share Tech Mono', monospace",
          fontWeight: 700,
          color: alert ? "#ef4444" : "rgba(200,220,255,0.8)",
          flexShrink: 0,
        }}
      >
        {pct !== null ? `${pct}%` : "—"}
      </div>
    </div>
  )
}

// ─── ENERGY ROW ───────────────────────────────────────────────────────────────
const EnergyRow = ({
  icon,
  label,
  value,
  unit,
  active = true,
}: {
  icon: string
  label: string
  value: number | null
  unit: string
  active?: boolean
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      padding: "11px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
  >
    <span style={{ fontSize: 18, marginRight: 12, opacity: active ? 1 : 0.35 }}>{icon}</span>
    <span
      style={{
        flex: 1,
        fontSize: 13,
        color: active ? "rgba(200,220,255,0.8)" : "rgba(200,220,255,0.3)",
        fontFamily: "'Share Tech Mono', monospace",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
    <span style={{ fontFamily: "'Share Tech Mono', monospace", color: active ? "#e8f8ff" : "rgba(200,220,255,0.25)" }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{value !== null ? `${value}` : "0.0"}</span>
      <span style={{ fontSize: 12, color: "rgba(200,220,255,0.45)", marginLeft: 2 }}>{unit}</span>
    </span>
  </div>
)

// ─── DEVICE ROW ───────────────────────────────────────────────────────────────
const DeviceRow = ({ device }: { device: Device }) => {
  const isOn = !["Off", "Unknown", "Stopped"].includes(device.state)
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          flexShrink: 0,
          background: isOn ? "#22c55e" : "rgba(100,116,139,0.5)",
          boxShadow: isOn ? "0 0 6px #22c55e" : "none",
        }}
      />
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            fontSize: 13,
            color: "rgba(200,220,255,0.85)",
            fontFamily: "'Share Tech Mono', monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {device.name}
        </div>
        <div style={{ fontSize: 12, color: "rgba(200,220,255,0.4)", marginTop: 2, letterSpacing: "0.06em" }}>
          {device.state}
        </div>
      </div>
      <div
        style={{
          fontFamily: "'Share Tech Mono', monospace",
          color: "rgba(200,220,255,0.65)",
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>{device.current !== null ? `${device.current}` : "--"}</span>
        <span style={{ fontSize: 12, color: "rgba(200,220,255,0.35)", marginLeft: 2 }}>A</span>
      </div>
    </div>
  )
}

// ─── QUADRANT ─────────────────────────────────────────────────────────────────
const Quadrant = ({
  title,
  icon,
  badge,
  children,
}: {
  title: string
  icon: string
  badge?: string
  children: React.ReactNode
}) => (
  <div
    style={{
      background: "rgba(0,8,20,0.88)",
      border: "1px solid rgba(0,210,255,0.08)",
      borderRadius: 10,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: "1px solid rgba(0,210,255,0.1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, opacity: 0.65 }}>{icon}</span>
        <span
          style={{
            fontSize: 12,
            color: "rgba(0,210,255,0.55)",
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
      </div>
      {badge && <span style={{ fontSize: 11, color: "rgba(0,210,255,0.3)", letterSpacing: "0.15em" }}>{badge}</span>}
    </div>
    <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
)

// ─── CONN DOT ─────────────────────────────────────────────────────────────────
const ConnDot = ({ live, label }: { live: boolean; label: string }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "rgba(200,230,255,0.42)",
      letterSpacing: "0.15em",
    }}
  >
    <div
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: live ? "#00ff9d" : "#ff5050",
        boxShadow: live ? "0 0 7px #00ff9d" : "0 0 7px #ff5050",
        animation: live ? "none" : "blink 1s ease infinite",
      }}
    />
    {label} {live ? "LIVE" : "…"}
  </div>
)

// ─── MAIN VIEW ────────────────────────────────────────────────────────────────
const SystemOverviewView = () => {
  const { tanks, energy, batteries, devices, connected } = useSignalK()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&family=Rajdhani:wght@400;600&display=swap');
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes scanLine { from{top:0} to{top:100%} }
        .so-scroll::-webkit-scrollbar { width: 3px; }
        .so-scroll::-webkit-scrollbar-track { background: transparent; }
        .so-scroll::-webkit-scrollbar-thumb { background: rgba(0,210,255,0.2); border-radius: 2px; }
      `}</style>

      <div
        style={{
          width: "100%",
          height: "100vh",
          background: "#000509",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Share Tech Mono', monospace",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Scan line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            background:
              "linear-gradient(90deg,transparent,rgba(0,210,255,0.12) 40%,rgba(0,210,255,0.18) 50%,rgba(0,210,255,0.12) 60%,transparent)",
            animation: "scanLine 7s linear infinite",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />

        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            background: "linear-gradient(180deg,rgba(0,3,10,0.96) 0%,transparent 100%)",
            flexShrink: 0,
            zIndex: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(0,210,255,0.42)",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
              }}
            >
              System Overview
            </div>
            <div
              style={{
                fontSize: 18,
                fontFamily: "'Cinzel', serif",
                color: "#daf2ff",
                letterSpacing: "0.12em",
                marginTop: 1,
              }}
            >
              Dance Of The Spirits
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <ConnDot live={connected} label="SIGNALK" />
          </div>
        </div>

        {/* ── 4-Quadrant Grid ── */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 8,
            padding: "0 8px 8px",
            overflow: "hidden",
          }}
        >
          {/* ── Energy (top-left) ── */}
          <Quadrant title="Energy" icon="⚡">
            <EnergyRow icon="🔌" label="Shore Power" value={energy.shorePower} unit="A" active={energy.shoreActive} />
            <EnergyRow icon="☀️" label="Solar" value={energy.solar} unit="W" active={(energy.solar ?? 0) > 0} />
            <EnergyRow icon="⊙" label="AC Loads" value={energy.acLoads} unit="W" />
            <EnergyRow icon="⊖" label="DC Loads" value={energy.dcLoads} unit="A" />
            <EnergyRow
              icon="🔄"
              label="Alternator"
              value={energy.alternator}
              unit="A"
              active={(energy.alternator ?? 0) > 0}
            />
          </Quadrant>

          {/* ── Tanks (top-right) — SignalK — two columns ── */}
          <Quadrant title="Tanks" icon="🗂">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px", height: "100%" }}>
              {/* Left column: Fresh Water + Diesel */}
              <div>
                <TankGroupHeader label="Fresh Water" color="#38bdf8" />
                {tanks
                  .filter((t) => t.type === "freshwater")
                  .map((t) => (
                    <TankBar key={t.id} tank={t} />
                  ))}
                <TankGroupHeader label="Diesel" color="#f59e0b" />
                {tanks
                  .filter((t) => t.type === "fuel")
                  .map((t) => (
                    <TankBar key={t.id} tank={t} />
                  ))}
              </div>
              {/* Right column: Black Water */}
              <div>
                <TankGroupHeader label="Black Water" color="#8b5cf6" />
                {tanks
                  .filter((t) => t.type === "blackwater")
                  .map((t) => (
                    <TankBar key={t.id} tank={t} />
                  ))}
              </div>
            </div>
          </Quadrant>

          {/* ── Batteries (bottom-left) — two columns ── */}
          <Quadrant title="Batteries" icon="🔋">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px", height: "100%" }}>
              <BatteryPanel
                battery={
                  batteries.find((b) => b.id === "512") ?? {
                    id: "512",
                    name: "House",
                    soc: null,
                    voltage: null,
                    current: null,
                    temperature: null,
                    state: "—",
                  }
                }
              />
              <BatteryPanel
                battery={
                  batteries.find((b) => b.id === "1") ?? {
                    id: "1",
                    name: "Thruster",
                    soc: null,
                    voltage: null,
                    current: null,
                    temperature: null,
                    state: "—",
                  }
                }
              />
            </div>
          </Quadrant>

          {/* ── Devices (bottom-right) — MQTT ── */}
          <Quadrant title="Devices" icon="📟">
            <div className="so-scroll" style={{ overflowY: "auto", height: "100%" }}>
              {devices.length === 0 ? (
                <div style={{ color: "rgba(200,220,255,0.25)", fontSize: 13, padding: "20px 0" }}>
                  Waiting for MQTT data…
                </div>
              ) : (
                devices.map((d) => <DeviceRow key={d.id} device={d} />)
              )}
            </div>
          </Quadrant>
        </div>
      </div>
    </>
  )
}

export default SystemOverviewView
