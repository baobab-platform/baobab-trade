import type { ExecArgs } from "@medusajs/framework/types"
import {
  assertThamaniSimulationDataset,
  THAMANI_SIMULATION_CONSUMERS,
  THAMANI_SIMULATION_ORDER_SCENARIOS,
  THAMANI_SIMULATION_VERSION,
} from "../baobab/thamani/simulation"

export default async function ({ container }: ExecArgs) {
  assertThamaniSimulationDataset()
  container
    .resolve("logger")
    .info(
      `Verified ${THAMANI_SIMULATION_VERSION}: ${THAMANI_SIMULATION_CONSUMERS.length} consumers, ${THAMANI_SIMULATION_ORDER_SCENARIOS.length} order scenarios`,
    )
}
