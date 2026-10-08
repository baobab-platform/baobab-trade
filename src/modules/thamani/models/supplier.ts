import { model } from "@medusajs/framework/utils"

const Supplier = model.define(
  { name: "supplier", tableName: "thamani_supplier" },
  {
    id: model.id({ prefix: "thamsup" }).primaryKey(),
    supplier_key: model.text().unique(),
    name: model.text(),
    category: model.enum([
      "FOOD_MANUFACTURER",
      "COFFEE_ROASTER",
      "FMCG_DISTRIBUTOR",
      "PERSONAL_CARE_MANUFACTURER",
      "HOUSEHOLD_GOODS_SUPPLIER",
      "REGIONAL_WHOLESALER",
      "IMPORTER",
      "LOCAL_SME",
      "AGRICULTURAL_SUPPLIER",
      "EXTERNAL_B2B_SUPPLIER",
    ]),
    origin_country: model.text(),
    synthetic: model.boolean().default(true),
    erp_business_partner_reference: model.text().nullable(),
    status: model.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  },
)

export default Supplier
