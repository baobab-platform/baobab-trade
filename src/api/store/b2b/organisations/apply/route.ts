// Gate ZB-04 buyer application boundary.
//
// This route creates a Trade-owned application, not an approved organisation,
// membership or role. Tenant identity is server configuration, never request
// input. IAM authentication establishes the Medusa customer only; canonical
// Principal linkage remains nullable until the authoritative mapping exists.
import { createHash } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveBuyerTenantId } from "../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type ApplyBody = {
  legal_name?: unknown
  trading_name?: unknown
  registration_number?: unknown
  country_of_registration?: unknown
  website?: unknown
  requested_market_keys?: unknown
}

const optionalString = (value: unknown, maximum = 200): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "a submitted field is too long")
  }
  return trimmed
}

const applicationView = (application: Record<string, unknown>) => ({
  id: application.id,
  status: application.status,
  legal_name: application.legal_name,
  trading_name: application.trading_name,
  registration_number: application.registration_number,
  country_of_registration: application.country_of_registration,
  website: application.website,
  requested_market_keys: application.requested_market_keys,
  submitted_at: application.submitted_at,
  revision: application.revision,
})

export const POST = async (req: AuthenticatedMedusaRequest<ApplyBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key must contain between 16 and 128 characters",
    )
  }

  const legalName = optionalString(req.body?.legal_name)
  if (!legalName) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "legal_name is required")
  }

  const country = optionalString(req.body?.country_of_registration, 2)
  if (country && !/^[A-Za-z]{2}$/.test(country)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "country_of_registration must be an ISO 3166-1 alpha-2 code",
    )
  }

  const requestedMarkets = Array.isArray(req.body?.requested_market_keys)
    ? [...new Set(req.body.requested_market_keys.map((v) => optionalString(v, 64)).filter(Boolean))]
    : []

  const input = {
    legal_name: legalName,
    trading_name: optionalString(req.body?.trading_name),
    registration_number: optionalString(req.body?.registration_number, 128),
    country_of_registration: country?.toUpperCase() ?? null,
    website: optionalString(req.body?.website, 2048),
    requested_market_keys: requestedMarkets,
  }
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
  const tenantId = resolveBuyerTenantId()
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const replay = await b2b.listBuyerApplications({
    tenant_id: tenantId,
    idempotency_key: idempotencyKey,
  })
  if (replay.length > 0) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Idempotency-Key was already used for a different buyer application",
      )
    }
    res.status(200).json({ application: applicationView(replay[0] as unknown as Record<string, unknown>) })
    return
  }

  const open = await b2b.listBuyerApplications({
    tenant_id: tenantId,
    applicant_customer_id: customerId,
    status: ["DRAFT", "SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW"],
  })
  if (open.length > 0) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "this customer already has an open buyer application",
    )
  }

  const application = await b2b.createBuyerApplications({
    tenant_id: tenantId,
    applicant_customer_id: customerId,
    applicant_principal_id: null,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    ...input,
    status: "SUBMITTED",
    revision: 1,
    submitted_at: new Date(),
    assigned_reviewer_principal_id: null,
  })

  res.status(201).json({
    application: applicationView(application as unknown as Record<string, unknown>),
  })
}
