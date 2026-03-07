import React, { useEffect, useState } from "react"
import { useLanguage, useMqtt, STATUS, useApp } from "@victronenergy/mfd-modules"
import { AppProps } from "./App"
import { mfdLanguageOptions } from "app/locales/constants"
import { observer } from "mobx-react"
import { isError } from "app/utils/util"
import { AppViews, useAppViewsStore } from "./modules/AppViews"
import SplashScreen from "./components/views/SplashScreen"
import BoxView from "./components/views/BoxView"
import RootView from "./components/views/RootView"
import RemoteConsoleView from "./components/views/RemoteConsoleView"
import Connecting from "./components/ui/Connecting"
import DiagnosticsView from "./components/views/DiagnosticsView"
import MqttUnavailable from "./components/ui/MqttUnavailable"
import ErrorFallback from "./components/ui/Error"
import CerboView from "./components/views/CerboView"
import BoatOverviewView from "./components/views/BoatOverviewView"
import DigitalSwitchingView from "./components/views/DigitalSwitchingView"
import WatermakerView from "./components/views/WatermakerView"
import SystemOverviewView from "./components/views/SystemOverviewView"
import MainLayout from "./components/ui/MainLayout"
import WeatherView from "./components/views/WeatherView"
import WeatherForecastView from "./components/views/WeatherForecastView"
import SettingsView from "./components/views/SettingsView"

export const Marine2 = observer((props: AppProps) => {
  // init App
  useApp()

  // subscribe to language
  useLanguage(mfdLanguageOptions)

  const { host } = props
  const mqtt = useMqtt()
  const isConnected = mqtt.isConnected
  const portalId = mqtt.portalId
  const { error, status } = mqtt

  const appViewsStore = useAppViewsStore()
  const [showSplash, setShowSplash] = useState(true)
  const [currentView, setCurrentView] = useState(appViewsStore.currentView)

  useEffect(() => {
    setCurrentView(appViewsStore.currentView)
  }, [appViewsStore.currentView])

  const renderView = () => {
    // Boxes
    if (/^box\//i.test(currentView)) {
      return <BoxView boxId={currentView} />
    }

    // Other views
    switch (currentView) {
      case AppViews.SYSTEM_OVERVIEW:
        return (
          <MainLayout>
            <SystemOverviewView />
          </MainLayout>
        )
      case AppViews.BOAT_OVERVIEW:
        return (
          <MainLayout>
            <BoatOverviewView />
          </MainLayout>
        )
      case AppViews.SWITCH_VIEW:
        return (
          <MainLayout>
            <DigitalSwitchingView />
          </MainLayout>
        )
      case AppViews.WEATHER_VIEW:
        return (
          <MainLayout>
            <WeatherView />
          </MainLayout>
        )
      case AppViews.WEATHER_FORECAST:
        return (
          <MainLayout>
            <WeatherForecastView />
          </MainLayout>
        )
      case AppViews.WATERMAKER_VIEW:
        return (
          <MainLayout>
            <WatermakerView />
          </MainLayout>
        )
      case AppViews.SETTINGS:
        return (
          <MainLayout>
            <SettingsView />
          </MainLayout>
        )
      case AppViews.REMOTE_CONSOLE:
        return <RemoteConsoleView host={host} />
      case AppViews.DIAGNOSTICS:
        return <DiagnosticsView />
      case AppViews.CERBO_OVERVIEW:
        return <CerboView />
      default:
        return <RootView />
    }
  }

  if (error && isError(error) && status !== STATUS.CONNECTING) {
    return <ErrorFallback error={error as Error} resetErrorBoundary={() => {}} />
  }

  if (error) {
    return <MqttUnavailable host={host} />
  }

  if (!isConnected || !portalId) {
    return <Connecting />
  }

  return (
    <>
      {showSplash && (
        <SplashScreen vesselName="Dance Of The Spirits" duration={4500} onComplete={() => setShowSplash(false)} />
      )}
      {renderView()}
    </>
  )
})
