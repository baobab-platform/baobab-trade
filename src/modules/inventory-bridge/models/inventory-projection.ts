import { model } from "@medusajs/framework/utils"

const InventoryProjection = model
  .define(
    { name: "inventory_projection", tableName: "inventory_erp_projection" },
    {
      id: model.id({ prefix: "invproj" }).primaryKey(),
      inventory_item_id: model.text().index(),
      stock_location_id: model.text().index(),
      erp_warehouse_reference: model.text().index(),
      source_sequence: model.number(),
      source_idempotency_key: model.text().unique(),
      on_hand_quantity: model.number(),
      incoming_quantity: model.number().default(0),
      unavailable_quantity: model.number().default(0),
      projected_at: model.dateTime(),
      applied_at: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["inventory_item_id", "stock_location_id", "source_sequence"], unique: true }])

export default InventoryProjection
