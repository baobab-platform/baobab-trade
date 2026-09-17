// Gate ZB-03.3: the first routes in this repository that need
// authentication (health/readiness are deliberately open). Medusa applies
// no actor-type restriction to a route unless it is named here (Medusa's
// own auth-methods-per-actor precedent, already cited by
// medusa-config.ts's authMethodsPerActor comment) -- every route below must
// stay listed for its authorization boundary to hold.
import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/b2b/context",
      methods: ["GET"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/admin/b2b/organisations/:id/canonical-link",
      methods: ["POST"],
      middlewares: [authenticate("user", ["session", "bearer"])],
    },
  ],
})
