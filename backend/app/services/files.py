"""Where uploaded files (profile photos, Space pictures, task and comment attachments) are kept.

With SUPABASE_URL and SUPABASE_SECRET_KEY set, files go to a private Supabase Storage bucket.
The server's own disk is not an option in production: Render's free plan empties it on every
restart and deploy, so anything saved there would vanish. Without those settings (tests, local
development) files stay under UPLOAD_DIR as before.

Files are always served through the API, never straight from the bucket, so attachments keep
their permission checks and the URLs the app already uses stay the same.
"""

from pathlib import Path
from typing import Optional

import httpx

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]

# Each kind of file has its own folder. Attachments sit at the top of UPLOAD_DIR on disk, as
# they always have, so files saved before this module existed are still found.
AVATARS, SPACE_ICONS, ATTACHMENTS = "avatars", "space-icons", "attachments"
_ON_DISK = {AVATARS: "avatars", SPACE_ICONS: "space-icons", ATTACHMENTS: ""}

_client: Optional[httpx.Client] = None


class StorageError(Exception):
    """The file store could not be reached or refused the request."""


def remote() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SECRET_KEY)


def _http() -> httpx.Client:
    # One client for the whole process, so its connections to Supabase are kept open and reused.
    global _client
    if _client is None:
        key = settings.SUPABASE_SECRET_KEY
        _client = httpx.Client(
            base_url=settings.SUPABASE_URL.rstrip("/") + "/storage/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(30.0, connect=10.0),
        )
    return _client


def _object(folder: str, key: str) -> str:
    return f"/object/{settings.STORAGE_BUCKET}/{folder}/{key}"


def _disk_path(folder: str, key: str) -> Path:
    root = Path(settings.UPLOAD_DIR)
    root = root if root.is_absolute() else BACKEND_DIR / root
    path = root / _ON_DISK[folder]
    path.mkdir(parents=True, exist_ok=True)
    return path / key


def put(folder: str, key: str, data: bytes, content_type: str) -> None:
    if not remote():
        _disk_path(folder, key).write_bytes(data)
        return
    try:
        res = _http().post(_object(folder, key), content=data, headers={"Content-Type": content_type, "x-upsert": "true"})
    except httpx.HTTPError as e:
        raise StorageError(f"Could not reach file storage: {e}") from e
    if res.status_code >= 300:
        raise StorageError(f"File storage refused the upload ({res.status_code}): {res.text[:200]}")


def get(folder: str, key: str) -> Optional[bytes]:
    """The file's bytes, or None when there is no such file."""
    if not remote():
        path = _disk_path(folder, key)
        return path.read_bytes() if path.is_file() else None
    try:
        res = _http().get(_object(folder, key))
    except httpx.HTTPError as e:
        raise StorageError(f"Could not reach file storage: {e}") from e
    # Supabase answers a missing object with 400 or 404, depending on the version.
    if res.status_code in (400, 404):
        return None
    if res.status_code >= 300:
        raise StorageError(f"File storage refused the download ({res.status_code})")
    return res.content


def remove(folder: str, key: str) -> None:
    """Delete a file if it is there. Failing to delete only leaves a stray file, so it never raises."""
    if not remote():
        _disk_path(folder, key).unlink(missing_ok=True)
        return
    try:
        _http().delete(_object(folder, key))
    except httpx.HTTPError:
        pass


def ensure_bucket() -> None:
    """Create the private bucket if it does not exist yet (run once when setting up storage)."""
    res = _http().post("/bucket", json={"id": settings.STORAGE_BUCKET, "name": settings.STORAGE_BUCKET, "public": False})
    if res.status_code >= 300 and "already exists" not in res.text.lower() and res.status_code != 409:
        raise StorageError(f"Could not create the bucket ({res.status_code}): {res.text[:200]}")
