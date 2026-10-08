# Verve Workflow

Work management for an advisory firm, with time tracking built into the middle of it rather
than bolted on the side.

Work is organised the way ClickUp organises it — Spaces, Folders, Lists, tasks — and is read
back the way an accountancy practice needs to read it: hours against capacity, estimates
against actuals, statutory filings against their due dates, and a timesheet that goes to a
manager on Friday.

---

## Running it

You need Python 3.12, Node 20 and PostgreSQL.

```bash
# 1. Database — a local cluster on port 5433
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

`backend/.env` holds the database URL and the Firebase service account. It is not in the
repository and should never be. `DEV_LOGIN=true` in that file turns on a local sign-in page
that skips Firebase; it defaults to off and must stay off anywhere real.

```bash
cd backend && venv/Scripts/python -m pytest tests/v2 -q   # 337 tests
cd frontend && npm run build                              # typecheck + build
```

`npx tsc --noEmit` checks nothing here — the root `tsconfig.json` only holds references.
Use `npx tsc -b` or `npm run build`.

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
  work/            the application: spaces, tasks, dashboards, timesheets
  components/      shared pieces used across it
  config/          feature flags
```

The API is versioned. `/api/v1` is the original Firestore-backed app; `/api/v2` is this
rebuild and is where everything new goes.

---

## What it does

### Organising work

Spaces hold Folders, Folders hold Lists, Lists hold tasks, tasks hold subtasks five deep.

> *VAPL Common Operations* → *Monthly Review* → *PMS – Accounts* → "File Infrabeat GSTR-3B"
> → "Collect the purchase register"

**Statuses** are defined at any level and inherit downward, so one status set can cover a
whole Space while a single List overrides it. **Custom task IDs** give every task a name you
can say out loud — `VAP-1942`. **Task types** mark what kind of thing a task is (Milestone,
Client Request) and can be applied to many tasks at once from the selection bar.

A task carries status, priority, assignees, start and due dates, a time estimate, type,
tags, custom fields, checklists, attachments, relationships, watchers and its own activity
feed.

### Seeing it

The same tasks, read six ways: **List**, **Board**, **Table**, **Calendar**, **Workload**
and **Activity**. Gantt, Timeline, Team, Chat, Map, Form and Doc are built and behind a flag.

Each view remembers its own grouping, filters and columns, so one List can carry "Mine, by
due date" and "Everything, by client" without either disturbing the other.

### Tracking time

Three ways, because people record time in three different situations:

- a **timer**, started and stopped;
- a **duration** typed into a cell — `2h 30m`, or `1`, which offers you *1h* or *1m* rather
  than guessing;
- a **period**, stated — *from 6:00pm to 7:00pm* — which is how you record at 10pm the hour
  you actually worked at six.

### Timesheets

A week as a grid: tasks down the side, days across. Hovering a cell shows the entries behind
it. Capacity is set per weekday per person, by an admin, and the day column turns red when
the hours pass it.

A week can be **submitted**, which locks it and routes it to the person's reporting manager,
who approves it or asks for changes with a comment thread attached.

### Dashboards

Nineteen card types — figures, pie, bar, line, capacity, variance, timesheet, time report,
workload, portfolio, task lists, notes and more. Each card carries its own filters, and
clicking into one drills through to the tasks behind the number.

Three boards are made automatically:

| Board | Who gets it |
|---|---|
| **My work** | everyone |
| **Team** | whoever leads a Team, person by person |
| **Company** | owners and admins |

### Working together

Comments with `@mentions`, assigned comments, replies and reactions; watchers on a task; and
an Inbox that sorts twenty-one kinds of notification into *things that need you* and
*activity you follow*, with snooze. Notifications also reach people by email — instantly or
as a daily digest at an hour they choose — by browser push, and by WhatsApp.

### Duplicating

Tasks, Lists, Folders and Spaces. Choose where the copy goes, choose **Everything**,
**Tasks only** or **Customize**, decide whether archived tasks come along, and decide who
the copy is for — either everyone, or named people, in which case the copy is made private
and handed to them.

### Sharing one task

Distinct from duplicating, and the distinction matters. A shared task is *the same task* on
several people's lists: an hour one person tracks is an hour the others see, and there is
one comment thread. A duplicate is two tasks that drift apart from the moment they are made.

### Automations

Six triggers — created, status changed, priority changed, assignee added, due soon, overdue —
against six actions: assign, notify, set priority, set status, escalate to the assignee's
manager, add a tag. Set on any Space, Folder or List, inherited downward.

> *When a task is two days overdue → tell the assignee's manager.*

### People

Teams with sub-teams and leads, an org chart, a reporting manager per person, per-person
working capacity, joiner and leaver checklists, bulk import, and an audit log.

---

## Who can do what

Permissions follow ClickUp's resolution order, with the firm's own rules on top.

| | Task | List | Folder | Space |
|---|---|---|---|---|
| **Employee** | create · edit · duplicate | — | — | — |
| **Manager** (leads a Team) | all | create · share · duplicate | create · share · duplicate | — |
| **Admin / owner** | all | all | all | create · share · duplicate · rename · delete |

**Renaming and deleting are admin-only everywhere.** Access alone was never a sufficient
test: everyone who can see a public Space resolves to full access on everything inside it,
so without a role check any member could have deleted a Folder holding a year of work. The
one exception is a person's own Personal List, which is invisible to everyone else and so is
theirs to name.

---

## Features behind flags

Roughly two thirds of what is built is switched off in
[`frontend/src/config/features.ts`](frontend/src/config/features.ts). Each flag carries a
comment saying what it hides and why. Nothing behind a flag is unfinished — it is complete,
tested, and waiting on a decision.

The ones worth knowing about:

| Flag | What it turns on |
|---|---|
| `compliance` | Statutory calendar — GSTR-3B, TDS, AOC-4 and the rest, per client, as dated tasks |
| `leave` | Leave types, allowances, Indian holidays, approvals, and capacity that drops when someone is off |
| `billing` | Rates per person and location, client fees, profitability, invoice drafts |
| `goals` | Numeric, currency, yes/no and task-completion targets |
| `teamWeek` | One screen showing a team's whole week |
| `templates` | Save any task, List, Folder or Space as a reusable template |
| `listEmail` | Forward an email to a List's own address and it becomes a task |

`listEmail` additionally needs a catch-all mailbox with plus-addressing and four values in
`backend/.env`; the rest are a single boolean.

---

## Known issues

- **The server reads "today" in UTC.** Between midnight and 05:30 IST a public link outlives
  its expiry and the sprint burndown loses today. Three call sites.
- **Deleting cascades with no undo.** A Space takes its Folders, Lists and every task with
  it. The audit log records who did it, not how to recover. Archive exists and is off.
- **Muting an automation silences all of them.** Notification settings work per kind, not
  per rule.
- **Google Sheets export** needs OAuth credentials that are not configured. PDF, CSV and
  Excel all work.
- **One large JavaScript chunk.** Every build warns; the app has not been split yet.
