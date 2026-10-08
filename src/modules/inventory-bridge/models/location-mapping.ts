import { model } from "@medusajs/framework/utils"

const LocationMapping = model.define(
  { name: "location_mapping", tableName: "inventory_location_mapping" },
  {
    id: model.id({ prefix: "invlocmap" }).primaryKey(),
    stock_location_id: model.text().unique(),
    canonical_location_key: model.text().unique(),
    erp_warehouse_reference: model.text().unique(),
    market_key: model.text().index(),
    status: model.enum(["ACTIVE", "SUSPENDED", "RETIRED"]).default("ACTIVE"),
  },
)

export default LocationMapping
