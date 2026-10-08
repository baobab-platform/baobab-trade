import { model } from "@medusajs/framework/utils"

const CommercialTerms = model.define(
  { name: "commercial_terms", tableName: "b2b_commercial_terms" },
  {
    id: model.id({ prefix: "b2bterm" }).primaryKey(),
    organisation_id: model.text().index(),
    market_key: model.text().index(),
    agreement_reference: model.text(),
    status: model.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).default("DRAFT"),
    incoterm_code: model.text().nullable(),
    effective_from: model.dateTime().nullable(),
    effective_until: model.dateTime().nullable(),
  },
)

export default CommercialTerms
