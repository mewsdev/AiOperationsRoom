"""Claude Code hook: append metadata only, never conversation content."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ("hook_event_name", "session_id", "cwd", "agent_id", "agent_type", "reason")
BACKGROUND_FIELDS = ("id", "type", "status", "agent_type")


def data_dir() -> Path:
    return Path(os.environ.get("AI_OPERATIONS_ROOM_DATA_DIR")
                or Path.home() / ".ai-operations-room").expanduser()


def normalize(payload: dict) -> dict:
    event = {key: payload[key] for key in FIELDS if key in payload}
    event["evento"] = event.pop("hook_event_name", "desconhecido")
    event["id"] = str(uuid.uuid4())
    event["t"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tasks = payload.get("background_tasks")
    if isinstance(tasks, list):
        event["background_tasks"] = [
            {key: task[key] for key in BACKGROUND_FIELDS if key in task}
            for task in tasks if isinstance(task, dict)
        ]
    return event


def _transcript_events(path: object, payload: dict, sidechain: bool) -> tuple[list[dict], tuple | None]:
    """Advisor calls are server tools: no hook fires for them, so read their
    id and timestamps from the transcript. The advisor text is never kept."""
    if not isinstance(path, str) or not path:
        return [], None
    transcript = Path(path).expanduser()
    cursors = data_dir() / "advisor-cursors"
    cursor = cursors / (hashlib.sha256(str(transcript).encode("utf-8")).hexdigest()[:32] + ".json")
    try:
        saved = json.loads(cursor.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    offset = saved.get("offset") if isinstance(saved, dict) else 0
    offset = offset if isinstance(offset, int) else 0
    events = []
    with transcript.open("rb") as stream:
        if stream.seek(0, 2) < offset:
            offset = 0
        stream.seek(offset)
        for raw in stream:
            if not raw.endswith(b"\n"):
                break
            offset += len(raw)
            if b"srvtoolu_" not in raw:
                continue
            try:
                entry = json.loads(raw.decode("utf-8"))
                blocks = entry["message"]["content"]
            except (ValueError, KeyError, TypeError):
                continue
            if not isinstance(blocks, list) or bool(entry.get("isSidechain")) != sidechain:
                continue
            try:
                # Same format as the hook's own "t", so stored times compare as text.
                when = datetime.fromisoformat(str(entry["timestamp"]).replace("Z", "+00:00"))
                when = when.astimezone(timezone.utc).isoformat(timespec="seconds")
            except (KeyError, ValueError):
                continue
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "server_tool_use" and block.get("name") == "advisor":
                    name, call = "AdvisorStart", block.get("id")
                elif block.get("type") == "advisor_tool_result":
                    name, call = "AdvisorStop", block.get("tool_use_id")
                else:
                    continue
                if not isinstance(call, str) or not call:
                    continue
                event = {key: payload[key] for key in ("session_id", "cwd", "agent_id") if key in payload}
                event.update({"evento": name, "id": f"{name}:{call}", "advisor_id": call, "t": when})
                model = entry.get("advisorModel")
                if isinstance(model, str) and model:
                    event["advisor_model"] = model
                events.append(event)
    return events, (cursor, offset)


def advisor_events(payload: dict) -> tuple[list[dict], tuple | None]:
    try:
        if payload.get("hook_event_name") == "SubagentStop":
            return _transcript_events(payload.get("agent_transcript_path"), payload, True)
        main = {key: value for key, value in payload.items() if key != "agent_id"}
        return _transcript_events(payload.get("transcript_path"), main, False)
    except Exception:
        return [], None


def save_cursor(cursor: tuple | None) -> None:
    """Saved only after the queue write; ids are stable, so rereading is harmless."""
    if cursor:
        path, offset = cursor
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"offset": offset}), encoding="utf-8")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict) or not payload.get("session_id"):
            return 0
        path = data_dir()
        path.mkdir(parents=True, exist_ok=True)
        # Advisor calls first: they happened before the event that revealed them.
        advisor, cursor = advisor_events(payload)
        lines = [*advisor, normalize(payload)]
        with (path / "events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines))
        save_cursor(cursor)
    except Exception:
        pass  # A hook must never interrupt Claude Code.
    return 0


if __name__ == "__main__":
    sys.exit(main())
