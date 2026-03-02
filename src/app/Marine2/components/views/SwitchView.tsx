import React, { useState } from "react"
import MainLayout from "../ui/MainLayout"
import { observer } from "mobx-react-lite"

interface SwitchCardProps {
  title: string
  subtitle: string
  isOn: boolean
  power?: number
  onToggle: () => void
  disabled?: boolean
}

const SwitchCard = ({ title, subtitle, isOn, power, onToggle, disabled }: SwitchCardProps) => {
  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white text-lg font-bold">{title}</h2>
          <p className="text-gray-400 text-sm">{subtitle}</p>
        </div>
        <div className={`w-4 h-4 rounded-full ${isOn ? "bg-green-400" : "bg-red-400"}`} />
      </div>
      <div className="flex items-center justify-between">
        <div className="bg-gray-700 rounded p-3 flex-1 mr-3">
          <p className="text-gray-400 text-sm">Status</p>
          <p className={`text-xl font-bold ${isOn ? "text-green-400" : "text-red-400"}`}>{isOn ? "ON" : "OFF"}</p>
        </div>
        {power !== undefined && (
          <div className="bg-gray-700 rounded p-3 flex-1">
            <p className="text-gray-400 text-sm">Power</p>
            <p className="text-white text-xl font-bold">{isOn ? power : 0}W</p>
          </div>
        )}
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`w-full py-3 rounded-lg font-bold text-white text-lg transition-colors ${
          disabled
            ? "bg-gray-600 cursor-not-allowed"
            : isOn
              ? "bg-red-600 hover:bg-red-700 cursor-pointer"
              : "bg-green-600 hover:bg-green-700 cursor-pointer"
        }`}
      >
        {disabled ? "OFFLINE" : isOn ? "TURN OFF" : "TURN ON"}
      </button>
    </div>
  )
}

const SwitchView = () => {
  const [shellyOn, setShellyOn] = useState(false)
  const [shellyOnline] = useState(false)
  const [virtualOn, setVirtualOn] = useState(false)
  const [virtualPower] = useState(1200)

  const toggleShelly = () => {
    if (shellyOnline) {
      setShellyOn((prev) => !prev)
    }
  }

  const toggleVirtual = () => {
    setVirtualOn((prev) => !prev)
  }

  return (
    <MainLayout>
      <div className="flex flex-col w-full h-full p-4 gap-4">
        <h1 className="text-white text-2xl font-bold">Switching</h1>
        <div className="grid grid-cols-1 gap-4">
          <SwitchCard
            title="Shelly Plus 1"
            subtitle="192.168.76.215 — Battery Charger"
            isOn={shellyOn}
            power={2400}
            onToggle={toggleShelly}
            disabled={!shellyOnline}
          />
          <SwitchCard
            title="Virtual Switch"
            subtitle="Node-RED controlled"
            isOn={virtualOn}
            power={virtualPower}
            onToggle={toggleVirtual}
          />
        </div>
      </div>
    </MainLayout>
  )
}

export default observer(SwitchView)
