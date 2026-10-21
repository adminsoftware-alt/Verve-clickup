from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Verve Workflow"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Firebase configuration will go here
    FIREBASE_CREDENTIALS_PATH: Optional[str] = None

    # PostgreSQL, used by the v2 work hierarchy. Optional so v1 still boots without it.
    DATABASE_URL: Optional[str] = None
    # Where the v2 tests run (they empty every table). Set it whenever DATABASE_URL is a shared
    # database such as Supabase, so the tests stay on a local server.
    TEST_DATABASE_URL: Optional[str] = None

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
    # Local testing only: accept "Bearer dev:<user id>" and let the login screen list the people
    # to sign in as, so roles can be tried without a Google account each. Never switch this on
    # anywhere real -- it is a way past sign-in by design.
    DEV_LOGIN: bool = False

    # Task attachments are stored here (relative to the backend folder unless absolute).
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_MB: int = 25
    # Checks for due reports once a minute while the API runs.
    REPORTS_SCHEDULER_ENABLED: bool = True
    # Email that goes out on a timer rather than because somebody did something: the daily,
    # weekly and monthly digests, the Friday recap, the overdue chase, the manager's Monday
    # heads-up, the team digest, and the weekly timesheet nudge.
    #
    # Off. Seventy-five people receiving a summary none of them asked for is how a firm learns
    # to filter mail from its own tools, and then misses the one message that mattered. Nothing
    # is deleted: every one of those jobs still works and is still covered by its tests. This is
    # the switch that decides whether anything calls them.
    SCHEDULED_EMAIL_ENABLED: bool = False
    # The manager's "things waiting for your decision", each weekday morning. Its own switch
    # because it is the only scheduled mail that unblocks somebody else's work instead of
    # reporting on it.
    APPROVAL_REMINDER_EMAIL: bool = False
    # Email for anything other than an invitation.
    #
    # Off: the firm wants email used to get new people into the workspace and for nothing else.
    # Notifications still reach people -- in the app, and as browser push -- they just do not also
    # arrive as mail. Invitations, and chasing an invitation nobody accepted, are unaffected.
    UPDATE_EMAIL_ENABLED: bool = False
    # A task someone types in must carry an assignee, start and due dates, an estimate and a
    # priority. Tasks the system creates (templates, recurrences, imports, email) are exempt.
    REQUIRE_TASK_DETAILS: bool = True
    # Web Push (installed app / browser notifications). Generated into VAPID_FILE on first use if not set.
    VAPID_PUBLIC_KEY: Optional[str] = None
    VAPID_PRIVATE_KEY: Optional[str] = None
    VAPID_FILE: str = ".vapid.json"
    VAPID_SUBJECT: str = "mailto:admin@verveadvisory.com"
    # WhatsApp Business Cloud API. Messages use an approved template with one text parameter.
    WHATSAPP_TOKEN: Optional[str] = None
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    WHATSAPP_TEMPLATE: str = "timetriq_update"
    WHATSAPP_LANGUAGE: str = "en"
    WHATSAPP_API: str = "https://graph.facebook.com/v20.0"
    # Email-to-List: each List gets <local>+<token>@<domain> from this address. Mail is read from
    # the IMAP mailbox (polled every minute) or posted to /api/v2/inbound-email with the secret.
    INBOUND_EMAIL_ADDRESS: Optional[str] = None
    INBOUND_EMAIL_SECRET: Optional[str] = None
    IMAP_HOST: Optional[str] = None
    IMAP_PORT: int = 993
    IMAP_USER: Optional[str] = None
    IMAP_PASSWORD: Optional[str] = None
    IMAP_FOLDER: str = "INBOX"
    # Two-way calendar sync. Each provider is offered once its OAuth app is set here; OAUTH_REDIRECT_BASE is
    # this API's public address (the callback is <base>/api/v2/calendar-oauth/<provider>/callback).
    GOOGLE_OAUTH_CLIENT_ID: Optional[str] = None
    GOOGLE_OAUTH_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_OAUTH_CLIENT_ID: Optional[str] = None
    MICROSOFT_OAUTH_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_OAUTH_TENANT: str = "common"
    OAUTH_REDIRECT_BASE: str = "http://localhost:8000"
    # Encrypts stored calendar tokens (any long random string). Without it, a key is derived from the OAuth secrets.
    CALENDAR_TOKEN_KEY: Optional[str] = None
    # The assistant's AI fallback (services/work/ai_assistant.py): any OpenAI-compatible chat API.
    # Without AI_API_KEY the assistant keeps to its phrase rules.
    AI_BASE_URL: str = "https://openrouter.ai/api/v1"
    AI_MODEL: Optional[str] = None
    AI_API_KEY: Optional[str] = None
    
    class Config:
        env_file = ".env"

settings = Settings()
