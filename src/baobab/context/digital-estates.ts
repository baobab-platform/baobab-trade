/**
 * Digital Estate canonical IDs known to this engine.
 *
 * `resolveCommerceContext` (see `./resolver.ts`) takes a Digital Estate
 * canonical ID from a trusted route or deployment policy — never from a raw
 * caller-supplied header — and never infers it from country, currency,
 * Medusa Region, or Sales Channel. These constants are that trusted policy
 * input for the two Digital Estates this engine currently serves. Trade does
 * not mint or own these IDs; they identify records that live in the Control
 * Plane's Digital Estate registry.
 */
export const ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID = "estate:zuribeans-b2b"
export const THAMANI_DIGITAL_ESTATE_CANONICAL_ID = "estate:thamani-b2c"
