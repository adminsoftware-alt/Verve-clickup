from typing import List, Optional
from datetime import datetime, timezone
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore import Client
from app.models.task import TaskCreate, TaskUpdate, TaskInDB
import app.core.firebase as firebase

def _get_db() -> Client:
    if not firebase.db:
        firebase.init_firebase()
    assert firebase.db is not None, "Firestore client not initialized"
    return firebase.db

def create_task(user_id: str, task_in: TaskCreate) -> TaskInDB:
    db = _get_db()
    doc_ref = db.collection('tasks').document()
    
    if task_in.status == 'Completed' and task_in.actualHours <= 0:
        raise ValueError("Cannot mark task as Completed without logging hours first.")
        
    task_data = task_in.model_dump()
    # Convert dates to ISO strings for Firestore storage
    if 'startDate' in task_data:
        task_data['startDate'] = task_data['startDate'].isoformat()
    if 'dueDate' in task_data:
        task_data['dueDate'] = task_data['dueDate'].isoformat()

    now = datetime.now(timezone.utc)
    task = TaskInDB(
        id=doc_ref.id,
        userId=user_id,
        createdAt=now,
        updatedAt=now,
        isArchived=False,
        **task_data
    )
    
    db_payload = task.model_dump()
    db_payload['startDate'] = str(db_payload['startDate'])
    db_payload['dueDate'] = str(db_payload['dueDate'])
    if db_payload.get('completedDate'):
        db_payload['completedDate'] = str(db_payload['completedDate'])
    
    doc_ref.set(db_payload)

    # ─── Generate Notifications ───
    # For every assigned user (except the creator), create a notification
    assignees_list = task_data.get('assignees') or []
    primary_assignee = task_data.get('assignedUserId')
    if primary_assignee and primary_assignee not in assignees_list:
        assignees_list.append(primary_assignee)
    
    for assignee_id in assignees_list:
        if assignee_id and assignee_id != user_id and assignee_id != 'self' and assignee_id != 'myself':
            notif_ref = db.collection("notifications").document()
            notif_ref.set({
                "id": notif_ref.id,
                "userId": assignee_id,
                "title": "New Task Assigned",
                "message": f"You were assigned to: {task.title}",
                "type": "TaskAssigned",
                "entityType": "Task",
                "entityId": task.id,
                "triggeredBy": user_id,
                "isRead": False,
                "createdAt": now
            })

    return task

def get_tasks(user_id: str, is_admin: bool = False) -> List[TaskInDB]:
    db = _get_db()
    if is_admin:
        docs = db.collection('tasks').where(filter=FieldFilter('isArchived', '==', False)).stream()
        tasks = []
        for doc in docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            tasks.append(TaskInDB.model_validate(data))
        return tasks

    # Retrieve tasks created by user, directly assigned to user, or where user is in assignees
    tasks_dict = {}
    
    # 1. Created by user
    for doc in db.collection('tasks').where(filter=FieldFilter('userId', '==', user_id)).where(filter=FieldFilter('isArchived', '==', False)).stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        tasks_dict[doc.id] = TaskInDB.model_validate(data)

    # 2. Assigned to user (assignedUserId)
    for doc in db.collection('tasks').where(filter=FieldFilter('assignedUserId', '==', user_id)).where(filter=FieldFilter('isArchived', '==', False)).stream():
        if doc.id not in tasks_dict:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            tasks_dict[doc.id] = TaskInDB.model_validate(data)

    # 3. In assignees list
    for doc in db.collection('tasks').where(filter=FieldFilter('assignees', 'array_contains', user_id)).where(filter=FieldFilter('isArchived', '==', False)).stream():
        if doc.id not in tasks_dict:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            tasks_dict[doc.id] = TaskInDB.model_validate(data)

    return list(tasks_dict.values())

def get_task(user_id: str, task_id: str, is_admin: bool = False) -> Optional[TaskInDB]:
    db = _get_db()
    doc_ref = db.collection('tasks').document(task_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        assignees_list = data.get('assignees', [])
        primary_assignee = data.get('assignedUserId')
        is_owner = data.get('userId') == user_id
        is_assignee = user_id in assignees_list or user_id == primary_assignee
        
        if (is_owner or is_assignee or is_admin) and not data.get('isArchived', False):
            data["id"] = doc.id
            return TaskInDB.model_validate(data)
    return None

def update_task(user_id: str, task_id: str, task_update: TaskUpdate) -> Optional[TaskInDB]:
    db = _get_db()
    doc_ref = db.collection('tasks').document(task_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        assignees_list = data.get('assignees', [])
        primary_assignee = data.get('assignedUserId')
        
        is_owner = data.get('userId') == user_id
        is_assignee = user_id in assignees_list or user_id == primary_assignee
        
        if (is_owner or is_assignee) and not data.get('isArchived', False):
            update_data = task_update.model_dump(exclude_unset=True)
            
            # Check status change for completedDate and validate actual hours
            if update_data.get('status') == 'Completed':
                actual_hours = float(update_data.get('actualHours') or data.get('actualHours') or 0.0)
                if actual_hours <= 0:
                    raise ValueError("Cannot mark task as Completed without logging hours first.")
                
                if data.get('status') != 'Completed':
                    update_data['completedDate'] = str(datetime.now(timezone.utc).date())
                
            # Format dates
            if 'startDate' in update_data:
                update_data['startDate'] = str(update_data['startDate'])
            if 'dueDate' in update_data:
                update_data['dueDate'] = str(update_data['dueDate'])
            if 'completedDate' in update_data and update_data['completedDate'] is not None and not isinstance(update_data['completedDate'], str):
                update_data['completedDate'] = str(update_data['completedDate'])
                
            update_data['updatedAt'] = datetime.now(timezone.utc)
            
            doc_ref.update(update_data)
            
            # ─── Generate Notification for Manager on Status Change ───
            if 'status' in update_data and update_data['status'] != data.get('status'):
                # Notify the creator if the person updating is not the creator
                creator_uid = data.get('userId')
                if creator_uid and creator_uid != user_id:
                    notif_ref = db.collection("notifications").document()
                    notif_ref.set({
                        "id": notif_ref.id,
                        "userId": creator_uid,
                        "title": "Task Status Updated",
                        "message": f"Status changed to {update_data['status']} on '{data.get('title')}'",
                        "type": "StatusUpdated",
                        "entityType": "Task",
                        "entityId": task_id,
                        "triggeredBy": user_id,
                        "isRead": False,
                        "createdAt": datetime.now(timezone.utc)
                    })
            
            # Fetch updated
            updated_doc = doc_ref.get()
            updated_data = updated_doc.to_dict() or {}
            updated_data["id"] = updated_doc.id
            return TaskInDB.model_validate(updated_data)
            
    return None

def delete_task(user_id: str, task_id: str, is_admin: bool = False) -> bool:
    db = _get_db()
    doc_ref = db.collection('tasks').document(task_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        is_owner = data.get('userId') == user_id
        if (is_owner or is_admin) and not data.get('isArchived', False):
            # Soft delete
            doc_ref.update({
                'isArchived': True,
                'updatedAt': datetime.now(timezone.utc)
            })
            return True
    return False

def toggle_task_star(user_id: str, task_id: str) -> Optional[TaskInDB]:
    db = _get_db()
    doc_ref = db.collection('tasks').document(task_id)
    doc = doc_ref.get()
    
    if doc.exists:
        data = doc.to_dict() or {}
        assignees_list = data.get('assignees', [])
        primary_assignee = data.get('assignedUserId')
        is_owner = data.get('userId') == user_id
        is_assignee = user_id in assignees_list or user_id == primary_assignee
        
        if (is_owner or is_assignee) and not data.get('isArchived', False):
            current_starred = data.get('isStarred', False)
            doc_ref.update({
                'isStarred': not current_starred,
                'updatedAt': datetime.now(timezone.utc)
            })
            updated_doc = doc_ref.get()
            updated_data = updated_doc.to_dict() or {}
            updated_data['id'] = doc_ref.id
            return TaskInDB.model_validate(updated_data)
    return None
