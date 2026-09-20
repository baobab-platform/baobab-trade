import { createHash, randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { principalIdFromAuthContext, resolveBuyerTenantId } from "../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"
import { EVENT_OUTBOX_MODULE } from "../../../../../../modules/event-outbox"
import type EventOutboxModuleService from "../../../../../../modules/event-outbox/service"

type Body = {
  legal_entity_id?: unknown
  billing_country?: unknown
  default_currency?: unknown
  source_version?: unknown
}

const code = (value: unknown, size: number, name: string) => {
  if (typeof value !== "string" || value.trim().length !== size) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is invalid`)
  }
  return value.trim().toUpperCase()
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const principalId = principalIdFromAuthContext(req.auth_context)
  if (!principalId) throw new MedusaError(MedusaError.Types.FORBIDDEN, "canonical staff Principal is required")
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "valid Idempotency-Key is required")
  }
  const legalEntityId = typeof req.body.legal_entity_id === "string" ? req.body.legal_entity_id.trim() : ""
  if (!legalEntityId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "legal_entity_id is required")
  const billingCountry = code(req.body.billing_country, 2, "billing_country")
  const defaultCurrency = code(req.body.default_currency, 3, "default_currency")
  const sourceVersion = String(req.body.source_version ?? "").trim()
  if (!/^[1-9][0-9]*$/.test(sourceVersion)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "source_version must be a positive integer")
  }

  const tenantId = resolveBuyerTenantId()
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const outbox = req.scope.resolve<EventOutboxModuleService>(EVENT_OUTBOX_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(req.params.id)
  if (organisation.tenant_id !== tenantId) throw new MedusaError(MedusaError.Types.NOT_FOUND, "organisation not found")
  if (organisation.status !== "PENDING" || !organisation.canonical_organisation_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "only a canonically linked PENDING organisation can be projected")
  }

  const normalized = { organisation_id: organisation.id, legal_entity_id: legalEntityId, billing_country: billingCountry, default_currency: defaultCurrency, source_version: sourceVersion }
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  const replays = await outbox.listEventOutboxes({ idempotency_key: idempotencyKey })
  if (replays.length) {
    const replayData = replays[0].envelope?.data ?? {}
    const replayHash = createHash("sha256").update(JSON.stringify({
      organisation_id: replayData.buyer_organisation_id,
      legal_entity_id: replays[0].envelope?.entityid,
      billing_country: replayData.billing_country,
      default_currency: replayData.default_currency,
      source_version: replayData.source_version,
    })).digest("hex")
    if (replayHash !== requestHash) throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "Idempotency-Key payload mismatch")
    res.status(200).json({ status: "ALREADY_REQUESTED", event_id: replays[0].event_id })
    return
  }

  const eventId = randomUUID()
  const occurredAt = new Date()
  const eventType = "com.baobab-platform.customer.buyer-erp-projection.requested.v1"
  const envelope = {
    specversion: "1.0", id: eventId, type: eventType,
    source: "urn:baobab-platform:baobab-trade", subject: `buyer-organisation/${organisation.id}`,
    time: occurredAt.toISOString(), datacontenttype: "application/json",
    baobabscope: "legal-entity", tenantid: tenantId, entityid: legalEntityId,
    correlationid: randomUUID(), idempotencykey: idempotencyKey,
    data: {
      buyer_organisation_id: organisation.id,
      canonical_organisation_id: organisation.canonical_organisation_id,
      display_name: organisation.trading_name || organisation.legal_name,
      billing_country: billingCountry,
      default_currency: defaultCurrency,
      source_version: sourceVersion,
      requested_by_principal_id: principalId,
    },
  }
  await outbox.createEventOutboxes({
    event_id: eventId, event_type: eventType, subject: envelope.subject,
    tenant_id: tenantId, correlation_id: envelope.correlationid, causation_id: null,
    idempotency_key: idempotencyKey, envelope, status: "PENDING",
    attempt_count: 0, next_attempt_at: occurredAt,
  })
  res.status(202).json({ status: "QUEUED", event_id: eventId })
}
