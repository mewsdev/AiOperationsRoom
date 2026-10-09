"""Command line entry points for local setup and the isolated demo."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.config import ROOT


EVENTS = ("SessionStart", "UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "SessionEnd")


def settings_path() -> Path:
    return Path.home() / ".claude" / "settings.json"


def command() -> str:
    invocation = f'"{sys.executable}" "{ROOT / "hooks" / "capture.py"}"'
    return f"& {invocation}" if os.name == "nt" else invocation


def _our_hook(item: dict) -> bool:
    value = item.get("command")
    if not isinstance(value, str):
        return False
    match = re.fullmatch(r'\s*(?:&\s*)?"[^"]+"\s+"([^"]+)"\s*', value)
    return bool(match and os.path.normcase(os.path.normpath(match.group(1))) ==
                os.path.normcase(os.path.normpath(str(ROOT / "hooks" / "capture.py"))))


def load_settings(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("O arquivo de configurações do Claude Code precisa ser um objeto JSON.")
    return data


def save_settings(path: Path, settings: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoding = "utf-8-sig" if path.exists() and path.read_bytes().startswith(b"\xef\xbb\xbf") else "utf-8"
    path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding=encoding)


def install_hooks(path: Path) -> None:
    settings = load_settings(path)
    hooks = settings.setdefault("hooks", {})
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        found = False
        for group in groups:
            for item in group.get("hooks", []):
                if _our_hook(item):
                    item["command"] = command()
                    if os.name == "nt":
                        item["shell"] = "powershell"
                    else:
                        item.pop("shell", None)
                    found = True
        if not found:
            hook = {"type": "command", "command": command(), "timeout": 5}
            if os.name == "nt":
                hook["shell"] = "powershell"
            groups.append({"hooks": [hook]})
    save_settings(path, settings)
    print(f"Hooks registrados em {path}")


def remove_hooks(path: Path) -> None:
    settings = load_settings(path)
    hooks = settings.get("hooks", {})
    for event in EVENTS:
        groups = hooks.get(event, [])
        remaining = []
        for group in groups:
            kept = [item for item in group.get("hooks", []) if not _our_hook(item)]
            if kept:
                remaining.append({**group, "hooks": kept})
        if remaining:
            hooks[event] = remaining
        else:
            hooks.pop(event, None)
    if not hooks:
        settings.pop("hooks", None)
    save_settings(path, settings)
    print(f"Hooks removidos de {path}")


def demo_events() -> list[dict]:
    now = datetime.now(timezone.utc)
    def at(minutes: int) -> str:
        return (now + timedelta(minutes=minutes)).isoformat(timespec="seconds")
    return [
        {"id": "demo-01", "evento": "SessionStart", "session_id": "demo-atlas", "cwd": "/demo/atlas", "t": at(-12)},
        {"id": "demo-02", "evento": "UserPromptSubmit", "session_id": "demo-atlas", "cwd": "/demo/atlas", "t": at(-11)},
        {"id": "demo-03", "evento": "SubagentStart", "session_id": "demo-atlas", "agent_id": "demo-review", "agent_type": "reviewer", "cwd": "/demo/atlas", "t": at(-8)},
        {"id": "demo-04", "evento": "SessionStart", "session_id": "demo-orion", "cwd": "/demo/orion", "t": at(-10)},
        {"id": "demo-05", "evento": "Stop", "session_id": "demo-orion", "cwd": "/demo/orion", "t": at(-2)},
        {"id": "demo-06", "evento": "SessionStart", "session_id": "demo-aurora", "cwd": "/demo/aurora", "t": at(-30)},
        {"id": "demo-07", "evento": "SubagentStart", "session_id": "demo-aurora", "agent_id": "demo-index", "agent_type": "Explore", "cwd": "/demo/aurora", "t": at(-28)},
        {"id": "demo-08", "evento": "SessionEnd", "session_id": "demo-aurora", "cwd": "/demo/aurora", "reason": "other", "t": at(-20)},
    ]


def seed_demo(path: Path) -> None:
    path = path.expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    os.environ["AI_OPERATIONS_ROOM_DATA_DIR"] = str(path)
    from backend import projects
    from backend.db import connect, init_db

    init_db()
    with connect() as con:
        for table in ("evento", "execucao", "sessao"):
            con.execute(f"DELETE FROM {table} WHERE session_id LIKE 'demo-%'")
        con.execute("DELETE FROM ingestao WHERE chave IN ('events_offset', 'events_prefix')")
        if not projects.list_all(con):
            for name, folder in (("Atlas CRM", "/demo/atlas"), ("Orion Flow", "/demo/orion"), ("Aurora Hub", "/demo/aurora")):
                projects.save(con, nome=name, caminho_local=folder)
    (path / "events.jsonl").write_text(
        "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in demo_events()), encoding="utf-8"
    )
    (path / ".demo-mode").write_text("AI Operations Room demo\n", encoding="utf-8")
    print(f"Dados fictícios criados em {path}")


def serve(data_dir: str | None, port: int = 8765, host: str = "127.0.0.1") -> None:
    if data_dir:
        os.environ["AI_OPERATIONS_ROOM_DATA_DIR"] = data_dir
    import uvicorn
    uvicorn.run("backend.api:app", host=host, port=port)


def main() -> int:
    parser = argparse.ArgumentParser(prog="ai-operations-room")
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("install", "remove"):
        item = commands.add_parser(f"hooks-{name}")
        item.add_argument("--settings", type=Path, default=settings_path())
    demo = commands.add_parser("demo")
    demo.add_argument("--data-dir", type=Path, default=Path.home() / ".ai-operations-room-demo")
    demo.add_argument("--serve", action="store_true")
    demo.add_argument("--port", type=int, default=8765)
    demo.add_argument("--host", default=os.environ.get("AI_OPERATIONS_ROOM_HOST", "127.0.0.1"))
    server = commands.add_parser("serve")
    server.add_argument("--data-dir")
    server.add_argument("--port", type=int, default=8765)
    server.add_argument("--host", default=os.environ.get("AI_OPERATIONS_ROOM_HOST", "127.0.0.1"))
    args = parser.parse_args()
    if args.action == "hooks-install":
        install_hooks(args.settings)
    elif args.action == "hooks-remove":
        remove_hooks(args.settings)
    elif args.action == "demo":
        seed_demo(args.data_dir)
        if args.serve:
            serve(str(args.data_dir), args.port, args.host)
        else:
            print("Use `python -m backend.cli demo --serve` para abrir a demonstração.")
    else:
        serve(args.data_dir, args.port, args.host)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
