import type { ExecArgs, ISearchModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_PRODUCT_SEARCH_INDEX } from "../baobab/thamani/search"

const READY_POLL_INTERVAL_MS = 250
const READY_POLL_TIMEOUT_MS = 30_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Triggers a full rebuild of the `thamani_product` search index from its
 * `seed` (Gate 7's "rebuild procedure"). Safe to re-run: `reindex` is
 * idempotent and always reflects the current catalogue, not whatever the
 * index previously held.
 *
 * `reindex` only starts a background job (dev/test run the workflow engine
 * in-process, so it finishes almost immediately); this polls `listIndexes`
 * until the index reports `ready` so a caller — including CI — observes a
 * completed rebuild rather than a job that was merely scheduled.
 */
export default async function bootstrapThamaniSearch({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const searchService = container.resolve<ISearchModuleService>(Modules.SEARCH)

  const { job_id: jobId } = await searchService.reindex({ index: THAMANI_PRODUCT_SEARCH_INDEX })

  const deadline = Date.now() + READY_POLL_TIMEOUT_MS
  let status: string | undefined
  while (Date.now() < deadline) {
    const indexes = await searchService.listIndexes()
    status = indexes.find((index) => index.name === THAMANI_PRODUCT_SEARCH_INDEX)?.status
    if (status === "ready" || status === "error") break
    await sleep(READY_POLL_INTERVAL_MS)
  }

  if (status !== "ready") {
    throw new Error(
      `Thamani product search index did not reach "ready" (last status: ${status ?? "unknown"})`,
    )
  }

  logger.info(`Reindexed Thamani product search (job ${jobId})`)
}
