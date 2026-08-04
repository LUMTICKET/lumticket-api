# Setup

## 1. Prerequisites

- Node.js 20+ (project was built/tested on Node 24)
- A PostgreSQL database — instructions below for Neon (recommended),
  Supabase, and local/Docker Postgres

## 2. Get a Postgres connection string

### Option A — Neon (recommended)

1. Create a free project at [console.neon.tech](https://console.neon.tech).
2. On the project dashboard, copy the **pooled** connection string (the one
   with `-pooler` in the hostname) — this becomes `DATABASE_URL`.
3. Copy the **direct** connection string (no `-pooler`) — this becomes
   `DIRECT_URL`. Migrations run against this one so Neon's pgbouncer pooler
   never has to deal with `CREATE TABLE`/prepared-statement quirks.
4. Both strings need `?sslmode=require` at the end (Neon includes this by
   default).

### Option B — Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Project Settings → Database → Connection string:
   - Use the **"Transaction" pooler** (port 6543) string for `DATABASE_URL`.
   - Use the **"Session"/direct** (port 5432) string for `DIRECT_URL`.
3. Append `?sslmode=require` to both if not already present.

### Option C — Local/Docker Postgres

```bash
docker run --name lumticket-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=lumticket -p 5432:5432 -d postgres:16
```

Then use the same URL for both variables:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lumticket?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/lumticket?schema=public"
```

## 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled connection, used by the running app (`src/lib/prisma.ts`) |
| `DIRECT_URL` | Direct connection, used by `prisma migrate` (`prisma.config.ts`) |
| `AUTH_SECRET` | Signs session JWTs *and* ticket QR codes (`src/lib/ticket-code.ts`). Generate with `npx auth secret` or `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Base URL of the app (`http://localhost:3000` in dev) |
| `PAYMENT_GATEWAY_API_KEY` / `PAYMENT_GATEWAY_WEBHOOK_SECRET` | Placeholder until a licensed processor is integrated (FR-11) |
| `CRON_SECRET` | Shared secret required by `/api/cron/release-expired-holds` |

## 4. Install, migrate, seed

```bash
npm install                # also runs `prisma generate` via postinstall
npm run db:migrate          # creates all tables from prisma/schema.prisma
npm run db:seed             # sample tenants, users, one trip, one event
```

`db:migrate` will prompt for a migration name the first time
(`npx prisma migrate dev --name init` non-interactively if you're scripting
this).

## 5. Run the app

```bash
npm run dev
```

Visit `http://localhost:3000/api/health` — it should return
`{"status":"ok","db":"connected",...}`.

## 6. Wiring the cron sweep (production)

`/api/cron/release-expired-holds` implements FR-22's background half (seat
holds expire even if no one calls `/api/routes/:id/seats` to trigger the
lazy check). Point any scheduler at it every 30–60 seconds:

```bash
curl -X POST https://your-domain/api/cron/release-expired-holds \
  -H "x-cron-secret: $CRON_SECRET"
```

- **Vercel:** add a `vercel.json` cron entry pointing at this route.
- **Anything else:** a system cron job, GitHub Actions scheduled workflow,
  or a cloud scheduler (e.g. cron-job.org, AWS EventBridge) all work fine —
  it's a single authenticated POST.

## Common issues

| Symptom | Fix |
|---|---|
| `Can't reach database server` | Check the connection string host/port; confirm your IP isn't blocked (Neon/Supabase allow all IPs by default, but check if you changed that) |
| `password authentication failed` | URL-encode special characters in the password |
| Migrations succeed but the app can't connect | Make sure `DATABASE_URL` (pooled) is set — `prisma.config.ts` only affects `migrate`, not the running app |
| `PrismaClientKnownRequestError: Unique constraint failed` on re-running seed | Expected — the seed script uses `upsert` for most rows, but trips/events are created fresh each run; drop and re-migrate if you want a clean slate |
