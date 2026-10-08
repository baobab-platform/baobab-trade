import type { ExecArgs } from "@medusajs/framework/types"
import {
  SIMULATION_BUYERS,
  SIMULATION_ORGANISATIONS,
  SIMULATION_SCENARIOS,
  SIMULATION_SUPPLIERS,
  SIMULATION_VERSION,
  assertSimulationDataset,
} from "../baobab/simulation"
export default async function ({ container }: ExecArgs) {
  assertSimulationDataset()
  container
    .resolve("logger")
    .info(
      `Verified ${SIMULATION_VERSION}: ${SIMULATION_SCENARIOS.length} scenarios, ${SIMULATION_ORGANISATIONS.length} organisations, ${SIMULATION_BUYERS.length} buyers, ${SIMULATION_SUPPLIERS.length} suppliers`,
    )
}
