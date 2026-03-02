import React from "react"
import MainLayout from "../ui/MainLayout"
import { useSystemBatteries, usePvCharger } from "@victronenergy/mfd-modules"
import { observer } from "mobx-react-lite"

const CerboView = () => {
  const { batteries } = useSystemBatteries()
  const pvCharger = usePvCharger()

  const battery = batteries && batteries.length > 0 ? batteries[0] : null

  const formatTimeToGo = (seconds: number) => {
    if (!seconds) return "N/A"
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  return (
    <MainLayout>
      <div className="flex flex-col w-full h-full p-4 gap-4">
        <h1 className="text-white text-2xl font-bold">Vessel Dashboard</h1>
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-victronBlue text-xl mb-3">Battery</h2>
          {battery ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-700 rounded p-3">
                <p className="text-gray-400 text-sm">State of Charge</p>
                <p className="text-white text-2xl font-bold">{battery.soc?.toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <p className="text-gray-400 text-sm">Voltage</p>
                <p className="text-white text-2xl font-bold">{battery.voltage?.toFixed(1)}V</p>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <p className="text-gray-400 text-sm">Power</p>
                <p className="text-white text-2xl font-bold">{battery.power?.toFixed(0)}W</p>
              </div>
              <div className="bg-gray-700 rounded p-3">
                <p className="text-gray-400 text-sm">Time to Go</p>
                <p className="text-white text-2xl font-bold">{formatTimeToGo(battery.timetogo)}</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-400">No battery data available</p>
          )}
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-victronBlue text-xl mb-3">Solar</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-700 rounded p-3">
              <p className="text-gray-400 text-sm">PV Power</p>
              <p className="text-white text-2xl font-bold">{pvCharger.power?.toFixed(0) ?? "N/A"}W</p>
            </div>
            <div className="bg-gray-700 rounded p-3">
              <p className="text-gray-400 text-sm">PV Current</p>
              <p className="text-white text-2xl font-bold">{pvCharger.current?.toFixed(1) ?? "N/A"}A</p>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}

export default observer(CerboView)
