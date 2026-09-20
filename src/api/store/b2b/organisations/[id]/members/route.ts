// Gate ZB-04 — team roster and secure member invitation delivery.
import { createHash, randomBytes } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { principalIdFromAuthContext } from "../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type InviteBody = {
  email?: unknown
  role?: unknown
}

type NotificationService = {
  createNotifications(input: {
    to: string
    channel: "email"
    template: string
    data: Record<string, unknown>
  }): Promise<unknown>
}

const INVITE_ROLES = ["BUYER", "SENIOR_BUYER", "APPROVER", "VIEWER"] as const
type InviteRole = (typeof INVITE_ROLES)[number]
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isInviteRole = (value: unknown): value is InviteRole =>
  typeof value === "string" && (INVITE_ROLES as readonly string[]).includes(value)

const activeAdmin = async (
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
) => {
  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
    status: "ACTIVE",
  })
  if (memberships.length !== 1) return false
  const roles = await b2b.listBuyerRoles({ membership_id: memberships[0].id })
  return roles.some((role) => role.role === "ACCOUNT_ADMIN")
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
  if (!callerMemberships.some((membership) => membership.status === "ACTIVE")) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "an active membership in this organisation is required",
    )
  }

  const memberships = await b2b.listBuyerMemberships({ organisation_id: organisationId })
  const membershipIds = memberships.map((membership) => membership.id)
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
    members: memberships.map((membership) => ({
      id: membership.id,
      customer_id: membership.customer_id,
      principal_id: membership.principal_id,
      status: membership.status,
      invited_email: membership.invited_email,
      invitation_accepted_at: membership.invitation_accepted_at,
      roles: rolesByMembership.get(membership.id) ?? [],
    })),
  })
}

export const POST = async (req: AuthenticatedMedusaRequest<InviteBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }
  const inviterPrincipalId = principalIdFromAuthContext(req.auth_context)
  if (!inviterPrincipalId) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "canonical Principal mapping is required to invite organisation members",
    )
  }

  const emailValue = req.body?.email
  if (typeof emailValue !== "string" || !EMAIL_PATTERN.test(emailValue.trim())) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "a valid email is required")
  }
  const email = emailValue.trim().toLowerCase()
  const role: InviteRole = isInviteRole(req.body?.role) ? req.body.role : "BUYER"
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key must contain between 16 and 128 characters",
    )
  }

  const organisationId = req.params.id
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisation_id: organisationId, email, role }))
    .digest("hex")

  const publicUrl = process.env.ZURIBEANS_PUBLIC_URL?.replace(/\/$/, "")
  const template = process.env.BAOBAB_BUYER_INVITATION_TEMPLATE?.trim()
  if (!publicUrl || !template) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "secure invitation delivery is not configured",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(organisationId)
  if (organisation.status !== "ACTIVE") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "members can only be invited to an ACTIVE organisation",
    )
  }
  if (!(await activeAdmin(b2b, organisationId, customerId))) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "only an ACCOUNT_ADMIN can invite members",
    )
  }

  const replay = await b2b.listBuyerMemberships({
    invitation_idempotency_key: idempotencyKey,
  })
  if (replay.length > 0) {
    if (replay[0].invitation_request_hash !== requestHash) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "Idempotency-Key was already used for a different invitation",
      )
    }
    res.status(200).json({
      membership: {
        id: replay[0].id,
        status: replay[0].status,
        invited_email: replay[0].invited_email,
      },
      delivery_status: "ALREADY_REQUESTED",
    })
    return
  }

  const existing = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    invited_email: email,
  })
  if (existing.length > 0) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "that email already has a membership or invitation for this organisation",
    )
  }

  const token = randomBytes(32).toString("base64url")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const membership = await b2b.createBuyerMemberships({
    organisation_id: organisationId,
    customer_id: null,
    principal_id: null,
    status: "INVITED",
    invited_email: email,
    invitation_token_hash: tokenHash,
    invitation_idempotency_key: idempotencyKey,
    invitation_request_hash: requestHash,
    invitation_expires_at: expiresAt,
    invitation_accepted_at: null,
    effective_from: null,
    effective_until: null,
  })

  let assignedRole: { id: string }
  try {
    assignedRole = await b2b.createBuyerRoles({
      membership_id: membership.id,
      role,
      assigned_by_principal_id: inviterPrincipalId,
    })
  } catch (error) {
    await b2b.deleteBuyerMemberships(membership.id)
    throw error
  }

  let delivery: { id: string }
  try {
    delivery = await b2b.createBuyerInvitationDeliveries({
      membership_id: membership.id,
      attempt_number: 1,
      status: "PENDING",
      requested_by_principal_id: inviterPrincipalId,
      provider_message_id: null,
      error_code: null,
      attempted_at: new Date(),
    })
  } catch (error) {
    await b2b.deleteBuyerRoles(assignedRole.id)
    await b2b.deleteBuyerMemberships(membership.id)
    throw error
  }

  try {
    const notification = req.scope.resolve<NotificationService>(Modules.NOTIFICATION)
    const deliveryResult = await notification.createNotifications({
      to: email,
      channel: "email",
      template,
      data: {
        organisation_name: organisation.legal_name,
        invitation_url: `${publicUrl}/account/invitations/accept?token=${encodeURIComponent(token)}`,
        expires_at: expiresAt.toISOString(),
      },
    })
    const providerId =
      deliveryResult && typeof deliveryResult === "object" && "id" in deliveryResult
        ? String(deliveryResult.id)
        : null
    await b2b.updateBuyerInvitationDeliveries(delivery.id, {
      status: "QUEUED",
      provider_message_id: providerId,
    })
  } catch (error) {
    await b2b.updateBuyerInvitationDeliveries(delivery.id, {
      status: "FAILED",
      error_code: "NOTIFICATION_PROVIDER_ERROR",
    }).catch(() => undefined)
    throw error
  }

  res.status(202).json({
    membership: {
      id: membership.id,
      status: membership.status,
      invited_email: membership.invited_email,
      invitation_expires_at: membership.invitation_expires_at,
      roles: [role],
    },
    delivery_status: "QUEUED",
  })
}
