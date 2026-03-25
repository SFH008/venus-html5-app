import React, { useEffect, useState } from "react"
import SettingsMenu from "../SettingsMenu"
import VersionInfo from "../VersionInfo"
import PageSelector, { PageSelectorProps } from "../PageSelector"
import BackIcon from "../../../images/icons/back.svg"
import { AppViews, useAppViewsStore } from "../../../modules/AppViews"
import SwitchingPane from "../../views/SwitchingPane"

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV_ITEMS: { view: AppViews; icon: string; label: string }[] = [
  { view: AppViews.BOAT_OVERVIEW, icon: "🛥", label: "Vessel" },
  { view: AppViews.SWITCH_VIEW, icon: "🔌", label: "Switches" },
  { view: AppViews.POWER_VIEW, icon: "⚡", label: "Power" },
  { view: AppViews.WATERMAKER_VIEW, icon: "🌊", label: "Water" },
  { view: AppViews.ALARM_VIEW, icon: "🔔", label: "Alarms" },
  { view: AppViews.WEATHER_VIEW, icon: "🌬", label: "Weather" },
  { view: AppViews.WEATHER_FORECAST, icon: "📈", label: "Forecast" },
  { view: AppViews.SETTINGS, icon: "⚙️", label: "Settings" },
]

const Footer = ({ pageSelectorProps }: Props) => {
  const appViewsStore = useAppViewsStore()
  const current = appViewsStore.currentView
  const [isShowingBackButton, setIsShowingBackButton] = useState(current !== AppViews.ROOT)

  // Active alarm count — read from window so AlarmView can publish it
  const [alarmCount, setAlarmCount] = useState(0)

  useEffect(() => {
    setIsShowingBackButton(appViewsStore.currentView !== AppViews.ROOT)
  }, [appViewsStore.currentView])

  // Listen for alarm count updates published by AlarmView
  useEffect(() => {
    const handler = (e: Event) => {
      const count = (e as CustomEvent<number>).detail ?? 0
      setAlarmCount(count)
    }
    window.addEventListener("marine2_alarm_count", handler as EventListener)
    return () => window.removeEventListener("marine2_alarm_count", handler as EventListener)
  }, [])

  const handleBackClick = () => appViewsStore.setView(AppViews.ROOT)

  return (
    <div className="flex flex-row w-full h-px-44 m-1 items-center justify-between pt-2 pb-3">
      {/* Left — version + optional back */}
      <div className="flex flex-1 flex-row items-center justify-between">
        <VersionInfo />
        {!!pageSelectorProps && !!pageSelectorProps.maxPages && pageSelectorProps.maxPages > 1 && (
          <div className={"fixed left-1/2 translate-x-[-50%] min-w-[140px]"}>
            <PageSelector {...pageSelectorProps} selectorLocation="bottom-center" />
          </div>
        )}
        {isShowingBackButton && (
          <div onClick={handleBackClick} className={"w-px-44 h-px-44 justify-center p-1 cursor-pointer"}>
            <BackIcon onClick={handleBackClick} className={"text-content-victronBlue"} alt={"Back"} />
          </div>
        )}
      </div>

      {/* Centre — SwitchingPane */}
      <SwitchingPane />

      {/* Right — nav bar */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
        {NAV_ITEMS.map(({ view, icon, label }) => {
          const isActive = current === view
          const isAlarm = view === AppViews.ALARM_VIEW
          const hasAlarms = isAlarm && alarmCount > 0

          return (
            <div
              key={view}
              onClick={() => appViewsStore.setView(view)}
              title={label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: 54,
                height: 44,
                cursor: "pointer",
                borderRadius: 6,
                padding: "2px 4px",
                position: "relative",
                background: isActive ? "rgba(0, 177, 255, 0.12)" : hasAlarms ? "rgba(248,113,113,0.08)" : "transparent",
                border: isActive
                  ? "1px solid rgba(0, 177, 255, 0.35)"
                  : hasAlarms
                    ? "1px solid rgba(248,113,113,0.4)"
                    : "1px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 2,
                    left: "20%",
                    right: "20%",
                    height: 2,
                    borderRadius: 1,
                    background: "#00b1ff",
                    boxShadow: "0 0 6px #00b1ff",
                  }}
                />
              )}

              {/* Alarm count badge */}
              {hasAlarms && !isActive && (
                <div
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 4,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    background: "#ef4444",
                    border: "1px solid #ff6666",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#fff",
                    fontWeight: 700,
                    boxShadow: "0 0 6px #ef444488",
                    padding: "0 3px",
                    zIndex: 2,
                  }}
                >
                  {alarmCount}
                </div>
              )}

              {/* Icon */}
              <span
                style={{
                  fontSize: 22,
                  lineHeight: 1,
                  filter: isActive ? "none" : hasAlarms ? "none" : "grayscale(0.3) opacity(0.6)",
                  transition: "filter 0.15s ease",
                }}
              >
                {icon}
              </span>

              {/* Label */}
              <span
                style={{
                  fontSize: 9,
                  marginTop: 2,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: isActive ? "#00b1ff" : hasAlarms ? "#f87171" : "rgba(150,170,200,0.5)",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s ease",
                }}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Far right — settings menu */}
      <SettingsMenu />
    </div>
  )
}

interface Props {
  pageSelectorProps?: PageSelectorProps
}

export default Footer
