/**
 * WeatherForecastView.tsx  —  Weather Screen 2 · Forecast & History (v2)
 *
 * Layout (1280×800):
 *   Row 1 — Pressure chart (hist+forecast) | Air Density arc + Dew Point arc
 *   Row 2 — Wind & Weather forecast strip (improved cards)
 *   Row 3 — Storm & Precip | Sea State (wave height SVG chart) | Tides (sine-wave chart)
 *
 * Data sources:
 *   SignalK WS  — navigation.position, environment.outside.pressure,
 *                 environment.outside.airDensity, environment.outside.dewPointTemperature,
 *                 environment.tide.*
 *   Open-Meteo  — forecast + marine (lat/lon from SK position)
 */

import React, { useState, useEffect, useCallback, useRef } from "react"

// ─── CONFIG ──────────────────────────────────────────────────────────────────
import { getConfig } from "../../config/AppConfig"
const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()
const FORECAST_HOURS = 24
const PRESSURE_HOURS = 24

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface PressureSample {
  t: number
  hpa: number
}

interface ForecastHour {
  time: string
  hour: number
  windSpeed: number
  windDir: number
  windGusts: number
  precipProb: number
  precipMm: number
  cloudCover: number
  waveHeight: number | null
  wavePeriod: number | null
  swellHeight: number | null
  pressure: number
  cape: number // J/kg — Convective Available Potential Energy
}

interface Position {
  lat: number
  lon: number
}
interface TideState {
  heightNow: number | null
  phaseNow: string | null
  timeHigh: string | null
  heightHigh: number | null
  timeLow: string | null
  heightLow: number | null
}
interface EnvState {
  airDensity: number | null // kg/m³
  dewPoint: number | null // °C
  airTemp: number | null // °C
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// SK pressure: spec says Pa, but many plugins send hPa already.
// Heuristic: if value > 50000 it's Pa → divide by 100; if < 2000 assume already hPa
const paToHpa = (v: number) => Math.round((v > 50000 ? v / 100 : v) * 10) / 10
const kToC = (v: number) => Math.round((v - 273.15) * 10) / 10
const toRad = (d: number) => (d * Math.PI) / 180
const windColor = (kn: number) => (kn > 34 ? "#ef4444" : kn > 25 ? "#f97316" : kn > 17 ? "#f59e0b" : "#22c55e")
const precipColor = (pct: number) => (pct > 70 ? "#60a5fa" : pct > 40 ? "#93c5fd" : "rgba(147,197,253,0.3)")
// CAPE helpers — Convective Available Potential Energy (J/kg)
const capeColor = (j: number) =>
  j > 2000 ? "#7c3aed" : j > 1500 ? "#ef4444" : j > 1000 ? "#f97316" : j > 250 ? "#facc15" : "#22c55e"
const capeLabel = (j: number) =>
  j > 2000 ? "EXTREME" : j > 1500 ? "STRONG" : j > 1000 ? "MODERATE" : j > 250 ? "WEAK" : "STABLE"
const fmtTime = (iso: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
const fmtLat = (d: number) => `${Math.abs(d).toFixed(4)}° ${d >= 0 ? "N" : "S"}`
const fmtLon = (d: number) => `${Math.abs(d).toFixed(4)}° ${d >= 0 ? "E" : "W"}`
const fmtAge = (ms: number | null) => {
  if (!ms) return "—"
  const min = Math.round((Date.now() - ms) / 60000)
  return min < 1 ? "just now" : `${min}m ago`
}

// ─── OPEN-METEO FETCH ─────────────────────────────────────────────────────────
async function fetchForecast(lat: number, lon: number): Promise<ForecastHour[]> {
  const wUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,precipitation,cloud_cover,surface_pressure,cape` +
    `&wind_speed_unit=kn&forecast_days=3&timezone=auto`
  const mUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&hourly=wave_height,wave_period,swell_wave_height&forecast_days=3&timezone=auto`

  const [wRes, mRes] = await Promise.all([fetch(wUrl), fetch(mUrl)])
  const [wData, mData] = await Promise.all([wRes.json(), mRes.json()])
  const hours = wData.hourly.time as string[]
  const now = Date.now()

  return hours
    .map((time: string, i: number) => ({
      time,
      hour: new Date(time).getHours(),
      windSpeed: wData.hourly.wind_speed_10m[i] ?? 0,
      windDir: wData.hourly.wind_direction_10m[i] ?? 0,
      windGusts: wData.hourly.wind_gusts_10m[i] ?? 0,
      precipProb: wData.hourly.precipitation_probability[i] ?? 0,
      precipMm: wData.hourly.precipitation[i] ?? 0,
      cloudCover: wData.hourly.cloud_cover[i] ?? 0,
      waveHeight: mData.hourly?.wave_height?.[i] ?? null,
      wavePeriod: mData.hourly?.wave_period?.[i] ?? null,
      swellHeight: mData.hourly?.swell_wave_height?.[i] ?? null,
      pressure: wData.hourly.surface_pressure[i] ?? 0,
      cape: wData.hourly.cape?.[i] ?? 0,
    }))
    .filter((h: ForecastHour) => new Date(h.time).getTime() >= now - 30 * 60 * 1000)
    .slice(0, FORECAST_HOURS)
}

// ─── SIGNALK HOOK ─────────────────────────────────────────────────────────────
function useWeatherForecastData() {
  const [position, setPosition] = useState<Position | null>(null)
  const [pressHist, setPressHist] = useState<PressureSample[]>([])
  const [forecast, setForecast] = useState<ForecastHour[]>([])
  const [forecastAge, setForecastAge] = useState<number | null>(null)
  const [skConn, setSkConn] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [env, setEnv] = useState<EnvState>({ airDensity: null, dewPoint: null, airTemp: null })
  const [tide, setTide] = useState<TideState>({
    heightNow: null,
    phaseNow: null,
    timeHigh: null,
    heightHigh: null,
    timeLow: null,
    heightLow: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sampleTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const buf = useRef<Record<string, number>>({})
  const posRef = useRef<Position | null>(null)

  const samplePressure = useCallback(() => {
    const p = buf.current["environment.outside.pressure"]
    if (p == null) return
    const now = Date.now()
    setPressHist((prev) => [
      ...prev.filter((s) => now - s.t < (PRESSURE_HOURS + 1) * 3600000),
      { t: now, hpa: paToHpa(p) },
    ])
  }, [])

  const doFetch = useCallback(async () => {
    const pos = posRef.current
    if (!pos) return
    try {
      setFetchError(null)
      const data = await fetchForecast(pos.lat, pos.lon)
      setForecast(data)
      setForecastAge(Date.now())
    } catch {
      setFetchError("Forecast unavailable — check internet connection")
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
      setSkConn(true)
      ws.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: [
            { path: "navigation.position", period: 10000, policy: "instant" },
            { path: "environment.outside.pressure", period: 60000, policy: "instant" },
            { path: "environment.outside.airDensity", period: 60000, policy: "instant" },
            { path: "environment.outside.dewPointTemperature", period: 60000, policy: "instant" },
            { path: "environment.outside.temperature", period: 60000, policy: "instant" },
            { path: "environment.tide.heightNow", period: 60000, policy: "instant" },
            { path: "environment.tide.phaseNow", period: 60000, policy: "instant" },
            { path: "environment.tide.timeHigh", period: 60000, policy: "instant" },
            { path: "environment.tide.heightHigh", period: 60000, policy: "instant" },
            { path: "environment.tide.timeLow", period: 60000, policy: "instant" },
            { path: "environment.tide.heightLow", period: 60000, policy: "instant" },
          ],
        }),
      )
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (!msg.updates) return
        for (const update of msg.updates) {
          for (const val of update.values || []) {
            if (val.path === "navigation.position" && val.value?.latitude != null) {
              const pos = { lat: val.value.latitude, lon: val.value.longitude }
              posRef.current = pos
              setPosition(pos)
            }
            if (val.path === "environment.outside.pressure" && typeof val.value === "number")
              buf.current["environment.outside.pressure"] = val.value
            if (val.path === "environment.outside.airDensity" && typeof val.value === "number") {
              // SK spec: kg/m³. Standard sea level = 1.225. Round to 4dp.
              const raw = val.value
              // Guard: some plugins send g/m³ (~1225) — normalise to kg/m³
              const kgm3 = raw > 10 ? raw / 1000 : raw
              setEnv((p) => ({ ...p, airDensity: Math.round(kgm3 * 10000) / 10000 }))
            }
            if (val.path === "environment.outside.dewPointTemperature" && typeof val.value === "number") {
              // SK spec: Kelvin. Valid dew point range roughly 233–313 K (−40 to 40°C)
              const raw = val.value
              // Guard: if outside plausible Kelvin range, treat as invalid
              const degC = raw > 200 && raw < 340 ? Math.round((raw - 273.15) * 10) / 10 : null
              setEnv((p) => ({ ...p, dewPoint: degC }))
            }
            if (val.path === "environment.outside.temperature" && typeof val.value === "number")
              setEnv((p) => ({ ...p, airTemp: kToC(val.value) }))
            if (val.path.startsWith("environment.tide."))
              setTide((prev) => ({ ...prev, [val.path.replace("environment.tide.", "")]: val.value }))
          }
        }
      } catch {
        /* ignore */
      }
    }

    ws.onerror = () => setSkConn(false)
    ws.onclose = () => {
      setSkConn(false)
      reconnRef.current = setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    connect()
    sampleTimer.current = setInterval(samplePressure, 60000)
    const init = setTimeout(() => {
      doFetch()
      fetchTimer.current = setInterval(doFetch, 30 * 60000)
    }, 2000)
    return () => {
      clearTimeout(init)
      if (reconnRef.current) clearTimeout(reconnRef.current)
      if (sampleTimer.current) clearInterval(sampleTimer.current)
      if (fetchTimer.current) clearInterval(fetchTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect, samplePressure, doFetch])

  return { position, pressHist, forecast, forecastAge, skConn, fetchError, env, tide, refetch: doFetch }
}

// ─── ARC GAUGE ────────────────────────────────────────────────────────────────
interface ArcGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  decimals?: number
  color?: string
  size?: number
  subLabel?: string
  zones?: { from: number; to: number; color: string }[]
}
const ArcGauge = ({
  value,
  min,
  max,
  unit,
  label,
  decimals = 1,
  color = "#00d2ff",
  size = 140,
  subLabel,
  zones,
}: ArcGaugeProps) => {
  const cx = size / 2
  const cy = size * 0.58
  const R = size * 0.41
  const START = 135
  const SWEEP = 270

  const ap = (pct: number, r: number) => {
    const d = START + pct * SWEEP
    return { x: cx + r * Math.cos(toRad(d)), y: cy + r * Math.sin(toRad(d)) }
  }
  const band = (p1: number, p2: number, r: number) => {
    const a = ap(p1, r)
    const b = ap(p2, r)
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${(p2 - p1) * SWEEP > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
  }

  const pct = value !== null ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const needle = ap(pct, R - 4)

  return (
    <svg width={size} height={size * 0.82} viewBox={`0 0 ${size} ${size * 0.82}`}>
      <path d={band(0, 1, R)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="9" strokeLinecap="round" />
      {(zones ?? []).map((z, i) => (
        <path
          key={i}
          d={band(z.from, z.to, R)}
          fill="none"
          stroke={z.color}
          strokeWidth="9"
          strokeLinecap="butt"
          opacity="0.28"
        />
      ))}
      {value !== null && pct > 0.01 && (
        <path
          d={band(0, pct, R)}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}77)`, transition: "all 0.8s ease" }}
        />
      )}
      {value !== null && (
        <circle
          cx={needle.x}
          cy={needle.y}
          r={5.5}
          fill={color}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "all 0.8s ease" }}
        />
      )}
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        fontSize={size * 0.16}
        fontWeight="700"
        fill="#e8f8ff"
        fontFamily="'Share Tech Mono', monospace"
      >
        {value !== null ? value.toFixed(decimals) : "—"}
      </text>
      <text
        x={cx}
        y={cy + 7}
        textAnchor="middle"
        fontSize={size * 0.08}
        fill="rgba(200,220,255,0.45)"
        fontFamily="'Share Tech Mono', monospace"
      >
        {unit}
      </text>
      <text
        x={cx}
        y={cy + 20}
        textAnchor="middle"
        fontSize={size * 0.075}
        fill={color}
        fontFamily="'Share Tech Mono', monospace"
        letterSpacing="0.08em"
      >
        {label}
      </text>
      {subLabel && (
        <text
          x={cx}
          y={cy + 31}
          textAnchor="middle"
          fontSize={size * 0.065}
          fill="rgba(200,220,255,0.28)"
          fontFamily="'Share Tech Mono', monospace"
        >
          {subLabel}
        </text>
      )}
      {[
        { p: 0, v: min },
        { p: 1, v: max },
      ].map(({ p, v }) => {
        const pt = ap(p, R + 15)
        return (
          <text
            key={p}
            x={pt.x}
            y={pt.y}
            textAnchor="middle"
            fontSize={size * 0.065}
            fill="rgba(200,220,255,0.22)"
            fontFamily="'Share Tech Mono', monospace"
          >
            {v}
          </text>
        )
      })}
    </svg>
  )
}

// ─── PRESSURE CHART (tide-style: big value header + smooth SVG curve) ─────────
const PressureChart = ({ samples, forecast }: { samples: PressureSample[]; forecast: ForecastHour[] }) => {
  const W = 320
  const H = 90
  const now = Date.now()

  const histPoints = samples.map((s) => ({ t: s.t, hpa: s.hpa, fc: false }))
  const fcPoints = forecast
    .map((h) => ({ t: new Date(h.time).getTime(), hpa: h.pressure, fc: true }))
    .filter((h) => h.t > now)
  const all = [...histPoints, ...fcPoints]

  // Trend: last 3h
  const recent = samples.slice(-3)
  let trend = ""
  let trendColor = "rgba(200,220,255,0.45)"
  if (recent.length >= 2) {
    const slope = recent[recent.length - 1].hpa - recent[0].hpa
    trend = slope > 0.3 ? `+${slope.toFixed(1)}` : slope < -0.3 ? `${slope.toFixed(1)}` : "Steady"
    trendColor = slope > 0.3 ? "#22c55e" : slope < -0.3 ? "#ef4444" : "rgba(200,220,255,0.45)"
  }

  if (all.length < 2)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "rgba(200,220,255,0.3)",
              fontFamily: "'Share Tech Mono', monospace",
              lineHeight: 1,
            }}
          >
            —
          </span>
          <span style={{ fontSize: 12, color: "rgba(200,220,255,0.3)" }}>hPa</span>
        </div>
        <div style={{ fontSize: 11, color: "rgba(200,220,255,0.2)", fontFamily: "'Share Tech Mono', monospace" }}>
          Collecting pressure history… ({samples.length} samples)
        </div>
      </div>
    )

  const tMin = Math.min(...all.map((p) => p.t))
  const tMax = Math.max(...all.map((p) => p.t))
  const hpas = all.map((p) => p.hpa)
  const hMin = Math.min(...hpas) - 1.5
  const hMax = Math.max(...hpas) + 1.5
  const xOf = (t: number) => ((t - tMin) / (tMax - tMin)) * W
  const yOf = (h: number) => H - ((h - hMin) / (hMax - hMin)) * H * 0.82 - H * 0.09

  const histPts = histPoints.map((p) => `${xOf(p.t)},${yOf(p.hpa)}`).join(" ")
  const fcPts = [
    histPoints.length > 0
      ? `${xOf(histPoints[histPoints.length - 1].t)},${yOf(histPoints[histPoints.length - 1].hpa)}`
      : "",
    ...fcPoints.map((p) => `${xOf(p.t)},${yOf(p.hpa)}`),
  ]
    .filter(Boolean)
    .join(" ")

  const nowX = xOf(now)
  const gridLevels = Array.from({ length: 4 }, (_, i) => Math.round(hMin + ((i + 0.5) * (hMax - hMin)) / 4))

  // Time labels every 6h
  const timeLbls: { x: number; label: string }[] = []
  const startH = new Date(tMin)
  startH.setMinutes(0, 0, 0)
  for (let t = startH.getTime(); t <= tMax; t += 6 * 3600000) {
    const d = new Date(t)
    timeLbls.push({
      x: xOf(t),
      label:
        d.getHours() === 0
          ? d.toLocaleDateString("en", { weekday: "short" })
          : `${String(d.getHours()).padStart(2, "0")}h`,
    })
  }

  // Weather band backgrounds
  const BARO_BANDS = [
    { lo: 0, hi: 980, fill: "rgba(239,68,68,0.06)" },
    { lo: 980, hi: 1000, fill: "rgba(249,115,22,0.05)" },
    { lo: 1000, hi: 1013, fill: "rgba(250,204,21,0.04)" },
    { lo: 1013, hi: 1025, fill: "rgba(34,197,94,0.04)" },
    { lo: 1025, hi: 9999, fill: "rgba(56,189,248,0.04)" },
  ]

  const pressColor = "#00d2ff"
  const currentHpa = samples.length > 0 ? samples[samples.length - 1].hpa : null

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Tide-style big value header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: pressColor,
            fontFamily: "'Share Tech Mono', monospace",
            lineHeight: 1,
          }}
        >
          {currentHpa !== null ? currentHpa : "—"}
        </span>
        <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>hPa</span>
        {trend && (
          <span style={{ fontSize: 13, color: trendColor, fontFamily: "'Share Tech Mono', monospace" }}>
            {trend === "Steady" ? "→ Steady" : `${Number(trend) > 0 ? "↑" : "↓"} ${trend} hPa`}
          </span>
        )}
      </div>

      {/* SVG chart */}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        {BARO_BANDS.map((b) => {
          const y1 = yOf(Math.min(b.hi, hMax + 2))
          const y2 = yOf(Math.max(b.lo, hMin - 2))
          return <rect key={b.lo} x={0} y={y1} width={W} height={Math.max(0, y2 - y1)} fill={b.fill} />
        })}
        {gridLevels.map((v) => (
          <g key={v}>
            <line
              x1={0}
              y1={yOf(v)}
              x2={W}
              y2={yOf(v)}
              stroke="rgba(0,210,255,0.06)"
              strokeWidth="0.6"
              strokeDasharray="2,4"
            />
            <text
              x={-2}
              y={yOf(v)}
              fontSize="7"
              fill="rgba(0,210,255,0.3)"
              fontFamily="'Share Tech Mono', monospace"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {v}
            </text>
          </g>
        ))}
        {fcPoints.length > 0 && <rect x={nowX} y={0} width={W - nowX} height={H} fill="rgba(147,51,234,0.04)" />}
        {histPoints.length > 1 && (
          <polygon
            points={`${xOf(histPoints[0].t)},${H} ${histPts} ${xOf(histPoints[histPoints.length - 1].t)},${H}`}
            fill="rgba(0,210,255,0.06)"
          />
        )}
        {histPoints.length > 1 && (
          <polyline
            points={histPts}
            fill="none"
            stroke="rgba(0,210,255,0.8)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {fcPoints.length > 1 && (
          <polyline
            points={fcPts}
            fill="none"
            stroke="rgba(147,51,234,0.65)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="5,3"
          />
        )}
        {histPoints.length > 0 && (
          <circle
            cx={xOf(histPoints[histPoints.length - 1].t)}
            cy={yOf(histPoints[histPoints.length - 1].hpa)}
            r="3"
            fill={pressColor}
            style={{ filter: "drop-shadow(0 0 4px #00d2ff)" }}
          />
        )}
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,80,80,0.4)" strokeWidth="1.2" />
        {timeLbls
          .filter((l) => l.x >= 0 && l.x <= W)
          .map(({ x, label }) => (
            <g key={label}>
              <line x1={x} y1={H} x2={x} y2={H + 3} stroke="rgba(0,210,255,0.15)" strokeWidth="0.5" />
              <text
                x={x}
                y={H + 9}
                textAnchor="middle"
                fontSize="6.5"
                fill="rgba(0,210,255,0.3)"
                fontFamily="'Share Tech Mono', monospace"
              >
                {label}
              </text>
            </g>
          ))}
      </svg>
      <div style={{ display: "flex", gap: 10 }}>
        <LegLine color="rgba(0,210,255,0.8)" label="Actual" />
        <LegLine color="rgba(147,51,234,0.65)" label="Forecast" dashed />
      </div>
    </div>
  )
}

// ─── FORECAST STRIP ───────────────────────────────────────────────────────────
const ForecastStrip = ({ hours }: { hours: ForecastHour[] }) => {
  if (hours.length === 0)
    return (
      <div
        style={{
          color: "rgba(200,220,255,0.2)",
          fontSize: 13,
          padding: "16px 0",
          fontFamily: "'Share Tech Mono', monospace",
        }}
      >
        Fetching forecast…
      </div>
    )

  const maxWave = Math.max(...hours.map((h) => h.waveHeight ?? 0), 0.1)

  return (
    <div style={{ display: "flex", gap: 3, width: "100%" }}>
      {hours.map((h, i) => {
        const wColor = windColor(h.windSpeed)
        const isNow = i === 0
        const dt = new Date(h.time)
        const isMidnight = dt.getHours() === 0
        const label = isMidnight
          ? dt.toLocaleDateString("en", { weekday: "short" })
          : `${String(dt.getHours()).padStart(2, "0")}h`
        const waveH = h.waveHeight ?? 0
        const wavePct = maxWave > 0 ? waveH / maxWave : 0

        return (
          <div
            key={h.time}
            style={{
              flex: 1,
              minWidth: 0,
              background: isNow ? "rgba(0,210,255,0.09)" : isMidnight ? "rgba(255,255,255,0.03)" : "rgba(0,8,20,0.6)",
              border: `1px solid ${isNow ? "rgba(0,210,255,0.25)" : isMidnight ? "rgba(255,255,255,0.1)" : "rgba(0,210,255,0.05)"}`,
              borderRadius: 5,
              padding: "5px 2px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            {/* Time */}
            <div
              style={{
                fontSize: 11,
                color: isNow ? "rgba(0,210,255,0.85)" : isMidnight ? "#e8f8ff" : "rgba(200,220,255,0.45)",
                fontWeight: isMidnight ? 700 : 400,
                letterSpacing: "0.02em",
                lineHeight: 1,
              }}
            >
              {label}
            </div>

            {/* Wind direction arrow */}
            <svg width="26" height="26" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="12" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <g transform={`rotate(${h.windDir}, 13, 13)`}>
                <line x1="13" y1="19" x2="13" y2="7" stroke={wColor} strokeWidth="2" strokeLinecap="round" />
                <polygon points="13,4 10,9 16,9" fill={wColor} />
              </g>
            </svg>

            {/* Wind speed — main value */}
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: wColor,
                fontFamily: "'Share Tech Mono', monospace",
                lineHeight: 1,
              }}
            >
              {Math.round(h.windSpeed)}
            </div>
            <div style={{ fontSize: 9, color: "rgba(200,220,255,0.3)", lineHeight: 1 }}>kn</div>

            {/* Gust */}
            <div
              style={{
                fontSize: 11,
                color: "rgba(251,191,36,0.65)",
                fontFamily: "'Share Tech Mono', monospace",
                lineHeight: 1,
              }}
            >
              ↑{Math.round(h.windGusts)}
            </div>

            {/* Precip bar + value */}
            <div
              style={{
                width: "88%",
                height: 26,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: 1,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(1, h.precipProb * 0.22)}px`,
                  background: precipColor(h.precipProb),
                  borderRadius: "1px 1px 0 0",
                  transition: "height 0.3s",
                }}
              />
              <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)" }} />
              <div
                style={{
                  fontSize: 10,
                  color: precipColor(h.precipProb),
                  textAlign: "center",
                  fontFamily: "'Share Tech Mono', monospace",
                  lineHeight: 1,
                }}
              >
                {h.precipProb}%
              </div>
            </div>

            {/* Wave height */}
            {h.waveHeight !== null && (
              <div style={{ width: "88%", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <div
                  style={{
                    width: "100%",
                    height: `${Math.max(1, wavePct * 16)}px`,
                    background: "rgba(56,189,248,0.38)",
                    borderRadius: "1px 1px 0 0",
                    transition: "height 0.3s",
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(56,189,248,0.6)",
                    fontFamily: "'Share Tech Mono', monospace",
                    lineHeight: 1,
                  }}
                >
                  {h.waveHeight.toFixed(1)}m
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── STORM / PRECIP PANEL ─────────────────────────────────────────────────────
const StormPanel = ({ hours }: { hours: ForecastHour[] }) => {
  if (hours.length === 0) return null
  const next12 = hours.slice(0, 12)
  const maxPrecip = Math.max(...next12.map((h) => h.precipProb))
  const maxGusts = Math.max(...next12.map((h) => h.windGusts))
  const maxCloud = Math.max(...next12.map((h) => h.cloudCover))
  const stormRisk = maxPrecip > 70 || maxGusts > 34

  // Precip probability SVG curve — same idiom as TideChart
  const W = 260
  const H = 80
  const precipHours = hours.slice(0, 24)
  const nowMs = Date.now()
  const tStart = new Date(precipHours[0]?.time ?? nowMs).getTime()
  const tEnd = new Date(precipHours[precipHours.length - 1]?.time ?? nowMs + 24 * 3600000).getTime()
  const xOf = (t: number) => ((t - tStart) / Math.max(1, tEnd - tStart)) * W
  const yOf = (pct: number) => H - (pct / 100) * H * 0.88 - H * 0.06
  const nowX = Math.max(0, Math.min(W, xOf(nowMs)))

  const curvePts = precipHours.map((h) => `${xOf(new Date(h.time).getTime())},${yOf(h.precipProb)}`).join(" ")
  const areaStr = `${xOf(tStart)},${H} ${curvePts} ${xOf(tEnd)},${H}`

  const timeLbls: { x: number; label: string }[] = []
  precipHours.forEach((h) => {
    if (h.hour % 6 === 0) {
      const t = new Date(h.time).getTime()
      timeLbls.push({ x: xOf(t), label: `${String(h.hour).padStart(2, "0")}h` })
    }
  })

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {stormRisk && (
        <div
          style={{
            padding: "5px 10px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            fontSize: 11,
            color: "#ef4444",
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.08em",
          }}
        >
          ⚠ STORM CONDITIONS POSSIBLE
        </div>
      )}
      <div style={{ fontSize: 10, color: "rgba(0,210,255,0.35)", letterSpacing: "0.2em" }}>NEXT 12H PEAK</div>
      <StormEventRow
        icon="🌧"
        label="PRECIP"
        value={`${maxPrecip}%`}
        color={maxPrecip > 70 ? "#ef4444" : "#60a5fa"}
        warn={maxPrecip > 70}
      />
      <StormEventRow
        icon="💨"
        label="GUSTS"
        value={`${Math.round(maxGusts)} kn`}
        color={maxGusts > 34 ? "#ef4444" : "#f59e0b"}
        warn={maxGusts > 34}
      />
      <StormEventRow icon="☁" label="CLOUD" value={`${maxCloud}%`} color="rgba(200,220,255,0.6)" warn={false} />
      <div style={{ fontSize: 10, color: "rgba(0,210,255,0.35)", letterSpacing: "0.2em", marginTop: 4 }}>
        PRECIP PROBABILITY · 24H
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <line
          x1={0}
          y1={yOf(70)}
          x2={W}
          y2={yOf(70)}
          stroke="rgba(239,68,68,0.25)"
          strokeWidth="0.8"
          strokeDasharray="3,4"
        />
        <text
          x={W + 1}
          y={yOf(70)}
          fontSize="6"
          fill="rgba(239,68,68,0.35)"
          fontFamily="'Share Tech Mono', monospace"
          dominantBaseline="middle"
        >
          70%
        </text>
        <polygon points={areaStr} fill="rgba(96,165,250,0.1)" />
        <polyline
          points={curvePts}
          fill="none"
          stroke="rgba(96,165,250,0.65)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,80,80,0.45)" strokeWidth="1.2" />
        {precipHours.length > 0 && (
          <circle
            cx={nowX}
            cy={yOf(precipHours[0].precipProb)}
            r="3"
            fill="rgba(96,165,250,0.9)"
            style={{ filter: "drop-shadow(0 0 3px #60a5fa)" }}
          />
        )}
        {timeLbls.map(({ x, label }) => (
          <g key={label}>
            <line x1={x} y1={H} x2={x} y2={H + 3} stroke="rgba(200,220,255,0.1)" strokeWidth="0.5" />
            <text
              x={x}
              y={H + 9}
              textAnchor="middle"
              fontSize="6"
              fill="rgba(200,220,255,0.28)"
              fontFamily="'Share Tech Mono', monospace"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

const StormEventRow = ({
  icon,
  label,
  value,
  color,
  warn,
}: {
  icon: string
  label: string
  value: string
  color: string
  warn: boolean
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "5px 8px",
      background: warn ? "rgba(239,68,68,0.07)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${warn ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.05)"}`,
      borderRadius: 6,
    }}
  >
    <span style={{ fontSize: 16 }}>{icon}</span>
    <div style={{ flex: 1, fontSize: 10, color: "rgba(200,220,255,0.35)", letterSpacing: "0.12em" }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'Share Tech Mono', monospace", lineHeight: 1 }}>
      {value}
    </div>
  </div>
)

// ─── WAVE HEIGHT CHART (Open-Meteo style) ─────────────────────────────────────
// Stepwise area chart like the waveheight.jpg reference — light blue area + line
const WaveHeightChart = ({ hours }: { hours: ForecastHour[] }) => {
  const W = 300
  const H = 80
  const waves = hours.filter((h) => h.waveHeight !== null)
  if (waves.length < 2)
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
        Fetching wave data…
      </div>
    )

  const maxH = Math.max(...waves.map((h) => h.waveHeight!), 0.5) * 1.15
  const xOf = (i: number) => (i / (waves.length - 1)) * W
  const yOf = (h: number) => H - (h / maxH) * H * 0.85 - H * 0.05

  // Step-line path (like open-meteo): hold each value until next sample
  let stepPath = `M ${xOf(0)},${yOf(waves[0].waveHeight!)}`
  for (let i = 1; i < waves.length; i++) {
    stepPath += ` L ${xOf(i)},${yOf(waves[i - 1].waveHeight!)}` // horizontal hold
    stepPath += ` L ${xOf(i)},${yOf(waves[i].waveHeight!)}` // vertical step
  }
  const areaPath = stepPath + ` L ${xOf(waves.length - 1)},${H} L ${xOf(0)},${H} Z`

  // Smooth line overlay
  const smoothPts = waves.map((h, i) => `${xOf(i)},${yOf(h.waveHeight!)}`).join(" ")

  // Grid lines
  const gridVals = [0.5, 1, 1.5, 2, 3].filter((v) => v <= maxH)

  // Time labels — every 12h
  const timeLbls: { i: number; label: string }[] = []
  waves.forEach((h, i) => {
    const dt = new Date(h.time)
    if (dt.getHours() === 0 || dt.getHours() === 12) {
      const lbl = dt.getHours() === 0 ? dt.toLocaleDateString("en", { month: "short", day: "numeric" }) : "12:00"
      timeLbls.push({ i, label: lbl })
    }
  })

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        {/* Grid */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={0} y1={yOf(v)} x2={W} y2={yOf(v)} stroke="rgba(56,189,248,0.1)" strokeWidth="0.5" />
            <text
              x={-2}
              y={yOf(v)}
              fontSize="5.5"
              fill="rgba(56,189,248,0.35)"
              fontFamily="'Share Tech Mono', monospace"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {v}m
            </text>
          </g>
        ))}

        {/* Area fill (step style, like reference) */}
        <path d={areaPath} fill="rgba(56,189,248,0.15)" />

        {/* Step line */}
        <path d={stepPath} fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="0.8" />

        {/* Smooth overlay line */}
        <polyline
          points={smoothPts}
          fill="none"
          stroke="rgba(56,189,248,0.75)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dot at current */}
        <circle
          cx={xOf(0)}
          cy={yOf(waves[0].waveHeight!)}
          r="2.5"
          fill="rgba(56,189,248,0.9)"
          style={{ filter: "drop-shadow(0 0 3px #38bdf8)" }}
        />

        {/* Time axis labels */}
        {timeLbls.map(({ i, label }) => (
          <g key={label}>
            <line x1={xOf(i)} y1={H} x2={xOf(i)} y2={H + 3} stroke="rgba(56,189,248,0.2)" strokeWidth="0.5" />
            <text
              x={xOf(i)}
              y={H + 8}
              textAnchor="middle"
              fontSize="5.5"
              fill="rgba(56,189,248,0.4)"
              fontFamily="'Share Tech Mono', monospace"
            >
              {label}
            </text>
          </g>
        ))}

        {/* Current value label */}
        <text
          x={xOf(0) + 4}
          y={yOf(waves[0].waveHeight!) - 3}
          fontSize="7"
          fontWeight="700"
          fill="rgba(56,189,248,0.8)"
          fontFamily="'Share Tech Mono', monospace"
        >
          {waves[0].waveHeight!.toFixed(2)}m
        </text>
      </svg>
    </div>
  )
}

// ─── SEA STATE FORECAST ───────────────────────────────────────────────────────
const SeaStateForecast = ({ hours, position }: { hours: ForecastHour[]; position: Position | null }) => {
  const nowWave = hours.find((h) => h.waveHeight !== null)
  const nowHeight = nowWave?.waveHeight ?? null
  const nowPeriod = nowWave?.wavePeriod ?? null
  const waveColor = "#38bdf8"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Tide-style header: big current value */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: waveColor,
            fontFamily: "'Share Tech Mono', monospace",
            lineHeight: 1,
          }}
        >
          {nowHeight !== null ? nowHeight.toFixed(2) : "—"}
        </span>
        <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>m</span>
        {nowPeriod !== null && (
          <>
            <span style={{ fontSize: 18, color: "rgba(56,189,248,0.4)" }}>·</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "rgba(56,189,248,0.7)",
                fontFamily: "'Share Tech Mono', monospace",
              }}
            >
              {nowPeriod.toFixed(0)}
            </span>
            <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>s period</span>
          </>
        )}
        {position && (
          <span style={{ fontSize: 9, color: "rgba(200,220,255,0.2)", marginLeft: 4 }}>
            {fmtLat(position.lat)} {fmtLon(position.lon)}
          </span>
        )}
      </div>
      {/* Chart — no table */}
      <WaveHeightChart hours={hours} />
    </div>
  )
}

// ─── TIDE SINE-WAVE CHART ─────────────────────────────────────────────────────
// Renders a smooth sine-like tide curve across ±12h window (like tides.jpg)
const PHASE_COLORS: Record<string, string> = {
  rising: "#38bdf8",
  falling: "#818cf8",
  high: "#22c55e",
  flood: "#38bdf8",
  ebb: "#818cf8",
  low: "#f59e0b",
}
const PHASE_ICONS: Record<string, string> = {
  rising: "↑",
  falling: "↓",
  high: "▲",
  flood: "↑",
  ebb: "↓",
  low: "▼",
}

const TideChart = ({ tide }: { tide: TideState }) => {
  const W = 320
  const H = 90
  const phaseKey = (tide.phaseNow || "").toLowerCase()
  const phaseColor = PHASE_COLORS[phaseKey] || "#38bdf8"
  const phaseIcon = PHASE_ICONS[phaseKey] || "~"

  const hHigh = tide.heightHigh ?? 0.5
  const hLow = tide.heightLow ?? -0.1
  const hNow = tide.heightNow ?? (hHigh + hLow) / 2

  // Generate smooth sine tide curve: use known high/low times to compute period
  const nowMs = Date.now()
  const highMs = tide.timeHigh ? new Date(tide.timeHigh).getTime() : nowMs + 6 * 3600000
  const lowMs = tide.timeLow ? new Date(tide.timeLow).getTime() : nowMs + 3 * 3600000

  // Half-period = abs(high - low) time difference
  const halfPeriod = Math.abs(highMs - lowMs)
  const period = halfPeriod > 0 ? halfPeriod * 2 : 12.4 * 3600000 // default 12.4h tidal cycle

  // Window: 6h back to 18h ahead
  const tStart = nowMs - 6 * 3600000
  const tEnd = nowMs + 18 * 3600000

  // Build curve: 120 points, sine wave phased to next high water
  const amp = (hHigh - hLow) / 2
  const mid = (hHigh + hLow) / 2
  const hMin = hLow - amp * 0.08
  const hMax = hHigh + amp * 0.08
  const yOf = (h: number) => H - ((h - hMin) / (hMax - hMin)) * H * 0.82 - H * 0.09
  const xOf = (t: number) => ((t - tStart) / (tEnd - tStart)) * W

  const N = 120
  const curvePts: string[] = []
  for (let i = 0; i <= N; i++) {
    const t = tStart + (i / N) * (tEnd - tStart)
    const phase = ((t - highMs) / period) * 2 * Math.PI
    const h = mid + amp * Math.cos(phase)
    curvePts.push(`${xOf(t)},${yOf(h)}`)
  }
  const curveStr = curvePts.join(" ")
  const areaStr = `${xOf(tStart)},${H} ${curveStr} ${xOf(tEnd)},${H}`

  // Mark high and low water events visible in window
  const events: { t: number; h: number; isHigh: boolean }[] = []
  if (tide.timeHigh && tide.heightHigh != null) {
    const t = new Date(tide.timeHigh).getTime()
    if (t >= tStart && t <= tEnd) events.push({ t, h: tide.heightHigh, isHigh: true })
  }
  if (tide.timeLow && tide.heightLow != null) {
    const t = new Date(tide.timeLow).getTime()
    if (t >= tStart && t <= tEnd) events.push({ t, h: tide.heightLow, isHigh: false })
  }

  // NOW line x
  const nowX = xOf(nowMs)

  // Time labels: every 6h
  const timeLbls: { x: number; label: string }[] = []
  const startLabel = new Date(tStart)
  startLabel.setMinutes(0, 0, 0)
  for (let t = startLabel.getTime(); t <= tEnd; t += 6 * 3600000) {
    const d = new Date(t)
    timeLbls.push({ x: xOf(t), label: `${String(d.getHours()).padStart(2, "0")}:00` })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Current height header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: phaseColor,
            fontFamily: "'Share Tech Mono', monospace",
            lineHeight: 1,
          }}
        >
          {hNow.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>m</span>
        <span style={{ fontSize: 18, color: phaseColor }}>{phaseIcon}</span>
        <span style={{ fontSize: 11, color: phaseColor, letterSpacing: "0.15em", textTransform: "uppercase" }}>
          {tide.phaseNow || "—"}
        </span>
      </div>

      {/* SVG sine chart */}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        {/* Dotted mean level line */}
        <line
          x1={0}
          y1={yOf(mid)}
          x2={W}
          y2={yOf(mid)}
          stroke="rgba(200,220,255,0.12)"
          strokeWidth="0.8"
          strokeDasharray="3,4"
        />

        {/* Area fill */}
        <polygon points={areaStr} fill={`${phaseColor}18`} />

        {/* Tide curve */}
        <polyline
          points={curveStr}
          fill="none"
          stroke={`${phaseColor}99`}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* High/low event markers */}
        {events.map((ev, i) => {
          const ex = xOf(ev.t)
          const ey = yOf(ev.h)
          const evColor = ev.isHigh ? "#22c55e" : "#f59e0b"
          const dt = new Date(ev.t)
          const evLabel = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`
          return (
            <g key={i}>
              <circle cx={ex} cy={ey} r="3.5" fill={evColor} style={{ filter: `drop-shadow(0 0 4px ${evColor})` }} />
              <text
                x={ex}
                y={ey - 7}
                textAnchor="middle"
                fontSize="7"
                fontWeight="700"
                fill={evColor}
                fontFamily="'Share Tech Mono', monospace"
              >
                {evLabel}
              </text>
              <text
                x={ex}
                y={ey + (ev.isHigh ? -17 : 13)}
                textAnchor="middle"
                fontSize="6.5"
                fill={evColor}
                fontFamily="'Share Tech Mono', monospace"
              >
                {ev.h.toFixed(2)}m
              </text>
            </g>
          )
        })}

        {/* NOW vertical line */}
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,80,80,0.5)" strokeWidth="1.2" />

        {/* Current height dot on curve */}
        <circle
          cx={nowX}
          cy={yOf(hNow)}
          r="3.5"
          fill={phaseColor}
          style={{ filter: `drop-shadow(0 0 5px ${phaseColor})` }}
        />

        {/* Time axis */}
        {timeLbls
          .filter((l) => l.x >= 0 && l.x <= W)
          .map(({ x, label }) => (
            <g key={label}>
              <line x1={x} y1={H} x2={x} y2={H + 3} stroke="rgba(200,220,255,0.1)" strokeWidth="0.5" />
              <text
                x={x}
                y={H + 9}
                textAnchor="middle"
                fontSize="6"
                fill="rgba(200,220,255,0.3)"
                fontFamily="'Share Tech Mono', monospace"
              >
                {label}
              </text>
            </g>
          ))}
      </svg>

      {/* Next events */}
      <div style={{ display: "flex", gap: 10 }}>
        <TideEvent icon="▲" label="HW" time={fmtTime(tide.timeHigh)} height={tide.heightHigh} color="#22c55e" />
        <TideEvent icon="▼" label="LW" time={fmtTime(tide.timeLow)} height={tide.heightLow} color="#f59e0b" />
      </div>

      {tide.heightNow === null && (
        <div style={{ fontSize: 10, color: "rgba(200,220,255,0.2)", marginTop: 2 }}>
          Waiting for Tidal plugin… (signalk-tidal + Stormglass.io)
        </div>
      )}
    </div>
  )
}

const TideEvent = ({
  icon,
  label,
  time,
  height,
  color,
}: {
  icon: string
  label: string
  time: string
  height: number | null
  color: string
}) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 8px",
      background: `${color}0a`,
      border: `1px solid ${color}22`,
      borderRadius: 6,
    }}
  >
    <span style={{ fontSize: 14, color }}>{icon}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: "rgba(200,220,255,0.4)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e8f8ff", fontFamily: "'Share Tech Mono', monospace" }}>
        {time}
      </div>
    </div>
    <div style={{ fontSize: 12, color, fontFamily: "'Share Tech Mono', monospace" }}>
      {height !== null ? `${height.toFixed(2)}m` : "—"}
    </div>
  </div>
)

// ─── LEGEND LINE ──────────────────────────────────────────────────────────────
const LegLine = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
    <svg width="14" height="8">
      <line
        x1="0"
        y1="4"
        x2="14"
        y2="4"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={dashed ? "4,2" : "none"}
        strokeLinecap="round"
      />
    </svg>
    <span style={{ fontSize: 10, color: "rgba(200,220,255,0.4)", letterSpacing: "0.06em" }}>{label}</span>
  </div>
)

// ─── PANEL ────────────────────────────────────────────────────────────────────
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

const ConnDot = ({ live, label }: { live: boolean; label: string }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11,
      color: "rgba(200,230,255,0.42)",
      letterSpacing: "0.12em",
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
    {label}
  </div>
)

// ─── MAIN VIEW ────────────────────────────────────────────────────────────────
const WeatherForecastView = () => {
  const { position, pressHist, forecast, forecastAge, skConn, fetchError, env, tide, refetch } =
    useWeatherForecastData()
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const dewColor = env.dewPoint !== null && env.dewPoint > 20 ? "#f59e0b" : "#38bdf8"
  const densityColor = "#818cf8"

  const histHours = pressHist.length > 0 ? Math.round((Date.now() - pressHist[0].t) / 3600000) : 0

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes scanLine { from{top:0} to{top:100%} }
        .fc-scroll::-webkit-scrollbar { height: 3px; }
        .fc-scroll::-webkit-scrollbar-track { background: transparent; }
        .fc-scroll::-webkit-scrollbar-thumb { background: rgba(0,210,255,0.2); border-radius: 2px; }
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
              Weather · Forecast & History
            </div>
            <div style={{ fontSize: 17, fontFamily: "'Cinzel', serif", color: "#daf2ff", letterSpacing: "0.12em" }}>
              Dance Of The Spirits
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {position && (
              <div style={{ fontSize: 10, color: "rgba(200,220,255,0.3)", textAlign: "right", lineHeight: 1.6 }}>
                {fmtLat(position.lat)}
                <br />
                {fmtLon(position.lon)}
              </div>
            )}
            <ConnDot live={skConn} label="SK LIVE" />
            <ConnDot live={forecast.length > 0} label={`FCST ${fmtAge(forecastAge)}`} />
            <div
              onClick={refetch}
              style={{
                cursor: "pointer",
                fontSize: 10,
                color: "rgba(0,210,255,0.4)",
                border: "1px solid rgba(0,210,255,0.15)",
                borderRadius: 4,
                padding: "3px 8px",
                letterSpacing: "0.12em",
              }}
            >
              ↺ REFRESH
            </div>
          </div>
        </div>

        {fetchError && (
          <div
            style={{
              flexShrink: 0,
              padding: "5px 10px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              fontSize: 11,
              color: "#ef4444",
            }}
          >
            ⚠ {fetchError}
          </div>
        )}

        {/* ── Row 1: Pressure Chart (50%) | Air Density + Dew Point (50%) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, flexShrink: 0 }}>
          <Panel title={`Pressure · ${histHours}h actual + 24h forecast`}>
            <PressureChart samples={pressHist} forecast={forecast} />
          </Panel>

          <Panel title="Environment">
            <div
              style={{ display: "flex", gap: 0, justifyContent: "space-evenly", alignItems: "center", height: "100%" }}
            >
              {/* Air Density */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 9, color: "rgba(0,210,255,0.35)", letterSpacing: "0.18em", marginBottom: 2 }}>
                  AIR DENSITY
                </div>
                <ArcGauge
                  value={env.airDensity}
                  min={1.15}
                  max={1.3}
                  unit="kg/m³"
                  label="DENSITY"
                  decimals={4}
                  color={densityColor}
                  size={150}
                  zones={[
                    { from: 0, to: 0.5, color: "#818cf8" },
                    { from: 0.5, to: 0.55, color: "#22c55e" },
                    { from: 0.55, to: 1.0, color: "#38bdf8" },
                  ]}
                />
              </div>
              <div style={{ width: 1, height: "80%", background: "rgba(0,210,255,0.07)", flexShrink: 0 }} />
              {/* CAPE Index */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 9, color: "rgba(0,210,255,0.35)", letterSpacing: "0.18em", marginBottom: 2 }}>
                  CAPE INDEX
                </div>
                <ArcGauge
                  value={forecast.length > 0 ? forecast[0].cape : null}
                  min={0}
                  max={2500}
                  unit="J/kg"
                  label="CAPE"
                  decimals={0}
                  color={capeColor(forecast.length > 0 ? forecast[0].cape : 0)}
                  size={150}
                  subLabel={forecast.length > 0 ? capeLabel(forecast[0].cape) : undefined}
                  zones={[
                    { from: 0, to: 0.1, color: "#22c55e" }, // 0–250  Stable
                    { from: 0.1, to: 0.4, color: "#facc15" }, // 250–1000 Weak
                    { from: 0.4, to: 0.6, color: "#f97316" }, // 1000–1500 Moderate
                    { from: 0.6, to: 0.8, color: "#ef4444" }, // 1500–2000 Strong
                    { from: 0.8, to: 1.0, color: "#7c3aed" }, // 2000–2500 Extreme
                  ]}
                />
              </div>
              <div style={{ width: 1, height: "80%", background: "rgba(0,210,255,0.07)", flexShrink: 0 }} />
              {/* Dew Point */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 9, color: "rgba(0,210,255,0.35)", letterSpacing: "0.18em", marginBottom: 2 }}>
                  DEW POINT
                </div>
                <ArcGauge
                  value={env.dewPoint}
                  min={-10}
                  max={35}
                  unit="°C"
                  label="DEW POINT"
                  decimals={1}
                  color={dewColor}
                  size={150}
                  subLabel={
                    env.dewPoint !== null && env.airTemp !== null
                      ? `Spread ${Math.round((env.airTemp - env.dewPoint) * 10) / 10}°`
                      : undefined
                  }
                  zones={[
                    { from: 0, to: 0.44, color: "#38bdf8" },
                    { from: 0.44, to: 0.67, color: "#facc15" },
                    { from: 0.67, to: 1.0, color: "#ef4444" },
                  ]}
                />
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Row 2: Forecast Strip — full width ── */}
        <Panel title="Wind & Weather Forecast · 24h" style={{ flexShrink: 0 }}>
          <ForecastStrip hours={forecast} />
        </Panel>

        {/* ── Row 3: Storm | Sea State | Tides ── */}
        <div style={{ display: "grid", gridTemplateColumns: "0.75fr 1.1fr 1.15fr", gap: 5, flex: 1, minHeight: 0 }}>
          <Panel title="Storm & Precipitation">
            <div style={{ overflowY: "auto", height: "100%" }}>
              <StormPanel hours={forecast} />
            </div>
          </Panel>

          <Panel title="Sea State Forecast">
            <div style={{ overflowY: "auto", height: "100%" }}>
              <SeaStateForecast hours={forecast} position={position} />
            </div>
          </Panel>

          <Panel title="Tides · Stormglass">
            <TideChart tide={tide} />
          </Panel>
        </div>
      </div>
    </>
  )
}

export default WeatherForecastView
