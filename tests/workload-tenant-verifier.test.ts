import { afterEach, describe, expect, it, vi } from "vitest"
import type { ControlPlaneClient } from "../src/baobab/control-plane/client"
import {
  ControlPlaneWorkloadTenantVerifier,
  TenantAttestationError,
  getWorkloadTenantVerifier,
  resetWorkloadTenantVerifierForTests,
} from "../src/baobab/control-plane/workload-tenant-verifier"
import type { WorkloadTokenProvider } from "../src/baobab/control-plane/workload-token"

const fakeTokenProvider = (accessToken = "workload-token"): WorkloadTokenProvider => ({
  getAccessToken: vi.fn().mockResolvedValue(accessToken),
})

const fakeControlPlaneClient = (
  resolvePlatformContext: ControlPlaneClient["resolvePlatformContext"],
): ControlPlaneClient => ({
  resolveContext: vi.fn(),
  getMarket: vi.fn(),
  resolveMapping: vi.fn(),
  resolvePlatformContext,
})

describe("ControlPlaneWorkloadTenantVerifier", () => {
  it("resolves without throwing when the Control Plane attests the asserted tenant", async () => {
    const resolvePlatformContext = vi.fn().mockResolvedValue({
      context_id: "ctx_1",
      tenant_id: "tn_1",
      resolved_at: "2026-09-01T10:00:00Z",
    })
    const verifier = new ControlPlaneWorkloadTenantVerifier(
      fakeTokenProvider(),
      fakeControlPlaneClient(resolvePlatformContext),
    )

    await expect(
      verifier.verifyOrganisationTenant("tn_1", "canon-org-1", "corr-1"),
    ).resolves.toBeUndefined()
    expect(resolvePlatformContext).toHaveBeenCalledWith(
      "tn_1",
      "canon-org-1",
      "workload-token",
      "corr-1",
    )
  })

  it("throws TenantAttestationError when the Control Plane echoes a different tenant_id", async () => {
    const resolvePlatformContext = vi.fn().mockResolvedValue({
      context_id: "ctx_1",
      tenant_id: "tn_someone_else",
      resolved_at: "2026-09-01T10:00:00Z",
    })
    const verifier = new ControlPlaneWorkloadTenantVerifier(
      fakeTokenProvider(),
      fakeControlPlaneClient(resolvePlatformContext),
    )

    await expect(
      verifier.verifyOrganisationTenant("tn_1", "canon-org-1", "corr-1"),
    ).rejects.toThrow(TenantAttestationError)
  })

  it("propagates a Control Plane rejection rather than treating it as attested", async () => {
    const resolvePlatformContext = vi.fn().mockRejectedValue(new Error("not found"))
    const verifier = new ControlPlaneWorkloadTenantVerifier(
      fakeTokenProvider(),
      fakeControlPlaneClient(resolvePlatformContext),
    )

    await expect(
      verifier.verifyOrganisationTenant("tn_1", "canon-org-1", "corr-1"),
    ).rejects.toThrow("not found")
  })
})

describe("getWorkloadTenantVerifier", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetWorkloadTenantVerifierForTests()
  })

  it("stays disabled (null) unless the workload client secret and IAM token URL are configured", () => {
    expect(getWorkloadTenantVerifier()).toBeNull()
  })

  it("stays disabled when the Control Plane base URL is not configured", () => {
    vi.stubEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL", "https://iam.example.test/token")
    vi.stubEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET", "secret-1")
    expect(getWorkloadTenantVerifier()).toBeNull()
  })

  it("builds a verifier once every required setting is configured", () => {
    vi.stubEnv("BAOBAB_CONTROL_PLANE_BASE_URL", "https://control-plane.example.test")
    vi.stubEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL", "https://iam.example.test/token")
    vi.stubEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET", "secret-1")

    const verifier = getWorkloadTenantVerifier()
    expect(verifier).not.toBeNull()
    expect(getWorkloadTenantVerifier()).toBe(verifier)
  })
})
