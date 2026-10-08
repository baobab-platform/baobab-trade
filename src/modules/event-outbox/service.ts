import { MedusaService } from "@medusajs/framework/utils"
import EventConsumerReceipt from "./models/event-consumer-receipt"
import EventOutbox from "./models/event-outbox"
import EventReconciliation from "./models/event-reconciliation"
class EventOutboxModuleService extends MedusaService({
  EventOutbox,
  EventConsumerReceipt,
  EventReconciliation,
}) {}
export default EventOutboxModuleService
