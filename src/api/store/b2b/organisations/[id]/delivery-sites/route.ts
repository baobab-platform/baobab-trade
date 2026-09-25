// Gate ZB-04 — organisation delivery/billing sites (ADR-0017 §§45–47).
// Sites are organisation-approved addresses; not customer identity.
// GET: any ACTIVE member. POST: ACCOUNT_ADMIN on ACTIVE organisation.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type SiteBody = {
  market_key?: unknown
  code?: unknown
  name?: unknown
  address_1?: unknown
  address_2?: unknown
  city?: unknown
  province?: unknown
  postal_code?: unknown
  country_code?: unknown
  contact_name?: unknown
  contact_phone?: unknown
  allow_shipping?: unknown
  allow_billing?: unknown
}

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

const requireActiveMember = async (
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

const requireAccountAdmin = async (
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
) => {
  const membership = await requireActiveMember(b2b, organisationId, customerId)
  const roles = await b2b.listBuyerRoles({ membership_id: membership.id })
  if (!roles.some((r) => r.role === "ACCOUNT_ADMIN")) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "only an ACCOUNT_ADMIN can manage delivery sites",
    )
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
  await requireActiveMember(b2b, organisationId, customerId)

  const sites = await b2b.listDeliverySites({ organisation_id: organisationId })

  res.status(200).json({
    delivery_sites: sites.map((s) => ({
      id: s.id,
      market_key: s.market_key,
      code: s.code,
      name: s.name,
      status: s.status,
      address_1: s.address_1,
      address_2: s.address_2,
      city: s.city,
      province: s.province,
      postal_code: s.postal_code,
      country_code: s.country_code,
      contact_name: s.contact_name,
      contact_phone: s.contact_phone,
      allow_shipping: s.allow_shipping,
      allow_billing: s.allow_billing,
    })),
  })
}

export const POST = async (req: AuthenticatedMedusaRequest<SiteBody>, res: MedusaResponse) => {
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
      "delivery sites can only be added when the organisation is ACTIVE",
    )
  }

  await requireAccountAdmin(b2b, organisationId, customerId)

  const marketKey = asString(req.body?.market_key)
  const code = asString(req.body?.code)
  const name = asString(req.body?.name)
  const address1 = asString(req.body?.address_1)
  const city = asString(req.body?.city)
  const countryCode = asString(req.body?.country_code)?.toUpperCase()

  if (!marketKey || !code || !name || !address1 || !city || !countryCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "market_key, code, name, address_1, city and country_code are required",
    )
  }
  if (countryCode.length !== 2) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "country_code must be ISO 3166-1 alpha-2")
  }

  const allowShipping =
    typeof req.body?.allow_shipping === "boolean" ? req.body.allow_shipping : true
  const allowBilling =
    typeof req.body?.allow_billing === "boolean" ? req.body.allow_billing : false

  const created = await b2b.createDeliverySites({
    organisation_id: organisationId,
    market_key: marketKey,
    code,
    name,
    status: "ACTIVE",
    address_1: address1,
    address_2: asString(req.body?.address_2),
    city,
    province: asString(req.body?.province),
    postal_code: asString(req.body?.postal_code),
    country_code: countryCode,
    contact_name: asString(req.body?.contact_name),
    contact_phone: asString(req.body?.contact_phone),
    allow_shipping: allowShipping,
    allow_billing: allowBilling,
  })

  res.status(201).json({
    delivery_site: {
      id: created.id,
      market_key: created.market_key,
      code: created.code,
      name: created.name,
      status: created.status,
      address_1: created.address_1,
      city: created.city,
      country_code: created.country_code,
      allow_shipping: created.allow_shipping,
      allow_billing: created.allow_billing,
    },
  })
}
