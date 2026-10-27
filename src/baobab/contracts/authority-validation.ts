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

export const bindingAuthorizationRequestSchema = validator(
  "commerce/v1/seller-binding.schema.json",
  "AuthorizeBindingRequest",
)
export const bindingAuthorizationResponseSchema = validator(
  "commerce/v1/seller-binding.schema.json",
  "AuthorizeBindingResponse",
)

// ADR-SHARED-039 Trade-0: native-configuration attestation to the CP-owned
// Seller Operating Binding registry. An attestation authorises nothing.
export const nativeConfigurationAttestationRequestSchema = validator(
  "trade/v2/seller-operating-binding.schema.json",
  "NativeConfigurationAttestationRequest",
)
export const nativeConfigurationAttestationSchema = validator(
  "trade/v2/seller-operating-binding.schema.json",
  "NativeConfigurationAttestation",
)

// Trade-A TA-03: binding discovery and per-operation order authority. A
// resolution identifies a candidate binding; only a decision is authority.
export const bindingResolveRequestSchema = validator(
  "trade/v2/seller-operating-binding.schema.json",
  "BindingResolveRequest",
)
export const bindingResolutionSchema = validator(
  "trade/v2/seller-operating-binding.schema.json",
  "BindingResolution",
)
export const orderAuthorityRequestSchema = validator(
  "trade/v2/order-authority.schema.json",
  "OrderAuthorityRequest",
)
export const orderAuthorityDecisionSchema = validator(
  "trade/v2/order-authority.schema.json",
  "OrderAuthorityDecision",
)
// ADR-SHARED-042 CAA-04/05: CP's estate client binding attestation and the
// buyer execution context and decision Trade returns.
export const estateBindingAttestationSchema = validator(
  "control-plane/v1/estate-client-binding.schema.json",
  "EstateBindingAttestation",
)
// ADR-SHARED-042 section 14 Decision 8: CP's estate commerce profile
// attestation and the NativeCommitmentClassification Trade records from it.
export const commerceProfileRequestSchema = validator(
  "control-plane/v1/estate-commerce-profile.schema.json",
  "EstateCommerceProfileResolveRequest",
)
export const commerceProfileAttestationSchema = validator(
  "control-plane/v1/estate-commerce-profile.schema.json",
  "EstateCommerceProfileAttestation",
)
// ADR-SHARED-042 section 14 Decision 9: CP's governed estate resource
// assignment attestation, the non-BFF estate provenance.
export const resourceAssignmentRequestSchema = validator(
  "control-plane/v1/estate-resource-assignment.schema.json",
  "EstateResourceAssignmentResolveRequest",
)
export const resourceAssignmentAttestationSchema = validator(
  "control-plane/v1/estate-resource-assignment.schema.json",
  "EstateResourceAssignmentAttestation",
)
export const nativeCommitmentClassificationSchema = validator(
  "trade/v2/native-commitment-classification.schema.json",
  "NativeCommitmentClassification",
)
export const buyerExecutionContextSchema = validator(
  "trade/v2/buyer-execution-context.schema.json",
  "TradeBuyerExecutionContext",
)
export const buyerOperationDecisionSchema = validator(
  "trade/v2/buyer-execution-context.schema.json",
  "BuyerOperationDecision",
)
export const buyerAssurancePolicySchema = validator(
  "identity/v1/assurance-policy.schema.json",
  "BuyerAssurancePolicy",
)
