from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.api.deps import get_current_user
from app.models.task import TaskCreate, TaskUpdate, TaskResponse
from app.services import task_service
from app.services.notification_service import send_push_notification
import asyncio

router = APIRouter()

@router.get("/", response_model=List[TaskResponse])
def get_tasks(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    from app.services.admin_service import admin_service
    user_db = admin_service.get_user(user_id)
    is_admin = bool(user_db and user_db.role == "Admin")
    return task_service.get_tasks(user_id, is_admin=is_admin)

@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(task_in: TaskCreate, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    try:
        created_task = task_service.create_task(user_id, task_in)
        # Send push notification asynchronously (or fire-and-forget)
        try:
            # Running synchronous firebase call in a background thread or synchronously
            # For simplicity, we just call it synchronously here, but ideally should be background
            send_push_notification(
                user_id=user_id,
                title="New Task Created",
                body=f"Task '{created_task.title}' was added successfully.",
                data={"task_id": created_task.id}
            )
        except Exception as e:
            print(f"Failed to send notification: {e}")
        return created_task
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    from app.services.admin_service import admin_service
    user_db = admin_service.get_user(user_id)
    is_admin_or_mgr = bool(user_db and user_db.role in ["Admin", "Manager"])
    task = task_service.get_task(user_id, task_id, is_admin=is_admin_or_mgr)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.put("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, task_in: TaskUpdate, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    try:
        task = task_service.update_task(user_id, task_id, task_in)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Send update notification
        try:
            send_push_notification(
                user_id=user_id,
                title="Task Updated",
                body=f"Task '{task.title}' has been updated.",
                data={"task_id": task.id}
            )
        except Exception as e:
            print(f"Failed to send notification: {e}")
            
        return task
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    from app.services.admin_service import admin_service
    user_db = admin_service.get_user(user_id)
    is_admin = bool(user_db and user_db.role == "Admin")
    success = task_service.delete_task(user_id, task_id, is_admin=is_admin)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")

@router.post("/{task_id}/star", response_model=TaskResponse)
def toggle_task_star(task_id: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("uid", ""))
    task = task_service.toggle_task_star(user_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
