# Testing

## 1. Unit tests

Pure business-logic functions (ticket-code signing, bank-name matching for
FR-27) have Vitest coverage that doesn't need a database:

```bash
npm test          # single run
npm run test:watch
```

Expected: `9 passed` across `tests/ticket-code.test.ts` and
`tests/kyc.test.ts`. These deliberately don't touch Prisma/Postgres so they
run in CI without a database available.

**What's not covered by unit tests:** every route handler that touches the
database (bookings, seat holds, KYC review, etc.) — those are exercised by
the manual walkthrough below. Adding integration tests would mean either a
test Postgres instance + `prisma migrate deploy` in CI, or mocking
`@/lib/prisma`; neither is wired up in this scaffold yet.

## 2. Manual API walkthrough (curl)

This exercises the full booking and KYC lifecycle end-to-end against a
running dev server and seeded data.

```bash
npm run dev          # in one terminal
npm run db:seed      # in another, if you haven't already
```

All seeded users share the password `Password123!` (see `prisma/seed.ts`
for the full list of emails/roles).

### 2.1 Signing in (Auth.js Credentials flow)

Auth.js requires a CSRF token fetched first, then a form-encoded POST that
sets a session cookie. Save this as `login.sh` and reuse it:

```bash
#!/usr/bin/env bash
# usage: ./login.sh <email> <password> <cookie-jar-file>
BASE=http://localhost:3000
EMAIL="$1"; PASSWORD="$2"; JAR="$3"
rm -f "$JAR"
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).csrfToken))')
curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "redirect=false" \
  -o /dev/null -w "login http status: %{http_code}\n"
curl -s -b "$JAR" "$BASE/api/auth/session"
```

```bash
chmod +x login.sh
./login.sh admin@lumticket.test Password123! admin.jar
# should print a session JSON with role: "ADMINISTRATOR"
```

Repeat with a different jar file per role you need concurrently, e.g.
`./login.sh ops@sunrise.test Password123! ops.jar`.

### 2.2 KYC: onboard a new retail agent (Section 11 acceptance criteria)

```bash
BASE=http://localhost:3000
TENANT_ID=00000000-0000-0000-0000-000000000003   # seeded "Mzuzu Corner Shop", status INACTIVE

# Submit KYC with a bank name that DOESN'T match the legal name
curl -s -b admin.jar -X POST "$BASE/api/tenants/$TENANT_ID/kyc" \
  -H "Content-Type: application/json" \
  -d '{"legalName":"Mzuzu Corner Shop","bankAccountRef":"John Banda Personal Account","documents":[]}'

KYC_ID=$(curl -s -b admin.jar "$BASE/api/tenants" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).data.find(t=>t.id==="'"$TENANT_ID"'");console.log(t)})')
# (or just grab the id printed by the KYC submit response above)

# Attempt approval -> expect 422 BANK_NAME_MISMATCH
curl -s -b admin.jar -X POST "$BASE/api/kyc/<kyc-id>/review" \
  -H "Content-Type: application/json" -d '{"decision":"APPROVED"}'

# Resubmit with a matching bank name, then approve
curl -s -b admin.jar -X POST "$BASE/api/tenants/$TENANT_ID/kyc" \
  -H "Content-Type: application/json" \
  -d '{"legalName":"Mzuzu Corner Shop","bankAccountRef":"Mzuzu Corner Shop","documents":[]}'
curl -s -b admin.jar -X POST "$BASE/api/kyc/<kyc-id>/review" \
  -H "Content-Type: application/json" -d '{"decision":"APPROVED"}'
# tenant status should now be ACTIVE
```

### 2.3 Bus booking + seat locking (FR-21/22/23)

```bash
./login.sh customer@example.test Password123! customer.jar

# Search
curl -s "$BASE/api/routes?origin=Lilongwe&destination=Blantyre"
TRIP_ID=<id from the response>

# Seat map
curl -s "$BASE/api/routes/$TRIP_ID/seats"
SEAT_ID=<an AVAILABLE seat id>

# Hold it (5-minute window)
curl -s -b customer.jar -X POST "$BASE/api/seats/hold" \
  -H "Content-Type: application/json" -d "{\"seatId\":\"$SEAT_ID\"}"

# Try holding the SAME seat again from a second "customer" -> expect 409 SEAT_UNAVAILABLE
curl -s -b customer.jar -X POST "$BASE/api/seats/hold" \
  -H "Content-Type: application/json" -d "{\"seatId\":\"$SEAT_ID\"}"

# Book it — note the Idempotency-Key header
curl -s -b customer.jar -X POST "$BASE/api/bookings" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(node -e 'console.log(crypto.randomUUID())')" \
  -d "{\"tripId\":\"$TRIP_ID\",\"seatIds\":[\"$SEAT_ID\"],\"paymentMethod\":\"POS\"}"
# Save the returned "qrCode" — that's what /api/validate checks.

# Retry the EXACT same request with the SAME Idempotency-Key header
# -> should return the identical response, not a second booking
```

### 2.4 Validating the ticket (FR-08/09, duplicate detection)

```bash
./login.sh inspector@sunrise.test Password123! inspector.jar

curl -s -b inspector.jar -X POST "$BASE/api/validate" \
  -H "Content-Type: application/json" \
  -d "{\"ticketOrParcelType\":\"TICKET\",\"code\":\"<qrCode>\",\"deviceId\":\"scanner-1\"}"
# -> { "result": "VALID", ... }

# Scan it again -> flagged as a duplicate, not silently allowed
curl -s -b inspector.jar -X POST "$BASE/api/validate" \
  -H "Content-Type: application/json" \
  -d "{\"ticketOrParcelType\":\"TICKET\",\"code\":\"<qrCode>\",\"deviceId\":\"scanner-1\"}"
# -> { "result": "INVALID", "reason": "DUPLICATE_USE", ... }
```

### 2.5 Parcel lifecycle (FR-05/06/07)

```bash
curl -s -b customer.jar -X POST "$BASE/api/parcels" \
  -H "Content-Type: application/json" \
  -d '{"recipientName":"Grace Phiri","recipientPhone":"+265888000000","pickupLocation":"Lilongwe","deliveryLocation":"Blantyre"}'
PARCEL_ID=<id from response>

./login.sh ops@sunrise.test Password123! ops.jar
curl -s -b ops.jar -X POST "$BASE/api/parcels/$PARCEL_ID/status" \
  -H "Content-Type: application/json" -d '{"status":"IN_TRANSIT","location":"Dedza checkpoint"}'
curl -s -b ops.jar -X POST "$BASE/api/parcels/$PARCEL_ID/status" \
  -H "Content-Type: application/json" -d '{"status":"DELIVERED","location":"Blantyre CBD"}'

# Track as the customer
curl -s -b customer.jar "$BASE/api/parcels/$PARCEL_ID"
```

### 2.6 Payment webhook + reconciliation gap (FR-24)

```bash
# A webhook for a booking that has no PaymentSettlement (simulate a lost write)
curl -s -X POST "$BASE/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $PAYMENT_GATEWAY_WEBHOOK_SECRET" \
  -d '{"bookingId":"00000000-0000-0000-0000-000000000000","gatewayRef":"gw_test","status":"SUCCESSFUL","amount":1000}'
# -> 202, and a PaymentReconciliationIncident row is created (check via `npm run db:studio`)
```

### 2.7 Everything else

`npm run db:studio` opens Prisma Studio — the fastest way to visually
confirm rows after each step above (seats flipping HELD → BOOKED, KYC
audit log entries accumulating, etc.).

## 3. Postman

Import the endpoints from [API.md](API.md) into a Postman collection, or
use Postman's "Generate from curl" on any command above. Postman keeps
cookies per environment automatically once you've hit
`/api/auth/callback/credentials` from within it, so the CSRF dance above
only has to happen once per role you're testing as.
