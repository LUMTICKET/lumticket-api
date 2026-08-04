# Architecture

## Scope of this codebase

The SRS defines Phase One as: Customer App, five operator dashboards, a
Scanning & Validation App, a Driver App, and a System Administration
Dashboard, all sitting on top of a shared API. **This repository builds the
shared API and data layer that all of those clients would call.** No
frontend client (Expo/React Native per TECH-01) is included yet — that is
a separate workstream that consumes the endpoints documented in
[API.md](API.md).

What exists today:

- Prisma schema for every core entity in SRS Section 5
- Auth (Credentials + JWT) with `role` and `tenantId` on the session
- RBAC enforced inside each route handler (NFR-04: "at the API level, not
  only in the UI")
- Endpoints covering booking/seat-locking, parcels, events, KYC/onboarding,
  validation/scanning, and a payment-gateway webhook stub
- Idempotency-key handling for booking-and-payment endpoints (FR-23)
- Vitest unit tests for the pure business logic (ticket signing, bank-name
  matching)

## Why Next.js API routes instead of a separate backend service

TECH-02 specifies Next.js for "API development and server-side
functionality." Route handlers under `src/app/api/**/route.ts` are plain
REST endpoints — nothing here depends on Next.js's rendering pipeline, so
these routes could be lifted into a standalone Node service later without
a rewrite if the platform outgrows a single deployable.

## Request flow

```
Client (any dashboard / app)
   │  fetch("/api/bookings", { headers: { Idempotency-Key, Cookie } })
   ▼
Route handler (src/app/api/bookings/route.ts)
   │  1. requireRole(...)        → 401/403 early exit (src/lib/rbac.ts)
   │  2. zod .safeParse(body)    → 400 on bad input
   │  3. withIdempotency(...)    → replay stored response on retry
   │  4. prisma.$transaction     → atomic multi-table writes
   ▼
PostgreSQL (Neon), via @prisma/adapter-pg
```

## Key design decisions and trade-offs

**Multi-tenancy: discriminator column, not subtype tables.** The ER
diagram in SRS Section 5 draws `BUS_OPERATOR` / `COURIER_OPERATOR` /
`EVENT_ORGANIZER` / `RETAIL_POS_AGENT` as separate "mutually exclusive"
subtype tables sharing a `Tenant` primary key. This schema instead uses a
single `Tenant` table with a `type` enum column. Same information, far
less join complexity for a Phase One system; the diagram itself notes
"physical schema... are System Architecture Design decisions," so this is
squarely in scope for that call. See [DATA_MODEL.md](DATA_MODEL.md) for the
full list of simplifications.

**Seat holds are enforced at the database, not in memory.** FR-21/22
require a 5-minute (configurable) hold on a selected seat. Holding is a
conditional `UPDATE ... WHERE status = 'AVAILABLE'` (see
`src/app/api/seats/hold/route.ts`) so two customers racing for the same
seat can't both win — Postgres's row-level locking during the update
resolves the race, not application code.

**Idempotency uses a generic key/endpoint table, not a booking column
alone.** `IdempotencyKey` (see schema) stores the request key, the
endpoint, and the response that was returned the first time. A retried
request with the same `Idempotency-Key` header gets the exact same
response replayed instead of re-running the handler — satisfying FR-23 and
API-03 for any booking-or-payment endpoint, not just `/api/bookings`.

**QR ticket codes are HMAC-signed, not opaque UUIDs.** FR-02 requires a
ticket "that cannot easily be forged." `src/lib/ticket-code.ts` embeds the
bookingId plus an HMAC-SHA256 signature keyed on `AUTH_SECRET`. A scanning
device that has been provisioned with the same secret can verify a code's
authenticity without a network round-trip — which is what NFR-OF1
(offline validation) actually requires. **Caveat:** provisioning that
secret onto scanning devices securely is a real operational problem this
scaffold doesn't solve; see "Deferred / needs a follow-up decision" below.

**Duplicate-ticket-use detection relies on ValidationLog, not a new
column.** Rather than adding a `usedAt` field to `Booking`, `/api/validate`
checks for a prior `VALID` `ValidationLog` row for the same booking. This
matches the diagram's own note that "ValidationLog supports audit and
offline reconciliation" and keeps a single source of truth for "has this
ticket been scanned before."

**Ticket-type oversell protection is optimistic-concurrency, not a
database constraint.** `/api/bookings` re-checks `quantitySold` inside the
transaction and only commits if it hasn't changed since it was read. This
is adequate for Phase One traffic; a genuinely hot on-sale (thousands of
concurrent buyers for one event) would want a `CHECK` constraint or a
queue in front of the endpoint instead.

## Deferred / needs a follow-up decision

These are named directly by the SRS but need infrastructure this scaffold
doesn't provision:

- **Real-time seat-release notification (FR-22).** The cron sweep
  (`/api/cron/release-expired-holds`) frees expired holds in the database,
  but "notify the customer's session in real time" needs a push channel
  (WebSocket/SSE, e.g. Pusher, Ably, or a self-hosted socket server).
- **True offline queueing on the Scanning/Driver apps (NFR-OF1/OF2/OF3).**
  The server-side half (accept a `clientTimestamp`, log every attempt,
  flag duplicates) is implemented in `/api/validate`. The client-side
  local queue + sync-on-reconnect logic lives in the mobile app codebase,
  not here.
- **Payment gateway integration (FR-11).** `/api/payments/webhook` is a
  stub that trusts a shared-secret header; swap in your licensed
  processor's actual signature verification once one is chosen.
- **Scheduled reconciliation job (FR-24).** The webhook handler logs a
  `PaymentReconciliationIncident` synchronously when it can't find a
  matching booking; a real scheduled job that periodically diffs gateway
  transactions against `PaymentSettlement` rows is still needed for cases
  where the webhook itself never arrives.
- **License/insurance expiry sweeps (FR-28).** The schema has the expiry
  fields (`CourierLicense.expiryDate`, `Vehicle.roadworthyExpiry`, etc.);
  an automated job to flag/suspend on expiry is not yet wired up. Follow
  the same pattern as `/api/cron/release-expired-holds`.
- **Global route middleware.** RBAC is enforced per-handler via
  `requireRole()` rather than a blanket `middleware.ts`, because Prisma's
  Node.js driver adapter doesn't run in the Edge runtime that Next.js
  middleware uses by default. Enforcing "at the API level" (NFR-04) is
  satisfied either way; this is a runtime constraint, not a security gap.
