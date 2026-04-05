import { unit } from "@m2Types/data/unit"
import { isSinglePhaseFor } from "../../helpers/is-single-phase-for"
import { PowerUnit } from "@victronenergy/mfd-modules"

export const dcUnitFor = (preferredElectricalPowerIndicator: number) => {
  if (preferredElectricalPowerIndicator === PowerUnit.AMPS || preferredElectricalPowerIndicator === PowerUnit.MIXED) {
    return "A" as unit
  }

  return "W" as unit
}

export const unitFor = (preferredElectricalPowerIndicator: number) => {
  if (preferredElectricalPowerIndicator === PowerUnit.AMPS) {
    return "A" as unit
  }

  return "W" as unit
}

export const phaseUnitFor = (phases: number, preferredElectricalPowerIndicator: number) => {
  if (isSinglePhaseFor(phases) && preferredElectricalPowerIndicator === PowerUnit.AMPS) {
    return "A" as unit
  }

  return "W" as unit
}
