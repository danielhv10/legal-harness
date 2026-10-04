# letrado

Terminal agent for Spanish lawyers: legislation, case law and administrative resolutions, plus tools to work on the documents of a case file. Built as a wrapper around [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`).

The user interface, prompts, skills and templates are in Spanish because the product is aimed at Spanish legal professionals. This documentation and the commit history are in English.

## What it does

- Conversation with an AI model using **your own subscription** to Claude (Pro/Max), ChatGPT (Plus/Pro) or GitHub Copilot, with no API keys (`/login`).
- Legal sources through an MCP server (`research`, `search_legal`, `get_document`, `list_sources`): consolidated BOE with per-article validity status, CENDOJ, case law, TEAC/DGT/AEPD/CNMC/Fiscalía resolutions and legal doctrine.
- Reading PDF and Word files from the case folder (`read_pdf`, `read_docx`), creating Word documents (`write_docx`), web search and reading (`web_search`, `web_fetch`) and Pi's file tools (`read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`).
- Citation guardrail: links, Roj and ECLI identifiers that were not served by the sources in the current session are removed from the answers (`/citas` lists what was served and what was stripped).
- Case files ("expedientes"): `cd` into the matter's folder (its `AGENTS.md` is picked up) or run `/expediente <dir>`; `/expediente init` creates `EXPEDIENTE.md` and `AGENTS.md` from templates. A widget above the editor shows the case name, the next deadline and the documents read so far.
- Task list maintained by the model (`tareas` tool, `/tareas`), shown as a widget like Claude Code's todo list.
- Skills (`redaccion-demanda`, `informe-juridico`, `plazos-procesales`) and prompt templates (`/dictamen`, `/resumen-expediente`, `/comparar-versiones`).
- A dedicated look: block-letter wordmark, welcome panel, context-aware footer, Spanish tool cards, bordered status editor, overlay permission dialogs and the "verde letrado" theme (light and dark).

## Requirements

- Node.js 22.19 or newer.
- A legal-sources MCP server running locally (see below). Without it, letrado still works as an assistant over local documents and the web.

## Installation

```bash
pnpm install
pnpm build
pnpm add -g .          # or: npm link
letrado --help
```

First run: letrado creates `~/.letrado/agent/` with `settings.json`, `SYSTEM.md`, themes, skills, prompt templates and `mcp.json`, and offers to pick the subscription to work with. Optional variables:

| Variable | Purpose |
|---|---|
| `LETRADO_HOME` | Alternative base directory (default `~/.letrado`). |
| `LETRADO_MCP_COMMAND`, `LETRADO_MCP_ARGS` | MCP server command written into the first `mcp.json` (e.g. `node` and `/path/to/mcp-server/dist/index.js`). |
| `LETRADO_MCP_ENV_FILE` | `.env` file the MCP server should load. |
| `LETRADO_WEB_SEARCH` | `duckduckgo` (default, no key), `tavily`, `brave` or `exa` (require `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`). |

Managed resources (`SYSTEM.md`, themes, skills, prompt templates) are synchronised by content hash on every start: when a new letrado version changes them they are updated, and if you had edited one yourself a `.bak-<version>` copy is kept next to it. `settings.json` and `APPEND_SYSTEM.md` belong to you and are never overwritten.

## Connecting the sources server

Edit `~/.letrado/agent/mcp.json` or run:

```bash
letrado mcp add fuentes -- node /path/to/mcp-server/dist/index.js
letrado mcp list
```

Recommended entry (`timeout` is high because `research` takes 20 to 90 seconds; `exposure: direct` lets the model see the tools without intermediate steps):

```json
{
  "mcpServers": {
    "fuentes": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": { "MAITE_MCP_ENV_FILE": "/path/to/mcp-server/.env" },
      "timeout": 300,
      "exposure": "direct",
      "description": "Corpus jurídico español: BOE, CENDOJ, resoluciones y doctrina"
    }
  }
}
```

Inside a session, `/mcp` shows the connection status.

## Usage

```bash
cd ~/expedientes/garcia-vs-constructora
letrado
```

Useful commands: `/login` (subscription), `/model` (model), `/expediente`, `/tareas`, `/citas`, `/dictamen <question>`, `/resumen-expediente`, `/comparar-versiones a.docx b.docx`, `/letrado` (status), `/ayuda` (command list), `/editor clasico|letrado` (editor style), `! <command>` (shell).

Full screen: letrado starts in full-screen mode by default (`tuiMode: "fullscreen"`, with an automatic scrollbar). To go back to the classic terminal mode (the conversation is printed into the normal scrollback) set `tuiMode` to `regular` from `/settings` or by editing `~/.letrado/agent/settings.json` (`"tuiMode": "regular"`); the change applies on restart.

Non-interactive mode:

```bash
letrado -p "¿Qué plazo tengo para contestar a la demanda en juicio ordinario? Cita la norma."
```

## Subscriptions and cost

letrado needs no API keys: Pi ships OAuth sign-in for Claude (Pro/Max), ChatGPT (Plus/Pro) and GitHub Copilot, among others. Credentials are stored in `~/.letrado/agent/auth.json`.

Note: according to Pi's documentation, Anthropic bills usage from third-party applications on Pro/Max subscriptions as *extra usage* per token rather than against the plan limits. ChatGPT does consume the subscription.

The MCP server keys (embeddings and research engine) belong to the server's infrastructure, not to the user; they live in its `.env`.

## Development

```bash
pnpm install
pnpm dev              # TUI with PI_CODING_AGENT_DIR=./.dev-agent
pnpm typecheck
pnpm test
pnpm build
```

Layout: `src/cli.ts` (startup), `src/bootstrap.ts` (preparation of `~/.letrado/agent`), `src/extensions/*` (branding, onboarding, safety, tools, tool renderers, citations, case files, widgets, tasks, editor), `src/lib/*` (pure, tested code), `resources/*` (SYSTEM.md, themes, skills, templates).

## Known limitations (milestone 1)

- Editing existing `.docx` files with tracked changes: pending (phase 2). `write_docx` creates new documents.
- OCR for scanned PDFs: pending.
- Some of Pi's internal strings (settings, updates) still read "pi".
