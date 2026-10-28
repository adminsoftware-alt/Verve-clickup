# Verveflow (repo: timetriq)

ClickUp-style work management + time tracking for Verve Advisory. See README.md for deploy topology.

## Layout
- `backend/` FastAPI + SQLAlchemy + Alembic. New work goes in `/api/v2` (`app/api/v2`, `app/services/work`). `/api/v1` is legacy Firestore; don't extend it.
- `frontend/src/work/` is the v2 React UI. Styles in `frontend/src/index.css`, feature flags in `frontend/src/config/features.ts`.

## Commands
- Frontend type check: `cd frontend && npx tsc -b` (the Vercel build runs this; must be clean before pushing)
- Frontend tests: `cd frontend && npx vitest run`
- Backend tests: start `backend/scripts/start-dev-db.ps1` (Postgres on 5433) first, then `cd backend && venv/Scripts/python -m pytest tests/v2 -q`. Never run two pytest processes at once.
- Backend: `venv/Scripts/python -m uvicorn app.main:app --port 8000` (no `--reload`). Open the app at `localhost:5173`, not 127.0.0.1.
- The app DB is Supabase; tests use the local 5433 DB (`TEST_DATABASE_URL`).

## Push
- Push to the `verve` remote, branch `harish`:
  `git -c credential.https://github.com.helper= -c credential.helper=manager push verve harish`
- PRs: give the user https://github.com/adminsoftware-alt/Verve-clickup/compare/main...harish (gh can't create them). Merging to main deploys Vercel + Render (Render runs migrations).
- Don't commit screenshots, loose images or docs (see .gitignore).

## Rules
- UI wording: roles are Admin / Manager / Employee only (never "Team lead"). App name is Verveflow.
- Default to styling-only changes unless a feature is explicitly asked for.
- No hover tooltips, no hover motion (cards must not lift/shift), no dimming; menus open at their button.
- Switched-off features are deleted, not hidden behind flags.
- Look: flat, one navy accent (#234788). No glossy/3D, serif or green themes.
- Comments explain *why* in plain sentences, matching existing files.
