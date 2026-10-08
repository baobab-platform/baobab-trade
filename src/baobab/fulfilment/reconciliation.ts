import type { FulfilmentStatus } from "./fulfilment-port"

export const reconcileFulfilment = (input: {
  commerceStatus: FulfilmentStatus
  executionStatus?: string | null
  shipmentReference?: string | null
}) => {
  if (!input.executionStatus)
    return { status: "PENDING_EXECUTION" as const, reasons: ["EXECUTION_RECORD_MISSING"] }
  const reasons: string[] = []
  if (input.executionStatus !== input.commerceStatus) reasons.push("STATUS_MISMATCH")
  if (["DISPATCHED", "DELIVERED"].includes(input.executionStatus) && !input.shipmentReference)
    reasons.push("SHIPMENT_MAPPING_MISSING")
  return { status: reasons.length ? ("VARIANCE" as const) : ("MATCHED" as const), reasons }
}
