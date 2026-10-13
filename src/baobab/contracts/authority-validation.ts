/**
 * P0-04A / ADR-BCP-026/027: consequential facts must satisfy the exact Shared
 * wire contract before scope/freshness checks. Schema-valid is not authorized:
 * callers still bind current context, actor, operation and provider readiness.
 * Compile once from committed schemas, without network loads or data coercion.
 */
import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020"
import addFormats from "ajv-formats"
import { authoritySchemas } from "./authority-schemas.generated"

const ajv = new Ajv2020({ strict: false, validateFormats: true })
addFormats(ajv)
for (const schema of authoritySchemas) ajv.addSchema(schema as AnySchema)

const validator = (path: string, definition: string): ValidateFunction => {
  const compiled = ajv.getSchema(
    `https://contracts.baobab-platform.com/${path}#/$defs/${definition}`,
  )
  if (!compiled) throw new Error("Pinned Shared authority schema unavailable")
  return compiled
}

export const legalActorRequestSchema = validator(
  "organisation/v2/legal-actor-enforcement.schema.json",
  "AssessLegalActorRequest",
)
export const legalActorResponseSchema = validator(
  "organisation/v2/legal-actor-enforcement.schema.json",
  "AssessLegalActorResponse",
)
export const documentaryRequestSchema = validator(
  "admission/v2/documentary-restriction.schema.json",
  "DocumentaryRestrictionAssessmentRequest",
)
export const documentaryResponseSchema = validator(
  "admission/v2/documentary-restriction.schema.json",
  "DocumentaryRestrictionAssessmentResponse",
)
export const platformContextSchema = validator(
  "control-plane/v1/platform-context.schema.json",
  "PlatformContext",
)

export const merchantReadinessRequestSchema = validator(
  "payments/v1/merchant-readiness.schema.json",
  "ReadinessRequest",
)
export const merchantReadinessResponseSchema = validator(
  "payments/v1/merchant-readiness.schema.json",
  "ReadyDecision",
)
