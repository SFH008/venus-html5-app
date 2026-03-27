/**
 * AlarmView.tsx
 * SignalK Notifications / Alarm panel for Marine2 dashboard.
 */

import React, { useState, useEffect, useCallback, useRef } from "react"
import { getConfig } from "../../config/AppConfig"

const cfg = getConfig()
const SK_HOST = `http://${cfg.signalkHost}:${cfg.signalkPort}`
const SK_WS = `ws://${cfg.signalkHost}:${cfg.signalkPort}/signalk/v1/stream?subscribe=none`
const NR_HOST = `http://${cfg.signalkHost}:${cfg.nodeRedPort}`

type AlarmState = "emergency" | "alarm" | "warn" | "alert" | "normal" | "nominal"
type AlarmSeverity = "none" | "warn" | "alarm" | "emergency"

interface NotifStatus {
  silenced: boolean
  acknowledged: boolean
  canSilence: boolean
  canAcknowledge: boolean
  canClear: boolean
}

interface Notification {
  id: string
  path: string
  state: AlarmState
  method: string[]
  message: string
  timestamp?: string
  status?: NotifStatus
}

const STATE_COLOR: Record<AlarmState, { text: string; bg: string; border: string; glow: string }> = {
  emergency: { text: "#ff4444", bg: "#1a0000", border: "#ff444488", glow: "0 0 12px #ff444466" },
  alarm: { text: "#f87171", bg: "#1e0808", border: "#f8717188", glow: "0 0 10px #f8717144" },
  warn: { text: "#fbbf24", bg: "#1e1508", border: "#fbbf2488", glow: "0 0 10px #fbbf2444" },
  alert: { text: "#fb923c", bg: "#1a1008", border: "#fb923c88", glow: "0 0 8px  #fb923c44" },
  normal: { text: "#4ade80", bg: "#0a1e0a", border: "#4ade8044", glow: "none" },
  nominal: { text: "#60a5fa", bg: "#0a1020", border: "#60a5fa44", glow: "none" },
}

const STATE_PRIORITY: Record<AlarmState, number> = {
  emergency: 0,
  alarm: 1,
  warn: 2,
  alert: 3,
  normal: 4,
  nominal: 5,
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600&display=swap');
  .av-root{width:100%;height:100%;background:#080e18;color:#c8d8e8;font-family:'Rajdhani',sans-serif;display:flex;flex-direction:column;overflow:hidden;position:relative}
  .av-root::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.08) 2px,rgba(0,0,0,.08) 4px);pointer-events:none;z-index:1}
  .av-content{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;padding:8px 10px 6px;gap:6px;overflow:hidden}
  .av-header{display:flex;align-items:center;gap:10px;flex-shrink:0;padding-bottom:6px;border-bottom:1px solid #1a3a5a}
  .av-title{font-family:'Cinzel',serif;font-size:20px;letter-spacing:.12em;color:#7eb8d4;text-transform:uppercase;flex:1}
  .av-badge{font-family:'Share Tech Mono',monospace;font-size:13px;padding:2px 8px;border-radius:3px;border:1px solid currentColor}
  .av-conn.ok{color:#4ade80;background:#0a1e0a;border-color:#4ade8033}
  .av-conn.err{color:#f87171;background:#1e0a0a;border-color:#f8717133}
  .av-count{background:#1a1a2e;border-color:#60a5fa44;color:#60a5fa}
  .av-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
  .av-list::-webkit-scrollbar{width:4px}
  .av-list::-webkit-scrollbar-track{background:#0a1218}
  .av-list::-webkit-scrollbar-thumb{background:#1a3a5a;border-radius:2px}
  .av-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#1a3a5a}
  .av-empty-icon{font-size:48px;opacity:.3}
  .av-empty-text{font-family:'Cinzel',serif;font-size:16px;letter-spacing:.2em;text-transform:uppercase}
  .av-card{border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;flex-shrink:0;transition:box-shadow .3s}
  .av-card-header{display:flex;align-items:flex-start;gap:8px}
  .av-state-pill{font-family:'Share Tech Mono',monospace;font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;border:1px solid currentColor;letter-spacing:.1em;white-space:nowrap;flex-shrink:0;margin-top:1px}
  .av-card-body{flex:1;min-width:0}
  .av-path{font-family:'Share Tech Mono',monospace;font-size:12px;color:#3a6a8a;letter-spacing:.04em;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .av-message{font-size:15px;font-weight:500;color:#c8d8e8;line-height:1.4}
  .av-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}
  .av-tag{font-family:'Share Tech Mono',monospace;font-size:11px;padding:1px 5px;border-radius:2px;border:1px solid}
  .av-tag.silenced{color:#60a5fa;background:#0a1020;border-color:#60a5fa44}
  .av-tag.acknowledged{color:#4ade80;background:#0a1e0a;border-color:#4ade8044}
  .av-tag.method{color:#4a7a9a;background:#0a1218;border-color:#1a3a5a}
  .av-ts{font-family:'Share Tech Mono',monospace;font-size:11px;color:#2a4a6a}
  .av-actions{display:flex;gap:5px;flex-wrap:wrap}
  .av-btn{padding:4px 10px;border-radius:3px;border:1px solid;cursor:pointer;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;transition:all .15s;background:transparent}
  .av-btn:disabled{opacity:.3;cursor:not-allowed}
  .av-btn.silence{color:#60a5fa;border-color:#60a5fa55}
  .av-btn.silence:hover:not(:disabled){background:#0a1020;border-color:#60a5faaa}
  .av-btn.acknowledge{color:#4ade80;border-color:#4ade8055}
  .av-btn.acknowledge:hover:not(:disabled){background:#0a1e0a;border-color:#4ade80aa}
  .av-btn.clear{color:#f87171;border-color:#f8717155}
  .av-btn.clear:hover:not(:disabled){background:#1e0a0a;border-color:#f87171aa}
  .av-btn.pending{opacity:.5}
  .av-filters{display:flex;gap:4px;flex-shrink:0}
  .av-filter{padding:3px 10px;border-radius:3px;border:1px solid #1a3a5a;background:transparent;cursor:pointer;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#3a6a8a;transition:all .15s}
  .av-filter.active{color:#7eb8d4;border-color:#2a5a8a;background:#0a1824}
  .av-filter:hover:not(.active){color:#5a8aaa;border-color:#1a4a6a}
  @keyframes pulseAlert{0%,100%{opacity:1}50%{opacity:.5}}
  .av-pulse{animation:pulseAlert 1.5s ease-in-out infinite}
`

function formatPath(path: string): string {
  return path.replace(/^notifications\./, "").replace(/\./g, " › ")
}

function formatTs(ts?: string): string {
  if (!ts) return ""
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ""
  }
}

function sortNotifs(list: Notification[]): Notification[] {
  return [...list].sort((a, b) => {
    const pa = STATE_PRIORITY[a.state] ?? 99
    const pb = STATE_PRIORITY[b.state] ?? 99
    if (pa !== pb) return pa - pb
    return (a.timestamp ?? "") > (b.timestamp ?? "") ? -1 : 1
  })
}

async function skAction(id: string, action: "silence" | "acknowledge" | "clear"): Promise<boolean> {
  try {
    const res = await fetch(`${SK_HOST}/signalk/v2/api/notifications/${id}/${action}`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) return true
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(`${NR_HOST}/alarm-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

function parseNotifTree(tree: any, prefix = "notifications"): Notification[] {
  const results: Notification[] = []
  if (!tree || typeof tree !== "object") return results
  if (tree.value && typeof tree.value === "object" && "state" in tree.value) {
    const v = tree.value
    results.push({
      id: v.id ?? prefix,
      path: prefix,
      state: v.state ?? "normal",
      method: Array.isArray(v.method) ? v.method : [],
      message: v.message ?? "",
      timestamp: v.timestamp ?? tree.timestamp,
      status: v.status,
    })
    return results
  }
  for (const key of Object.keys(tree)) {
    if (["value", "timestamp", "$source", "pgn", "src"].includes(key)) continue
    const child = tree[key]
    if (child && typeof child === "object") {
      results.push(...parseNotifTree(child, `${prefix}.${key}`))
    }
  }
  return results
}

function dispatchAlarmEvents(list: Notification[]) {
  const active = list.filter((n) => n.state !== "normal" && n.state !== "nominal")
  const activeCount = active.length
  const severity: AlarmSeverity = active.some((n) => n.state === "emergency")
    ? "emergency"
    : active.some((n) => n.state === "alarm")
      ? "alarm"
      : active.some((n) => n.state === "warn")
        ? "warn"
        : "none"
  const worstMessage = sortNotifs(active)[0]?.message ?? ""
  window.dispatchEvent(new CustomEvent("marine2_alarm_count", { detail: activeCount }))
  window.dispatchEvent(new CustomEvent("marine2_alarm_severity", { detail: { severity, message: worstMessage } }))
}

type FilterType = "all" | "active" | "emergency" | "alarm" | "warn"

const AlarmView: React.FC = () => {
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<FilterType>("active")
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifsRef = useRef<Map<string, Notification>>(new Map())

  const pollNotifs = useCallback(async () => {
    try {
      const res = await fetch(`${SK_HOST}/signalk/v1/api/vessels/self/notifications`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return
      const tree = await res.json()
      const list = parseNotifTree(tree)
      try {
        const res2 = await fetch(`${SK_HOST}/signalk/v2/api/notifications`, {
          signal: AbortSignal.timeout(3000),
        })
        if (res2.ok) {
          const v2data = await res2.json()
          if (Array.isArray(v2data)) {
            for (const n of list) {
              const v2 = v2data.find((x: any) => x.id === n.id || x.path === n.path)
              if (v2?.status) n.status = v2.status
              if (v2?.id) n.id = v2.id
            }
          }
        }
      } catch {
        /* v2 optional */
      }
      const map = new Map<string, Notification>()
      for (const n of list) map.set(n.path, n)
      notifsRef.current = map
      setNotifs(sortNotifs(list))
      dispatchAlarmEvents(list)
    } catch {
      /* ignore */
    }
  }, [])

  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }
    const ws = new WebSocket(SK_WS)
    wsRef.current = ws
    ws.onopen = () => {
      setConnected(true)
      ws.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: [{ path: "notifications.*", period: 1000, policy: "instant" }],
        }),
      )
    }
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (!msg.updates) return
        let changed = false
        for (const update of msg.updates)
          for (const val of update.values || []) if (val.path.startsWith("notifications.")) changed = true
        if (changed) pollNotifs()
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => setConnected(false)
    ws.onclose = () => {
      setConnected(false)
      reconnectRef.current = setTimeout(connectWs, 3000)
    }
  }, [pollNotifs])

  useEffect(() => {
    pollNotifs()
    const interval = setInterval(pollNotifs, 10000)
    connectWs()
    return () => {
      clearInterval(interval)
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connectWs, pollNotifs])

  const doAction = useCallback(
    async (notif: Notification, action: "silence" | "acknowledge" | "clear") => {
      const key = `${notif.path}-${action}`
      setPending((p) => ({ ...p, [key]: true }))
      await skAction(notif.id, action)
      await pollNotifs()
      setPending((p) => ({ ...p, [key]: false }))
    },
    [pollNotifs],
  )

  const filtered = notifs.filter((n) => {
    if (filter === "all") return true
    if (filter === "active") return n.state !== "normal" && n.state !== "nominal"
    return n.state === filter
  })

  const activeCount = notifs.filter((n) => n.state !== "normal" && n.state !== "nominal").length
  const hasEmergency = notifs.some((n) => n.state === "emergency")

  return (
    <>
      <style>{styles}</style>
      <div className="av-root">
        <div className="av-content">
          <div className="av-header">
            <div className={`av-title ${hasEmergency ? "av-pulse" : ""}`}>🔔 Alarms</div>
            <span className="av-badge av-count">{activeCount} active</span>
            <span className={`av-badge av-conn ${connected ? "ok" : "err"}`}>{connected ? "LIVE" : "OFFLINE"}</span>
          </div>

          <div className="av-filters">
            {(["active", "all", "emergency", "alarm", "warn"] as FilterType[]).map((f) => (
              <button key={f} className={`av-filter ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {f === "active" ? `Active (${activeCount})` : f}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="av-empty">
              <div className="av-empty-icon">✓</div>
              <div className="av-empty-text">{filter === "active" ? "No Active Alarms" : "No Alarms"}</div>
            </div>
          ) : (
            <div className="av-list">
              {filtered.map((notif) => {
                const sc = STATE_COLOR[notif.state] ?? STATE_COLOR.normal
                const isPulse = notif.state === "emergency" || notif.state === "alarm"
                const silKey = `${notif.path}-silence`
                const ackKey = `${notif.path}-acknowledge`
                const clrKey = `${notif.path}-clear`
                const canSilence = notif.status?.canSilence ?? false
                const canAcknowledge = notif.status?.canAcknowledge ?? false
                const canClear = notif.status?.canClear ?? false
                const isSilenced = notif.status?.silenced ?? false
                const isAcknowledged = notif.status?.acknowledged ?? false
                return (
                  <div
                    key={notif.path}
                    className={`av-card ${isPulse && !isAcknowledged ? "av-pulse" : ""}`}
                    style={{ background: sc.bg, border: `1px solid ${sc.border}`, boxShadow: sc.glow }}
                  >
                    <div className="av-card-header">
                      <span
                        className="av-state-pill"
                        style={{ color: sc.text, borderColor: sc.border, background: `${sc.bg}cc` }}
                      >
                        {notif.state.toUpperCase()}
                      </span>
                      <div className="av-card-body">
                        <div className="av-path">{formatPath(notif.path)}</div>
                        <div className="av-message" style={{ color: sc.text }}>
                          {notif.message || "—"}
                        </div>
                        <div className="av-meta">
                          {isSilenced && <span className="av-tag silenced">SILENCED</span>}
                          {isAcknowledged && <span className="av-tag acknowledged">ACKNOWLEDGED</span>}
                          {notif.method.map((m) => (
                            <span key={m} className="av-tag method">
                              {m}
                            </span>
                          ))}
                          {notif.timestamp && <span className="av-ts">{formatTs(notif.timestamp)}</span>}
                        </div>
                      </div>
                    </div>
                    {(canSilence || canAcknowledge || canClear) && (
                      <div className="av-actions">
                        {canSilence && !isSilenced && (
                          <button
                            className={`av-btn silence ${pending[silKey] ? "pending" : ""}`}
                            disabled={!!pending[silKey]}
                            onClick={() => doAction(notif, "silence")}
                          >
                            {pending[silKey] ? "…" : "🔇 Silence"}
                          </button>
                        )}
                        {canAcknowledge && !isAcknowledged && (
                          <button
                            className={`av-btn acknowledge ${pending[ackKey] ? "pending" : ""}`}
                            disabled={!!pending[ackKey]}
                            onClick={() => doAction(notif, "acknowledge")}
                          >
                            {pending[ackKey] ? "…" : "✓ Acknowledge"}
                          </button>
                        )}
                        {canClear && (
                          <button
                            className={`av-btn clear ${pending[clrKey] ? "pending" : ""}`}
                            disabled={!!pending[clrKey]}
                            onClick={() => doAction(notif, "clear")}
                          >
                            {pending[clrKey] ? "…" : "✕ Clear"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default AlarmView
