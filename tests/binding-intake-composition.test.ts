import { afterEach, expect, it, vi } from "vitest"
import NativeSellerCheckoutModuleService from "../src/modules/legal-seller-checkout/service"
import { HttpBindingAuthorityClient } from "../src/baobab/orders/binding-authority-client"
import { ClientCredentialsWorkloadTokenProvider } from "../src/baobab/control-plane/workload-token"
const scope = {
  cartId: "cart-withdraw",
  tenantId: "tn_test01",
  organisationId: "00000000-0000-4000-8000-000000000001",
  responsibleLegalEntityId: "LE-SELLER",
  marketCode: "ZA",
  currencyCode: "ZAR",
  salesChannelId: "channel",
  regionId: "region",
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
it("the actual module withdraws with current human authority after workload configuration is removed", async () => {
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("BAOBAB_ENVIRONMENT", "test")
  vi.stubEnv("BAOBAB_DEPLOYMENT_ENV", "test")
  vi.stubEnv("BAOBAB_BINDING_INTAKE_ENABLED", "true")
  vi.stubEnv("BAOBAB_CONTROL_PLANE_BASE_URL", "https://cp.example.test")
  for (const name of [
    "BAOBAB_IAM_WORKLOAD_TOKEN_URL",
    "BAOBAB_IAM_WORKLOAD_CLIENT_ID",
    "BAOBAB_IAM_WORKLOAD_CLIENT_SECRET",
  ])
    vi.stubEnv(name, "")
  vi.spyOn(HttpBindingAuthorityClient.prototype, "authorize").mockImplementation(
    async (_token, operation, s, digest) => {
      const now = Date.now()
      return {
        scope: s,
        command_digest: digest,
        decision_id: crypto.randomUUID(),
        principal_id: "prn_withdrawer",
        issuer: "https://iam.example.test",
        token_id: "human-token",
        scope_name: `trade-binding:${operation}`,
        evaluated_at: new Date(now).toISOString(),
        valid_until: new Date(now + 5000).toISOString(),
        matched_grant_ids: ["withdrawal-grant"],
        provider_permissions_granted: false,
      }
    },
  )
  const workload = vi
    .spyOn(ClientCredentialsWorkloadTokenProvider.prototype, "getAccessToken")
    .mockRejectedValue(new Error("workload revoked"))
  const revoke = vi.fn()
  const service = Object.create(
    NativeSellerCheckoutModuleService.prototype,
  ) as NativeSellerCheckoutModuleService
  Object.defineProperty(service, "bindingPersistence", {
    value: {
      load: async () => ({
        scope,
        proposal: {
          scope,
          maker: { subject: "prn_maker" },
          proposedAt: new Date(Date.now() - 60000).toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          evidenceReference: "historical-cp-proposal",
        },
        revision: 2,
        status: "ACTIVE",
        approvedBy: "prn_checker",
      }),
      revoke,
    },
  })
  const native = vi.fn().mockRejectedValue(new Error("native completed or unavailable"))
  await service.executeBindingCommand(
    "revoke",
    scope.cartId,
    { revision: 2, reason: "withdraw after workload/mandate expiry" },
    "actual-human-token",
    native,
  )
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(workload).not.toHaveBeenCalled()
  expect(native).not.toHaveBeenCalled()
})
