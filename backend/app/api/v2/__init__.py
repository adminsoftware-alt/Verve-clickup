from fastapi import APIRouter

from app.api.v2 import admin, compliance, devlogin, goals, spaces_extra, leave, outbound, planning, viewdata, collab, dashboards, links, locations, organise, people, tasks, templates, timesheets, workspaces

api_router = APIRouter()
api_router.include_router(workspaces.router, tags=["v2 workspaces"])
api_router.include_router(locations.router, tags=["v2 hierarchy"])
api_router.include_router(tasks.router, tags=["v2 tasks"])
api_router.include_router(dashboards.router, tags=["v2 dashboards"])
api_router.include_router(timesheets.router, tags=["v2 timesheets"])
api_router.include_router(collab.router, tags=["v2 comments & inbox"])
api_router.include_router(templates.router, tags=["v2 templates"])
api_router.include_router(people.router, tags=["v2 people & teams"])
api_router.include_router(organise.router, tags=["v2 favourites, task types, tags"])
api_router.include_router(links.router, tags=["v2 dependencies & links"])
api_router.include_router(viewdata.router, tags=["v2 all tasks, gantt, activity, forms"])
api_router.include_router(planning.router, tags=["v2 planner, calendar sync, lineup, automations"])
api_router.include_router(admin.router, tags=["v2 people administration"])
api_router.include_router(leave.router, tags=["v2 leave and billing"])
api_router.include_router(outbound.router, tags=["v2 notification delivery"])
api_router.include_router(compliance.router, tags=["v2 compliance calendar"])
api_router.include_router(spaces_extra.router, tags=["v2 spaces, sprints, public links, doc/chat views"])
api_router.include_router(goals.router, tags=["v2 goals"])
api_router.include_router(devlogin.router, tags=["v2 local testing"])  # 404s unless DEV_LOGIN is on
