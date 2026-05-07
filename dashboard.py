#!/usr/bin/env python3
from __future__ import annotations

import argparse
import cgi
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = BASE_DIR / "nashik-pg-uploader.env"
DEFAULT_CONFIG_JSON = BASE_DIR / "config.json"
SERVICE_NAME = "nashik-pg-uploader.service"
RUN_LOCK = threading.Lock()
RUN_PROCESS: subprocess.Popen[bytes] | None = None
RUN_PROCESSES: dict[str, subprocess.Popen[bytes]] = {}  # per-client
DASHBOARD_UI_FILE = BASE_DIR / "driveftp.html"


LOG_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(?P<millis>\d{3}) "
    r"(?P<level>[A-Z]+) (?P<logger>[^:]+): (?P<message>.*)$"
)
SUMMARY_PATTERN = re.compile(
    r"Poll summary: (?P<total>\d+) total in folder \| "
    r"(?P<skipped>\d+) already uploaded \| "
    r"(?P<new>\d+) new \| "
    r"(?P<uploaded>\d+) uploaded \| "
    r"(?P<failed>\d+) failed"
)
NEW_VIDEO_PATTERN = re.compile(r"New video detected: (?P<name>.+) \((?P<drive_id>[^)]+)\)")
TRACKED_PATTERN = re.compile(r"Tracked Drive file (?P<drive_id>\S+) after YouTube upload (?P<youtube_id>\S+)")
YOUTUBE_DONE_PATTERN = re.compile(r"YouTube upload complete\. Video ID: (?P<youtube_id>\S+)")


def read_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip("'\"")
    return env


def resolve_path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return BASE_DIR / path


def env_path(env: dict[str, str], key: str, default: Path) -> Path:
    return resolve_path(env.get(key), default)


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def text_response(handler: BaseHTTPRequestHandler, body: str, status: int = 200, content_type: str = "text/html") -> None:
    data = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", f"{content_type}; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def dashboard_html() -> str:
    if DASHBOARD_UI_FILE.exists():
        return DASHBOARD_UI_FILE.read_text(encoding="utf-8")
    return HTML


def run_command(args: list[str], timeout: float = 2.0) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            args,
            cwd=BASE_DIR,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    return completed.returncode, output


def tail_lines(path: Path, limit: int = 200, max_bytes: int = 512 * 1024) -> list[str]:
    if not path.exists():
        return []
    size = path.stat().st_size
    with path.open("rb") as file:
        file.seek(max(0, size - max_bytes))
        data = file.read().decode("utf-8", errors="replace")
    lines = data.splitlines()
    return lines[-limit:]


def parse_log_entries(lines: list[str]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for line in lines:
        match = LOG_PATTERN.match(line)
        if not match:
            entries.append(
                {
                    "timestamp": "",
                    "level": "",
                    "logger": "",
                    "message": line,
                    "raw": line,
                }
            )
            continue
        parts = match.groupdict()
        entries.append(
            {
                "timestamp": parts["timestamp"],
                "level": parts["level"],
                "logger": parts["logger"],
                "message": parts["message"],
                "raw": line,
            }
        )
    return entries


def local_time(timestamp: float | None) -> str:
    if timestamp is None:
        return "Missing"
    return datetime.fromtimestamp(timestamp).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def file_status(path: Path) -> dict[str, Any]:
    exists = path.exists()
    stat = path.stat() if exists else None
    return {
        "path": str(path),
        "exists": exists,
        "size": stat.st_size if stat else 0,
        "modified": local_time(stat.st_mtime if stat else None),
    }


def mask_value(value: str, visible: int = 6) -> str:
    if not value:
        return "Not set"
    if len(value) <= visible * 2:
        return value
    return f"{value[:visible]}...{value[-visible:]}"


def gemini_key_count(env: dict[str, str]) -> int:
    count = 0
    if env.get("GEMINI_API_KEYS"):
        count += len([item for item in re.split(r"[,\s]+", env["GEMINI_API_KEYS"]) if item.strip()])
    if env.get("GEMINI_API_KEY"):
        count += 1
    count += len([key for key, value in env.items() if re.fullmatch(r"GEMINI_API_KEY_\d+", key) and value.strip()])
    return count


def service_status() -> dict[str, Any]:
    code, output = run_command(
        [
            "systemctl",
            "show",
            SERVICE_NAME,
            "--no-page",
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "MainPID",
            "-p",
            "FragmentPath",
        ]
    )
    if code != 0:
        return {"available": False, "active": False, "state": "unknown", "sub_state": "", "main_pid": "", "detail": output}
    values: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    state = values.get("ActiveState", "unknown")
    return {
        "available": True,
        "active": state == "active",
        "state": state,
        "sub_state": values.get("SubState", ""),
        "main_pid": values.get("MainPID", ""),
        "fragment_path": values.get("FragmentPath", ""),
    }


def uploader_processes() -> list[dict[str, str]]:
    code, output = run_command(["ps", "-eo", "pid=,args="])
    if code != 0:
        return []
    processes: list[dict[str, str]] = []
    for line in output.splitlines():
        stripped = line.strip()
        if "drive_to_youtube_uploader.py" not in stripped:
            continue
        if "dashboard.py" in stripped:
            continue
        pid, _, args = stripped.partition(" ")
        processes.append({"pid": pid, "args": args.strip()})
    return processes


def last_summary(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    for entry in reversed(entries):
        match = SUMMARY_PATTERN.search(entry["message"])
        if not match:
            continue
        values = {key: int(value) for key, value in match.groupdict().items()}
        return {"timestamp": entry["timestamp"], **values}
    return None


def latest_activity(entries: list[dict[str, Any]], running: bool) -> dict[str, str]:
    interesting = (
        "Download progress",
        "Uploading ",
        "YouTube upload complete",
        "New video detected",
        "Generating metadata",
        "Generated metadata title",
        "All Gemini keys failed",
        "Failed to process video",
        "Poll summary",
        "One-shot run uploaded",
    )
    for entry in reversed(entries):
        if any(token in entry["message"] for token in interesting):
            return {"timestamp": entry["timestamp"], "message": entry["message"]}
    return {"timestamp": "", "message": "Running" if running else "Idle"}


def upload_events_from_logs(entries: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    names: dict[str, str] = {}
    records: dict[str, dict[str, str]] = {}
    for entry in entries:
        new_match = NEW_VIDEO_PATTERN.search(entry["message"])
        if new_match:
            names[new_match.group("drive_id")] = new_match.group("name")
        tracked_match = TRACKED_PATTERN.search(entry["message"])
        if tracked_match:
            drive_id = tracked_match.group("drive_id")
            records[drive_id] = {
                "drive_id": drive_id,
                "youtube_id": tracked_match.group("youtube_id"),
                "file_name": names.get(drive_id, ""),
                "uploaded_at": entry["timestamp"],
            }
    return records


def uploaded_records(uploaded_log: Path, entries: list[dict[str, Any]]) -> list[dict[str, str]]:
    log_records = upload_events_from_logs(entries)
    records: list[dict[str, str]] = []
    if not uploaded_log.exists():
        return records
    for line in uploaded_log.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split("\t")
        drive_id = parts[0].split()[0]
        fallback = log_records.get(drive_id, {})
        records.append(
            {
                "drive_id": drive_id,
                "uploaded_at": parts[1] if len(parts) > 1 else fallback.get("uploaded_at", ""),
                "youtube_id": parts[2] if len(parts) > 2 else fallback.get("youtube_id", ""),
                "file_name": parts[3] if len(parts) > 3 else fallback.get("file_name", ""),
            }
        )
    return list(reversed(records))


def dashboard_state(env_file: Path) -> dict[str, Any]:
    env = read_env_file(env_file)
    log_file = env_path(env, "LOG_FILE", BASE_DIR / "nashik-pg-uploader.log")
    uploaded_log = env_path(env, "UPLOADED_LOG", BASE_DIR / "uploaded.txt")
    drive_token = env_path(env, "DRIVE_TOKEN_FILE", BASE_DIR / "token-drive.json")
    youtube_token = env_path(env, "YOUTUBE_TOKEN_FILE", BASE_DIR / "token-youtube.json")
    drive_credentials = env_path(
        env,
        "DRIVE_CREDENTIALS_FILE",
        env_path(env, "GOOGLE_CREDENTIALS_FILE", BASE_DIR / "credentials.json"),
    )
    youtube_credentials = env_path(
        env,
        "YOUTUBE_CREDENTIALS_FILE",
        env_path(env, "GOOGLE_CREDENTIALS_FILE", BASE_DIR / "credentials.json"),
    )

    entries = parse_log_entries(tail_lines(log_file, limit=1200))
    service = service_status()
    processes = uploader_processes()
    running = bool(processes)
    summary = last_summary(entries)
    uploads = uploaded_records(uploaded_log, entries)
    errors = [entry for entry in entries if entry["level"] == "ERROR"]
    warnings = [entry for entry in entries if entry["level"] == "WARNING"]

    issues: list[str] = []
    if not drive_credentials.exists():
        issues.append("Drive credentials missing")
    if not youtube_credentials.exists():
        issues.append("YouTube credentials missing")
    if not drive_token.exists():
        issues.append("Drive token missing")
    if not youtube_token.exists():
        issues.append("YouTube token missing")
    if service["available"] and not service["active"] and not running:
        issues.append("Service is not active")
    if summary and summary["failed"] > 0:
        issues.append(f"{summary['failed']} failed item(s) in last poll")

    return {
        "generated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "project_path": str(BASE_DIR),
        "health": "attention" if issues else "ok",
        "issues": issues,
        "service": service,
        "processes": processes,
        "activity": latest_activity(entries, running),
        "summary": summary,
        "uploads": {"count": len(uploads), "latest": uploads[0] if uploads else None},
        "tokens": {"drive": file_status(drive_token), "youtube": file_status(youtube_token)},
        "credentials": {"drive": file_status(drive_credentials), "youtube": file_status(youtube_credentials)},
        "config": {
            "env_file": str(env_file),
            "drive_folder_id": mask_value(env.get("DRIVE_FOLDER_ID", "")),
            "poll_interval_seconds": env.get("POLL_INTERVAL_SECONDS", "300"),
            "gemini_model": env.get("GEMINI_MODEL", "gemini-2.5-flash"),
            "gemini_key_count": gemini_key_count(env),
            "youtube_privacy_status": env.get("YOUTUBE_PRIVACY_STATUS", "public"),
            "youtube_category_id": env.get("YOUTUBE_CATEGORY_ID", "22"),
            "log_file": str(log_file),
            "uploaded_log": str(uploaded_log),
        },
        "log": {
            "file": file_status(log_file),
            "errors": len(errors),
            "warnings": len(warnings),
            "last_error": errors[-1] if errors else None,
        },
    }


def start_run_once(env_file: Path) -> tuple[int, dict[str, Any]]:
    global RUN_PROCESS
    with RUN_LOCK:
        if RUN_PROCESS and RUN_PROCESS.poll() is None:
            return 409, {"ok": False, "message": "A dashboard run is already active", "pid": RUN_PROCESS.pid}
        active = uploader_processes()
        if active:
            return 409, {"ok": False, "message": "Uploader process already running", "processes": active}
        python_path = BASE_DIR / "venv" / "bin" / "python"
        if not python_path.exists():
            python_path = Path(sys.executable)
        command = [
            str(python_path),
            str(BASE_DIR / "drive_to_youtube_uploader.py"),
            "--env-file",
            str(env_file),
            "once",
        ]
        RUN_PROCESS = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return 202, {"ok": True, "message": "Started one-shot uploader run", "pid": RUN_PROCESS.pid}


# ── Multi-client helpers ─────────────────────────────────────────────────────────

def load_config_json(config_path: Path = DEFAULT_CONFIG_JSON) -> dict[str, Any]:
    """Return the raw config dict from config.json, or {} if absent."""
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve(base: Path, rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else base / p


def client_state(client: dict[str, Any], config_data: dict[str, Any], env_file: Path) -> dict[str, Any]:
    """Build a status dict for a single client entry from config.json."""
    name = client.get("name", "unknown")
    log_file = _resolve(BASE_DIR, client.get("log_file", f"logs/{name}-uploader.log"))
    state_file = _resolve(BASE_DIR, client.get("state_file", f"state/uploaded_{name}.txt"))
    
    drive_data = config_data.get("drive", {})
    drive_token = _resolve(BASE_DIR, drive_data.get("token_file", "tokens/token_sid_drive.json"))
    youtube_token = _resolve(BASE_DIR, client.get("youtube_token_file", f"tokens/token_{name}_youtube.json"))
    drive_creds = _resolve(BASE_DIR, drive_data.get("credentials_file", "credentials/sid.json"))
    youtube_creds = _resolve(BASE_DIR, client.get("youtube_credentials_file", f"credentials/{name}-youtube.json"))

    entries = parse_log_entries(tail_lines(log_file, limit=600))
    summary = last_summary(entries)
    uploads = uploaded_records(state_file, entries)
    errors = [e for e in entries if e["level"] == "ERROR"]
    warnings = [e for e in entries if e["level"] == "WARNING"]
    processes = uploader_processes()
    running = bool(processes)

    issues: list[str] = []
    if not drive_creds.exists():
        issues.append("Drive credentials missing")
    if not youtube_creds.exists():
        issues.append("YouTube credentials missing")
    if not drive_token.exists():
        issues.append("Drive token missing")
    if not youtube_token.exists():
        issues.append("YouTube token missing")
    if summary and summary["failed"] > 0:
        issues.append(f"{summary['failed']} failed item(s) in last poll")

    return {
        "name": name,
        "drive_folder_id": client.get("drive_folder_id", ""),
        "health": "attention" if issues else "ok",
        "issues": issues,
        "running": running,
        "activity": latest_activity(entries, running),
        "summary": summary,
        "uploads": {"count": len(uploads), "latest": uploads[0] if uploads else None},
        "tokens": {
            "drive": file_status(drive_token),
            "youtube": file_status(youtube_token),
        },
        "credentials": {
            "drive": file_status(drive_creds),
            "youtube": file_status(youtube_creds),
        },
        "log": {
            "file": file_status(log_file),
            "errors": len(errors),
            "warnings": len(warnings),
            "last_error": errors[-1] if errors else None,
        },
    }


def all_clients_status(env_file: Path) -> dict[str, Any]:
    """Aggregate status across all clients from config.json."""
    config_data = load_config_json()
    clients = config_data.get("clients", [])
    generated_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    if not clients:
        # Fall back to single-client legacy view
        return {"generated_at": generated_at, "multi": False,
                "clients": [dashboard_state(env_file)]}
    client_states = [client_state(c, config_data, env_file) for c in clients]
    overall_health = "attention" if any(c["health"] == "attention" for c in client_states) else "ok"
    return {
        "generated_at": generated_at,
        "multi": True,
        "health": overall_health,
        "clients": client_states,
    }


def client_logs(client_name: str, limit: int = 200) -> list[dict[str, Any]]:
    """Return parsed log entries for a specific client."""
    config_data = load_config_json()
    for c in config_data.get("clients", []):
        if c.get("name") == client_name:
            log_file = _resolve(BASE_DIR, c.get("log_file", f"logs/{client_name}-uploader.log"))
            return parse_log_entries(tail_lines(log_file, limit=max(1, min(limit, 1000))))
    return []


def client_uploads(client_name: str) -> list[dict[str, str]]:
    """Return upload records for a specific client."""
    config_data = load_config_json()
    for c in config_data.get("clients", []):
        if c.get("name") == client_name:
            log_file = _resolve(BASE_DIR, c.get("log_file", f"logs/{client_name}-uploader.log"))
            state_file = _resolve(BASE_DIR, c.get("state_file", f"state/uploaded_{client_name}.txt"))
            entries = parse_log_entries(tail_lines(log_file, limit=1200))
            return uploaded_records(state_file, entries)
    return []


def start_run_client(client_name: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    """Trigger a one-shot uploader run for a specific client."""
    with RUN_LOCK:
        proc = RUN_PROCESSES.get(client_name)
        if proc and proc.poll() is None:
            return 409, {"ok": False, "message": f"Run already active for {client_name}", "pid": proc.pid}
        python_path = BASE_DIR / "venv" / "bin" / "python"
        if not python_path.exists():
            python_path = Path(sys.executable)
        command = [
            str(python_path),
            str(BASE_DIR / "drive_to_youtube_uploader.py"),
            "--env-file", str(env_file),
            "--client", client_name,
            "once",
        ]
        proc = subprocess.Popen(command, cwd=BASE_DIR,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        RUN_PROCESSES[client_name] = proc
        return 202, {"ok": True, "message": f"Started run for {client_name}", "pid": proc.pid}


def start_run_all(env_file: Path) -> tuple[int, dict[str, Any]]:
    """Trigger a one-shot uploader run for ALL clients."""
    config_data = load_config_json()
    if not config_data.get("clients"):
        return start_run_once(env_file)


# ── Client management ─────────────────────────────────────────────────────────

def save_config_json(data: dict[str, Any], config_path: Path = DEFAULT_CONFIG_JSON) -> None:
    config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def add_client(
    name: str,
    drive_folder_id: str,
    youtube_creds_bytes: bytes,
    knowledge_bytes: bytes,
) -> tuple[int, dict[str, Any]]:
    """Add a new client: save files, update config.json, create empty state/log."""
    slug = re.sub(r"[^a-z0-9_-]", "", name.lower().strip())
    if not slug:
        return 400, {"ok": False, "error": "Invalid client name"}
    if not drive_folder_id.strip():
        return 400, {"ok": False, "error": "Drive folder ID is required"}

    config_data = load_config_json()
    existing = [c["name"] for c in config_data.get("clients", [])]
    if slug in existing:
        return 409, {"ok": False, "error": f"Client '{slug}' already exists"}

    # Validate YouTube credentials JSON
    try:
        json.loads(youtube_creds_bytes)
    except Exception:
        return 400, {"ok": False, "error": "YouTube credentials file is not valid JSON"}

    # Save files
    creds_path = BASE_DIR / "credentials" / f"{slug}.json"
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_bytes(youtube_creds_bytes)

    kb_path = BASE_DIR / "knowledge" / f"{slug}.txt"
    kb_path.parent.mkdir(parents=True, exist_ok=True)
    kb_path.write_bytes(knowledge_bytes)

    state_path = BASE_DIR / "state" / f"uploaded_{slug}.txt"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    if not state_path.exists():
        state_path.write_text("", encoding="utf-8")

    log_path = BASE_DIR / "logs" / f"{slug}-uploader.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if not log_path.exists():
        log_path.write_text("", encoding="utf-8")

    # Append to config.json
    new_entry = {
        "name": slug,
        "drive_folder_id": drive_folder_id.strip(),
        "youtube_credentials_file": f"credentials/{slug}.json",
        "youtube_token_file": f"tokens/token_{slug}_yt.json",
        "log_file": f"logs/{slug}-uploader.log",
        "state_file": f"state/uploaded_{slug}.txt",
    }
    clients = config_data.get("clients", [])
    clients.append(new_entry)
    config_data["clients"] = clients
    save_config_json(config_data)

    return 201, {"ok": True, "client": new_entry, "message": f"Client '{slug}' added. Now authorize YouTube."}


def delete_client(name: str, keep_files: bool = True) -> tuple[int, dict[str, Any]]:
    config_data = load_config_json()
    clients = config_data.get("clients", [])
    remaining = [c for c in clients if c["name"] != name]
    if len(remaining) == len(clients):
        return 404, {"ok": False, "error": f"Client '{name}' not found"}
    config_data["clients"] = remaining
    save_config_json(config_data)
    if not keep_files:
        for p in [
            BASE_DIR / "credentials" / f"{name}.json",
            BASE_DIR / "tokens" / f"token_{name}_yt.json",
            BASE_DIR / "knowledge" / f"{name}.txt",
        ]:
            p.unlink(missing_ok=True)
    return 200, {"ok": True, "message": f"Client '{name}' removed"}


def authorize_client_youtube(name: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    """Trigger interactive YouTube OAuth for a specific client."""
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    command = [
        str(python_path),
        str(BASE_DIR / "drive_to_youtube_uploader.py"),
        "--env-file", str(env_file),
        "--client", name,
        "authorize-youtube",
    ]
    try:
        proc = subprocess.Popen(
            command, cwd=BASE_DIR,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            start_new_session=False,
        )
        return 202, {"ok": True, "message": f"OAuth flow started for '{name}'. Check browser.", "pid": proc.pid}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


def get_knowledge(name: str) -> tuple[int, dict[str, Any]]:
    kb_path = BASE_DIR / "knowledge" / f"{name}.txt"
    if not kb_path.exists():
        return 404, {"ok": False, "error": "Knowledge base not found"}
    return 200, {"ok": True, "content": kb_path.read_text(encoding="utf-8")}


def put_knowledge(name: str, content: str) -> tuple[int, dict[str, Any]]:
    kb_path = BASE_DIR / "knowledge" / f"{name}.txt"
    kb_path.parent.mkdir(parents=True, exist_ok=True)
    kb_path.write_text(content, encoding="utf-8")
    return 200, {"ok": True, "message": "Knowledge base updated"}


def get_settings(env_file: Path) -> dict[str, Any]:
    env = read_env_file(env_file)
    config_data = load_config_json()
    drive_creds = _resolve(BASE_DIR, config_data.get("drive", {}).get("credentials_file", "credentials/sid.json"))
    drive_token = _resolve(BASE_DIR, config_data.get("drive", {}).get("token_file", "tokens/token_sid_drive.json"))
    return {
        "drive_credentials": {"path": str(drive_creds), "exists": drive_creds.exists()},
        "drive_token": {"path": str(drive_token), "exists": drive_token.exists()},
        "gemini_api_key_set": bool(
            env.get("GEMINI_API_KEY", "").strip() or
            env.get("GEMINI_API_KEY_1", "").strip() or
            env.get("GEMINI_API_KEYS", "").strip()
        ),
        "gemini_key_count": sum(
            1 for k, v in env.items()
            if (k == "GEMINI_API_KEY" or re.match(r"GEMINI_API_KEY_\d+", k)) and v.strip()
        ),
        "telegram_token_set": bool(env.get("TELEGRAM_BOT_TOKEN", "").strip()),
        "poll_interval_seconds": int(env.get("POLL_INTERVAL_SECONDS", "3600")),
        "gemini_model": env.get("GEMINI_MODEL", "gemini-2.5-flash"),
    }


def update_settings(env_file: Path, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Update .env values that are allowed to change from UI."""
    allowed = {
        "POLL_INTERVAL_SECONDS": str,
        "GEMINI_MODEL": str,
        "TELEGRAM_BOT_TOKEN": str,
        "GEMINI_API_KEY_1": str,
    }
    lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    for key, cast in allowed.items():
        if key in payload:
            val = str(payload[key]).strip()
            pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
            updated = False
            next_lines = []
            for line in lines:
                if pattern.match(line):
                    next_lines.append(f"{key}={val}")
                    updated = True
                else:
                    next_lines.append(line)
            if not updated:
                next_lines.append(f"{key}={val}")
            lines = next_lines
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 200, {"ok": True, "message": "Settings saved"}
    with RUN_LOCK:
        python_path = BASE_DIR / "venv" / "bin" / "python"
        if not python_path.exists():
            python_path = Path(sys.executable)
        command = [
            str(python_path),
            str(BASE_DIR / "drive_to_youtube_uploader.py"),
            "--env-file", str(env_file),
            "once",
        ]
        proc = subprocess.Popen(command, cwd=BASE_DIR,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        return 202, {"ok": True, "message": "Started all-clients run", "pid": proc.pid}


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nashik PG Automation Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-soft: #f9fbff;
      --text: #162033;
      --muted: #667085;
      --line: #d9e0ea;
      --blue: #2563eb;
      --green: #15803d;
      --amber: #b45309;
      --red: #b42318;
      --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell {
      width: min(1440px, calc(100% - 32px));
      margin: 0 auto;
      padding: 20px 0 28px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0 18px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button, select {
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      font: inherit;
    }
    button {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    button:hover { border-color: #a8b3c4; }
    button:disabled { opacity: .6; cursor: wait; }
    .primary {
      background: var(--blue);
      border-color: var(--blue);
      color: white;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      white-space: nowrap;
    }
    .toggle input { margin: 0; }
    .status-pill {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--muted);
      flex: 0 0 auto;
    }
    .dot.ok { background: var(--green); }
    .dot.warn { background: var(--amber); }
    .dot.err { background: var(--red); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .card {
      min-height: 112px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .value {
      margin-top: 8px;
      font-size: 22px;
      font-weight: 700;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .detail {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr);
      gap: 14px;
      align-items: start;
    }
    .panel {
      min-width: 0;
      overflow: hidden;
    }
    .panel-head {
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-soft);
    }
    .panel-title {
      font-weight: 700;
      line-height: 1.2;
    }
    .panel-body {
      padding: 14px;
    }
    .stack {
      display: grid;
      gap: 14px;
    }
    .kv {
      display: grid;
      grid-template-columns: 170px minmax(0, 1fr);
      gap: 8px 14px;
      align-items: start;
    }
    .kv dt {
      color: var(--muted);
    }
    .kv dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .06em;
      background: var(--panel-soft);
    }
    .logs {
      display: grid;
      gap: 6px;
      max-height: 560px;
      overflow: auto;
      padding-right: 4px;
    }
    .log-line {
      display: grid;
      grid-template-columns: 142px 76px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 8px 10px;
      border: 1px solid #e7ecf3;
      border-radius: 6px;
      background: #fff;
    }
    .level {
      font-weight: 700;
      font-size: 12px;
    }
    .level.INFO { color: var(--blue); }
    .level.WARNING { color: var(--amber); }
    .level.ERROR { color: var(--red); }
    .message {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .empty {
      color: var(--muted);
      padding: 12px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      background: var(--panel-soft);
    }
    .notice {
      display: none;
      margin-bottom: 14px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid #fed7aa;
      background: #fff7ed;
      color: #7c2d12;
    }
    .notice.show { display: block; }

    @media (max-width: 1080px) {
      .metrics { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      .shell { width: min(100% - 20px, 1440px); padding-top: 10px; }
      .topbar { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; width: 100%; }
      .metrics { grid-template-columns: 1fr; }
      .kv { grid-template-columns: 1fr; }
      .log-line { grid-template-columns: 1fr; }
      button, select, .toggle { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar">
      <div>
        <h1>Nashik PG Automation</h1>
        <div class="subtitle" id="generatedAt">Loading dashboard</div>
      </div>
      <div class="actions">
        <span class="status-pill"><span id="healthDot" class="dot"></span><span id="healthText">Loading</span></span>
        <label class="toggle"><input id="autoRefresh" type="checkbox" checked> Auto refresh</label>
        <button id="refreshBtn" type="button">Refresh</button>
        <button id="runBtn" class="primary" type="button">Run Once</button>
      </div>
    </section>

    <div id="notice" class="notice"></div>

    <section class="metrics">
      <article class="card">
        <div>
          <div class="label">Service</div>
          <div id="serviceValue" class="value">-</div>
        </div>
        <div id="serviceDetail" class="detail">-</div>
      </article>
      <article class="card">
        <div>
          <div class="label">Last Poll</div>
          <div id="pollValue" class="value">-</div>
        </div>
        <div id="pollDetail" class="detail">-</div>
      </article>
      <article class="card">
        <div>
          <div class="label">Uploads</div>
          <div id="uploadValue" class="value">-</div>
        </div>
        <div id="uploadDetail" class="detail">-</div>
      </article>
      <article class="card">
        <div>
          <div class="label">Tokens</div>
          <div id="tokenValue" class="value">-</div>
        </div>
        <div id="tokenDetail" class="detail">-</div>
      </article>
      <article class="card">
        <div>
          <div class="label">Gemini</div>
          <div id="geminiValue" class="value">-</div>
        </div>
        <div id="geminiDetail" class="detail">-</div>
      </article>
    </section>

    <section class="grid">
      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Current Activity</div>
          </div>
          <div class="panel-body">
            <dl class="kv">
              <dt>Latest event</dt><dd id="activityMessage">-</dd>
              <dt>Event time</dt><dd id="activityTime">-</dd>
              <dt>Folder</dt><dd id="folderId" class="mono">-</dd>
              <dt>Project path</dt><dd id="projectPath" class="mono">-</dd>
            </dl>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Upload History</div>
          </div>
          <div class="panel-body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>File</th>
                    <th>Drive ID</th>
                    <th>YouTube ID</th>
                  </tr>
                </thead>
                <tbody id="uploadRows"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Recent Logs</div>
            <select id="levelFilter" aria-label="Log level filter">
              <option value="">All levels</option>
              <option value="ERROR">Errors</option>
              <option value="WARNING">Warnings</option>
              <option value="INFO">Info</option>
            </select>
          </div>
          <div class="panel-body">
            <div id="logs" class="logs"></div>
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Configuration</div>
          </div>
          <div class="panel-body">
            <dl class="kv">
              <dt>Poll interval</dt><dd id="pollInterval">-</dd>
              <dt>Privacy</dt><dd id="privacyStatus">-</dd>
              <dt>Category</dt><dd id="categoryId">-</dd>
              <dt>Env file</dt><dd id="envFile" class="mono">-</dd>
              <dt>Log file</dt><dd id="logFile" class="mono">-</dd>
              <dt>Uploaded log</dt><dd id="uploadedLog" class="mono">-</dd>
            </dl>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Files</div>
          </div>
          <div class="panel-body">
            <dl class="kv">
              <dt>Drive token</dt><dd id="driveToken">-</dd>
              <dt>YouTube token</dt><dd id="youtubeToken">-</dd>
              <dt>Drive credentials</dt><dd id="driveCreds">-</dd>
              <dt>YouTube credentials</dt><dd id="youtubeCreds">-</dd>
              <dt>Log size</dt><dd id="logSize">-</dd>
              <dt>Errors / warnings</dt><dd id="logCounts">-</dd>
            </dl>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">Issues</div>
          </div>
          <div class="panel-body" id="issues"></div>
        </section>
      </div>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    let autoTimer = null;
    let lastLogs = [];

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setText(id, value) {
      $(id).textContent = value ?? "-";
    }

    function fileLabel(file) {
      if (!file || !file.exists) return "Missing";
      return "OK - " + file.modified;
    }

    function bytes(size) {
      if (!size) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let value = size;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return value.toFixed(index === 0 ? 0 : 1) + " " + units[index];
    }

    function renderStatus(data) {
      setText("generatedAt", "Updated " + data.generated_at);
      $("healthDot").className = "dot " + (data.health === "ok" ? "ok" : "warn");
      setText("healthText", data.health === "ok" ? "Healthy" : "Needs attention");

      const service = data.service || {};
      setText("serviceValue", service.available ? service.state : "unavailable");
      setText("serviceDetail", service.active ? "systemd service running" : ((data.processes || []).length ? "manual run active" : "no active process"));

      const summary = data.summary;
      setText("pollValue", summary ? (summary.uploaded + " uploaded") : "No poll");
      setText("pollDetail", summary ? `${summary.total} total, ${summary.new} new, ${summary.failed} failed` : "No summary yet");

      setText("uploadValue", data.uploads.count);
      setText("uploadDetail", data.uploads.latest ? (data.uploads.latest.youtube_id || data.uploads.latest.drive_id) : "No uploads tracked");

      const driveToken = data.tokens.drive && data.tokens.drive.exists;
      const youtubeToken = data.tokens.youtube && data.tokens.youtube.exists;
      setText("tokenValue", driveToken && youtubeToken ? "Ready" : "Missing");
      setText("tokenDetail", `Drive ${driveToken ? "OK" : "missing"}, YouTube ${youtubeToken ? "OK" : "missing"}`);

      setText("geminiValue", data.config.gemini_model);
      setText("geminiDetail", data.config.gemini_key_count + " key(s) configured");

      setText("activityMessage", data.activity.message);
      setText("activityTime", data.activity.timestamp || "-");
      setText("folderId", data.config.drive_folder_id);
      setText("projectPath", data.project_path);

      setText("pollInterval", data.config.poll_interval_seconds + " seconds");
      setText("privacyStatus", data.config.youtube_privacy_status);
      setText("categoryId", data.config.youtube_category_id);
      setText("envFile", data.config.env_file);
      setText("logFile", data.config.log_file);
      setText("uploadedLog", data.config.uploaded_log);

      setText("driveToken", fileLabel(data.tokens.drive));
      setText("youtubeToken", fileLabel(data.tokens.youtube));
      setText("driveCreds", fileLabel(data.credentials.drive));
      setText("youtubeCreds", fileLabel(data.credentials.youtube));
      setText("logSize", bytes(data.log.file.size) + " - " + data.log.file.modified);
      setText("logCounts", `${data.log.errors} errors / ${data.log.warnings} warnings`);

      const issues = $("issues");
      if (!data.issues.length) {
        issues.innerHTML = '<div class="empty">No active issues detected.</div>';
      } else {
        issues.innerHTML = data.issues.map((issue) => `<div class="empty">${escapeHtml(issue)}</div>`).join("");
      }

      const notice = $("notice");
      if (data.issues.length) {
        notice.classList.add("show");
        notice.textContent = data.issues.join(" | ");
      } else {
        notice.classList.remove("show");
        notice.textContent = "";
      }
    }

    function renderUploads(records) {
      const rows = $("uploadRows");
      if (!records.length) {
        rows.innerHTML = '<tr><td colspan="4">No upload history yet.</td></tr>';
        return;
      }
      rows.innerHTML = records.map((record) => `
        <tr>
          <td>${escapeHtml(record.uploaded_at || "-")}</td>
          <td>${escapeHtml(record.file_name || "-")}</td>
          <td class="mono">${escapeHtml(record.drive_id)}</td>
          <td class="mono">${escapeHtml(record.youtube_id || "-")}</td>
        </tr>
      `).join("");
    }

    function renderLogs() {
      const filter = $("levelFilter").value;
      const logs = filter ? lastLogs.filter((entry) => entry.level === filter) : lastLogs;
      const container = $("logs");
      if (!logs.length) {
        container.innerHTML = '<div class="empty">No logs for this filter.</div>';
        return;
      }
      container.innerHTML = logs.slice(-120).reverse().map((entry) => `
        <div class="log-line">
          <div class="mono">${escapeHtml(entry.timestamp || "")}</div>
          <div class="level ${escapeHtml(entry.level)}">${escapeHtml(entry.level || "RAW")}</div>
          <div class="message">${escapeHtml(entry.message)}</div>
        </div>
      `).join("");
    }

    async function refreshAll() {
      $("refreshBtn").disabled = true;
      try {
        const [statusRes, logsRes, uploadsRes] = await Promise.all([
          fetch("/api/status"),
          fetch("/api/logs?limit=300"),
          fetch("/api/uploads")
        ]);
        const status = await statusRes.json();
        const logs = await logsRes.json();
        const uploads = await uploadsRes.json();
        renderStatus(status);
        lastLogs = logs.entries || [];
        renderLogs();
        renderUploads(uploads.records || []);
      } catch (error) {
        const notice = $("notice");
        notice.classList.add("show");
        notice.textContent = "Dashboard refresh failed: " + error.message;
      } finally {
        $("refreshBtn").disabled = false;
      }
    }

    async function runOnce() {
      if (!confirm("Start one uploader pass now?")) return;
      $("runBtn").disabled = true;
      try {
        const response = await fetch("/api/run-once", { method: "POST" });
        const payload = await response.json();
        const notice = $("notice");
        notice.classList.add("show");
        notice.textContent = payload.message || "Run request sent";
        await refreshAll();
      } catch (error) {
        const notice = $("notice");
        notice.classList.add("show");
        notice.textContent = "Could not start run: " + error.message;
      } finally {
        $("runBtn").disabled = false;
      }
    }

    function setAutoRefresh() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
      if ($("autoRefresh").checked) {
        autoTimer = setInterval(refreshAll, 8000);
      }
    }

    $("refreshBtn").addEventListener("click", refreshAll);
    $("runBtn").addEventListener("click", runOnce);
    $("levelFilter").addEventListener("change", renderLogs);
    $("autoRefresh").addEventListener("change", setAutoRefresh);
    setAutoRefresh();
    refreshAll();
  </script>
</body>
</html>
"""



# ── Queue management ──────────────────────────────────────────────────────────

QUEUE_DIR = BASE_DIR / "queue"


def _queue_path(client_name: str) -> Path:
    return QUEUE_DIR / f"{client_name}_queue.json"


def load_queue(client_name: str) -> list[dict[str, Any]]:
    p = _queue_path(client_name)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_queue(client_name: str, items: list[dict[str, Any]]) -> None:
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    _queue_path(client_name).write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def get_all_queues() -> list[dict[str, Any]]:
    config_data = load_config_json()
    results: list[dict[str, Any]] = []
    for c in config_data.get("clients", []):
        for item in load_queue(c["name"]):
            results.append({**item, "client": c["name"]})
    return results


def generate_gemini_preview(client_name: str, filename: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    """Call Gemini to generate title/description/tags for a queued video."""
    env = read_env_file(env_file)
    # Collect all Gemini keys from env
    keys: list[str] = []
    if env.get("GEMINI_API_KEY"):
        keys.append(env["GEMINI_API_KEY"].strip())
    for k, v in env.items():
        if re.fullmatch(r"GEMINI_API_KEY_\d+", k) and v.strip():
            keys.append(v.strip())
    if not env.get("GEMINI_API_KEYS") is None:
        keys += [x.strip() for x in re.split(r"[,\s]+", env.get("GEMINI_API_KEYS", "")) if x.strip()]
    if not keys:
        return 400, {"ok": False, "error": "No Gemini API keys configured"}

    kb_path = BASE_DIR / "knowledge" / f"{client_name}.txt"
    knowledge = kb_path.read_text(encoding="utf-8") if kb_path.exists() else ""
    model = env.get("GEMINI_MODEL", "gemini-2.5-flash")
    prompt = (
        f"Generate YouTube metadata for a video file named: {filename}\n"
        f"{'Knowledge base context:\n' + knowledge if knowledge else ''}\n\n"
        "Respond ONLY with valid JSON in this exact format:\n"
        '{"title": "...", "description": "...", "tags": ["tag1","tag2","tag3"]}'
    )

    import urllib.request
    for key in keys:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            # Strip markdown fences if present
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            result = json.loads(text)
            return 200, {"ok": True, "title": result.get("title", ""), "description": result.get("description", ""), "tags": result.get("tags", [])}
        except Exception:
            continue
    return 500, {"ok": False, "error": "All Gemini keys failed"}


def queue_preview(client_name: str, file_id: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    items = load_queue(client_name)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        return 404, {"ok": False, "error": "Queue item not found"}
    status, result = generate_gemini_preview(client_name, item.get("filename", file_id), env_file)
    if result.get("ok"):
        # Update cached preview in queue
        for i in items:
            if i["file_id"] == file_id:
                i.update({"title": result["title"], "description": result["description"], "tags": result["tags"]})
        save_queue(client_name, items)
    return status, result


def queue_approve(client_name: str, file_id: str, body: dict[str, Any], env_file: Path) -> tuple[int, dict[str, Any]]:
    items = load_queue(client_name)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        return 404, {"ok": False, "error": "Queue item not found"}
    # Update with (possibly edited) metadata
    item.update({
        "title": body.get("title", item.get("title", "")),
        "description": body.get("description", item.get("description", "")),
        "tags": body.get("tags", item.get("tags", [])),
        "status": "approved",
    })
    save_queue(client_name, items)
    # Kick off upload via subprocess
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    command = [
        str(python_path),
        str(BASE_DIR / "drive_to_youtube_uploader.py"),
        "--env-file", str(env_file),
        "--client", client_name,
        "--approve-file-id", file_id,
        "upload-approved",
    ]
    try:
        proc = subprocess.Popen(command, cwd=BASE_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return 202, {"ok": True, "message": f"Upload started for {item.get('filename', file_id)}", "pid": proc.pid}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


def queue_reject(client_name: str, file_id: str, body: dict[str, Any], env_file: Path) -> tuple[int, dict[str, Any]]:
    items = load_queue(client_name)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        return 404, {"ok": False, "error": "Queue item not found"}
    reason = body.get("reason", "")
    filename = item.get("filename", file_id)
    # Regenerate with rejection context injected into prompt
    env = read_env_file(env_file)
    kb_path = BASE_DIR / "knowledge" / f"{client_name}.txt"
    knowledge = kb_path.read_text(encoding="utf-8") if kb_path.exists() else ""
    model = env.get("GEMINI_MODEL", "gemini-2.5-flash")
    keys: list[str] = []
    if env.get("GEMINI_API_KEY"):
        keys.append(env["GEMINI_API_KEY"].strip())
    for k, v in env.items():
        if re.fullmatch(r"GEMINI_API_KEY_\d+", k) and v.strip():
            keys.append(v.strip())
    prompt = (
        f"Generate YouTube metadata for a video file named: {filename}\n"
        f"{'Knowledge base:\n' + knowledge if knowledge else ''}\n"
        f"Previous attempt was rejected. Rejection reason: {reason}\n"
        "Please generate improved metadata. Respond ONLY with valid JSON:\n"
        '{"title": "...", "description": "...", "tags": ["tag1","tag2"]}'
    )
    import urllib.request
    for key in keys:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            result = json.loads(text)
            new_title = result.get("title", "")
            new_desc = result.get("description", "")
            new_tags = result.get("tags", [])
            for i in items:
                if i["file_id"] == file_id:
                    i.update({"title": new_title, "description": new_desc, "tags": new_tags})
            save_queue(client_name, items)
            return 200, {"ok": True, "title": new_title, "description": new_desc, "tags": new_tags}
        except Exception:
            continue
    return 500, {"ok": False, "error": "Regeneration failed"}


def queue_skip(client_name: str, file_id: str) -> tuple[int, dict[str, Any]]:
    items = load_queue(client_name)
    remaining = [i for i in items if i["file_id"] != file_id]
    if len(remaining) == len(items):
        return 404, {"ok": False, "error": "Queue item not found"}
    save_queue(client_name, remaining)
    return 200, {"ok": True, "message": "Video skipped"}


# ── Token health ──────────────────────────────────────────────────────────────

def _token_health_level(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days <= 0:
        return "expired"
    if days < 7:
        return "critical"
    if days < 14:
        return "warning"
    return "good"


def _read_token_expiry(token_path: Path) -> dict[str, Any]:
    """Read token health.

    The ``expiry`` / ``token_expiry`` field in the JSON stores the LAST
    ACCESS TOKEN expiry (Google issues access tokens valid for only 1 hour).
    This is NOT a sign that the whole authorisation is broken — as long as
    ``refresh_token`` is present in the file, the library will silently
    obtain a fresh access token on every API call.

    We therefore grade health as follows:
      * No file                 → unknown / missing
      * File present, refresh_token present → good (auto-refreshes forever)
      * File present, no refresh_token      → critical (re-authorise needed)
    The access-token expiry date is still surfaced for information only.
    """
    if not token_path.exists():
        return {"status": "missing", "expires_at": None, "days_remaining": None, "health": "unknown"}
    try:
        data = json.loads(token_path.read_text(encoding="utf-8"))
        has_refresh = bool(data.get("refresh_token"))

        # Access-token expiry (informational only — refreshes automatically)
        expiry_str = data.get("expiry") or data.get("token_expiry")
        expires_at: str | None = None
        if expiry_str:
            try:
                from datetime import timezone as _tz
                expiry_dt = datetime.fromisoformat(expiry_str.rstrip("Z").split(".")[0]).replace(tzinfo=_tz.utc)
                expires_at = expiry_dt.strftime("%Y-%m-%d %H:%M UTC")
            except Exception:
                pass

        if not has_refresh:
            # No refresh token → cannot auto-refresh → user must re-authorise
            return {
                "status": "needs_reauth",
                "expires_at": expires_at,
                "days_remaining": None,
                "health": "critical",
                "note": "refresh_token missing — re-authorisation required",
            }

        # Refresh token present → Google will auto-refresh access tokens
        return {
            "status": "valid",
            "expires_at": expires_at,
            "days_remaining": 9999,   # effectively unlimited while refresh_token lives
            "health": "good",
            "note": "refresh_token present — auto-refreshes on every run",
        }
    except Exception:
        return {"status": "unreadable", "expires_at": None, "days_remaining": None, "health": "unknown"}


def get_tokens_health() -> dict[str, Any]:
    config_data = load_config_json()
    result: dict[str, Any] = {}
    drive_data = config_data.get("drive", {})
    shared_drive_token = _resolve(BASE_DIR, drive_data.get("token_file", "tokens/token_sid_drive.json"))
    for c in config_data.get("clients", []):
        name = c["name"]
        yt_token = _resolve(BASE_DIR, c.get("youtube_token_file", f"tokens/token_{name}_yt.json"))
        result[name] = {
            "drive_token": _read_token_expiry(shared_drive_token),
            "youtube_token": _read_token_expiry(yt_token),
        }
    return result


def refresh_client_token(client_name: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    """Attempt silent OAuth refresh for a client's YouTube token."""
    config_data = load_config_json()
    client = next((c for c in config_data.get("clients", []) if c["name"] == client_name), None)
    if client is None:
        return 404, {"ok": False, "error": "Client not found"}
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    command = [
        str(python_path), str(BASE_DIR / "drive_to_youtube_uploader.py"),
        "--env-file", str(env_file), "--client", client_name, "refresh-token",
    ]
    try:
        completed = subprocess.run(command, cwd=BASE_DIR, capture_output=True, text=True, timeout=30)
        if completed.returncode == 0:
            return 200, {"ok": True, "message": "Token refreshed"}
        return 500, {"ok": False, "error": completed.stderr.strip() or "Refresh failed"}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


# ── Failed upload tracking ────────────────────────────────────────────────────

FAILED_DIR = BASE_DIR / "state"


def _failed_path(client_name: str) -> Path:
    return FAILED_DIR / f"failed_{client_name}.json"


def load_failed(client_name: str) -> list[dict[str, Any]]:
    p = _failed_path(client_name)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_failed(client_name: str, items: list[dict[str, Any]]) -> None:
    FAILED_DIR.mkdir(parents=True, exist_ok=True)
    _failed_path(client_name).write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def get_all_failed() -> list[dict[str, Any]]:
    config_data = load_config_json()
    results: list[dict[str, Any]] = []
    for c in config_data.get("clients", []):
        for item in load_failed(c["name"]):
            results.append({**item, "client": c["name"]})
    return results


def retry_failed_item(client_name: str, file_id: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    items = load_failed(client_name)
    item = next((i for i in items if i["file_id"] == file_id), None)
    if item is None:
        return 404, {"ok": False, "error": "Failed item not found"}
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    command = [
        str(python_path), str(BASE_DIR / "drive_to_youtube_uploader.py"),
        "--env-file", str(env_file), "--client", client_name,
        "--retry-file-id", file_id, "retry-upload",
    ]
    try:
        proc = subprocess.Popen(command, cwd=BASE_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for i in items:
            if i["file_id"] == file_id:
                i["status"] = "retrying"
                i["retry_count"] = i.get("retry_count", 0) + 1
        save_failed(client_name, items)
        return 202, {"ok": True, "message": f"Retry started for {item.get('filename', file_id)}", "pid": proc.pid}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


def dismiss_failed_item(client_name: str, file_id: str) -> tuple[int, dict[str, Any]]:
    items = load_failed(client_name)
    remaining = [i for i in items if i["file_id"] != file_id]
    if len(remaining) == len(items):
        return 404, {"ok": False, "error": "Failed item not found"}
    save_failed(client_name, remaining)
    return 200, {"ok": True, "message": "Dismissed"}


def retry_all_failed(env_file: Path) -> tuple[int, dict[str, Any]]:
    config_data = load_config_json()
    retried = 0
    for c in config_data.get("clients", []):
        for item in load_failed(c["name"]):
            if item.get("status") not in ("permanently_failed", "retrying"):
                retry_failed_item(c["name"], item["file_id"], env_file)
                retried += 1
    return 200, {"ok": True, "retried": retried}


# ── Upload scheduler ──────────────────────────────────────────────────────────

def get_all_schedules() -> dict[str, Any]:
    config_data = load_config_json()
    result: dict[str, Any] = {}
    for c in config_data.get("clients", []):
        result[c["name"]] = c.get("schedule", {
            "enabled": False, "upload_times": [], "timezone": "Asia/Kolkata",
            "max_per_day": 2, "days_active": ["mon","tue","wed","thu","fri","sat","sun"],
        })
    return result


def update_client_schedule(client_name: str, schedule: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    config_data = load_config_json()
    found = False
    for c in config_data.get("clients", []):
        if c["name"] == client_name:
            c["schedule"] = schedule
            found = True
            break
    if not found:
        return 404, {"ok": False, "error": "Client not found"}
    save_config_json(config_data)
    return 200, {"ok": True, "message": "Schedule updated"}


def get_upcoming_schedule(days: int = 7) -> list[dict[str, Any]]:
    """Return planned upload slots for the next N days across all clients."""
    config_data = load_config_json()
    now_local = datetime.now()
    day_abbrs = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    events: list[dict[str, Any]] = []
    for c in config_data.get("clients", []):
        sched = c.get("schedule", {})
        if not sched.get("enabled"):
            continue
        times = sched.get("upload_times", [])
        active_days = set(sched.get("days_active", day_abbrs))
        for day_offset in range(days):
            target_date = now_local.date() + __import__("datetime").timedelta(days=day_offset)
            day_name = day_abbrs[target_date.weekday()]
            if day_name not in active_days:
                continue
            for t in times:
                events.append({
                    "client": c["name"],
                    "date": str(target_date),
                    "time": t,
                    "datetime": f"{target_date} {t}",
                })
    events.sort(key=lambda e: e["datetime"])
    return events


# ── Client profile ────────────────────────────────────────────────────────────

def get_client_profile(client_name: str, env_file: Path) -> tuple[int, dict[str, Any]]:
    config_data = load_config_json()
    client = next((c for c in config_data.get("clients", []) if c["name"] == client_name), None)
    if client is None:
        return 404, {"ok": False, "error": "Client not found"}
    state = client_state(client, config_data, env_file)
    token_health = get_tokens_health().get(client_name, {})
    schedule = client.get("schedule", {})
    kb_path = BASE_DIR / "knowledge" / f"{client_name}.txt"
    knowledge_chars = len(kb_path.read_text(encoding="utf-8")) if kb_path.exists() else 0
    return 200, {
        "ok": True,
        "profile": {
            **state,
            "token_health": token_health,
            "schedule": schedule,
            "knowledge_chars": knowledge_chars,
            "youtube_credentials_file": client.get("youtube_credentials_file", ""),
            "drive_folder_id": client.get("drive_folder_id", ""),
        },
    }


def get_client_videos(client_name: str) -> tuple[int, dict[str, Any]]:
    config_data = load_config_json()
    client = next((c for c in config_data.get("clients", []) if c["name"] == client_name), None)
    if client is None:
        return 404, {"ok": False, "error": "Client not found"}
    videos = client_uploads(client_name)
    return 200, {"ok": True, "client": client_name, "videos": videos}


# ── Gemini test + Drive test ──────────────────────────────────────────────────

def test_drive_connection(env_file: Path) -> tuple[int, dict[str, Any]]:
    """Ping Drive API listing to verify credentials & token work."""
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    script = (
        "import sys, json\n"
        "try:\n"
        "    from google.oauth2.credentials import Credentials\n"
        "    from googleapiclient.discovery import build\n"
        "    import json as _j\n"
        "    creds = Credentials.from_authorized_user_file(sys.argv[1])\n"
        "    svc = build('drive','v3',credentials=creds,cache_discovery=False)\n"
        "    svc.files().list(pageSize=1,fields='files(id)').execute()\n"
        "    print('ok')\n"
        "except Exception as e:\n"
        "    print('err:'+str(e))\n"
    )
    config_data = load_config_json()
    token_file = _resolve(BASE_DIR, config_data.get("drive", {}).get("token_file", "tokens/token_sid_drive.json"))
    try:
        completed = subprocess.run(
            [str(python_path), "-c", script, str(token_file)],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=15,
        )
        out = completed.stdout.strip()
        if out == "ok":
            return 200, {"ok": True, "message": "Drive connection successful"}
        return 500, {"ok": False, "error": out.replace("err:", "") or completed.stderr.strip()}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


def send_telegram_test(env_file: Path) -> tuple[int, dict[str, Any]]:
    env = read_env_file(env_file)
    token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = env.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return 400, {"ok": False, "error": "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set"}
    import urllib.request as _req
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": "✅ BANKAIFTP dashboard test message — Telegram is connected!"}).encode()
    try:
        r = _req.urlopen(_req.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST"), timeout=10)
        if r.status == 200:
            return 200, {"ok": True, "message": "Test message sent"}
        return 500, {"ok": False, "error": f"HTTP {r.status}"}
    except Exception as exc:
        return 500, {"ok": False, "error": str(exc)}


class DashboardHandler(BaseHTTPRequestHandler):
    env_file: Path = DEFAULT_ENV_FILE

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path in {"/", "/index.html"}:
            text_response(self, dashboard_html())
            return
        # ── Client management ────────────────────────────────────────────────
        if path == "/api/clients":
            json_response(self, {"clients": load_config_json().get("clients", [])})
            return
        if path == "/api/status":
            json_response(self, all_clients_status(self.env_file))
            return
        if path == "/api/settings":
            json_response(self, get_settings(self.env_file))
            return
        # ── New feature routes ──────────────────────────────────────────────
        # /api/queue — all pending queue items
        if path == "/api/queue":
            json_response(self, {"items": get_all_queues()})
            return
        # /api/tokens/health
        if path == "/api/tokens/health":
            json_response(self, get_tokens_health())
            return
        # /api/failed — all failed uploads
        if path == "/api/failed":
            json_response(self, {"items": get_all_failed()})
            return
        # /api/schedule — all schedules
        if path == "/api/schedule":
            json_response(self, get_all_schedules())
            return
        # /api/schedule/upcoming
        if path == "/api/schedule/upcoming":
            query = parse_qs(parsed.query)
            days = int(query.get("days", ["7"])[0])
            json_response(self, {"events": get_upcoming_schedule(days)})
            return
        # /api/clients/{name}/profile
        m = re.match(r"^/api/clients/([^/]+)/profile$", path)
        if m:
            status, payload = get_client_profile(m.group(1), self.env_file)
            json_response(self, payload, status=status)
            return
        # /api/clients/{name}/videos
        m = re.match(r"^/api/clients/([^/]+)/videos$", path)
        if m:
            status, payload = get_client_videos(m.group(1))
            json_response(self, payload, status=status)
            return
        # /api/clients/{name}/knowledge
        m = re.match(r"^/api/clients/([^/]+)/knowledge$", path)
        if m:
            status, payload = get_knowledge(m.group(1))
            json_response(self, payload, status=status)
            return
        # /api/logs/clientname
        if path.startswith("/api/logs/"):
            name = path[len("/api/logs/"):].strip("/")
            query = parse_qs(parsed.query)
            limit = int(query.get("limit", ["200"])[0])
            json_response(self, {"client": name, "entries": client_logs(name, limit)})
            return
        # /api/uploads/clientname
        if path.startswith("/api/uploads/"):
            name = path[len("/api/uploads/"):].strip("/")
            json_response(self, {"client": name, "records": client_uploads(name)})
            return
        # Legacy single-client endpoints
        if path == "/api/logs":
            query = parse_qs(parsed.query)
            limit = int(query.get("limit", ["200"])[0])
            env = read_env_file(self.env_file)
            log_file = env_path(env, "LOG_FILE", BASE_DIR / "nashik-pg-uploader.log")
            entries = parse_log_entries(tail_lines(log_file, limit=max(1, min(limit, 1000))))
            json_response(self, {"entries": entries})
            return
        if path == "/api/uploads":
            env = read_env_file(self.env_file)
            log_file = env_path(env, "LOG_FILE", BASE_DIR / "nashik-pg-uploader.log")
            uploaded_log = env_path(env, "UPLOADED_LOG", BASE_DIR / "uploaded.txt")
            entries = parse_log_entries(tail_lines(log_file, limit=1200))
            json_response(self, {"records": uploaded_records(uploaded_log, entries)})
            return
        json_response(self, {"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        m = re.match(r"^/api/clients/([^/]+)$", path)
        if m:
            query = parse_qs(parsed.query)
            keep = query.get("keep_files", ["true"])[0].lower() != "false"
            status, payload = delete_client(m.group(1), keep_files=keep)
            json_response(self, payload, status=status)
            return
        json_response(self, {"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        def _read_json_body() -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            try:
                return json.loads(raw)
            except Exception:
                return {}

        # /api/schedule/{client}
        m = re.match(r"^/api/schedule/([^/]+)$", path)
        if m:
            sched = _read_json_body()
            status, payload = update_client_schedule(m.group(1), sched)
            json_response(self, payload, status=status)
            return
        # /api/clients/{name}/knowledge
        m = re.match(r"^/api/clients/([^/]+)/knowledge$", path)
        if m:
            data = _read_json_body()
            content = data.get("content", "")
            status, payload = put_knowledge(m.group(1), content)
            json_response(self, payload, status=status)
            return
        json_response(self, {"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        def _read_json() -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                return json.loads(raw)
            except Exception:
                return {}

        # ── Queue actions ────────────────────────────────────────────────────
        m = re.match(r"^/api/queue/([^/]+)/([^/]+)/preview$", path)
        if m:
            status, payload = queue_preview(m.group(1), m.group(2), self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/queue/([^/]+)/([^/]+)/approve$", path)
        if m:
            body = _read_json()
            status, payload = queue_approve(m.group(1), m.group(2), body, self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/queue/([^/]+)/([^/]+)/reject$", path)
        if m:
            body = _read_json()
            status, payload = queue_reject(m.group(1), m.group(2), body, self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/queue/([^/]+)/([^/]+)/skip$", path)
        if m:
            status, payload = queue_skip(m.group(1), m.group(2))
            json_response(self, payload, status=status)
            return
        # ── Token actions ────────────────────────────────────────────────────
        m = re.match(r"^/api/tokens/([^/]+)/refresh$", path)
        if m:
            status, payload = refresh_client_token(m.group(1), self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/tokens/([^/]+)/reauthorize$", path)
        if m:
            status, payload = authorize_client_youtube(m.group(1), self.env_file)
            json_response(self, payload, status=status)
            return
        # ── Failed upload actions ────────────────────────────────────────────
        if path == "/api/failed/retry-all":
            status, payload = retry_all_failed(self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/failed/([^/]+)/([^/]+)/retry$", path)
        if m:
            status, payload = retry_failed_item(m.group(1), m.group(2), self.env_file)
            json_response(self, payload, status=status)
            return
        m = re.match(r"^/api/failed/([^/]+)/([^/]+)/dismiss$", path)
        if m:
            status, payload = dismiss_failed_item(m.group(1), m.group(2))
            json_response(self, payload, status=status)
            return
        # ── Test / utility actions ───────────────────────────────────────────
        if path == "/api/test/drive":
            status, payload = test_drive_connection(self.env_file)
            json_response(self, payload, status=status)
            return
        if path == "/api/test/telegram":
            status, payload = send_telegram_test(self.env_file)
            json_response(self, payload, status=status)
            return
        # ── Add client (multipart) ───────────────────────────────────────────
        if path == "/api/clients/add":
            content_type = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            # Parse multipart using cgi module
            environ = {"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type}
            fs = cgi.FieldStorage(
                fp=io.BytesIO(body),
                headers=self.headers,
                environ=environ,
            )
            name = (fs.getvalue("name") or b"").decode("utf-8", errors="replace").strip()
            folder_id = (fs.getvalue("drive_folder_id") or b"").decode("utf-8", errors="replace").strip()
            yt_item = fs["youtube_credentials"] if "youtube_credentials" in fs else None
            kb_item = fs["knowledge_base"] if "knowledge_base" in fs else None
            yt_bytes = yt_item.file.read() if yt_item else b""
            kb_bytes = kb_item.file.read() if kb_item else b""
            status, payload = add_client(name, folder_id, yt_bytes, kb_bytes)
            json_response(self, payload, status=status)
            return
        # ── Authorize client YouTube ─────────────────────────────────────────
        m = re.match(r"^/api/clients/([^/]+)/authorize$", path)
        if m:
            status, payload = authorize_client_youtube(m.group(1), self.env_file)
            json_response(self, payload, status=status)
            return
        # ── Settings ─────────────────────────────────────────────────────────
        if path == "/api/settings":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload_data = json.loads(body)
            except Exception:
                json_response(self, {"error": "Invalid JSON"}, status=400)
                return
            status, payload = update_settings(self.env_file, payload_data)
            json_response(self, payload, status=status)
            return
        # ── Run endpoints ────────────────────────────────────────────────────
        if path == "/api/run/all":
            status, payload = start_run_all(self.env_file)
            json_response(self, payload, status=status)
            return
        if path.startswith("/api/run/"):
            name = path[len("/api/run/"):].strip("/")
            status, payload = start_run_client(name, self.env_file)
            json_response(self, payload, status=status)
            return
        if path == "/api/run-once":
            status, payload = start_run_once(self.env_file)
            json_response(self, payload, status=status)
            return
        json_response(self, {"error": "Not found"}, status=HTTPStatus.NOT_FOUND)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local dashboard for the Nashik PG uploader.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5050)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    DashboardHandler.env_file = args.env_file.resolve()
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Dashboard running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
