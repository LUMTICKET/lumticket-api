# API Reference

Base URL in development: `http://localhost:3000`. All responses are JSON.
Errors follow the consistent shape required by API-05:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": null } }
```

List endpoints follow API-02's pagination convention:

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```
Query params: `?page=1&pageSize=20`.

Authenticated requests use the Auth.js session cookie (see
[TESTING.md](TESTING.md) for how to obtain one via curl, or drive it from a
browser). Roles required per endpoint are documented per-section and
summarized in [RBAC.md](RBAC.md).

---

## Auth

### `POST /api/auth/register` — Public
Self-service customer signup.
```json
// request
{ "name": "Chikondi Customer", "email": "c@example.com", "phone": "+265900000000", "password": "Password123!" }
// 201 response
{ "id": "uuid", "fullName": "Chikondi Customer", "email": "c@example.com" }
```

### `POST /api/auth/callback/credentials` (handled by Auth.js)
Sign in. See [TESTING.md](TESTING.md) for the exact curl sequence — Auth.js
needs a CSRF token fetched first.

---

## Tenants & KYC (Section 6, FR-14, FR-25–FR-32, UC-K01/K02)

### `POST /api/tenants` — ADMINISTRATOR
```json
// request
{ "type": "RETAIL", "legalName": "Mzuzu Corner Shop", "country": "Malawi" }
// 201 — status starts INACTIVE until KYC is approved (FR-25)
{ "id": "uuid", "type": "RETAIL", "status": "INACTIVE", ... }
```

### `GET /api/tenants?type=RETAIL&status=ACTIVE` — ADMINISTRATOR
Paginated tenant list.

### `POST /api/tenants/:id/kyc` — ADMINISTRATOR or staff of that tenant
FR-26: role-specific document capture.
```json
{
  "legalName": "Mzuzu Corner Shop",
  "businessRegRef": "BR-2024-001",
  "tpinRef": "TPIN-556",
  "bankAccountRef": "Mzuzu Corner Shop - NBM 100200300",
  "documents": [
    { "documentType": "business_registration", "documentRef": "s3://.../reg.pdf" },
    { "documentType": "national_id", "documentRef": "s3://.../id.pdf", "expiryDate": "2030-01-01" }
  ]
}
```
Retail tenants default to `riskTier: HIGH` (Section 6.3); everything else
defaults to `MEDIUM`.

### `POST /api/kyc/:id/review` — KYC_REVIEWER, ADMINISTRATOR
```json
{ "decision": "APPROVED" }
```
- `decision`: `APPROVED` | `REJECTED` | `RE_VERIFICATION_REQUIRED`
- On `APPROVED`, checks FR-27 (bank/mobile-money name vs. legal name). A
  mismatch returns `422 BANK_NAME_MISMATCH` and blocks activation — this is
  the exact scenario in the SRS's Section 11 acceptance-criteria example.
- On success, activates (`APPROVED`) or suspends (`REJECTED`) the tenant
  and appends a `KycAuditLog` row (FR-31).

---

## Bus routes, seats & bookings (FR-01–04, FR-21–23, UC-B01–04)

### `GET /api/routes?origin=Lilongwe&destination=Blantyre&date=2026-08-10` — Public
Returns trips with operator name, vehicle info, and live available-seat count.

### `POST /api/routes` — OPERATIONS_MANAGER, ADMINISTRATOR
Creates a trip + its seat inventory in one call.
```json
{
  "origin": "Lilongwe", "destination": "Blantyre",
  "scheduleDatetime": "2026-08-10T06:00:00Z",
  "price": 15000,
  "seatNumbers": ["01","02","03","04"]
}
```

### `GET /api/routes/:id/seats` — Public
Live seat map; lazily releases any expired holds before responding.
```json
{ "tripId": "uuid", "price": "15000", "seats": [ { "id": "uuid", "seatNo": "01", "status": "AVAILABLE", "holdExpiresAt": null } ] }
```

### `POST /api/seats/hold` — CUSTOMER, BOOKING_OFFICER, RETAIL_POS_AGENT, ADMINISTRATOR
FR-21. Atomic — two simultaneous requests for the same seat cannot both succeed.
```json
// request
{ "seatId": "uuid" }
// 200
{ "seatId": "uuid", "status": "HELD", "holdExpiresAt": "2026-08-02T10:35:00.000Z" }
// 409 if already taken
{ "error": { "code": "SEAT_UNAVAILABLE", ... } }
```

### `POST /api/seats/:id/release` — same roles
Manually release a hold (customer changed their mind).

### `POST /api/bookings` — CUSTOMER, BOOKING_OFFICER, RETAIL_POS_AGENT, ADMINISTRATOR
**Requires an `Idempotency-Key` header** (any unique string per attempt —
a UUID is fine). Retrying the same key returns the original response
instead of double-booking (FR-23).

Bus booking:
```json
// headers: Idempotency-Key: 3f1c...
{ "tripId": "uuid", "seatIds": ["uuid1","uuid2"], "paymentMethod": "ONLINE" }
```
Event booking:
```json
{ "eventId": "uuid", "ticketSelections": [{ "ticketTypeId": "uuid", "quantity": 2 }], "paymentMethod": "POS" }
```
- `paymentMethod: "POS"` confirms the booking and marks payment
  `SUCCESSFUL` immediately (cash collected at point of sale).
- `paymentMethod: "ONLINE"` leaves the booking `PENDING` until
  `/api/payments/webhook` confirms the charge.
- A customer omits `customerId` (resolved from their session); staff must
  pass `customerId` for the walk-in customer.
- 201 response includes the booking, its seats/ticket selections, and the
  `PaymentSettlement` row, plus `qrCode` — the value to encode in the QR
  image handed to the customer.

### `GET /api/bookings` — any authenticated user
Customers see only their own bookings; staff see all (see the tenancy
scoping caveat in [RBAC.md](RBAC.md)).

### `GET /api/bookings/:id` — owner or staff
Full booking detail including trip/event, seats, and payment.

### `POST /api/bookings/:id/cancel` — owner, BOOKING_OFFICER, CUSTOMER_SUPPORT, ADMINISTRATOR
FR-04. Releases any booked seats back to `AVAILABLE` and marks a
successful payment `REFUNDED` (the actual gateway refund call is a
follow-up integration, see [ARCHITECTURE.md](ARCHITECTURE.md)).

### `POST /api/cron/release-expired-holds` — `x-cron-secret` header
FR-22 background sweep. See [SETUP.md](SETUP.md) for scheduling this.

---

## Parcels (FR-05–07, UC-P01–03)

### `POST /api/parcels` — CUSTOMER, RETAIL_POS_AGENT, ADMINISTRATOR
```json
{ "recipientName": "Grace Phiri", "recipientPhone": "+265888000000",
  "pickupLocation": "Lilongwe Old Town", "deliveryLocation": "Blantyre CBD", "weight": 2.5 }
```

### `GET /api/parcels?status=IN_TRANSIT` — any authenticated user
Own parcels for customers; all for ops/dispatch/support/admin.

### `GET /api/parcels/:id` — owner, assigned driver, or ops/dispatch/support/admin
Includes the full `handlingLogs` history (FR-06).

### `POST /api/parcels/:id/status` — DISPATCHER, DRIVER, OPERATIONS_MANAGER, ADMINISTRATOR
```json
{ "status": "OUT_FOR_DELIVERY", "location": "Blantyre depot", "courierId": "uuid" }
```
Setting `status: "DELIVERED"` closes the transaction (FR-07) — the parcel
can't be transitioned again after that (`409 PARCEL_ALREADY_CLOSED`).

---

## Events (FR-01, UC-E01/E02)

### `POST /api/events` — OPERATIONS_MANAGER, ADMINISTRATOR
Creates an event and its ticket types together, as `DRAFT`.
```json
{
  "name": "Lake of Stars Festival", "venue": "Mangochi Lakeshore",
  "eventDate": "2026-09-15T18:00:00Z", "capacity": 5000,
  "ticketTypes": [{ "name": "General", "price": 20000, "quantity": 4000 }, { "name": "VIP", "price": 60000, "quantity": 500 }]
}
```

### `GET /api/events?name=Lake` — Public
Published events only.

### `GET /api/events/:id/ticket-types` — Public
Includes `remaining` (quantity minus quantitySold) per type.

---

## Validation / Scanning (FR-08–10, UC-B04, UC-E02, NFR-05, NFR-OF1/OF2)

### `POST /api/validate` — TICKET_INSPECTOR, DRIVER, ADMINISTRATOR
Ticket scan:
```json
{ "ticketOrParcelType": "TICKET", "code": "<bookingId>.<signature>", "deviceId": "scanner-07", "mode": "AUTO" }
```
Parcel scan:
```json
{ "ticketOrParcelType": "PARCEL", "parcelId": "uuid", "deviceId": "scanner-07", "mode": "MANUAL" }
```
Offline-queued replay (device was offline, syncing later):
```json
{ "ticketOrParcelType": "TICKET", "code": "...", "deviceId": "scanner-07", "clientTimestamp": "2026-08-02T09:58:00Z" }
```
Every attempt is logged — valid, invalid, or duplicate — the endpoint never
throws away a scan silently (FR-09). A second scan of an already-used
ticket returns:
```json
{ "result": "INVALID", "reason": "DUPLICATE_USE", "message": "...flagged as a duplicate-use conflict, not silently allowed.", "firstValidatedAt": "..." }
```

### `POST /api/validate/reconcile` — OPERATIONS_MANAGER, ADMINISTRATOR
FR-10: mark a manual-fallback `ValidationLog` entry as reconciled.
```json
{ "validationLogId": "uuid" }
```

---

## Payments (FR-11–13, FR-24)

### `POST /api/payments/webhook` — `x-webhook-secret` header
Stub for a licensed payment gateway's callback.
```json
{ "bookingId": "uuid", "gatewayRef": "gw_123", "status": "SUCCESSFUL", "amount": 15000 }
```
- On `SUCCESSFUL`: confirms the booking, marks the payment `SUCCESSFUL`.
- On `FAILED`: cancels the booking and releases any held seats.
- If no matching `PaymentSettlement` exists (the FR-24 mismatch scenario),
  logs a `PaymentReconciliationIncident` and responds `202` instead of
  erroring — the gateway shouldn't retry a webhook forever over a server
  bug it can't fix.

---

## Misc

### `GET /api/health` — Public
```json
{ "status": "ok", "db": "connected", "time": "2026-08-02T..." }
```
