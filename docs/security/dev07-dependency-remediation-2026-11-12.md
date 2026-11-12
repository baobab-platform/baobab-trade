# DEV-07 dependency remediation — 12 November 2026

Trade #189 at `b9ad5fa42745f79bc94f43abaec28771a4996ce2` passed its
native Order Module and broker workflows, but Foundation run `43012820492`
failed its dependency and container scans. This is an independent merge blocker
for the Infrastructure #72 connected candidate.

| Package                  | Previous | Override | Reason                                                  |
| ------------------------ | -------- | -------- | ------------------------------------------------------- |
| `@graphql-tools/utils`   | 10.11.0  | 12.0.2   | CVE-2026-104852 and CVE-2026-114604 prototype pollution |
| `body-parser` (1.x only) | 1.20.8   | 1.20.9   | CVE-2026-111181 decompression failure                   |
| `follow-redirects`       | 1.16.1   | 1.16.2   | CVE-2026-116689 credential forwarding                   |
| `multer`                 | 2.4.0    | 2.5.0    | CVE-2026-113872 aborted upload handling                 |
| `zod`                    | 4.2.0    | 4.6.6    | GHSA-mrhx-c7xc-m3w5 resource consumption                |

The npm-generated lockfile retains Medusa 2.21.2 and the existing application
runtime. The body-parser override only applies to 1.x consumers. GraphQL utils
crosses majors because the reviewed advisory has no patched 10.x release.
Upstream 11 changes schema-extension printing; 12 adds GraphQL 17 support while
retaining the GraphQL 16 variable shape. Compatibility requires real Medusa
build and execution checks, not merely a clean version inventory.

Sources:

- https://github.com/advisories/GHSA-c4qx-w738-7hr3
- https://github.com/advisories/GHSA-7mx3-vvmw-hjmv
- https://github.com/ardatan/graphql-tools/blob/master/packages/utils/CHANGELOG.md
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- Foundation job logs `130497341107`, `130497341138`, `130497341266`.

Local validation with the updated dependencies: 1,151 existing tests pass;
Medusa backend/frontend compilation and immutable authority asset verification
pass. Added regressions exercise ordinary GraphQL schema execution, actual
incremental-result prototype pollution refusal with a positive merge control,
and inherited-constructor refusal. Type checking and zero-warning lint are
required alongside these cases. Fresh npm audit reports **zero high and zero
critical**, with 80 moderate and four low findings still reported. This is not
a claim of an entirely vulnerability-free dependency tree. No audit threshold,
scanner exception or ignore entry has been added.

Final-head Foundation container scanning and native database/broker CI must
rerun. Genuine IAM/CP-governed checkout, original same-XID order/commitments/event,
ERP consequence, independent trace custody and teardown remain separate open
engineering gates. These dependency changes do not qualify or activate them.
