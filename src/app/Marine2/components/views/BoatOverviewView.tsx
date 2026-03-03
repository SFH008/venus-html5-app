import React, { useEffect, useState, useRef, useCallback } from "react"
import boatLayout from "../../../images/jeanneau53.png"

// ─── SignalK WebSocket hook ────────────────────────────────────────────────────
const SIGNALK_HOST = "192.168.76.171"
const SIGNALK_PORT = 3000

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
type SensorType = "temperature" | "switch" | "bilge" | "door" | "smoke" | "battery"

interface Sensor {
  id: string
  label: string
  zone: string
  type: SensorType
  path: string
  x: number // % of image width  (0=left/stern … 100=right/bow)
  y: number // % of image height (0=top/port … 100=bottom/stbd)
  unit?: string
  onValue?: boolean | number | string
}

// ─── Sensor positions — mapped to jeanneau53.png (600×300, bow=RIGHT) ─────────
//
//  Zone reference (image %, bow right):
//  Bow / fwd cabin      x≈82–92  y≈30–70
//  Fwd head stbd        x≈72–80  y≈16–34
//  Fwd head port        x≈72–80  y≈66–84
//  Saloon (centre)      x≈50–62  y≈30–70
//  Nav / companionway   x≈42–50  y≈42–58
//  Galley               x≈38–46  y≈18–36
//  Port aft cabin       x≈18–32  y≈16–44
//  Stbd aft cabin       x≈18–32  y≈56–84
//  Port aft head        x≈30–38  y≈16–28
//  Stbd aft head        x≈30–38  y≈72–84
//  Cockpit / helm       x≈6–16   y≈38–62

const SENSORS: Sensor[] = [
  // ── LIVE — wired to SignalK ──────────────────────────────────────────────
  {
    id: "saloon_temp",
    label: "Saloon",
    zone: "Saloon",
    type: "temperature",
    path: "environment.inside.saloon.temperature",
    x: 57,
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

  // ── PLACEHOLDER — add SignalK paths when sensors are installed ───────────
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
    id: "fwd_head_stbd",
    label: "Fwd Head S",
    zone: "Fwd Stbd Head",
    type: "temperature",
    path: "environment.inside.forwardHeadStarboard.temperature",
    x: 75,
    y: 24,
    unit: "°C",
  },
  {
    id: "fwd_head_port",
    label: "Fwd Head P",
    zone: "Fwd Port Head",
    type: "temperature",
    path: "environment.inside.forwardHeadPort.temperature",
    x: 75,
    y: 76,
    unit: "°C",
  },
  {
    id: "galley_temp",
    label: "Galley",
    zone: "Galley",
    type: "temperature",
    path: "environment.inside.galley.temperature",
    x: 43,
    y: 26,
    unit: "°C",
  },
  {
    id: "galley_smoke",
    label: "Gas / Smoke",
    zone: "Galley",
    type: "smoke",
    path: "environment.inside.galley.smoke",
    x: 43,
    y: 38,
    onValue: true,
  },
  {
    id: "port_aft_temp",
    label: "Port Aft",
    zone: "Port Aft Cabin",
    type: "temperature",
    path: "environment.inside.portAftCabin.temperature",
    x: 24,
    y: 28,
    unit: "°C",
  },
  {
    id: "stbd_aft_temp",
    label: "Stbd Aft",
    zone: "Stbd Aft Cabin",
    type: "temperature",
    path: "environment.inside.starboardAftCabin.temperature",
    x: 24,
    y: 72,
    unit: "°C",
  },
  {
    id: "port_aft_head",
    label: "Port Head",
    zone: "Port Aft Head",
    type: "temperature",
    path: "environment.inside.portAftHead.temperature",
    x: 34,
    y: 20,
    unit: "°C",
  },
  {
    id: "stbd_aft_head",
    label: "Stbd Head",
    zone: "Stbd Aft Head",
    type: "temperature",
    path: "environment.inside.starboardAftHead.temperature",
    x: 34,
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
    label: "Cockpit",
    zone: "Cockpit / Helm",
    type: "temperature",
    path: "environment.outside.temperature",
    x: 10,
    y: 50,
    unit: "°C",
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
}

function kelvinToCelsius(k: number) {
  return (k - 273.15).toFixed(1)
}

function getSensorDisplay(sensor: Sensor, value: number | boolean | string | null | undefined) {
  const cfg = TYPE_CONFIG[sensor.type]
  if (value === null || value === undefined) return { text: "—", color: "rgba(100,100,100,0.6)", isAlert: false }

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
          padding: "3px 7px",
          backdropFilter: "blur(10px)",
          textAlign: "center",
          minWidth: 60,
          boxShadow: selected ? `0 0 14px ${color}35, 0 2px 10px rgba(0,0,0,0.75)` : "0 1px 6px rgba(0,0,0,0.65)",
          transition: "all 0.2s",
        }}
      >
        <div
          style={{
            fontSize: 7.5,
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
            fontSize: 11,
            fontWeight: 700,
            color,
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
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
          <div style={{ fontSize: 10, color, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            {cfg.icon} {sensor.label}
          </div>
          <div style={{ fontSize: 8.5, color: "rgba(0,210,255,0.38)", marginTop: 2 }}>{sensor.zone}</div>
        </div>
        <div onClick={onClose} style={{ cursor: "pointer", color: "rgba(0,210,255,0.4)", fontSize: 14 }}>
          ✕
        </div>
      </div>

      {/* Value */}
      <div
        style={{
          background: "rgba(0,4,12,0.6)",
          borderRadius: 5,
          padding: "9px 11px",
          marginBottom: 11,
          border: `1px solid ${color}18`,
        }}
      >
        <div style={{ fontSize: 8, color: "rgba(0,210,255,0.38)", letterSpacing: "0.18em", marginBottom: 3 }}>
          CURRENT VALUE
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{text}</div>
        {sensor.type === "temperature" && typeof value === "number" && (
          <div style={{ fontSize: 8, color: "rgba(0,210,255,0.32)", marginTop: 2 }}>Raw: {value.toFixed(2)} K</div>
        )}
      </div>

      {/* Path */}
      <div style={{ fontSize: 8, color: "rgba(0,210,255,0.32)", letterSpacing: "0.12em", marginBottom: 3 }}>
        SIGNALK PATH
      </div>
      <div
        style={{
          fontSize: 7.5,
          color: "rgba(0,210,255,0.52)",
          wordBreak: "break-all",
          lineHeight: 1.65,
        }}
      >
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
                fontSize: 8.5,
                color: "rgba(0,210,255,0.42)",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
              }}
            >
              Vessel Overview
            </div>
            <div
              style={{
                fontSize: 14,
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
                fontSize: 7.5,
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
                fontSize: 7.5,
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

        {/* Bottom legend */}
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
                fontSize: 7.5,
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
              {type}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default BoatOverviewView
