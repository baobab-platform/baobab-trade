import { createHash } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  isBuyerKybEvidenceType,
  type BuyerKybEvidenceType,
} from "../../../../../../baobab/b2b/kyb-evidence"
import {
  principalIdFromAuthContext,
  resolveBuyerTenantId,
} from "../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"

type Body = {
  evidence_type?: unknown
  canonical_document_id?: unknown
  document_version?: unknown
  content_sha256?: unknown
  media_type?: unknown
  size_bytes?: unknown
  issued_at?: unknown
  expires_at?: unknown
}

const text = (value: unknown, name: string, maximum = 256): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required`)
  }
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is too long`)
  }
  return normalized
}

const date = (value: unknown, name: string): Date | null => {
  if (value === undefined || value === null || value === "") return null
  const parsed = new Date(text(value, name, 64))
  if (Number.isNaN(parsed.valueOf())) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must be an ISO timestamp`)
  }
  return parsed
}

const view = (item: Record<string, unknown>) => ({
  id: item.id,
  evidence_type: item.evidence_type,
  canonical_document_id: item.canonical_document_id,
  document_version: item.document_version,
  content_sha256: item.content_sha256,
  media_type: item.media_type,
  size_bytes: item.size_bytes,
  issued_at: item.issued_at,
  expires_at: item.expires_at,
  status: item.status,
  submitted_at: item.submitted_at,
})

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }
  if (!isBuyerKybEvidenceType(req.body?.evidence_type)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "unsupported evidence_type")
  }
  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "valid Idempotency-Key is required")
  }

  const contentSha256 = text(req.body.content_sha256, "content_sha256", 64).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "content_sha256 must be a SHA-256 digest")
  }
  const mediaType = text(req.body.media_type, "media_type", 128).toLowerCase()
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]+\/[a-z0-9][a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "media_type is invalid")
  }
  if (
    typeof req.body.size_bytes !== "number" ||
    !Number.isSafeInteger(req.body.size_bytes) ||
    req.body.size_bytes < 1 ||
    req.body.size_bytes > 25 * 1024 * 1024
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "size_bytes must be between 1 and 26214400")
  }
  const issuedAt = date(req.body.issued_at, "issued_at")
  const expiresAt = date(req.body.expires_at, "expires_at")
  if (issuedAt && expiresAt && expiresAt <= issuedAt) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "expires_at must be after issued_at")
  }

  const normalized = {
    application_id: req.params.id,
    evidence_type: req.body.evidence_type as BuyerKybEvidenceType,
    canonical_document_id: text(req.body.canonical_document_id, "canonical_document_id"),
    document_version: text(req.body.document_version, "document_version", 64),
    content_sha256: contentSha256,
    media_type: mediaType,
    size_bytes: req.body.size_bytes,
    issued_at: issuedAt?.toISOString() ?? null,
    expires_at: expiresAt?.toISOString() ?? null,
  }
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  const tenantId = resolveBuyerTenantId()
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const replay = await b2b.listBuyerApplicationEvidences({
    tenant_id: tenantId,
    idempotency_key: idempotencyKey,
  })
  if (replay.length) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "Idempotency-Key payload mismatch")
    }
    res.status(200).json({ evidence: view(replay[0] as unknown as Record<string, unknown>) })
    return
  }

  const application = await b2b.retrieveBuyerApplication(req.params.id)
  if (application.tenant_id !== tenantId || application.applicant_customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer application was not found")
  }
  if (!["SUBMITTED", "INFORMATION_REQUIRED"].includes(application.status)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "application is not accepting evidence")
  }

  const evidence = await b2b.createBuyerApplicationEvidences({
    ...normalized,
    tenant_id: tenantId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: "PENDING",
    submitted_by_customer_id: customerId,
    submitted_by_principal_id: principalIdFromAuthContext(req.auth_context),
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    submitted_at: new Date(),
  })
  res.status(201).json({ evidence: view(evidence as unknown as Record<string, unknown>) })
}
