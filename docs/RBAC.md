# RBAC

Enforced per SRS Section 3 and NFR-04 ("RBAC shall be enforced at the API
level, not only in the UI"). Every protected route calls
`requireRole(...allowedRoles)` from `src/lib/rbac.ts` before touching the
database:

```ts
const { session, error } = await requireRole("ADMINISTRATOR");
if (error) return error; // 401 if not signed in, 403 if wrong role
```

Calling `requireRole()` with no arguments means "any authenticated user" —
used by endpoints like `GET /api/bookings/[id]` that then apply their own
finer-grained ownership check (e.g. "the booking's customer, or staff").

## Roles (`Role` enum, `prisma/schema.prisma`)

| Role | Typical dashboard | What it can do in this API |
|---|---|---|
| `ADMINISTRATOR` | System Administration | Create tenants, review KYC, everything staff roles can do |
| `KYC_REVIEWER` | System Administration → KYC module | Approve/reject/re-verify KYC submissions |
| `OPERATIONS_MANAGER` | Bus/Courier/Event Operator | Create trips, create events, oversee parcels |
| `BOOKING_OFFICER` | Bus/Event Operator | Create bookings on behalf of walk-in customers, cancel bookings |
| `FINANCE_OFFICER` | Operator — Finance module | (Reporting endpoints are a follow-up; see API.md) |
| `DISPATCHER` | Bus/Courier Operator | Update parcel status, assign couriers |
| `CUSTOMER_SUPPORT` | Support console | View bookings/parcels, cancel bookings |
| `TICKET_INSPECTOR` | Scanning & Validation App | Validate tickets/parcels |
| `RETAIL_POS_AGENT` | Retail & POS | Register parcels, create POS-paid bookings |
| `DRIVER` | Driver App | Validate tickets/parcels, update parcel status for assigned parcels |
| `CUSTOMER` | Customer App | Book trips/events, register parcels, view/cancel own bookings |

## Endpoint → role matrix

See [API.md](API.md) for full request/response shapes; this is the access
summary.

| Endpoint | Allowed roles |
|---|---|
| `POST /api/auth/register` | Public |
| `POST /api/tenants` | ADMINISTRATOR |
| `GET /api/tenants` | ADMINISTRATOR |
| `POST /api/tenants/:id/kyc` | ADMINISTRATOR, or staff of that tenant |
| `POST /api/kyc/:id/review` | KYC_REVIEWER, ADMINISTRATOR |
| `GET /api/routes` | Public |
| `POST /api/routes` | OPERATIONS_MANAGER, ADMINISTRATOR |
| `GET /api/routes/:id/seats` | Public |
| `POST /api/seats/hold` | CUSTOMER, BOOKING_OFFICER, RETAIL_POS_AGENT, ADMINISTRATOR |
| `POST /api/seats/:id/release` | CUSTOMER, BOOKING_OFFICER, RETAIL_POS_AGENT, ADMINISTRATOR |
| `POST /api/bookings` | CUSTOMER, BOOKING_OFFICER, RETAIL_POS_AGENT, ADMINISTRATOR |
| `GET /api/bookings` | Any authenticated (customers see only their own) |
| `GET /api/bookings/:id` | Owner customer, or BOOKING_OFFICER/OPERATIONS_MANAGER/ADMINISTRATOR/CUSTOMER_SUPPORT/TICKET_INSPECTOR |
| `POST /api/bookings/:id/cancel` | Owner customer, or BOOKING_OFFICER/CUSTOMER_SUPPORT/ADMINISTRATOR |
| `POST /api/parcels` | CUSTOMER, RETAIL_POS_AGENT, ADMINISTRATOR |
| `GET /api/parcels` | Any authenticated (customers see only their own) |
| `GET /api/parcels/:id` | Owner customer, assigned DRIVER, or DISPATCHER/OPERATIONS_MANAGER/ADMINISTRATOR/CUSTOMER_SUPPORT |
| `POST /api/parcels/:id/status` | DISPATCHER, DRIVER, OPERATIONS_MANAGER, ADMINISTRATOR |
| `POST /api/events` | OPERATIONS_MANAGER, ADMINISTRATOR |
| `GET /api/events` | Public |
| `GET /api/events/:id/ticket-types` | Public |
| `POST /api/validate` | TICKET_INSPECTOR, DRIVER, ADMINISTRATOR |
| `POST /api/validate/reconcile` | OPERATIONS_MANAGER, ADMINISTRATOR |
| `POST /api/payments/webhook` | Shared-secret header, not a user session |
| `POST /api/cron/release-expired-holds` | Shared cron secret header, not a user session |

## Notes

- **Individually attributable accounts (FR-30):** the schema has no shared
  "operator login" — every `User` row is one person, `email`-unique.
- **`tenantId` scoping is partial.** Several handlers (e.g. `POST
  /api/routes`) use the caller's own `session.user.tenantId` for writes, but
  read endpoints don't yet filter *staff* reads down to "only your own
  tenant's data" (e.g. an Operations Manager at Operator A can currently
  view Operator B's booking by ID if they know it). Tightening this is a
  natural next step before multi-tenant production use — see the "Open
  Items" note in the SRS about tenancy being an architecture decision.
