/**
 * Issues Thamani Store Credit (Gate 17) as a real native Order Credit Line,
 * through Medusa's order-change accounting — `createOrderChange` (change
 * type `credit_line`), `addOrderAction` (`CREDIT_LINE_ADD`), then
 * `confirmOrderChange` — rather than the generated
 * `IOrderModuleService.createOrderCreditLines` CRUD method, which creates no
 * order-change action, bumps no order version, and leaves no accounting
 * history. This is the same sequence `@medusajs/core-flows`'s
 * `createOrderRefundCreditLinesWorkflow` runs internally; it isn't reused
 * directly because it isn't part of that package's public export surface in
 * this Medusa version, so the sequence is rebuilt here from steps that are:
 * `createOrderChangeStep` and `createOrderChangeActionsWorkflow` (both
 * exported by `@medusajs/core-flows`), plus a small step wrapping
 * `IOrderModuleService.confirmOrderChange` — itself a public, documented
 * method (the exported `confirmOrderChanges` *step* is a thin wrapper
 * around that same call, but isn't exported itself).
 *
 * This is the one production issuance path for Thamani store credit — any
 * future Admin/Store API route, subscriber, or Admin UI extension should
 * call this workflow rather than touching `IOrderModuleService` directly,
 * so every issuance keeps going through `buildThamaniStoreCreditOrderChangeInput`'s
 * reason validation and produces real order-change accounting.
 */
import { createOrderChangeActionsWorkflow, createOrderChangeStep } from "@medusajs/core-flows"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { ChangeActionType, Modules, OrderChangeType } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  buildThamaniStoreCreditOrderChangeInput,
  type ThamaniStoreCreditIssuanceInput,
} from "../baobab/thamani/store-credit"

type ConfirmStepInput = { orderChangeId: string; orderId: string }

const confirmThamaniStoreCreditOrderChangeStep = createStep(
  "confirm-thamani-store-credit-order-change",
  async ({ orderChangeId, orderId }: ConfirmStepInput, { container }) => {
    const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)
    await orderService.confirmOrderChange(orderChangeId)
    return new StepResponse({ orderId }, { orderChangeId, orderId })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) return
    const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)
    await orderService.undoLastChange(compensationInput.orderId, {
      id: compensationInput.orderChangeId,
    })
  },
)

type FindCreditLineInput = { orderId: string; reference: string; referenceId: string | null }
type OrderCreditLine = {
  id: string
  amount: number
  reference: string | null
  reference_id: string | null
}

const findThamaniStoreCreditOrderCreditLineStep = createStep(
  "find-thamani-store-credit-order-credit-line",
  async ({ orderId, reference, referenceId }: FindCreditLineInput, { container }) => {
    const orderService = container.resolve<IOrderModuleService>(Modules.ORDER)
    const [order] = await orderService.listOrders({ id: orderId }, { relations: ["credit_lines"] })
    const creditLines = (order?.credit_lines ?? []) as unknown as OrderCreditLine[]
    const creditLine = creditLines.find(
      (line) => line.reference === reference && line.reference_id === referenceId,
    )
    if (!creditLine)
      throw new Error(`No order credit line found for reference "${reference}" after confirmation`)
    return new StepResponse(creditLine)
  },
)

export type IssueThamaniStoreCreditWorkflowInput = ThamaniStoreCreditIssuanceInput

export const issueThamaniStoreCreditWorkflowId = "issue-thamani-store-credit"

export const issueThamaniStoreCreditWorkflow = createWorkflow(
  issueThamaniStoreCreditWorkflowId,
  (input: IssueThamaniStoreCreditWorkflowInput) => {
    const creditLineInput = transform({ input }, ({ input }) =>
      buildThamaniStoreCreditOrderChangeInput(input),
    )

    const orderChangeInput = transform({ creditLineInput }, ({ creditLineInput }) => ({
      order_id: creditLineInput.orderId,
      change_type: OrderChangeType.CREDIT_LINE,
      internal_note: creditLineInput.internalNote,
      created_by: creditLineInput.createdBy,
    }))
    const orderChange = createOrderChangeStep(orderChangeInput)

    const actionInput = transform(
      { orderChange, creditLineInput },
      ({ orderChange, creditLineInput }) => [
        {
          order_change_id: orderChange.id,
          order_id: creditLineInput.orderId,
          version: orderChange.version,
          action: ChangeActionType.CREDIT_LINE_ADD,
          reference: creditLineInput.reference,
          reference_id: creditLineInput.referenceId ?? undefined,
          amount: creditLineInput.amountMinor,
        },
      ],
    )
    createOrderChangeActionsWorkflow.runAsStep({ input: actionInput })

    const confirmInput = transform(
      { orderChange, creditLineInput },
      ({ orderChange, creditLineInput }) => ({
        orderChangeId: orderChange.id,
        orderId: creditLineInput.orderId,
      }),
    )
    const confirmed = confirmThamaniStoreCreditOrderChangeStep(confirmInput)

    // Depends on `confirmed`, not just `creditLineInput`, so this step is
    // sequenced after the order change is actually confirmed rather than
    // running concurrently with it — the two have no other data dependency
    // linking them.
    const findInput = transform(
      { confirmed, creditLineInput },
      ({ confirmed, creditLineInput }) => ({
        orderId: confirmed.orderId,
        reference: creditLineInput.reference,
        referenceId: creditLineInput.referenceId,
      }),
    )
    const creditLine = findThamaniStoreCreditOrderCreditLineStep(findInput)

    return new WorkflowResponse(creditLine)
  },
)
