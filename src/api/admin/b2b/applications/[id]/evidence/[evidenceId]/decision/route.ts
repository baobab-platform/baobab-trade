import { createHash, randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  principalIdFromAuthContext,
  resolveBuyerTenantId,
} from "../../../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../../../modules/b2b/service"
import { EVENT_OUTBOX_MODULE } from "../../../../../../../../modules/event-outbox"
import type EventOutboxModuleService from "../../../../../../../../modules/event-outbox/service"

type Body = {
  decision?: unknown
  decision_reference?: unknown
  reason_code?: unknown
  note?: unknown
}

const required = (value: unknown, name: string, maximum = 128) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required`)
  }
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is too long`)
  }
  return normalized
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const reviewerPrincipalId = principalIdFromAuthContext(req.auth_context)
  if (!reviewerPrincipalId) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "canonical staff Principal is required")
  }
  const decision = req.body?.decision
  if (decision !== "VERIFIED" && decision !== "REJECTED") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "decision must be VERIFIED or REJECTED")
  }
  const decisionReference = required(req.body.decision_reference, "decision_reference")
  const reasonCode = required(req.body.reason_code, "reason_code", 64)
  if (!/^[A-Z][A-Z0-9_]*$/.test(reasonCode)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "reason_code is invalid")
  }
  const note = req.body.note == null ? null : required(req.body.note, "note", 2000)
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "valid Idempotency-Key is required")
  }
  const tenantId = resolveBuyerTenantId()
  const normalized = {
    application_id: req.params.id,
    evidence_id: req.params.evidenceId,
    decision,
    decision_reference: decisionReference,
    reason_code: reasonCode,
    note,
  }
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const outbox = req.scope.resolve<EventOutboxModuleService>(EVENT_OUTBOX_MODULE)

  const replay = await b2b.listBuyerApplicationEvidenceDecisions({
    tenant_id: tenantId,
    idempotency_key: idempotencyKey,
  })
  if (replay.length) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "Idempotency-Key payload mismatch")
    }
    res.status(200).json({ decision: replay[0] })
    return
  }

  const application = await b2b.retrieveBuyerApplication(req.params.id)
  const evidence = await b2b.retrieveBuyerApplicationEvidence(req.params.evidenceId)
  if (
    application.tenant_id !== tenantId ||
    evidence.tenant_id !== tenantId ||
    evidence.application_id !== application.id
  ) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "application evidence was not found")
  }
  if (!["SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW"].includes(application.status)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "application evidence can no longer be decided")
  }
  if (decision === "VERIFIED" && evidence.expires_at && new Date(evidence.expires_at) <= new Date()) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "expired evidence cannot be verified")
  }
  if (evidence.status !== "PENDING") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "application evidence already has a decision")
  }

  const occurredAt = new Date()
  const recorded = await b2b.createBuyerApplicationEvidenceDecisions({
    application_id: application.id,
    evidence_id: evidence.id,
    tenant_id: tenantId,
    decision,
    reviewer_principal_id: reviewerPrincipalId,
    decision_reference: decisionReference,
    reason_code: reasonCode,
    note,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    decided_at: occurredAt,
  })
  let updated = false
  let eventRecord: { id: string } | undefined
  try {
    await b2b.updateBuyerApplicationEvidences(evidence.id, { status: decision })
    updated = true
    const eventId = randomUUID()
    const correlationId = randomUUID()
    eventRecord = await outbox.createEventOutboxes({
      event_id: eventId,
      event_type: "com.baobab-platform.customer.buyer-application-evidence.decided.v1",
      subject: `buyer-application-evidence/${evidence.id}`,
      tenant_id: tenantId,
      correlation_id: correlationId,
      causation_id: null,
      idempotency_key: `buyer-evidence-decision:${recorded.id}`,
      envelope: {
        specversion: "1.0",
        id: eventId,
        type: "com.baobab-platform.customer.buyer-application-evidence.decided.v1",
        source: "urn:baobab-platform:baobab-trade",
        subject: `buyer-application-evidence/${evidence.id}`,
        time: occurredAt.toISOString(),
        datacontenttype: "application/json",
        dataschema: "https://contracts.baobab-platform.com/buyer-organisation/v1/events.schema.json#/$defs/buyerApplicationEvidenceDecisionEventData",
        baobabscope: "tenant",
        tenantid: tenantId,
        correlationid: correlationId,
        data: {
          buyer_application_id: application.id,
          evidence_id: evidence.id,
          evidence_type: evidence.evidence_type,
          canonical_document_id: evidence.canonical_document_id,
          document_version: evidence.document_version,
          content_sha256: evidence.content_sha256,
          decision,
          decision_reference: decisionReference,
          reason_code: reasonCode,
          reviewed_by_principal_id: reviewerPrincipalId,
        },
      },
      status: "PENDING",
      attempt_count: 0,
      next_attempt_at: occurredAt,
    })
  } catch (error) {
    if (eventRecord) await outbox.deleteEventOutboxes(eventRecord.id).catch(() => undefined)
    if (updated) await b2b.updateBuyerApplicationEvidences(evidence.id, { status: "PENDING" }).catch(() => undefined)
    await b2b.deleteBuyerApplicationEvidenceDecisions(recorded.id).catch(() => undefined)
    throw error
  }
  res.status(200).json({ decision: recorded })
}
