/**
 * WeatherView.tsx  —  Safety & Passage Planning (v4)
 *
 * Layout (1280×800):
 *   Row 1 — Sail Plan Monitor | Wind Shift Monitor | Squall Risk
 *   Row 2 — Trend Alarms      | Passage Safety     | Prognosis
 */

import React, { useState, useEffect, useCallback, useRef } from "react"
import { getConfig } from "../../config/AppConfig"

const _cfg = getConfig()
const SIGNALK_HOST = _cfg.signalkHost
const SIGNALK_PORT = _cfg.signalkPort
const SK_API_URL = `http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/api/vessels/self`
const NOTIF_PREFIX = _cfg.notifPrefix

const T = {
  reef1Kn: 20,
  reef1WatchKn: 18,
  reef2Kn: 25,
  reef2WatchKn: 23,
  reef3Kn: 30,
  stormJibKn: 40,
  sustainedMins: 5,
  shiftDeg: 25,
  shiftMins: 3,
  veerWatchDpm: 3,
  veerAlarmDpm: 8,
  veerMins: 5,
  reversalDeg: 150,
  reversalSecs: 90,
  twsWatchSlope: 0.3,
  twsAlarmSlope: 0.8,
  twsSlopeMins: 3,
  dirRateWatch: 5,
  dirRateAlarm: 15,
  pressWatchDrop: 2,
  pressAlarmDrop: 3,
  heelWatchDeg: 25,
  heelAlarmDeg: 35,
  heelWatchSecs: 30,
  heelAlarmSecs: 15,
  slamMs2: 8,
  slamsPerHour: 10,
  overpowerKn: 25,
  overpowerHeel: 25,
  overpowerKnFallback: 32,
}

const msToKn = (v: number) => Math.round(v * 1.94384 * 10) / 10
const radToDeg = (v: number) => Math.round(((v * 180) / Math.PI + 360) % 360)
const paToHpa = (v: number) => Math.round((v > 50000 ? v / 100 : v) * 10) / 10
const toRad = (d: number) => (d * Math.PI) / 180
const cirDiff = (a: number, b: number) => {
  let d = ((a - b + 540) % 360) - 180
  return d
}

function circMean(degs: number[]): number {
  if (!degs.length) return 0
  const s = degs.reduce((a, d) => a + Math.sin(toRad(d)), 0)
  const c = degs.reduce((a, d) => a + Math.cos(toRad(d)), 0)
  return ((Math.atan2(s / degs.length, c / degs.length) * 180) / Math.PI + 360) % 360
}

function linSlope(pts: { x: number; y: number }[]): number {
  if (pts.length < 2) return 0
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const num = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  return den === 0 ? 0 : num / den
}

type AlarmLevel = "OK" | "WATCH" | "ALARM"
interface AlarmState {
  level: AlarmLevel
  since: number
  clearSince: number
}
const HYSTERESIS_MS = 30000

function tickAlarm(current: AlarmState, triggered: boolean, thresholdMs: number, now: number): AlarmState {
  if (triggered) {
    if (current.level === "OK") {
      const since = current.since || now
      if (now - since >= thresholdMs) return { level: "ALARM", since, clearSince: 0 }
      return { ...current, since, clearSince: 0 }
    }
    return { ...current, clearSince: 0 }
  } else {
    if (current.level === "OK") return current
    const clearSince = current.clearSince || now
    if (now - clearSince >= HYSTERESIS_MS) return { level: "OK", since: 0, clearSince: 0 }
    return { ...current, clearSince }
  }
}

function twoLevelAlarm(
  current: AlarmState,
  watch: boolean,
  alarm: boolean,
  watchMs: number,
  alarmMs: number,
  now: number,
): AlarmState {
  if (alarm) {
    const since = current.since || now
    if (now - since >= alarmMs) return { level: "ALARM", since, clearSince: 0 }
    if (now - since >= 0) return { level: "WATCH", since, clearSince: 0 }
    return current
  }
  if (watch) {
    const since = current.since || now
    if (now - since >= watchMs) return { level: "WATCH", since, clearSince: 0 }
    return { ...current, since, clearSince: 0 }
  }
  if (current.level === "OK") return current
  const clearSince = current.clearSince || now
  if (now - clearSince >= HYSTERESIS_MS) return { level: "OK", since: 0, clearSince: 0 }
  return { ...current, clearSince }
}

const lastNotifFired = new Map<string, number>()
interface AlarmMeta {
  zone: string
  state: string
}
const ALARM_META: Record<string, AlarmMeta> = {
  "sustained-wind": { zone: "all", state: "alarm" },
  "wind-shift": { zone: "helm", state: "warn" },
  "veer-back": { zone: "helm", state: "warn" },
  reversal: { zone: "all", state: "alarm" },
  "tws-trend": { zone: "helm", state: "warn" },
  "dir-rate": { zone: "helm", state: "warn" },
  "baro-combined": { zone: "all", state: "alarm" },
  heel: { zone: "all", state: "alarm" },
  slam: { zone: "helm", state: "warn" },
  overpowered: { zone: "all", state: "emergency" },
}

function skNotifPut(id: string, value: object) {
  const path = NOTIF_PREFIX.split(".").join("/")
  fetch(`${SK_API_URL}/${path}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => {})
}

function fireAudio(id: string, message: string) {
  const last = lastNotifFired.get(id) ?? 0
  if (Date.now() - last < 60000) return
  lastNotifFired.set(id, Date.now())
  const meta = ALARM_META[id] ?? { zone: "helm", state: "warn" }
  skNotifPut(id, {
    state: meta.state,
    method: ["sound", "visual"],
    message,
    zone: meta.zone,
    source: "marine2.weather",
    timestamp: new Date().toISOString(),
  })
}

function clearAudio(id: string) {
  skNotifPut(id, {
    state: "normal",
    method: [],
    message: "",
    zone: "none",
    source: "marine2.weather",
    timestamp: new Date().toISOString(),
  })
}

const SK_PATHS = [
  "environment.wind.speedTrue",
  "environment.wind.angleTrue",
  "environment.wind.directionTrue",
  "environment.wind.directionMagnetic",
  "environment.wind.speedApparent",
  "environment.wind.angleApparent",
  "navigation.headingTrue",
  "navigation.attitude",
  "environment.outside.pressure",
  "environment.venus.29.accelerationX",
  "environment.venus.29.accelerationY",
  "environment.venus.29.accelerationZ",
  "environment.outside.pressure.prediction.season",
  "environment.outside.pressure.prediction.front.prognose",
  "environment.outside.pressure.system",
  "environment.outside.pressure.prediction.front.wind",
  "environment.outside.pressure.prediction.quadrant",
]

interface Prognosis {
  season: string | null
  frontPrognose: string | null
  system: string | null
  frontWind: string | null
  quadrant: string | null
}
interface PressureSample {
  t: number
  hpa: number
}
interface WindSample {
  t: number
  tws: number
  twd: number
}
interface AttitudeSample {
  roll: number
  pitch: number
}
interface AccelSample {
  x: number
  y: number
  z: number
  t: number
}

async function fetchSkHistory(path: string, durationMs: number): Promise<[string, number][]> {
  const to = new Date().toISOString()
  const from = new Date(Date.now() - durationMs).toISOString()
  const body = { context: "vessels.self", range: { from, to }, values: [{ path, method: "average" }] }
  const res = await fetch(`http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v2/api/history/values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`History API ${res.status}`)
  const json = await res.json()
  return json.data ?? []
}

async function bootPressureHistory(): Promise<PressureSample[]> {
  const data = await fetchSkHistory("environment.outside.pressure", 3 * 3600 * 1000)
  const byMin = new Map<number, number[]>()
  for (const [ts, val] of data) {
    const k = Math.floor(new Date(ts).getTime() / 60000)
    if (!byMin.has(k)) byMin.set(k, [])
    byMin.get(k)!.push(val)
  }
  return Array.from(byMin.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([min, vals]) => ({
      t: min * 60000,
      hpa: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
    }))
}

const SQUALL_ARC = [
  { from: 0, to: 0.3, color: "#22c55e" },
  { from: 0.3, to: 0.6, color: "#f59e0b" },
  { from: 0.6, to: 0.8, color: "#f97316" },
  { from: 0.8, to: 1.0, color: "#ef4444" },
]

const MONO = "'Share Tech Mono', monospace"
const C = {
  bg: "#000509",
  panel: "rgba(0,8,20,0.88)",
  border: "rgba(0,210,255,0.08)",
  accent: "rgba(0,210,255,0.45)",
  text: "#e8f8ff",
  dim: "rgba(200,220,255,0.55)",
  faint: "rgba(200,220,255,0.3)",
  ok: "#22c55e",
  watch: "#f59e0b",
  alarm: "#ef4444",
}

const LEVEL_COLOR: Record<AlarmLevel, string> = { OK: C.ok, WATCH: C.watch, ALARM: C.alarm }
const LEVEL_BG: Record<AlarmLevel, string> = {
  OK: "rgba(34,197,94,0.06)",
  WATCH: "rgba(245,158,11,0.10)",
  ALARM: "rgba(239,68,68,0.14)",
}
const LEVEL_BORDER: Record<AlarmLevel, string> = {
  OK: "rgba(34,197,94,0.15)",
  WATCH: "rgba(245,158,11,0.30)",
  ALARM: "rgba(239,68,68,0.50)",
}

const ConnDot = ({ live }: { live: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.dim, letterSpacing: "0.15em" }}>
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
    SIGNALK {live ? "LIVE" : "…"}
  </div>
)

const Panel = ({
  title,
  children,
  alarmLevel,
  style,
}: {
  title: string
  children: React.ReactNode
  alarmLevel?: AlarmLevel
  style?: React.CSSProperties
}) => {
  const borderColor = alarmLevel && alarmLevel !== "OK" ? LEVEL_BORDER[alarmLevel] : "rgba(0,210,255,0.08)"
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "border-color 0.4s",
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: C.accent,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          marginBottom: 6,
          paddingBottom: 5,
          borderBottom: "1px solid rgba(0,210,255,0.08)",
          flexShrink: 0,
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
    </div>
  )
}

// ── AlarmRow — increased value font, tighter padding ─────────────────────────
const AlarmRow = ({
  label,
  level,
  value,
  sub,
  spark,
}: {
  label: string
  level: AlarmLevel
  value: string
  sub?: string
  spark?: number[]
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "5px 8px",
      marginBottom: 4,
      borderRadius: 6,
      background: LEVEL_BG[level],
      border: `1px solid ${LEVEL_BORDER[level]}`,
      flex: 1,
    }}
  >
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: LEVEL_COLOR[level],
        boxShadow: level === "ALARM" ? `0 0 6px ${C.alarm}` : "none",
        flexShrink: 0,
      }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.dim, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: LEVEL_COLOR[level], fontFamily: MONO }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>}
    </div>
    {spark && spark.length > 1 && (
      <svg width={60} height={24} style={{ flexShrink: 0 }}>
        {(() => {
          const min = Math.min(...spark)
          const max = Math.max(...spark)
          const range = max - min || 1
          const pts = spark
            .map((v, i) => `${(i / (spark.length - 1)) * 58 + 1},${22 - ((v - min) / range) * 20}`)
            .join(" ")
          return <polyline points={pts} fill="none" stroke={LEVEL_COLOR[level]} strokeWidth="1.5" strokeOpacity="0.7" />
        })()}
      </svg>
    )}
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: LEVEL_COLOR[level],
        fontFamily: MONO,
        background: LEVEL_BG[level],
        padding: "2px 6px",
        borderRadius: 4,
        flexShrink: 0,
      }}
    >
      {level}
    </div>
  </div>
)

// ── Sail Plan ─────────────────────────────────────────────────────────────────
function getSailPlan(tws: number | null): { state: string; color: string; next: number | null } {
  if (tws === null) return { state: "NO DATA", color: C.faint, next: null }
  if (tws < T.reef1WatchKn) return { state: "FULL SAIL", color: C.ok, next: T.reef1WatchKn }
  if (tws < T.reef1Kn) return { state: "WATCH 1ST", color: C.watch, next: T.reef1Kn }
  if (tws < T.reef2WatchKn) return { state: "1ST REEF", color: "#fb923c", next: T.reef2WatchKn }
  if (tws < T.reef2Kn) return { state: "WATCH 2ND", color: C.watch, next: T.reef2Kn }
  if (tws < T.reef3Kn) return { state: "2ND REEF", color: "#f97316", next: T.reef3Kn }
  if (tws < T.stormJibKn) return { state: "3RD REEF", color: C.alarm, next: T.stormJibKn }
  return { state: "STORM JIB", color: "#7c3aed", next: null }
}

const SailPlanMonitor = ({
  tws,
  twsBuf,
  sustainedAlarm,
}: {
  tws: number | null
  twsBuf: number[]
  sustainedAlarm: AlarmState
}) => {
  const plan = getSailPlan(tws)
  const bands = [
    { from: 0, to: T.reef1Kn, color: C.ok, label: "Full sail" },
    { from: T.reef1Kn, to: T.reef2Kn, color: "#fb923c", label: "1st reef" },
    { from: T.reef2Kn, to: T.reef3Kn, color: C.alarm, label: "2nd reef" },
    { from: T.reef3Kn, to: T.stormJibKn, color: "#7c3aed", label: "3rd reef" },
    { from: T.stormJibKn, to: 55, color: "#450a0a", label: "Storm jib" },
  ]
  const maxKn = 55
  const barH = 110
  const barW = 16
  const sustainedTarget = T.sustainedMins * 60 * 1000
  const elapsed = sustainedAlarm.since ? Math.min(Date.now() - sustainedAlarm.since, sustainedTarget) : 0
  const sustainedPct = sustainedAlarm.since ? elapsed / sustainedTarget : 0
  const elapsedMins = Math.floor(elapsed / 60000)
  const elapsedSecs = Math.floor((elapsed % 60000) / 1000)

  return (
    <div style={{ display: "flex", gap: 10, height: "100%" }}>
      {/* Threshold bar — reduced height */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em" }}>kn</div>
        <svg width={barW + 40} height={barH}>
          {bands.map((b) => {
            const y1 = barH - (b.to / maxKn) * barH
            const y2 = barH - (b.from / maxKn) * barH
            return (
              <g key={b.label}>
                <rect x={0} y={y1} width={barW} height={y2 - y1} fill={b.color} opacity={0.5} rx={2} />
                <text x={barW + 4} y={(y1 + y2) / 2 + 4} fontSize={8} fill={C.faint} fontFamily={MONO}>
                  {b.from}
                </text>
              </g>
            )
          })}
          {tws !== null && (
            <g>
              <line
                x1={0}
                x2={barW}
                y1={barH - (tws / maxKn) * barH}
                y2={barH - (tws / maxKn) * barH}
                stroke="#ffffff"
                strokeWidth={2}
              />
              <polygon
                points={`${barW},${barH - (tws / maxKn) * barH - 4} ${barW + 8},${barH - (tws / maxKn) * barH} ${barW},${barH - (tws / maxKn) * barH + 4}`}
                fill={plan.color}
              />
            </g>
          )}
        </svg>
      </div>
      {/* Main info */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{
            textAlign: "center",
            padding: "7px 4px",
            borderRadius: 8,
            background: `${plan.color}18`,
            border: `1px solid ${plan.color}55`,
          }}
        >
          <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.2em" }}>SAIL PLAN</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: plan.color, fontFamily: MONO, letterSpacing: "0.05em" }}>
            {plan.state}
          </div>
          {plan.next && <div style={{ fontSize: 10, color: C.faint }}>next: {plan.next} kn</div>}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "4px 6px",
            background: "rgba(0,0,0,0.3)",
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 11, color: C.dim }}>TWS</span>
          <span style={{ fontSize: 26, fontWeight: 700, color: "#e8f8ff", fontFamily: MONO }}>
            {tws !== null ? tws.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: C.faint }}>kn</span>
        </div>
        {twsBuf.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 6px" }}>
            <span style={{ fontSize: 11, color: C.faint }}>2 min max</span>
            <span style={{ fontSize: 14, color: C.watch, fontFamily: MONO }}>
              {Math.max(...twsBuf.slice(-24)).toFixed(1)} kn
            </span>
          </div>
        )}
        <div style={{ marginTop: "auto" }}>
          <div
            style={{ fontSize: 9, color: C.faint, marginBottom: 3, display: "flex", justifyContent: "space-between" }}
          >
            <span>SUSTAINED {T.sustainedMins}MIN</span>
            {sustainedAlarm.since > 0 && (
              <span style={{ color: sustainedAlarm.level === "ALARM" ? C.alarm : C.watch }}>
                {elapsedMins}:{elapsedSecs.toString().padStart(2, "0")} / {T.sustainedMins}:00
              </span>
            )}
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${sustainedPct * 100}%`,
                background:
                  sustainedAlarm.level === "ALARM" ? C.alarm : sustainedAlarm.level === "WATCH" ? C.watch : C.ok,
                borderRadius: 3,
                transition: "width 1s linear, background 0.4s",
              }}
            />
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              color: LEVEL_COLOR[sustainedAlarm.level],
              textAlign: "right",
              fontFamily: MONO,
            }}
          >
            {sustainedAlarm.level}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Wind Shift Monitor — compass reduced to 120px, values enlarged ────────────
const WindShiftMonitor = ({
  twdBuf,
  shiftAlarm,
  veerAlarm,
  reversalAlarm,
  trend,
}: {
  twdBuf: number[]
  shiftAlarm: AlarmState
  veerAlarm: AlarmState
  reversalAlarm: AlarmState
  trend: { deg: number; label: string; slope: number }
}) => {
  const CX = 60
  const CY = 60
  const R = 48
  const SIZE = 120
  const recentDirs = twdBuf.slice(-20)
  const currentDir = recentDirs[recentDirs.length - 1] ?? 0
  const meanDir = circMean(recentDirs)
  const shiftMag = recentDirs.length > 5 ? Math.round(cirDiff(currentDir, meanDir)) : null

  return (
    <div style={{ display: "flex", gap: 8, height: "100%" }}>
      <div style={{ flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE}>
          <circle cx={CX} cy={CY} r={R} fill="rgba(0,4,12,0.8)" stroke="rgba(0,210,255,0.12)" strokeWidth={1} />
          {[
            ["N", 0],
            ["E", 90],
            ["S", 180],
            ["W", 270],
          ].map(([l, d]) => {
            const a = toRad(Number(d) - 90)
            return (
              <text
                key={l as string}
                x={CX + (R - 9) * Math.cos(a)}
                y={CY + (R - 9) * Math.sin(a)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fill={l === "N" ? "#e44" : C.dim}
                fontFamily={MONO}
              >
                {l}
              </text>
            )
          })}
          {recentDirs.map((d, i) => {
            const a = toRad(d - 90)
            const opacity = 0.15 + (i / recentDirs.length) * 0.6
            const r2 = R - 16
            return (
              <circle
                key={i}
                cx={CX + r2 * Math.cos(a)}
                cy={CY + r2 * Math.sin(a)}
                r={2.5}
                fill="#00d2ff"
                opacity={opacity}
              />
            )
          })}
          {recentDirs.length > 0 &&
            (() => {
              const a = toRad(meanDir - 90)
              const r2 = R - 18
              return (
                <line
                  x1={CX}
                  y1={CY}
                  x2={CX + r2 * Math.cos(a)}
                  y2={CY + r2 * Math.sin(a)}
                  stroke={C.watch}
                  strokeWidth={1.5}
                  strokeDasharray="3,3"
                  strokeOpacity={0.7}
                />
              )
            })()}
          {(() => {
            const a = toRad(currentDir - 90)
            const r2 = R - 12
            return (
              <>
                <line
                  x1={CX}
                  y1={CY}
                  x2={CX + r2 * Math.cos(a)}
                  y2={CY + r2 * Math.sin(a)}
                  stroke="#e8f8ff"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle cx={CX} cy={CY} r={3} fill="#e8f8ff" />
              </>
            )
          })()}
          <text x={CX} y={CY + R + 9} textAnchor="middle" fontSize={10} fill={C.dim} fontFamily={MONO}>
            {Math.round(currentDir)}°
          </text>
        </svg>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ padding: "4px 6px", background: "rgba(0,0,0,0.3)", borderRadius: 6, marginBottom: 2 }}>
          <div style={{ fontSize: 9, color: C.faint }}>SHIFT FROM 5-MIN MEAN</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: shiftAlarm.level !== "OK" ? LEVEL_COLOR[shiftAlarm.level] : C.text,
              fontFamily: MONO,
            }}
          >
            {shiftMag !== null ? `${shiftMag > 0 ? "+" : ""}${shiftMag}°` : "—"}
          </div>
        </div>
        <div style={{ padding: "4px 6px", background: "rgba(0,0,0,0.3)", borderRadius: 6, marginBottom: 2 }}>
          <div style={{ fontSize: 9, color: C.faint }}>TREND</div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: veerAlarm.level !== "OK" ? LEVEL_COLOR[veerAlarm.level] : C.dim,
              fontFamily: MONO,
            }}
          >
            {trend.label} {Math.abs(trend.slope).toFixed(1)}°/min
          </div>
        </div>
        <AlarmRow
          label="Persistent shift"
          level={shiftAlarm.level}
          value={shiftMag !== null ? `${Math.abs(shiftMag)}°` : "—"}
          sub={`>${T.shiftDeg}° for ${T.shiftMins}min`}
        />
        <AlarmRow
          label="Backing / Veering"
          level={veerAlarm.level}
          value={trend.label}
          sub={`slope ${trend.slope.toFixed(1)}°/min`}
        />
        <AlarmRow
          label="180° Reversal"
          level={reversalAlarm.level}
          value={reversalAlarm.level === "ALARM" ? "SQUALL PASSING" : "OK"}
          sub={`>${T.reversalDeg}° in ${T.reversalSecs}s`}
        />
      </div>
    </div>
  )
}

// ── Squall Risk ───────────────────────────────────────────────────────────────
const arcPath = (cx: number, cy: number, r: number, startDeg: number, endDeg: number) => {
  const s = toRad(startDeg)
  const e = toRad(endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`
}
const ARC_START = -210
const ARC_END = 30
const ARC_SPAN = ARC_END - ARC_START

interface SquallState {
  score: number
  pressureSlope: number | null
  windVariation: number | null
  risk: string
}

const SquallArcGauge = ({ squall }: { squall: SquallState }) => {
  const SIZE = 150
  const CX = SIZE / 2
  const CY = SIZE / 2 + 8
  const R = 58
  const RISK_COLOR: Record<string, string> = { LOW: C.ok, MODERATE: C.watch, HIGH: "#f97316", IMMINENT: C.alarm }
  const riskColor = RISK_COLOR[squall.risk] ?? C.ok
  const needleDeg = ARC_START + squall.score * ARC_SPAN
  const na = toRad(needleDeg)
  const nr = R - 8
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center" }}>
      <svg width={SIZE} height={SIZE - 10}>
        {SQUALL_ARC.map((seg, i) => (
          <path
            key={i}
            d={arcPath(CX, CY, R, ARC_START + seg.from * ARC_SPAN, ARC_START + seg.to * ARC_SPAN)}
            fill="none"
            stroke={seg.color}
            strokeWidth={10}
            strokeOpacity={0.5}
            strokeLinecap="butt"
          />
        ))}
        <path
          d={arcPath(CX, CY, R, ARC_START, needleDeg)}
          fill="none"
          stroke={riskColor}
          strokeWidth={10}
          strokeOpacity={0.9}
          strokeLinecap="butt"
        />
        <line
          x1={CX}
          y1={CY}
          x2={CX + nr * Math.cos(na)}
          y2={CY + nr * Math.sin(na)}
          stroke="#e8f8ff"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={5} fill="#1a2030" stroke={riskColor} strokeWidth={2} />
        <text x={CX} y={CY - 18} textAnchor="middle" fontSize={18} fontWeight="700" fill={riskColor} fontFamily={MONO}>
          {squall.risk}
        </text>
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={13} fill={C.dim} fontFamily={MONO}>
          {Math.round(squall.score * 100)}%
        </text>
      </svg>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: MONO }}>
          <span style={{ color: C.faint }}>ΔP/h</span>
          <span style={{ color: squall.pressureSlope !== null && squall.pressureSlope < -1 ? C.alarm : C.dim }}>
            {squall.pressureSlope !== null ? `${squall.pressureSlope > 0 ? "+" : ""}${squall.pressureSlope}` : "—"} hPa
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontFamily: MONO }}>
          <span style={{ color: C.faint }}>Dir Var</span>
          <span style={{ color: squall.windVariation !== null && squall.windVariation > 10 ? C.watch : C.dim }}>
            {squall.windVariation !== null ? `${squall.windVariation}°` : "—"}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Trend Alarms ──────────────────────────────────────────────────────────────
const TrendAlarms = ({
  twsAlarm,
  dirAlarm,
  baroAlarm,
  twsSlope,
  dirRate,
  pressSlope3h,
  twsSpark,
  dirSpark,
  pressSpark,
}: {
  twsAlarm: AlarmState
  dirAlarm: AlarmState
  baroAlarm: AlarmState
  twsSlope: number
  dirRate: number
  pressSlope3h: number | null
  twsSpark: number[]
  dirSpark: number[]
  pressSpark: number[]
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
    <AlarmRow
      label="Wind Speed Trend"
      level={twsAlarm.level}
      value={`${twsSlope >= 0 ? "+" : ""}${twsSlope.toFixed(1)} kn/min`}
      sub="15-min regression"
      spark={twsSpark}
    />
    <AlarmRow
      label="Rapid Direction Change"
      level={dirAlarm.level}
      value={`${dirRate.toFixed(0)}°/min`}
      sub="30-sec rate of change"
      spark={dirSpark}
    />
    <AlarmRow
      label="Baro + Wind Combined"
      level={baroAlarm.level}
      value={
        pressSlope3h !== null ? `${pressSlope3h >= 0 ? "+" : ""}${pressSlope3h.toFixed(1)} hPa/3h` : "No pressure data"
      }
      sub={
        baroAlarm.level === "ALARM"
          ? "⚠ DETERIORATING CONDITIONS"
          : `alarm: <−${T.pressAlarmDrop} hPa/3h + rising wind`
      }
      spark={pressSpark}
    />
  </div>
)

// ── Passage Safety ────────────────────────────────────────────────────────────
const PassageSafety = ({
  heelAlarm,
  slamAlarm,
  overpowerAlarm,
  roll,
  slamsPerHour,
  tws,
}: {
  heelAlarm: AlarmState
  slamAlarm: AlarmState
  overpowerAlarm: AlarmState
  roll: number | null
  slamsPerHour: number
  tws: number | null
}) => {
  const rollDeg = roll !== null ? Math.round(Math.abs((roll * 180) / Math.PI) * 10) / 10 : null
  const heelSide = roll !== null ? (roll > 0 ? "SB" : "PORT") : null
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
      <AlarmRow
        label="Heel Angle"
        level={heelAlarm.level}
        value={rollDeg !== null ? `${rollDeg}° ${heelSide}` : "No IMU"}
        sub={
          rollDeg !== null ? `Alarm: >${T.heelAlarmDeg}° for ${T.heelAlarmSecs}s` : "navigation.attitude unavailable"
        }
      />
      <AlarmRow
        label="Slamming / Acceleration"
        level={slamAlarm.level}
        value={`${Math.round(slamsPerHour)} slams/hr`}
        sub={`Alarm: >${T.slamsPerHour}/hr  (>${T.slamMs2} m/s² deviation)`}
      />
      <AlarmRow
        label="Overpowered"
        level={overpowerAlarm.level}
        value={
          rollDeg !== null ? `TWS ${tws?.toFixed(1) ?? "—"} kn  Heel ${rollDeg}°` : `TWS ${tws?.toFixed(1) ?? "—"} kn`
        }
        sub={
          rollDeg !== null
            ? `Alarm: >${T.overpowerKn} kn + >${T.overpowerHeel}° heel`
            : `Alarm: >${T.overpowerKnFallback} kn (no heel sensor)`
        }
      />
    </div>
  )
}

// ── Prognosis ─────────────────────────────────────────────────────────────────
const PrognosisPanel = ({ prognosis }: { prognosis: Prognosis }) => {
  const rows = [
    { label: "Season", value: prognosis.season },
    { label: "Prognose", value: prognosis.frontPrognose },
    { label: "System", value: prognosis.system },
    { label: "Front Wind", value: prognosis.frontWind },
    { label: "Quadrant", value: prognosis.quadrant },
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, height: "100%" }}>
      {rows.map(({ label, value }) => (
        <div
          key={label}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "4px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: C.accent,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: value ? "#e8f8ff" : C.faint,
              fontFamily: MONO,
              letterSpacing: "0.04em",
              lineHeight: 1.3,
            }}
          >
            {value ?? "—"}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Hook ─────────────────────────────────────────────────────────────────
function useWeatherSignalK() {
  const [connected, setConnected] = useState(false)
  const [tws, setTws] = useState<number | null>(null)
  const [prognosis, setPrognosis] = useState<Prognosis>({
    season: null,
    frontPrognose: null,
    system: null,
    frontWind: null,
    quadrant: null,
  })
  const [squall, setSquall] = useState<SquallState>({ score: 0, pressureSlope: null, windVariation: null, risk: "LOW" })
  const [twsBuf, setTwsBuf] = useState<number[]>([])
  const [sustainedAlarm, setSustainedAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [twdBuf, setTwdBuf] = useState<number[]>([])
  const [shiftAlarm, setShiftAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [veerAlarm, setVeerAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [reversalAlarm, setReversalAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [windTrend, setWindTrend] = useState<{ deg: number; label: string; slope: number }>({
    deg: 0,
    label: "Steady",
    slope: 0,
  })
  const [twsAlarm, setTwsAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [dirAlarm, setDirAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [baroAlarm, setBaroAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [twsSlope, setTwsSlope] = useState(0)
  const [dirRate, setDirRate] = useState(0)
  const [pressSlope3h, setPressSlope3h] = useState<number | null>(null)
  const [twsSpark, setTwsSpark] = useState<number[]>([])
  const [dirSpark, setDirSpark] = useState<number[]>([])
  const [pressSpark, setPressSpark] = useState<number[]>([])
  const [heelAlarm, setHeelAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [slamAlarm, setSlamAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [overpowerAlarm, setOverpowerAlarm] = useState<AlarmState>({ level: "OK", since: 0, clearSince: 0 })
  const [roll, setRoll] = useState<number | null>(null)
  const [slamsPerHrState, setSlamsPerHrState] = useState(0)

  const buf = useRef<Record<string, number>>({})
  const strBuf = useRef<Record<string, string>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const histBooted = useRef(false)
  const twsBufRef = useRef<WindSample[]>([])
  const pressRef = useRef<PressureSample[]>([])
  const attBufRef = useRef<AttitudeSample[]>([])
  const accelBufRef = useRef<AccelSample[]>([])
  const prevAlarmLevels = useRef<Record<string, AlarmLevel>>({})

  function handleAudioTransition(id: string, newLevel: AlarmLevel, message: string) {
    const prev = prevAlarmLevels.current[id] ?? "OK"
    if (newLevel === "ALARM" && prev !== "ALARM") fireAudio(id, message)
    if (newLevel === "OK" && prev !== "OK") clearAudio(id)
    prevAlarmLevels.current[id] = newLevel
  }

  useEffect(() => {
    if (histBooted.current) return
    histBooted.current = true
    bootPressureHistory()
      .then((samples) => {
        if (!samples.length) return
        pressRef.current = samples
        setPressSpark(samples.slice(-30).map((s) => s.hpa))
      })
      .catch((e) => console.warn("[WeatherView] Pressure history:", e.message))
  }, [])

  const tick = useCallback(() => {
    const b = buf.current
    const now = Date.now()
    const getTws = () => (b["environment.wind.speedTrue"] != null ? msToKn(b["environment.wind.speedTrue"]) : null)
    const getTwd = (): number | null => {
      if (b["environment.wind.directionTrue"] != null) return radToDeg(b["environment.wind.directionTrue"])
      if (b["environment.wind.directionMagnetic"] != null) return radToDeg(b["environment.wind.directionMagnetic"])
      return null
    }
    const currentTws = getTws()
    const currentTwd = getTwd()
    setTws(currentTws)

    if (currentTws !== null && currentTwd !== null) {
      twsBufRef.current = [
        ...twsBufRef.current.filter((s) => now - s.t < 20 * 60 * 1000),
        { t: now, tws: currentTws, twd: currentTwd },
      ]
    }
    if (b["environment.outside.pressure"]) {
      pressRef.current = [
        ...pressRef.current.filter((s) => now - s.t < 3 * 3600 * 1000),
        { t: now, hpa: paToHpa(b["environment.outside.pressure"]) },
      ]
    }

    const old1h = pressRef.current.find((s) => now - s.t >= 55 * 60 * 1000)
    let pressureSlope: number | null = null
    let pressScore = 0
    if (old1h && b["environment.outside.pressure"]) {
      pressureSlope = Math.round((paToHpa(b["environment.outside.pressure"]) - old1h.hpa) * 10) / 10
      pressScore = pressureSlope < -2.5 ? 1.0 : pressureSlope < -1.2 ? 0.75 : pressureSlope < -0.5 ? 0.35 : 0
    }
    const recentDirs20 = twsBufRef.current.slice(-20).map((s) => s.twd)
    let windVariation: number | null = null
    let shiftScore = 0
    if (recentDirs20.length >= 3) {
      windVariation = Math.round(Math.max(...recentDirs20) - Math.min(...recentDirs20))
      shiftScore = windVariation > 15 ? 1.0 : windVariation > 8 ? 0.5 : 0
    }
    const squallScore = pressScore * 0.5 + shiftScore * 0.5
    const squallRisk =
      squallScore > 0.8 ? "IMMINENT" : squallScore > 0.6 ? "HIGH" : squallScore > 0.3 ? "MODERATE" : "LOW"
    setSquall({ score: Math.round(squallScore * 100) / 100, pressureSlope, windVariation, risk: squallRisk })

    const buf5min = twsBufRef.current.filter((s) => now - s.t < T.sustainedMins * 60 * 1000).map((s) => s.tws)
    const meanTws5 = buf5min.length ? buf5min.reduce((a, v) => a + v, 0) / buf5min.length : 0
    const sailPlan = getSailPlan(currentTws)
    const sustainedTrigger =
      currentTws !== null &&
      meanTws5 >=
        (sailPlan.state === "1ST REEF"
          ? T.reef1Kn
          : sailPlan.state === "2ND REEF"
            ? T.reef2Kn
            : sailPlan.state === "3RD REEF"
              ? T.reef3Kn
              : 999)
    setSustainedAlarm((prev) => {
      const next = tickAlarm(prev, sustainedTrigger, T.sustainedMins * 60 * 1000, now)
      handleAudioTransition(
        "sustained-wind",
        next.level,
        `Sustained ${Math.round(meanTws5)} knots for ${T.sustainedMins} minutes`,
      )
      return next
    })
    setTwsBuf(twsBufRef.current.slice(-30).map((s) => s.tws))

    const dirs15min = twsBufRef.current.filter((s) => now - s.t < 15 * 60 * 1000).map((s) => s.twd)
    const dirs5min = twsBufRef.current.filter((s) => now - s.t < 5 * 60 * 1000).map((s) => s.twd)
    const dirs90s = twsBufRef.current.filter((s) => now - s.t < 90 * 1000).map((s) => s.twd)
    setTwdBuf(dirs15min)

    const mean5 = circMean(dirs5min)
    const shiftMag = dirs5min.length > 3 && currentTwd !== null ? Math.abs(cirDiff(currentTwd, mean5)) : 0
    setShiftAlarm((prev) => {
      const next = tickAlarm(prev, shiftMag > T.shiftDeg, T.shiftMins * 60 * 1000, now)
      handleAudioTransition("wind-shift", next.level, `Wind shifted ${Math.round(shiftMag)} degrees`)
      return next
    })

    let trendSlope = 0
    if (dirs15min.length > 5) {
      const unwrapped: number[] = [dirs15min[0]]
      for (let i = 1; i < dirs15min.length; i++) {
        unwrapped.push(unwrapped[i - 1] + cirDiff(dirs15min[i], dirs15min[i - 1]))
      }
      trendSlope = Math.round(linSlope(unwrapped.map((y, x) => ({ x, y }))) * 12 * 10) / 10
    }
    const veerLabel = Math.abs(trendSlope) < 1 ? "Steady" : trendSlope > 0 ? "Veering ▶" : "Backing ◀"
    setWindTrend({ deg: currentTwd ?? 0, label: veerLabel, slope: trendSlope })
    setVeerAlarm((prev) => {
      const next = twoLevelAlarm(
        prev,
        Math.abs(trendSlope) > T.veerWatchDpm,
        Math.abs(trendSlope) > T.veerAlarmDpm,
        T.veerMins * 60 * 1000,
        T.shiftMins * 60 * 1000,
        now,
      )
      handleAudioTransition(
        "veer-back",
        next.level,
        `Wind ${veerLabel} at ${Math.abs(trendSlope).toFixed(1)} degrees/min`,
      )
      return next
    })

    const rev90sMin = dirs90s.length > 2 ? circMean(dirs90s.slice(0, Math.floor(dirs90s.length / 2))) : null
    const rev90sMax = dirs90s.length > 2 ? circMean(dirs90s.slice(Math.floor(dirs90s.length / 2))) : null
    const reversalMag = rev90sMin !== null && rev90sMax !== null ? Math.abs(cirDiff(rev90sMax, rev90sMin)) : 0
    setReversalAlarm((prev) => {
      const next = tickAlarm(prev, reversalMag > T.reversalDeg, 0, now)
      handleAudioTransition("reversal", next.level, "Wind reversal detected — squall passing")
      return next
    })

    const tws15 = twsBufRef.current.filter((s) => now - s.t < 15 * 60 * 1000)
    let twsSlopeVal = 0
    if (tws15.length > 5) {
      twsSlopeVal = Math.round(linSlope(tws15.map((s) => ({ x: s.t / 60000, y: s.tws }))) * 10) / 10
    }
    setTwsSlope(twsSlopeVal)
    setTwsSpark(tws15.slice(-20).map((s) => s.tws))
    setTwsAlarm((prev) => {
      const next = twoLevelAlarm(
        prev,
        twsSlopeVal > T.twsWatchSlope,
        twsSlopeVal > T.twsAlarmSlope,
        T.twsSlopeMins * 60 * 1000,
        T.twsSlopeMins * 60 * 1000,
        now,
      )
      handleAudioTransition("tws-trend", next.level, `Wind speed increasing at ${twsSlopeVal} knots per minute`)
      return next
    })

    const dirs30s = twsBufRef.current.filter((s) => now - s.t < 30 * 1000)
    let dirRateVal = 0
    if (dirs30s.length > 1) {
      const dt = (dirs30s[dirs30s.length - 1].t - dirs30s[0].t) / 60000
      dirRateVal =
        dt > 0 ? Math.round((Math.abs(cirDiff(dirs30s[dirs30s.length - 1].twd, dirs30s[0].twd)) / dt) * 10) / 10 : 0
    }
    setDirRate(dirRateVal)
    setDirSpark(dirs30s.map((s) => s.twd % 45))
    setDirAlarm((prev) => {
      const next = twoLevelAlarm(
        prev,
        dirRateVal > T.dirRateWatch,
        dirRateVal > T.dirRateAlarm,
        2 * 60 * 1000,
        1 * 60 * 1000,
        now,
      )
      handleAudioTransition(
        "dir-rate",
        next.level,
        `Rapid wind direction change: ${Math.round(dirRateVal)} degrees per minute`,
      )
      return next
    })

    const p3hAgo = pressRef.current.find((s) => now - s.t >= 170 * 60 * 1000)
    const pNow = pressRef.current[pressRef.current.length - 1]
    let pressSlope3hVal: number | null = null
    if (p3hAgo && pNow) {
      pressSlope3hVal = Math.round((pNow.hpa - p3hAgo.hpa) * 10) / 10
      setPressSlope3h(pressSlope3hVal)
    }
    setPressSpark(pressRef.current.slice(-30).map((s) => s.hpa))
    setBaroAlarm((prev) => {
      const next = twoLevelAlarm(
        prev,
        pressSlope3hVal !== null && pressSlope3hVal < -T.pressWatchDrop,
        pressSlope3hVal !== null && pressSlope3hVal < -T.pressAlarmDrop && twsSlopeVal > T.twsWatchSlope,
        5 * 60 * 1000,
        5 * 60 * 1000,
        now,
      )
      handleAudioTransition(
        "baro-combined",
        next.level,
        "Warning: pressure dropping and wind increasing — deteriorating conditions",
      )
      return next
    })

    const rollRad = b["navigation.attitude.roll"] ?? null
    setRoll(rollRad)
    if (rollRad !== null) {
      const rollDeg = Math.abs((rollRad * 180) / Math.PI)
      attBufRef.current = [
        ...attBufRef.current.slice(-60),
        { roll: rollRad, pitch: b["navigation.attitude.pitch"] ?? 0 },
      ]
      setHeelAlarm((prev) => {
        const next = twoLevelAlarm(
          prev,
          rollDeg > T.heelWatchDeg,
          rollDeg > T.heelAlarmDeg,
          T.heelWatchSecs * 1000,
          T.heelAlarmSecs * 1000,
          now,
        )
        handleAudioTransition("heel", next.level, `Heel angle ${Math.round(rollDeg)} degrees — reduce sail`)
        return next
      })
    }

    const az = b["environment.venus.29.accelerationZ"] ?? null
    if (az !== null) {
      accelBufRef.current = [
        ...accelBufRef.current.filter((s) => now - s.t < 3600 * 1000),
        {
          x: b["environment.venus.29.accelerationX"] ?? 0,
          y: b["environment.venus.29.accelerationY"] ?? 0,
          z: az,
          t: now,
        },
      ]
      const z30s = accelBufRef.current.filter((s) => now - s.t < 30 * 1000).map((s) => s.z)
      const zBase = z30s.reduce((a, v) => a + v, 0) / (z30s.length || 1)
      const slamCount = accelBufRef.current.filter((s) => Math.abs(s.z - zBase) > T.slamMs2).length
      setSlamsPerHrState(slamCount)
      setSlamAlarm((prev) => {
        const next = tickAlarm(prev, slamCount > T.slamsPerHour, 2 * 60 * 1000, now)
        handleAudioTransition("slam", next.level, `High slamming rate: ${slamCount} events per hour`)
        return next
      })
    }

    const heelDeg = rollRad !== null ? Math.abs((rollRad * 180) / Math.PI) : null
    const overpowered =
      currentTws !== null &&
      (heelDeg !== null ? currentTws > T.overpowerKn && heelDeg > T.overpowerHeel : currentTws > T.overpowerKnFallback)
    setOverpowerAlarm((prev) => {
      const next = tickAlarm(prev, overpowered, 30 * 1000, now)
      handleAudioTransition("overpowered", next.level, "Boat overpowered — reduce sail immediately")
      return next
    })

    const s = strBuf.current
    setPrognosis({
      season: s["environment.outside.pressure.prediction.season"] ?? null,
      frontPrognose: s["environment.outside.pressure.prediction.front.prognose"] ?? null,
      system: s["environment.outside.pressure.system"] ?? null,
      frontWind: s["environment.outside.pressure.prediction.front.wind"] ?? null,
      quadrant: s["environment.outside.pressure.prediction.quadrant"] ?? null,
    })
  }, [])

  const processUpdate = useCallback((path: string, value: unknown) => {
    if (typeof value === "string") {
      strBuf.current[path] = value
      return
    }
    if (path === "navigation.attitude" && typeof value === "object" && value !== null) {
      const att = value as { yaw?: number; pitch?: number; roll?: number }
      if (att.roll != null) buf.current["navigation.attitude.roll"] = att.roll
      if (att.pitch != null) buf.current["navigation.attitude.pitch"] = att.pitch
      if (att.yaw != null) buf.current["navigation.attitude.yaw"] = att.yaw
      return
    }
    if (typeof value !== "number") return
    buf.current[path] = value
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
      ws.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: SK_PATHS.map((p) => ({ path: p, period: 1000, policy: "instant" })),
        }),
      )
    }
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (!msg.updates) return
        for (const upd of msg.updates) for (const val of upd.values ?? []) processUpdate(val.path, val.value)
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => setConnected(false)
    ws.onclose = () => {
      setConnected(false)
      reconnRef.current = setTimeout(connect, 3000)
    }
  }, [processUpdate])

  useEffect(() => {
    connect()
    tickRef.current = setInterval(tick, 5000)
    return () => {
      if (reconnRef.current) clearTimeout(reconnRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect, tick])

  const worstLevel = (levels: AlarmLevel[]): AlarmLevel => {
    if (levels.includes("ALARM")) return "ALARM"
    if (levels.includes("WATCH")) return "WATCH"
    return "OK"
  }

  return {
    connected,
    tws,
    prognosis,
    squall,
    twsBuf,
    sustainedAlarm,
    twdBuf,
    shiftAlarm,
    veerAlarm,
    reversalAlarm,
    windTrend,
    twsAlarm,
    dirAlarm,
    baroAlarm,
    twsSlope,
    dirRate,
    pressSlope3h,
    twsSpark,
    dirSpark,
    pressSpark,
    heelAlarm,
    slamAlarm,
    overpowerAlarm,
    roll,
    slamsPerHr: slamsPerHrState,
    topRowWorst: worstLevel([sustainedAlarm.level, shiftAlarm.level, veerAlarm.level, reversalAlarm.level]),
    bottomRowWorst: worstLevel([
      twsAlarm.level,
      dirAlarm.level,
      baroAlarm.level,
      heelAlarm.level,
      slamAlarm.level,
      overpowerAlarm.level,
    ]),
  }
}

// ── Main View ─────────────────────────────────────────────────────────────────
const WeatherView = () => {
  const d = useWeatherSignalK()
  const overallLevel: AlarmLevel =
    d.topRowWorst === "ALARM" || d.bottomRowWorst === "ALARM"
      ? "ALARM"
      : d.topRowWorst === "WATCH" || d.bottomRowWorst === "WATCH"
        ? "WATCH"
        : "OK"

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes scanLine { from{top:0} to{top:100%} }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
      <div
        style={{
          width: "100%",
          height: "100vh",
          background: "#000509",
          display: "flex",
          flexDirection: "column",
          fontFamily: MONO,
          overflow: "hidden",
          position: "relative",
          gap: 3,
          padding: 5,
          boxSizing: "border-box",
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

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(0,210,255,0.42)",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
              }}
            >
              Weather · Safety & Passage
            </div>
            <div style={{ fontSize: 16, fontFamily: "'Cinzel', serif", color: "#daf2ff", letterSpacing: "0.12em" }}>
              Dance Of The Spirits
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {overallLevel !== "OK" && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: LEVEL_COLOR[overallLevel],
                  fontFamily: MONO,
                  letterSpacing: "0.2em",
                  animation: "pulse 1.2s ease infinite",
                }}
              >
                ⚠ {overallLevel}
              </div>
            )}
            <ConnDot live={d.connected} />
          </div>
        </div>

        {/* Row 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3, flex: 1, minHeight: 0 }}>
          <Panel title="Sail Plan Monitor" alarmLevel={d.sustainedAlarm.level}>
            <SailPlanMonitor tws={d.tws} twsBuf={d.twsBuf} sustainedAlarm={d.sustainedAlarm} />
          </Panel>
          <Panel
            title="Wind Shift Monitor"
            alarmLevel={[d.shiftAlarm, d.veerAlarm, d.reversalAlarm].find((a) => a.level !== "OK")?.level ?? "OK"}
          >
            <WindShiftMonitor
              twdBuf={d.twdBuf}
              shiftAlarm={d.shiftAlarm}
              veerAlarm={d.veerAlarm}
              reversalAlarm={d.reversalAlarm}
              trend={d.windTrend}
            />
          </Panel>
          <Panel title="Squall Risk">
            <SquallArcGauge squall={d.squall} />
          </Panel>
        </div>

        {/* Row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3, flex: 1, minHeight: 0 }}>
          <Panel
            title="Trend Alarms"
            alarmLevel={[d.twsAlarm, d.dirAlarm, d.baroAlarm].find((a) => a.level !== "OK")?.level ?? "OK"}
          >
            <TrendAlarms
              twsAlarm={d.twsAlarm}
              dirAlarm={d.dirAlarm}
              baroAlarm={d.baroAlarm}
              twsSlope={d.twsSlope}
              dirRate={d.dirRate}
              pressSlope3h={d.pressSlope3h}
              twsSpark={d.twsSpark}
              dirSpark={d.dirSpark}
              pressSpark={d.pressSpark}
            />
          </Panel>
          <Panel
            title="Passage Safety"
            alarmLevel={[d.heelAlarm, d.slamAlarm, d.overpowerAlarm].find((a) => a.level !== "OK")?.level ?? "OK"}
          >
            <PassageSafety
              heelAlarm={d.heelAlarm}
              slamAlarm={d.slamAlarm}
              overpowerAlarm={d.overpowerAlarm}
              roll={d.roll}
              slamsPerHour={d.slamsPerHr}
              tws={d.tws}
            />
          </Panel>
          <Panel title="Prognosis">
            <PrognosisPanel prognosis={d.prognosis} />
          </Panel>
        </div>
      </div>
    </>
  )
}

export default WeatherView
