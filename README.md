# Operations

Operations-management platform for Lobos Contracting: projects, daily jobs,
crew / plant / vehicle / hire allocation, cost tracking and day close.
Built with Next.js 14 (App Router), TypeScript, Tailwind and Prisma over
SQLite. See `CLAUDE.md` for architecture and working rules.

## 1. Prerequisites

- Node.js 18.18+ (20 LTS recommended)

## 2. Setup (fresh checkout only)

```bash
cd operations
npm install
cp .env.example .env
# set AUTH_SECRET (and ANTHROPIC_API_KEY if you want /assistant)
npm run db:push
npm run db:seed
```

## 3. The live app

The live app runs as the **OperationsServer** Windows service (NSSM, set up
once with `service/install-service.ps1`), serving a production build on
http://localhost:3000. It starts with Windows, survives sleep/lock/logoff and
restarts itself if it crashes. Don't use `npm run dev` for day-to-day use.

After a code change, redeploy from an elevated PowerShell:

```powershell
Stop-Service OperationsServer
npm.cmd run build   # plain `npm` is blocked by the PowerShell execution policy
Start-Service OperationsServer
```

The live database (`prisma/dev.db`) is backed up nightly by the
**Operations DB Backup** Scheduled Task (`scripts/register-backup-task.ps1`).

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
