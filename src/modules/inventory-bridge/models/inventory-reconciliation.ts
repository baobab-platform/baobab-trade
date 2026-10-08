import { model } from "@medusajs/framework/utils"

const InventoryReconciliation = model.define(
  { name: "inventory_reconciliation", tableName: "inventory_reconciliation" },
  {
    id: model.id({ prefix: "invrec" }).primaryKey(),
    projection_id: model.text().unique(),
    inventory_item_id: model.text().index(),
    stock_location_id: model.text().index(),
    erp_on_hand_quantity: model.number(),
    medusa_stocked_quantity: model.number(),
    medusa_reserved_quantity: model.number(),
    delta_quantity: model.number(),
    status: model.enum(["MATCHED", "VARIANCE", "RESOLVED"]),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)

export default InventoryReconciliation
