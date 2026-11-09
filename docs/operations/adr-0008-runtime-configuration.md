# ADR-0008 — Trade runtime identity and configuration gate

**Normative source:** `docs/adr/ADR-0008_Baobab Commerce Engine Implementation Contract.md`, §§8–11, 72–74, 82–85, 119.  
**Scope:** development-verifiable startup contract; **not** Control Plane registration or protected-environment conformance.

## Ownership and evaluation

`medusa-config.ts` calls `validateTradeStartupConfiguration(process.env)` immediately after Medusa loads the environment and **before** initialising OpenTelemetry, Medusa modules or adapters. An invalid mandatory setting prevents runtime startup. The pure validation logic is in `src/baobab/config/startup-validation.ts`, covered by `tests/adr-0008-startup-validation.test.ts`.

`NODE_ENV` selects Node/Medusa runtime behaviour. `BAOBAB_ENVIRONMENT` names the target deployment and is **not** interchangeable with Node's runtime mode. A staging deployment may legitimately run with `NODE_ENV=production` and `BAOBAB_ENVIRONMENT=staging`. Production **deployment** identity may never run in a downgraded Node mode.

When `NODE_ENV=production`, these values must be supplied explicitly:

| Category                    | Environment keys                                                    | Validation                                                                                                                |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Engine identity             | `BAOBAB_TRADE_ENGINE_ID`, `BAOBAB_TRADE_ENGINE_INSTANCE_ID`         | Nonblank registered engine identifier; instance format `ei_<id>` (CP minted)                                              |
| Deployment identity         | `BAOBAB_ENVIRONMENT`, `BAOBAB_REGION`, `BAOBAB_DEPLOYMENT_REVISION` | Recognised environment, stable region and non-placeholder revision; **never** derive the instance from a replica hostname |
| Required persistence        | `DATABASE_URL`, `REDIS_URL`                                         | PostgreSQL and Redis URL protocols; credentials and values never included in validation errors                            |
| Runtime credentials         | `JWT_SECRET`, `COOKIE_SECRET`, `BAOBAB_WEBHOOK_SIGNING_SECRET`      | Explicit non-placeholder secrets of at least 32 characters                                                                |
| Platform authority endpoint | `BAOBAB_CONTROL_PLANE_BASE_URL`                                     | Valid HTTPS service URL without embedded credentials or query/fragment                                                    |

Optional configured ERP, Pulse, IAM token and IAM issuer URLs are also validated. Service URLs require HTTPS under `NODE_ENV=production`; local development may use plain HTTP, as supplied by the DevContainer or disposable harness.

The Control Plane remains the **authority** for EngineInstance registration, activation, capability binding, tenant context and isolation. Locally validated variable syntax is **not** CP attestation. A deployer must inject the CP-issued instance ID; Trade does not mint one on restart.

## Security-sensitive feature gates

`BAOBAB_BUYER_IDENTITY_ENABLED` and `BAOBAB_RESOURCE_ASSIGNMENT_ENABLED` accept exactly `true`, `false` or omission; malformed input is an error, **not a fallback to disabled**.

Activating either path also requires a Control Plane URL, IAM workload token URL/client ID/client secret and stable Trade EngineInstance/environment. Activating buyer identity additionally requires an IAM buyer issuer and at least one authorised BFF client identifier. Resource assignment remains **development/staging-only**; it is refused when `BAOBAB_ENVIRONMENT=production`.

Unset flags remain disabled. No startup check grants seller, buyer, payment, capability or document authority. Runtime operations continue to validate independently under their own governed gates.

## Test and promotion evidence

```sh
npm ci
npx vitest run tests/adr-0008-startup-validation.test.ts
npx vitest run tests/adr-0008-architecture-boundaries.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run build
```

These are development gates. `npm test` also includes these tests. Validate on the PR's final HEAD in CI. A production-like configuration example is deliberately **not** committed with real credential values.

**Deferred, not claimed:** protected staging/production EngineInstance registration and binding readback; production IAM-issued identity; authenticated CP registration/renewal; live provider and broker credentials; actual deployment identity, secret-manager provenance and backup/restore. These require independent evidence and cannot be certified from syntax validation or mocked tests.

## Related work

- Trade #189: native buyer commitment, durable outbox and RabbitMQ/OTLP integration; no duplicate implementation here.
- Trade #190: dependency and security-maintenance policy; not changed here.
- Trade #200: live PostgreSQL traffic readiness under ADR-0007 §47 and ADR-0008 §§80–81; avoid overlapping the existing readiness PR.

This work closes a **bounded** portion of the parent implementation contract; it does not declare ADR-0008 wholly implemented.
