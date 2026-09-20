import { createHash, randomBytes } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { principalIdFromAuthContext } from "../../../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../../../modules/b2b/service"

type NotificationService = {
  createNotifications(input: {
    to: string
    channel: "email"
    template: string
    data: Record<string, unknown>
  }): Promise<{ id?: string } | unknown>
}

const activeAdmin = async (b2b: B2BModuleService, organisationId: string, customerId: string) => {
  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
    status: "ACTIVE",
  })
  if (memberships.length !== 1) return false
  const roles = await b2b.listBuyerRoles({ membership_id: memberships[0].id })
  return roles.some((role) => role.role === "ACCOUNT_ADMIN")
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  const principalId = principalIdFromAuthContext(req.auth_context)
  if (!customerId || !principalId) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "canonical organisation administrator is required")
  }
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "valid Idempotency-Key is required")
  }
  const publicUrl = process.env.ZURIBEANS_PUBLIC_URL?.replace(/\/$/, "")
  const template = process.env.BAOBAB_BUYER_INVITATION_TEMPLATE?.trim()
  if (!publicUrl || !template) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "secure invitation delivery is not configured")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  if (!(await activeAdmin(b2b, req.params.id, customerId))) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "only an ACCOUNT_ADMIN can resend invitations")
  }
  const membership = await b2b.retrieveBuyerMembership(req.params.membershipId)
  if (
    membership.organisation_id !== req.params.id ||
    membership.status !== "INVITED" ||
    !membership.invited_email
  ) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "active invitation was not found")
  }

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisation_id: req.params.id, membership_id: membership.id }))
    .digest("hex")
  const replay = await b2b.listBuyerInvitationDeliveries({ idempotency_key: idempotencyKey })
  if (replay.length) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "Idempotency-Key payload mismatch")
    }
    res.status(200).json({
      membership_id: membership.id,
      delivery_status: replay[0].status,
      attempt_number: replay[0].attempt_number,
    })
    return
  }

  const deliveries = await b2b.listBuyerInvitationDeliveries(
    { membership_id: membership.id },
    { order: { attempt_number: "DESC" }, take: 1 },
  )
  const attemptNumber = Number(deliveries[0]?.attempt_number ?? 0) + 1
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const originalHash = membership.invitation_token_hash
  const originalExpiry = membership.invitation_expires_at
  await b2b.updateBuyerMemberships(membership.id, {
    invitation_token_hash: createHash("sha256").update(token).digest("hex"),
    invitation_expires_at: expiresAt,
  })
  const delivery = await b2b.createBuyerInvitationDeliveries({
    membership_id: membership.id,
    attempt_number: attemptNumber,
    status: "PENDING",
    requested_by_principal_id: principalId,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    provider_message_id: null,
    error_code: null,
    attempted_at: new Date(),
  })
  try {
    const notification = req.scope.resolve<NotificationService>(Modules.NOTIFICATION)
    const result = await notification.createNotifications({
      to: membership.invited_email,
      channel: "email",
      template,
      data: {
        organisation_name: (await b2b.retrieveB2BOrganisation(req.params.id)).legal_name,
        invitation_url: `${publicUrl}/account/invitations/accept?token=${encodeURIComponent(token)}`,
        expires_at: expiresAt.toISOString(),
      },
    })
    const providerId =
      result && typeof result === "object" && "id" in result ? String(result.id) : null
    await b2b.updateBuyerInvitationDeliveries(delivery.id, {
      status: "QUEUED",
      provider_message_id: providerId,
    })
  } catch (error) {
    await b2b.updateBuyerMemberships(membership.id, {
      invitation_token_hash: originalHash,
      invitation_expires_at: originalExpiry,
    }).catch(() => undefined)
    await b2b.updateBuyerInvitationDeliveries(delivery.id, {
      status: "FAILED",
      error_code: "NOTIFICATION_PROVIDER_ERROR",
    }).catch(() => undefined)
    throw error
  }
  res.status(202).json({
    membership_id: membership.id,
    delivery_status: "QUEUED",
    attempt_number: attemptNumber,
    invitation_expires_at: expiresAt,
  })
}
