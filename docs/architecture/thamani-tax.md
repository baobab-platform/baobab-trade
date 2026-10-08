# Thamani B2C tax boundary

Gate 13 gives Thamani separate Uganda and South Africa tax contexts while retaining the existing replaceable tax-provider port. Both retail Markets display tax-inclusive prices and fail closed when no single effective rule matches the Legal Seller, jurisdiction, transaction type, and product category.

## Governed reference snapshot

| Market       | Standard VAT snapshot | Effective in this projection | Primary authority                                   | Retail display |
| ------------ | --------------------: | ---------------------------- | --------------------------------------------------- | -------------- |
| Uganda       |                   18% | 2026-09-09                   | Uganda Revenue Authority, retrieved 2026-09-09      | Tax inclusive  |
| South Africa |                   15% | 2026-09-09                   | South African Revenue Service, retrieved 2026-09-09 | Tax inclusive  |

The projection effective date records when Baobab verified and approved this reference snapshot; it does not claim to be the historical enactment date. Rates are data rows with rule versions and retrieval provenance, never storefront constants. Production operations must revalidate legal reference data before activation and supersede rows rather than rewriting history.

The `STANDARD`, `ZERO_RATED`, and `EXEMPT` product categories are durable per Market. Only `STANDARD` is activated by this Gate. `ZERO_RATED` and `EXEMPT` deliberately remain `REVIEW_REQUIRED` because their treatment depends on precise product and statutory classification. This prevents the illustrative catalogue labels introduced earlier from silently becoming legal tax decisions.

## Calculation and evidence

For a tax-inclusive amount $G$ and rate $r$ in basis points, the provider extracts tax as:

$$T = \operatorname{round}\left(\frac{G r}{10000 + r}\right), \qquad N = G - T$$

Each B2C determination belongs to exactly one consumer reference (the existing B2B path belongs to one organisation), snapshots the effective rule and source, and persists net, tax, gross, currency, calculation reference, idempotency key, and correlation ID. Reconciliation compares that immutable commerce snapshot with the ERP tax consequence.

Sources: [Uganda Revenue Authority VAT guide](https://thetaxman.ura.go.ug/?p=1175) and [South African Revenue Service VAT page](https://www.sars.gov.za/types-of-tax/value-added-tax/).
