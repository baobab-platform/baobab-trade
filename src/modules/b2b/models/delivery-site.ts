import { model } from "@medusajs/framework/utils"

const DeliverySite = model
  .define(
    { name: "delivery_site", tableName: "b2b_delivery_site" },
    {
      id: model.id({ prefix: "b2bsite" }).primaryKey(),
      organisation_id: model.text().index(),
      market_key: model.text().index(),
      code: model.text(),
      name: model.text(),
      status: model.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).default("ACTIVE"),
      address_1: model.text(),
      address_2: model.text().nullable(),
      city: model.text(),
      province: model.text().nullable(),
      postal_code: model.text().nullable(),
      country_code: model.text(),
      contact_name: model.text().nullable(),
      contact_phone: model.text().nullable(),
      allow_shipping: model.boolean().default(true),
      allow_billing: model.boolean().default(false),
    },
  )
  .indexes([{ on: ["organisation_id", "code"], unique: true }])

export default DeliverySite
