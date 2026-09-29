from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.core.firebase import verify_token

security = HTTPBearer()

DEV_PREFIX = "dev:"


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Dependency to verify the Firebase JWT token and extract user details.
    """
    token = credentials.credentials
    # Local testing: "dev:<user id>" signs you in as that person, but only where DEV_LOGIN is on.
    if settings.DEV_LOGIN and token.startswith(DEV_PREFIX):
        uid = token[len(DEV_PREFIX):].strip()
        if not uid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pick someone to sign in as")
        return {"uid": uid, "dev": True}
    decoded_token = verify_token(token)
    
    if not decoded_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    uid = decoded_token.get("uid")
    if uid:
        from app.services.admin_service import admin_service
        user_db = admin_service.get_user(uid)
        if user_db and getattr(user_db, "disabled", False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled",
            )
            
    return decoded_token

def get_current_admin_user(current_user: dict = Depends(get_current_user)):
    """
    Dependency to verify the current user has the Admin role.
    """
    from app.services.admin_service import admin_service
    user_db = admin_service.get_user(current_user.get("uid"))
    
    if not user_db or user_db.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have Admin privileges",
        )
        
    return current_user
