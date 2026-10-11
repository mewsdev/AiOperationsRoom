"""Reconcile open executions against Claude Code's local process registry."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.config import data_dir

# Subagents emit no hook while working, so a delegating session gets more time.
STALE = timedelta(minutes=10)
STALE_DELEGATING = timedelta(minutes=60)


def sessions_dir() -> Path:
    return Path(os.environ.get("AI_OPERATIONS_ROOM_SESSIONS_DIR") or Path.home() / ".claude" / "sessions")


def process_alive(pid: object) -> bool:
    try:
        number = int(pid)
    except (TypeError, ValueError):
        return False
    if number <= 0:
        return False
    if sys.platform != "win32":
        # Signal 0 only checks existence; macOS has no /proc.
        try:
            os.kill(number, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False
        return True

    import ctypes
    from ctypes import wintypes

    kernel = ctypes.windll.kernel32
    handle = kernel.OpenProcess(0x1000, False, number)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
            return False
        name = ctypes.create_unicode_buffer(1024)
        length = wintypes.DWORD(1024)
        if not kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(length)):
            return True
        return Path(name.value).name.casefold().startswith(("claude", "node"))
    finally:
        kernel.CloseHandle(handle)


def living_sessions() -> dict[str, bool]:
    found: dict[str, bool] = {}
    folder = sessions_dir()
    if not folder.is_dir():
        return found
    for path in folder.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("sessionId"), str):
            continue
        sid = data["sessionId"]
        found[sid] = found.get(sid, False) or process_alive(data.get("pid"))
    return found


def reconcile(con: sqlite3.Connection, *, living: dict[str, bool] | None = None,
              now: datetime | None = None) -> int:
    """Close all active runs in a dead session; unknown sessions expire after a quiet period."""
    living = living_sessions() if living is None else living
    now = now or datetime.now(timezone.utc)
    demo_mode = (data_dir() / ".demo-mode").exists()
    rows = con.execute(
        "SELECT session_id, MAX(atualizado_em) AS ultimo, "
        "MAX(pai_chave IS NOT NULL AND estado IN ('trabalhando', 'delegando', 'aguardando')) AS delegando "
        "FROM execucao GROUP BY session_id"
    ).fetchall()
    dead = []
    for row in rows:
        if demo_mode and row["session_id"].startswith("demo-"):
            continue
        last = row["ultimo"]
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
        except (AttributeError, ValueError):
            continue
        status = living.get(row["session_id"])
        cutoff = now - (STALE_DELEGATING if row["delegando"] else STALE)
        if status is False or (status is None and last_dt < cutoff):
            dead.append(row["session_id"])
    count = 0
    for sid in dead:
        count += con.execute(
            "UPDATE execucao SET estado = 'orfa', origem_encerramento = 'pid_morto', atualizado_em = ? "
            "WHERE session_id = ? AND estado IN ('trabalhando', 'delegando', 'aguardando')",
            (now.isoformat(timespec="seconds"), sid),
        ).rowcount
    return count
