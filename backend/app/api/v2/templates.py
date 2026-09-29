import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import TemplateKind, User
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import templates

router = APIRouter()


def _save_route(path: str, kind: TemplateKind) -> None:
    @router.post(f"{path}/save-template", response_model=s.TemplateOut, status_code=status.HTTP_201_CREATED)
    def save_template(obj_id: uuid.UUID, data: s.TemplateSave, user: User = Depends(current_user), db: Session = Depends(get_db)):
        template = templates.save(db, user.id, kind, obj_id, data)
        db.commit()
        return templates.template_out(template)


_save_route("/tasks/{obj_id}", TemplateKind.task)
_save_route("/lists/{obj_id}", TemplateKind.list)
_save_route("/folders/{obj_id}", TemplateKind.folder)
_save_route("/spaces/{obj_id}", TemplateKind.space)


@router.get("/workspaces/{workspace_id}/templates", response_model=List[s.TemplateOut])
def list_templates(
    workspace_id: uuid.UUID,
    kind: Optional[TemplateKind] = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return [templates.template_out(t) for t in templates.list_templates(db, user.id, workspace_id, kind)]


@router.patch("/templates/{template_id}", response_model=s.TemplateOut)
def update_template(template_id: uuid.UUID, data: s.TemplateUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    template = templates.update(db, user.id, template_id, data)
    db.commit()
    return templates.template_out(template)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    templates.delete(db, user.id, template_id)
    db.commit()


@router.post("/templates/{template_id}/apply", response_model=s.TemplateApplied, status_code=status.HTTP_201_CREATED)
def apply_template(template_id: uuid.UUID, data: s.TemplateApply, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = templates.apply(db, user.id, template_id, data)
    db.commit()
    return result
