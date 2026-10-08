import { MedusaError } from "@medusajs/framework/utils"

/**
 * Medusa's dbErrorMapper turns a Postgres unique-constraint violation into a MedusaError with
 * a message like "<Table> with <column>: <value>, already exists." — this is the one stable
 * signal available to a caller wanting to treat that specific failure as "someone else already
 * created it" rather than as a real error.
 */
export const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof MedusaError &&
  error.type === MedusaError.Types.INVALID_DATA &&
  error.message.includes("already exists")
