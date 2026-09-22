from typing import List, Optional, Any
from datetime import datetime, timezone
from app.models.time_entry import TimeEntryCreate, TimeEntryUpdate, TimeEntryInDB
from app.services.task_service import get_task
import app.core.firebase as firebase
from firebase_admin import firestore
from google.cloud.firestore import Increment, Client
from google.cloud.firestore_v1.base_query import FieldFilter

def _get_db() -> Client:
    if not firebase.db:
        firebase.init_firebase()
    assert firebase.db is not None
    return firebase.db

def create_time_entry(user_id: str, entry_in: TimeEntryCreate) -> TimeEntryInDB:
    # Business Rule: Ensure task exists and belongs to user
    task = get_task(user_id, entry_in.task_id)
    if not task:
        raise ValueError("Task not found or does not belong to user")

    db = _get_db()
    doc_ref = db.collection('timeEntries').document()
    
    entry_data = entry_in.model_dump()
    if 'date' in entry_data:
        entry_data['date'] = entry_data['date'].isoformat()
        
    entry = TimeEntryInDB(
        id=doc_ref.id,
        owner_id=user_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        **entry_data
    )
    
    db_payload = entry.model_dump()
    db_payload['date'] = str(db_payload['date'])
    
    doc_ref.set(db_payload)
    
    # Update actualHours on parent task, and check if it should auto-complete
    new_actual_hours = task.actualHours + entry_in.hours_worked
    updates: dict[str, Any] = {
        'actualHours': Increment(entry_in.hours_worked)
    }
    
    if task.estimatedHours > 0 and new_actual_hours >= task.estimatedHours and task.status != 'Completed':
        updates['status'] = 'Completed'
        updates['completedDate'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        
    task_ref = db.collection('tasks').document(task.id)
    task_ref.update(updates)

    # ─── Generate Notification for Manager ───
    if getattr(task, 'assignedByUid', None) and task.assignedByUid != user_id:
        notif_ref = db.collection("notifications").document()
        msg = f"Time logged: {entry_in.hours_worked}h on '{task.title}'."
        if 'status' in updates and updates['status'] == 'Completed':
            msg = f"Task Completed! {entry_in.hours_worked}h logged on '{task.title}'."
            
        notif_ref.set({
            "id": notif_ref.id,
            "userId": task.assignedByUid,
            "title": "Task Update",
            "message": msg,
            "type": "TimeLogged",
            "entityType": "Task",
            "entityId": task.id,
            "triggeredBy": user_id,
            "isRead": False,
            "createdAt": datetime.now(timezone.utc)
        })
    
    return entry

def get_time_entries_for_task(user_id: str, task_id: str) -> List[TimeEntryInDB]:
    db = _get_db()
    # Technically, tasks own time entries, but we query by task_id and owner_id for safety
    docs = db.collection('timeEntries').where(filter=FieldFilter('task_id', '==', task_id)).where(filter=FieldFilter('owner_id', '==', user_id)).stream()
    
    entries = []
    for doc in docs:
        doc_data = doc.to_dict() or {}
        doc_data["id"] = doc.id
        entries.append(TimeEntryInDB(**doc_data))
    return entries

def get_all_time_entries(user_id: str) -> List[TimeEntryInDB]:
    db = _get_db()
    docs = db.collection('timeEntries').where(filter=FieldFilter('owner_id', '==', user_id)).stream()
    
    entries = []
    for doc in docs:
        doc_data = doc.to_dict() or {}
        doc_data["id"] = doc.id
        entries.append(TimeEntryInDB(**doc_data))
    return entries

def delete_time_entry(user_id: str, entry_id: str) -> bool:
    db = _get_db()
    doc_ref = db.collection('timeEntries').document(entry_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        if data.get('owner_id') == user_id:
            task_id = data.get('task_id')
            hours_worked = data.get('hours_worked', 0)
            
            # Hard delete for time entries or could be soft delete. We'll hard delete.
            doc_ref.delete()
            
            # Decrement actualHours on parent task
            if task_id:
                task_ref = db.collection('tasks').document(task_id)
                task_ref.update({
                    'actualHours': Increment(-hours_worked)
                })
                
            return True
    return False

def update_time_entry(user_id: str, entry_id: str, entry_in: TimeEntryUpdate) -> Optional[TimeEntryInDB]:
    db = _get_db()
    doc_ref = db.collection('timeEntries').document(entry_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        if data.get('owner_id') == user_id:
            task_id = data.get('task_id')
            old_hours = data.get('hours_worked', 0.0)
            
            update_data = entry_in.model_dump(exclude_unset=True)
            if 'date' in update_data and update_data['date'] is not None:
                update_data['date'] = str(update_data['date'])
                
            update_data['updated_at'] = datetime.now(timezone.utc)
            
            # If hours changed, adjust actualHours on parent task
            if 'hours_worked' in update_data and task_id:
                diff = update_data['hours_worked'] - old_hours
                if diff != 0:
                    task_ref = db.collection('tasks').document(task_id)
                    task_ref.update({'actualHours': Increment(diff)})
                    
            doc_ref.update(update_data)
            updated_doc = doc_ref.get()
            updated_data = updated_doc.to_dict() or {}
            updated_data['id'] = doc_ref.id
            return TimeEntryInDB(**updated_data)
    return None

def get_actual_hours_for_task(user_id: str, task_id: str) -> float:
    entries = get_time_entries_for_task(user_id, task_id)
    return sum(e.hours_worked for e in entries)
