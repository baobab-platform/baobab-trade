import { Modules } from "@medusajs/framework/utils"

type ResolvableContainer = { resolve(name: string): unknown }
type Service = Record<string, unknown>

const PROBES = [
  ["Event Bus", Modules.EVENT_BUS, "emit"],
  ["Workflow Engine", Modules.WORKFLOW_ENGINE, "listWorkflowExecutions"],
  ["Locking", Modules.LOCKING, "acquire"],
  ["Caching", Modules.CACHING, "get"],
  ["File", Modules.FILE, "createFiles"],
  ["Notification", Modules.NOTIFICATION, "createNotifications"],
] as const

export const verifyInfrastructureModules = (container: ResolvableContainer) =>
  PROBES.map(([capability, registration, method]) => {
    const service = container.resolve(registration) as Service
    if (typeof service?.[method] !== "function") {
      throw new Error(`${capability} module '${registration}' does not expose ${method}`)
    }
    return { capability, registration, method, resolved: true as const }
  })
