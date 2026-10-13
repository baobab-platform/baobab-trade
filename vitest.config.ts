/** Test source once, including after a Medusa/TypeScript build. Compiled CJS
 * copies under dist/.medusa are deployment output, not additional test suites. */
export default {
  test: { include: ["{tests,src}/**/*.{test,spec}.?(c|m)[jt]s?(x)"] },
}
