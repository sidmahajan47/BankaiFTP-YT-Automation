#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = BASE_DIR / "nashik-pg-uploader.env"
DEFAULT_CONFIG_JSON = BASE_DIR / "config.json"
STOP_REQUESTED = False
TIME_OPTIONS: tuple[tuple[str, int], ...] = (
    ("5 min", 300),
    ("15 min", 900),
    ("30 min", 1800),
    ("1 hr", 3600),
    ("6 hr", 21600),
    ("Daily", 86400),
)


@dataclass(frozen=True)
class BotConfig:
    token: str
    chat_id: str
    env_file: Path
    uploaded_log: Path
    uploader_log: Path
    dashboard_url: str
    poll_seconds: int


class BotError(Exception):
    pass


def handle_signal(signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


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
    return path if path.is_absolute() else BASE_DIR / path


def build_config(env_file: Path) -> BotConfig:
    env = {**read_env_file(env_file), **os.environ}
    token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = env.get("TELEGRAM_CHAT_ID", "").strip()
    if not token:
        raise BotError("TELEGRAM_BOT_TOKEN is missing")
    if not chat_id:
        raise BotError("TELEGRAM_CHAT_ID is missing")
    return BotConfig(
        token=token,
        chat_id=chat_id,
        env_file=env_file,
        uploaded_log=resolve_path(env.get("UPLOADED_LOG"), BASE_DIR / "uploaded.txt"),
        uploader_log=resolve_path(env.get("LOG_FILE"), BASE_DIR / "nashik-pg-uploader.log"),
        dashboard_url=env.get("DASHBOARD_URL", "http://127.0.0.1:5052"),
        poll_seconds=max(2, int(env.get("TELEGRAM_NOTIFY_POLL_SECONDS", "5"))),
    )


# ── Multi-client config.json helpers ────────────────────────────────────────────

def load_client_entries() -> list[dict]:
    """Return clients list from config.json if present, else empty list."""
    p = DEFAULT_CONFIG_JSON
    if not p.exists():
        return []
    try:
        import json as _json
        return _json.loads(p.read_text(encoding="utf-8")).get("clients", [])
    except Exception:
        return []


def _rp(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else BASE_DIR / p


def api_url(config: BotConfig, method: str) -> str:
    return f"https://api.telegram.org/bot{config.token}/{method}"


def telegram_request(config: BotConfig, method: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    response = requests.post(api_url(config, method), json=payload, timeout=timeout)
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise BotError(f"Telegram returned non-JSON response: {response.status_code}") from exc
    if not data.get("ok"):
        raise BotError(f"Telegram {method} failed: {data}")
    return data


def send_message(
    config: BotConfig,
    text: str,
    chat_id: str | None = None,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id or config.chat_id,
        "text": text,
        "disable_web_page_preview": False,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    telegram_request(
        config,
        "sendMessage",
        payload,
        timeout=15,
    )


def get_updates(config: BotConfig, offset: int | None) -> list[dict[str, Any]]:
    payload: dict[str, Any] = {"timeout": 25, "allowed_updates": ["message", "callback_query"]}
    if offset is not None:
        payload["offset"] = offset
    data = telegram_request(config, "getUpdates", payload, timeout=35)
    return data.get("result", [])


def answer_callback(config: BotConfig, callback_id: str, text: str = "") -> None:
    payload = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
    telegram_request(config, "answerCallbackQuery", payload, timeout=10)


def edit_message(config: BotConfig, chat_id: str, message_id: int, text: str) -> None:
    telegram_request(
        config,
        "editMessageText",
        {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "disable_web_page_preview": False,
        },
        timeout=15,
    )


def parse_uploaded_line(line: str) -> dict[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    parts = stripped.split("\t")
    drive_id = parts[0].split()[0]
    return {
        "drive_id": drive_id,
        "uploaded_at": parts[1] if len(parts) > 1 else "",
        "youtube_id": parts[2] if len(parts) > 2 else "",
        "file_name": parts[3] if len(parts) > 3 else "",
    }


def uploaded_records(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    records: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        record = parse_uploaded_line(line)
        if record:
            records.append(record)
    return records


def tail_lines(path: Path, limit: int = 8, max_bytes: int = 128 * 1024) -> list[str]:
    if not path.exists():
        return []
    size = path.stat().st_size
    with path.open("rb") as file:
        file.seek(max(0, size - max_bytes))
        data = file.read().decode("utf-8", errors="replace")
    return data.splitlines()[-limit:]


def last_poll_summary(lines: list[str]) -> str:
    for line in reversed(lines):
        if "Poll summary:" in line:
            return line.split("Poll summary:", 1)[1].strip()
    return "No poll summary yet."


def youtube_url(video_id: str) -> str:
    return f"https://youtube.com/watch?v={video_id}"


def short_title(name: str, fallback: str = "New upload") -> str:
    clean = re.sub(r"\s+", " ", name or "").strip()
    return clean[:90] if clean else fallback


def upload_title(record: dict[str, str], index: int | None = None) -> str:
    name = short_title(record.get("file_name", ""), "")
    if name:
        return name
    video_id = record.get("youtube_id", "").strip()
    if video_id:
        return f"YouTube upload {video_id}"
    if index is not None:
        return f"Upload #{index}"
    return "BankaiFTP upload"


def compact_summary(summary: str) -> str:
    summary = summary.replace("already uploaded", "done")
    summary = summary.replace("uploaded", "up")
    summary = summary.replace("total in folder", "total")
    summary = re.sub(r"\s+", " ", summary).strip()
    return summary[:110] if summary else "No poll yet"


def live_message(record: dict[str, str], client_name: str = "") -> str:
    title = upload_title(record)
    video_id = record.get("youtube_id", "")
    link = youtube_url(video_id) if video_id else "Link not saved yet"
    client_line = f"\U0001f464 Client: {client_name}\n" if client_name else ""
    return (
        "\u2694\ufe0f Bankai released.\n"
        "\U0001f680 Drive -> YouTube. Done clean.\n"
        f"{client_line}"
        f"\U0001f4fc {title} is live.\n"
        f"\u25b6\ufe0f {link}\n"
        "Quiet work. Loud results.\n"
        "\u2014 BankaiFTP \u5350"
    )


def status_message(config: BotConfig) -> str:
    clients = load_client_entries()
    if clients:
        # Multi-client: show per-client upload counts
        lines = ["\U0001f4ca Board checked."]
        total_uploads = 0
        for c in clients:
            name = c.get("name", "?")
            ul_path = _rp(c.get("state_file", f"state/uploaded_{name}.txt"))
            log_path = _rp(c.get("log_file", f"logs/{name}-uploader.log"))
            recs = uploaded_records(ul_path)
            summary = compact_summary(last_poll_summary(tail_lines(log_path, limit=60)))
            total_uploads += len(recs)
            latest = upload_title(recs[-1], len(recs)) if recs else "None"
            lines.append(f"\u2022 [{name}] \u2705 {len(recs)} | latest: {latest}")
            lines.append(f"  \U0001f4c1 {summary}")
        lines.append(f"\U0001f9e0 Total: {total_uploads} uploads across {len(clients)} clients.")
        lines.append("\u2014 BankaiFTP \u5350")
        return "\n".join(lines)
    # Single-client legacy
    uploads = uploaded_records(config.uploaded_log)
    latest = uploads[-1] if uploads else None
    summary = compact_summary(last_poll_summary(tail_lines(config.uploader_log, limit=60)))
    latest_line = upload_title(latest, len(uploads)) if latest else "None"
    return (
        "\U0001f4ca Board checked.\n"
        f"\u2705 Uploaded: {len(uploads)}\n"
        f"\U0001f3ac Latest: {latest_line}\n"
        f"\U0001f4c1 Poll: {summary}\n"
        "\U0001f9e0 Ten steps ahead.\n"
        "\u2014 BankaiFTP \u5350"
    )


def uploads_message(config: BotConfig) -> str:
    uploads = uploaded_records(config.uploaded_log)[-5:]
    if not uploads:
        return "📭 No uploads tracked yet.\nClean slate. Dangerous thing.\n— BankaiFTP 卍"
    lines = ["📼 Last uploads."]
    for index, item in enumerate(reversed(uploads), start=1):
        title = upload_title(item, index)
        video_id = item.get("youtube_id", "")
        suffix = f" — {youtube_url(video_id)}" if video_id else " — link pending"
        lines.append(f"{index}. {title}{suffix}")
    lines.append("🧾 Receipts beat speeches.")
    lines.append("— BankaiFTP 卍")
    return "\n".join(lines)


def logs_message(config: BotConfig) -> str:
    lines = tail_lines(config.uploader_log, limit=5)
    if not lines:
        return "📭 No logs yet.\nEither quiet day or perfect execution.\n— BankaiFTP 卍"
    trimmed = [line[-180:] for line in lines]
    return "🧾 Recent logs.\n" + "\n".join(trimmed) + "\n— BankaiFTP 卍"


def format_interval(seconds: int) -> str:
    for label, value in TIME_OPTIONS:
        if value == seconds:
            return label
    if seconds % 3600 == 0:
        return f"{seconds // 3600} hr"
    if seconds % 60 == 0:
        return f"{seconds // 60} min"
    return f"{seconds}s"


def current_uploader_interval(config: BotConfig) -> int:
    env = read_env_file(config.env_file)
    try:
        return int(env.get("POLL_INTERVAL_SECONDS", "300"))
    except ValueError:
        return 300


def time_keyboard(current_seconds: int) -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    for index in range(0, len(TIME_OPTIONS), 2):
        row: list[dict[str, str]] = []
        for label, seconds in TIME_OPTIONS[index:index + 2]:
            prefix = "✅ " if seconds == current_seconds else ""
            row.append({"text": f"{prefix}{label}", "callback_data": f"time:{seconds}"})
        rows.append(row)
    return {"inline_keyboard": rows}


def time_message(config: BotConfig) -> str:
    current = current_uploader_interval(config)
    return (
        "⏱️ Pick the scan rhythm.\n"
        f"Current: {format_interval(current)}\n"
        "Drive waits. I don’t.\n"
        "— BankaiFTP 卍"
    )


def set_env_value(path: Path, key: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    updated = False
    next_lines: list[str] = []
    for line in lines:
        if pattern.match(line):
            next_lines.append(f"{key}={value}")
            updated = True
        else:
            next_lines.append(line)
    if not updated:
        if next_lines and next_lines[-1].strip():
            next_lines.append("")
        next_lines.append(f"{key}={value}")
    path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def update_interval(config: BotConfig, seconds: int) -> str:
    valid = {value for _label, value in TIME_OPTIONS}
    if seconds not in valid:
        return "That interval is off the board.\nTry /time again.\n— BankaiFTP 卍"
    set_env_value(config.env_file, "POLL_INTERVAL_SECONDS", str(seconds))
    return (
        "⏱️ Time changed.\n"
        f"New scan rhythm: {format_interval(seconds)}\n"
        "Restart the uploader service to lock it in.\n"
        "Bankai set. Blade sharp.\n"
        "— BankaiFTP 卍"
    )


def help_message() -> str:
    return (
        "⚔️ BankaiFTP online.\n"
        "📊 /status — current board\n"
        "📼 /uploads — last uploads\n"
        "🧾 /logs — recent logs\n"
        "⏱️ /time — scan interval\n"
        "🚀 /run — one scan now\n"
        "Say the word. I move.\n"
        "— BankaiFTP 卍"
    )


def run_once(config: BotConfig) -> str:
    python_path = BASE_DIR / "venv" / "bin" / "python"
    if not python_path.exists():
        python_path = Path(sys.executable)
    command = [
        str(python_path),
        str(BASE_DIR / "drive_to_youtube_uploader.py"),
        "--env-file",
        str(config.env_file),
        "once",
    ]
    subprocess.Popen(
        command,
        cwd=BASE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return (
        "🚀 Scan started.\n"
        "📂 Drive wakes up. ▶️ YouTube gets ready.\n"
        "Give me the room.\n"
        "— BankaiFTP 卍"
    )


def command_reply(config: BotConfig, text: str) -> str:
    command = text.strip().split()[0].lower() if text.strip() else ""
    if command in {"/start", "/help"}:
        return help_message()
    if command == "/status":
        return status_message(config)
    if command in {"/stats", "/uploads"}:
        return uploads_message(config)
    if command == "/logs":
        return logs_message(config)
    if command == "/run":
        return run_once(config)
    if "how" in text.lower() and "work" in text.lower():
        return (
            "🧠 Photographic memory meets Python.\n"
            "📂 File drops in Drive — bot wakes up.\n"
            "▶️ Uploads. Goes public.\n"
            "⚔️ Bankai. Then publish.\n"
            "— BankaiFTP 卍"
        )
    return (
        "👀 I read that.\n"
        "Use /status, /uploads, /logs, or /run.\n"
        "Less noise. More results. ⚡\n"
        "— BankaiFTP 卍"
    )


def handle_message(config: BotConfig, chat_id: str, text: str) -> None:
    command = text.strip().split()[0].lower() if text.strip() else ""
    if command == "/time":
        current = current_uploader_interval(config)
        send_message(config, time_message(config), chat_id=chat_id, reply_markup=time_keyboard(current))
        return
    send_message(config, command_reply(config, text), chat_id=chat_id)


def handle_callback(config: BotConfig, callback: dict[str, Any]) -> None:
    callback_id = callback.get("id", "")
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = str(chat.get("id", ""))
    if chat_id != str(config.chat_id):
        if callback_id:
            answer_callback(config, callback_id, "Wrong room.")
        return
    data = str(callback.get("data", ""))
    if not data.startswith("time:"):
        if callback_id:
            answer_callback(config, callback_id, "Unknown move.")
        return
    try:
        seconds = int(data.split(":", 1)[1])
    except ValueError:
        if callback_id:
            answer_callback(config, callback_id, "Bad interval.")
        return
    response = update_interval(config, seconds)
    if callback_id:
        answer_callback(config, callback_id, f"Set to {format_interval(seconds)}")
    message_id = message.get("message_id")
    if isinstance(message_id, int):
        edit_message(config, chat_id, message_id, response)
    else:
        send_message(config, response, chat_id=chat_id)


def load_seen_uploads(path: Path) -> set[str]:
    return {record["drive_id"] for record in uploaded_records(path)}


def announce_new_uploads(config: BotConfig, seen: set[str]) -> set[str]:
    clients = load_client_entries()
    if clients:
        # Multi-client: check all state files
        for client in clients:
            name = client.get("name", "")
            ul_path = _rp(client.get("state_file", f"state/uploaded_{name}.txt"))
            records = uploaded_records(ul_path)
            for record in records:
                drive_id = record["drive_id"]
                if drive_id in seen:
                    continue
                seen.add(drive_id)
                if record.get("youtube_id"):
                    send_message(config, live_message(record, client_name=name))
        return seen
    # Single-client legacy
    records = uploaded_records(config.uploaded_log)
    for record in records:
        drive_id = record["drive_id"]
        if drive_id in seen:
            continue
        seen.add(drive_id)
        if record.get("youtube_id"):
            send_message(config, live_message(record))
    return seen



# ── Token health (shared logic, no import from dashboard.py) ────────────────────

def _read_token_days(token_path: Path) -> int | None:
    """Return health indicator for a token file.

    The ``expiry`` field is only the short-lived ACCESS TOKEN (1 hour).
    The real long-term credential is the ``refresh_token``.
    - If refresh_token is present  → return 9999 (healthy, auto-refreshes)
    - If refresh_token is missing  → return 0 (needs re-authorisation)
    - If file is missing           → return None (unknown)
    """
    if not token_path.exists():
        return None
    try:
        data = json.loads(token_path.read_text(encoding="utf-8"))
        return 9999 if data.get("refresh_token") else 0
    except Exception:
        return None


def _token_status_emoji(days: int | None) -> str:
    if days is None:
        return "❓"
    if days <= 0:
        return "🔴"
    if days < 7:
        return "🟠"
    if days < 14:
        return "🟡"
    return "✅"


# ── Queue notification ───────────────────────────────────────────────────────────

def notify_queue_item(config: BotConfig, client_name: str, item: dict) -> None:
    """Send a Telegram notification when a new video enters the approval queue."""
    filename = item.get("filename", "unknown")
    title = item.get("title", "No title generated")
    dashboard_url = config.dashboard_url
    text = (
        f"📋 New video queued for *{client_name}*\n"
        f"📁 {filename}\n"
        f"🎯 Title: {title}\n"
        f"👉 Review & approve: {dashboard_url}"
    )
    try:
        send_message(config, text)
    except Exception as exc:
        print(f"[notify_queue_item] Failed: {exc}", file=sys.stderr)


def check_and_notify_queue(config: BotConfig, seen_queue_ids: set[str]) -> set[str]:
    """Check all client queues and notify about newly added items."""
    clients = load_client_entries()
    for client in clients:
        name = client.get("name", "")
        queue_path = BASE_DIR / "queue" / f"{name}_queue.json"
        if not queue_path.exists():
            continue
        try:
            items = json.loads(queue_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in items:
            key = f"{name}:{item.get('file_id', '')}"
            if key not in seen_queue_ids and item.get("status") == "pending_approval":
                seen_queue_ids.add(key)
                notify_queue_item(config, name, item)
    return seen_queue_ids


# ── Token alert ──────────────────────────────────────────────────────────────────

def build_token_alert(config: BotConfig) -> str | None:
    """Build a token expiry alert message if any token is < 7 days. Returns None if all OK."""
    clients = load_client_entries()
    if not clients:
        return None
    config_data: dict = {}
    try:
        config_data = json.loads(DEFAULT_CONFIG_JSON.read_text(encoding="utf-8"))
    except Exception:
        pass
    drive_token_rel = config_data.get("drive", {}).get("token_file", "tokens/token_sid_drive.json")
    drive_token_path = _rp(drive_token_rel)
    alerts: list[str] = []
    for c in clients:
        name = c.get("name", "?")
        yt_token_path = _rp(c.get("youtube_token_file", f"tokens/token_{name}_yt.json"))
        drive_days = _read_token_days(drive_token_path)
        yt_days = _read_token_days(yt_token_path)
        if drive_days is not None and drive_days < 7:
            alerts.append(f"  ├ {name} Drive token: {_token_status_emoji(drive_days)} expires in {drive_days}d")
        if yt_days is not None and yt_days < 7:
            alerts.append(f"  ├ {name} YouTube token: {_token_status_emoji(yt_days)} expires in {yt_days}d")
    if not alerts:
        return None
    dashboard_url = config.dashboard_url
    return (
        "⚠️ *Token Alert* — Action Required\n"
        + "\n".join(alerts)
        + f"\n\n🔗 Re-authorize: {dashboard_url}/#settings"
    )


# ── Daily summary ────────────────────────────────────────────────────────────────

def _ist_now() -> datetime:
    """Return current datetime in IST (UTC+5:30)."""
    try:
        import zoneinfo
        return datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata"))
    except Exception:
        from datetime import timedelta
        return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def _yesterday_str() -> str:
    from datetime import timedelta
    yesterday = _ist_now().date() - timedelta(days=1)
    return str(yesterday)


def build_daily_summary(config: BotConfig) -> str:
    """Build the daily morning summary message across all clients."""
    clients = load_client_entries()
    ist = _ist_now()
    date_str = ist.strftime("%B %-d, %Y")
    yesterday = _yesterday_str()

    config_data: dict = {}
    try:
        config_data = json.loads(DEFAULT_CONFIG_JSON.read_text(encoding="utf-8"))
    except Exception:
        pass
    drive_token_rel = config_data.get("drive", {}).get("token_file", "tokens/token_sid_drive.json")
    drive_token_path = _rp(drive_token_rel)

    total_yesterday = 0
    client_lines: list[str] = []
    folder_lines: list[str] = []
    token_lines: list[str] = []
    schedule_lines: list[str] = []

    for c in clients:
        name = c.get("name", "?")
        ul_path = _rp(c.get("state_file", f"state/uploaded_{name}.txt"))
        records = uploaded_records(ul_path)

        # Yesterday's uploads
        yesterdays = [r for r in records if yesterday in r.get("uploaded_at", "")]
        total_yesterday += len(yesterdays)
        if yesterdays:
            client_lines.append(f"├ 👤 {name}: {len(yesterdays)} video(s) uploaded")
            for r in yesterdays:
                fname = r.get("file_name") or r.get("youtube_id", "?")
                yt_id = r.get("youtube_id", "")
                status = f"→ Live ✅" if yt_id else "→ Pending"
                client_lines.append(f"│   └ 🎬 {fname[:40]} {status}")
        else:
            client_lines.append(f"├ 👤 {name}: 0 uploaded yesterday")

        # Queue / folder status
        queue_path = BASE_DIR / "queue" / f"{name}_queue.json"
        pending = 0
        if queue_path.exists():
            try:
                q = json.loads(queue_path.read_text(encoding="utf-8"))
                pending = sum(1 for i in q if i.get("status") == "pending_approval")
            except Exception:
                pass
        if pending:
            folder_lines.append(f"├ {name} folder: {pending} video(s) waiting for approval")
        else:
            folder_lines.append(f"├ {name} folder: no pending videos")

        # Token health
        yt_token_path = _rp(c.get("youtube_token_file", f"tokens/token_{name}_yt.json"))
        drive_days = _read_token_days(drive_token_path)
        yt_days = _read_token_days(yt_token_path)
        drive_em = _token_status_emoji(drive_days)
        yt_em = _token_status_emoji(yt_days)
        if yt_days is not None and yt_days < 7:
            token_lines.append(f"├ {name}: {yt_em} YouTube token expires in {yt_days}d ⚠️")
        elif drive_days is not None and drive_days < 7:
            token_lines.append(f"├ {name}: {drive_em} Drive token expires in {drive_days}d ⚠️")
        else:
            token_lines.append(f"├ {name}: {drive_em}{yt_em} All good")

        # Schedule
        sched = c.get("schedule", {})
        if sched.get("enabled"):
            times = sched.get("upload_times", [])
            for t in times:
                schedule_lines.append(f"├ {t} → {name}: upload planned")
        else:
            schedule_lines.append(f"├ {name}: no schedule set (manual)")

    yesterday_section = (
        f"📊 *Yesterday's Summary:*\n"
        f"├ 📤 Total uploads: {total_yesterday}\n"
        + ("\n".join(client_lines) if client_lines else "└ No activity")
    )
    folder_section = "📁 *Drive Status:*\n" + ("\n".join(folder_lines) if folder_lines else "└ No data")
    token_section = "🔑 *Token Health:*\n" + ("\n".join(token_lines) if token_lines else "└ No clients")
    schedule_section = "📅 *Today's Schedule:*\n" + ("\n".join(schedule_lines) if schedule_lines else "└ No schedules configured")

    return (
        f"🌅 *BANKAIFTP Daily Report — {date_str}*\n\n"
        f"{yesterday_section}\n\n"
        f"{folder_section}\n\n"
        f"{token_section}\n\n"
        f"{schedule_section}\n\n"
        f"🔗 Dashboard: {config.dashboard_url}\n"
        "— BankaiFTP 卍"
    )


def _seconds_until_ist(hour: int, minute: int) -> float:
    """Return seconds until the next occurrence of hour:minute IST."""
    now = _ist_now()
    from datetime import timedelta
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _schedule_daily_summary(config: BotConfig) -> None:
    """Send daily summary every day at 8:00 AM IST using a repeating Timer thread."""
    import threading

    def _run() -> None:
        # Send summary
        try:
            msg = build_daily_summary(config)
            send_message(config, msg)
        except Exception as exc:
            print(f"[daily_summary] Failed to send: {exc}", file=sys.stderr)
        # Send token alert separately if needed
        try:
            alert = build_token_alert(config)
            if alert:
                send_message(config, alert)
        except Exception as exc:
            print(f"[token_alert] Failed to send: {exc}", file=sys.stderr)
        # Reschedule for tomorrow
        _schedule_daily_summary(config)

    delay = _seconds_until_ist(8, 0)
    t = threading.Timer(delay, _run)
    t.daemon = True
    t.name = "daily-summary"
    t.start()


def loop(config: BotConfig) -> None:

    offset: int | None = None
    clients = load_client_entries()
    # Seed seen from all client state files (multi) or single uploaded log
    if clients:
        seen_uploads: set[str] = set()
        for c in clients:
            name = c.get("name", "")
            ul_path = _rp(c.get("state_file", f"state/uploaded_{name}.txt"))
            seen_uploads |= load_seen_uploads(ul_path)
    else:
        seen_uploads = load_seen_uploads(config.uploaded_log)
    client_count = len(clients) if clients else 1
    send_message(
        config,
        f"⚔️ BankaiFTP is awake.\n"
        f"👤 Managing {client_count} client(s).\n"
        "📂 Drive on one side. ▶️ YouTube on the other.\n"
        "I'll call the wins. 🔥\n"
        "— BankaiFTP 卍",
    )
    # Start daily summary scheduler (fires at 8:00 AM IST every day)
    _schedule_daily_summary(config)
    seen_queue_ids: set[str] = set()
    last_upload_check = 0.0
    while not STOP_REQUESTED:
        now = time.monotonic()
        if now - last_upload_check >= config.poll_seconds:
            try:
                seen_uploads = announce_new_uploads(config, seen_uploads)
            except Exception as exc:
                print(f"upload notification failed: {exc}", file=sys.stderr)
            try:
                seen_queue_ids = check_and_notify_queue(config, seen_queue_ids)
            except Exception as exc:
                print(f"queue notification failed: {exc}", file=sys.stderr)
            last_upload_check = now

        try:
            updates = get_updates(config, offset)
        except Exception as exc:
            print(f"getUpdates failed: {exc}", file=sys.stderr)
            time.sleep(3)
            continue
        for update in updates:
            offset = update["update_id"] + 1
            callback = update.get("callback_query")
            if callback:
                handle_callback(config, callback)
                continue
            message = update.get("message") or {}
            chat = message.get("chat") or {}
            chat_id = str(chat.get("id", ""))
            if chat_id != str(config.chat_id):
                send_message(config, "🚫 Wrong room.\nI only work my case.\n— BankaiFTP 卍", chat_id=chat_id)
                continue
            text = message.get("text", "")
            if text:
                handle_message(config, chat_id, text)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Telegram control bot for BankaiFTP.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    args = parse_args(argv)
    try:
        config = build_config(args.env_file)
        loop(config)
    except BotError as exc:
        print(exc, file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
