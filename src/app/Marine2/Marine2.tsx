import React, { useEffect, useState } from "react"
import { useLanguage, useMqtt, STATUS, useApp } from "@victronenergy/mfd-modules"
import { AppProps } from "./App"
import { mfdLanguageOptions } from "app/locales/constants"
import { observer } from "mobx-react"
import { isError } from "app/utils/util"
import { AppViews, useAppViewsStore } from "./modules/AppViews"
import SplashScreen from "./components/views/SplashScreen"
import Connecting from "./components/ui/Connecting"
import MqttUnavailable from "./components/ui/MqttUnavailable"
import ErrorFallback from "./components/ui/Error"
import BoatOverviewView from "./components/views/BoatOverviewView"
import DigitalSwitchingView from "./components/views/DigitalSwitchingView"
import WeatherView from "./components/views/WeatherView"
import AlarmView from "./components/views/AlarmView"
import WeatherForecastView from "./components/views/WeatherForecastView"
import WatermakerView from "./components/views/WatermakerView"
import SystemOverviewView from "./components/views/SystemOverviewView"
import SettingsView from "./components/views/SettingsView"
import PowerView from "./components/views/PowerView"
import MainLayout from "./components/ui/MainLayout"

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
    switch (currentView) {
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
      case AppViews.POWER_VIEW:
        return (
          <MainLayout>
            <PowerView />
          </MainLayout>
        )
      case AppViews.WATERMAKER_VIEW:
        return (
          <MainLayout>
            <WatermakerView />
          </MainLayout>
        )
      case AppViews.SYSTEM_OVERVIEW:
        return (
          <MainLayout>
            <SystemOverviewView />
          </MainLayout>
        )
      case AppViews.ALARM_VIEW:
        return (
          <MainLayout>
            <AlarmView />
          </MainLayout>
        )
      case AppViews.SETTINGS:
        return (
          <MainLayout>
            <SettingsView />
          </MainLayout>
        )
      default:
        return (
          <MainLayout>
            <BoatOverviewView />
          </MainLayout>
        )
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
