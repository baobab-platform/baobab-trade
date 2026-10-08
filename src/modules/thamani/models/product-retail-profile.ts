import { model } from "@medusajs/framework/utils"

const ProductRetailProfile = model.define(
  { name: "product_retail_profile", tableName: "thamani_product_retail_profile" },
  {
    id: model.id({ prefix: "thamprod" }).primaryKey(),
    product_id: model.text().unique(),
    canonical_product_key: model.text().unique(),
    supplier_id: model.text().index(),
    country_of_origin: model.text(),
    hs_classification_reference: model.text(),
    customs_category: model.text(),
    product_tax_category: model.enum(["STANDARD", "ZERO_RATED", "EXEMPT"]),
    brand: model.text(),
    net_weight_kg: model.float(),
    gross_weight_kg: model.float(),
    packaging: model.text(),
    trade_uom: model.enum(["EACH"]),
    consumer_uom: model.text(),
    food_attributes: model.json().nullable(),
  },
)

export default ProductRetailProfile
