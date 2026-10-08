#!/usr/bin/env bash
# Inicia o AI Operations Room em segundo plano e abre o navegador (Linux).
# Equivalente a scripts/start-room.ps1.
#
# Uso: scripts/start-room.sh [--port N] [--no-browser]
set -euo pipefail

port=8765
open_browser=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port) port="${2:?--port precisa de um número}"; shift 2 ;;
        --no-browser) open_browser=0; shift ;;
        -h|--help) sed -n 2,6p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
    esac
done

if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "Porta inválida: $port" >&2
    exit 2
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python="$repo/.venv/bin/python"
url="http://127.0.0.1:$port"
data_dir="${AI_OPERATIONS_ROOM_DATA_DIR:-$HOME/.ai-operations-room}"
log="$data_dir/server.log"

if [[ ! -x "$python" ]]; then
    echo "Ambiente Python ausente. Execute 'uv sync --extra dev' na pasta do projeto primeiro." >&2
    exit 1
fi

if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "A porta $port já está em uso. Feche o outro servidor ou escolha outra com --port." >&2
    exit 1
fi

mkdir -p "$data_dir"
cd "$repo"
nohup "$python" -m backend.cli serve --port "$port" >>"$log" 2>&1 &
pid=$!

ready=0
for _ in $(seq 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
        break
    fi
    if "$python" -c "import urllib.request,sys; urllib.request.urlopen('$url/api/health', timeout=1)" 2>/dev/null; then
        ready=1
        break
    fi
    sleep 0.5
done

if (( ! ready )); then
    echo "O servidor não respondeu em $url. Veja o log em $log." >&2
    kill "$pid" 2>/dev/null || true
    exit 1
fi

if (( open_browser )) && command -v xdg-open >/dev/null; then
    xdg-open "$url/" >/dev/null 2>&1 || true
fi

echo "AI Operations Room em $url/ (PID $pid). Log: $log"
echo "Para encerrar: kill $pid"
