import { useEffect, useState, useRef } from "react"

// Base64 vessel image - replace with your actual asset import in production:
import vesselImg from "../../../images/vessel.jpg"

// ─── Types ────────────────────────────────────────────────────────────────────
interface SplashScreenProps {
  onComplete?: () => void
  duration?: number // ms before auto-dismissing (default 4000)
  vesselName?: string
}

// ─── Compass Rose SVG ─────────────────────────────────────────────────────────
const CompassRose = ({ spin }: { spin: boolean }) => (
  <svg
    viewBox="0 0 200 200"
    width="220"
    height="220"
    style={{
      animation: spin ? "compassSpin 8s linear infinite" : "none",
      filter: "drop-shadow(0 0 18px rgba(0,210,255,0.55))",
    }}
  >
    {/* Outer ring */}
    <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(0,210,255,0.18)" strokeWidth="1.5" />
    <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(0,210,255,0.08)" strokeWidth="0.8" />

    {/* Tick marks */}
    {Array.from({ length: 72 }).map((_, i) => {
      const angle = (i * 5 * Math.PI) / 180
      const isMajor = i % 9 === 0
      const inner = isMajor ? 82 : 86
      const x1 = 100 + 90 * Math.sin(angle)
      const y1 = 100 - 90 * Math.cos(angle)
      const x2 = 100 + inner * Math.sin(angle)
      const y2 = 100 - inner * Math.cos(angle)
      return (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={isMajor ? "rgba(0,210,255,0.7)" : "rgba(0,210,255,0.3)"}
          strokeWidth={isMajor ? "1.5" : "0.8"}
        />
      )
    })}

    {/* Cardinal labels */}
    {[
      { label: "N", x: 100, y: 14, fill: "#00d2ff" },
      { label: "S", x: 100, y: 192, fill: "rgba(0,210,255,0.6)" },
      { label: "E", x: 189, y: 105, fill: "rgba(0,210,255,0.6)" },
      { label: "W", x: 11, y: 105, fill: "rgba(0,210,255,0.6)" },
    ].map(({ label, x, y, fill }) => (
      <text
        key={label}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="'Courier New', monospace"
        fill={fill}
        letterSpacing="2"
      >
        {label}
      </text>
    ))}

    {/* North arrow */}
    <polygon points="100,28 95,100 100,92 105,100" fill="#00d2ff" opacity="0.9" />
    {/* South arrow */}
    <polygon points="100,172 95,100 100,108 105,100" fill="rgba(0,210,255,0.35)" />

    {/* East/West bars */}
    <polygon points="28,100 100,95 92,100 100,105" fill="rgba(0,210,255,0.35)" />
    <polygon points="172,100 100,95 108,100 100,105" fill="rgba(0,210,255,0.35)" />

    {/* Centre hub */}
    <circle cx="100" cy="100" r="7" fill="#001a2e" stroke="#00d2ff" strokeWidth="1.5" />
    <circle cx="100" cy="100" r="3" fill="#00d2ff" />
  </svg>
)

// ─── Animated wave SVG rows ────────────────────────────────────────────────────
const Waves = () => (
  <svg viewBox="0 0 1440 120" preserveAspectRatio="none" style={{ width: "100%", height: 120, display: "block" }}>
    {[
      { d: "M0,60 C360,110 720,10 1080,60 C1260,85 1350,55 1440,60 L1440,120 L0,120 Z", opacity: 0.18, delay: "0s" },
      { d: "M0,70 C240,20  600,100 960,55 C1140,35 1320,80 1440,65 L1440,120 L0,120 Z", opacity: 0.12, delay: "1.4s" },
      { d: "M0,50 C300,90  720,30 1080,70 C1260,90 1380,45 1440,55 L1440,120 L0,120 Z", opacity: 0.08, delay: "0.7s" },
    ].map((w, i) => (
      <path
        key={i}
        d={w.d}
        fill={`rgba(0,210,255,${w.opacity})`}
        style={{ animation: `waveDrift 6s ease-in-out ${w.delay} infinite alternate` }}
      />
    ))}
  </svg>
)

// ─── Main Component ────────────────────────────────────────────────────────────
const SplashScreen = ({ onComplete, duration = 4500, vesselName = "Dance Of The Spirits" }: SplashScreenProps) => {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter")
  const [progress, setProgress] = useState(0)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── progress bar
  useEffect(() => {
    const step = 100 / ((duration - 800) / 50)
    progressRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + step, 100))
    }, 50)
    return () => {
      if (progressRef.current) clearInterval(progressRef.current)
    }
  }, [duration])

  // ── phase timing
  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase("hold"), 400)
    const exitTimer = setTimeout(() => setPhase("exit"), duration - 600)
    const doneTimer = setTimeout(() => onComplete?.(), duration)
    return () => {
      clearTimeout(holdTimer)
      clearTimeout(exitTimer)
      clearTimeout(doneTimer)
    }
  }, [duration, onComplete])

  const isVisible = phase !== "exit"

  return (
    <>
      {/* ── Global keyframes injected once ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Share+Tech+Mono&display=swap');

        @keyframes waveDrift {
          from { transform: translateX(-30px) scaleY(1); }
          to   { transform: translateX( 30px) scaleY(1.08); }
        }
        @keyframes compassSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 20px rgba(0,210,255,0.6), 0 0 60px rgba(0,210,255,0.25); }
          50%       { text-shadow: 0 0 40px rgba(0,210,255,0.9), 0 0 100px rgba(0,210,255,0.45); }
        }
        @keyframes scanLine {
          0%   { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes particleFloat {
          0%   { transform: translateY(0px)   scale(1);    opacity: 0.7; }
          50%  { transform: translateY(-18px) scale(1.15); opacity: 1;   }
          100% { transform: translateY(0px)   scale(1);    opacity: 0.7; }
        }
        @keyframes vesselGlow {
          0%,100% { filter: brightness(1)   drop-shadow(0 0 18px rgba(0,210,255,0.45)); }
          50%      { filter: brightness(1.1) drop-shadow(0 0 40px rgba(0,210,255,0.80)); }
        }
        @keyframes horizonShimmer {
          0%,100% { opacity: 0.4; }
          50%      { opacity: 0.9; }
        }
        @keyframes progressFill {
          from { width: 0; }
        }
        .splash-enter  { animation: fadeInUp 0.7s ease forwards; }
        .splash-exit   { animation: fadeInUp 0.5s ease reverse forwards; }
      `}</style>

      {/* ── Backdrop ── */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "radial-gradient(ellipse at 50% 60%, #001e3c 0%, #000d1a 55%, #000509 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: isVisible ? 1 : 0,
          transition: "opacity 0.6s ease",
          fontFamily: "'Share Tech Mono', monospace",
        }}
      >
        {/* ── Subtle scan line ── */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            background: "linear-gradient(90deg, transparent, rgba(0,210,255,0.25), transparent)",
            animation: "scanLine 4s linear infinite",
            pointerEvents: "none",
          }}
        />

        {/* ── Star particles ── */}
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: Math.random() * 2 + 1,
              height: Math.random() * 2 + 1,
              borderRadius: "50%",
              background: "rgba(0,210,255,0.6)",
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 70}%`,
              animation: `particleFloat ${3 + Math.random() * 4}s ease-in-out ${Math.random() * 3}s infinite`,
            }}
          />
        ))}

        {/* ── Horizon glow line ── */}
        <div
          style={{
            position: "absolute",
            bottom: 160,
            left: "5%",
            right: "5%",
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(0,210,255,0.6) 20%, rgba(0,210,255,0.9) 50%, rgba(0,210,255,0.6) 80%, transparent)",
            animation: "horizonShimmer 3s ease-in-out infinite",
          }}
        />

        {/* ── Compass rose (top-right) ── */}
        <div style={{ position: "absolute", top: 24, right: 32, opacity: 0.75 }}>
          <CompassRose spin />
        </div>

        {/* ── System ID badge (top-left) ── */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 28,
            fontSize: 10,
            color: "rgba(0,210,255,0.5)",
            letterSpacing: 2,
            lineHeight: 1.9,
            animation: "fadeInUp 1s ease 0.8s both",
          }}
        >
          <div>SYS › VENUS OS 3.7</div>
          <div>MQTT › 192.168.76.100:9001</div>
          <div>VRM › dca63208dd75</div>
        </div>

        {/* ── Vessel image ── */}
        <div
          className={phase === "enter" ? "splash-enter" : ""}
          style={{
            marginBottom: 8,
            animation: "vesselGlow 3s ease-in-out infinite",
            animationDelay: "1s",
          }}
        >
          <img
            src={vesselImg}
            alt="Vessel"
            style={{
              width: 320,
              height: "auto",
              borderRadius: 4,
              display: "block",
            }}
          />
        </div>

        {/* ── Vessel name ── */}
        <h1
          className={phase === "enter" ? "splash-enter" : ""}
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "clamp(28px, 5vw, 46px)",
            fontWeight: 700,
            color: "#e8f8ff",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            margin: "12px 0 4px",
            animation: "glowPulse 3s ease-in-out infinite",
            animationDelay: "0.5s",
          }}
        >
          {vesselName}
        </h1>

        {/* ── Subtitle ── */}
        <p
          className={phase === "enter" ? "splash-enter" : ""}
          style={{
            fontSize: 11,
            color: "rgba(0,210,255,0.55)",
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            margin: "0 0 32px",
            animationDelay: "0.3s",
          }}
        >
          Marine Dashboard &nbsp;·&nbsp; Venus OS
        </p>

        {/* ── Status line ── */}
        <div
          style={{
            display: "flex",
            gap: 28,
            marginBottom: 28,
            animation: "fadeInUp 0.8s ease 1.2s both",
          }}
        >
          {[
            { label: "MQTT", color: "#00ff9d" },
            { label: "SIGNALK", color: "#00d2ff" },
            { label: "VRM", color: "#00d2ff" },
            { label: "N2K", color: "rgba(255,200,0,0.7)" },
          ].map(({ label, color }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10,
                color: "rgba(200,230,255,0.65)",
                letterSpacing: 2,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                  animation: "particleFloat 2s ease-in-out infinite",
                  animationDelay: `${Math.random()}s`,
                }}
              />
              {label}
            </div>
          ))}
        </div>

        {/* ── Progress bar ── */}
        <div
          style={{
            width: 260,
            height: 2,
            background: "rgba(0,210,255,0.12)",
            borderRadius: 2,
            overflow: "hidden",
            animation: "fadeInUp 0.6s ease 1.5s both",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, rgba(0,210,255,0.4), #00d2ff)",
              boxShadow: "0 0 12px rgba(0,210,255,0.8)",
              transition: "width 0.05s linear",
              borderRadius: 2,
            }}
          />
        </div>

        {/* ── Loading label ── */}
        <div
          style={{
            marginTop: 10,
            fontSize: 9,
            color: "rgba(0,210,255,0.4)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            animation: "fadeInUp 0.6s ease 1.6s both",
          }}
        >
          {progress < 100 ? "INITIALISING SYSTEMS…" : "READY"}
        </div>

        {/* ── Waves at bottom ── */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
          <Waves />
        </div>
      </div>
    </>
  )
}

export default SplashScreen
