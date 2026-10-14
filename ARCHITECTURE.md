# Arquitetura

```text
Claude Code ──hooks──> events.jsonl ──> SQLite ──> FastAPI em 127.0.0.1 ──> navegador
```

O hook é independente do servidor. Cada evento entra em uma fila JSONL local e a API consome as linhas completas na próxima consulta. O cursor de leitura e uma impressão digital do prefixo já lido ficam no SQLite. Quando o arquivo é substituído ou truncado, a leitura recomeça; o identificador do evento impede duplicação. A detecção usa os primeiros 4096 bytes do trecho lido e pressupõe que uma fila substituída tenha prefixo diferente.

## Dados

- `projeto`: nome e um diretório local para associação por `cwd`.
- `sessao`: último metadado recebido por sessão, usado pela tela de mapeamento.
- `evento`: histórico deduplicado, sem texto de conversa.
- `execucao`: projeção da sessão principal, dos subagentes e das consultas ao advisor.

Estados: `trabalhando`, `aguardando`, `delegando`, `concluida` e `orfa`. `SessionStart` cria o principal em `aguardando`; `UserPromptSubmit` o põe em `trabalhando`; `SubagentStart` cria a filha e põe o principal em `delegando`. `SubagentStop` conclui a filha e devolve o principal a `trabalhando` quando ela era a última ativa. Em `Stop`, uma filha ativa ausente da lista `background_tasks` é concluída como `interrompida`; sem a lista, nenhuma filha é encerrada por inferência. O principal fica `delegando` enquanto houver filha ativa e `aguardando` caso contrário. `SessionEnd` conclui toda a sessão. Sem evento de encerramento, a sessão é marcada `orfa` se o PID registrado em `~/.claude/sessions` morreu ou, sem registro, após dez minutos sem sinal. Eventos mais antigos não substituem um estado mais recente.

## Advisor

O advisor é uma ferramenta executada no servidor da API, e o Claude Code não dispara hook para ela. Por isso, a cada hook o `capture.py` lê o trecho novo do transcript indicado em `transcript_path` (ou `agent_transcript_path` em `SubagentStop`) e anexa à fila, antes do evento do hook, `AdvisorStart` (bloco `server_tool_use` de nome `advisor`) e `AdvisorStop` (bloco `advisor_tool_result`). Só o id da chamada, o horário da linha do transcript e o modelo do advisor são registrados; o texto da consulta e da resposta nunca é lido para a fila. O deslocamento lido de cada transcript fica em `advisor-cursors/` no diretório de dados, e linhas incompletas são relidas na próxima vez.

Cada chamada vira uma execução filha `advisor:<id>` de tipo `advisor`, ligada ao principal ou ao subagente que a fez. A consulta faz parte do turno de quem a chamou: ela não põe o principal em `delegando` nem é concluída como `interrompida` pela lista `background_tasks`. `Stop` conclui as consultas abertas do principal e `SubagentStop` as do subagente. Como a leitura acontece no próximo hook, uma consulta aparece com atraso: as do principal no próximo hook da sessão principal (`SubagentStart`, `UserPromptSubmit`, `Stop` ou `SessionEnd`) e as de um subagente no seu `SubagentStop`.

O painel conta execuções em uma janela selecionável de 6, 12 ou 24 horas. A sala mantém execuções ativas e concluídas há até 12 horas; apenas principais sem filhas encerradas em menos de 30 segundos não entram na sala. Dados fictícios da demo ficam fora da reconciliação de processos.

## Privacidade e rede

O backend só escuta em `127.0.0.1`. O hook filtra campos conhecidos de conteúdo e registra somente metadados necessários para a projeção. Não há envio de dados para serviços externos.
