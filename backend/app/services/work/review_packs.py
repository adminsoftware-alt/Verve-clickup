"""Monthly review packs: a ready-made Dashboard per person, as in the "Monthly Review" SOP.

Each pack shows only that person's work (a Dashboard filter), is shared with them and their reporting
manager, and can be emailed to both on the 1st of every month. Running it again only adds packs for
people who don't have one yet.
"""

from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Dashboard, User, WorkspaceMember, WorkspaceRole
from app.schemas import dashboards as d
from app.schemas import outbound as o
from app.services.work import audit
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid
from app.services.work.permissions import can_manage_workspace

PREFIX = "Monthly review – "


def create_packs(db: Session, access: Access, data: o.ReviewPackIn) -> o.ReviewPackOut:
    from app.services.work.dashboards import reports, service

    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can create review packs")
    members = {m.user_id: m for m in db.scalars(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.deactivated_at.is_(None),
        WorkspaceMember.role != WorkspaceRole.guest))}
    targets = data.user_ids if data.user_ids is not None else list(members)
    unknown = [u for u in targets if u not in members]
    if unknown:
        raise Invalid("Everyone must be an active member (not a guest)")
    created, existing, ids = 0, 0, []
    for uid in targets:
        user = db.get(User, uid)
        name = f"{PREFIX}{user.display_name or user.email}"[:100]
        dash = next((x for x in db.scalars(select(Dashboard).where(Dashboard.workspace_id == access.workspace_id, Dashboard.name == name))
                     if (x.filters or {}).get("assignees") == [uid]), None)
        if dash is not None:
            existing += 1
            ids.append(dash.id)
            continue
        opened = service.create_dashboard(db, access, d.DashboardCreate(name=name, template="monthly_review"))
        opened.dashboard.filters = {"assignees": [uid]}
        manager = members[uid].manager_id
        for viewer in {uid, manager} - {None, access.user_id}:
            service.grant(db, opened, d.DashboardShareCreate(user_id=viewer, level="view"))
        if data.email_monthly:
            reports.create_schedule(db, opened, d.ScheduleIn(
                recipient_ids=sorted({uid, manager} - {None}), subject=f"Your monthly review: {user.display_name or user.email}",
                frequency="monthly", day_of_month=1, send_time="09:00", timezone=members[uid].timezone or "Asia/Kolkata"))
        db.flush()
        created += 1
        ids.append(opened.dashboard.id)
    if created:
        audit.record(db, access.workspace_id, access.user_id, "workspace.review_packs", "workspace", access.workspace_id, None, {"created": created})
    return o.ReviewPackOut(created=created, existing=existing, dashboards=ids)
