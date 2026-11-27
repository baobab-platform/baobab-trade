import type { ExecArgs } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GET } from "../api/readiness/route"

/**
 * Runs the actual readiness handler inside Medusa's container against the
 * disposable PostgreSQL 17 service used by production-infrastructure-integration.
 * This proves the registered PG_CONNECTION and Knex timeout path; it does not
 * prove remote Control Plane health or protected-environment readiness.
 */
export default async function ({ container }: ExecArgs) {
  let statusCode: number | undefined
  let body: unknown
  const headers: Record<string, string> = {}
  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
      return response
    },
    status(code: number) {
      statusCode = code
      return response
    },
    json(value: unknown) {
      body = value
      return response
    },
  }

  const request = {
    scope: {
      resolve: (key: string) => container.resolve(key),
    },
  } as unknown as MedusaRequest

  await GET(request, response as unknown as MedusaResponse)

  const report = body as {
    status?: unknown
    dependencies?: {
      postgres?: unknown
      control_plane?: unknown
    }
  }

  if (
    statusCode !== 200 ||
    report.status !== "ready" ||
    report.dependencies?.postgres !== "up" ||
    report.dependencies?.control_plane !== "configured" ||
    headers["cache-control"] !== "no-store"
  ) {
    throw new Error("ADR-0007 readiness failed against the disposable PostgreSQL 17 service")
  }
}
