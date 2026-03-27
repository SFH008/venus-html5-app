import React, { useMemo, useState, useEffect } from "react"
import Footer from "../Footer"
import Header from "../Header"
import { observer } from "mobx-react"
import { useAppViewsStore } from "../../../modules/AppViews"
import { AppViews } from "../../../modules/AppViews"
import { PageSelectorProps } from "../PageSelector"

type AlarmSeverity = "none" | "warn" | "alarm" | "emergency"

const bannerStyles = `
  @keyframes bannerPulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.7; }
  }
  .alarm-banner-emergency { animation: bannerPulse 0.6s ease-in-out infinite; }
  .alarm-banner-alarm     { animation: bannerPulse 1.2s ease-in-out infinite; }
`

const SEVERITY_STYLE: Record<
  Exclude<AlarmSeverity, "none" | "warn">,
  { bg: string; border: string; text: string; icon: string }
> = {
  emergency: { bg: "#1a0000", border: "#ff444488", text: "#ff4444", icon: "🚨" },
  alarm: { bg: "#1e0808", border: "#f8717188", text: "#f87171", icon: "⚠️" },
}

interface AlarmBannerProps {
  severity: AlarmSeverity
  message: string
  onTap: () => void
}

const AlarmBanner = ({ severity, message, onTap }: AlarmBannerProps) => {
  if (severity === "none" || severity === "warn") return null
  const s = SEVERITY_STYLE[severity]
  return (
    <>
      <style>{bannerStyles}</style>
      <div
        className={`alarm-banner-${severity}`}
        onClick={onTap}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          background: s.bg,
          borderTop: `1px solid ${s.border}`,
          borderBottom: `1px solid ${s.border}`,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 13,
            fontWeight: 700,
            color: s.text,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {severity.toUpperCase()}
        </span>
        <span
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 14,
            color: "rgba(200,220,255,0.8)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {message}
        </span>
        <span
          style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 11,
            color: s.text,
            flexShrink: 0,
            opacity: 0.7,
            letterSpacing: "0.1em",
          }}
        >
          TAP TO VIEW ›
        </span>
      </div>
    </>
  )
}

const MainLayout = ({ children, title, pageSelectorProps }: Props) => {
  const appViewsStore = useAppViewsStore()
  const [alarmSeverity, setAlarmSeverity] = useState<AlarmSeverity>("none")
  const [alarmMessage, setAlarmMessage] = useState("")

  const getTitle = useMemo(() => {
    return title || appViewsStore.getViewTitle()
  }, [title, appViewsStore])

  useEffect(() => {
    const onSeverity = (e: Event) => {
      const d = (e as CustomEvent<{ severity: AlarmSeverity; message: string }>).detail
      setAlarmSeverity(d?.severity ?? "none")
      setAlarmMessage(d?.message ?? "")
    }
    window.addEventListener("marine2_alarm_severity", onSeverity)
    return () => window.removeEventListener("marine2_alarm_severity", onSeverity)
  }, [])

  const handleBannerTap = () => appViewsStore.setView(AppViews.ALARM_VIEW)

  return (
    <div className={"text-content-primary bg-surface-primary flex flex-col w-full h-full pt-2 px-2"}>
      <div className={"flex flex-row w-full h-full grow-0 basis-0 min-h-fit"}>
        <Header title={getTitle} />
      </div>
      <div className={"flex flex-col grow w-full h-full min-h-0 cy-metrics"}>{children}</div>
      <AlarmBanner severity={alarmSeverity} message={alarmMessage} onTap={handleBannerTap} />
      <div className={"flex flex-row w-full h-full grow-0 basis-0 min-h-fit"}>
        <Footer pageSelectorProps={pageSelectorProps} />
      </div>
    </div>
  )
}

interface Props {
  children?: React.JSX.Element
  title?: string
  pageSelectorProps?: PageSelectorProps
}

export default observer(MainLayout)
