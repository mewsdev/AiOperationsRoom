"""Local API and static frontend for AI Operations Room."""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel

from backend.config import FRONTEND
from backend.db import connect, init_db
from backend.events import ingest
from backend import projects
from backend import runs
from backend.reconcile import reconcile


class ProjectInput(BaseModel):
    nome: str
    caminho_local: str


def database() -> Iterator[sqlite3.Connection]:
    with connect() as con:
        yield con


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI Operations Room", lifespan=lifespan)
# Reject other Host names so a DNS-rebinding page cannot reach the local API.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/projetos")
def list_projects(con: sqlite3.Connection = Depends(database)) -> list[dict]:
    return [projects.public(p) for p in projects.list_all(con)]


def _save(con: sqlite3.Connection, data: ProjectInput, project_id: int | None = None) -> dict:
    try:
        return projects.save(con, nome=data.nome, caminho_local=data.caminho_local,
                             project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Nome ou pasta já cadastrados.") from exc


@app.post("/api/projetos", status_code=201)
def create_project(data: ProjectInput, con: sqlite3.Connection = Depends(database)) -> dict:
    return _save(con, data)


@app.put("/api/projetos/{project_id}")
def update_project(project_id: int, data: ProjectInput,
                   con: sqlite3.Connection = Depends(database)) -> dict:
    if projects.get(con, project_id) is None:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    return _save(con, data, project_id)


@app.post("/api/projetos/{project_id}/arquivar")
def archive_project(project_id: int, con: sqlite3.Connection = Depends(database)) -> dict:
    return _set_archive(con, project_id, True)


@app.post("/api/projetos/{project_id}/desarquivar")
def unarchive_project(project_id: int, con: sqlite3.Connection = Depends(database)) -> dict:
    return _set_archive(con, project_id, False)


def _set_archive(con: sqlite3.Connection, project_id: int, archived: bool) -> dict:
    if projects.get(con, project_id) is None:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    con.execute(
        "UPDATE projeto SET arquivado = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
        "WHERE id = ?", (int(archived), project_id),
    )
    return projects.public(projects.get(con, project_id))


@app.delete("/api/projetos/{project_id}")
def delete_project(project_id: int, con: sqlite3.Connection = Depends(database)) -> dict:
    cursor = con.execute("DELETE FROM projeto WHERE id = ?", (project_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    return {"removido": True}


@app.get("/api/sessoes")
def list_sessions(con: sqlite3.Connection = Depends(database)) -> dict:
    ingest(con)
    mapped = projects.list_all(con)
    rows = con.execute(
        "SELECT session_id, cwd, ultimo_evento, ultima_atualizacao "
        "FROM sessao WHERE cwd <> '' ORDER BY ultima_atualizacao DESC LIMIT 200"
    ).fetchall()
    sessions = []
    for row in rows:
        session = dict(row)
        match = projects.resolve(session["cwd"], mapped)
        session["projeto_id"] = match["id"] if match else None
        session["projeto_nome"] = match["nome"] if match else None
        sessions.append(session)
    return {"sessoes": sessions}


def _project_for(cwd: str, mapped: list[dict]) -> dict | None:
    return projects.resolve(cwd, mapped)


@app.get("/api/painel")
def dashboard(horas: int = Query(6, ge=1, le=24),
              convivencia: int = Query(12, ge=0, le=24),
              con: sqlite3.Connection = Depends(database)) -> dict:
    ingest(con)
    reconcile(con)
    mapped = projects.list_all(con)
    now = datetime.now(timezone.utc)
    window = (now - timedelta(hours=horas)).isoformat(timespec="seconds")
    visible = (now - timedelta(hours=convivencia)).isoformat(timespec="seconds")
    rows = con.execute(
        "SELECT * FROM execucao WHERE estado IN ('trabalhando', 'delegando', 'aguardando') "
        "OR julianday(criado_em) >= julianday(?) OR julianday(atualizado_em) >= julianday(?) "
        "ORDER BY atualizado_em DESC", (window, visible)
    ).fetchall()
    items = [runs.public(row, _project_for(row["cwd"], mapped)) for row in rows]
    active = runs.ACTIVE
    summary_items = [item for item in items if item["estado"] in active or
                     _in_window(item["criado_em"], window) or _in_window(item["atualizado_em"], window)]
    principals_with_children = {row["pai_chave"] for row in con.execute(
        "SELECT DISTINCT pai_chave FROM execucao WHERE pai_chave IS NOT NULL"
    )}
    room_items = [item for item in items if item["estado"] in active or
                  (convivencia and _in_window(item["atualizado_em"], visible) and
                   (item["pai_chave"] is not None or item["chave"] in principals_with_children or
                    _duration(item) >= 30))]
    history: dict[str, list[dict]] = {}
    for item in sorted(summary_items, key=lambda x: x["criado_em"], reverse=True):
        history.setdefault(item["tipo"], []).append(item)
    history = {kind: entries[:50] for kind, entries in history.items()}
    return {
        "horas": horas,
        "convivencia": convivencia,
        "execucoes": room_items,
        "historico": summary_items,
        "historico_tipos": history,
        "sessoes": [item for item in summary_items if item["pai_chave"] is None],
        "resumo": {
            **{state: sum(item["estado"] == state for item in summary_items)
               for state in ("trabalhando", "delegando", "aguardando", "concluida", "orfa")},
            "sessoes_ativas": len({item["session_id"] for item in summary_items if item["estado"] in active}),
            "execucoes_na_janela": len(summary_items),
        },
    }


def _in_window(value: str, cutoff: str) -> bool:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) >= datetime.fromisoformat(cutoff)
    except (AttributeError, ValueError, TypeError):
        return False


def _duration(item: dict) -> float:
    try:
        start = datetime.fromisoformat(item["criado_em"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(item["atualizado_em"].replace("Z", "+00:00"))
        return (end - start).total_seconds()
    except (AttributeError, ValueError, TypeError):
        return 0


@app.get("/api/sessoes/{session_id}/historico")
def session_history(session_id: str, con: sqlite3.Connection = Depends(database)) -> dict:
    ingest(con)
    rows = con.execute(
        "SELECT id, nome, ocorrido_em, dados FROM evento WHERE session_id = ? "
        "ORDER BY ocorrido_em DESC, id DESC LIMIT 100", (session_id,)
    ).fetchall()
    return {"eventos": [dict(row) for row in rows]}


@app.get("/api/sessoes/{session_id}/agentes")
def session_agents(session_id: str, con: sqlite3.Connection = Depends(database)) -> dict:
    ingest(con)
    rows = con.execute(
        "SELECT * FROM execucao WHERE session_id = ? ORDER BY pai_chave, criado_em", (session_id,)
    ).fetchall()
    return {"agentes": [dict(row) for row in rows]}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


@app.get("/projetos")
def projects_page() -> FileResponse:
    return FileResponse(FRONTEND / "projects.html")


@app.get("/como-utilizar")
def how_to_page() -> FileResponse:
    return FileResponse(FRONTEND / "how-to.html")


app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api:app", host="127.0.0.1", port=8765)
