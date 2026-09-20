// Gate ZB-04 — team roster and invite for a buyer organisation.
// GET: any member. POST invite: ACCOUNT_ADMIN only.
import { createHash, randomBytes } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type InviteBody = {
  email?: unknown
  role?: unknown
}

const INVITE_ROLES = ["BUYER", "SENIOR_BUYER", "APPROVER", "VIEWER"] as const
type InviteRole = (typeof INVITE_ROLES)[number]

const isInviteRole = (value: unknown): value is InviteRole =>
  typeof value === "string" && (INVITE_ROLES as readonly string[]).includes(value)

const loadCallerAdminContext = async (
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
) => {
  const callerMemberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  if (callerMemberships.length === 0) {
    return null
  }
  const membership = callerMemberships[0]
  if (membership.status !== "ACTIVE") {
    return null
  }
  const roles = await b2b.listBuyerRoles({ membership_id: membership.id })
  const isAdmin = roles.some((r) => r.role === "ACCOUNT_ADMIN")
  return { membership, isAdmin }
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const organisationId = req.params.id
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const callerMemberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  if (callerMemberships.length === 0) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "the authenticated buyer has no membership in this organisation",
    )
  }

  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
  })

  const membershipIds = memberships.map((m) => m.id)
  const roles =
    membershipIds.length > 0
      ? await b2b.listBuyerRoles({ membership_id: membershipIds })
      : []

  const rolesByMembership = new Map<string, string[]>()
  for (const role of roles) {
    const list = rolesByMembership.get(role.membership_id) ?? []
    list.push(role.role)
    rolesByMembership.set(role.membership_id, list)
  }

  res.status(200).json({
    organisation_id: organisationId,
    members: memberships.map((m) => ({
      id: m.id,
      customer_id: m.customer_id,
      principal_id: m.principal_id,
      status: m.status,
      invited_email: m.invited_email,
      invitation_accepted_at: m.invitation_accepted_at,
      roles: rolesByMembership.get(m.id) ?? [],
    })),
  })
}

export const POST = async (req: AuthenticatedMedusaRequest<InviteBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const organisationId = req.params.id
  const emailRaw = req.body?.email
  if (typeof emailRaw !== "string" || emailRaw.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "email is required")
  }
  const email = emailRaw.trim().toLowerCase()
  if (!/^[^
\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "email is invalid")
  }

  const role: InviteRole = isInviteRole(req.body?.role) ? req.body.role : "BUYER"

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(organisationId)
  if (organisation.status !== "ACTIVE") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "members can only be invited when the organisation is ACTIVE",
    )
  }

  const caller = await loadCallerAdminContext(b2b, organisationId, customerId)
  if (!caller?.isAdmin) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "only an ACCOUNT_ADMIN can invite members",
    )
  }

  const existingByEmail = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    invited_email: email,
  })
  if (existingByEmail.length > 0) {
    throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "that email is already invited")
  }

  const token = randomBytes(24).toString("hex")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  // Placeholder until the invitee registers and accepts; unique per org+email path.
  const pendingCustomerId = `invite:${email}`

  const membership = await b2b.createBuyerMemberships({
    organisation_id: organisationId,
    customer_id: pendingCustomerId,
    principal_id: pendingCustomerId,
    status: "INVITED",
    invited_email: email,
    invitation_token_hash: tokenHash,
    invitation_expires_at: expiresAt,
    invitation_accepted_at: null,
    effective_from: null,
    effective_until: null,
  })

  await b2b.createBuyerRoles({
    membership_id: membership.id,
    role,
    assigned_by_principal_id: customerId,
  })

  res.status(201).json({
    membership: {
      id: membership.id,
      status: membership.status,
      invited_email: membership.invited_email,
      invitation_expires_at: membership.invitation_expires_at,
      roles: [role],
    },
    // Opaque token for future accept flow / email delivery; not a login credential.
    invitation_token: token,
  })
}
