import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from google.cloud.firestore import Client
import app.core.firebase as firebase
from app.models.organization import (
    OrganizationSettings, AuditLog
)
from app.models.user import UserInDB, UserUpdate


def _get_db() -> Client:
    if not firebase.db:
        firebase.init_firebase()
    assert firebase.db is not None, "Firestore client not initialized"
    return firebase.db


# Whether a user is switched off, remembered for a minute: asking Firestore on every request
# added a network round trip to each one. Changes made through this service apply at once.
_DISABLED_TTL_SECONDS = 60
_disabled: Dict[str, tuple] = {}


class AdminService:
    def is_disabled(self, uid: str) -> bool:
        cached = _disabled.get(uid)
        if cached is not None and cached[0] > time.monotonic():
            return cached[1]
        user = self.get_user(uid)
        answer = bool(user and getattr(user, "disabled", False))
        _disabled[uid] = (time.monotonic() + _DISABLED_TTL_SECONDS, answer)
        return answer

    def _log_audit(
        self,
        action: str,
        performed_by: str,
        resource: str,
        old_value: Optional[Dict[str, Any]] = None,
        new_value: Optional[Dict[str, Any]] = None,
    ):
        db = _get_db()
        log = AuditLog(
            id=str(uuid.uuid4()),
            action=action,
            performed_by=performed_by,
            affected_resource=resource,
            old_value=old_value,
            new_value=new_value,
        )
        db.collection("auditLogs").document(log.id).set(log.model_dump())

    def get_organization_settings(self) -> OrganizationSettings:
        db = _get_db()
        doc = db.collection("organizationSettings").document("default").get()
        if doc.exists:
            return OrganizationSettings(**doc.to_dict())  # type: ignore[arg-type]
        return OrganizationSettings()

    def update_organization_settings(
        self, settings: OrganizationSettings, user_id: str
    ) -> OrganizationSettings:
        db = _get_db()
        old_settings = self.get_organization_settings()
        db.collection("organizationSettings").document("default").set(
            settings.model_dump()
        )
        self._log_audit(
            "UPDATE_ORG_SETTINGS",
            user_id,
            "organization",
            old_settings.model_dump(),
            settings.model_dump(),
        )
        return settings

    def get_all_users(self) -> List[UserInDB]:
        db = _get_db()
        users = []
        for doc in db.collection("users").stream():
            data = doc.to_dict() or {}
            data["uid"] = doc.id
            users.append(UserInDB(**data))
        return users

    def get_user(self, uid: str) -> Optional[UserInDB]:
        db = _get_db()
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            data = doc.to_dict() or {}
            data["uid"] = doc.id
            return UserInDB(**data)
        return None

    def create_user(self, user: UserInDB, admin_id: str) -> UserInDB:
        db = _get_db()
        db.collection("users").document(user.uid).set(user.model_dump())
        _disabled.pop(user.uid, None)
        self._log_audit("CREATE_USER", admin_id, f"user/{user.uid}", None, user.model_dump())
        return user

    def update_user(self, uid: str, updates: UserUpdate, admin_id: str) -> UserInDB:
        db = _get_db()
        doc = db.collection("users").document(uid).get()
        if not doc.exists:
            raise Exception("User not found")

        old_user = doc.to_dict() or {}
        update_data = updates.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        db.collection("users").document(uid).update(update_data)
        _disabled.pop(uid, None)
        self._log_audit("UPDATE_USER", admin_id, f"user/{uid}", old_user, update_data)

        updated_doc = db.collection("users").document(uid).get()
        data = updated_doc.to_dict() or {}
        data["uid"] = updated_doc.id
        return UserInDB(**data)

    def get_audit_logs(self, limit: int = 100) -> List[AuditLog]:
        db = _get_db()
        logs = []
        logs_docs = (
            db.collection("auditLogs")
            .order_by("timestamp", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        for doc in logs_docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            logs.append(AuditLog(**data))
        return logs


admin_service = AdminService()
