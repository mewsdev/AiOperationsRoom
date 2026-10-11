from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.config import events_path
from backend.projects import path_key, resolve


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_OPERATIONS_ROOM_DATA_DIR", str(tmp_path))
    with TestClient(app, base_url="http://127.0.0.1") as test_client:
        yield test_client


def project(client: TestClient, name: str, path: str) -> dict:
    response = client.post("/api/projetos", json={"nome": name, "caminho_local": path})
    assert response.status_code == 201, response.text
    return response.json()


def event_file(*items: dict) -> None:
    path = events_path()
    with path.open("a", encoding="utf-8") as stream:
        for item in items:
            stream.write(json.dumps(item) + "\n")


def test_project_contract_and_crud(client: TestClient):
    created = project(client, "Atlas CRM", "C:/work/atlas")
    assert set(created) == {
        "id", "nome", "caminho_local", "arquivado", "criado_em", "atualizado_em"
    }
    assert created["arquivado"] == 0
    changed = client.put(f"/api/projetos/{created['id']}",
                         json={"nome": "Atlas", "caminho_local": "C:/work/atlas-new"})
    assert changed.status_code == 200
    assert changed.json()["nome"] == "Atlas"
    assert client.post(f"/api/projetos/{created['id']}/arquivar").json()["arquivado"] == 1
    assert client.post(f"/api/projetos/{created['id']}/desarquivar").json()["arquivado"] == 0
    assert client.delete(f"/api/projetos/{created['id']}").json() == {"removido": True}
    assert client.get("/api/projetos").json() == []


def test_specific_path_wins_and_sibling_does_not_match():
    roots = [
        {"id": 1, "caminho_key": path_key("C:/work/app")},
        {"id": 2, "caminho_key": path_key("C:/work/app/docs")},
    ]
    assert resolve("c:\\WORK\\app\\docs\\file", roots)["id"] == 2
    assert resolve("C:/work/app-old", roots) is None
    assert resolve("/home/me/app", [{"id": 3, "caminho_key": path_key("/home/me")}])["id"] == 3
    assert path_key("C:/work/app/../other") == path_key("C:/work/other")
    assert path_key("/home/me/app/../other") == path_key("/home/me/other")


def test_unmapped_session_moves_immediately_when_mapped_and_returns_after_delete(client: TestClient):
    event_file({"session_id": "s1", "cwd": "C:/work/atlas/src",
                "evento": "SessionStart", "t": "2026-10-07T12:00:00+00:00"})
    first = client.get("/api/sessoes").json()["sessoes"]
    assert first[0]["projeto_id"] is None
    created = project(client, "Atlas CRM", "C:/work/atlas")
    mapped = client.get("/api/sessoes").json()["sessoes"]
    assert mapped[0]["projeto_id"] == created["id"]
    client.delete(f"/api/projetos/{created['id']}")
    after_delete = client.get("/api/sessoes").json()["sessoes"]
    assert after_delete[0]["projeto_id"] is None
    assert after_delete[0]["session_id"] == "s1"


def test_mapping_existing_project_replaces_its_path(client: TestClient):
    created = project(client, "Orion Flow", "/work/orion")
    event_file(
        {"session_id": "old", "cwd": "/work/orion/src",
         "evento": "SessionStart", "t": "2026-10-07T12:00:00+00:00"},
        {"session_id": "new", "cwd": "/work/orion-v2/src",
         "evento": "SessionStart", "t": "2026-10-07T12:01:00+00:00"},
    )
    before = {s["session_id"]: s for s in client.get("/api/sessoes").json()["sessoes"]}
    assert before["old"]["projeto_id"] == created["id"]
    assert before["new"]["projeto_id"] is None
    response = client.put(f"/api/projetos/{created['id']}",
                          json={"nome": "Orion Flow", "caminho_local": "/work/orion-v2"})
    assert response.status_code == 200
    after = {s["session_id"]: s for s in client.get("/api/sessoes").json()["sessoes"]}
    assert after["old"]["projeto_id"] is None
    assert after["new"]["projeto_id"] == created["id"]


def test_archived_project_still_matches_and_duplicate_path_is_rejected(client: TestClient):
    created = project(client, "Aurora Hub", "/home/demo/aurora")
    assert client.post("/api/projetos",
                       json={"nome": "Other", "caminho_local": "/home/demo/aurora"}).status_code == 409
    client.post(f"/api/projetos/{created['id']}/arquivar")
    event_file({"session_id": "s2", "cwd": "/home/demo/aurora/src",
                "evento": "SessionStart", "t": "2026-10-07T12:00:00+00:00"})
    assert client.get("/api/sessoes").json()["sessoes"][0]["projeto_id"] == created["id"]


def test_hook_discards_conversation_text(client: TestClient, tmp_path: Path):
    hook = Path(__file__).resolve().parents[1] / "hooks" / "capture.py"
    payload = {
        "hook_event_name": "UserPromptSubmit", "session_id": "s3",
        "cwd": "/home/demo/atlas", "prompt": "PRIVATE PROMPT",
        "last_assistant_message": "PRIVATE ANSWER",
        "background_tasks": [{"id": "a1", "description": "PRIVATE TASK", "status": "running"}],
    }
    env = os.environ.copy()
    env["AI_OPERATIONS_ROOM_DATA_DIR"] = str(tmp_path)
    result = subprocess.run([sys.executable, str(hook)], input=json.dumps(payload),
                            text=True, capture_output=True, env=env, check=True)
    assert result.stdout == ""
    contents = events_path().read_text(encoding="utf-8")
    assert "PRIVATE" not in contents
    assert '"cwd": "/home/demo/atlas"' in contents
