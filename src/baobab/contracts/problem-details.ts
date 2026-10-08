/**
 * Mirrors baobab-platform/shared contracts/errors/v1/problem-details.schema.json.
 * RFC 9457 application/problem+json response shape used by the Control Plane.
 */
export type BaobabProblemDetails = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  code: string
  correlation_id: string
  trace_id?: string
  retryable: boolean
  errors?: ReadonlyArray<{ code: string; field?: string; message: string }>
}

export class ControlPlaneProblemError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly correlationId: string

  constructor(problem: BaobabProblemDetails) {
    super(problem.detail || problem.title)
    this.name = "ControlPlaneProblemError"
    this.code = problem.code
    this.status = problem.status
    this.retryable = problem.retryable
    this.correlationId = problem.correlation_id
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const isProblemDetails = (candidate: unknown): candidate is BaobabProblemDetails => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<BaobabProblemDetails>
  return (
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.title) &&
    typeof value.status === "number" &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.correlation_id) &&
    typeof value.retryable === "boolean"
  )
}
