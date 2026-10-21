# Verve Workflow

Work management for an advisory firm, with time tracking built into the middle of it rather
than bolted on the side.

Work is organised the way ClickUp organises it — Spaces, Folders, Lists, tasks — and is read
back the way an accountancy practice needs to read it: hours against capacity, estimates
against actuals, and a timesheet that goes to a Manager at the end of the week.

**Live:** [verve-clickup.vercel.app](https://verve-clickup.vercel.app)

---

## Where it runs

```
 Browser ──► Vercel (frontend, React)          verve-clickup.vercel.app
               │  VITE_API_URL
               ▼
            Render (backend, FastAPI)          verve-workflow-api.onrender.com
               │  DATABASE_URL                 │  sign-in tokens
               ▼                               ▼
            Supabase (PostgreSQL, Seoul)     Firebase Auth (Google / email sign-in)
```

| Part | Service | Deploys |
|---|---|---|
| Frontend | Vercel | Automatically on every push to `main` |
| Backend | Render, from [`render.yaml`](render.yaml) | Automatically on every push to `main`; runs `alembic upgrade head` before starting |
| Database | Supabase Postgres | Schema changes arrive through the backend's migrations |
| Sign-in | Firebase Authentication | — |

Secrets are never in this repository. Vercel holds the `VITE_FIREBASE_*` values and
`VITE_API_URL`; Render holds `DATABASE_URL`, `AI_API_KEY`, and two Secret Files —
`firebase.json` (the Firebase service account) and `vapid.json` (the Web Push keys).

---

## Running it locally

You need Python 3.12, Node 20 and PostgreSQL.

```bash
# 1. A local Postgres on port 5433 (used for the tests, and as a fallback database)
backend/scripts/start-dev-db.ps1

# 2. Backend — http://127.0.0.1:8000, API docs at /docs
cd backend
python -m venv venv && venv/Scripts/pip install -r requirements.txt
venv/Scripts/python -m alembic upgrade head
venv/Scripts/python -m uvicorn app.main:app --port 8000

# 3. Frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```

Open **`localhost:5173`**, not `127.0.0.1:5173` — sign-in is bound to the hostname.

`backend/.env` holds:

| Setting | What it is |
|---|---|
| `DATABASE_URL` | The database the app uses — Supabase, or the local server |
| `TEST_DATABASE_URL` | Where the tests run. **Always a local database**: the tests empty every table |
| `FIREBASE_CREDENTIALS_PATH` | The Firebase service-account file |
| `DEV_LOGIN` | `true` adds a local "sign in as anyone" page. Never on anywhere real |
| `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | The assistant's AI fallback (any OpenAI-compatible API) |

```bash
cd backend && venv/Scripts/python -m pytest tests/v2 -q    # 424 tests, about 30 minutes
cd frontend && npx tsc --noEmit -p tsconfig.app.json       # type-check
```

`npx tsc --noEmit -p .` checks nothing here — the root `tsconfig.json` only holds references.
Run one pytest at a time: two runs share the test database and empty each other's tables.

---

## How it is built

| | |
|---|---|
| **Backend** | FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL |
| **Frontend** | React 19 · TypeScript · Vite · Tailwind v4 |
| **Auth** | Firebase, with a local bypass for development |
| **Charts, docs, sheets** | Recharts · TipTap · jsPDF · SheetJS |

```
backend/app/
  api/v2/          HTTP routes, one module per area
  services/work/   where the rules live — the layer worth reading first
  db/models/       SQLAlchemy tables
  schemas/         Pydantic request and response shapes
  alembic/         migrations

frontend/src/
  work/            the application: spaces, tasks, dashboards, timesheets, assistant
  components/      shared pieces used across it
  config/          feature flags
```

The API is versioned. `/api/v1` is the original Firestore-backed app and now only carries a few
leftovers (presence, the old notification bell); `/api/v2` is the Postgres rebuild and is where
everything new goes.

---

## Who can do what

There are three kinds of access: **Admin**, **Manager** and **Employee**. A Manager is anyone
who leads a Team; everyone else who is not an Admin is an Employee.

| | Tasks | Lists | Folders | Spaces | Time |
|---|---|---|---|---|---|
| **Employee** | create · edit their own; comment on others' | create inside Spaces/Folders they can edit | — | — | their own |
| **Manager** | all of the above, plus edit their team's tasks | create · share | create · share | — | their own, and **fix their team's** |
| **Admin** | all | all | all | create · share · rename · delete | everyone's |

- **Fixing time.** A Manager can log, change or delete a team member's time entries and
  timesheet cells — including a week that has been submitted and is waiting for their
  decision. An approved week is final for everyone but Admins. The team member gets a
  notification ("Harsh changed your time on 21 Oct from 3h to 2.5h"), and every change is kept
  in the audit log.
- **Renaming and deleting are admin-only everywhere.** Access alone was never a sufficient
  test: everyone who can see a public Space resolves to full access on everything inside it,
  so without a role check any member could have deleted a Folder holding a year of work.

---

## What it does

### Organising work

Spaces hold Folders, Folders hold Lists, Lists hold tasks, tasks hold subtasks five deep.

> *VAPL Common Operations* → *Monthly Review* → *PMS – Accounts* → "File Infrabeat GSTR-3B"
> → "Collect the purchase register"

A new Space is made through a short **Create Space** flow and carries a **default
permission** and **default views**; each List opens on its List view. **Statuses** are defined
at any level and inherit downward. **Custom task IDs** give every task a name you can say out
loud — `VAP-1942`.

A task carries status, priority, assignees, start and due dates, a time estimate, checklists,
attachments and its own activity feed.

### Tracking time

Three ways, because people record time in three different situations:

- a **timer**, started and stopped;
- a **duration** typed into a cell — `2h 30m`, or `1`, which offers you *1h* or *1m* rather
  than guessing;
- a **period**, stated — *from 6:00pm to 7:00pm* — which is how you record at 10pm the hour
  you actually worked at six.

### Timesheets

A week as a grid: tasks down the side, days across. Hovering a cell shows the entries behind
it. Working hours are set for the company, each Team and each person, and the day column
turns red when the hours pass them.

A week can be **submitted**, which locks it and routes it to the person's Manager, who
approves it, fixes it, or asks for changes with a comment thread attached.

### Planner and dashboards

The **Planner** shows work by day, week or month. **Highlights** describe a person's or a
Team's week in sentences. Dashboards are made automatically:

| Board | Who gets it |
|---|---|
| **My work** | everyone |
| **Team** | Managers, person by person |
| **Company** | Admins |

### The assistant

A chat bubble that understands plain requests — *"create a task to file GSTR-3B for Infrabeat
every month on the 20th"*, *"how much time did I log yesterday?"* — in English and Hindi. Its
phrase rules answer most things instantly; what they cannot parse goes to an AI model
(`backend/app/services/work/ai_assistant.py`) through any OpenAI-compatible API.

### Working together

Comments with `@mentions`, replies and reactions, and an Inbox that sorts notifications into
*things that need you* and *activity you follow*, with snooze. Notifications reach people in
the app and by browser push. **Email is used for invitations only** — no digests, no updates.

### People

Teams with sub-teams, an org chart (exportable), a reporting manager per person, addresses,
per-person working hours, a leaver hand-over that moves open work to someone else, bulk
import, and an audit log.

---

## Features behind flags

Some finished features are switched off in
[`frontend/src/config/features.ts`](frontend/src/config/features.ts), each with a comment
saying why. Features the firm decided against (leave, billing) have been removed from the code
rather than hidden.

| Flag | What it turns on |
|---|---|
| `compliance` | Statutory calendar — GSTR-3B, TDS, AOC-4 and the rest, per client, as dated tasks |
| `goals` | Numeric, currency, yes/no and task-completion targets |
| `teamWeek` | One screen showing a team's whole week |
| `templates` | Save any task, List, Folder or Space as a reusable template |
| `automations` | When-this-then-that rules on Spaces, Folders and Lists |
| `listEmail` | Forward an email to a List's own address and it becomes a task |

---

## Recent work (October 2026)

- **Went live:** the database moved from a local server to Supabase (every table and row
  checked), the backend to Render, the frontend to Vercel.
- **Managers fix their team's time**, including submitted weeks, with a notification and an
  audit record.
- **Three kinds of access** — Admin, Manager, Employee — replacing the older role names.
- **Create Space** flow, Space default permissions and views.
- **The assistant** gained an AI fallback, a guide, and better recurrence and phrase handling.
- People got **addresses**, the org chart became **exportable**, and the phone layout gained
  a scope switcher.
- The original v1 pages (Calendar, Time Entries, Workload, Teams, Projects, Reports) were
  removed; their v2 replacements are the only versions.

## Next

1. **Daily reminders** in the app and by push: nothing planned for today (10:30), no time
   logged today (18:00), a timer running longer than 4 or 8 hours.
2. **Notification controls:** quiet hours, a daily summary, and approving or completing work
   straight from a notification.
3. **Bulk actions with a preview:** hand all of someone's open tasks to another person, shift
   due dates for a holiday, move people between Teams.
4. **Files to Supabase Storage**, so attachments survive a redeploy.
5. **Sign-in to Supabase Auth**, retiring Firebase.

---

## Known issues

- **The backend sleeps on Render's free plan** after 15 minutes without requests, and the
  first request after that waits about a minute. Scheduled jobs pause while it sleeps; an
  external ping every 10 minutes keeps it awake.
- **Attachments are stored on the server's disk**, which Render wipes on every deploy.
  Moving them to Supabase Storage is planned.
- **Supabase's free plan has no automatic backups.** Take a `pg_dump` before risky changes.
- **Sign-in still goes through Firebase**, and a few leftovers (presence, the old bell) still
  read Firestore.
- **The server reads "today" in UTC** in three places: between midnight and 05:30 IST a public
  link outlives its expiry and the sprint burndown loses today.
- **Deleting cascades with no undo.** A Space takes its Folders, Lists and every task with it.
  The audit log records who did it, not how to recover.
- **One large JavaScript chunk.** Every build warns; the app has not been split yet.
