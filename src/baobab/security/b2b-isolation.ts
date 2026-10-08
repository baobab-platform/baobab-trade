import { assertActiveBuyerContext, assertRole, type B2BRole, type BuyerContext } from "../b2b"

export type AuthoritativeBuyerContext = BuyerContext & { tenantId: string }
export type ProtectedB2BResource = {
  tenantId: string
  organisationId: string
  ownerPrincipalId?: string
}

export const authorizeB2BResource = (
  context: AuthoritativeBuyerContext,
  resource: ProtectedB2BResource,
  permittedRoles: readonly B2BRole[],
): void => {
  if (!context.tenantId || context.tenantId !== resource.tenantId)
    throw new Error("TENANT_SCOPE_MISMATCH")
  assertActiveBuyerContext(context, resource.organisationId)
  assertRole(context, permittedRoles)
}

export const assertPrincipalBinding = (
  authenticatedPrincipalId: string,
  context: AuthoritativeBuyerContext,
): void => {
  if (authenticatedPrincipalId !== context.principalId)
    throw new Error("PRINCIPAL_BINDING_MISMATCH")
}

const forbiddenEventKeys = /(?:password|secret|token|authorization|cvv|cvc|card[_-]?number|pan)$/i

export const assertNoSensitiveEventData = (value: unknown, path = "data"): void => {
  if (Array.isArray(value))
    return value.forEach((item, index) => assertNoSensitiveEventData(item, `${path}[${index}]`))
  if (typeof value !== "object" || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenEventKeys.test(key)) throw new Error(`SENSITIVE_EVENT_FIELD:${path}.${key}`)
    assertNoSensitiveEventData(nested, `${path}.${key}`)
  }
}
