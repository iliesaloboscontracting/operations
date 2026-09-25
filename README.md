# Job Board — Command Centre

A drag-and-drop ops board: jobs/sites as rows, with a segregated resource
pool (Crew / Plant / Hire) in the sidebar that you drag onto a job's Crew,
Plant or Hire column. Built with Next.js (App Router), Prisma, and
PostgreSQL. Drag-and-drop uses native HTML5 DnD — no extra libraries.

## 1. Prerequisites

- Node.js 18.18+ (20 LTS recommended)
- PostgreSQL running locally (or a connection string to any Postgres instance)

## 2. Setup

```bash
cd job-board
npm install
cp .env.example .env
# edit .env if your DATABASE_URL differs
```

Create the database (skip if it already exists):

```bash
# Windows (psql on PATH) / macOS / Linux
psql -U postgres -c "CREATE USER jobboard WITH PASSWORD 'jobboard';"
psql -U postgres -c "CREATE DATABASE jobboard OWNER jobboard;"
```

Push the schema and seed sample data:

```bash
npm run db:push
npm run db:seed
```

## 3. Run it

```bash
npm run dev
```

Open http://localhost:3000 — you'll see today's jobs as rows, with a
resource sidebar on the left. Drag a crew/plant/hire card from the sidebar
onto the matching column of a job row to assign it; use the small dropdown
on an assigned chip to set their role for that job, and the × to unassign.
Switch days with the date tabs; "+ New job" adds a job/site for the
selected date.

## Project layout

```
prisma/schema.prisma        Job / Resource / Assignment data model
prisma/seed.ts              Sample jobs + crew/plant/hire to seed the DB
src/app/api/jobs            GET (list by date) / POST (create)
src/app/api/jobs/[id]       PATCH / DELETE
src/app/api/resources       GET (list, optionally by type) / POST (create)
src/app/api/resources/[id]  PATCH / DELETE (soft delete)
src/app/api/assignments     POST (assign resource to job — the "drop")
src/app/api/assignments/[id] PATCH (change role) / DELETE (unassign)
src/components/Board.tsx    Page state: fetches jobs+resources, wires up
                             assign/role-change/remove handlers
src/components/JobRow.tsx   One row: site info + Crew/Plant/Hire drop cells
src/components/DropCell.tsx Generic HTML5 drop target, filtered by resource type
src/components/ResourceSidebar.tsx  Collapsible Crew/Plant/Hire pool, draggable
```

## Extending it

- **Auth / multi-user**: add NextAuth or similar in front of the API routes.
- **Real-time sync** (so two users see drags live): swap the `fetch`-based
  refresh in `Board.tsx` for polling or a websocket/SSE subscription.
- **More resource fields** (rego, licence expiry, hire end-date, cost):
  add columns to `Resource` in `schema.prisma`, run `npm run db:push`.
- **Reordering job rows**: `Job.sortOrder` already exists — add a drag
  handle on `JobRow` and a PATCH to update `sortOrder` on drop.
