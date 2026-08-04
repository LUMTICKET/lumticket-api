# Lumticket — Phase One Backend

Next.js (App Router) + PostgreSQL/Prisma backend for **Lumticket**: Bus
Ticketing, Parcel Logistics, and Event Ticketing, as specified in the
project SRS. This repo currently implements the API layer, data model,
auth/RBAC, and seat/booking/validation business logic — not the Customer
App or dashboard UIs (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for
scope).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, TypeScript) | Matches SRS TECH-02 ("Backend: Next.js") |
| Database | PostgreSQL (Neon) | Matches SRS TECH-03 |
| ORM | Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) | Type-safe queries, migrations |
| Auth | Auth.js / NextAuth v5, Credentials + JWT | Session carries `role` + `tenantId` for RBAC |
| Validation | Zod | Request body validation on every route |
| Styling | Tailwind CSS v4 | Brand tokens wired in `src/app/globals.css` |
| Tests | Vitest | Unit tests for pure business logic |

## Quick start

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL / DIRECT_URL / AUTH_SECRET
npm run db:migrate        # create tables in your Postgres database
npm run db:seed           # sample tenants, users, a trip, an event
npm run dev                # http://localhost:3000
```

See [docs/SETUP.md](docs/SETUP.md) for the full Neon setup walkthrough, and
[docs/TESTING.md](docs/TESTING.md) for how to exercise every endpoint.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system shape, what's built vs. deferred, key design decisions
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — Prisma schema walkthrough, mapped back to SRS Section 5
- [docs/API.md](docs/API.md) — every endpoint, request/response shape, required role, and the FR/UC it satisfies
- [docs/RBAC.md](docs/RBAC.md) — role list and what each can access
- [docs/SETUP.md](docs/SETUP.md) — Neon/Supabase/local Postgres setup, environment variables, migrations
- [docs/TESTING.md](docs/TESTING.md) — unit tests + a full manual curl/Postman walkthrough of the booking and KYC flows

## Project layout

```
prisma/schema.prisma        Data model (Section 5 of the SRS)
prisma/seed.ts               Sample data for local development
src/lib/                     Prisma client, auth, RBAC, idempotency, ticket codes, etc.
src/app/api/                 REST endpoints (App Router route handlers)
src/generated/prisma/        Generated Prisma Client (gitignored, regenerate with `npm run db:generate`)
tests/                       Vitest unit tests
```
