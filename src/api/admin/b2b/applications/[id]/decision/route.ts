import { createHash, randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  CANONICAL_ORGANISATION_VERIFIER,
  type CanonicalOrganisationVerifier,
} from "../../../../../../baobab/b2b/canonical-organisation-verifier"
import {
  assertBuyerApplicationTransition,
  principalIdFromAuthContext,
  resolveBuyerTenantId,
} from "../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"
import { EVENT_OUTBOX_MODULE } from "../../../../../../modules/event-outbox"
import type EventOutboxModuleService from "../../../../../../modules/event-outbox/service"

type DecisionBody = {
  decision?: unknown
  decision_reference?: unknown
  reason_code?: unknown
  canonical_organisation_id?: unknown
  expected_revision?: unknown
}

type Decision = "APPROVED" | "REJECTED"

const requiredText = (value: unknown, name: string, maximum = 128): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required`)
  }
  const text = value.trim()
  if (text.length > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is too long`)
  }
  return text
}

const runCompensations = async (compensations: Array<() => Promise<unknown>>) => {
  for (const compensate of compensations.reverse()) {
    try {
      await compensate()
    } catch {
      // Preserve the initiating error. Soft-deleted records and unique keys make
      // incomplete compensation visible to reconciliation rather than reusable.
    }
  }
}

export const POST = async (req: AuthenticatedMedusaRequest<DecisionBody>, res: MedusaResponse) => {
  const staffPrincipalId = principalIdFromAuthContext(req.auth_context)
  if (!staffPrincipalId) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "canonical staff Principal mapping is required for an admission decision",
    )
  }

  const decision = req.body?.decision
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "decision must be APPROVED or REJECTED",
    )
  }
  const decisionReference = requiredText(
    req.body?.decision_reference,
    "decision_reference",
  )
  const reasonCode = requiredText(req.body?.reason_code, "reason_code", 64)
  if (!/^[A-Z][A-Z0-9_]*$/.test(reasonCode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "reason_code must be an uppercase machine-readable code",
    )
  }
  const expectedRevision = req.body?.expected_revision
  if (
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "expected_revision must be a positive integer",
    )
  }
  const canonicalOrganisationId =
    decision === "APPROVED"
      ? requiredText(
          req.body?.canonical_organisation_id,
          "canonical_organisation_id",
          256,
        )
      : null
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key must contain between 16 and 128 characters",
    )
  }

  const tenantId = resolveBuyerTenantId()
  const normalized = {
    application_id: req.params.id,
    decision,
    decision_reference: decisionReference,
    reason_code: reasonCode,
    canonical_organisation_id: canonicalOrganisationId,
    expected_revision: expectedRevision,
  }
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const outbox = req.scope.resolve<EventOutboxModuleService>(EVENT_OUTBOX_MODULE)

  const replay = await b2b.listBuyerApplicationDecisions({
    idempotency_key: idempotencyKey,
  })
  if (replay.length > 0) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "Idempotency-Key was already used for a different admission decision",
      )
    }
    res.status(200).json({
      decision: {
        id: replay[0].id,
        application_id: replay[0].application_id,
        decision: replay[0].decision,
        decision_reference: replay[0].decision_reference,
        buyer_organisation_id: replay[0].buyer_organisation_id,
      },
    })
    return
  }

  const application = await b2b.retrieveBuyerApplication(req.params.id)
  if (application.tenant_id !== tenantId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer application was not found")
  }
  if (application.revision !== expectedRevision) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "buyer application changed; reload before deciding",
    )
  }
  if (application.status !== "UNDER_REVIEW") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "only an UNDER_REVIEW application can receive an admission decision",
    )
  }

  assertBuyerApplicationTransition(application.status, decision, {
    decisionReference,
    canonicalOrganisationId,
  })

  if (decision === "APPROVED") {
    if (!application.applicant_principal_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "applicant canonical Principal mapping is required before approval",
      )
    }
    let verifier: CanonicalOrganisationVerifier
    try {
      verifier = req.scope.resolve<CanonicalOrganisationVerifier>(
        CANONICAL_ORGANISATION_VERIFIER,
      )
    } catch {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "canonical organisation verification is not configured",
      )
    }
    const verification = await verifier.verify({
      tenantId,
      canonicalOrganisationId: canonicalOrganisationId as string,
      expectedKind: "BUYER_ORGANISATION",
    })
    if (
      !verification.verified ||
      verification.kind !== "BUYER_ORGANISATION" ||
      verification.canonicalOrganisationId !== canonicalOrganisationId
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Control Plane did not verify the canonical buyer organisation",
      )
    }
  }

  const compensations: Array<() => Promise<unknown>> = []
  let organisationId: string | null = null
  const occurredAt = new Date()
  const correlationId = randomUUID()

  try {
    if (decision === "APPROVED") {
      const organisation = await b2b.createB2BOrganisations({
        tenant_id: tenantId,
        legal_name: application.legal_name,
        trading_name: application.trading_name,
        registration_number: application.registration_number,
        status: "ACTIVE",
        canonical_organisation_id: canonicalOrganisationId,
        erp_business_partner_id: null,
        default_market_key: null,
      })
      organisationId = organisation.id
      compensations.push(() => b2b.deleteB2BOrganisations(organisation.id))

      const membership = await b2b.createBuyerMemberships({
        organisation_id: organisation.id,
        customer_id: application.applicant_customer_id,
        principal_id: application.applicant_principal_id,
        status: "ACTIVE",
        invited_email: null,
        invitation_token_hash: null,
        invitation_expires_at: null,
        invitation_accepted_at: occurredAt,
        effective_from: occurredAt,
        effective_until: null,
      })
      compensations.push(() => b2b.deleteBuyerMemberships(membership.id))

      const role = await b2b.createBuyerRoles({
        membership_id: membership.id,
        role: "ACCOUNT_ADMIN",
        assigned_by_principal_id: staffPrincipalId,
      })
      compensations.push(() => b2b.deleteBuyerRoles(role.id))
    }

    const recordedDecision = await b2b.createBuyerApplicationDecisions({
      application_id: application.id,
      decision,
      decided_by_principal_id: staffPrincipalId,
      decision_reference: decisionReference,
      reason_code: reasonCode,
      canonical_organisation_id: canonicalOrganisationId,
      buyer_organisation_id: organisationId,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      decided_at: occurredAt,
    })
    compensations.push(() => b2b.deleteBuyerApplicationDecisions(recordedDecision.id))

    const eventId = randomUUID()
    const eventType =
      "com.baobab-platform.customer.buyer-application.decision-recorded.v1"
    const envelope = {
      specversion: "1.0",
      id: eventId,
      type: eventType,
      source: "urn:baobab-platform:baobab-trade",
      subject: `buyer-application/${application.id}`,
      time: occurredAt.toISOString(),
      datacontenttype: "application/json",
      dataschema:
        "https://contracts.baobab-platform.com/buyer-organisation/v1/events.schema.json#/$defs/buyerApplicationDecisionEventData",
      baobabscope: "tenant",
      tenantid: tenantId,
      correlationid: correlationId,
      idempotencykey: `buyer-decision:${recordedDecision.id}`,
      data: {
        buyer_application_id: application.id,
        tenant_id: tenantId,
        decision,
        decided_by_principal_id: staffPrincipalId,
        decision_reference: decisionReference,
        reason_code: reasonCode,
      },
    }
    const outboxRecord = await outbox.createEventOutboxes({
      event_id: eventId,
      event_type: eventType,
      subject: envelope.subject,
      tenant_id: tenantId,
      correlation_id: correlationId,
      causation_id: null,
      idempotency_key: envelope.idempotencykey,
      envelope,
      status: "PENDING",
      attempt_count: 0,
      next_attempt_at: occurredAt,
    })
    compensations.push(() => outbox.deleteEventOutboxes(outboxRecord.id))

    await b2b.updateBuyerApplications(application.id, {
      status: decision,
      revision: Number(application.revision) + 1,
    })

    res.status(200).json({
      decision: {
        id: recordedDecision.id,
        application_id: application.id,
        decision,
        decision_reference: decisionReference,
        buyer_organisation_id: organisationId,
      },
    })
  } catch (error) {
    await runCompensations(compensations)
    throw error
  }
}
