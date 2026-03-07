/**
 * useAppConfig.ts
 * React hook — returns live config and re-renders when settings change.
 *
 * Usage:
 *   import { useAppConfig } from "../../config/useAppConfig"
 *   const { config, save, reset } = useAppConfig()
 *   const ws = new WebSocket(`ws://${config.signalkHost}:${config.signalkPort}/...`)
 */

import { useState, useEffect, useCallback } from "react"
import { getConfig, saveConfig, resetConfig } from "./AppConfig"
import type { AppConfigShape } from "./AppConfig"

// Custom event fired whenever config changes so all hook instances stay in sync
const CONFIG_EVENT = "marine2_config_changed"

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfigShape>(getConfig)

  // Listen for changes broadcast by save() / reset() in any hook instance
  useEffect(() => {
    const handler = () => setConfig(getConfig())
    window.addEventListener(CONFIG_EVENT, handler)
    return () => window.removeEventListener(CONFIG_EVENT, handler)
  }, [])

  const save = useCallback((next: AppConfigShape) => {
    const saved = saveConfig(next)
    setConfig(saved)
    window.dispatchEvent(new Event(CONFIG_EVENT))
    return saved
  }, [])

  const reset = useCallback(() => {
    const defaults = resetConfig()
    setConfig(defaults)
    window.dispatchEvent(new Event(CONFIG_EVENT))
    return defaults
  }, [])

  return { config, save, reset }
}
