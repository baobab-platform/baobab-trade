import { model } from "@medusajs/framework/utils"

const ContractPrice = model
  .define(
    { name: "contract_price", tableName: "b2b_contract_price" },
    {
      id: model.id({ prefix: "b2bcprice" }).primaryKey(),
      organisation_id: model.text().index(),
      variant_id: model.text().index(),
      market_key: model.text().index(),
      currency_code: model.text(),
      amount: model.bigNumber(),
      minimum_quantity: model.number().nullable(),
      agreement_reference: model.text(),
      status: model.enum(["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED"]).default("DRAFT"),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
    },
  )
  .indexes([
    {
      on: ["organisation_id", "variant_id", "market_key", "currency_code", "agreement_reference"],
      unique: true,
    },
  ])

export default ContractPrice
