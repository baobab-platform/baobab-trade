import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveBuyerTenantId } from "../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { ERP_INTEGRATION_MODULE } from "../../../../modules/erp-integration"
import type ErpIntegrationModuleService from "../../../../modules/erp-integration/service"
import { EVENT_OUTBOX_MODULE } from "../../../../modules/event-outbox"
import type EventOutboxModuleService from "../../../../modules/event-outbox/service"

const CONSUMER = "trade-buyer-commercial-profile-v1"
const EVENT_TYPE = "com.baobab-platform.customer.buyer-commercial-profile.changed.v1"
const ERP_SOURCE = "urn:baobab-platform:baobab-erp"

type CreditStatus = "APPROVED" | "ON_HOLD" | "REJECTED"
type RecordLike = Record<string, unknown>

const requiredText = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required`)
  }
  return value.trim()
}

const verifySignature = (body: unknown, supplied: unknown): void => {
  const secret = process.env.BAOBAB_WEBHOOK_SIGNING_SECRET
  if (!secret) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "ERP event signing is not configured")
  }
  const value = typeof supplied === "string" ? supplied.replace(/^sha256=/, "") : ""
  const expected = createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex")
  const valid =
    /^[0-9a-f]{64}$/i.test(value) &&
    timingSafeEqual(Buffer.from(value.toLowerCase(), "hex"), Buffer.from(expected, "hex"))
  if (!valid) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "invalid ERP event signature")
}

const normalize = (body: unknown) => {
  if (!body || typeof body !== "object") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "CloudEvent body is required")
  }
  const event = body as RecordLike
  const dataValue = event.data ?? event.payload
  if (!dataValue || typeof dataValue !== "object") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "event data is required")
  }
  const data = dataValue as RecordLike
  const type = requiredText(event.type ?? event.event_type, "type")
  const source = requiredText(event.source, "source")
  if (type !== EVENT_TYPE || source !== ERP_SOURCE) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "unsupported ERP event")
  }
  const creditStatus = requiredText(data.credit_status, "credit_status") as CreditStatus
  if (!["APPROVED", "ON_HOLD", "REJECTED"].includes(creditStatus)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid credit_status")
  }
  const currencyCode = requiredText(data.currency_code, "currency_code").toUpperCase()
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "currency_code must be ISO 4217")
  }
  const limit = data.credit_limit_minor
  if (limit !== null && limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "credit_limit_minor must be a non-negative safe integer")
  }
  const paymentTerm = data.payment_term_code == null ? null : requiredText(data.payment_term_code, "payment_term_code")
  if (creditStatus === "APPROVED" && !paymentTerm) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "approved profile requires payment_term_code")
  }
  const observedAt = new Date(requiredText(data.as_of ?? event.time ?? event.occurred_at, "as_of"))
  if (Number.isNaN(observedAt.valueOf())) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "as_of must be an ISO timestamp")
  }
  const tenantId = requiredText(event.tenantid ?? event.tenant_id ?? data.tenant_id, "tenantid")
  const legalEntityId = requiredText(event.entityid ?? event.entity_id ?? data.legal_entity_id, "entityid")
  if (
    (data.tenant_id !== undefined && data.tenant_id !== tenantId) ||
    (data.legal_entity_id !== undefined && data.legal_entity_id !== legalEntityId)
  ) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ERP event envelope and data scope mismatch")
  }
  return {
    eventId: requiredText(event.id ?? event.event_id, "id"),
    correlationId: requiredText(event.correlationid ?? event.correlation_id, "correlationid"),
    tenantId,
    legalEntityId,
    buyerOrganisationId: requiredText(data.buyer_organisation_id, "buyer_organisation_id"),
    businessPartnerId: requiredText(data.business_partner_id, "business_partner_id"),
    profileReference: requiredText(data.profile_reference, "profile_reference"),
    sourceSystem: requiredText(data.source_system, "source_system"),
    creditStatus,
    currencyCode,
    paymentTerm,
    creditLimitMinor: limit == null ? null : Number(limit),
    observedAt,
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  verifySignature(req.body, req.headers["x-baobab-signature"])
  const input = normalize(req.body)
  const configuredTenant = resolveBuyerTenantId()
  if (input.tenantId !== configuredTenant || input.sourceSystem !== "ERP") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "ERP event scope mismatch")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const erp = req.scope.resolve<ErpIntegrationModuleService>(ERP_INTEGRATION_MODULE)
  const events = req.scope.resolve<EventOutboxModuleService>(EVENT_OUTBOX_MODULE)
  const receipts = await events.listEventConsumerReceipts({
    consumer_name: CONSUMER,
    event_id: input.eventId,
  })
  if (receipts.length) {
    res.status(200).json({ status: "ALREADY_PROCESSED", event_id: input.eventId })
    return
  }

  const organisation = await b2b.retrieveB2BOrganisation(input.buyerOrganisationId)
  if (
    organisation.tenant_id !== configuredTenant ||
    !organisation.canonical_organisation_id ||
    organisation.status === "CLOSED"
  ) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "buyer organisation is not eligible for ERP projection")
  }

  const projection = await erp.createBuyerCommercialProfileProjections({
    buyer_organisation_id: organisation.id,
    tenant_id: configuredTenant,
    legal_entity_id: input.legalEntityId,
    business_partner_id: input.businessPartnerId,
    credit_status: input.creditStatus,
    payment_term_code: input.paymentTerm,
    credit_limit_minor: input.creditLimitMinor,
    currency_code: input.currencyCode,
    profile_reference: input.profileReference,
    source_event_id: input.eventId,
    source_correlation_id: input.correlationId,
    observed_at: input.observedAt,
    applied_at: new Date(),
  })

  let activated = false
  let receipt: { id: string } | undefined
  try {
    if (input.creditStatus === "APPROVED" && organisation.status === "PENDING") {
      await b2b.updateB2BOrganisations(organisation.id, {
        status: "ACTIVE",
        erp_business_partner_id: input.businessPartnerId,
      })
      activated = true
    } else if (organisation.erp_business_partner_id !== input.businessPartnerId) {
      await b2b.updateB2BOrganisations(organisation.id, {
        erp_business_partner_id: input.businessPartnerId,
      })
    }
    receipt = await events.createEventConsumerReceipts({
      consumer_name: CONSUMER,
      event_id: input.eventId,
      event_type: EVENT_TYPE,
      correlation_id: input.correlationId,
      processed_at: new Date(),
    })
    if (activated) {
      const emittedAt = new Date()
      const eventId = randomUUID()
      await events.createEventOutboxes({
        event_id: eventId,
        event_type: "com.baobab-platform.customer.buyer-organisation.status-changed.v1",
        subject: `buyer-organisation/${organisation.id}`,
        tenant_id: configuredTenant,
        correlation_id: input.correlationId,
        causation_id: input.eventId,
        idempotency_key: `buyer-activation:${input.eventId}`,
        envelope: {
          specversion: "1.0",
          id: eventId,
          type: "com.baobab-platform.customer.buyer-organisation.status-changed.v1",
          source: "urn:baobab-platform:baobab-trade",
          subject: `buyer-organisation/${organisation.id}`,
          time: emittedAt.toISOString(),
          datacontenttype: "application/json",
          baobabscope: "tenant",
          tenantid: configuredTenant,
          correlationid: input.correlationId,
          causationid: input.eventId,
          data: {
            buyer_organisation_id: organisation.id,
            previous_status: "PENDING",
            status: "ACTIVE",
            authority: "ERP",
            profile_reference: input.profileReference,
          },
        },
        status: "PENDING",
        attempt_count: 0,
        next_attempt_at: emittedAt,
      })
    }
  } catch (error) {
    if (receipt) await events.deleteEventConsumerReceipts(receipt.id).catch(() => undefined)
    if (activated) {
      await b2b.updateB2BOrganisations(organisation.id, {
        status: "PENDING",
        erp_business_partner_id: organisation.erp_business_partner_id ?? null,
      }).catch(() => undefined)
    }
    await erp.deleteBuyerCommercialProfileProjections(projection.id).catch(() => undefined)
    throw error
  }

  res.status(202).json({
    status: "PROCESSED",
    event_id: input.eventId,
    buyer_organisation_id: organisation.id,
    credit_status: input.creditStatus,
    organisation_status: activated ? "ACTIVE" : organisation.status,
  })
}
