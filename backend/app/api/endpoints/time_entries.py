from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.api.deps import get_current_user
from app.models.time_entry import TimeEntryCreate, TimeEntryUpdate, TimeEntryResponse
from app.services import time_service

router = APIRouter()

@router.get("/", response_model=List[TimeEntryResponse])
def get_all_time_entries(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("uid")
    return time_service.get_all_time_entries(user_id)

@router.get("/task/{task_id}", response_model=List[TimeEntryResponse])
def get_time_entries(task_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("uid")
    return time_service.get_time_entries_for_task(user_id, task_id)

@router.post("/", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
def create_time_entry(entry_in: TimeEntryCreate, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("uid")
    try:
        return time_service.create_time_entry(user_id, entry_in)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{entry_id}", response_model=TimeEntryResponse)
def update_time_entry(entry_id: str, entry_in: TimeEntryUpdate, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("uid")
    updated = time_service.update_time_entry(user_id, entry_id, entry_in)
    if not updated:
        raise HTTPException(status_code=404, detail="Time entry not found or unauthorized")
    return updated

@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_time_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("uid")
    success = time_service.delete_time_entry(user_id, entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Time entry not found")
