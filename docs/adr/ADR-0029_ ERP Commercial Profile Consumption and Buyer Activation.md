# ADR-0029: ERP Commercial Profile Consumption and Buyer Activation

Status: Accepted  
Date: 2026-09-20  
Gate: ZB-04

## Context

ADR-0017 assigns buyer organisation and membership authority to Trade while ERP remains authoritative for credit and commercial profile decisions. ADR-0027 requires durable, idempotent cross-engine propagation. A staff-operated callback would blur those boundaries and permit activation without ERP evidence.

## Decision

Trade consumes the signed canonical `buyer-commercial-profile.changed.v1` event from ERP. It persists an immutable local projection and a consumer receipt keyed by consumer and event ID.

Only an ERP `APPROVED` profile may move a canonically linked buyer organisation from `PENDING` to `ACTIVE`. `ON_HOLD` and `REJECTED` are retained as projections but never activate a buyer. Later operational suspension or closure remains a separate governed lifecycle decision.

The inbound boundary validates the configured ZuriBeans tenant, ERP source, legal-entity scope, business-partner public identity, payment terms, currency, event signature, and event identity. It never reads or writes an ERP database.

## Consequences

Activation has explicit ERP evidence and at-least-once delivery is safe. The consumer emits a causally linked organisation status event after activation. Local module APIs do not provide a distributed transaction, so the handler applies compensating deletes and state restoration on failure; reconciliation remains required for process termination between local effects.
