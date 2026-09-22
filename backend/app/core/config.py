from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Timetriq"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Firebase configuration will go here
    FIREBASE_CREDENTIALS_PATH: Optional[str] = None

    # PostgreSQL, used by the v2 work hierarchy. Optional so v1 still boots without it.
    DATABASE_URL: Optional[str] = None

    # Scheduled Dashboard email reports. Without SMTP_HOST, reports are still built
    # and kept for preview, but not sent.
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_STARTTLS: bool = True
    # Where links in report emails point.
    APP_URL: str = "http://localhost:5173"
    # Task attachments are stored here (relative to the backend folder unless absolute).
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_MB: int = 25
    # Checks for due reports once a minute while the API runs.
    REPORTS_SCHEDULER_ENABLED: bool = True
    
    class Config:
        env_file = ".env"

settings = Settings()
