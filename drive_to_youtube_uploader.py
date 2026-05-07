#!/usr/bin/env python3
"""
Drive-to-YouTube Uploader — Multi-Client Edition
=================================================
Watches Google Drive folders for new video files per client defined in
config.json, generates SEO-optimised YouTube metadata via Gemini API,
downloads each video to /tmp, uploads to YouTube, and records Drive file
IDs in per-client state files to prevent duplicates.

Clients are configured in config.json only — no code changes needed.
Designed to run as a single systemd service handling all clients.
"""
from __future__ import annotations

import argparse
import functools
import json
import logging
import logging.handlers
import mimetypes
import os
import random
import re
import shutil
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import httplib2
    import requests as http_requests
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
except ModuleNotFoundError as exc:
    missing_dependency_error = exc
else:
    missing_dependency_error = None


LOGGER = logging.getLogger("drive_to_youtube")

DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
]

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
]

VIDEO_EXTENSIONS = {
    ".3g2",
    ".3gp",
    ".avi",
    ".flv",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".mts",
    ".webm",
    ".wmv",
}

RETRIABLE_HTTP_STATUS_CODES = {500, 502, 503, 504}
if missing_dependency_error is None:
    RETRIABLE_UPLOAD_EXCEPTIONS = (
        httplib2.HttpLib2Error,
        TimeoutError,
        OSError,
    )
else:
    RETRIABLE_UPLOAD_EXCEPTIONS = (TimeoutError, OSError)

STOP_REQUESTED = False


@dataclass(frozen=True)
class Config:
    drive_folder_id: str
    gemini_api_keys: tuple[str, ...]
    drive_credentials_file: Path
    youtube_credentials_file: Path
    drive_token_file: Path
    youtube_token_file: Path
    uploaded_log: Path
    poll_interval_seconds: int
    gemini_model: str
    gemini_timeout_seconds: int
    youtube_privacy_status: str
    youtube_category_id: str
    youtube_notify_subscribers: bool
    upload_chunk_size: int
    upload_max_retries: int
    oauth_port: int
    log_file: Path | None
    log_max_bytes: int
    log_backup_count: int
    api_max_retries: int
    # Multi-client fields (optional — single-client mode leaves these as defaults)
    client_name: str = "default"


# ── Multi-client config.json support ──────────────────────────────────────────

@dataclass
class ClientEntry:
    """One entry from the 'clients' list in config.json."""
    name: str
    drive_folder_id: str
    drive_credentials_file: Path
    youtube_credentials_file: Path
    drive_token_file: Path
    youtube_token_file: Path
    uploaded_log: Path
    log_file: Path


def load_client_config_json(config_path: Path) -> list[ClientEntry]:
    """Parse config.json and return a list of ClientEntry objects."""
    if not config_path.exists():
        return []
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    clients: list[ClientEntry] = []
    base = config_path.parent

    drive_config = raw.get("drive", {})
    def _p_drive(key: str, default: str) -> Path:
        v = drive_config.get(key, default)
        p = Path(v)
        return p if p.is_absolute() else base / p

    global_drive_creds = _p_drive("credentials_file", "credentials/sid.json")
    global_drive_token = _p_drive("token_file", "tokens/token_sid_drive.json")

    for item in raw.get("clients", []):
        def _p(key: str, default: str) -> Path:
            v = item.get(key, default)
            p = Path(v)
            return p if p.is_absolute() else base / p
        clients.append(ClientEntry(
            name=item["name"],
            drive_folder_id=item["drive_folder_id"],
            drive_credentials_file=global_drive_creds,
            drive_token_file=global_drive_token,
            youtube_credentials_file=_p("youtube_credentials_file", f"credentials/{item['name']}-youtube.json"),
            youtube_token_file=_p("youtube_token_file", f"tokens/token_{item['name']}_youtube.json"),
            uploaded_log=_p("state_file", f"state/uploaded_{item['name']}.txt"),
            log_file=_p("log_file", f"logs/{item['name']}-uploader.log"),
        ))
    return clients


def build_client_config(entry: ClientEntry, base_config: Config) -> Config:
    """Overlay a ClientEntry on top of a base Config (shared env settings)."""
    return Config(
        drive_folder_id=entry.drive_folder_id,
        gemini_api_keys=base_config.gemini_api_keys,
        drive_credentials_file=entry.drive_credentials_file,
        youtube_credentials_file=entry.youtube_credentials_file,
        drive_token_file=entry.drive_token_file,
        youtube_token_file=entry.youtube_token_file,
        uploaded_log=entry.uploaded_log,
        poll_interval_seconds=base_config.poll_interval_seconds,
        gemini_model=base_config.gemini_model,
        gemini_timeout_seconds=base_config.gemini_timeout_seconds,
        youtube_privacy_status=base_config.youtube_privacy_status,
        youtube_category_id=base_config.youtube_category_id,
        youtube_notify_subscribers=base_config.youtube_notify_subscribers,
        upload_chunk_size=base_config.upload_chunk_size,
        upload_max_retries=base_config.upload_max_retries,
        oauth_port=base_config.oauth_port,
        log_file=entry.log_file,
        log_max_bytes=base_config.log_max_bytes,
        log_backup_count=base_config.log_backup_count,
        api_max_retries=base_config.api_max_retries,
        client_name=entry.name,
    )


@dataclass(frozen=True)
class VideoMetadata:
    title: str
    description: str
    tags: list[str]


class ConfigError(RuntimeError):
    pass


def ensure_dependencies() -> None:
    if missing_dependency_error is not None:
        raise ConfigError(
            "Missing Python dependency. Run: "
            "venv/bin/pip install -r requirements.txt "
            f"(first missing module: {missing_dependency_error.name})"
        )


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def resolve_path(value: str | None, default: Path) -> Path:
    raw_path = Path(value).expanduser() if value else default
    if raw_path.is_absolute():
        return raw_path
    return script_dir() / raw_path


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, minimum: int | None = None) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if minimum is not None and parsed < minimum:
        raise ConfigError(f"{name} must be at least {minimum}")
    return parsed


def load_env_file(path: Path | None) -> None:
    if path is None:
        return
    if not path.exists():
        raise ConfigError(f"Environment file not found: {path}")

    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            raise ConfigError(f"Invalid env line {line_number} in {path}: missing '='")
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if not key:
            raise ConfigError(f"Invalid env line {line_number} in {path}: empty key")
        os.environ.setdefault(key, value)


def parse_gemini_api_keys() -> tuple[str, ...]:
    keys: list[str] = []

    combined_keys = os.getenv("GEMINI_API_KEYS", "").strip()
    if combined_keys:
        keys.extend(key.strip().strip("'\"") for key in re.split(r"[,\s]+", combined_keys) if key.strip())

    primary_key = os.getenv("GEMINI_API_KEY", "").strip()
    if primary_key:
        keys.append(primary_key)

    numbered_keys: list[tuple[int, str]] = []
    for name, value in os.environ.items():
        match = re.fullmatch(r"GEMINI_API_KEY_(\d+)", name)
        if match and value.strip():
            numbered_keys.append((int(match.group(1)), value.strip()))
    keys.extend(value for _, value in sorted(numbered_keys))

    deduped_keys: list[str] = []
    seen_keys: set[str] = set()
    for key in keys:
        if key not in seen_keys:
            deduped_keys.append(key)
            seen_keys.add(key)
    return tuple(deduped_keys)


def build_config(require_runtime_values: bool) -> Config:
    base = script_dir()
    drive_folder_id = os.getenv("DRIVE_FOLDER_ID", "").strip()
    gemini_api_keys = parse_gemini_api_keys()
    default_credentials_file = resolve_path(os.getenv("GOOGLE_CREDENTIALS_FILE"), base / "credentials.json")
    drive_credentials_file = resolve_path(
        os.getenv("DRIVE_CREDENTIALS_FILE") or os.getenv("GOOGLE_CREDENTIALS_FILE"),
        default_credentials_file,
    )
    youtube_credentials_file = resolve_path(
        os.getenv("YOUTUBE_CREDENTIALS_FILE") or os.getenv("GOOGLE_CREDENTIALS_FILE"),
        default_credentials_file,
    )
    drive_token_file = resolve_path(os.getenv("DRIVE_TOKEN_FILE"), base / "token-drive.json")
    youtube_token_file = resolve_path(os.getenv("YOUTUBE_TOKEN_FILE"), base / "token-youtube.json")
    uploaded_log = resolve_path(os.getenv("UPLOADED_LOG"), base / "uploaded.txt")

    if require_runtime_values and not drive_credentials_file.exists():
        raise ConfigError(f"Drive OAuth credentials file not found: {drive_credentials_file}")
    if require_runtime_values and not youtube_credentials_file.exists():
        raise ConfigError(f"YouTube OAuth credentials file not found: {youtube_credentials_file}")
    if require_runtime_values and not drive_folder_id:
        raise ConfigError("DRIVE_FOLDER_ID is required")
    if require_runtime_values and not gemini_api_keys:
        raise ConfigError("At least one Gemini API key is required")

    return Config(
        drive_folder_id=drive_folder_id,
        gemini_api_keys=gemini_api_keys,
        drive_credentials_file=drive_credentials_file,
        youtube_credentials_file=youtube_credentials_file,
        drive_token_file=drive_token_file,
        youtube_token_file=youtube_token_file,
        uploaded_log=uploaded_log,
        poll_interval_seconds=env_int("POLL_INTERVAL_SECONDS", 300, minimum=1),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash",
        gemini_timeout_seconds=env_int("GEMINI_TIMEOUT_SECONDS", 60, minimum=1),
        youtube_privacy_status=os.getenv("YOUTUBE_PRIVACY_STATUS", "public").strip() or "public",
        youtube_category_id=os.getenv("YOUTUBE_CATEGORY_ID", "22").strip() or "22",
        youtube_notify_subscribers=env_bool("YOUTUBE_NOTIFY_SUBSCRIBERS", True),
        upload_chunk_size=env_int("YOUTUBE_UPLOAD_CHUNK_SIZE", -1),
        upload_max_retries=env_int("YOUTUBE_UPLOAD_MAX_RETRIES", 5, minimum=0),
        oauth_port=env_int("OAUTH_LOCAL_SERVER_PORT", 0, minimum=0),
        log_file=resolve_path(os.getenv("LOG_FILE"), base / "nashik-pg-uploader.log") if os.getenv("LOG_FILE", "true").lower() not in {"false", "none", "0", ""} else None,
        log_max_bytes=env_int("LOG_MAX_BYTES", 5 * 1024 * 1024, minimum=0),
        log_backup_count=env_int("LOG_BACKUP_COUNT", 3, minimum=0),
        api_max_retries=env_int("API_MAX_RETRIES", 3, minimum=0),
    )


def setup_logging(level_name: str, log_file: Path | None = None,
                  max_bytes: int = 5_242_880, backup_count: int = 3) -> None:
    """Configure dual logging: stderr (for journald) + rotating file.

    Guards against duplicate handlers — safe to call multiple times.
    """
    level = getattr(logging, level_name.upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    root = logging.getLogger()
    root.setLevel(level)

    # Console handler — add only once
    has_console = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
        for h in root.handlers
    )
    if not has_console:
        console = logging.StreamHandler(sys.stderr)
        console.setFormatter(fmt)
        root.addHandler(console)

    # Rotating file handler — add only if this exact file not already attached
    if log_file is not None:
        log_file_str = str(log_file.resolve())
        already_has_file = any(
            isinstance(h, logging.FileHandler) and h.baseFilename == log_file_str
            for h in root.handlers
        )
        if not already_has_file:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            fh = logging.handlers.RotatingFileHandler(
                log_file_str, maxBytes=max_bytes, backupCount=backup_count,
                encoding="utf-8",
            )
            fh.setFormatter(fmt)
            root.addHandler(fh)
            LOGGER.info("Logging to file: %s (max %s bytes, %d backups)",
                        log_file, max_bytes, backup_count)


def retry_api_call(func=None, *, max_retries: int = 3,
                   retriable_codes: set[int] = frozenset({429, 500, 502, 503, 504}),
                   label: str = "API call"):
    """Decorator/wrapper: retry a function on transient HTTP or network errors.

    Uses exponential backoff with jitter. Works with google-api-python-client
    HttpError and plain requests exceptions.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_retries + 2):  # attempt 1 = first try
                try:
                    return fn(*args, **kwargs)
                except Exception as exc:
                    status = None
                    # google-api-python-client HttpError
                    if hasattr(exc, "resp") and hasattr(exc.resp, "status"):
                        status = exc.resp.status
                    # requests.exceptions.HTTPError
                    elif hasattr(exc, "response") and exc.response is not None:
                        status = exc.response.status_code
                    # Network-level errors are always retriable
                    is_network = isinstance(exc, (TimeoutError, OSError, ConnectionError))
                    if not is_network and (status is None or status not in retriable_codes):
                        raise  # Not retriable
                    last_exc = exc
                    if attempt > max_retries:
                        break
                    wait = min(60, (2 ** attempt) + random.random())
                    LOGGER.warning("%s attempt %d/%d failed (%s); retrying in %.1fs",
                                   label, attempt, max_retries + 1, exc, wait)
                    time.sleep(wait)
            raise RuntimeError(f"{label} failed after {max_retries + 1} attempts") from last_exc
        return wrapper
    if func is not None:
        return decorator(func)
    return decorator


def handle_stop_signal(signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True
    LOGGER.info("Received signal %s; stopping after current work", signum)


def load_google_credentials(
    credentials_file: Path,
    token_file: Path,
    scopes: list[str],
    service_label: str,
    authorize_command: str,
    oauth_port: int,
    interactive: bool,
    open_browser: bool,
) -> Credentials:
    ensure_dependencies()
    credentials: Credentials | None = None

    if token_file.exists():
        credentials = Credentials.from_authorized_user_file(str(token_file), scopes)
        if not credentials.has_scopes(scopes):
            LOGGER.warning("Existing %s token does not include all required scopes", service_label)
            credentials = None

    if credentials and credentials.valid:
        return credentials

    if credentials and credentials.expired and credentials.refresh_token:
        LOGGER.info("Refreshing %s OAuth token", service_label)
        try:
            credentials.refresh(GoogleAuthRequest())
        except Exception:
            LOGGER.warning("First %s token refresh failed; retrying once", service_label)
            time.sleep(2)
            credentials.refresh(GoogleAuthRequest())
    else:
        if not interactive:
            raise ConfigError(
                f"{service_label} OAuth token is missing or invalid. Run: "
                f"venv/bin/python drive_to_youtube_uploader.py {authorize_command}"
            )
        LOGGER.info("Starting %s OAuth consent flow", service_label)
        flow = InstalledAppFlow.from_client_secrets_file(str(credentials_file), scopes)
        credentials = flow.run_local_server(
            port=oauth_port,
            open_browser=open_browser,
            authorization_prompt_message=f"Open this URL to authorize {service_label} access:\n{{url}}",
            success_message="Authorization complete. You can close this browser tab.",
            access_type="offline",
            prompt="consent",
        )

    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(credentials.to_json(), encoding="utf-8")
    os.chmod(token_file, 0o600)
    LOGGER.info("Saved %s OAuth token to %s", service_label, token_file)
    return credentials


def build_google_services(drive_credentials: Credentials, youtube_credentials: Credentials) -> tuple[Any, Any]:
    ensure_dependencies()
    drive = build("drive", "v3", credentials=drive_credentials, cache_discovery=False)
    youtube = build("youtube", "v3", credentials=youtube_credentials, cache_discovery=False)
    return drive, youtube


def read_uploaded_ids(uploaded_log: Path) -> set[str]:
    if not uploaded_log.exists():
        return set()
    uploaded_ids: set[str] = set()
    for line in uploaded_log.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            uploaded_ids.add(stripped.split()[0])
    return uploaded_ids


def append_uploaded_id(
    uploaded_log: Path,
    file_id: str,
    youtube_video_id: str | None = None,
    file_name: str | None = None,
) -> None:
    uploaded_log.parent.mkdir(parents=True, exist_ok=True)
    parts = [file_id]
    if youtube_video_id:
        uploaded_at = datetime.now(timezone.utc).isoformat()
        safe_file_name = re.sub(r"[\t\r\n]+", " ", file_name or "").strip()
        parts.extend([uploaded_at, youtube_video_id, safe_file_name])
    with uploaded_log.open("a", encoding="utf-8") as log_file:
        log_file.write("\t".join(parts).rstrip() + "\n")


def is_video_file(file_info: dict[str, Any]) -> bool:
    mime_type = (file_info.get("mimeType") or "").lower()
    if mime_type.startswith("video/"):
        return True
    suffix = Path(file_info.get("name", "")).suffix.lower()
    return suffix in VIDEO_EXTENSIONS


def list_drive_videos(drive: Any, folder_id: str, max_retries: int = 3) -> list[dict[str, Any]]:
    """List all video files in a Drive folder, with retry on transient errors."""
    query = f"'{folder_id}' in parents and trashed = false"
    fields = "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)"
    page_token = None
    videos: list[dict[str, Any]] = []

    @retry_api_call(max_retries=max_retries, label="Drive list files")
    def _list_page(pt):
        return (
            drive.files()
            .list(
                q=query,
                spaces="drive",
                fields=fields,
                pageSize=100,
                pageToken=pt,
                orderBy="createdTime",
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
            )
            .execute()
        )

    while True:
        response = _list_page(page_token)
        videos.extend(file_info for file_info in response.get("files", []) if is_video_file(file_info))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return videos


def clean_filename_stem(file_name: str) -> str:
    stem = Path(file_name).stem
    stem = re.sub(r"[_\-]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem or "Nashik PG video"


def strip_room_codes(text: str) -> str:
    cleaned = re.sub(
        r"\s*[\(\[\{]\s*(?:r|rm|room|unit|flat)\s*\.?\s*\d+(?:\.\d+)?[a-z]?\s*[\)\]\}]\s*",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\b(?:r|rm|room|unit|flat)\s*\.?\s*\d+(?:\.\d+)?[a-z]?\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.strip(" -_:,.|") or text.strip()


def property_name_from_filename(file_name: str) -> str:
    return strip_room_codes(clean_filename_stem(file_name)) or "Nashik PG"


DEFAULT_HASHTAGS = [
    "#NashikPG",
    "#PGInNashik",
    "#NashikAccommodation",
    "#NashikHostel",
    "#StudentPG",
    "#WorkingProfessionals",
    "#NashikRooms",
    "#PayingGuest",
    "#PGNearMe",
    "#NashikLiving",
    "#नाशिकPG",
    "#नाशिकरूम",
    "#नाशिकहोस्टेल",
    "#विद्यार्थीPG",
    "#रूमइननाशिक",
]

DEFAULT_TAGS = [
    "Nashik PG",
    "PG in Nashik",
    "Nashik paying guest",
    "Nashik hostel",
    "rooms in Nashik",
    "student PG Nashik",
    "working professionals PG",
    "boys PG Nashik",
    "girls PG Nashik",
    "shared room Nashik",
    "Nashik accommodation",
    "Nashik rental room",
    "PG near me Nashik",
    "Maharashtra PG",
    "affordable PG Nashik",
    "Sai Shraddha Nashik",
    "नाशिक PG",
    "नाशिक रूम",
    "नाशिक हॉस्टेल",
    "नाशिक पेइंग गेस्ट",
]


def clamp_title(title: str, fallback_name: str, max_chars: int = 70) -> str:
    cleaned = strip_room_codes(re.sub(r"\s+", " ", title).strip().strip("\"'"))
    if not cleaned:
        cleaned = f"{property_name_from_filename(fallback_name)} | Nashik PG Rooms"
    if len(cleaned) <= max_chars:
        return cleaned

    trimmed = cleaned[:max_chars].rstrip()
    last_space = trimmed.rfind(" ")
    if last_space >= 35:
        trimmed = trimmed[:last_space].rstrip()
    return trimmed.rstrip(" -:,.") or "Nashik PG Accommodation"


def clamp_words(text: str, max_words: int) -> str:
    words = re.findall(r"\S+", text.strip())
    if len(words) <= max_words:
        return text.strip()
    return " ".join(words[:max_words]).rstrip(" ,;:") + "."


def normalize_description(description: str, fallback_name: str) -> str:
    description = re.sub(r"\n{3,}", "\n\n", description.strip())
    description = "\n".join(strip_room_codes(line) for line in description.splitlines())
    if not description:
        description = fallback_description(fallback_name)

    contact_line = "Call/WhatsApp 8010490761 or 9284782143"
    if "8010490761" not in description and "9284782143" not in description:
        description = f"{description.rstrip()}\n\n{contact_line}"

    found_hashtags = re.findall(r"#[^\s#]+", description)
    hashtags = " ".join(found_hashtags[-15:] if len(found_hashtags) >= 15 else DEFAULT_HASHTAGS)
    body = re.sub(r"(?:\s*#[^\s#]+)+\s*$", "", description).strip()
    allowed_body_words = max(1, 400 - len(hashtags.split()))
    body = clamp_words(body, allowed_body_words)
    return f"{body}\n\n{hashtags}".strip()


def normalize_tags(tags: Any) -> list[str]:
    if isinstance(tags, str):
        raw_tags = re.split(r"[,;\n]+", tags)
    elif isinstance(tags, list):
        raw_tags = [str(tag) for tag in tags]
    else:
        raw_tags = []

    normalized: list[str] = []
    seen_tags: set[str] = set()
    total_length = 0
    
    for raw_tag in raw_tags:
        tag = strip_room_codes(re.sub(r"\s+", " ", raw_tag).strip().strip("#,;<>"))
        if not tag:
            continue
        dedupe_key = tag.casefold()
        if dedupe_key in seen_tags:
            continue
            
        # YouTube has a 500 char limit for all tags combined
        if total_length + len(tag) + 1 > 450:
            break
            
        normalized.append(tag[:60])
        seen_tags.add(dedupe_key)
        total_length += len(tag[:60]) + 1
        
        if len(normalized) == 20:
            break

    for fallback_tag in DEFAULT_TAGS:
        dedupe_key = fallback_tag.casefold()
        if dedupe_key not in seen_tags:
            if total_length + len(fallback_tag) + 1 > 450:
                break
            normalized.append(fallback_tag)
            seen_tags.add(dedupe_key)
            total_length += len(fallback_tag) + 1
            
        if len(normalized) == 20:
            break

    return normalized


def fallback_description(file_name: str) -> str:
    property_name = property_name_from_filename(file_name)
    hashtags = " ".join(DEFAULT_HASHTAGS)
    return (
        f"Looking for a comfortable PG in Nashik? Watch {property_name} and get a clear look before you plan your visit.\n"
        "A practical stay option in Nashik can make daily life easier for students, job seekers, and working professionals.\n\n"
        f"This video highlights {property_name}, a Nashik PG option for people who want convenient accommodation with a simple, practical setup. "
        "Use the video to understand the room layout, available space, and overall property feel before shortlisting your stay. "
        "It is useful for students moving to Nashik for college, working professionals shifting for a job, and anyone searching for a paying guest room in a connected local area.\n\n"
        "Nashik is a growing city with colleges, offices, coaching classes, hospitals, markets, bus routes, and daily needs spread across key locations. "
        "Choosing a PG in Nashik can help reduce travel stress and make food, transport, study, work, and basic routines easier to manage. "
        "If you are comparing PG rooms, hostel-style stays, shared accommodation, or rental room options, this video can help you decide whether this property matches your needs. "
        "A video walkthrough is also helpful when you want to share the option with family, compare different rooms, or check whether the space feels suitable before visiting in person.\n\n"
        "This PG may be relevant for students who need a focused place to stay during classes, working people who want a manageable daily commute, and newcomers who are still learning Nashik's local areas. "
        "Before finalizing any stay, you can use this video as a first look and then confirm details such as room availability, sharing preference, rules, nearby transport, and visit timing directly with the team. "
        "The goal is to make your Nashik PG search simpler, clearer, and faster, especially if you are checking multiple accommodation options in one day.\n\n"
        "For details about availability, visit timing, room options, and current suitability, contact Nashik PG directly. "
        "Call/WhatsApp 8010490761 or 9284782143.\n\n"
        f"{hashtags}"
    )


def fallback_metadata(file_name: str) -> VideoMetadata:
    property_name = property_name_from_filename(file_name)
    title = clamp_title(f"{property_name} | Nashik PG Rooms & Accommodation", file_name)
    property_tags = [
        f"{property_name} Nashik PG",
        f"{property_name} PG",
        f"{property_name} Nashik rooms",
    ]
    return VideoMetadata(
        title=title,
        description=normalize_description(fallback_description(file_name), file_name),
        tags=normalize_tags(property_tags + DEFAULT_TAGS),
    )


def extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(cleaned[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("Gemini response was not a JSON object")
    return parsed


def load_knowledge_base(config: Config) -> str:
    """Load the client's knowledge base file from knowledge/{client_name}.txt."""
    kb_path = Path(__file__).resolve().parent / "knowledge" / f"{config.client_name}.txt"
    if kb_path.exists():
        content = kb_path.read_text(encoding="utf-8").strip()
        if content:
            return content
    return ""


def generate_metadata_with_gemini(
    file_info: dict[str, Any],
    config: Config,
    gemini_api_key: str,
) -> VideoMetadata:
    ensure_dependencies()
    file_name = file_info.get("name", "video")
    file_context = clean_filename_stem(file_name)
    property_name = property_name_from_filename(file_name)

    knowledge_base = load_knowledge_base(config)
    if knowledge_base:
        kb_section = f"""
CHANNEL KNOWLEDGE BASE (use this as context for all metadata):
---
{knowledge_base}
---
"""
    else:
        kb_section = ""

    prompt = f"""
Video filename: "{file_name}"
Readable filename context: "{file_context}"
Clean property name to use in metadata: "{property_name}"
{kb_section}
Generate YouTube SEO metadata for this video.

1. TITLE (max 70 characters):
   Make it catchy and keyword-rich based on the knowledge base context.
   Put the property/brand name first.

2. DESCRIPTION (300-400 words):
   - First 2 lines must be a hook (these show before "Show more")
   - Use the knowledge base to mention relevant highlights, target audience, location
   - End with 15 relevant hashtags (mix local + English)

3. TAGS: 20 comma-separated YouTube tags mixing broad + local keywords from the knowledge base

Rules:
- Do not include room/unit codes such as R6.8, R.8, Room 8, Unit 8, or Flat 8 in title, description, tags, or hashtags.
- Use only details implied by the filename/context and knowledge base. Do not invent exact address, rent, amenities, offers, or availability.
- Return JSON only. No extra text.

{{
  "title": "...",
  "description": "...",
  "tags": ["...", "..."]
}}
""".strip()

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{config.gemini_model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "responseMimeType": "application/json",
        },
    }
    @retry_api_call(max_retries=2, label="Gemini generateContent")
    def _call_gemini():
        resp = http_requests.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": gemini_api_key,
            },
            json=payload,
            timeout=config.gemini_timeout_seconds,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:500]}")
        return resp

    response = _call_gemini()

    data = response.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise RuntimeError("Gemini API returned an empty response")

    parsed = extract_json_object(text)
    title = clamp_title(str(parsed.get("title", "")), file_name)
    description = normalize_description(str(parsed.get("description", "")), file_name)
    tags = normalize_tags(parsed.get("tags", []))
    if not description:
        return fallback_metadata(file_name)
    return VideoMetadata(title=title, description=description, tags=tags)


def rotated_gemini_key_indexes(config: Config, upload_sequence: int) -> list[int]:
    key_count = len(config.gemini_api_keys)
    if key_count == 0:
        return []
    start_index = upload_sequence % key_count
    return [(start_index + offset) % key_count for offset in range(key_count)]


def generate_video_metadata(file_info: dict[str, Any], config: Config, upload_sequence: int) -> VideoMetadata:
    for key_index in rotated_gemini_key_indexes(config, upload_sequence):
        try:
            LOGGER.info("Generating metadata with Gemini key #%d", key_index + 1)
            metadata = generate_metadata_with_gemini(file_info, config, config.gemini_api_keys[key_index])
            LOGGER.info("Generated metadata title: %s", metadata.title)
            return metadata
        except Exception:
            LOGGER.exception("Gemini metadata generation failed with key #%d", key_index + 1)

    LOGGER.warning("All Gemini keys failed; using fallback metadata")
    return fallback_metadata(file_info.get("name", "video"))


def safe_temp_name(file_info: dict[str, Any]) -> str:
    file_id = file_info["id"]
    name = file_info.get("name", "video")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    safe_name = safe_name[:120] or "video"
    return f"nashik_pg_{file_id}_{safe_name}"


def _check_disk_space(file_info: dict[str, Any], target_dir: str = "/tmp") -> None:
    """Ensure enough free disk space exists before downloading."""
    file_size = int(file_info.get("size", 0))
    if file_size <= 0:
        return  # Unknown size, proceed optimistically
    free_bytes = shutil.disk_usage(target_dir).free
    # Require at least 2x the file size as safety margin
    if free_bytes < file_size * 2:
        raise RuntimeError(
            f"Insufficient disk space in {target_dir}: "
            f"{free_bytes / 1_048_576:.0f} MB free, need ~{file_size * 2 / 1_048_576:.0f} MB "
            f"for {file_info.get('name', 'video')} ({file_size / 1_048_576:.0f} MB)"
        )
    LOGGER.debug("Disk check OK: %.0f MB free, file is %.0f MB",
                 free_bytes / 1_048_576, file_size / 1_048_576)


def download_drive_file(drive: Any, file_info: dict[str, Any], max_retries: int = 3) -> Path:
    """Download a video from Drive to /tmp with disk space check and retry."""
    _check_disk_space(file_info)
    target_path = Path("/tmp") / safe_temp_name(file_info)
    LOGGER.info("Downloading Drive file %s to %s", file_info["id"], target_path)

    @retry_api_call(max_retries=max_retries, label="Drive download")
    def _download():
        request = drive.files().get_media(fileId=file_info["id"], supportsAllDrives=True)
        with target_path.open("wb") as output:
            downloader = MediaIoBaseDownload(output, request, chunksize=8 * 1024 * 1024)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                if status:
                    LOGGER.info("Download progress for %s: %.0f%%",
                                file_info["name"], status.progress() * 100)

    _download()
    return target_path


def media_mime_type(file_info: dict[str, Any], video_path: Path) -> str:
    drive_mime = file_info.get("mimeType")
    if drive_mime and (drive_mime.startswith("video/") or drive_mime == "application/octet-stream"):
        return drive_mime
    guessed_mime, _ = mimetypes.guess_type(video_path.name)
    return guessed_mime or "application/octet-stream"


def resumable_upload(insert_request: Any, max_retries: int) -> dict[str, Any]:
    response = None
    retry = 0

    while response is None:
        error = None
        try:
            status, response = insert_request.next_chunk()
            if status:
                LOGGER.info("YouTube upload progress: %.0f%%", status.progress() * 100)
        except HttpError as exc:
            if exc.resp.status in RETRIABLE_HTTP_STATUS_CODES:
                error = exc
            else:
                raise
        except RETRIABLE_UPLOAD_EXCEPTIONS as exc:
            error = exc

        if error is not None:
            retry += 1
            if retry > max_retries:
                raise RuntimeError(f"YouTube upload failed after {max_retries} retries") from error
            sleep_seconds = min(60, (2**retry) + random.random())
            LOGGER.warning("Retriable YouTube upload error: %s; sleeping %.1fs", error, sleep_seconds)
            time.sleep(sleep_seconds)

    if not isinstance(response, dict) or not response.get("id"):
        raise RuntimeError(f"Unexpected YouTube upload response: {response}")
    return response


def upload_video_to_youtube(
    youtube: Any,
    file_info: dict[str, Any],
    video_path: Path,
    metadata: VideoMetadata,
    config: Config,
) -> str:
    LOGGER.info("Uploading %s to YouTube as public video", video_path)

    body = {
        "snippet": {
            "title": metadata.title,
            "description": metadata.description,
            "tags": metadata.tags,
            "categoryId": config.youtube_category_id,
        },
        "status": {
            "privacyStatus": config.youtube_privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }
    media_body = MediaFileUpload(
        str(video_path),
        mimetype=media_mime_type(file_info, video_path),
        chunksize=config.upload_chunk_size,
        resumable=True,
    )
    insert_request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media_body,
        notifySubscribers=config.youtube_notify_subscribers,
    )
    response = resumable_upload(insert_request, config.upload_max_retries)
    youtube_video_id = response["id"]
    LOGGER.info("YouTube upload complete. Video ID: %s", youtube_video_id)
    return youtube_video_id


def process_drive_file(
    drive: Any,
    youtube: Any,
    file_info: dict[str, Any],
    config: Config,
    upload_sequence: int,
) -> str:
    temp_path: Path | None = None
    try:
        metadata = generate_video_metadata(file_info, config, upload_sequence)
        temp_path = download_drive_file(drive, file_info)
        return upload_video_to_youtube(youtube, file_info, temp_path, metadata, config)
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
                LOGGER.info("Deleted temp file %s", temp_path)
            except OSError:
                LOGGER.exception("Could not delete temp file %s", temp_path)


def process_once(drive: Any, youtube: Any, config: Config) -> int:
    """Run one scan of the Drive folder and call Gemini only for new videos."""
    uploaded_ids = read_uploaded_ids(config.uploaded_log)
    videos = list_drive_videos(drive, config.drive_folder_id, max_retries=config.api_max_retries)

    total_in_folder = len(videos)
    uploaded_this_run = 0
    failed = 0
    new_videos: list[dict[str, Any]] = []

    for file_info in videos:
        file_id = file_info["id"]
        if file_id in uploaded_ids:
            LOGGER.debug("Skipping already uploaded Drive file %s", file_id)
            continue
        new_videos.append(file_info)

    skipped = total_in_folder - len(new_videos)
    if not new_videos:
        LOGGER.info("No new Drive videos found; skipping Gemini metadata generation")
        LOGGER.info(
            "Poll summary: %d total in folder | %d already uploaded | %d new | %d uploaded | %d failed",
            total_in_folder, skipped, 0, uploaded_this_run, failed,
        )
        return uploaded_this_run

    for file_info in new_videos:
        file_id = file_info["id"]
        LOGGER.info("New video detected: %s (%s)", file_info.get("name", "video"), file_id)
        try:
            upload_sequence = len(uploaded_ids)
            youtube_video_id = process_drive_file(drive, youtube, file_info, config, upload_sequence)
            append_uploaded_id(
                config.uploaded_log,
                file_id,
                youtube_video_id,
                file_info.get("name", "video"),
            )
            uploaded_ids.add(file_id)
            uploaded_this_run += 1
            LOGGER.info("Tracked Drive file %s after YouTube upload %s", file_id, youtube_video_id)
        except Exception as exc:
            failed += 1
            LOGGER.exception("Failed to process video %s (%s); continuing with next",
                             file_info.get("name", "video"), file_id)
            # Record for retry system
            try:
                record_failed_upload(config, file_info, str(exc))
            except Exception:
                pass

    # ── Poll cycle summary ──
    new_found = len(new_videos)
    LOGGER.info(
        "Poll summary: %d total in folder | %d already uploaded | %d new | %d uploaded | %d failed",
        total_in_folder, skipped, new_found, uploaded_this_run, failed,
    )
    return uploaded_this_run


# ── Approval mode + Failed upload helpers ────────────────────────────────────

def _queue_path_for_client(client_name: str) -> Path:
    return Path(__file__).resolve().parent / "queue" / f"{client_name}_queue.json"


def _failed_path_for_client(client_name: str) -> Path:
    return Path(__file__).resolve().parent / "state" / f"failed_{client_name}.json"


def _load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_json_list(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def record_failed_upload(
    config: Config,
    file_info: dict,
    reason: str,
) -> None:
    """Save a failed upload to state/failed_{client}.json with retry metadata."""
    from datetime import timedelta
    client_name = config.client_name
    path = _failed_path_for_client(client_name)
    items = _load_json_list(path)
    file_id = file_info["id"]
    now = datetime.now(timezone.utc)
    # Don't add duplicate entries
    existing = next((i for i in items if i.get("file_id") == file_id), None)
    if existing:
        retry_count = existing.get("retry_count", 0) + 1
        delays = [1, 3, 6]  # hours
        delay_h = delays[min(retry_count - 1, len(delays) - 1)]
        existing.update({
            "retry_count": retry_count,
            "reason": reason,
            "next_retry_at": (now + timedelta(hours=delay_h)).isoformat(),
            "status": "permanently_failed" if retry_count >= 3 else "pending_retry",
            "failed_at": now.isoformat(),
        })
    else:
        items.append({
            "file_id": file_id,
            "filename": file_info.get("name", "unknown"),
            "failed_at": now.isoformat(),
            "reason": reason,
            "retry_count": 0,
            "max_retries": 3,
            "next_retry_at": (now + timedelta(hours=1)).isoformat(),
            "status": "pending_retry",
        })
    _save_json_list(path, items)
    LOGGER.warning("[%s] Recorded failed upload: %s — %s", client_name, file_info.get("name"), reason)


def process_once_approval_mode(drive: Any, config: Config, upload_sequence_start: int = 0) -> int:
    """Approval-mode scan: generate metadata and save to queue instead of uploading."""
    client_name = config.client_name
    uploaded_ids = read_uploaded_ids(config.uploaded_log)
    queue_path = _queue_path_for_client(client_name)
    existing_queue = _load_json_list(queue_path)
    queued_ids = {i["file_id"] for i in existing_queue}

    videos = list_drive_videos(drive, config.drive_folder_id, max_retries=config.api_max_retries)
    new_videos = [v for v in videos if v["id"] not in uploaded_ids and v["id"] not in queued_ids]

    if not new_videos:
        LOGGER.info("[%s] Approval mode: no new videos to queue", client_name)
        return 0

    LOGGER.info("[%s] Approval mode: %d new video(s) found — generating metadata", client_name, len(new_videos))
    added = 0
    for idx, file_info in enumerate(new_videos):
        file_id = file_info["id"]
        filename = file_info.get("name", "video")
        LOGGER.info("[%s] Queuing: %s (%s)", client_name, filename, file_id)
        try:
            metadata = generate_video_metadata(file_info, config, upload_sequence_start + idx)
        except Exception:
            LOGGER.exception("[%s] Metadata generation failed for %s; using fallback", client_name, filename)
            metadata = fallback_metadata(filename)
        now_str = datetime.now(timezone.utc).isoformat()
        existing_queue.append({
            "file_id": file_id,
            "filename": filename,
            "queued_at": now_str,
            "status": "pending_approval",
            "title": metadata.title,
            "description": metadata.description,
            "tags": metadata.tags,
            "generated_at": now_str,
        })
        added += 1

    _save_json_list(queue_path, existing_queue)
    LOGGER.info("[%s] Approval mode: %d video(s) added to queue", client_name, added)
    return added


def upload_approved_item(config: Config, file_id: str) -> int:
    """Upload a single pre-approved queue item by file_id."""
    client_name = config.client_name
    queue_path = _queue_path_for_client(client_name)
    items = _load_json_list(queue_path)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        LOGGER.error("[%s] Approved item %s not found in queue", client_name, file_id)
        return 0

    drive = _build_drive_service(config)
    youtube = _build_youtube_service(config)

    metadata = VideoMetadata(
        title=item.get("title", ""),
        description=item.get("description", ""),
        tags=item.get("tags", []),
    )
    file_info = {"id": file_id, "name": item.get("filename", file_id)}
    try:
        # Need real Drive metadata for download (size, mimeType)
        drive_meta = drive.files().get(fileId=file_id, fields="id,name,mimeType,size", supportsAllDrives=True).execute()
        file_info.update(drive_meta)
    except Exception:
        LOGGER.warning("[%s] Could not fetch Drive metadata for %s; proceeding with cached name", client_name, file_id)

    temp_path: Path | None = None
    try:
        temp_path = download_drive_file(drive, file_info)
        youtube_video_id = upload_video_to_youtube(youtube, file_info, temp_path, metadata, config)
        append_uploaded_id(config.uploaded_log, file_id, youtube_video_id, item.get("filename", ""))
        LOGGER.info("[%s] Approved upload complete: %s → YouTube %s", client_name, item.get("filename"), youtube_video_id)
        # Remove from queue
        _save_json_list(queue_path, [i for i in items if i["file_id"] != file_id])
        # Remove from failed list if it was there
        failed_path = _failed_path_for_client(client_name)
        failed = [i for i in _load_json_list(failed_path) if i.get("file_id") != file_id]
        _save_json_list(failed_path, failed)
        return 1
    except Exception as exc:
        LOGGER.exception("[%s] Approved upload failed for %s", client_name, file_id)
        record_failed_upload(config, file_info, str(exc))
        return 0
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
                LOGGER.info("Deleted temp file %s", temp_path)
            except OSError:
                pass


def retry_failed_upload_item(config: Config, file_id: str) -> int:
    """Retry a single failed upload entry."""
    client_name = config.client_name
    failed_path = _failed_path_for_client(client_name)
    items = _load_json_list(failed_path)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        LOGGER.error("[%s] Failed item %s not found", client_name, file_id)
        return 0

    drive = _build_drive_service(config)
    youtube = _build_youtube_service(config)
    file_info = {"id": file_id, "name": item.get("filename", file_id)}
    try:
        drive_meta = drive.files().get(fileId=file_id, fields="id,name,mimeType,size", supportsAllDrives=True).execute()
        file_info.update(drive_meta)
    except Exception:
        pass

    try:
        upload_seq = len(read_uploaded_ids(config.uploaded_log))
        youtube_video_id = process_drive_file(drive, youtube, file_info, config, upload_seq)
        append_uploaded_id(config.uploaded_log, file_id, youtube_video_id, item.get("filename", ""))
        LOGGER.info("[%s] Retry upload successful: %s → %s", client_name, item.get("filename"), youtube_video_id)
        _save_json_list(failed_path, [i for i in items if i["file_id"] != file_id])
        return 1
    except Exception as exc:
        LOGGER.exception("[%s] Retry upload failed for %s", client_name, file_id)
        record_failed_upload(config, file_info, str(exc))
        return 0


def is_upload_scheduled(client_raw: dict, config: Config) -> bool:
    """Return True if the current IST time matches a scheduled upload slot and daily limit not exceeded."""
    sched = client_raw.get("schedule", {})
    if not sched.get("enabled"):
        return True  # No schedule = always upload
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(sched.get("timezone", "Asia/Kolkata"))
    except Exception:
        return True
    now = datetime.now(tz)
    day_abbrs = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    today = day_abbrs[now.weekday()]
    active_days = set(sched.get("days_active", day_abbrs))
    if today not in active_days:
        LOGGER.info("[%s] Upload skipped — not scheduled on %s", config.client_name, today)
        return False
    upload_times = sched.get("upload_times", [])
    if not upload_times:
        return True
    current_hhmm = now.strftime("%H:%M")
    if current_hhmm not in upload_times:
        LOGGER.info("[%s] Upload skipped — current time %s not in schedule %s",
                    config.client_name, current_hhmm, upload_times)
        return False
    max_per_day = int(sched.get("max_per_day", 2))
    state_path = config.uploaded_log
    if state_path.exists():
        today_str = now.strftime("%Y-%m-%d")
        todays_uploads = sum(
            1 for line in state_path.read_text(encoding="utf-8").splitlines()
            if today_str in line
        )
        if todays_uploads >= max_per_day:
            LOGGER.info("[%s] Upload skipped — daily limit %d reached", config.client_name, max_per_day)
            return False
    return True


def sleep_with_stop_check(seconds: int) -> None:
    deadline = time.monotonic() + seconds
    while not STOP_REQUESTED and time.monotonic() < deadline:
        time.sleep(min(1, deadline - time.monotonic()))


def _build_drive_service(config: Config) -> Any:
    drive_credentials = load_google_credentials(
        config.drive_credentials_file,
        config.drive_token_file,
        DRIVE_SCOPES,
        "Shared/Drive",
        "authorize-drive",
        config.oauth_port,
        interactive=False,
        open_browser=False,
    )
    return build("drive", "v3", credentials=drive_credentials, cache_discovery=False)


def _build_youtube_service(config: Config) -> Any:
    youtube_credentials = load_google_credentials(
        config.youtube_credentials_file,
        config.youtube_token_file,
        YOUTUBE_SCOPES,
        f"{config.client_name}/YouTube",
        "authorize-youtube",
        config.oauth_port,
        interactive=False,
        open_browser=False,
    )
    return build("youtube", "v3", credentials=youtube_credentials, cache_discovery=False)


def poll_client_once(drive: Any, config: Config) -> int:
    """Run one poll cycle for a single client. Returns number of videos uploaded."""
    client_logger = logging.getLogger(f"drive_to_youtube.{config.client_name}")
    client_logger.info("[%s] Starting poll", config.client_name)
    try:
        youtube = _build_youtube_service(config)
        count = process_once(drive, youtube, config)
        client_logger.info("[%s] Poll complete — %d uploaded", config.client_name, count)
        return count
    except Exception:
        client_logger.exception("[%s] Poll failed — skipping this client", config.client_name)
        return 0


def run_forever(config: Config) -> None:
    """Single-client forever loop (legacy path when no config.json present)."""
    signal.signal(signal.SIGTERM, handle_stop_signal)
    signal.signal(signal.SIGINT, handle_stop_signal)

    drive = _build_drive_service(config)

    LOGGER.info(
        "Watching Drive folder %s every %s seconds",
        config.drive_folder_id,
        config.poll_interval_seconds,
    )
    while not STOP_REQUESTED:
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            youtube = _build_youtube_service(config)
            uploaded_count = process_once(drive, youtube, config)
            LOGGER.info("Poll completed at %s; uploaded %d video(s)", started_at, uploaded_count)
        except Exception:
            LOGGER.exception("Poll failed; will retry after the next interval")
        sleep_with_stop_check(config.poll_interval_seconds)

    LOGGER.info("Service stopped")


def run_forever_multi(clients: list[Config]) -> None:
    """Multi-client forever loop — polls all clients each interval."""
    signal.signal(signal.SIGTERM, handle_stop_signal)
    signal.signal(signal.SIGINT, handle_stop_signal)

    if not clients:
        LOGGER.error("No clients configured in config.json")
        return

    try:
        drive = _build_drive_service(clients[0])
    except Exception:
        LOGGER.exception("Failed to build shared Drive service")
        return

    interval = clients[0].poll_interval_seconds
    names = ", ".join(c.client_name for c in clients)
    LOGGER.info("Multi-client mode: [%s] — polling every %ds", names, interval)

    while not STOP_REQUESTED:
        started_at = datetime.now(timezone.utc).isoformat()
        total = 0
        for client_config in clients:
            if STOP_REQUESTED:
                break
            total += poll_client_once(drive, client_config)
        LOGGER.info("All-client poll done at %s — %d total uploaded", started_at, total)
        sleep_with_stop_check(interval)

    LOGGER.info("Multi-client service stopped")


def run_once(config: Config) -> None:
    drive = _build_drive_service(config)
    youtube = _build_youtube_service(config)
    uploaded_count = process_once(drive, youtube, config)
    LOGGER.info("One-shot run uploaded %d video(s) [client=%s]", uploaded_count, config.client_name)


def run_once_multi(clients: list[Config]) -> None:
    """One-shot pass for all clients. Each failure is caught independently."""
    if not clients:
        return
    drive = _build_drive_service(clients[0])
    for client_config in clients:
        poll_client_once(drive, client_config)
    LOGGER.info("One-shot multi-client run complete")


def authorize_drive(config: Config, open_browser: bool) -> None:
    load_google_credentials(
        config.drive_credentials_file,
        config.drive_token_file,
        DRIVE_SCOPES,
        "Drive",
        "authorize-drive",
        config.oauth_port,
        interactive=True,
        open_browser=open_browser,
    )
    LOGGER.info("Drive authorization completed")


def authorize_youtube(config: Config, open_browser: bool) -> None:
    load_google_credentials(
        config.youtube_credentials_file,
        config.youtube_token_file,
        YOUTUBE_SCOPES,
        "YouTube",
        "authorize-youtube",
        config.oauth_port,
        interactive=True,
        open_browser=open_browser,
    )
    LOGGER.info("YouTube authorization completed")


def authorize(config: Config, open_browser: bool) -> None:
    LOGGER.info("Authorizing Drive first. Use the Google account that owns or can read the Drive folder.")
    authorize_drive(config, open_browser=open_browser)
    LOGGER.info("Authorizing YouTube next. Use the Google account that owns the YouTube channel.")
    authorize_youtube(config, open_browser=open_browser)
    LOGGER.info("Authorization completed")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload new Google Drive videos to YouTube (multi-client).")
    parser.add_argument(
        "command",
        nargs="?",
        choices=(
            "run", "once", "authorize", "authorize-drive", "authorize-youtube",
            "upload-approved", "retry-upload", "queue-scan", "refresh-token",
        ),
        default="run",
        help="run forever, process once, authorize, or new: upload-approved / retry-upload / queue-scan / refresh-token",
    )
    parser.add_argument("--env-file", type=Path, help="Optional KEY=VALUE environment file to load first")
    parser.add_argument("--config", type=Path, help="Path to config.json (multi-client). Default: config.json next to script")
    parser.add_argument("--client", help="Run only this client name (from config.json)")
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"), help="DEBUG, INFO, WARNING, ERROR")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser during authorization")
    parser.add_argument("--approve-file-id", help="Drive file ID to upload after approval (used with upload-approved)")
    parser.add_argument("--retry-file-id", help="Drive file ID to retry (used with retry-upload)")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        load_env_file(args.env_file)

        # ── Shared base config (Gemini keys, intervals, YouTube settings) ──
        is_runtime_cmd = args.command in {"run", "once"}
        base_config = build_config(require_runtime_values=False)

        # Shared logging (dashboard + fallback)
        setup_logging(
            args.log_level,
            log_file=base_config.log_file,
            max_bytes=base_config.log_max_bytes,
            backup_count=base_config.log_backup_count,
        )

        # ── Try to load config.json for multi-client mode ──────────────────
        config_json_path = args.config or script_dir() / "config.json"
        client_entries = load_client_config_json(config_json_path)

        # Filter to a single client if --client was specified
        if args.client:
            client_entries = [e for e in client_entries if e.name == args.client]
            if not client_entries:
                LOGGER.error("Client '%s' not found in config.json", args.client)
                return 2

        # ── Build per-client Config objects and set up their loggers ───────
        if client_entries:
            client_configs: list[Config] = []
            for entry in client_entries:
                cc = build_client_config(entry, base_config)
                # Set up a rotating file log per client
                if cc.log_file:
                    cc.log_file.parent.mkdir(parents=True, exist_ok=True)
                    setup_logging(args.log_level, log_file=cc.log_file,
                                  max_bytes=cc.log_max_bytes, backup_count=cc.log_backup_count)
                client_configs.append(cc)
                LOGGER.info("Registered client: %s (folder=%s)", entry.name, entry.drive_folder_id)
        else:
            # Fallback: single-client mode via env vars (legacy)
            if is_runtime_cmd:
                base_config = build_config(require_runtime_values=True)
            client_configs = [base_config]

        LOGGER.info("=== Drive-to-YouTube Uploader starting (command=%s, clients=%d) ===",
                    args.command, len(client_configs))

        # ── Dispatch command ───────────────────────────────────────────────
        if args.command in {"authorize", "authorize-drive", "authorize-youtube"}:
            config = client_configs[0]
            if args.command == "authorize":
                authorize(config, open_browser=not args.no_browser)
            elif args.command == "authorize-drive":
                authorize_drive(config, open_browser=not args.no_browser)
            else:
                authorize_youtube(config, open_browser=not args.no_browser)

        elif args.command == "upload-approved":
            # Upload a single queue-approved video
            config = client_configs[0]
            if not args.approve_file_id:
                LOGGER.error("--approve-file-id is required for upload-approved")
                return 2
            upload_approved_item(config, args.approve_file_id)

        elif args.command == "retry-upload":
            # Retry a specific failed upload
            config = client_configs[0]
            if not args.retry_file_id:
                LOGGER.error("--retry-file-id is required for retry-upload")
                return 2
            retry_failed_upload_item(config, args.retry_file_id)

        elif args.command == "queue-scan":
            # Approval-mode scan: discover new videos and add to queue without uploading
            if not client_configs:
                LOGGER.error("No client configured for queue-scan")
                return 2
            # Use first client's drive credentials (shared drive)
            drive = _build_drive_service(client_configs[0])
            total_added = 0
            for config in client_configs:
                uploaded_count = len(read_uploaded_ids(config.uploaded_log))
                added = process_once_approval_mode(drive, config, upload_sequence_start=uploaded_count)
                LOGGER.info("queue-scan complete — %d video(s) added to queue [client=%s]", added, config.client_name)
                total_added += added
            if len(client_configs) > 1:
                LOGGER.info("queue-scan total: %d video(s) added across %d clients", total_added, len(client_configs))

        elif args.command == "refresh-token":
            # Silent token refresh only
            config = client_configs[0]
            try:
                _build_drive_service(config)
                _build_youtube_service(config)
                LOGGER.info("[%s] Tokens refreshed successfully", config.client_name)
            except Exception:
                LOGGER.exception("[%s] Token refresh failed", config.client_name)
                return 1

        elif args.command == "once":
            if len(client_configs) == 1:
                run_once(client_configs[0])
            else:
                run_once_multi(client_configs)
        else:  # "run"
            if len(client_configs) == 1:
                run_forever(client_configs[0])
            else:
                run_forever_multi(client_configs)

    except ConfigError as exc:
        LOGGER.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        LOGGER.info("Interrupted")
        return 130
    except Exception:
        LOGGER.exception("Fatal error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
