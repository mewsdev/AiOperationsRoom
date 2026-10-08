#!/usr/bin/env bash
# Registra o AI Operations Room como serviço de usuário do systemd,
# para que o servidor inicie sozinho a cada login (Linux).
#
# Uso: scripts/autostart-linux.sh install [--port N]
#      scripts/autostart-linux.sh remove
#      scripts/autostart-linux.sh status
set -euo pipefail

name="ai-operations-room.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/$name"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python="$repo/.venv/bin/python"

if ! command -v systemctl >/dev/null; then
    echo "systemctl não encontrado. Use scripts/start-room.sh no lugar." >&2
    exit 1
fi

action="${1:-}"
shift || true

case "$action" in
    install)
        port=8765
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --port) port="${2:?--port precisa de um número}"; shift 2 ;;
                *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
            esac
        done
        if [[ ! -x "$python" ]]; then
            echo "Ambiente Python ausente. Execute 'uv sync --extra dev' na pasta do projeto primeiro." >&2
            exit 1
        fi
        mkdir -p "$unit_dir"
        cat >"$unit" <<UNIT
[Unit]
Description=AI Operations Room (painel local de sessões do Claude Code)

[Service]
Type=simple
WorkingDirectory=$repo
ExecStart="$python" -m backend.cli serve --port $port
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
        systemctl --user daemon-reload
        systemctl --user enable --now "$name"
        echo "Serviço instalado em $unit"
        echo "Sala disponível em http://127.0.0.1:$port/"
        echo "Logs: journalctl --user -u $name -f"
        ;;
    remove)
        systemctl --user disable --now "$name" 2>/dev/null || true
        rm -f "$unit"
        systemctl --user daemon-reload
        echo "Serviço removido."
        ;;
    status)
        systemctl --user status "$name" --no-pager
        ;;
    *)
        sed -n 2,8p "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
