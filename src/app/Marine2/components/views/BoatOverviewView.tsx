import React, { useEffect, useState, useRef, useCallback } from "react"
import boatLayout from "../../../images/jeanneau53.png"

import { getConfig } from "../../config/AppConfig"
const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()

interface SignalKValues {
  [path: string]: number | boolean | string | null
}

function useSignalK(paths: string[]): SignalKValues {
  const [values, setValues] = useState<SignalKValues>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(`ws://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/stream?subscribe=none`)
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            context: "vessels.self",
            subscribe: paths.map((path) => ({ path, period: 2000, format: "full" })),
          }),
        )
      }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.updates) {
            const newVals: SignalKValues = {}
            data.updates.forEach((u: { values?: { path: string; value: unknown }[] }) => {
              u.values?.forEach(({ path, value }) => {
                newVals[path] = value as number | boolean | string | null
              })
            })
            setValues((prev) => ({ ...prev, ...newVals }))
          }
        } catch {
          /* ignore */
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        reconnectRef.current = setTimeout(connect, 5000)
      }
    } catch {
      reconnectRef.current = setTimeout(connect, 5000)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [connect])

  return values
}

// ─── Types ────────────────────────────────────────────────────────────────────
type SensorType =
  | "temperature"
  | "switch"
  | "bilge"
  | "door"
  | "smoke"
  | "battery"
  | "tank_fresh"
  | "tank_black"
  | "tank_fuel"

interface Sensor {
  id: string
  label: string
  zone: string
  type: SensorType
  path: string
  x: number
  y: number
  unit?: string
  onValue?: boolean | number | string
}

const SENSORS: Sensor[] = [
  // ── Temperature & switches ──────────────────────────────────────────────
  {
    id: "saloon_temp",
    label: "Saloon",
    zone: "Saloon",
    type: "temperature",
    path: "environment.inside.saloon.temperature",
    x: 43,
    y: 50,
    unit: "°C",
  },
  {
    id: "master_temp",
    label: "Master Cabin",
    zone: "Master Cabin",
    type: "temperature",
    path: "environment.inside.masterCabin.temperature",
    x: 63,
    y: 50,
    unit: "°C",
  },
  {
    id: "salon_light",
    label: "Salon Light",
    zone: "Saloon",
    type: "switch",
    path: "electrical.switches.salon.state",
    x: 51,
    y: 62,
    onValue: true,
  },
  {
    id: "fwd_cabin_temp",
    label: "Fwd Cabin",
    zone: "Forward Cabin",
    type: "temperature",
    path: "environment.inside.forwardCabin.temperature",
    x: 86,
    y: 50,
    unit: "°C",
  },
  {
    id: "fwd_hatch",
    label: "Fwd Hatch",
    zone: "Forward Cabin",
    type: "door",
    path: "environment.inside.forwardCabin.hatch.state",
    x: 93,
    y: 50,
    onValue: true,
  },
  {
    id: "main_alternator_temp",
    label: "Main Alt",
    zone: "Engine Room",
    type: "temperature",
    path: "electrical.alternator.main.temperature",
    x: 34,
    y: 55,
    unit: "°C",
  },
  {
    id: "engine_room",
    label: "Engine Room",
    zone: "Engine Room",
    type: "temperature",
    path: "environment.inside.engineRoom.temperature",
    x: 34,
    y: 45,
    unit: "°C",
  },
  {
    id: "freezer_temp",
    label: "Freezer",
    zone: "Galley",
    type: "temperature",
    path: "environment.inside.freezer.temperature",
    x: 45,
    y: 26,
    unit: "°C",
  },
  {
    id: "refrigerator_temp",
    label: "Refrigerator",
    zone: "Galley",
    type: "temperature",
    path: "environment.inside.refrigerator.temperature",
    x: 38,
    y: 26,
    unit: "°C",
  },
  {
    id: "galley_smoke",
    label: "Gas / Smoke",
    zone: "Galley",
    type: "smoke",
    path: "environment.inside.galley.smoke",
    x: 33,
    y: 35,
    onValue: true,
  },
  {
    id: "port_aft_temp",
    label: "Port Aft",
    zone: "Port Aft Cabin",
    type: "temperature",
    path: "environment.inside.portAftCabin.temperature",
    x: 20,
    y: 38,
    unit: "°C",
  },
  {
    id: "stbd_aft_temp",
    label: "Stbd Aft",
    zone: "Stbd Aft Cabin",
    type: "temperature",
    path: "environment.inside.starboardAftCabin.temperature",
    x: 20,
    y: 62,
    unit: "°C",
  },
  {
    id: "engine_coolant_temp",
    label: "Eng Coolant",
    zone: "Engine Room",
    type: "temperature",
    path: "propulsion.main.coolantTemperature",
    x: 14,
    y: 25,
    unit: "°C",
  },
  {
    id: "genset_coolant_temp",
    label: "Gen Coolant",
    zone: "Engine Room",
    type: "temperature",
    path: "propulsion.genset.coolantTemperature",
    x: 14,
    y: 80,
    unit: "°C",
  },
  {
    id: "bilge_main",
    label: "Bilge",
    zone: "Bilge",
    type: "bilge",
    path: "environment.inside.bilge.water",
    x: 50,
    y: 50,
    onValue: true,
  },
  {
    id: "cockpit_temp",
    label: "Outside Temp",
    zone: "Cockpit / Helm",
    type: "temperature",
    path: "environment.outside.temperature",
    x: 10,
    y: 50,
    unit: "°C",
  },

  // ── Tanks ───────────────────────────────────────────────────────────────
  // Fresh water — 💧 cyan
  {
    id: "fw0",
    label: "FW Master",
    zone: "Master Cabin",
    type: "tank_fresh",
    path: "tanks.freshWater.0.currentLevel",
    x: 73,
    y: 48,
  },
  {
    id: "fw1",
    label: "FW Nav",
    zone: "Nav Station",
    type: "tank_fresh",
    path: "tanks.freshWater.1.currentLevel",
    x: 39,
    y: 70,
  },
  {
    id: "fw2",
    label: "FW Stbd Aft",
    zone: "Stbd Aft Cabin",
    type: "tank_fresh",
    path: "tanks.freshWater.2.currentLevel",
    x: 22,
    y: 72,
  },

  // Black water — 🚽 purple/dark
  {
    id: "bw0",
    label: "BW Master",
    zone: "Master Cabin Head",
    type: "tank_black",
    path: "tanks.blackWater.0.currentLevel",
    x: 60,
    y: 78,
  },
  {
    id: "bw1",
    label: "BW Stbd Aft",
    zone: "Stbd Aft Head",
    type: "tank_black",
    path: "tanks.blackWater.1.currentLevel",
    x: 31,
    y: 78,
  },
  {
    id: "bw2",
    label: "BW Port",
    zone: "Port Cabin Head",
    type: "tank_black",
    path: "tanks.blackWater.2.currentLevel",
    x: 31,
    y: 25,
  },

  // Fuel — ⛽ amber
  {
    id: "fuel0",
    label: "Fuel",
    zone: "Port Aft Cabin",
    type: "tank_fuel",
    path: "tanks.fuel.0.currentLevel",
    x: 22,
    y: 28,
  },
]

// ─── Type config ──────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<SensorType, { icon: string; color: string; alertColor: string }> = {
  temperature: { icon: "🌡", color: "#00d2ff", alertColor: "#ff6b35" },
  switch: { icon: "💡", color: "#00ff9d", alertColor: "rgba(80,80,80,0.9)" },
  bilge: { icon: "💧", color: "#00d2ff", alertColor: "#ff4040" },
  door: { icon: "🚪", color: "#00d2ff", alertColor: "#ffd700" },
  smoke: { icon: "🔥", color: "#00d2ff", alertColor: "#ff4040" },
  battery: { icon: "🔋", color: "#00ff9d", alertColor: "#ff6b35" },
  tank_fresh: { icon: "💧", color: "#22d3ee", alertColor: "#f87171" },
  tank_black: { icon: "🚽", color: "#a78bfa", alertColor: "#f97316" },
  tank_fuel: { icon: "⛽", color: "#fbbf24", alertColor: "#f87171" },
}

function kelvinToCelsius(k: number) {
  return (k - 273.15).toFixed(1)
}

function isTankType(type: SensorType): boolean {
  return type === "tank_fresh" || type === "tank_black" || type === "tank_fuel"
}

function getTankPercent(value: number | boolean | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const v = typeof value === "number" ? value : parseFloat(String(value))
  if (isNaN(v)) return null
  return Math.round(v * 100)
}

function getTankColor(type: SensorType, pct: number): string {
  const base = TYPE_CONFIG[type].color
  const alert = TYPE_CONFIG[type].alertColor
  if (type === "tank_black") {
    // Black water: warn when HIGH
    if (pct >= 80) return alert
    if (pct >= 60) return "#fb923c"
    return base
  }
  // Fresh water and fuel: warn when LOW
  if (pct <= 15) return alert
  if (pct <= 30) return "#fb923c"
  return base
}

function getSensorDisplay(sensor: Sensor, value: number | boolean | string | null | undefined) {
  const cfg = TYPE_CONFIG[sensor.type]
  if (value === null || value === undefined) return { text: "—", color: "rgba(100,100,100,0.6)", isAlert: false }

  if (isTankType(sensor.type)) {
    const pct = getTankPercent(value)
    if (pct === null) return { text: "—", color: "rgba(100,100,100,0.6)", isAlert: false }
    const color = getTankColor(sensor.type, pct)
    const isAlert = sensor.type === "tank_black" ? pct >= 80 : pct <= 15
    return { text: `${pct}%`, color, isAlert }
  }

  switch (sensor.type) {
    case "temperature": {
      const k = typeof value === "number" ? value : parseFloat(String(value))
      const c = k - 273.15
      const hot = c > 35 || c < 5
      return {
        text: `${kelvinToCelsius(k)}${sensor.unit ?? ""}`,
        color: hot ? cfg.alertColor : cfg.color,
        isAlert: hot,
      }
    }
    case "switch": {
      const on = value === true || value === 1 || value === "true" || value === sensor.onValue
      return { text: on ? "ON" : "OFF", color: on ? "#00ff9d" : "rgba(90,90,90,0.8)", isAlert: false }
    }
    case "bilge": {
      const wet = value === true || value === 1 || value === "true"
      return { text: wet ? "WET" : "DRY", color: wet ? cfg.alertColor : cfg.color, isAlert: wet }
    }
    case "door": {
      const open = value === true || value === 1 || value === "true"
      return { text: open ? "OPEN" : "CLOSED", color: open ? cfg.alertColor : cfg.color, isAlert: false }
    }
    case "smoke": {
      const alarm = value === true || value === 1 || value === "true"
      return { text: alarm ? "⚠ ALARM" : "CLEAR", color: alarm ? cfg.alertColor : cfg.color, isAlert: alarm }
    }
    default:
      return { text: String(value), color: cfg.color, isAlert: false }
  }
}

// ─── Tank fill bar ────────────────────────────────────────────────────────────
const TankBar = ({ pct, color, type: _type }: { pct: number; color: string; type: SensorType }) => {
  // Black water fills left-to-right (filling up = bad)
  // Fresh/fuel fills left-to-right (empty = bad, so bar shows how full = good)
  const fill = Math.max(0, Math.min(100, pct))
  return (
    <div
      style={{
        width: "100%",
        height: 5,
        background: "rgba(0,0,0,0.5)",
        borderRadius: 3,
        overflow: "hidden",
        marginTop: 3,
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${fill}%`,
          background: color,
          borderRadius: 3,
          boxShadow: `0 0 4px ${color}88`,
          transition: "width 0.6s ease",
        }}
      />
    </div>
  )
}

// ─── SensorPin ────────────────────────────────────────────────────────────────
const SensorPin = ({
  sensor,
  value,
  selected,
  onClick,
}: {
  sensor: Sensor
  value: number | boolean | string | null | undefined
  selected: boolean
  onClick: (s: Sensor) => void
}) => {
  const cfg = TYPE_CONFIG[sensor.type]
  const { text, color, isAlert } = getSensorDisplay(sensor, value)
  const noData = value === null || value === undefined
  const isTank = isTankType(sensor.type)
  const pct = isTank ? getTankPercent(value) : null

  return (
    <div
      onClick={() => onClick(sensor)}
      style={{
        position: "absolute",
        left: `${sensor.x}%`,
        top: `${sensor.y}%`,
        transform: "translate(-50%, -50%)",
        cursor: "pointer",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        animation: isAlert ? "alertPulse 0.9s ease-in-out infinite" : "pinFadeIn 0.5s ease forwards",
      }}
    >
      {/* Dot */}
      <div style={{ position: "relative", width: 12, height: 12 }}>
        {(selected || isAlert) && (
          <div
            style={{
              position: "absolute",
              inset: -5,
              borderRadius: "50%",
              border: `1.5px solid ${color}`,
              animation: "ringExpand 1.6s ease-out infinite",
            }}
          />
        )}
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: noData ? "rgba(70,70,70,0.5)" : color,
            boxShadow: noData ? "none" : `0 0 7px ${color}, 0 0 16px ${color}45`,
            border: `2px solid ${noData ? "rgba(70,70,70,0.25)" : color + "70"}`,
            outline: selected ? "2px solid rgba(255,255,255,0.6)" : "none",
            outlineOffset: 2,
            transition: "all 0.2s",
          }}
        />
      </div>

      {/* Chip */}
      <div
        style={{
          background: selected
            ? "linear-gradient(135deg, rgba(0,35,65,0.97), rgba(0,55,95,0.97))"
            : "linear-gradient(135deg, rgba(0,10,22,0.87), rgba(0,20,42,0.87))",
          border: `1px solid ${noData ? "rgba(70,70,70,0.18)" : color + "45"}`,
          borderRadius: 5,
          padding: isTank ? "3px 7px 5px" : "3px 7px",
          backdropFilter: "blur(10px)",
          textAlign: "center",
          minWidth: isTank ? 88 : 80,
          boxShadow: selected ? `0 0 14px ${color}35, 0 2px 10px rgba(0,0,0,0.75)` : "0 1px 6px rgba(0,0,0,0.65)",
          transition: "all 0.2s",
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: "rgba(0,210,255,0.48)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginBottom: 1.5,
            whiteSpace: "nowrap",
          }}
        >
          {cfg.icon} {sensor.label}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color,
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
        {isTank && pct !== null && <TankBar pct={pct} color={color} type={sensor.type} />}
      </div>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
const DetailPanel = ({
  sensor,
  value,
  onClose,
}: {
  sensor: Sensor
  value: number | boolean | string | null | undefined
  onClose: () => void
}) => {
  const cfg = TYPE_CONFIG[sensor.type]
  const { text, color } = getSensorDisplay(sensor, value)
  const isTank = isTankType(sensor.type)
  const pct = isTank ? getTankPercent(value) : null

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 14,
        width: 226,
        zIndex: 50,
        background: "linear-gradient(135deg, rgba(0,8,20,0.97), rgba(0,18,40,0.97))",
        border: `1px solid ${color}45`,
        borderRadius: 9,
        padding: "15px 17px",
        backdropFilter: "blur(14px)",
        boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 20px ${color}15`,
        fontFamily: "'Share Tech Mono', monospace",
        animation: "detailIn 0.2s ease forwards",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, color, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            {cfg.icon} {sensor.label}
          </div>
          <div style={{ fontSize: 12, color: "rgba(0,210,255,0.38)", marginTop: 2 }}>{sensor.zone}</div>
        </div>
        <div onClick={onClose} style={{ cursor: "pointer", color: "rgba(0,210,255,0.4)", fontSize: 14 }}>
          ✕
        </div>
      </div>

      <div
        style={{
          background: "rgba(0,4,12,0.6)",
          borderRadius: 5,
          padding: "9px 11px",
          marginBottom: 11,
          border: `1px solid ${color}18`,
        }}
      >
        <div style={{ fontSize: 12, color: "rgba(0,210,255,0.38)", letterSpacing: "0.18em", marginBottom: 3 }}>
          CURRENT VALUE
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color }}>{text}</div>
        {isTank && pct !== null && (
          <div style={{ marginTop: 8 }}>
            <TankBar pct={pct} color={color} type={sensor.type} />
            <div style={{ fontSize: 11, color: "rgba(0,210,255,0.32)", marginTop: 4 }}>
              {sensor.type === "tank_black" ? "Warn above 80% · Alert above 80%" : "Warn below 30% · Alert below 15%"}
            </div>
          </div>
        )}
        {sensor.type === "temperature" && typeof value === "number" && (
          <div style={{ fontSize: 12, color: "rgba(0,210,255,0.32)", marginTop: 2 }}>Raw: {value.toFixed(2)} K</div>
        )}
      </div>

      <div style={{ fontSize: 12, color: "rgba(0,210,255,0.32)", letterSpacing: "0.12em", marginBottom: 3 }}>
        SIGNALK PATH
      </div>
      <div style={{ fontSize: 11, color: "rgba(0,210,255,0.52)", wordBreak: "break-all", lineHeight: 1.65 }}>
        {sensor.path}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const BoatOverviewView = () => {
  const signalkValues = useSignalK(SENSORS.map((s) => s.path))
  const [selected, setSelected] = useState<Sensor | null>(null)
  const [connected, setConnected] = useState(false)
  const [showPins, setShowPins] = useState(true)

  useEffect(() => {
    if (Object.keys(signalkValues).length > 0) setConnected(true)
  }, [signalkValues])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes pinFadeIn {
          from { opacity:0; transform:translate(-50%,calc(-50% + 7px)); }
          to   { opacity:1; transform:translate(-50%,-50%); }
        }
        @keyframes alertPulse {
          0%,100% { transform:translate(-50%,-50%) scale(1); }
          50%      { transform:translate(-50%,-50%) scale(1.09); }
        }
        @keyframes ringExpand {
          0%   { transform:scale(1);   opacity:0.55; }
          100% { transform:scale(2.4); opacity:0; }
        }
        @keyframes detailIn {
          from { opacity:0; transform:translateY(-5px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes scanLine {
          from { top:0; } to { top:100%; }
        }
        @keyframes blink {
          0%,100% { opacity:1; } 50% { opacity:0.2; }
        }
      `}</style>

      <div style={{ position: "relative", width: "100%", height: "100vh", background: "#000509", overflow: "hidden" }}>
        {/* Boat image */}
        <div
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <img
            src={boatLayout}
            alt="Jeanneau 53"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: "brightness(0.58) saturate(0.6) hue-rotate(188deg)",
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Vignette */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "radial-gradient(ellipse 88% 78% at 50% 50%, transparent 28%, rgba(0,3,10,0.82) 100%)",
          }}
        />

        {/* Scan line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, transparent, rgba(0,210,255,0.14) 40%, rgba(0,210,255,0.2) 50%, rgba(0,210,255,0.14) 60%, transparent)",
            animation: "scanLine 7s linear infinite",
          }}
        />

        {/* Header */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            background: "linear-gradient(180deg, rgba(0,3,10,0.95) 0%, transparent 100%)",
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
              Vessel Overview
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
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              onClick={() => setShowPins((v) => !v)}
              style={{
                fontSize: 12,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: "3px 10px",
                borderRadius: 3,
                border: `1px solid ${showPins ? "rgba(0,210,255,0.4)" : "rgba(100,100,100,0.2)"}`,
                color: showPins ? "rgba(0,210,255,0.8)" : "rgba(100,100,100,0.45)",
              }}
            >
              Sensors
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "rgba(200,230,255,0.42)",
                letterSpacing: "0.2em",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: connected ? "#00ff9d" : "#ff5050",
                  boxShadow: connected ? "0 0 7px #00ff9d" : "0 0 7px #ff5050",
                  animation: connected ? "none" : "blink 1s ease infinite",
                }}
              />
              {connected ? "SIGNALK LIVE" : "CONNECTING…"}
            </div>
          </div>
        </div>

        {/* Sensor pins */}
        {showPins &&
          SENSORS.map((s) => (
            <SensorPin
              key={s.id}
              sensor={s}
              value={signalkValues[s.path] ?? null}
              selected={selected?.id === s.id}
              onClick={(s) => setSelected((prev) => (prev?.id === s.id ? null : s))}
            />
          ))}

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            sensor={selected}
            value={signalkValues[selected.path] ?? null}
            onClose={() => setSelected(null)}
          />
        )}

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            padding: "6px 18px 8px",
            display: "flex",
            justifyContent: "center",
            gap: 18,
            flexWrap: "wrap",
            background: "linear-gradient(0deg, rgba(0,3,10,0.95) 0%, transparent 100%)",
          }}
        >
          {(Object.entries(TYPE_CONFIG) as [SensorType, (typeof TYPE_CONFIG)[SensorType]][]).map(([type, cfg]) => (
            <div
              key={type}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: "rgba(200,230,255,0.35)",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: cfg.color,
                  boxShadow: `0 0 5px ${cfg.color}`,
                }}
              />
              {type.replace("tank_", "")}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default BoatOverviewView
