# Docker

O container executa somente o servidor (API + interface). O hook continua no host, porque o Claude Code roda no host: ele grava em `~/.ai-operations-room/events.jsonl`, e essa mesma pasta é montada no container em `/data`.

```text
Claude Code (host) ──hook──> ~/.ai-operations-room ──bind mount──> container :8765 ──> navegador
```

## Requisitos

- Docker com Compose v2 (Docker Engine no Linux ou Docker Desktop no Windows/macOS)
- Python 3 no host, somente para registrar e executar o hook (não precisa de `uv` nem de dependências)

## Início rápido (Linux)

```bash
cp .env.example .env
sed -i "s/^AIOR_UID=.*/AIOR_UID=$(id -u)/; s/^AIOR_GID=.*/AIOR_GID=$(id -g)/" .env
mkdir -p ~/.ai-operations-room
python3 -m backend.cli hooks-install
docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d --build
```

Abra [http://127.0.0.1:8765](http://127.0.0.1:8765). O container reinicia sozinho (`restart: unless-stopped`), inclusive depois de reiniciar a máquina, enquanto o serviço do Docker estiver ativo.

**Crie a pasta de dados antes do primeiro `up`.** Se ela não existir, o Docker a cria como `root`; o hook então não consegue gravar e, como ele nunca interrompe o Claude Code, a sala simplesmente fica vazia, sem mensagem de erro.

`docker-compose.linux.yml` monta `~/.claude/sessions` somente leitura e usa `pid: host`, para que a detecção de sessões interrompidas confira os PIDs do Claude Code como na execução local.

## Início rápido (Windows/macOS com Docker Desktop)

```powershell
Copy-Item .env.example .env
# No Windows, edite .env e defina AIOR_DATA_DIR=C:/Users/<voce>/.ai-operations-room
New-Item -ItemType Directory -Force "$HOME\.ai-operations-room"
python -m backend.cli hooks-install
docker compose up -d --build
```

Use **apenas** `docker-compose.yml`. Os PIDs registrados em `~/.claude/sessions` pertencem ao sistema hospedeiro e não existem dentro da VM Linux do Docker Desktop; conferi-los marcaria toda sessão como órfã. Sem o registro, uma sessão sem evento de encerramento passa a `orfa` após dez minutos sem sinal (veja [ARCHITECTURE.md](ARCHITECTURE.md)).

No macOS, `AIOR_UID`/`AIOR_GID` podem ficar com os valores do exemplo; o Docker Desktop ajusta as permissões das pastas montadas.

## Demonstração

```bash
docker compose --profile demo up --build demo
```

Os dados fictícios ficam dentro do container e somem quando ele é removido. Não rode `room` e `demo` ao mesmo tempo na mesma porta.

## Configuração (`.env`)

| Variável | Padrão | Uso |
| --- | --- | --- |
| `AIOR_UID` / `AIOR_GID` | `1000` | Usuário do container. Deve ser o mesmo dono da pasta de dados (`id -u` / `id -g`). |
| `AIOR_PORT` | `8765` | Porta publicada em `127.0.0.1` no host. |
| `AIOR_DATA_DIR` | `~/.ai-operations-room` | Pasta compartilhada entre hook e servidor. Se mudar, exporte também `AI_OPERATIONS_ROOM_DATA_DIR` com o mesmo caminho no ambiente do Claude Code. |
| `AIOR_SESSIONS_DIR` | `~/.claude/sessions` | Registro de sessões do Claude Code (somente com `docker-compose.linux.yml`). |

Dentro do container o servidor escuta em `0.0.0.0` (`AI_OPERATIONS_ROOM_HOST`), mas a porta só é publicada em `127.0.0.1` do host. Não troque para `0.0.0.0:8765:8765`: a API não tem autenticação.

## Operação

```bash
docker compose logs -f room       # logs
docker compose ps                 # estado e healthcheck (/api/health)
docker compose down               # parar (os dados ficam no host)
git pull && docker compose up -d --build   # atualizar
```

Use os mesmos `-f` do `up` em todos os comandos. Para remover os hooks, rode `python3 -m backend.cli hooks-remove` no host. Mantenha o repositório no mesmo lugar: o hook registrado aponta para `hooks/capture.py` deste checkout.

## Problemas comuns

- **Sala vazia:** confira se `~/.ai-operations-room/events.jsonl` está crescendo durante uma sessão do Claude Code e se a pasta pertence ao seu usuário (`ls -ld ~/.ai-operations-room`). Se for de `root`, corrija com `sudo chown -R $(id -u):$(id -g) ~/.ai-operations-room`.
- **`unable to open database file`:** o container não consegue gravar na pasta montada. Confira com `docker inspect ai-operations-room --format '{{range .Mounts}}{{.Source}} {{end}}'`:
  - Se aparecer `/root/...`, o compose foi executado com `sudo`, que troca `HOME` para `/root`. Rode sem `sudo` (adicione seu usuário ao grupo `docker`) ou defina `AIOR_DATA_DIR` e `AIOR_SESSIONS_DIR` com caminhos absolutos no `.env`.
  - Se o caminho estiver certo, `AIOR_UID`/`AIOR_GID` não correspondem ao dono da pasta de dados.

  Depois de corrigir, recrie o container com `docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d`, sem `sudo`. As pastas criadas por engano em `/root` não são mais usadas. Confira o conteúdo e remova-as com `sudo rm -rf /root/.ai-operations-room`. Faça o mesmo com `/root/.claude/sessions` somente se `/root/.claude` não tiver nada seu.
- **Porta ocupada:** defina outra `AIOR_PORT` no `.env`.
- **Rodar sem `sudo`:** adicione seu usuário ao grupo `docker` com `sudo usermod -aG docker $USER` e faça logout e login. Confirme com `docker ps`.
- **`Cannot connect to the Docker daemon at unix://~/.docker/desktop/docker.sock`:** o contexto ativo é o do Docker Desktop for Linux, que não está em execução. Abra o Docker Desktop ou passe a usar o Docker Engine nativo com `docker context use default`. Veja os contextos com `docker context ls`.
- **`error getting credentials ... docker-credential-desktop: executable file not found` no build:** o `~/.docker/config.json` aponta (`"credsStore": "desktop"`) para o gerenciador de credenciais do Docker Desktop, que não está disponível. Remova a linha `credsStore` desse arquivo ou faça o build com uma configuração vazia: `DOCKER_CONFIG=$(mktemp -d) docker compose build`. Essa configuração temporária também não tem os plugins de `~/.docker/cli-plugins`; se `docker compose` não for encontrado, copie essa pasta para ela.
- **Sessão indesejada na sala:** a fila `events.jsonl` é texto, uma linha JSON por evento. Para descartar uma sessão antes de ela ser lida, apague as linhas dela, por exemplo `sed -i '/"<session_id>"/d' ~/.ai-operations-room/events.jsonl`. Se ela já tiver sido lida, continua no banco e passa a órfã após dez minutos sem sinal.
