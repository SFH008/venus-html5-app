import React, { useEffect, useState } from "react"
import SettingsMenu from "../SettingsMenu"
import VersionInfo from "../VersionInfo"
import PageSelector, { PageSelectorProps } from "../PageSelector"
import BackIcon from "../../../images/icons/back.svg"
import { AppViews, useAppViewsStore } from "../../../modules/AppViews"
import SwitchingPane from "../../views/SwitchingPane"

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

type AlarmSeverity = "none" | "warn" | "alarm" | "emergency"

const footerStyles = `
  @keyframes pulseAmber {
    0%, 100% { box-shadow: 0 0 0px #fbbf2400; border-color: rgba(251,191,36,0.35); }
    50%       { box-shadow: 0 0 10px #fbbf2466; border-color: rgba(251,191,36,0.8); }
  }
  @keyframes pulseRed {
    0%, 100% { box-shadow: 0 0 0px #f8717100; border-color: rgba(248,113,113,0.35); }
    50%       { box-shadow: 0 0 14px #f8717188; border-color: rgba(248,113,113,0.9); }
  }
  .alarm-tab-warn      { animation: pulseAmber 2s ease-in-out infinite; }
  .alarm-tab-alarm     { animation: pulseRed 0.9s ease-in-out infinite; }
  .alarm-tab-emergency { animation: pulseRed 0.5s ease-in-out infinite; }
`

const Footer = ({ pageSelectorProps }: Props) => {
  const appViewsStore = useAppViewsStore()
  const current = appViewsStore.currentView
  const [isShowingBackButton, setIsShowingBackButton] = useState(current !== AppViews.ROOT)
  const [alarmCount, setAlarmCount] = useState(0)
  const [alarmSeverity, setAlarmSeverity] = useState<AlarmSeverity>("none")

  useEffect(() => {
    setIsShowingBackButton(appViewsStore.currentView !== AppViews.ROOT)
  }, [appViewsStore.currentView])

  useEffect(() => {
    const onCount = (e: Event) => {
      setAlarmCount((e as CustomEvent<number>).detail ?? 0)
    }
    const onSeverity = (e: Event) => {
      const d = (e as CustomEvent<{ severity: AlarmSeverity }>).detail
      setAlarmSeverity(d?.severity ?? "none")
    }
    window.addEventListener("marine2_alarm_count", onCount)
    window.addEventListener("marine2_alarm_severity", onSeverity)
    return () => {
      window.removeEventListener("marine2_alarm_count", onCount)
      window.removeEventListener("marine2_alarm_severity", onSeverity)
    }
  }, [])

  const handleBackClick = () => appViewsStore.setView(AppViews.ROOT)

  return (
    <>
      <style>{footerStyles}</style>
      <div className="flex flex-row w-full h-px-44 m-1 items-center justify-between pt-2 pb-3">
        {/* Left */}
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

        {/* Centre */}
        <SwitchingPane />

        {/* Right — nav */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
          {NAV_ITEMS.map(({ view, icon, label }) => {
            const isActive = current === view
            const isAlarmTab = view === AppViews.ALARM_VIEW
            const hasAlarms = isAlarmTab && alarmCount > 0

            let pulseClass = ""
            if (isAlarmTab && !isActive && alarmSeverity !== "none") {
              pulseClass =
                alarmSeverity === "emergency"
                  ? "alarm-tab-emergency"
                  : alarmSeverity === "alarm"
                    ? "alarm-tab-alarm"
                    : "alarm-tab-warn"
            }

            return (
              <div
                key={view}
                onClick={() => appViewsStore.setView(view)}
                title={label}
                className={pulseClass}
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
                  background: isActive
                    ? "rgba(0,177,255,0.12)"
                    : hasAlarms && !isActive
                      ? "rgba(248,113,113,0.06)"
                      : "transparent",
                  border: isActive ? "1px solid rgba(0,177,255,0.35)" : "1px solid transparent",
                  transition: "background 0.15s ease",
                }}
              >
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

                {hasAlarms && !isActive && (
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 4,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      background: alarmSeverity === "warn" ? "#d97706" : "#ef4444",
                      border: `1px solid ${alarmSeverity === "warn" ? "#fbbf24" : "#ff6666"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "#fff",
                      fontWeight: 700,
                      boxShadow: alarmSeverity === "warn" ? "0 0 6px #fbbf2488" : "0 0 6px #ef444488",
                      padding: "0 3px",
                      zIndex: 2,
                    }}
                  >
                    {alarmCount}
                  </div>
                )}

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

                <span
                  style={{
                    fontSize: 9,
                    marginTop: 2,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: isActive
                      ? "#00b1ff"
                      : alarmSeverity === "emergency" && isAlarmTab
                        ? "#ff4444"
                        : alarmSeverity === "alarm" && isAlarmTab
                          ? "#f87171"
                          : alarmSeverity === "warn" && isAlarmTab
                            ? "#fbbf24"
                            : "rgba(150,170,200,0.5)",
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

        {/* Far right */}
        <SettingsMenu />
      </div>
    </>
  )
}

interface Props {
  pageSelectorProps?: PageSelectorProps
}

export default Footer
