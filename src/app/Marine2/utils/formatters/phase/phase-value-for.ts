import { PowerUnit } from "@victronenergy/mfd-modules"
import { isSinglePhaseFor } from "../../helpers/is-single-phase-for"
import { totalPowerFor } from "../../helpers/total-power-for"

export const dcValueFor = (current: number, power: number, preferredElectricalPowerIndicator: number) => {
  if (preferredElectricalPowerIndicator === PowerUnit.AMPS || preferredElectricalPowerIndicator === PowerUnit.MIXED) {
    return current
  }

  return power
}

export const valueFor = (current: number, power: number, preferredElectricalPowerIndicator: number) => {
  if (preferredElectricalPowerIndicator === PowerUnit.AMPS) {
    return current
  }

  return power
}

export const phaseValueFor = (
  phases: number,
  current: number[],
  power: number[],
  preferredElectricalPowerIndicator: number,
) => {
  if (isSinglePhaseFor(phases) && preferredElectricalPowerIndicator === PowerUnit.AMPS) {
    return current[0]
  }

  return totalPowerFor(power)
}
