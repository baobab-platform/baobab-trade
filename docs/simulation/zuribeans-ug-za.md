# ZuriBeans Uganda–South Africa simulation dataset

Gate 18 supplies a deterministic, referentially checked simulation pack. It reuses the ten governed catalogue products and six warehouses from earlier gates, then adds four buyer organisations, four buyers, three sourcing suppliers and four domestic/cross-border order scenarios with payment, fulfilment and ERP projection expectations.

Tax and tariff numbers are dated assumptions for software simulation only. They are not customs rulings, tax advice or authoritative rates. Every live transaction must resolve effective tax rules, HS treatment, origin preference and customs procedure from approved providers at transaction time.

The data is intentionally code-native and deterministic: CI can detect broken Product, Organisation, Supplier, Warehouse or ERP references before a demo. `npm run verify:simulation` validates the complete pack after Gates 1–13 and the Thamani bootstrap chain.
