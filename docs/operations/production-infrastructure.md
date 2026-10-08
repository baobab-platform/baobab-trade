# Production infrastructure

Baobab Trade uses Medusa's local infrastructure providers in development and test. Production replaces volatile providers explicitly and fails during configuration when required settings are absent.

| Capability       | Production implementation      | Authority                                               |
| ---------------- | ------------------------------ | ------------------------------------------------------- |
| Database         | PostgreSQL 17+                 | Trade operational data only                             |
| Sessions         | Redis                          | Medusa server session state                             |
| Events           | Redis Event Bus                | Internal Medusa events; not the future canonical outbox |
| Workflows        | Redis Workflow Engine          | Durable workflow execution state                        |
| Locking          | Redis Locking provider         | Distributed Commerce concurrency                        |
| Caching          | Redis Caching provider         | Replaceable projection/cache only                       |
| Files            | S3-compatible File provider    | Commerce-owned files only                               |
| Email            | SendGrid Notification provider | Transactional delivery only                             |
| Catalogue search | Native Medusa/PostgreSQL query | Initial ten-product catalogue                           |

Meilisearch is deferred. The initial ZuriBeans catalogue is too small to justify operating another stateful projection. This decision must be revisited when relevance, faceting, catalogue size, or measured query latency warrants it. Search never becomes Product authority.

Redis queues and keys are namespaced through `REDIS_KEY_PREFIX`, `REDIS_EVENT_QUEUE`, and `REDIS_WORKFLOW_QUEUE`. Sharing a Redis deployment does not permit different environments or engines to share namespaces.

S3 credentials and SendGrid credentials must be injected by the deployment platform. They must never be committed. `S3_FORCE_PATH_STYLE=true` supports compatible providers such as MinIO; ordinary AWS S3 should normally leave it false.

The canonical transactional outbox is implemented in Gate 13. Gate 16 defines
bounded-cardinality metrics, W3C trace propagation, diagnostics, dashboards and
alert semantics. Redis Event Bus remains transport rather than durable outbox
authority. Deployment-owned collectors and alert routing consume these signals.
