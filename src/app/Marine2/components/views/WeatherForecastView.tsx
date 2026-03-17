/**
 * WeatherForecastView.tsx  —  Weather Screen 2 · Forecast & History (v3)
 *
 * Changes from v2:
 *   - Ocean current velocity + direction added to Sea State panel
 *   - Font sizes increased throughout
 *   - Padding/gaps tightened to prevent scrolling
 */

import React, { useState, useEffect, useCallback, useRef } from "react"
import { getConfig } from "../../config/AppConfig"

const { signalkHost: SIGNALK_HOST, signalkPort: SIGNALK_PORT } = getConfig()
const FORECAST_HOURS = 24
const PRESSURE_HOURS = 24

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
  cape: number
  oceanCurrentVelocity: number | null
  oceanCurrentDirection: number | null
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
  airDensity: number | null
  dewPoint: number | null
  airTemp: number | null
}
interface OceanCurrent {
  velocity: number | null
  direction: number | null
}

const paToHpa = (v: number) => Math.round((v > 50000 ? v / 100 : v) * 10) / 10
const kToC = (v: number) => Math.round((v - 273.15) * 10) / 10
const toRad = (d: number) => (d * Math.PI) / 180
const windColor = (kn: number) => (kn > 34 ? "#ef4444" : kn > 25 ? "#f97316" : kn > 17 ? "#f59e0b" : "#22c55e")
const precipColor = (pct: number) => (pct > 70 ? "#60a5fa" : pct > 40 ? "#93c5fd" : "rgba(147,197,253,0.3)")
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
const currentColor = (kn: number) => (kn > 3 ? "#ef4444" : kn > 2 ? "#f97316" : kn > 1 ? "#f59e0b" : "#38bdf8")

// Current conditions from the `current` field in marine API response
function extractCurrentOcean(mData: any): OceanCurrent {
  return {
    velocity: mData?.current?.ocean_current_velocity ?? null,
    direction: mData?.current?.ocean_current_direction ?? null,
  }
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
  const [oceanCurrent, setOceanCurrent] = useState<OceanCurrent>({ velocity: null, direction: null })

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
      // Fetch marine separately to get current= fields
      const mUrl =
        `https://marine-api.open-meteo.com/v1/marine?latitude=${pos.lat}&longitude=${pos.lon}` +
        `&hourly=wave_height,wave_period,swell_wave_height,ocean_current_direction,ocean_current_velocity` +
        `&current=ocean_current_velocity,ocean_current_direction&forecast_days=3&timezone=auto`
      const wUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}` +
        `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,precipitation,cloud_cover,surface_pressure,cape` +
        `&wind_speed_unit=kn&forecast_days=3&timezone=auto`
      const [wRes, mRes] = await Promise.all([fetch(wUrl), fetch(mUrl)])
      const [wData, mData] = await Promise.all([wRes.json(), mRes.json()])

      // Extract current ocean conditions
      setOceanCurrent(extractCurrentOcean(mData))

      // Build forecast hours
      const hours = wData.hourly.time as string[]
      const now = Date.now()
      const data: ForecastHour[] = hours
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
          oceanCurrentVelocity: mData.hourly?.ocean_current_velocity?.[i] ?? null,
          oceanCurrentDirection: mData.hourly?.ocean_current_direction?.[i] ?? null,
        }))
        .filter((h: ForecastHour) => new Date(h.time).getTime() >= now - 30 * 60 * 1000)
        .slice(0, FORECAST_HOURS)

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
              // Normalise to kg/m³ — handle all plugin unit conventions:
              //   ~1225 g/m³ → divide by 1000 → ~1.225 kg/m³
              //   ~0.012 g/cm³ or similar tiny value → multiply by 100 → ~1.225 kg/m³
              //   ~1.225 kg/m³ → already correct
              let kgm3 = val.value
              if (kgm3 > 100)
                kgm3 = kgm3 / 1000 // g/m³ → kg/m³
              else if (kgm3 < 0.1) kgm3 = kgm3 * 100 // very small unit → kg/m³
              setEnv((p) => ({ ...p, airDensity: Math.round(kgm3 * 10000) / 10000 }))
            }
            if (val.path === "environment.outside.dewPointTemperature" && typeof val.value === "number") {
              const raw = val.value
              const degC = raw > 200 && raw < 380 ? Math.round((raw - 273.15) * 10) / 10 : null
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

  return { position, pressHist, forecast, forecastAge, skConn, fetchError, env, tide, oceanCurrent, refetch: doFetch }
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

// ─── OCEAN CURRENT DISPLAY ────────────────────────────────────────────────────
const OceanCurrentPanel = ({
  current,
  hourly,
  fill,
}: {
  current: OceanCurrent
  hourly: ForecastHour[]
  fill?: boolean
}) => {
  const vel = current.velocity // knots from API
  const dir = current.direction // degrees
  const color = vel !== null ? currentColor(vel) : "rgba(200,220,255,0.3)"

  // 12h forecast of ocean current velocity for sparkline
  const spark = hourly.slice(0, 12).map((h) => h.oceanCurrentVelocity ?? 0)
  const maxSpark = Math.max(...spark, 0.5)

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: fill ? "stretch" : "center",
        padding: "3px 0",
        height: fill ? "100%" : undefined,
      }}
    >
      {/* Compass arrow */}
      <div style={{ flexShrink: 0 }}>
        <svg width={52} height={52} viewBox="0 0 64 64">
          <circle cx={32} cy={32} r={30} fill="rgba(0,4,12,0.8)" stroke="rgba(0,210,255,0.12)" strokeWidth={1} />
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
                x={32 + (30 - 8) * Math.cos(a)}
                y={32 + (30 - 8) * Math.sin(a)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fill={l === "N" ? "#e44" : "rgba(200,220,255,0.5)"}
                fontFamily="'Share Tech Mono',monospace"
              >
                {l}
              </text>
            )
          })}
          {dir !== null ? (
            <g transform={`rotate(${dir}, 32, 32)`}>
              <line x1={32} y1={42} x2={32} y2={18} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
              <polygon points="32,12 27,20 37,20" fill={color} />
              <circle cx={32} cy={32} r={3} fill={color} />
            </g>
          ) : (
            <text
              x={32}
              y={36}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(200,220,255,0.2)"
              fontFamily="'Share Tech Mono',monospace"
            >
              —
            </text>
          )}
        </svg>
      </div>

      {/* Values */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Share Tech Mono',monospace", lineHeight: 1 }}
          >
            {vel !== null ? vel.toFixed(2) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>kn</span>
          {dir !== null && (
            <span style={{ fontSize: 14, color: "rgba(200,220,255,0.5)", fontFamily: "'Share Tech Mono',monospace" }}>
              {Math.round(dir)}°
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "rgba(0,210,255,0.4)", letterSpacing: "0.15em" }}>
          OCEAN CURRENT · REAL-TIME
        </div>
        {/* 12h sparkline with axes */}
        {spark.length > 1 && (
          <div style={{ flex: fill ? 1 : undefined, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(200,220,255,0.25)", marginBottom: 2, flexShrink: 0 }}>
              12H FORECAST
            </div>
            <div style={{ flex: 1, paddingLeft: 24, position: "relative", minHeight: 0 }}>
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 120 36"
                preserveAspectRatio="none"
                style={{ display: "block" }}
              >
                {/* X-axis baseline */}
                <line x1={0} y1={30} x2={120} y2={30} stroke="rgba(200,220,255,0.08)" strokeWidth="0.5" />
                {/* Y gridlines */}
                {[0.5, 1, 2]
                  .filter((v) => v <= maxSpark)
                  .map((v) => (
                    <line
                      key={v}
                      x1={0}
                      y1={30 - (v / maxSpark) * 26}
                      x2={120}
                      y2={30 - (v / maxSpark) * 26}
                      stroke="rgba(200,220,255,0.06)"
                      strokeWidth="0.5"
                      strokeDasharray="2,3"
                    />
                  ))}
                {spark.map((v, i) => {
                  const x = (i / (spark.length - 1)) * 118 + 1
                  const y = 30 - (v / maxSpark) * 26
                  return <circle key={i} cx={x} cy={y} r={1.5} fill={currentColor(v)} opacity={0.8} />
                })}
                <polyline
                  points={spark
                    .map((v, i) => `${(i / (spark.length - 1)) * 118 + 1},${30 - (v / maxSpark) * 26}`)
                    .join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* X-axis hour labels every 3h */}
                {spark.map((_, i) =>
                  i % 3 === 0 ? (
                    <text
                      key={i}
                      x={(i / (spark.length - 1)) * 118 + 1}
                      y={35}
                      textAnchor="middle"
                      fontSize="7"
                      fill="rgba(200,220,255,0.35)"
                      fontFamily="'Share Tech Mono',monospace"
                    >
                      {i}h
                    </text>
                  ) : null,
                )}
              </svg>
              {/* Y-axis kn labels */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, pointerEvents: "none" }}>
                {[0.5, 1, 2]
                  .filter((v) => v <= maxSpark)
                  .map((v) => (
                    <div
                      key={v}
                      style={{
                        position: "absolute",
                        right: 2,
                        top: `${(1 - v / maxSpark) * 83 + 2}%`,
                        fontSize: 8,
                        color: "rgba(200,220,255,0.4)",
                        fontFamily: "'Share Tech Mono',monospace",
                        transform: "translateY(-50%)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v}kn
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PRESSURE CHART ───────────────────────────────────────────────────────────
const PressureChart = ({ samples, forecast }: { samples: PressureSample[]; forecast: ForecastHour[] }) => {
  const W = 320
  const H = 90
  const now = Date.now()
  const histPoints = samples.map((s) => ({ t: s.t, hpa: s.hpa, fc: false }))
  const fcPoints = forecast
    .map((h) => ({ t: new Date(h.time).getTime(), hpa: h.pressure, fc: true }))
    .filter((h) => h.t > now)
  const all = [...histPoints, ...fcPoints]
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
              fontFamily: "'Share Tech Mono',monospace",
              lineHeight: 1,
            }}
          >
            —
          </span>
          <span style={{ fontSize: 12, color: "rgba(200,220,255,0.3)" }}>hPa</span>
        </div>
        <div style={{ fontSize: 11, color: "rgba(200,220,255,0.2)", fontFamily: "'Share Tech Mono',monospace" }}>
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: pressColor,
            fontFamily: "'Share Tech Mono',monospace",
            lineHeight: 1,
          }}
        >
          {currentHpa !== null ? currentHpa : "—"}
        </span>
        <span style={{ fontSize: 12, color: "rgba(200,220,255,0.4)" }}>hPa</span>
        {trend && (
          <span style={{ fontSize: 13, color: trendColor, fontFamily: "'Share Tech Mono',monospace" }}>
            {trend === "Steady" ? "→ Steady" : `${Number(trend) > 0 ? "↑" : "↓"} ${trend} hPa`}
          </span>
        )}
      </div>
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
              fontFamily="'Share Tech Mono',monospace"
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
                fontFamily="'Share Tech Mono',monospace"
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
          fontFamily: "'Share Tech Mono',monospace",
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
            <div
              style={{
                fontSize: 11,
                color: isNow ? "rgba(0,210,255,0.85)" : isMidnight ? "#e8f8ff" : "rgba(200,220,255,0.45)",
                fontWeight: isMidnight ? 700 : 400,
                lineHeight: 1,
              }}
            >
              {label}
            </div>
            <svg width="26" height="26" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="12" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <g transform={`rotate(${h.windDir}, 13, 13)`}>
                <line x1="13" y1="19" x2="13" y2="7" stroke={wColor} strokeWidth="2" strokeLinecap="round" />
                <polygon points="13,4 10,9 16,9" fill={wColor} />
              </g>
            </svg>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: wColor,
                fontFamily: "'Share Tech Mono',monospace",
                lineHeight: 1,
              }}
            >
              {Math.round(h.windSpeed)}
            </div>
            <div style={{ fontSize: 9, color: "rgba(200,220,255,0.3)", lineHeight: 1 }}>kn</div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(251,191,36,0.65)",
                fontFamily: "'Share Tech Mono',monospace",
                lineHeight: 1,
              }}
            >
              ↑{Math.round(h.windGusts)}
            </div>
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
                  fontSize: 12,
                  color: precipColor(h.precipProb),
                  textAlign: "center",
                  fontFamily: "'Share Tech Mono',monospace",
                  lineHeight: 1,
                }}
              >
                {h.precipProb}%
              </div>
            </div>
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
                    fontSize: 12,
                    color: "rgba(56,189,248,0.6)",
                    fontFamily: "'Share Tech Mono',monospace",
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

// ─── STORM PANEL ─────────────────────────────────────────────────────────────
const StormPanel = ({ hours }: { hours: ForecastHour[] }) => {
  if (hours.length === 0) return null
  const next12 = hours.slice(0, 12)
  const maxPrecip = Math.max(...next12.map((h) => h.precipProb))
  const maxGusts = Math.max(...next12.map((h) => h.windGusts))
  const maxCloud = Math.max(...next12.map((h) => h.cloudCover))
  const stormRisk = maxPrecip > 70 || maxGusts > 34
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
    <div style={{ display: "flex", flexDirection: "column", gap: 5, height: "100%" }}>
      {stormRisk && (
        <div
          style={{
            padding: "5px 10px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            fontSize: 11,
            color: "#ef4444",
            fontFamily: "'Share Tech Mono',monospace",
            letterSpacing: "0.08em",
          }}
        >
          ⚠ STORM CONDITIONS POSSIBLE
        </div>
      )}
      <div style={{ fontSize: 11, color: "rgba(0,210,255,0.35)", letterSpacing: "0.2em" }}>NEXT 12H PEAK</div>
      <StormEventRow
        icon="PRECIP"
        label="PRECIP"
        value={`${maxPrecip}%`}
        color={maxPrecip > 70 ? "#ef4444" : "#60a5fa"}
        warn={maxPrecip > 70}
      />
      <StormEventRow
        icon="GUSTS"
        label="GUSTS"
        value={`${Math.round(maxGusts)} kn`}
        color={maxGusts > 34 ? "#ef4444" : "#f59e0b"}
        warn={maxGusts > 34}
      />
      <StormEventRow icon="CLOUD" label="CLOUD" value={`${maxCloud}%`} color="rgba(200,220,255,0.6)" warn={false} />
      <div style={{ fontSize: 11, color: "rgba(0,210,255,0.35)", letterSpacing: "0.2em", marginTop: 2, flexShrink: 0 }}>
        PRECIP PROBABILITY · 24H
      </div>
      {/* Left margin wrapper so Y-axis labels are not clipped */}
      <div style={{ paddingLeft: 28, flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H + 12}`}
          preserveAspectRatio="none"
          style={{ display: "block", flex: 1 }}
        >
          {/* Y-axis labels — sit inside viewBox at left edge */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <g key={pct}>
              <line
                x1={0}
                y1={yOf(pct)}
                x2={W}
                y2={yOf(pct)}
                stroke="rgba(200,220,255,0.06)"
                strokeWidth="0.5"
                strokeDasharray="2,4"
              />
            </g>
          ))}
          {/* 70% alarm line */}
          <line
            x1={0}
            y1={yOf(70)}
            x2={W}
            y2={yOf(70)}
            stroke="rgba(239,68,68,0.35)"
            strokeWidth="1"
            strokeDasharray="3,4"
          />
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
              <line x1={x} y1={H} x2={x} y2={H + 3} stroke="rgba(200,220,255,0.15)" strokeWidth="0.6" />
              <text
                x={x}
                y={H + 11}
                textAnchor="middle"
                fontSize="8"
                fill="rgba(200,220,255,0.4)"
                fontFamily="'Share Tech Mono',monospace"
              >
                {label}
              </text>
            </g>
          ))}
        </svg>
        {/* Y-axis HTML labels — absolute inside the paddingLeft wrapper */}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 12, width: 26, pointerEvents: "none" }}>
          {[0, 25, 50, 75, 100].map((pct) => (
            <div
              key={pct}
              style={{
                position: "absolute",
                right: 2,
                top: `${(1 - pct / 100) * 88 + 2}%`,
                fontSize: 8,
                color: "rgba(200,220,255,0.4)",
                fontFamily: "'Share Tech Mono',monospace",
                transform: "translateY(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {pct}%
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STORM_ICONS: Record<string, React.ReactNode> = {
  PRECIP: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 .5a5.53 5.53 0 0 0-3.594 1.342c-.766.66-1.321 1.52-1.464 2.383C1.266 4.562 0 5.74 0 7.5 0 9.43 1.57 11 3.5 11h9c1.93 0 3.5-1.57 3.5-3.5 0-1.71-1.232-3.124-2.84-3.435a5.5 5.5 0 0 0-.138-.964C12.003 1.794 10.11 0 7.864 0L8 .5z" />
      <path d="M7 13.5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zm3 0a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zm-6 1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zm3 0a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5z" />
    </svg>
  ),
  GUSTS: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.5 2A2.5 2.5 0 0 1 15 4.5a2.5 2.5 0 0 1-2.5 2.5H.5a.5.5 0 0 1 0-1h12a1.5 1.5 0 1 0-1.364-2.133.5.5 0 1 1-.91-.418A2.5 2.5 0 0 1 12.5 2z" />
      <path d="M10 7.5A2.5 2.5 0 0 1 12.5 5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-2.5 2.5H.5a.5.5 0 0 1 0-1h12a1.5 1.5 0 0 0 0-3 1.5 1.5 0 0 0-1.364.868.5.5 0 1 1-.91-.418A2.495 2.495 0 0 1 10 7.5z" />
      <path d="M0 12.5a.5.5 0 0 1 .5-.5h7a1.5 1.5 0 1 0-1.364-2.133.5.5 0 1 1-.91-.418A2.5 2.5 0 0 1 7.5 9a2.5 2.5 0 0 1 0 5H.5a.5.5 0 0 1-.5-.5z" />
    </svg>
  ),
  CLOUD: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.513A5.53 5.53 0 0 1 4.406 3.342z" />
    </svg>
  ),
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
    <span style={{ fontSize: 16, color, opacity: 0.8 }}>{STORM_ICONS[icon] ?? icon}</span>
    <div style={{ flex: 1, fontSize: 11, color: "rgba(200,220,255,0.35)", letterSpacing: "0.12em" }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'Share Tech Mono',monospace", lineHeight: 1 }}>
      {value}
    </div>
  </div>
)

// ─── WAVE HEIGHT CHART ────────────────────────────────────────────────────────
const WaveHeightChart = ({ hours, fill }: { hours: ForecastHour[]; fill?: boolean }) => {
  const W = 300
  const H = 75
  const waves = hours.filter((h) => h.waveHeight !== null)
  if (waves.length < 2)
    return (
      <div
        style={{
          height: fill ? "100%" : H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(200,220,255,0.2)",
          fontSize: 11,
          fontFamily: "'Share Tech Mono',monospace",
        }}
      >
        Fetching wave data…
      </div>
    )
  const maxH = Math.max(...waves.map((h) => h.waveHeight!), 0.5) * 1.15
  const xOf = (i: number) => (i / (waves.length - 1)) * W
  const yOf = (h: number) => H - (h / maxH) * H * 0.85 - H * 0.05
  let stepPath = `M ${xOf(0)},${yOf(waves[0].waveHeight!)}`
  for (let i = 1; i < waves.length; i++) {
    stepPath += ` L ${xOf(i)},${yOf(waves[i - 1].waveHeight!)} L ${xOf(i)},${yOf(waves[i].waveHeight!)}`
  }
  const areaPath = stepPath + ` L ${xOf(waves.length - 1)},${H} L ${xOf(0)},${H} Z`
  const smoothPts = waves.map((h, i) => `${xOf(i)},${yOf(h.waveHeight!)}`).join(" ")
  const gridVals = [0.5, 1, 1.5, 2, 3].filter((v) => v <= maxH)
  const timeLbls: { i: number; label: string }[] = []
  waves.forEach((h, i) => {
    const dt = new Date(h.time)
    if (dt.getHours() === 0 || dt.getHours() === 12)
      timeLbls.push({
        i,
        label: dt.getHours() === 0 ? dt.toLocaleDateString("en", { month: "short", day: "numeric" }) : "12:00",
      })
  })
  return (
    <div
      style={{
        paddingLeft: 26,
        height: fill ? "100%" : H,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", flex: 1 }}
      >
        {gridVals.map((v) => (
          <line
            key={v}
            x1={0}
            y1={yOf(v)}
            x2={W}
            y2={yOf(v)}
            stroke="rgba(56,189,248,0.1)"
            strokeWidth="0.5"
            strokeDasharray="2,3"
          />
        ))}
        <path d={areaPath} fill="rgba(56,189,248,0.15)" />
        <path d={stepPath} fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="0.8" />
        <polyline
          points={smoothPts}
          fill="none"
          stroke="rgba(56,189,248,0.75)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={xOf(0)}
          cy={yOf(waves[0].waveHeight!)}
          r="2.5"
          fill="rgba(56,189,248,0.9)"
          style={{ filter: "drop-shadow(0 0 3px #38bdf8)" }}
        />
        {timeLbls.map(({ i, label }) => (
          <g key={label}>
            <line x1={xOf(i)} y1={H} x2={xOf(i)} y2={H + 2} stroke="rgba(56,189,248,0.25)" strokeWidth="0.6" />
            <text
              x={xOf(i)}
              y={H - 2}
              textAnchor="middle"
              fontSize="8"
              fill="rgba(56,189,248,0.5)"
              fontFamily="'Share Tech Mono',monospace"
            >
              {label}
            </text>
          </g>
        ))}
        <text
          x={xOf(0) + 4}
          y={yOf(waves[0].waveHeight!) - 3}
          fontSize="8"
          fontWeight="700"
          fill="rgba(56,189,248,0.9)"
          fontFamily="'Share Tech Mono',monospace"
        >
          {waves[0].waveHeight!.toFixed(2)}m
        </text>
      </svg>
      {/* Y-axis HTML labels */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 24, pointerEvents: "none" }}>
        {gridVals.map((v) => (
          <div
            key={v}
            style={{
              position: "absolute",
              right: 2,
              top: `${(1 - v / maxH) * 85 + 3}%`,
              fontSize: 8,
              color: "rgba(56,189,248,0.5)",
              fontFamily: "'Share Tech Mono',monospace",
              transform: "translateY(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            {v}m
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SEA STATE PANEL ──────────────────────────────────────────────────────────
const SeaStateForecast = ({
  hours,
  position,
  oceanCurrent,
}: {
  hours: ForecastHour[]
  position: Position | null
  oceanCurrent: OceanCurrent
}) => {
  const nowWave = hours.find((h) => h.waveHeight !== null)
  const nowHeight = nowWave?.waveHeight ?? null
  const nowPeriod = nowWave?.wavePeriod ?? null
  const waveColor = "#38bdf8"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, height: "100%" }}>
      {/* Wave header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: waveColor,
            fontFamily: "'Share Tech Mono',monospace",
            lineHeight: 1,
          }}
        >
          {nowHeight !== null ? nowHeight.toFixed(2) : "—"}
        </span>
        <span style={{ fontSize: 11, color: "rgba(200,220,255,0.4)" }}>m</span>
        {nowPeriod !== null && (
          <>
            <span style={{ fontSize: 18, color: "rgba(56,189,248,0.4)" }}>·</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "rgba(56,189,248,0.7)",
                fontFamily: "'Share Tech Mono',monospace",
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
      {/* Wave chart — grows to fill */}
      <div style={{ flex: 1, minHeight: 60, position: "relative" }}>
        <WaveHeightChart hours={hours} fill />
      </div>
      {/* Divider */}
      <div style={{ flexShrink: 0, height: 1, background: "rgba(0,210,255,0.08)", margin: "2px 0" }} />
      {/* Ocean current — grows to fill */}
      <div style={{ flex: 1, minHeight: 60 }}>
        <OceanCurrentPanel current={oceanCurrent} hourly={hours} fill />
      </div>
    </div>
  )
}

// ─── TIDE CHART ───────────────────────────────────────────────────────────────
const PHASE_COLORS: Record<string, string> = {
  rising: "#38bdf8",
  falling: "#818cf8",
  high: "#22c55e",
  flood: "#38bdf8",
  ebb: "#818cf8",
  low: "#f59e0b",
}
const PHASE_ICONS: Record<string, string> = { rising: "↑", falling: "↓", high: "▲", flood: "↑", ebb: "↓", low: "▼" }

const TideChart = ({ tide }: { tide: TideState }) => {
  const W = 320
  const H = 85
  const phaseKey = (tide.phaseNow || "").toLowerCase()
  const phaseColor = PHASE_COLORS[phaseKey] || "#38bdf8"
  const phaseIcon = PHASE_ICONS[phaseKey] || "~"
  const hHigh = tide.heightHigh ?? 0.5
  const hLow = tide.heightLow ?? -0.1
  const hNow = tide.heightNow ?? (hHigh + hLow) / 2
  const nowMs = Date.now()
  const highMs = tide.timeHigh ? new Date(tide.timeHigh).getTime() : nowMs + 6 * 3600000
  const lowMs = tide.timeLow ? new Date(tide.timeLow).getTime() : nowMs + 3 * 3600000
  const halfPeriod = Math.abs(highMs - lowMs)
  const period = halfPeriod > 0 ? halfPeriod * 2 : 12.4 * 3600000
  const tStart = nowMs - 6 * 3600000
  const tEnd = nowMs + 18 * 3600000
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
    curvePts.push(`${xOf(t)},${yOf(mid + amp * Math.cos(phase))}`)
  }
  const curveStr = curvePts.join(" ")
  const areaStr = `${xOf(tStart)},${H} ${curveStr} ${xOf(tEnd)},${H}`
  const events: { t: number; h: number; isHigh: boolean }[] = []
  if (tide.timeHigh && tide.heightHigh != null) {
    const t = new Date(tide.timeHigh).getTime()
    if (t >= tStart && t <= tEnd) events.push({ t, h: tide.heightHigh, isHigh: true })
  }
  if (tide.timeLow && tide.heightLow != null) {
    const t = new Date(tide.timeLow).getTime()
    if (t >= tStart && t <= tEnd) events.push({ t, h: tide.heightLow, isHigh: false })
  }
  const nowX = xOf(nowMs)
  const timeLbls: { x: number; label: string }[] = []
  const startLabel = new Date(tStart)
  startLabel.setMinutes(0, 0, 0)
  for (let t = startLabel.getTime(); t <= tEnd; t += 6 * 3600000) {
    const d = new Date(t)
    timeLbls.push({ x: xOf(t), label: `${String(d.getHours()).padStart(2, "0")}:00` })
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: phaseColor,
            fontFamily: "'Share Tech Mono',monospace",
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
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <line
          x1={0}
          y1={yOf(mid)}
          x2={W}
          y2={yOf(mid)}
          stroke="rgba(200,220,255,0.12)"
          strokeWidth="0.8"
          strokeDasharray="3,4"
        />
        <polygon points={areaStr} fill={`${phaseColor}18`} />
        <polyline
          points={curveStr}
          fill="none"
          stroke={`${phaseColor}99`}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
                fontFamily="'Share Tech Mono',monospace"
              >
                {evLabel}
              </text>
              <text
                x={ex}
                y={ey + (ev.isHigh ? -17 : 13)}
                textAnchor="middle"
                fontSize="6.5"
                fill={evColor}
                fontFamily="'Share Tech Mono',monospace"
              >
                {ev.h.toFixed(2)}m
              </text>
            </g>
          )
        })}
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,80,80,0.5)" strokeWidth="1.2" />
        <circle
          cx={nowX}
          cy={yOf(hNow)}
          r="3.5"
          fill={phaseColor}
          style={{ filter: `drop-shadow(0 0 5px ${phaseColor})` }}
        />
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
                fontFamily="'Share Tech Mono',monospace"
              >
                {label}
              </text>
            </g>
          ))}
      </svg>
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
      <div style={{ fontSize: 11, color: "rgba(200,220,255,0.4)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#e8f8ff", fontFamily: "'Share Tech Mono',monospace" }}>
        {time}
      </div>
    </div>
    <div style={{ fontSize: 14, color, fontFamily: "'Share Tech Mono',monospace" }}>
      {height !== null ? `${height.toFixed(2)}m` : "—"}
    </div>
  </div>
)

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
    <span style={{ fontSize: 11, color: "rgba(200,220,255,0.4)", letterSpacing: "0.06em" }}>{label}</span>
  </div>
)

// ─── PANEL + CONNDOT ──────────────────────────────────────────────────────────
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
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        fontSize: 11,
        color: "rgba(0,210,255,0.45)",
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        marginBottom: 5,
        paddingBottom: 4,
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
  const { position, pressHist, forecast, forecastAge, skConn, fetchError, env, tide, oceanCurrent, refetch } =
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
          fontFamily: "'Share Tech Mono',monospace",
          overflow: "hidden",
          position: "relative",
          gap: 4,
          padding: 5,
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
              Weather · Forecast & History
            </div>
            <div style={{ fontSize: 16, fontFamily: "'Cinzel',serif", color: "#daf2ff", letterSpacing: "0.12em" }}>
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

        {/* Row 1: Pressure | Environment */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, flexShrink: 0 }}>
          <Panel title={`Pressure · ${histHours}h actual + 24h forecast`}>
            <PressureChart samples={pressHist} forecast={forecast} />
          </Panel>
          <Panel title="Environment">
            <div
              style={{ display: "flex", gap: 0, justifyContent: "space-evenly", alignItems: "center", height: "100%" }}
            >
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
                    { from: 0, to: 0.1, color: "#22c55e" },
                    { from: 0.1, to: 0.4, color: "#facc15" },
                    { from: 0.4, to: 0.6, color: "#f97316" },
                    { from: 0.6, to: 0.8, color: "#ef4444" },
                    { from: 0.8, to: 1.0, color: "#7c3aed" },
                  ]}
                />
              </div>
              <div style={{ width: 1, height: "80%", background: "rgba(0,210,255,0.07)", flexShrink: 0 }} />
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

        {/* Row 2: Forecast Strip */}
        <Panel title="Wind & Weather Forecast · 24h" style={{ flexShrink: 0 }}>
          <ForecastStrip hours={forecast} />
        </Panel>

        {/* Row 3: Storm | Sea State (with ocean current) | Tides */}
        <div style={{ display: "grid", gridTemplateColumns: "0.75fr 1.1fr 1.15fr", gap: 4, flex: 1, minHeight: 0 }}>
          <Panel title="Storm & Precipitation">
            <StormPanel hours={forecast} />
          </Panel>
          <Panel title="Sea State · Waves & Current">
            <SeaStateForecast hours={forecast} position={position} oceanCurrent={oceanCurrent} />
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
