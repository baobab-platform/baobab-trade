export type OrderCommand = {
  orderReference: string
  organisationId: string
  marketKey: string
  legalSellerKey: string
  currencyCode: string
  totalMinor: number
  idempotencyKey: string
  correlationId: string
}
export type OrderSnapshot = OrderCommand & { id: string; status: string }
export interface OrderRecordRepository {
  findByIdempotencyKey(key: string): Promise<OrderSnapshot | undefined>
  create(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}
export interface OrderOrchestrationPort {
  place(command: OrderCommand): Promise<OrderSnapshot>
  retrieve(id: string): Promise<OrderSnapshot>
}
/** Native Medusa remains active behind this extraction seam. */
export class MedusaOrderOrchestrationAdapter implements OrderOrchestrationPort {
  constructor(private readonly records: OrderRecordRepository) {}
  async place(command: OrderCommand) {
    if (!Number.isSafeInteger(command.totalMinor) || command.totalMinor < 0)
      throw new Error("Order total must be a non-negative safe integer")
    if (!/^[A-Z]{3}$/.test(command.currencyCode))
      throw new Error("Order currency must use an uppercase ISO 4217 code")
    return (
      (await this.records.findByIdempotencyKey(command.idempotencyKey)) ??
      this.records.create(command)
    )
  }
  retrieve(id: string) {
    return this.records.retrieve(id)
  }
}
