import React, { useEffect, useState, useRef, useCallback } from "react"
import boatLayout from "../../../images/jeanneau53.png"
import { getConfig } from "../../config/AppConfig"

const cfg = getConfig()
const SIGNALK_HOST = cfg.signalkHost
const SIGNALK_PORT = cfg.signalkPort
const MQTT_WS_URL = `ws://${cfg.signalkHost}:9001`
const MQTT_TOPIC = "marine2/switch/control"

// ─── Types ────────────────────────────────────────────────────────────────────
type SwitchSystem = "shelly" | "venus" | "yarrboard" | "nodered" | "waveshare"
type SwitchState = "on" | "off" | "unknown"

interface SwitchDef {
  id: string
  label: string
  zone: string
  system: SwitchSystem
  skPath: string
  x: number
  y: number
  icon: string
}

const SWITCHES: SwitchDef[] = [
  {
    id: "saloon_lights",
    label: "Saloon Light",
    zone: "Saloon",
    system: "shelly",
    skPath: "electrical.switches.shelly.saloonLights.state",
    x: 57,
    y: 38,
    icon: "💡",
  },
  {
    id: "fwd_cabin_light",
    label: "Fwd Cabin",
    zone: "Fwd Cabin",
    system: "shelly",
    skPath: "electrical.switches.shelly.fwdCabinLight.state",
    x: 83,
    y: 38,
    icon: "💡",
  },
  {
    id: "aft_cabin_light",
    label: "Aft Cabins",
    zone: "Aft Cabins",
    system: "shelly",
    skPath: "electrical.switches.shelly.aftCabinLight.state",
    x: 24,
    y: 50,
    icon: "💡",
  },
  {
    id: "cockpit_light",
    label: "Cockpit Light",
    zone: "Cockpit",
    system: "shelly",
    skPath: "electrical.switches.shelly.cockpitLight.state",
    x: 12,
    y: 38,
    icon: "💡",
  },
  {
    id: "nav_lights",
    label: "Nav Lights",
    zone: "Stern",
    system: "venus",
    skPath: "electrical.switches.venus.navLights.state",
    x: 7,
    y: 50,
    icon: "🔴",
  },
  {
    id: "anchor_light",
    label: "Anchor Light",
    zone: "Bow",
    system: "venus",
    skPath: "electrical.switches.venus.anchorLight.state",
    x: 92,
    y: 50,
    icon: "⚓",
  },
  {
    id: "masthead_light",
    label: "Masthead",
    zone: "Mast",
    system: "venus",
    skPath: "electrical.switches.venus.mastheadLight.state",
    x: 65,
    y: 50,
    icon: "🔦",
  },
  {
    id: "bilge_pump",
    label: "Bilge Pump",
    zone: "Bilge",
    system: "nodered",
    skPath: "electrical.switches.virtual.bilgePump.state",
    x: 50,
    y: 60,
    icon: "💧",
  },
  {
    id: "water_pump",
    label: "Water Pump",
    zone: "Engine",
    system: "nodered",
    skPath: "electrical.switches.virtual.waterPump.state",
    x: 44,
    y: 60,
    icon: "🚿",
  },
  {
    id: "ws_relay_1",
    label: "Relay 1",
    zone: "Relay Board",
    system: "waveshare",
    skPath: "electrical.switches.waveshare.relay1.state",
    x: 30,
    y: 20,
    icon: "⚡",
  },

  {
    id: "yarrboard_1",
    label: "Eng Blower",
    zone: "Engine Room",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch1.state",
    x: 38,
    y: 60,
    icon: "🌀",
  },
  {
    id: "yarrboard_2",
    label: "Fridge",
    zone: "Galley",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch2.state",
    x: 44,
    y: 28,
    icon: "❄️",
  },
  {
    id: "yarrboard_3",
    label: "Freezer",
    zone: "Galley",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch3.state",
    x: 38,
    y: 28,
    icon: "🧊",
  },
  {
    id: "yarrboard_4",
    label: "Ch 4",
    zone: "Spare",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch4.state",
    x: 57,
    y: 62,
    icon: "⚡",
  },
  {
    id: "yarrboard_5",
    label: "Ch 5",
    zone: "Spare",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch5.state",
    x: 65,
    y: 62,
    icon: "⚡",
  },
  {
    id: "yarrboard_6",
    label: "Ch 6",
    zone: "Spare",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch6.state",
    x: 73,
    y: 62,
    icon: "⚡",
  },
  {
    id: "yarrboard_7",
    label: "Ch 7",
    zone: "Spare",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch7.state",
    x: 73,
    y: 38,
    icon: "⚡",
  },
  {
    id: "yarrboard_8",
    label: "Ch 8",
    zone: "Spare",
    system: "yarrboard",
    skPath: "electrical.switches.yarrboard.ch8.state",
    x: 83,
    y: 62,
    icon: "⚡",
  },
]

const SYSTEM_CONFIG: Record<SwitchSystem, { label: string; color: string }> = {
  shelly: { label: "Shelly", color: "#00ff9d" },
  venus: { label: "Venus", color: "#00b1ff" },
  nodered: { label: "Node-RED", color: "#ff7f00" },
  yarrboard: { label: "Yarrboard", color: "#c084fc" },
  waveshare: { label: "Waveshare", color: "#f472b6" },
}

const STATE_COLORS: Record<SwitchState, string> = {
  on: "#00ff9d",
  off: "rgba(80,80,80,0.7)",
  unknown: "rgba(60,60,60,0.5)",
}

// ─── Minimal MQTT-over-WebSocket client ───────────────────────────────────────
// Implements just enough of MQTT 3.1.1 to publish — no external library needed
class MqttWsClient {
  private ws: WebSocket | null = null
  private connected = false
  private queue: Array<{ topic: string; payload: string }> = []
  private onConnectCb?: () => void
  private reconnectTimer?: ReturnType<typeof setTimeout>

  connect(url: string, onConnect?: () => void) {
    this.onConnectCb = onConnect
    this._connect(url)
  }

  private _connect(url: string) {
    try {
      this.ws = new WebSocket(url, ["mqtt"])
      this.ws.binaryType = "arraybuffer"

      this.ws.onopen = () => {
        const clientId = `marine2-${Math.random().toString(36).slice(2, 9)}`
        const cid = new TextEncoder().encode(clientId)

        const remainingLength = 10 + 2 + cid.length

        const payload = new Uint8Array(2 + remainingLength)

        let i = 0

        // Fixed header
        payload[i++] = 0x10 // CONNECT
        payload[i++] = remainingLength

        // Variable header
        payload[i++] = 0x00
        payload[i++] = 0x04
        payload[i++] = 0x4d
        payload[i++] = 0x51
        payload[i++] = 0x54
        payload[i++] = 0x54 // MQTT
        payload[i++] = 0x04 // protocol level
        payload[i++] = 0x02 // clean session
        payload[i++] = 0x00
        payload[i++] = 0x3c // keepalive

        // Payload (Client ID)
        payload[i++] = 0x00
        payload[i++] = cid.length

        payload.set(cid, i)

        this.ws!.send(payload)
      }

      this.ws.onmessage = (evt) => {
        const data = new Uint8Array(evt.data as ArrayBuffer)

        if (data[0] === 0x20 && data[1] === 0x02 && data[3] === 0x00) {
          // Proper CONNACK check
          this.connected = true
          this.onConnectCb?.()

          for (const msg of this.queue) {
            this._publish(msg.topic, msg.payload)
          }
          this.queue = []
        }
      }

      this.ws.onclose = () => {
        this.connected = false
        this.reconnectTimer = setTimeout(() => this._connect(url), 5000)
      }

      this.ws.onerror = () => this.ws?.close()
    } catch {
      this.reconnectTimer = setTimeout(() => this._connect(url), 5000)
    }
  }

  publish(topic: string, payload: string) {
    if (this.connected) {
      this._publish(topic, payload)
    } else {
      this.queue.push({ topic, payload })
    }
  }

  private _publish(topic: string, payload: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const enc = new TextEncoder()
    const t = enc.encode(topic)
    const p = enc.encode(payload)
    const remaining = 2 + t.length + p.length
    const packet = new Uint8Array(2 + remaining)
    packet[0] = 0x30 // PUBLISH, QoS 0
    packet[1] = remaining
    packet[2] = 0x00
    packet[3] = t.length
    packet.set(t, 4)
    packet.set(p, 4 + t.length)
    this.ws.send(packet)
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}

// ─── SignalK WebSocket hook ───────────────────────────────────────────────────
interface SKValues {
  [path: string]: number | boolean | string | null
}

function useSignalK(paths: string[]): { values: SKValues; connected: boolean } {
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

  return { values, connected }
}

function getSwitchState(value: SKValues[string]): SwitchState {
  if (value === null || value === undefined) return "unknown"
  if (value === true || value === 1 || value === "true" || value === "on") return "on"
  return "off"
}

// ─── Toggle Popup ─────────────────────────────────────────────────────────────
const TogglePopup = ({
  sw,
  state,
  pending,
  onToggle,
  onClose,
}: {
  sw: SwitchDef
  state: SwitchState
  pending: boolean
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
        background: "rgba(0,3,10,0.78)",
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
          width: 270,
          boxShadow: `0 16px 48px rgba(0,0,0,0.85),0 0 30px ${sysCfg.color}15`,
          animation: "popupIn 0.2s ease forwards",
          fontFamily: "'Share Tech Mono',monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
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
          <div style={{ fontSize: 22, fontWeight: 700, color: stColor, letterSpacing: "0.05em" }}>
            {state === "unknown" ? "NO DATA" : state.toUpperCase()}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={pending}
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
            cursor: pending ? "not-allowed" : "pointer",
            fontFamily: "'Share Tech Mono',monospace",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "SENDING…" : isOn ? "TURN OFF" : "TURN ON"}
        </button>
        <div style={{ marginTop: 12, fontSize: 11, color: "rgba(0,210,255,0.28)", letterSpacing: "0.1em" }}>
          via MQTT → Node-RED → {sysCfg.label}
        </div>
      </div>
    </div>
  )
}

// ─── Switch Pin ───────────────────────────────────────────────────────────────
const SwitchPin = ({ sw, state, onClick }: { sw: SwitchDef; state: SwitchState; onClick: () => void }) => {
  const sysCfg = SYSTEM_CONFIG[sw.system]
  const stColor = STATE_COLORS[state]
  const isOn = state === "on"
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
        animation: "pinFadeIn 0.5s ease forwards",
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
      </div>
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────
const DigitalSwitchingView = () => {
  const { values, connected } = useSignalK(SWITCHES.map((s) => s.skPath))
  const [popup, setPopup] = useState<SwitchDef | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<SwitchSystem | "all">("all")
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [mqttConn, setMqttConn] = useState(false)
  const mqttRef = useRef<MqttWsClient | null>(null)

  // Connect MQTT WebSocket
  useEffect(() => {
    const client = new MqttWsClient()
    mqttRef.current = client
    client.connect(MQTT_WS_URL, () => setMqttConn(true))
    return () => {
      client.disconnect()
      setMqttConn(false)
    }
  }, [])

  const handleToggle = useCallback(
    async (sw: SwitchDef) => {
      const current =
        optimistic[sw.id] !== undefined ? optimistic[sw.id] : getSwitchState(values[sw.skPath] ?? null) === "on"
      const next = !current

      setOptimistic((p) => ({ ...p, [sw.id]: next }))
      setPending((p) => ({ ...p, [sw.id]: true }))
      setPopup(null)

      // Publish to MQTT — Node-RED subscribes and acts
      mqttRef.current?.publish(MQTT_TOPIC, JSON.stringify({ id: sw.id, state: next }))

      // Clear pending after 3s (SK update will clear optimistic)
      setTimeout(() => setPending((p) => ({ ...p, [sw.id]: false })), 3000)
    },
    [values, optimistic],
  )

  // Clear optimistic once SK confirms
  useEffect(() => {
    setOptimistic((prev) => {
      const next = { ...prev }
      for (const sw of SWITCHES) {
        if (next[sw.id] !== undefined) {
          const skState = getSwitchState(values[sw.skPath] ?? null)
          const optState = next[sw.id] ? "on" : "off"
          if (skState === optState) delete next[sw.id]
        }
      }
      return next
    })
  }, [values])

  const getState = (sw: SwitchDef): SwitchState => {
    if (optimistic[sw.id] !== undefined) return optimistic[sw.id] ? "on" : "off"
    return getSwitchState(values[sw.skPath] ?? null)
  }

  const visible = filter === "all" ? SWITCHES : SWITCHES.filter((s) => s.system === filter)
  const onCount = SWITCHES.filter((s) => getState(s) === "on").length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes pinFadeIn { from{opacity:0;transform:translate(-50%,calc(-50% + 7px))} to{opacity:1;transform:translate(-50%,-50%)} }
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
          {/* Connection status */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {[
              { label: "SK", ok: connected },
              { label: "MQTT", ok: mqttConn },
            ].map(({ label, ok }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: ok ? "rgba(0,255,157,0.7)" : "rgba(255,80,80,0.7)",
                  letterSpacing: "0.15em",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: ok ? "#00ff9d" : "#ff5050",
                    boxShadow: ok ? "0 0 6px #00ff9d" : "0 0 6px #ff5050",
                    animation: ok ? "none" : "blink 1s ease infinite",
                  }}
                />
                {label}
              </div>
            ))}
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
          {(["all", "shelly", "venus", "nodered", "yarrboard"] as const).map((sys) => {
            const color = sys === "all" ? "#00d2ff" : SYSTEM_CONFIG[sys].color
            const label = sys === "all" ? "All" : SYSTEM_CONFIG[sys].label
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

        {visible.map((sw) => (
          <SwitchPin key={sw.id} sw={sw} state={getState(sw)} onClick={() => setPopup(sw)} />
        ))}

        {popup && (
          <TogglePopup
            sw={popup}
            state={getState(popup)}
            pending={!!pending[popup.id]}
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
          {(Object.entries(SYSTEM_CONFIG) as [SwitchSystem, (typeof SYSTEM_CONFIG)[SwitchSystem]][]).map(([sys, c]) => (
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
                  background: c.color,
                  boxShadow: `0 0 5px ${c.color}`,
                }}
              />
              {c.label}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, letterSpacing: "0.12em" }}>
            <span style={{ color: "#00ff9d" }}>● ON</span>
            <span style={{ color: "rgba(80,80,80,0.9)" }}>● OFF</span>
          </div>
        </div>
      </div>
    </>
  )
}

export default DigitalSwitchingView
