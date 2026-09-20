// Gate ZB-04 — Buyer Onboarding (apply).
// Creates a Trade-owned b2b_organisation in PENDING status and an ACTIVE
// membership for the authenticated Medusa customer. Does not activate trading
// capabilities (see GET /store/b2b/context and assertActiveBuyerContext).
// canonical_organisation_id stays null until CP linkage (admin canonical-link).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type ApplyBody = {
  legal_name?: unknown
  trading_name?: unknown
  registration_number?: unknown
  tenant_id?: unknown
  default_market_key?: unknown
}

const asOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const POST = async (req: AuthenticatedMedusaRequest<ApplyBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const legalName = asOptionalString(req.body?.legal_name)
  if (!legalName) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "legal_name is required")
  }

  const tradingName = asOptionalString(req.body?.trading_name)
  const registrationNumber = asOptionalString(req.body?.registration_number)
  const defaultMarketKey = asOptionalString(req.body?.default_market_key)
  // Tenant is platform context; until CP always supplies it on the request,
  // accept an explicit body value or the deployment default for ZuriBeans.
  const tenantId =
    asOptionalString(req.body?.tenant_id) ||
    process.env.BAOBAB_DEFAULT_TENANT_ID ||
    "zuribeans"

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const existingMemberships = await b2b.listBuyerMemberships({
    customer_id: customerId,
  })
  if (existingMemberships.length > 0) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "this customer already has a buyer organisation membership",
    )
  }

  const organisation = await b2b.createB2BOrganisations({
    tenant_id: tenantId,
    legal_name: legalName,
    trading_name: tradingName,
    registration_number: registrationNumber,
    status: "PENDING",
    canonical_organisation_id: null,
    erp_business_partner_id: null,
    default_market_key: defaultMarketKey,
  })

  const membership = await b2b.createBuyerMemberships({
    organisation_id: organisation.id,
    customer_id: customerId,
    principal_id: customerId,
    status: "ACTIVE",
    invited_email: null,
    invitation_token_hash: null,
    invitation_expires_at: null,
    invitation_accepted_at: new Date(),
    effective_from: new Date(),
    effective_until: null,
  })

  res.status(201).json({
    organisation: {
      id: organisation.id,
      legal_name: organisation.legal_name,
      trading_name: organisation.trading_name,
      registration_number: organisation.registration_number,
      status: organisation.status,
      tenant_id: organisation.tenant_id,
      default_market_key: organisation.default_market_key,
      canonical_organisation_id: organisation.canonical_organisation_id,
    },
    membership: {
      id: membership.id,
      status: membership.status,
      customer_id: membership.customer_id,
    },
  })
}
