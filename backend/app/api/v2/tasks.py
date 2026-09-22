import uuid
from datetime import date, datetime, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import bulk, importing, search, tasks, timetracking, views, workload
from app.services.work.access import open_folder, open_list, open_space, open_task

router = APIRouter()
VIEW = PermissionLevel.view


def _register_location_routes(path: str, opener: Callable) -> None:
    @router.get(f"{path}/tasks", response_model=s.TaskPage)
    def location_tasks(
        obj_id: uuid.UUID,
        include_closed: bool = Query(False, description="Closed tasks are hidden by default"),
        include_archived: bool = Query(False),
        include_subtasks: bool = Query(True),
        date_from: Optional[datetime] = Query(None, description="Start or due date on/after this"),
        date_to: Optional[datetime] = Query(None, description="Start or due date before this"),
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        f = tasks.TaskFilter(
            include_closed=include_closed,
            include_archived=include_archived,
            include_subtasks=include_subtasks,
            date_from=_utc(date_from),
            date_to=_utc(date_to),
        )
        return tasks.location_tasks(db, opener(db, user.id, obj_id, VIEW), f, limit, offset)

    @router.get(f"{path}/dashboard", response_model=s.DashboardOut)
    def location_dashboard(
        obj_id: uuid.UUID,
        day_start: Optional[datetime] = Query(None, description="Start of 'today' in the viewer's timezone"),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        start = _utc(day_start) or datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return tasks.dashboard(db, opener(db, user.id, obj_id, VIEW), start)

    @router.get(f"{path}/workload", response_model=s.WorkloadOut)
    def location_workload(
        obj_id: uuid.UUID,
        start: date = Query(..., description="First day shown, in the viewer's local calendar"),
        days: int = Query(14, ge=1, le=62),
        tz_offset: int = Query(0, description="The viewer's JS getTimezoneOffset(), in minutes"),
        team_id: Optional[uuid.UUID] = Query(None),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        return workload.workload(db, opener(db, user.id, obj_id, VIEW), start, days, tz_offset, team_id)

    @router.get(f"{path}/views", response_model=List[s.ViewOut])
    def location_views(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        result = [views.view_out(v) for v in views.list_views(db, opener(db, user.id, obj_id, VIEW))]
        db.commit()  # the required List view may have just been created
        return result

    @router.post(f"{path}/views", response_model=s.ViewOut, status_code=status.HTTP_201_CREATED)
    def create_view(
        obj_id: uuid.UUID, data: s.ViewCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
    ):
        view = views.create_view(db, opener(db, user.id, obj_id, VIEW), data)
        db.commit()
        return views.view_out(view)


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


_register_location_routes("/spaces/{obj_id}", open_space)
_register_location_routes("/folders/{obj_id}", open_folder)
_register_location_routes("/lists/{obj_id}", open_list)


@router.patch("/views/{view_id}", response_model=s.ViewOut)
def update_view(
    view_id: uuid.UUID, data: s.ViewUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = views.open_view(db, user.id, view_id, VIEW)
    views.update_view(db, opened, data)
    db.commit()
    return views.view_out(opened.obj)


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_view(view_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    views.delete_view(db, views.open_view(db, user.id, view_id, VIEW))
    db.commit()


@router.post("/lists/{list_id}/tasks", response_model=s.TaskDetailOut, status_code=status.HTTP_201_CREATED)
def create_task(
    list_id: uuid.UUID, data: s.TaskCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened_list = open_list(db, user.id, list_id, VIEW)
    task = tasks.create_task(db, opened_list, data)
    db.commit()
    return tasks.task_detail(db, open_task(db, user.id, task.id, VIEW))


@router.get("/workspaces/{workspace_id}/search/tasks", response_model=List[s.TaskOut])
def search_tasks(
    workspace_id: uuid.UUID,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return search.search_tasks(db, user.id, workspace_id, q, limit)


@router.post("/lists/{list_id}/import", response_model=s.ImportResult)
def import_tasks(list_id: uuid.UUID, data: s.ImportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = importing.import_rows(db, open_list(db, user.id, list_id, VIEW), data)
    db.commit()
    return result


@router.post("/tasks/bulk", response_model=s.BulkResult)
def bulk_edit(data: s.BulkEdit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = bulk.bulk_edit(db, user.id, data)
    db.commit()
    return result


@router.get("/tasks/{task_id}", response_model=s.TaskDetailOut)
def get_task(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return tasks.task_detail(db, open_task(db, user.id, task_id, VIEW))


@router.patch("/tasks/{task_id}", response_model=s.TaskDetailOut)
def update_task(
    task_id: uuid.UUID, data: s.TaskUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_task(db, user.id, task_id, VIEW)
    tasks.update_task(db, opened, data)
    db.commit()
    return tasks.task_detail(db, open_task(db, user.id, task_id, VIEW))


@router.post("/tasks/{task_id}/move", response_model=s.TaskDetailOut)
def move_task(
    task_id: uuid.UUID, data: s.TaskMove, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_task(db, user.id, task_id, VIEW)
    target = open_list(db, user.id, data.list_id, VIEW)
    tasks.move_task(db, opened, target, data.status_mapping)
    db.commit()
    return tasks.task_detail(db, open_task(db, user.id, task_id, VIEW))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tasks.delete_task(db, open_task(db, user.id, task_id, VIEW))
    db.commit()




# --- time tracking -----------------------------------------------------------


@router.get("/tasks/{task_id}/time", response_model=s.TaskTimeOut)
def task_time(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return timetracking.task_time(db, open_task(db, user.id, task_id, VIEW))


@router.post("/tasks/{task_id}/time", response_model=s.TimeEntryOut, status_code=status.HTTP_201_CREATED)
def log_time(
    task_id: uuid.UUID, data: s.TimeEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    entry = timetracking.add_entry(db, open_task(db, user.id, task_id, VIEW), data)
    db.commit()
    return timetracking.entry_out_db(db, entry)


@router.post("/tasks/{task_id}/timer", response_model=s.TimeEntryOut, status_code=status.HTTP_201_CREATED)
def start_timer(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    entry = timetracking.start_timer(db, open_task(db, user.id, task_id, VIEW))
    db.commit()
    return timetracking.entry_out(entry, user)


@router.get("/timer", response_model=Optional[s.RunningTimerOut])
def running_timer(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return timetracking.current_timer(db, user)


@router.post("/timer/stop", response_model=s.TimeEntryOut)
def stop_timer(user: User = Depends(current_user), db: Session = Depends(get_db)):
    entry = timetracking.stop_timer(db, user.id)
    db.commit()
    return timetracking.entry_out(entry, user)


@router.patch("/time/{entry_id}", response_model=s.TimeEntryOut)
def update_time(
    entry_id: uuid.UUID, data: s.TimeEntryUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    entry = timetracking.update_entry(db, user.id, entry_id, data)
    db.commit()
    return timetracking.entry_out_db(db, entry)


@router.delete("/time/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_time(entry_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    timetracking.delete_entry(db, user.id, entry_id)
    db.commit()
