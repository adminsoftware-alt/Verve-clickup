from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.firebase import init_firebase
from app.api import api_router
from app.api.v2 import api_router as api_v2_router
from app.api.v2.deps import work_error_handler
from app.services.work.errors import WorkError
from contextlib import asynccontextmanager
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Firebase on startup
    init_firebase()
    # Scheduled Dashboard email reports
    from app.services.work.dashboards import reports

    reports.start_scheduler()
    yield
    reports.stop_scheduler()

app = FastAPI(
    title="Timetriq API",
    description="Backend API for the Timetriq Work Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# Set up CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
allowed_origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include main API router
app.include_router(api_router, prefix="/api/v1")

# v2: Postgres-backed work hierarchy (spaces, folders, lists, tasks)
app.include_router(api_v2_router, prefix="/api/v2")
app.add_exception_handler(WorkError, work_error_handler)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Timetriq API"}

