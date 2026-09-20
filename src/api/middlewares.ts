// Gate ZB-03.3 / ZB-04: authenticated B2B store and admin routes.
import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/b2b/context",
      methods: ["GET"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/b2b/organisations/apply",
      methods: ["POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/b2b/organisations/me",
      methods: ["GET"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/b2b/capabilities",
      methods: ["GET"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/admin/b2b/organisations/:id/canonical-link",
      methods: ["POST"],
      middlewares: [authenticate("user", ["session", "bearer"])],
    },
    {
      matcher: "/admin/b2b/organisations/:id/status",
      methods: ["POST"],
      middlewares: [authenticate("user", ["session", "bearer"])],
    },
  ],
})
