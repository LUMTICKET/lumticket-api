# Data Model

Full schema: [`prisma/schema.prisma`](../prisma/schema.prisma). This is a
guided walkthrough mapped back to SRS Section 5 (Conceptual Data Model) and
the FRs that drove each addition beyond the diagram.

## Core entity groups

**Tenancy & identity**
- `Tenant` — a Bus/Courier/Event/Retail operator, discriminated by `type` (see the multi-tenancy note in [ARCHITECTURE.md](ARCHITECTURE.md))
- `User` — every staff/actor account; `role` is a single enum per the diagram's "role (see roles)" field; individually attributable per FR-30 (no shared logins)
- `Customer` — separate from `User` because a customer's booking/parcel history should exist independent of whether they ever create a login (POS-registered walk-ins, for example)

**KYC / Onboarding** (Section 6, FR-25–FR-32)
- `KycVerification` — one per tenant (1:0..1, enforced by `tenantId @unique`)
- `KycDocument` — per-document capture + status (FR-26), since a single verification decision spans multiple documents (business reg, licenses, ID, tax cert)
- `KycAuditLog` — append-only history of every status change, reviewer, and note (FR-31); `KycVerification` holds only the *current* state
- `CourierLicense` — Section 6.2's MACRA operating license tracking, with its own `expiryDate`/`status` (FR-28)
- `EventApproval` — per-event venue/permit approval, explicitly "distinct from organizer-level KYC" (FR-32)

**Fleet & trips**
- `Vehicle`, `Driver`, `RouteTrip`, `Seat` — a trip belongs to one operator, has one vehicle/driver, and owns its seat inventory
- `Seat.status` + `Seat.holdExpiresAt` implement FR-21/22's time-bound hold directly, rather than a separate "SeatHold" table — a seat can only be held by one prospective booking at a time, so the state fits on the seat itself

**Events**
- `Event`, `TicketType` — an event has one or more ticket types, each with independent `quantity`/`quantitySold` for oversell protection

**Bookings**
- `Booking` — one row per purchase, whether it's bus seats or event tickets
- `BookingSeat`, `BookingTicketType` — join tables, because a single booking can cover multiple seats or multiple ticket-type quantities (a group booking, or "2 VIP + 1 General")
- `Booking.qrCode` — the HMAC-signed ticket code (see [ARCHITECTURE.md](ARCHITECTURE.md))
- `Booking.idempotencyKey` — stored for traceability; the actual idempotency *enforcement* goes through the generic `IdempotencyKey` table (below)

**Parcels**
- `Parcel`, `ParcelHandlingLog` — `Parcel.status` is the current state; `ParcelHandlingLog` is the append-only history through each stage (FR-06), and closing the log with a `DELIVERED` entry is what FR-07 means by "digital delivery confirmation to close a parcel transaction"

**Payments**
- `PaymentSettlement` — one per booking (1:1); `splitBreakdown` is a JSON column holding the operator/agent/platform/gateway-fee split (FR-12) since the exact split rule is admin-configurable (FR-14) and shouldn't force a schema migration every time commission structures change
- `PaymentReconciliationIncident` — **not in the original diagram**, added for FR-24 ("payment gateway confirms a transaction but the corresponding booking/ticket record fails to write... logging the incident for review")
- `IdempotencyKey` — **not in the original diagram**, added for FR-23/API-03; generic across every booking-and-payment endpoint rather than booking-specific

**Validation**
- `ValidationLog` — every scan attempt (ticket or parcel), successful, failed, or manually overridden (FR-09); `reconciledAt` supports FR-10's "reconciliation against digital records after the event" for manual-fallback entries

## Deviations from the SRS diagram, and why

| Diagram says | This schema does | Reason |
|---|---|---|
| `BUS_OPERATOR`/`COURIER_OPERATOR`/`EVENT_ORGANIZER`/`RETAIL_POS_AGENT` as separate subtype tables sharing `Tenant`'s PK | Single `Tenant` table with a `type` enum | The SRS explicitly defers physical schema to System Architecture Design; a discriminator column is the standard Prisma pattern and avoids four near-identical tables with no extra fields of their own in the diagram |
| `Booking.payment_id` FK → Payment, *and* `Payment.booking_ref` FK → Booking | `PaymentSettlement.bookingId` only (payment references its booking) | The diagram's two-way FK is redundant for a 1:1 relationship; keeping one direction avoids a data-integrity hazard (the two FKs disagreeing) |
| No `PaymentReconciliationIncident` / `IdempotencyKey` / `KycAuditLog` entities | All three added | Each backs a specific FR (24, 23, 31) that has no other home in the diagram's entities |
| `RouteTrip` has no `price` field | Added `price` + `seatHoldMinutes` | A booking needs an amount to charge, and FR-21 explicitly calls the hold window "configurable per operator" — modeled per-trip so different routes on the same operator can differ |

## Regenerating the client after a schema change

```bash
# edit prisma/schema.prisma, then:
npm run db:generate     # regenerates src/generated/prisma (gitignored)
npm run db:migrate      # creates + applies a migration in dev
```

`npm run db:migrate` runs against `DIRECT_URL` (see `prisma.config.ts`) so
Neon's pgbouncer pooler never sees migration DDL; the running app's
Prisma Client (`src/lib/prisma.ts`) uses the pooled `DATABASE_URL` instead.
