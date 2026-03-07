import React, { useEffect, useState, useRef, useCallback } from "react"
import boatLayout from "../../../images/jeanneau53.png"

import { getConfig } from "../../config/AppConfig"
const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()

type SwitchSystem = "venus" | "shelly" | "nodered" | "yarrboard"
type SwitchState = "on" | "off" | "fault" | "unknown"

interface Switch {
  id: string
  label: string
  zone: string
  system: SwitchSystem
  readPath: string
  writePath: string
  x: number
  y: number
  ampsPath?: string
  icon: string
}

const SWITCHES: Switch[] = [
  {
    id: "nav_lights",
    label: "Nav Lights",
    zone: "Stern",
    system: "venus",
    readPath: "electrical.switches.venus.navLights.state",
    writePath: "electrical.switches.venus.navLights.state",
    x: 7,
    y: 50,
    icon: "🔴",
  },
  {
    id: "anchor_light",
    label: "Anchor Light",
    zone: "Bow",
    system: "venus",
    readPath: "electrical.switches.venus.anchorLight.state",
    writePath: "electrical.switches.venus.anchorLight.state",
    x: 92,
    y: 50,
    icon: "⚓",
  },
  {
    id: "saloon_lights",
    label: "Saloon Lights",
    zone: "Saloon",
    system: "shelly",
    readPath: "electrical.switches.shelly.saloonLights.state",
    writePath: "electrical.switches.shelly.saloonLights.state",
    x: 57,
    y: 38,
    ampsPath: "electrical.switches.shelly.saloonLights.current",
    icon: "💡",
  },
  {
    id: "fwd_cabin_lights",
    label: "Fwd Cabin",
    zone: "Fwd Cabin",
    system: "shelly",
    readPath: "electrical.switches.shelly.fwdCabinLights.state",
    writePath: "electrical.switches.shelly.fwdCabinLights.state",
    x: 83,
    y: 38,
    ampsPath: "electrical.switches.shelly.fwdCabinLights.current",
    icon: "💡",
  },
  {
    id: "aft_cabin_lights",
    label: "Aft Cabins",
    zone: "Aft Cabins",
    system: "shelly",
    readPath: "electrical.switches.shelly.aftCabinLights.state",
    writePath: "electrical.switches.shelly.aftCabinLights.state",
    x: 24,
    y: 50,
    ampsPath: "electrical.switches.shelly.aftCabinLights.current",
    icon: "💡",
  },
  {
    id: "cockpit_light",
    label: "Cockpit Light",
    zone: "Cockpit",
    system: "shelly",
    readPath: "electrical.switches.shelly.cockpitLight.state",
    writePath: "electrical.switches.shelly.cockpitLight.state",
    x: 12,
    y: 38,
    ampsPath: "electrical.switches.shelly.cockpitLight.current",
    icon: "💡",
  },
  {
    id: "masthead_light",
    label: "Masthead",
    zone: "Mast",
    system: "nodered",
    readPath: "electrical.switches.virtual.mastheadLight.state",
    writePath: "electrical.switches.virtual.mastheadLight.state",
    x: 65,
    y: 50,
    icon: "🔦",
  },
  {
    id: "bilge_pump",
    label: "Bilge Pump",
    zone: "Bilge",
    system: "nodered",
    readPath: "electrical.switches.virtual.bilgePump.state",
    writePath: "electrical.switches.virtual.bilgePump.state",
    x: 50,
    y: 60,
    ampsPath: "electrical.switches.virtual.bilgePump.current",
    icon: "💧",
  },
  {
    id: "water_pump",
    label: "Water Pump",
    zone: "Engine",
    system: "nodered",
    readPath: "electrical.switches.virtual.waterPump.state",
    writePath: "electrical.switches.virtual.waterPump.state",
    x: 44,
    y: 60,
    ampsPath: "electrical.switches.virtual.waterPump.current",
    icon: "🚿",
  },
  {
    id: "yarrboard_1",
    label: "Eng Blower",
    zone: "Engine Room",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch1.state",
    writePath: "electrical.switches.yarrboard.ch1.state",
    x: 38,
    y: 60,
    ampsPath: "electrical.switches.yarrboard.ch1.current",
    icon: "🌀",
  },
  {
    id: "yarrboard_2",
    label: "Fridge",
    zone: "Galley",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch2.state",
    writePath: "electrical.switches.yarrboard.ch2.state",
    x: 44,
    y: 28,
    ampsPath: "electrical.switches.yarrboard.ch2.current",
    icon: "❄️",
  },
  {
    id: "yarrboard_3",
    label: "Freezer",
    zone: "Galley",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch3.state",
    writePath: "electrical.switches.yarrboard.ch3.state",
    x: 38,
    y: 28,
    ampsPath: "electrical.switches.yarrboard.ch3.current",
    icon: "🧊",
  },
  {
    id: "yarrboard_4",
    label: "Ch 4",
    zone: "Spare",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch4.state",
    writePath: "electrical.switches.yarrboard.ch4.state",
    x: 57,
    y: 62,
    ampsPath: "electrical.switches.yarrboard.ch4.current",
    icon: "⚡",
  },
  {
    id: "yarrboard_5",
    label: "Ch 5",
    zone: "Spare",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch5.state",
    writePath: "electrical.switches.yarrboard.ch5.state",
    x: 65,
    y: 62,
    ampsPath: "electrical.switches.yarrboard.ch5.current",
    icon: "⚡",
  },
  {
    id: "yarrboard_6",
    label: "Ch 6",
    zone: "Spare",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch6.state",
    writePath: "electrical.switches.yarrboard.ch6.state",
    x: 73,
    y: 62,
    ampsPath: "electrical.switches.yarrboard.ch6.current",
    icon: "⚡",
  },
  {
    id: "yarrboard_7",
    label: "Ch 7",
    zone: "Spare",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch7.state",
    writePath: "electrical.switches.yarrboard.ch7.state",
    x: 73,
    y: 38,
    ampsPath: "electrical.switches.yarrboard.ch7.current",
    icon: "⚡",
  },
  {
    id: "yarrboard_8",
    label: "Ch 8",
    zone: "Spare",
    system: "yarrboard",
    readPath: "electrical.switches.yarrboard.ch8.state",
    writePath: "electrical.switches.yarrboard.ch8.state",
    x: 83,
    y: 62,
    ampsPath: "electrical.switches.yarrboard.ch8.current",
    icon: "⚡",
  },
]

const SYSTEM_CONFIG: Record<SwitchSystem, { label: string; color: string }> = {
  venus: { label: "Venus", color: "#00b1ff" },
  shelly: { label: "Shelly", color: "#00ff9d" },
  nodered: { label: "Node-RED", color: "#ff7f00" },
  yarrboard: { label: "Yarrboard", color: "#c084fc" },
}

interface SKValues {
  [path: string]: number | boolean | string | null
}

function useSignalK(paths: string[]): {
  values: SKValues
  connected: boolean
  sendPut: (path: string, value: boolean) => void
} {
  const [values, setValues] = useState<SKValues>({})
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(`ws://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/stream?subscribe=none`)
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        ws.send(
          JSON.stringify({
            context: "vessels.self",
            subscribe: paths.map((p) => ({ path: p, period: 1000, format: "full" })),
          }),
        )
      }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.updates) {
            const nv: SKValues = {}
            data.updates.forEach((u: { values?: { path: string; value: unknown }[] }) => {
              u.values?.forEach(({ path, value }) => {
                nv[path] = value as SKValues[string]
              })
            })
            setValues((prev) => ({ ...prev, ...nv }))
          }
        } catch {
          /* ignore */
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        setConnected(false)
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

  const sendPut = useCallback((path: string, value: boolean) => {
    fetch(`http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/api/vessels/self/${path.replace(/\./g, "/")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(() => {
      /* ignore */
    })
  }, [])

  return { values, connected, sendPut }
}

function getSwitchState(value: SKValues[string]): SwitchState {
  if (value === null || value === undefined) return "unknown"
  if (value === true || value === 1 || value === "true" || value === "on") return "on"
  if (value === false || value === 0 || value === "false" || value === "off") return "off"
  return "fault"
}

const STATE_COLORS: Record<SwitchState, string> = {
  on: "#00ff9d",
  off: "rgba(80,80,80,0.7)",
  fault: "#ff4040",
  unknown: "rgba(60,60,60,0.5)",
}

const TogglePopup = ({
  sw,
  state,
  amps,
  onToggle,
  onClose,
}: {
  sw: Switch
  state: SwitchState
  amps: number | null
  onToggle: () => void
  onClose: () => void
}) => {
  const sysCfg = SYSTEM_CONFIG[sw.system]
  const stColor = STATE_COLORS[state]
  const isOn = state === "on"
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,3,10,0.75)",
        backdropFilter: "blur(4px)",
        animation: "fadeOverlay 0.15s ease forwards",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg,rgba(0,10,24,0.98),rgba(0,20,45,0.98))",
          border: `1px solid ${sysCfg.color}40`,
          borderRadius: 12,
          padding: "22px 26px",
          width: 260,
          boxShadow: `0 16px 48px rgba(0,0,0,0.85),0 0 30px ${sysCfg.color}15`,
          animation: "popupIn 0.2s ease forwards",
          fontFamily: "'Share Tech Mono',monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 14, color: sysCfg.color, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              {sw.icon} {sw.label}
            </div>
            <div style={{ fontSize: 12, color: "rgba(0,210,255,0.38)", marginTop: 3 }}>
              {sw.zone} · {sysCfg.label}
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", color: "rgba(0,210,255,0.4)", fontSize: 16 }}>
            ✕
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(0,4,12,0.6)",
            border: `1px solid ${stColor}25`,
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: stColor,
              boxShadow: isOn ? `0 0 10px ${stColor},0 0 20px ${stColor}60` : "none",
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: stColor, letterSpacing: "0.05em" }}>
              {state.toUpperCase()}
            </div>
            {amps !== null && (
              <div style={{ fontSize: 12, color: "rgba(0,210,255,0.45)", marginTop: 1 }}>{amps.toFixed(1)} A</div>
            )}
          </div>
        </div>
        <button
          onClick={onToggle}
          style={{
            width: "100%",
            padding: "11px 0",
            borderRadius: 7,
            border: `1px solid ${isOn ? "#ff405060" : "#00ff9d60"}`,
            background: isOn
              ? "linear-gradient(135deg,rgba(40,0,0,0.8),rgba(60,0,0,0.8))"
              : "linear-gradient(135deg,rgba(0,40,20,0.8),rgba(0,60,30,0.8))",
            color: isOn ? "#ff8080" : "#00ff9d",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "'Share Tech Mono',monospace",
          }}
        >
          {isOn ? "Turn OFF" : "Turn ON"}
        </button>
        <div
          style={{
            marginTop: 14,
            fontSize: 11,
            color: "rgba(0,210,255,0.28)",
            wordBreak: "break-all",
            lineHeight: 1.6,
          }}
        >
          {sw.writePath}
        </div>
      </div>
    </div>
  )
}

const SwitchPin = ({
  sw,
  state,
  amps,
  onClick,
}: {
  sw: Switch
  state: SwitchState
  amps: number | null
  onClick: () => void
}) => {
  const sysCfg = SYSTEM_CONFIG[sw.system]
  const stColor = STATE_COLORS[state]
  const isOn = state === "on"
  const isFault = state === "fault"
  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        left: `${sw.x}%`,
        top: `${sw.y}%`,
        transform: "translate(-50%,-50%)",
        cursor: "pointer",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        animation: isFault ? "alertPulse 0.9s ease-in-out infinite" : "pinFadeIn 0.5s ease forwards",
      }}
    >
      <div style={{ position: "relative", width: 14, height: 14 }}>
        {isOn && (
          <div
            style={{
              position: "absolute",
              inset: -5,
              borderRadius: "50%",
              border: `1.5px solid ${stColor}`,
              animation: "ringExpand 2s ease-out infinite",
            }}
          />
        )}
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: stColor,
            boxShadow: isOn ? `0 0 8px ${stColor},0 0 18px ${stColor}55` : "none",
            border: `2px solid ${sysCfg.color}60`,
            transition: "all 0.25s",
          }}
        />
      </div>
      <div
        style={{
          background: isOn
            ? "linear-gradient(135deg,rgba(0,30,15,0.92),rgba(0,50,25,0.92))"
            : "linear-gradient(135deg,rgba(0,10,22,0.87),rgba(0,18,38,0.87))",
          border: `1px solid ${sysCfg.color}35`,
          borderRadius: 5,
          padding: "3px 7px",
          backdropFilter: "blur(10px)",
          textAlign: "center",
          minWidth: 80,
          boxShadow: isOn ? `0 0 12px ${stColor}30,0 2px 8px rgba(0,0,0,0.7)` : "0 1px 6px rgba(0,0,0,0.65)",
          transition: "all 0.25s",
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: sysCfg.color,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 1.5,
            whiteSpace: "nowrap",
            opacity: 0.7,
          }}
        >
          {sw.icon} {sw.label}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: stColor,
            fontFamily: "'Share Tech Mono',monospace",
            letterSpacing: "0.05em",
          }}
        >
          {state === "unknown" ? "—" : state.toUpperCase()}
        </div>
        {amps !== null && isOn && (
          <div style={{ fontSize: 12, color: "rgba(0,210,255,0.5)", marginTop: 1 }}>{amps.toFixed(1)}A</div>
        )}
      </div>
    </div>
  )
}

const DigitalSwitchingView = () => {
  const allPaths = [
    ...SWITCHES.map((s) => s.readPath),
    ...SWITCHES.filter((s) => s.ampsPath).map((s) => s.ampsPath as string),
  ]
  const { values, connected, sendPut } = useSignalK(allPaths)
  const [popup, setPopup] = useState<Switch | null>(null)
  const [filter, setFilter] = useState<SwitchSystem | "all">("all")

  const handleToggle = (sw: Switch) => {
    sendPut(sw.writePath, getSwitchState(values[sw.readPath] ?? null) !== "on")
    setPopup(null)
  }

  const visible = filter === "all" ? SWITCHES : SWITCHES.filter((s) => s.system === filter)
  const onCount = SWITCHES.filter((s) => getSwitchState(values[s.readPath] ?? null) === "on").length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes pinFadeIn { from{opacity:0;transform:translate(-50%,calc(-50% + 7px))} to{opacity:1;transform:translate(-50%,-50%)} }
        @keyframes alertPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.09)} }
        @keyframes ringExpand { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(2.6);opacity:0} }
        @keyframes fadeOverlay { from{opacity:0} to{opacity:1} }
        @keyframes popupIn { from{opacity:0;transform:scale(0.93) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes scanLine { from{top:0} to{top:100%} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
      `}</style>

      <div style={{ position: "relative", width: "100%", height: "100vh", background: "#000509", overflow: "hidden" }}>
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
              filter: "brightness(0.52) saturate(0.55) hue-rotate(188deg)",
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "radial-gradient(ellipse 88% 78% at 50% 50%, transparent 26%, rgba(0,3,10,0.84) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg,transparent,rgba(0,210,255,0.12) 40%,rgba(0,210,255,0.18) 50%,rgba(0,210,255,0.12) 60%,transparent)",
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
            background: "linear-gradient(180deg,rgba(0,3,10,0.96) 0%,transparent 100%)",
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
              Digital Switching
            </div>
            <div
              style={{
                fontSize: 18,
                fontFamily: "'Cinzel',serif",
                color: "#daf2ff",
                letterSpacing: "0.12em",
                marginTop: 1,
              }}
            >
              Dance Of The Spirits
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#00ff9d",
              letterSpacing: "0.2em",
              border: "1px solid rgba(0,255,157,0.3)",
              borderRadius: 4,
              padding: "3px 10px",
              background: "rgba(0,255,157,0.06)",
            }}
          >
            {onCount} / {SWITCHES.length} ON
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
            {connected ? "SIGNALK LIVE" : "CONNECTING..."}
          </div>
        </div>

        {/* Filter pills */}
        <div
          style={{
            position: "absolute",
            top: 52,
            left: 0,
            right: 0,
            zIndex: 30,
            display: "flex",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {(["all", "venus", "shelly", "nodered", "yarrboard"] as const).map((sys) => {
            const cfg = sys === "all" ? null : SYSTEM_CONFIG[sys]
            const color = cfg ? cfg.color : "#00d2ff"
            const label = cfg ? cfg.label : "All"
            const active = filter === sys
            return (
              <div
                key={sys}
                onClick={() => setFilter(sys)}
                style={{
                  fontSize: 12,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  padding: "3px 10px",
                  borderRadius: 3,
                  border: `1px solid ${active ? color + "80" : "rgba(100,100,100,0.2)"}`,
                  color: active ? color : "rgba(150,150,150,0.45)",
                  background: active ? `${color}10` : "transparent",
                  transition: "all 0.15s",
                }}
              >
                {label}
              </div>
            )
          })}
        </div>

        {/* Pins */}
        {visible.map((sw) => (
          <SwitchPin
            key={sw.id}
            sw={sw}
            state={getSwitchState(values[sw.readPath] ?? null)}
            amps={sw.ampsPath && values[sw.ampsPath] !== undefined ? (values[sw.ampsPath] as number) : null}
            onClick={() => setPopup(sw)}
          />
        ))}

        {/* Popup */}
        {popup && (
          <TogglePopup
            sw={popup}
            state={getSwitchState(values[popup.readPath] ?? null)}
            amps={popup.ampsPath && values[popup.ampsPath] !== undefined ? (values[popup.ampsPath] as number) : null}
            onToggle={() => handleToggle(popup)}
            onClose={() => setPopup(null)}
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
            background: "linear-gradient(0deg,rgba(0,3,10,0.96) 0%,transparent 100%)",
          }}
        >
          {(Object.entries(SYSTEM_CONFIG) as [SwitchSystem, (typeof SYSTEM_CONFIG)[SwitchSystem]][]).map(
            ([sys, cfg]) => (
              <div
                key={sys}
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
                {cfg.label}
              </div>
            ),
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, letterSpacing: "0.12em" }}>
            <span style={{ color: "#00ff9d" }}>● ON</span>
            <span style={{ color: "rgba(80,80,80,0.9)" }}>● OFF</span>
            <span style={{ color: "#ff4040" }}>● FAULT</span>
          </div>
        </div>
      </div>
    </>
  )
}

export default DigitalSwitchingView
