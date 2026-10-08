/**
 * The Shared conformance suite (EA-01 / ADR-SHARED-018 T-COMPAT-07) needs a
 * checkout of baobab-platform/shared at the commit contracts.lock.yaml pins, so
 * it is not part of the default `npm test`. Run it with
 * `BAOBAB_SHARED_PATH=<checkout> npm run test:shared-conformance`; CI does.
 *
 * A plain object, not defineConfig: this project is CommonJS and vitest/config
 * is ESM-only, so importing it fails the typecheck.
 */
export default {
  test: {
    include: ["tests/shared-conformance/**/*.conformance.ts"],
  },
}
