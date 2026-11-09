import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "../src/api/readiness/route"
import { getBaobabTradeEnvironment } from "../src/baobab/config/environment"
import { checkTradeReadiness } from "../src/baobab/health/readiness"

vi.mock("../src/baobab/config/environment", () => ({
  getBaobabTradeEnvironment: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe("ADR-0007 §47: live PostgreSQL readiness", () => {
  it("accepts a responding PostgreSQL connection and a configured Control Plane", async () => {
    const raw = vi.fn().mockResolvedValue([{ "?column?": 1 }])
    const result = await checkTradeReadiness({
      database: { raw },
      controlPlaneConfigured: true,
    })

    expect(raw).toHaveBeenCalledTimes(1)
    expect(raw).toHaveBeenCalledWith("SELECT 1")
    expect(result).toEqual({
      status: "ready",
      dependencies: {
        medusa: "configured",
        postgres: "up",
        control_plane: "configured",
      },
    })
  })

  it("refuses traffic when the PostgreSQL query fails without exposing the error", async () => {
    const result = await checkTradeReadiness({
      database: { raw: () => Promise.reject(new Error("postgres://secret-password@db")) },
      controlPlaneConfigured: true,
    })

    expect(result.status).toBe("not_ready")
    expect(result.dependencies.postgres).toBe("down")
    expect(JSON.stringify(result)).not.toContain("secret-password")
  })

  it("refuses traffic if PostgreSQL never responds, within the configured deadline", async () => {
    vi.useFakeTimers()
    const pending = new Promise<never>(() => undefined)
    const check = checkTradeReadiness({
      database: { raw: () => pending },
      controlPlaneConfigured: true,
      timeoutMs: 25,
    })

    await vi.advanceTimersByTimeAsync(25)
    expect((await check).dependencies.postgres).toBe("down")
  })

  it("refuses traffic when the PostgreSQL registration is missing or unusable", async () => {
    expect((await checkTradeReadiness({ controlPlaneConfigured: true })).status).toBe("not_ready")
    expect(
      (
        await checkTradeReadiness({
          database: {} as never,
          controlPlaneConfigured: true,
        })
      ).dependencies.postgres,
    ).toBe("down")
  })

  it("refuses traffic when the Control Plane is not configured even with a healthy database", async () => {
    const result = await checkTradeReadiness({
      database: { raw: () => Promise.resolve(1) },
      controlPlaneConfigured: false,
    })

    expect(result.status).toBe("not_ready")
    expect(result.dependencies).toMatchObject({
      postgres: "up",
      control_plane: "not_configured",
    })
  })
})

type RouteResponse = {
  setHeader: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
}

const fakeResponse = (): RouteResponse => {
  const res: RouteResponse = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}

const invoke = async (resolve: () => unknown) => {
  const res = fakeResponse()
  await GET(
    { scope: { resolve } } as unknown as Parameters<typeof GET>[0],
    res as unknown as Parameters<typeof GET>[1],
  )
  return res
}

describe("ADR-0007 §47: /readiness traffic-admission endpoint", () => {
  it("returns HTTP 503 on a failed database probe despite valid configuration", async () => {
    vi.mocked(getBaobabTradeEnvironment).mockReturnValue({
      controlPlaneBaseUrl: "http://control-plane.local",
      controlPlaneContextPath: "/v1/context/resolve",
    } as ReturnType<typeof getBaobabTradeEnvironment>)

    const res = await invoke(() => ({
      raw: () => Promise.reject(new Error("private database diagnostic")),
    }))

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-store")
    expect(res.json).toHaveBeenCalledWith({
      status: "not_ready",
      dependencies: {
        medusa: "configured",
        postgres: "down",
        control_plane: "configured",
      },
    })
  })

  it("returns HTTP 200 only after a genuine successful PostgreSQL query", async () => {
    vi.mocked(getBaobabTradeEnvironment).mockReturnValue({
      controlPlaneBaseUrl: "http://control-plane.local",
      controlPlaneContextPath: "/v1/context/resolve",
    } as ReturnType<typeof getBaobabTradeEnvironment>)
    const raw = vi.fn().mockResolvedValue(1)

    const res = await invoke(() => ({ raw }))
    expect(raw).toHaveBeenCalledTimes(1)
    expect(raw).toHaveBeenCalledWith("SELECT 1")
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }))
  })

  it("returns 503 rather than exposing missing production configuration", async () => {
    vi.mocked(getBaobabTradeEnvironment).mockImplementation(() => {
      throw new Error("BAOBAB_SECRET_VALUE")
    })

    const res = await invoke(() => ({ raw: () => Promise.resolve(1) }))
    expect(res.status).toHaveBeenCalledWith(503)
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("BAOBAB_SECRET_VALUE")
  })

  it("returns 503 when the Medusa PostgreSQL registration cannot resolve", async () => {
    vi.mocked(getBaobabTradeEnvironment).mockReturnValue({
      controlPlaneBaseUrl: "http://control-plane.local",
      controlPlaneContextPath: "/v1/context/resolve",
    } as ReturnType<typeof getBaobabTradeEnvironment>)
    const res = await invoke(() => {
      throw new Error("missing pgConnection registration")
    })
    expect(res.status).toHaveBeenCalledWith(503)
  })
})
