import { makeAutoObservable } from "mobx"
import { useMemo } from "react"
import { translate } from "react-i18nify"

export enum AppViews {
  ROOT = "root",
  REMOTE_CONSOLE = "remote-console",
  DIAGNOSTICS = "diagnostics",
  BOX_BATTERIES_OVERVIEW = "box/batteries-overview",
  BOX_TANKS = "box/tanks",
  BOX_ENERGY_OVERVIEW = "box/energy-overview",
  BOX_DEVICES_OVERVIEW = "box/devices-overview",
  BOX_ENVIRONMENT_OVERVIEW = "box/environment-overview",
  CERBO_OVERVIEW = "cerbo-overview",
  SWITCH_VIEW = "switch-view",
  BOAT_OVERVIEW = "boat-overview",
  WATERMAKER_VIEW = "watermaker-view",
  SYSTEM_OVERVIEW = "system-overview",
  WEATHER_VIEW = "weather-view",
  WEATHER_FORECAST = "weather-forecast",
  POWER_VIEW = "power-view",
  SETTINGS = "settings",
}

export const AppViewTitleKeys = new Map<AppViews, string>([
  [AppViews.ROOT, "pages.systemOverview"],
  [AppViews.REMOTE_CONSOLE, "pages.remoteConsole"],
  [AppViews.DIAGNOSTICS, "pages.diagnostics"],
  [AppViews.BOX_BATTERIES_OVERVIEW, "boxes.batteries"],
  [AppViews.BOX_TANKS, "boxes.tanks"],
  [AppViews.BOX_ENERGY_OVERVIEW, "boxes.energy"],
  [AppViews.BOX_DEVICES_OVERVIEW, "boxes.devices"],
  [AppViews.BOX_ENVIRONMENT_OVERVIEW, "boxes.environment"],
  [AppViews.CERBO_OVERVIEW, "pages.cerboOverview"],
  [AppViews.SWITCH_VIEW, "pages.switchView"],
  [AppViews.BOAT_OVERVIEW, "pages.boatOverview"],
  [AppViews.WATERMAKER_VIEW, "pages.watermakerView"],
  [AppViews.SYSTEM_OVERVIEW, "pages.systemOverview"],
  [AppViews.WEATHER_VIEW, "pages.weatherView"],
  [AppViews.WEATHER_FORECAST, "pages.weatherForecast"],
  [AppViews.POWER_VIEW, "pages.powerView"],
  [AppViews.SETTINGS, "pages.settings"],
])

export class AppViewsStore {
  currentView: AppViews = AppViews.ROOT

  constructor() {
    makeAutoObservable(this)
  }

  setView(view: AppViews) {
    this.currentView = view
  }

  getViewTitle(view?: AppViews) {
    const titleKey = AppViewTitleKeys.get(view || this.currentView)
    return titleKey ? translate(titleKey) : ""
  }
}

let store: AppViewsStore

function initializeStore() {
  const _store = store ?? new AppViewsStore()
  // For SSG and SSR always create a new store
  if (typeof window === "undefined") return _store
  // Create the store once in the client
  if (!store) store = _store

  return _store
}

export function useAppViewsStore() {
  return useMemo(() => initializeStore(), [])
}
