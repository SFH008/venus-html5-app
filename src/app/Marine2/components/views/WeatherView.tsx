/**
 * WeatherView.tsx  —  Weather Screen 1 · Current Conditions (v3)
 *
 * Layout (1280×800):
 *   Row 1 — Wind (KIP-style) | Barometer (arc gauge) | Squall Risk (arc gauge)
 *   Row 2 — Wind History chart | Pressure History chart | Prognosis (5 sensors)
 *
 * KIP Wind Gauge design (from SVG reference):
 *   - Rotating compass card (TWD drives rotation — card turns so wind comes from top)
 *   - Fixed boat silhouette at centre bottom
 *   - Port (red) / Starboard (green) arcs on outer ring upper half
 *   - Blue teardrop AWA needle at top (rotates with AWA, shows AWS value)
 *   - Green teardrop TWA needle at top (rotates with TWA, shows TWS value)
 *   - TWD readout pill box at very top
 *   - Beaufort ring around outside
 *
 * New SignalK paths:
 *   environment.outside.pressure.prediction.season
 *   environment.outside.pressure.prediction.front.prognose
 *   environment.outside.pressure.system
 *   environment.outside.pressure.prediction.front.wind
 *   environment.outside.pressure.prediction.quadrant
 *   environment.outside.airDensity
 *   environment.outside.dewPointTemperature
 */

import React, { useState, useEffect, useCallback, useRef } from "react"

// ─── CONFIG ──────────────────────────────────────────────────────────────────
import { getConfig } from "../../config/AppConfig"
const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()

// ─── CONVERSIONS ─────────────────────────────────────────────────────────────
const msToKn = (v: number) => Math.round(v * 1.94384 * 10) / 10
const radToDeg = (v: number) => Math.round(((v * 180) / Math.PI + 360) % 360)
const radToSigned = (v: number) => {
  const d = (v * 180) / Math.PI
  return Math.round(((d + 180) % 360) - 180)
}
// SK pressure: spec says Pa, but many plugins send hPa already.
// Heuristic: if value > 50000 it's Pa → divide by 100; if < 2000 assume already hPa
const paToHpa = (v: number) => Math.round((v > 50000 ? v / 100 : v) * 10) / 10
const kToC = (v: number) => Math.round((v - 273.15) * 10) / 10
const toHumidity = (v: number) => Math.round(v > 1 ? v : v * 100)
const toRad = (d: number) => (d * Math.PI) / 180

// ─── BEAUFORT ─────────────────────────────────────────────────────────────────
const BFT: { max: number; label: string; color: string }[] = [
  { max: 1, label: "Calm", color: "#38bdf8" },
  { max: 3, label: "Light air", color: "#34d399" },
  { max: 6, label: "Light breeze", color: "#22c55e" },
  { max: 10, label: "Gentle", color: "#a3e635" },
  { max: 16, label: "Moderate", color: "#facc15" },
  { max: 21, label: "Fresh", color: "#fb923c" },
  { max: 27, label: "Strong", color: "#f87171" },
  { max: 33, label: "Near gale", color: "#ef4444" },
  { max: 40, label: "Gale", color: "#dc2626" },
  { max: 55, label: "Storm", color: "#991b1b" },
  { max: 999, label: "Hurricane", color: "#450a0a" },
]
const getBft = (kn: number | null) => (kn === null ? null : (BFT.find((b) => kn <= b.max) ?? BFT[BFT.length - 1]))

// ─── ZONE TYPES ───────────────────────────────────────────────────────────────
interface SkZone {
  lower: number
  upper: number
  state: "nominal" | "warn" | "alert" | "alarm" | "emergency"
  message?: string
}
const ZONE_COLOR: Record<string, string> = {
  nominal: "#22c55e",
  warn: "#f59e0b",
  alert: "#f97316",
  alarm: "#ef4444",
  emergency: "#7c3aed",
}
const ZONE_FILL: Record<string, string> = {
  nominal: "rgba(34,197,94,0.15)",
  warn: "rgba(245,158,11,0.18)",
  alert: "rgba(249,115,22,0.18)",
  alarm: "rgba(239,68,68,0.18)",
  emergency: "rgba(124,58,237,0.18)",
}

// ─── SQUALL ────────────────────────────────────────────────────────────────────
const SQUALL_COLOR: Record<string, string> = {
  LOW: "#22c55e",
  MODERATE: "#f59e0b",
  HIGH: "#f97316",
  IMMINENT: "#ef4444",
}
const SQUALL_ARC = [
  { from: 0, to: 0.3, color: "#22c55e" },
  { from: 0.3, to: 0.6, color: "#f59e0b" },
  { from: 0.6, to: 0.8, color: "#f97316" },
  { from: 0.8, to: 1.0, color: "#ef4444" },
]

// ─── SK PATHS ─────────────────────────────────────────────────────────────────
const SK_PATHS = [
  // ── Wind — all under environment.wind going forward ──
  "environment.wind.speedTrue", // TWS
  "environment.wind.angleTrue", // TWA (signed, relative to bow)
  "environment.wind.directionTrue", // TWD (magnetic-north referenced)
  "environment.wind.directionMagnetic", // TWD magnetic
  "environment.wind.speedApparent", // AWS
  "environment.wind.angleApparent", // AWA (signed, relative to bow)
  "navigation.headingTrue", // heading — for TWA/TWD cross-check

  "environment.outside.pressure",
  "environment.outside.temperature",
  "environment.water.temperature",
  "environment.outside.humidity",
  "environment.outside.dewPointTemperature",
  "environment.outside.airDensity",
  "environment.wind.waves.significantHeight",
  "environment.wind.waves.period",
  "environment.wind.waves.directionTrue",
  "environment.wind.swell.height",
  "environment.wind.swell.period",
  // Prognosis string paths — handled separately (may not be numbers)
  "environment.outside.pressure.prediction.season",
  "environment.outside.pressure.prediction.front.prognose",
  "environment.outside.pressure.system",
  "environment.outside.pressure.prediction.front.wind",
  "environment.outside.pressure.prediction.quadrant",
]

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface WeatherState {
  tws: number | null
  twd: number | null
  aws: number | null
  awa: number | null
  twa: number | null
  gust: number | null
  pressure: number | null
  airTemp: number | null
  seaTemp: number | null
  humidity: number | null
  dewPoint: number | null
  airDensity: number | null
  waveHeight: number | null
  wavePeriod: number | null
  waveDir: number | null
  swellHeight: number | null
  swellPeriod: number | null
}
interface Prognosis {
  season: string | null
  frontPrognose: string | null
  system: string | null
  frontWind: string | null
  quadrant: string | null
}
interface SquallState {
  score: number
  pressureSlope: number | null
  windVariation: number | null
  risk: "LOW" | "MODERATE" | "HIGH" | "IMMINENT"
}
const WIND_HISTORY_MINUTES = 60
const WIND_HISTORY_INTERVAL = 30000
interface WindSample {
  t: number
  tws: number
  gust: number
  twd: number
}
interface PressureSample {
  t: number
  hpa: number
}

// ─── HISTORY API FETCH ───────────────────────────────────────────────────────
// Uses SignalK v2 History API (backed by signalk-to-influxdb2 history provider)
// POST /signalk/v2/api/history/values with JSON body
// Response: { data: [[isoTimestamp, value], ...] }
// Pressure values arrive already in hPa (plugin converts Pa→hPa before storing)
// Wind values arrive in m/s (same as live WS) — converted with msToKn

async function fetchSkHistory(
  paths: { path: string; method: "average" | "min" | "max" }[],
  durationMs: number,
): Promise<Record<string, [string, number][]>> {
  const to = new Date().toISOString()
  const from = new Date(Date.now() - durationMs).toISOString()
  const body = { context: "vessels.self", range: { from, to }, values: paths }
  const res = await fetch(`http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v2/api/history/values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`History API ${res.status}`)
  const json = await res.json()
  // Response has a single .data array for the first (and only) path requested
  // For multi-path we call separately and merge
  const result: Record<string, [string, number][]> = {}
  result[paths[0].path] = json.data ?? []
  return result
}

async function bootPressureHistory(): Promise<PressureSample[]> {
  const raw = await fetchSkHistory(
    [{ path: "environment.outside.pressure", method: "average" }],
    2 * 3600 * 1000, // 2 hours
  )
  const data = raw["environment.outside.pressure"] ?? []
  // Downsample to one point per minute to keep the array lean (~120 points)
  const byMinute = new Map<number, number[]>()
  for (const [ts, val] of data) {
    const minuteKey = Math.floor(new Date(ts).getTime() / 60000)
    if (!byMinute.has(minuteKey)) byMinute.set(minuteKey, [])
    byMinute.get(minuteKey)!.push(val)
  }
  return Array.from(byMinute.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([min, vals]) => ({
      t: min * 60000,
      // Values are already hPa from the history API — no paToHpa conversion needed
      hpa: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
    }))
}

async function bootWindHistory(): Promise<WindSample[]> {
  // Wind history paths — all under environment.wind:
  //   environment.wind.speedTrue     — TWS in m/s
  //   environment.wind.directionTrue — TWD in rad (magnetic-north referenced)
  const [twsRaw, twdRaw] = await Promise.all([
    fetchSkHistory([{ path: "environment.wind.speedTrue", method: "average" }], WIND_HISTORY_MINUTES * 60 * 1000),
    fetchSkHistory([{ path: "environment.wind.directionTrue", method: "average" }], WIND_HISTORY_MINUTES * 60 * 1000),
  ])
  const twsData = twsRaw["environment.wind.speedTrue"] ?? []
  const awaData = twdRaw["environment.wind.directionTrue"] ?? []

  // Zip by minute bucket
  const byMinute = new Map<number, { tws?: number; twd?: number }>()
  for (const [ts, val] of twsData) {
    const k = Math.floor(new Date(ts).getTime() / 60000)
    const e = byMinute.get(k) ?? {}
    e.tws = val
    byMinute.set(k, e)
  }
  for (const [ts, val] of awaData) {
    const k = Math.floor(new Date(ts).getTime() / 60000)
    const e = byMinute.get(k) ?? {}
    e.twd = val
    byMinute.set(k, e)
  }
  return Array.from(byMinute.entries())
    .sort((a, b) => a[0] - b[0])
    .filter(([, e]) => e.tws != null)
    .map(([min, e]) => ({
      t: min * 60000,
      tws: msToKn(e.tws!),
      gust: msToKn(e.tws!),
      twd: e.twd != null ? radToDeg(e.twd) : 0,
    }))
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────
function useWeatherSignalK() {
  const [wx, setWx] = useState<WeatherState>({
    tws: null,
    twd: null,
    aws: null,
    awa: null,
    twa: null,
    gust: null,
    pressure: null,
    airTemp: null,
    seaTemp: null,
    humidity: null,
    dewPoint: null,
    airDensity: null,
    waveHeight: null,
    wavePeriod: null,
    waveDir: null,
    swellHeight: null,
    swellPeriod: null,
  })
  const [prognosis, setPrognosis] = useState<Prognosis>({
    season: null,
    frontPrognose: null,
    system: null,
    frontWind: null,
    quadrant: null,
  })
  const [squall, setSquall] = useState<SquallState>({ score: 0, pressureSlope: null, windVariation: null, risk: "LOW" })
  const [windHist, setWindHist] = useState<WindSample[]>([])
  const [pressHist, setPressHist] = useState<PressureSample[]>([])
  const [windZones, setWindZones] = useState<SkZone[]>([])
  const [connected, setConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sampleTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const buf = useRef<Record<string, number>>({})
  const strBuf = useRef<Record<string, string>>({})
  const dirBuf = useRef<number[]>([])
  const pressRef = useRef<PressureSample[]>([])
  const histBootedRef = useRef(false) // prevent double-boot on StrictMode remount

  // ── Boot histories from SignalK History API on first mount ──────────────────
  useEffect(() => {
    if (histBootedRef.current) return
    histBootedRef.current = true

    bootPressureHistory()
      .then((samples) => {
        if (samples.length === 0) return
        setPressHist(samples)
        pressRef.current = samples
        console.log(`[WeatherView] Pressure history booted: ${samples.length} points`)
      })
      .catch((err) => console.warn("[WeatherView] Pressure history unavailable:", err.message))

    bootWindHistory()
      .then((samples) => {
        if (samples.length === 0) return
        setWindHist(samples)
        console.log(`[WeatherView] Wind history booted: ${samples.length} points`)
      })
      .catch((err) => console.warn("[WeatherView] Wind history unavailable:", err.message))
  }, [])

  // Fetch wind zones from SK REST
  useEffect(() => {
    fetch(`http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/api/vessels/self/environment/wind/speedTrue/meta`)
      .then((r) => r.json())
      .then((m) => {
        if (Array.isArray(m?.zones)) setWindZones(m.zones)
      })
      .catch(() => {})
  }, [])

  const calcSquall = useCallback(() => {
    const b = buf.current
    const now = Date.now()
    const old = pressRef.current.find((s) => now - s.t >= 55 * 60 * 1000)
    let pressureSlope: number | null = null
    let pressScore = 0
    if (old && b["environment.outside.pressure"]) {
      pressureSlope = Math.round((paToHpa(b["environment.outside.pressure"]) - old.hpa) * 10) / 10
      pressScore = pressureSlope < -2.5 ? 1.0 : pressureSlope < -1.2 ? 0.75 : pressureSlope < -0.5 ? 0.35 : 0
    }
    const dirs = dirBuf.current
    let windVariation: number | null = null
    let shiftScore = 0
    if (dirs.length >= 3) {
      windVariation = Math.round(Math.max(...dirs) - Math.min(...dirs))
      shiftScore = windVariation > 15 ? 1.0 : windVariation > 8 ? 0.5 : 0
    }
    const score = pressScore * 0.5 + shiftScore * 0.5
    const risk: SquallState["risk"] = score > 0.8 ? "IMMINENT" : score > 0.6 ? "HIGH" : score > 0.3 ? "MODERATE" : "LOW"
    setSquall({ score: Math.round(score * 100) / 100, pressureSlope, windVariation, risk })
  }, [])

  const sampleWind = useCallback(() => {
    const b = buf.current
    const now = Date.now()
    const cutoffWind = now - WIND_HISTORY_MINUTES * 60 * 1000
    const cutoffPress = now - 2 * 3600 * 1000 // keep 2h to match boot window

    const tws = b["environment.wind.speedTrue"] != null ? msToKn(b["environment.wind.speedTrue"]) : 0
    const gustRaw = b["environment.wind.speedApparent"] // use AWS as gust proxy if no dedicated gust path
    const gust = gustRaw != null ? msToKn(gustRaw) : tws
    const twd =
      b["environment.wind.directionTrue"] != null
        ? radToDeg(b["environment.wind.directionTrue"])
        : b["environment.wind.directionMagnetic"] != null
          ? radToDeg(b["environment.wind.directionMagnetic"])
          : 0

    // Append live sample — trim old points beyond window
    setWindHist((prev) => [...prev.filter((s) => s.t > cutoffWind), { t: now, tws, gust, twd }])

    if (b["environment.outside.pressure"]) {
      const hpa = paToHpa(b["environment.outside.pressure"])
      const newSample = { t: now, hpa }
      // Update ref (used by calcSquall for slope) — keep 2h window
      pressRef.current = [...pressRef.current.filter((s) => s.t > cutoffPress), newSample]
      // Append to chart state — trim to 2h window
      setPressHist((prev) => [...prev.filter((s) => s.t > cutoffPress), newSample])
    }
    calcSquall()
  }, [calcSquall])

  const processUpdate = useCallback((path: string, value: unknown) => {
    // String-valued prognosis paths
    if (typeof value === "string") {
      strBuf.current[path] = value
      setPrognosis({
        season: strBuf.current["environment.outside.pressure.prediction.season"] ?? null,
        frontPrognose: strBuf.current["environment.outside.pressure.prediction.front.prognose"] ?? null,
        system: strBuf.current["environment.outside.pressure.system"] ?? null,
        frontWind: strBuf.current["environment.outside.pressure.prediction.front.wind"] ?? null,
        quadrant: strBuf.current["environment.outside.pressure.prediction.quadrant"] ?? null,
      })
      return
    }
    if (typeof value !== "number") return
    buf.current[path] = value

    if (path === "environment.wind.directionTrue" || path === "environment.wind.directionMagnetic")
      dirBuf.current = [...dirBuf.current.slice(-20), (value * 180) / Math.PI]

    setWx((prev) => {
      const b = buf.current
      const n = (p: string, conv: (v: number) => number): number | null => {
        if (b[p] != null) return conv(b[p])
        const pv = prev[p as keyof WeatherState]
        return typeof pv === "number" ? pv : null
      }
      // Compute AWA as signed angle
      const awaRaw = b["environment.wind.angleApparent"]
      // Compute TWA = TWD - heading (signed ±180°)
      const twdDeg =
        b["environment.wind.directionTrue"] != null
          ? radToDeg(b["environment.wind.directionTrue"])
          : b["environment.wind.directionMagnetic"] != null
            ? radToDeg(b["environment.wind.directionMagnetic"])
            : null
      const hdgDeg = b["navigation.headingTrue"] != null ? radToDeg(b["navigation.headingTrue"]) : null
      const twaRaw = twdDeg != null && hdgDeg != null ? Math.round(((twdDeg - hdgDeg + 540) % 360) - 180) : null
      return {
        tws: n("environment.wind.speedTrue", msToKn),
        twd: n("environment.wind.directionTrue", radToDeg) ?? n("environment.wind.directionMagnetic", radToDeg),
        aws: n("environment.wind.speedApparent", msToKn),
        awa: awaRaw != null ? radToSigned(awaRaw) : prev.awa,
        // Use environment.wind.angleTrue directly if available, else compute from TWD-HDG
        twa:
          b["environment.wind.angleTrue"] != null
            ? Math.round(radToSigned(b["environment.wind.angleTrue"]) * 10) / 10
            : (twaRaw ?? prev.twa),
        gust: n("environment.wind.speedApparent", msToKn), // AWS as gust proxy
        pressure: n("environment.outside.pressure", paToHpa),
        airTemp: n("environment.outside.temperature", kToC),
        seaTemp: n("environment.water.temperature", kToC),
        humidity: n("environment.outside.humidity", toHumidity),
        dewPoint: n("environment.outside.dewPointTemperature", kToC),
        airDensity: n("environment.outside.airDensity", (v) => Math.round(v * 1000) / 1000),
        waveHeight: n("environment.wind.waves.significantHeight", (v) => Math.round(v * 10) / 10),
        wavePeriod: n("environment.wind.waves.period", (v) => Math.round(v * 10) / 10),
        waveDir: n("environment.wind.waves.directionTrue", radToDeg),
        swellHeight: n("environment.wind.swell.height", (v) => Math.round(v * 10) / 10),
        swellPeriod: n("environment.wind.swell.period", (v) => Math.round(v * 10) / 10),
      }
    })
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
        for (const upd of msg.updates) for (const val of upd.values || []) processUpdate(val.path, val.value)
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
    sampleTimer.current = setInterval(sampleWind, WIND_HISTORY_INTERVAL)
    return () => {
      if (reconnRef.current) clearTimeout(reconnRef.current)
      if (sampleTimer.current) clearInterval(sampleTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect, sampleWind])

  return { wx, prognosis, squall, windHist, pressHist, windZones, connected }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const dirLabel = (deg: number | null) => {
  if (deg === null) return "—"
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][
    Math.round(deg / 22.5) % 16
  ]
}

// Arc path helper for gauge arcs
const arcPath = (cx: number, cy: number, r: number, startDeg: number, endDeg: number) => {
  const s = toRad(startDeg)
  const e = toRad(endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const dir = endDeg > startDeg ? 1 : 0
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} ${dir} ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`
}

// ─── KIP-STYLE WIND GAUGE ─────────────────────────────────────────────────────
const KipWindGauge = ({ wx, zones }: { wx: WeatherState; zones: SkZone[] }) => {
  const SIZE = 220
  const cx = SIZE / 2
  const cy = SIZE / 2
  const R_OUTER = 100 // outer ring radius
  const R_CARD = 82 // rotating compass card radius
  const R_INNER = 60 // inner display area

  const twd = wx.twd ?? 0 // card rotates by -twd so wind comes from top
  const awa = wx.awa ?? 0 // apparent wind angle (signed ±180°, port=neg)
  const twa = wx.twa ?? 0 // true wind angle (signed ±180°, computed from TWD-HDG)
  const bft = getBft(wx.tws)

  // Port/starboard arcs: upper-left quadrant = port (red), upper-right = starboard (green)
  // These are fixed on the outer ring (don't rotate)
  const portArcStart = -160
  const portArcEnd = -20
  const stbdArcStart = 20
  const stbdArcEnd = 160

  // Teardrop needle path — tip at top (0,-R), bulge downward
  const teardrop = (r: number, bulge: number) =>
    `M 0,${-r} C ${bulge * 0.6},${-r + bulge * 1.2} ${bulge},${-r + bulge * 2.5} 0,${-r + bulge * 3} C ${-bulge},${-r + bulge * 2.5} ${-bulge * 0.6},${-r + bulge * 1.2} 0,${-r} Z`

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", height: "100%" }}>
      {/* ── SVG Gauge ── */}
      <div style={{ flexShrink: 0, position: "relative" }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            {/* Radial gradient for outer ring */}
            <radialGradient id="ringGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0.7" stopColor="#1a2030" />
              <stop offset="1" stopColor="#0a0f1a" />
            </radialGradient>
          </defs>

          {/* Outer ring background */}
          <circle cx={cx} cy={cy} r={R_OUTER} fill="url(#ringGrad)" stroke="rgba(200,220,255,0.1)" strokeWidth="1" />

          {/* Beaufort zone arcs on outer ring */}
          {zones.map((z, i) => {
            const maxKn = 50
            const ri = R_OUTER - 2 - (msToKn(z.lower) / maxKn) * 14
            const ro = R_OUTER - 2 - (msToKn(z.upper) / maxKn) * 14
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={(ri + ro) / 2}
                fill="none"
                stroke={ZONE_COLOR[z.state]}
                strokeWidth={Math.max(1.5, ro - ri)}
                strokeOpacity={0.35}
              />
            )
          })}

          {/* PORT arc (red) — fixed, upper-left */}
          <path
            d={arcPath(cx, cy, R_OUTER - 6, portArcStart + 270, portArcEnd + 270)}
            fill="none"
            stroke="#c30500"
            strokeWidth="8"
            strokeLinecap="butt"
            strokeOpacity="0.85"
          />

          {/* STARBOARD arc (green) — fixed, upper-right */}
          <path
            d={arcPath(cx, cy, R_OUTER - 6, stbdArcStart + 270, stbdArcEnd + 270)}
            fill="none"
            stroke="#15af00"
            strokeWidth="8"
            strokeLinecap="butt"
            strokeOpacity="0.85"
          />

          {/* ── Rotating compass card group ── */}
          <g transform={`rotate(${-twd}, ${cx}, ${cy})`}>
            {/* Card background */}
            <circle cx={cx} cy={cy} r={R_CARD} fill="rgba(0,8,20,0.7)" />

            {/* Degree tick marks on card */}
            {Array.from({ length: 72 }).map((_, i) => {
              const deg = i * 5
              const a = toRad(deg - 90)
              const isMajor = deg % 30 === 0
              const isMed = deg % 10 === 0
              const r1 = R_CARD - (isMajor ? 10 : isMed ? 6 : 3)
              return (
                <line
                  key={i}
                  x1={cx + r1 * Math.cos(a)}
                  y1={cy + r1 * Math.sin(a)}
                  x2={cx + R_CARD * Math.cos(a)}
                  y2={cy + R_CARD * Math.sin(a)}
                  stroke={isMajor ? "rgba(200,220,255,0.6)" : "rgba(200,220,255,0.2)"}
                  strokeWidth={isMajor ? 1.5 : 0.7}
                />
              )
            })}

            {/* Cardinal + degree labels on card */}
            {[
              { deg: 0, label: "N" },
              { deg: 90, label: "E" },
              { deg: 180, label: "S" },
              { deg: 270, label: "W" },
              { deg: 30, label: "30" },
              { deg: 60, label: "60" },
              { deg: 120, label: "120" },
              { deg: 150, label: "150" },
              { deg: 210, label: "210" },
              { deg: 240, label: "240" },
              { deg: 300, label: "300" },
              { deg: 330, label: "330" },
            ].map(({ deg, label }) => {
              const a = toRad(deg - 90)
              const lr = R_CARD - 16
              const isCardinal = ["N", "E", "S", "W"].includes(label)
              return (
                <text
                  key={label}
                  x={cx + lr * Math.cos(a)}
                  y={cy + lr * Math.sin(a)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={isCardinal ? 11 : 7}
                  fontWeight={isCardinal ? "700" : "400"}
                  fill={label === "N" ? "#e44" : "rgba(200,220,255,0.65)"}
                  fontFamily="'Share Tech Mono', monospace"
                  transform={`rotate(${deg}, ${cx + lr * Math.cos(a)}, ${cy + lr * Math.sin(a)})`}
                >
                  {label}
                </text>
              )
            })}
          </g>
          {/* End rotating card */}

          {/* Inner background (fixed) */}
          <circle cx={cx} cy={cy} r={R_INNER} fill="rgba(0,4,12,0.85)" />

          {/* Boat silhouette (fixed, centre) — simplified hull outline */}
          <g transform={`translate(${cx}, ${cy})`} opacity={0.35}>
            {/* Hull */}
            <ellipse rx="8" ry="20" cy="12" fill="rgba(180,200,230,0.5)" />
            {/* Mast line */}
            <line x1="0" y1="10" x2="0" y2="-18" stroke="rgba(180,200,230,0.6)" strokeWidth="1.2" />
            {/* Boom */}
            <line x1="0" y1="-2" x2="9" y2="8" stroke="rgba(180,200,230,0.4)" strokeWidth="0.8" />
            {/* Port side gradient */}
            <path d={`M 0,${-18} L -9,10 Q -8,22 0,26 Z`} fill="none" stroke="rgba(160,180,210,0.3)" strokeWidth="1" />
          </g>

          {/* TWA True Wind needle (green teardrop) — rotates by real TWA = TWD - heading */}
          {/* Only rendered if heading data is available (twa !== null) */}
          {wx.twa !== null && (
            <g transform={`translate(${cx}, ${cy}) rotate(${twa})`}>
              <path
                d={teardrop(R_INNER - 8, 10)}
                fill="#1d980b"
                fillOpacity="0.9"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.5"
              />
              <text
                y={-R_INNER + 20}
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                fill="#ffffff"
                fontFamily="'Share Tech Mono', monospace"
              >
                T
              </text>
              <text
                y={-R_INNER + 30}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="#ffffff"
                fontFamily="'Share Tech Mono', monospace"
              >
                {wx.tws !== null ? wx.tws : "—"}
              </text>
            </g>
          )}

          {/* AWA Apparent Wind needle (blue teardrop) — rotates with AWA (signed ±180°) */}
          {wx.awa !== null && (
            <g transform={`translate(${cx}, ${cy}) rotate(${awa})`}>
              <path
                d={teardrop(R_INNER + 6, 7)}
                fill="#2563eb"
                fillOpacity="0.85"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.5"
              />
              <text
                y={-R_INNER - 4}
                textAnchor="middle"
                fontSize="7"
                fontWeight="700"
                fill="#ffffff"
                fontFamily="'Share Tech Mono', monospace"
              >
                A
              </text>
              <text
                y={-R_INNER + 7}
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                fill="#ffffff"
                fontFamily="'Share Tech Mono', monospace"
              >
                {wx.aws !== null ? wx.aws : "—"}
              </text>
            </g>
          )}

          {/* Centre dot */}
          <circle cx={cx} cy={cy} r={5} fill="rgba(0,210,255,0.25)" stroke="rgba(0,210,255,0.5)" strokeWidth="1" />

          {/* TWD readout pill — top centre (fixed) */}
          <rect
            x={cx - 36}
            y={4}
            width={72}
            height={26}
            rx={8}
            fill="rgba(0,0,0,0.8)"
            stroke="rgba(200,220,255,0.3)"
            strokeWidth="1"
          />
          <text
            x={cx}
            y={21}
            textAnchor="middle"
            fontSize="14"
            fontWeight="700"
            fill="#ffffff"
            fontFamily="'Share Tech Mono', monospace"
          >
            {wx.twd !== null ? `${wx.twd}°` : "—°"}
          </text>
        </svg>

        {/* Beaufort badge */}
        {bft && (
          <div
            style={{
              textAlign: "center",
              fontSize: 10,
              color: bft.color,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: -6,
              background: "rgba(0,5,15,0.8)",
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${bft.color}44`,
              display: "inline-block",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            BFT {BFT.indexOf(bft) + 1} · {bft.label}
          </div>
        )}
      </div>

      {/* ── Metrics column ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 10 }}>
        <WRow label="TWD" value={wx.twd !== null ? `${wx.twd}°  ${dirLabel(wx.twd)}` : "—"} hi />
        <WRow label="TWS" value={wx.tws !== null ? `${wx.tws} kn` : "—"} />
        <WRow label="TWA" value={wx.twa !== null ? `${wx.twa > 0 ? "+" : ""}${wx.twa}°` : "— (no HDG)"} />
        <WRow label="AWS" value={wx.aws !== null ? `${wx.aws} kn` : "—"} />
        <WRow label="AWA" value={wx.awa !== null ? `${wx.awa > 0 ? "+" : ""}${wx.awa}°` : "—"} />
        <WRow label="Gust" value={wx.gust !== null ? `${wx.gust} kn` : "— (no sensor)"} warn={(wx.gust ?? 0) > 30} />
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,210,255,0.06)" }}>
          <WRow label="Air Temp" value={wx.airTemp !== null ? `${wx.airTemp} °C` : "—"} />
        </div>
        {/* Zone legend */}
        {zones.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 10, color: "rgba(0,210,255,0.3)", letterSpacing: "0.18em" }}>SPEED ZONES</div>
            {zones.map((z, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "rgba(200,220,255,0.45)" }}
              >
                <div style={{ width: 7, height: 7, borderRadius: 1, background: ZONE_COLOR[z.state], flexShrink: 0 }} />
                {msToKn(z.lower)}–{msToKn(z.upper)} kn · {z.state}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const WRow = ({ label, value, hi, warn }: { label: string; value: string; hi?: boolean; warn?: boolean }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
  >
    <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)", letterSpacing: "0.1em" }}>{label}</span>
    <span
      style={{
        fontSize: hi ? 14 : 13,
        fontWeight: hi ? 700 : 500,
        color: warn ? "#ef4444" : "#e8f8ff",
        fontFamily: "'Share Tech Mono', monospace",
      }}
    >
      {value}
    </span>
  </div>
)

// ─── ARC GAUGE ────────────────────────────────────────────────────────────────
// Generic 270° arc gauge for barometer, dew point, air density, squall
interface ArcGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  decimals?: number
  color?: string
  zones?: { from: number; to: number; color: string }[]
  skZones?: SkZone[] // real SK zones mapped onto arc
  size?: number
  subLabel?: string
}
const ArcGauge = ({
  value,
  min,
  max,
  unit,
  label,
  decimals = 0,
  color = "#00d2ff",
  zones,
  skZones,
  size = 160,
  subLabel,
}: ArcGaugeProps) => {
  const W = size
  const cx = W / 2
  const cy = W * 0.58
  const R = W * 0.41
  const START = 135
  const SWEEP = 270

  const ap = (pct: number, r: number) => {
    const d = START + pct * SWEEP
    return { x: cx + r * Math.cos(toRad(d)), y: cy + r * Math.sin(toRad(d)) }
  }
  const band = (p1: number, p2: number, r: number) => {
    const a = ap(p1, r)
    const b = ap(p2, r)
    const sweepDeg = (p2 - p1) * SWEEP
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
  }

  const pct = value !== null ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const needle = ap(pct, R - 4)
  const activeColor = color

  // Map SK zones to 0–1 scale
  const mappedSkZones = (skZones ?? [])
    .map((z) => ({
      from: Math.max(0, (msToKn(z.lower) - min) / (max - min)),
      to: Math.min(1, (msToKn(z.upper) - min) / (max - min)),
      color: ZONE_COLOR[z.state],
    }))
    .filter((z) => z.from < z.to)

  const allZones = [...(zones ?? []), ...mappedSkZones]

  const displayVal = value !== null ? value.toFixed(decimals) : "—"

  return (
    <svg width={W} height={W * 0.82} viewBox={`0 0 ${W} ${W * 0.82}`}>
      {/* Track */}
      <path d={band(0, 1, R)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" strokeLinecap="round" />
      {/* Zone bands */}
      {allZones.map((z, i) => (
        <path
          key={i}
          d={band(z.from, z.to, R)}
          fill="none"
          stroke={z.color}
          strokeWidth="10"
          strokeLinecap="butt"
          opacity={0.28}
        />
      ))}
      {/* Fill arc */}
      {value !== null && pct > 0.01 && (
        <path
          d={band(0, pct, R)}
          fill="none"
          stroke={activeColor}
          strokeWidth="10"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${activeColor}77)`, transition: "all 0.8s ease" }}
        />
      )}
      {/* Needle dot */}
      {value !== null && (
        <circle
          cx={needle.x}
          cy={needle.y}
          r={6}
          fill={activeColor}
          style={{ filter: `drop-shadow(0 0 7px ${activeColor})`, transition: "all 0.8s ease" }}
        />
      )}
      {/* Zone ticks */}
      {allZones.map((z, i) => {
        const inner = ap(z.from, R - 8)
        const outer = ap(z.from, R + 8)
        return (
          <line
            key={i}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
          />
        )
      })}
      {/* Value */}
      <text
        x={cx}
        y={cy - 14}
        textAnchor="middle"
        fontSize={W * 0.175}
        fontWeight="700"
        fill="#e8f8ff"
        fontFamily="'Share Tech Mono', monospace"
        style={{ transition: "all 0.8s ease" }}
      >
        {displayVal}
      </text>
      <text
        x={cx}
        y={cy + 8}
        textAnchor="middle"
        fontSize={W * 0.08}
        fill="rgba(200,220,255,0.5)"
        fontFamily="'Share Tech Mono', monospace"
      >
        {unit}
      </text>
      {/* Label */}
      <text
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fontSize={W * 0.075}
        fill={activeColor}
        fontFamily="'Share Tech Mono', monospace"
        letterSpacing="0.1em"
      >
        {label}
      </text>
      {subLabel && (
        <text
          x={cx}
          y={cy + 34}
          textAnchor="middle"
          fontSize={W * 0.065}
          fill="rgba(200,220,255,0.3)"
          fontFamily="'Share Tech Mono', monospace"
        >
          {subLabel}
        </text>
      )}
      {/* Min/max labels */}
      {[
        { pct: 0, val: min },
        { pct: 1, val: max },
      ].map(({ pct: p, val }) => {
        const pt = ap(p, R + 16)
        return (
          <text
            key={p}
            x={pt.x}
            y={pt.y}
            textAnchor="middle"
            fontSize={W * 0.065}
            fill="rgba(200,220,255,0.25)"
            fontFamily="'Share Tech Mono', monospace"
          >
            {val}
          </text>
        )
      })}
    </svg>
  )
}

// ─── SQUALL ARC GAUGE ─────────────────────────────────────────────────────────
const SquallArcGauge = ({ squall }: { squall: SquallState }) => {
  const W = 165
  const cx = W / 2
  const cy = 105
  const R = W * 0.4
  const START = 135
  const SWEEP = 270

  const ap = (pct: number, r: number) => {
    const d = START + pct * SWEEP
    return { x: cx + r * Math.cos(toRad(d)), y: cy + r * Math.sin(toRad(d)) }
  }
  const band = (p1: number, p2: number, r: number) => {
    const a = ap(p1, r)
    const b = ap(p2, r)
    const sweepDeg = (p2 - p1) * SWEEP
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
  }

  const score = squall.score
  const color = SQUALL_COLOR[squall.risk]
  const needle = ap(score, R - 4)

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={W} height={130} viewBox={`0 0 ${W} 130`}>
        <path d={band(0, 1, R)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" strokeLinecap="round" />
        {SQUALL_ARC.map((z, i) => (
          <path
            key={i}
            d={band(z.from, z.to, R)}
            fill="none"
            stroke={z.color}
            strokeWidth="10"
            strokeLinecap="butt"
            opacity={0.25}
          />
        ))}
        {score > 0.01 && (
          <path
            d={band(0, score, R)}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color}88)`, transition: "all 0.8s ease" }}
          />
        )}
        <circle
          cx={needle.x}
          cy={needle.y}
          r={7}
          fill={color}
          style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: "all 0.8s ease" }}
        />
        {[0.3, 0.6, 0.8].map((p) => {
          const i2 = ap(p, R - 8)
          const o = ap(p, R + 8)
          return <line key={p} x1={i2.x} y1={i2.y} x2={o.x} y2={o.y} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        })}
        <text
          x={cx}
          y={cy - 16}
          textAnchor="middle"
          fontSize="28"
          fontWeight="700"
          fill="#e8f8ff"
          fontFamily="'Share Tech Mono', monospace"
          style={{ transition: "all 0.8s ease" }}
        >
          {Math.round(score * 100)}%
        </text>
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill={color}
          fontFamily="'Share Tech Mono', monospace"
          letterSpacing="0.15em"
          style={{ transition: "fill 0.8s ease" }}
        >
          {squall.risk}
        </text>
        {[
          { p: 0, l: "LOW" },
          { p: 1, l: "IMMIN" },
        ].map(({ p, l }) => {
          const pt = ap(p, R + 18)
          return (
            <text
              key={l}
              x={pt.x}
              y={pt.y}
              textAnchor="middle"
              fontSize="6.5"
              fill="rgba(200,220,255,0.28)"
              fontFamily="'Share Tech Mono', monospace"
            >
              {l}
            </text>
          )
        })}
      </svg>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
        <SqRow
          label="Pressure Δ"
          value={
            squall.pressureSlope !== null
              ? `${squall.pressureSlope > 0 ? "+" : ""}${squall.pressureSlope} hPa/hr`
              : "Accumulating…"
          }
          color={squall.pressureSlope !== null && squall.pressureSlope < -1.2 ? "#f97316" : "rgba(200,220,255,0.65)"}
        />
        <SqRow
          label="Wind Shift"
          value={squall.windVariation !== null ? `${squall.windVariation}°` : "—"}
          color={squall.windVariation !== null && squall.windVariation > 15 ? "#f97316" : "rgba(200,220,255,0.65)"}
        />
        <div style={{ fontSize: 10, color: "rgba(200,220,255,0.2)", marginTop: 2, letterSpacing: "0.08em" }}>
          Pressure 50% · Wind shift 50%
        </div>
      </div>
    </div>
  )
}
const SqRow = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11,
      fontFamily: "'Share Tech Mono', monospace",
      padding: "4px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
  >
    <span style={{ color: "rgba(200,220,255,0.4)" }}>{label}</span>
    <span style={{ color }}>{value}</span>
  </div>
)

// ─── WIND HISTORY CHART ───────────────────────────────────────────────────────
const WindHistoryChart = ({ samples, zones }: { samples: WindSample[]; zones: SkZone[] }) => {
  const W = 100
  const H_SPD = 58
  const H_DIR = 18
  const GAP = 4

  if (samples.length < 2)
    return (
      <div
        style={{
          height: H_SPD + GAP + H_DIR,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(200,220,255,0.2)",
          fontSize: 11,
          fontFamily: "'Share Tech Mono', monospace",
        }}
      >
        Collecting history…
      </div>
    )
  const now = Date.now()
  const tMin = now - WIND_HISTORY_MINUTES * 60 * 1000
  const maxV = Math.max(...samples.map((s) => s.gust), 20)
  const xOf = (t: number) => ((t - tMin) / (now - tMin)) * W
  const ySpd = (v: number) => H_SPD * (1 - (v / maxV) * 0.9)
  const yDir = (d: number) => H_DIR * (d / 360)

  const twsPts = samples.map((s) => `${xOf(s.t)},${ySpd(s.tws)}`).join(" ")
  const gustPts = samples.map((s) => `${xOf(s.t)},${ySpd(s.gust)}`).join(" ")
  const area = `${xOf(samples[0].t)},${H_SPD} ${twsPts} ${xOf(samples[samples.length - 1].t)},${H_SPD}`

  const timeLbls: { x: number; label: string }[] = []
  for (let m = 0; m <= WIND_HISTORY_MINUTES; m += 15) {
    const t = now - m * 60 * 1000
    const d = new Date(t)
    timeLbls.push({
      x: xOf(t),
      label: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    })
  }

  return (
    <div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H_SPD + GAP + H_DIR + 6}`}
        preserveAspectRatio="none"
        style={{ overflow: "visible" }}
      >
        {zones.map((z, i) => {
          const y1 = ySpd(msToKn(z.upper))
          const y2 = ySpd(msToKn(z.lower))
          return (
            <rect
              key={i}
              x={0}
              y={y1}
              width={W}
              height={Math.max(0, y2 - y1)}
              fill={ZONE_FILL[z.state] || "transparent"}
            />
          )
        })}
        {[10, 20, 30].map(
          (v) =>
            v <= maxV * 1.1 && (
              <g key={v}>
                <line
                  x1={0}
                  y1={ySpd(v)}
                  x2={W}
                  y2={ySpd(v)}
                  stroke="rgba(0,210,255,0.07)"
                  strokeWidth="0.3"
                  strokeDasharray="1,2"
                />
                <text
                  x={W + 0.5}
                  y={ySpd(v)}
                  fontSize="2.8"
                  fill="rgba(0,210,255,0.35)"
                  fontFamily="'Share Tech Mono', monospace"
                  dominantBaseline="middle"
                >
                  {v}
                </text>
              </g>
            ),
        )}
        <polygon points={area} fill="rgba(0,210,255,0.07)" />
        <polyline
          points={twsPts}
          fill="none"
          stroke="rgba(0,210,255,0.75)"
          strokeWidth="0.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={gustPts}
          fill="none"
          stroke="rgba(251,191,36,0.55)"
          strokeWidth="0.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1,1"
        />
        <rect x={0} y={H_SPD + GAP} width={W} height={H_DIR} fill="rgba(0,210,255,0.025)" />
        <line x1={0} y1={H_SPD + GAP} x2={W} y2={H_SPD + GAP} stroke="rgba(0,210,255,0.1)" strokeWidth="0.2" />
        <text
          x={-0.5}
          y={H_SPD + GAP + H_DIR / 2}
          fontSize="2.5"
          fill="rgba(0,210,255,0.3)"
          fontFamily="'Share Tech Mono', monospace"
          dominantBaseline="middle"
          textAnchor="end"
        >
          DIR
        </text>
        {samples.map((s, i) => (
          <circle key={i} cx={xOf(s.t)} cy={H_SPD + GAP + yDir(s.twd)} r="0.6" fill="rgba(0,210,255,0.5)" />
        ))}
        {timeLbls.map(({ x, label }) => (
          <g key={label}>
            <line
              x1={x}
              y1={H_SPD + GAP + H_DIR}
              x2={x}
              y2={H_SPD + GAP + H_DIR + 2}
              stroke="rgba(0,210,255,0.2)"
              strokeWidth="0.3"
            />
            <text
              x={x}
              y={H_SPD + GAP + H_DIR + 5}
              fontSize="2.8"
              fill="rgba(0,210,255,0.3)"
              fontFamily="'Share Tech Mono', monospace"
              textAnchor="middle"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 12, paddingTop: 3 }}>
        <LegLine color="rgba(0,210,255,0.75)" label="TWS" />
        <LegLine color="rgba(251,191,36,0.7)" label="Gusts" dashed />
        {zones.map((z, i) => (
          <LegLine key={i} color={ZONE_COLOR[z.state]} label={`${z.state}`} fill />
        ))}
      </div>
    </div>
  )
}

// ─── PRESSURE HISTORY CHART ───────────────────────────────────────────────────
const PressureHistoryChart = ({ samples }: { samples: PressureSample[] }) => {
  const W = 100
  const H = 78

  if (samples.length < 2)
    return (
      <div
        style={{
          height: H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(200,220,255,0.2)",
          fontSize: 11,
          fontFamily: "'Share Tech Mono', monospace",
        }}
      >
        Loading history…
      </div>
    )
  const now = Date.now()
  const tMin = samples[0].t
  const vals = samples.map((s) => s.hpa)
  const hMin = Math.min(...vals) - 0.5
  const hMax = Math.max(...vals) + 0.5
  const xOf = (t: number) => ((t - tMin) / Math.max(1, now - tMin)) * W
  const yOf = (h: number) => H - ((h - hMin) / (hMax - hMin)) * H * 0.88 - H * 0.06

  const pts = samples.map((s) => `${xOf(s.t)},${yOf(s.hpa)}`).join(" ")
  const area = `${xOf(samples[0].t)},${H} ${pts} ${xOf(samples[samples.length - 1].t)},${H}`

  // Trend: last 10 samples slope
  const recent = samples.slice(-10)
  let trend = "→"
  if (recent.length >= 2) {
    const slope = (recent[recent.length - 1].hpa - recent[0].hpa) / Math.max(1, recent.length)
    trend = slope > 0.05 ? "↑ Rising" : slope < -0.05 ? "↓ Falling" : "→ Steady"
  }
  const trendColor = trend.startsWith("↑") ? "#22c55e" : trend.startsWith("↓") ? "#ef4444" : "rgba(200,220,255,0.5)"

  const gridLevels = [hMin, (hMin + hMax) / 2, hMax].map((v) => Math.round(v * 10) / 10)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
      {/* Current value + trend */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#e8f8ff", fontFamily: "'Share Tech Mono', monospace" }}>
            {samples[samples.length - 1].hpa}
          </span>
          <span style={{ fontSize: 11, color: "rgba(200,220,255,0.4)", marginLeft: 3 }}>hPa</span>
        </div>
        <span style={{ fontSize: 11, color: trendColor, fontFamily: "'Share Tech Mono', monospace" }}>{trend}</span>
      </div>
      {/* Chart */}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: 1, overflow: "visible" }}>
        {gridLevels.map((v) => (
          <g key={v}>
            <line
              x1={0}
              y1={yOf(v)}
              x2={W}
              y2={yOf(v)}
              stroke="rgba(0,210,255,0.07)"
              strokeWidth="0.3"
              strokeDasharray="1,2"
            />
            <text
              x={W + 0.5}
              y={yOf(v)}
              fontSize="2.8"
              fill="rgba(0,210,255,0.35)"
              fontFamily="'Share Tech Mono', monospace"
              dominantBaseline="middle"
            >
              {v}
            </text>
          </g>
        ))}
        <polygon points={area} fill="rgba(147,51,234,0.08)" />
        <polyline
          points={pts}
          fill="none"
          stroke="rgba(147,51,234,0.7)"
          strokeWidth="0.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last dot */}
        <circle
          cx={xOf(samples[samples.length - 1].t)}
          cy={yOf(samples[samples.length - 1].hpa)}
          r="1.2"
          fill="rgba(147,51,234,0.9)"
        />
      </svg>
    </div>
  )
}

// ─── PROGNOSIS PANEL ──────────────────────────────────────────────────────────
const PrognosisPanel = ({ prognosis }: { prognosis: Prognosis }) => {
  const rows = [
    { label: "Season", value: prognosis.season, path: "prediction.season" },
    { label: "Prognose", value: prognosis.frontPrognose, path: "prediction.front.prognose" },
    { label: "System", value: prognosis.system, path: "system" },
    { label: "Front Wind", value: prognosis.frontWind, path: "prediction.front.wind" },
    { label: "Quadrant", value: prognosis.quadrant, path: "prediction.quadrant" },
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
            padding: "5px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(0,210,255,0.4)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: value ? "#e8f8ff" : "rgba(200,220,255,0.25)",
              fontFamily: "'Share Tech Mono', monospace",
              letterSpacing: "0.04em",
              minHeight: 18,
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

const LegLine = ({
  color,
  label,
  dashed,
  fill,
}: {
  color: string
  label: string
  dashed?: boolean
  fill?: boolean
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
    {fill ? (
      <div style={{ width: 10, height: 7, background: color, opacity: 0.5, borderRadius: 1 }} />
    ) : (
      <svg width="12" height="7">
        <line
          x1="0"
          y1="3.5"
          x2="12"
          y2="3.5"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={dashed ? "3,2" : "none"}
          strokeLinecap="round"
        />
      </svg>
    )}
    <span style={{ fontSize: 10, color: "rgba(200,220,255,0.4)" }}>{label}</span>
  </div>
)

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const MetricRow = ({ label, value, unit }: { label: string; value: number | null; unit: string }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      padding: "6px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
  >
    <span style={{ flex: 1, fontSize: 12, color: "rgba(200,220,255,0.6)", fontFamily: "'Share Tech Mono', monospace" }}>
      {label}
    </span>
    <span style={{ fontFamily: "'Share Tech Mono', monospace" }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: "#e8f8ff" }}>{value !== null ? `${value}` : "—"}</span>
      <span style={{ fontSize: 11, color: "rgba(200,220,255,0.4)", marginLeft: 2 }}>{unit}</span>
    </span>
  </div>
)

const Panel = ({
  title,
  children,
  style,
}: {
  title: string
  children: React.ReactNode
  style?: React.CSSProperties
}) => (
  <div
    style={{
      background: "rgba(0,8,20,0.88)",
      border: "1px solid rgba(0,210,255,0.08)",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        fontSize: 10,
        color: "rgba(0,210,255,0.45)",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: "1px solid rgba(0,210,255,0.08)",
        flexShrink: 0,
      }}
    >
      {title}
    </div>
    <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
)

const ConnDot = ({ live }: { live: boolean }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 11,
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
    SIGNALK {live ? "LIVE" : "…"}
  </div>
)

// ─── BAROMETER ARC — 950–1050 hPa range ──────────────────────────────────────
const BARO_ZONES = [
  { from: 0, to: 0.2, color: "#ef4444" }, // storm (<960)
  { from: 0.2, to: 0.4, color: "#f97316" }, // low
  { from: 0.4, to: 0.65, color: "#facc15" }, // unsettled
  { from: 0.65, to: 0.85, color: "#22c55e" }, // fair
  { from: 0.85, to: 1.0, color: "#38bdf8" }, // very dry / anticyclone
]

// ─── MAIN VIEW ────────────────────────────────────────────────────────────────
const WeatherView = () => {
  const { wx, prognosis, squall, windHist, pressHist, windZones, connected } = useWeatherSignalK()

  // Barometer arc colour based on pressure
  const baroColor =
    wx.pressure !== null
      ? wx.pressure < 970
        ? "#ef4444"
        : wx.pressure < 990
          ? "#f97316"
          : wx.pressure < 1005
            ? "#facc15"
            : wx.pressure < 1022
              ? "#22c55e"
              : "#38bdf8"
      : "#00d2ff"

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes scanLine { from{top:0} to{top:100%} }
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
          gap: 5,
          padding: 7,
          boxSizing: "border-box",
        }}
      >
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                color: "rgba(0,210,255,0.42)",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
              }}
            >
              Weather · Current Conditions
            </div>
            <div style={{ fontSize: 17, fontFamily: "'Cinzel', serif", color: "#daf2ff", letterSpacing: "0.12em" }}>
              Dance Of The Spirits
            </div>
          </div>
          <ConnDot live={connected} />
        </div>

        {/* ── Row 1: Wind | Barometer | Squall ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.85fr 0.85fr", gap: 5, flex: 1, minHeight: 0 }}>
          <Panel title="Wind">
            <KipWindGauge wx={wx} zones={windZones} />
          </Panel>

          <Panel title="Barometer">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
              <ArcGauge
                value={wx.pressure}
                min={950}
                max={1050}
                unit="hPa"
                label="PRESSURE"
                decimals={1}
                color={baroColor}
                zones={BARO_ZONES}
                size={190}
              />
              <div style={{ width: "100%", marginTop: -4 }}>
                <MetricRow label="Humidity" value={wx.humidity} unit="%" />
                <MetricRow label="Air Temp" value={wx.airTemp} unit="°C" />
              </div>
            </div>
          </Panel>

          <Panel title="Squall Risk">
            <SquallArcGauge squall={squall} />
          </Panel>
        </div>

        {/* ── Row 2: Wind History | Pressure History | Prognosis ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 0.9fr", gap: 5, flex: 1, minHeight: 0 }}>
          <Panel title="Wind History · 60 min">
            <WindHistoryChart samples={windHist} zones={windZones} />
          </Panel>

          <Panel title="Pressure History · 2h">
            <PressureHistoryChart samples={pressHist} />
          </Panel>

          <Panel title="Prognosis">
            <PrognosisPanel prognosis={prognosis} />
          </Panel>
        </div>
      </div>
    </>
  )
}

export default WeatherView
