// Gate ZB-04 — tax registration profile for a buyer organisation.
// GET: any member. POST: ACCOUNT_ADMIN on ACTIVE org.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type TaxBody = {
  market_key?: unknown
  country_code?: unknown
  registration_type?: unknown
  registration_number?: unknown
}

const TAX_TYPES = ["VAT", "TIN", "IMPORTER", "EXPORTER", "OTHER"] as const
type TaxType = (typeof TAX_TYPES)[number]

const isTaxType = (value: unknown): value is TaxType =>
  typeof value === "string" && (TAX_TYPES as readonly string[]).includes(value)

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

const requireMember = async (
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
) => {
  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  if (memberships.length === 0 || memberships[0].status !== "ACTIVE") {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "the authenticated buyer has no active membership in this organisation",
    )
  }
  return memberships[0]
}

const requireAdmin = async (
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
) => {
  const membership = await requireMember(b2b, organisationId, customerId)
  const roles = await b2b.listBuyerRoles({ membership_id: membership.id })
  if (!roles.some((r) => r.role === "ACCOUNT_ADMIN")) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "only an ACCOUNT_ADMIN can update tax profile")
  }
  return membership
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const organisationId = req.params.id
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  await requireMember(b2b, organisationId, customerId)

  const registrations = await b2b.listTaxRegistrations({
    organisation_id: organisationId,
  })

  res.status(200).json({
    tax_registrations: registrations.map((r) => ({
      id: r.id,
      market_key: r.market_key,
      country_code: r.country_code,
      registration_type: r.registration_type,
      registration_number: r.registration_number,
      status: r.status,
      verified_at: r.verified_at,
      expires_at: r.expires_at,
    })),
  })
}

export const POST = async (req: AuthenticatedMedusaRequest<TaxBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const organisationId = req.params.id
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const organisation = await b2b.retrieveB2BOrganisation(organisationId)
  if (organisation.status !== "ACTIVE") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "tax registrations can only be added when the organisation is ACTIVE",
    )
  }

  await requireAdmin(b2b, organisationId, customerId)

  const marketKey = asString(req.body?.market_key)
  const countryCode = asString(req.body?.country_code)?.toUpperCase()
  const registrationNumber = asString(req.body?.registration_number)
  const registrationType = req.body?.registration_type

  if (!marketKey || !countryCode || !registrationNumber || !isTaxType(registrationType)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "market_key, country_code, registration_type and registration_number are required",
    )
  }
  if (countryCode.length !== 2) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "country_code must be ISO 3166-1 alpha-2")
  }

  const created = await b2b.createTaxRegistrations({
    organisation_id: organisationId,
    market_key: marketKey,
    country_code: countryCode,
    registration_type: registrationType,
    registration_number: registrationNumber,
    status: "PENDING",
    verified_at: null,
    expires_at: null,
  })

  res.status(201).json({
    tax_registration: {
      id: created.id,
      market_key: created.market_key,
      country_code: created.country_code,
      registration_type: created.registration_type,
      registration_number: created.registration_number,
      status: created.status,
    },
  })
}
