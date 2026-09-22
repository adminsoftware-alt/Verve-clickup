import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.deps import get_current_user

# Mock the current user dependency
def override_get_current_user():
    return {"uid": "test_user_123", "email": "test@example.com"}

app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "Timetriq API"}

def test_get_users():
    response = client.get("/api/v1/users/")
    assert response.status_code in [200, 404]

def test_create_and_get_task():
    task_data = {
        "title": "Test Task",
        "description": "This is a test task",
        "estimatedHours": 5,
        "priority": "High",
        "projectId": "proj_123",
        "assignedUserId": "user_123",
        "startDate": "2026-07-21",
        "dueDate": "2026-07-25"
    }
    create_resp = client.post("/api/v1/tasks/", json=task_data)
    
    assert create_resp.status_code in [200, 201], f"Failed to create task: {create_resp.text}"
    
    task_id = create_resp.json().get("id")
    assert task_id is not None
    
    get_resp = client.get(f"/api/v1/tasks/{task_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["title"] == "Test Task"

def test_create_time_entry():
    task_data = {
        "title": "Task for time entry",
        "estimatedHours": 2,
        "projectId": "proj_123",
        "assignedUserId": "user_123",
        "startDate": "2026-07-21",
        "dueDate": "2026-07-25"
    }
    task_resp = client.post("/api/v1/tasks/", json=task_data)
    assert task_resp.status_code in [200, 201]
    task_id = task_resp.json().get("id")
    
    time_entry_data = {
        "task_id": task_id,
        "date": "2026-07-21",
        "hours_worked": 2.5,
        "notes": "Did some work"
    }
    te_resp = client.post("/api/v1/time-entries/", json=time_entry_data)
    assert te_resp.status_code in [200, 201], f"Failed to create time entry: {te_resp.text}"
    
    te_id = te_resp.json().get("id")
    
    list_resp = client.get("/api/v1/time-entries/")
    assert list_resp.status_code == 200
    assert any(te["id"] == te_id for te in list_resp.json())

def test_completed_task_validation():
    # 1. Try to create a task as Completed with 0 actual hours (should fail)
    task_data = {
        "title": "Invalid Completed Task",
        "estimatedHours": 2,
        "projectId": "proj_123",
        "assignedUserId": "user_123",
        "startDate": "2026-07-21",
        "dueDate": "2026-07-25",
        "status": "Completed",
        "actualHours": 0.0
    }
    create_resp = client.post("/api/v1/tasks/", json=task_data)
    assert create_resp.status_code == 400
    assert "Cannot mark task as Completed without logging hours first" in create_resp.json().get("detail", "")

    # 2. Create a valid task in Todo status
    task_data["status"] = "Todo"
    create_ok = client.post("/api/v1/tasks/", json=task_data)
    assert create_ok.status_code in [200, 201]
    task = create_ok.json()
    task_id = task.get("id")

    # 3. Try to update status to Completed with 0 actual hours (should fail)
    update_data = {
        "status": "Completed"
    }
    update_fail = client.put(f"/api/v1/tasks/{task_id}", json=update_data)
    assert update_fail.status_code == 400
    assert "Cannot mark task as Completed without logging hours first" in update_fail.json().get("detail", "")

    # 4. Update status to Completed with actualHours > 0 (should succeed)
    update_data_ok = {
        "status": "Completed",
        "actualHours": 3.5
    }
    update_succeed = client.put(f"/api/v1/tasks/{task_id}", json=update_data_ok)
    assert update_succeed.status_code == 200
    assert update_succeed.json()["status"] == "Completed"
    assert update_succeed.json()["actualHours"] == 3.5

def test_assignee_task_access_and_time_logging():
    # Manager creates a task assigned to employee 'assigned_user_999'
    manager_task_data = {
        "title": "Manager Assigned Task",
        "description": "Task for employee to work on",
        "estimatedHours": 8,
        "priority": "High",
        "projectId": "proj_123",
        "assignedUserId": "assigned_user_999",
        "startDate": "2026-07-21",
        "dueDate": "2026-07-25"
    }
    create_resp = client.post("/api/v1/tasks/", json=manager_task_data)
    assert create_resp.status_code in [200, 201]
    task_id = create_resp.json()["id"]

    # Switch user to assigned_user_999
    def override_assigned_user():
        return {"uid": "assigned_user_999", "email": "employee@example.com"}
    app.dependency_overrides[get_current_user] = override_assigned_user

    try:
        # Assigned employee should be able to view this task
        get_resp = client.get(f"/api/v1/tasks/{task_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == task_id
        assert get_resp.json()["assignedUserId"] == "assigned_user_999"

        # Assigned employee should appear in get_tasks
        list_resp = client.get("/api/v1/tasks/")
        assert list_resp.status_code == 200
        assert any(t["id"] == task_id for t in list_resp.json())

        # Assigned employee should be able to log time on this task
        te_data = {
            "task_id": task_id,
            "date": "2026-07-22",
            "hours_worked": 3.0,
            "notes": "Worked 3 hours on manager task"
        }
        te_resp = client.post("/api/v1/time-entries/", json=te_data)
        assert te_resp.status_code in [200, 201], f"Assignee failed to log time: {te_resp.text}"
        te_id = te_resp.json()["id"]

        # Assigned employee should be able to update their time entry
        te_update = {"hours_worked": 4.5, "notes": "Updated to 4.5 hours"}
        te_put_resp = client.put(f"/api/v1/time-entries/{te_id}", json=te_update)
        assert te_put_resp.status_code == 200
        assert te_put_resp.json()["hours_worked"] == 4.5
    finally:
        # Restore default test user
        app.dependency_overrides[get_current_user] = override_get_current_user

