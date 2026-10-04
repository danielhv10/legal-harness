# letrado

Agente de terminal para abogados: legislación, jurisprudencia y resoluciones españolas con herramientas para trabajar sobre los documentos del expediente. Construido como envoltorio de [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`).

## Qué hace

- Conversación con un modelo de IA usando **tu suscripción** de Claude (Pro/Max), ChatGPT (Plus/Pro) o GitHub Copilot, sin API keys propias (`/login`).
- Consulta de fuentes jurídicas a través de un servidor MCP (`research`, `search_legal`, `get_document`, `list_sources`): BOE consolidado con vigencia por artículo, CENDOJ, jurisprudencia, resoluciones TEAC/DGT/AEPD/CNMC/Fiscalía y doctrina.
- Lectura de PDF y Word del expediente (`read_pdf`, `read_docx`), creación de documentos Word (`write_docx`), búsqueda y lectura web (`web_search`, `web_fetch`) y las herramientas de ficheros de Pi (`read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`).
- Guardarraíl de citas: elimina de las respuestas enlaces, Roj y ECLI que no provengan de las fuentes servidas en la sesión (`/citas` muestra lo servido y lo eliminado).
- Expedientes: `cd` a la carpeta del asunto (lee `AGENTS.md`) o `/expediente <dir>`; `/expediente init` crea `EXPEDIENTE.md` y `AGENTS.md` de plantilla.
- Skills (`redaccion-demanda`, `informe-juridico`, `plazos-procesales`) y plantillas (`/dictamen`, `/resumen-expediente`, `/comparar-versiones`).

## Requisitos

- Node.js 22.19 o superior.
- Un servidor MCP de fuentes jurídicas en ejecución local (ver más abajo). Sin él, letrado funciona como asistente con documentos locales y web.

## Instalación

```bash
pnpm install
pnpm build
pnpm add -g .          # o: npm link
letrado --help
```

Primer arranque: letrado crea `~/.letrado/agent/` con `settings.json`, `SYSTEM.md`, temas, skills, plantillas y `mcp.json`, y ofrece elegir la suscripción con la que trabajar. Variables opcionales:

| Variable | Uso |
|---|---|
| `LETRADO_HOME` | Directorio base alternativo (por defecto `~/.letrado`). |
| `LETRADO_MCP_COMMAND`, `LETRADO_MCP_ARGS` | Comando del servidor MCP para el primer `mcp.json` (p. ej. `node` y `/ruta/al/servidor-mcp/dist/index.js`). |
| `LETRADO_MCP_ENV_FILE` | Fichero `.env` que debe cargar el servidor MCP. |
| `LETRADO_WEB_SEARCH` | `duckduckgo` (por defecto, sin clave), `tavily`, `brave` o `exa` (requieren `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`). |

## Conectar el servidor de fuentes

Edita `~/.letrado/agent/mcp.json` o ejecuta:

```bash
letrado mcp add fuentes -- node /ruta/al/servidor-mcp/dist/index.js
letrado mcp list
```

Formato recomendado (`timeout` alto porque `research` tarda entre 20 y 90 s; `exposure: direct` para que el modelo vea las herramientas sin pasos intermedios):

```json
{
  "mcpServers": {
    "fuentes": {
      "command": "node",
      "args": ["/ruta/al/servidor-mcp/dist/index.js"],
      "env": { "MAITE_MCP_ENV_FILE": "/ruta/al/servidor-mcp/.env" },
      "timeout": 300,
      "exposure": "direct",
      "description": "Corpus jurídico español: BOE, CENDOJ, resoluciones y doctrina"
    }
  }
}
```

Dentro de una sesión, `/mcp` muestra el estado de la conexión.

## Uso

```bash
cd ~/expedientes/garcia-vs-constructora
letrado
```

Comandos útiles: `/login` (suscripción), `/model` (modelo), `/expediente`, `/citas`, `/dictamen <cuestión>`, `/resumen-expediente`, `/comparar-versiones a.docx b.docx`, `/letrado` (estado), `! <comando>` (shell).

Pantalla completa: letrado arranca por defecto en modo pantalla completa (`tuiMode: "fullscreen"`, con barra de desplazamiento automática). Para volver al modo clásico de terminal (la conversación se imprime en el scroll normal), cambia `tuiMode` a `regular` desde `/settings` o editando `~/.letrado/agent/settings.json` (`"tuiMode": "regular"`); el cambio se aplica al reiniciar. Con `/ayuda` se listan los comandos.

Modo no interactivo:

```bash
letrado -p "¿Qué plazo tengo para contestar a la demanda en juicio ordinario? Cita la norma."
```

## Suscripciones y coste

letrado no necesita API keys: Pi incluye el inicio de sesión OAuth de Claude (Pro/Max), ChatGPT (Plus/Pro) y GitHub Copilot, entre otros. Las credenciales se guardan en `~/.letrado/agent/auth.json`.

Aviso: según la documentación de Pi, Anthropic factura el uso desde aplicaciones de terceros con suscripción Pro/Max como *uso extra* por token, no contra los límites del plan. ChatGPT sí consume la suscripción.

Las claves del servidor MCP (embeddings y motor de investigación) son infraestructura del servidor, no del usuario; viven en su `.env`.

## Desarrollo

```bash
pnpm install
pnpm dev              # TUI con PI_CODING_AGENT_DIR=./.dev-agent
pnpm typecheck
pnpm test
pnpm build
```

Estructura: `src/cli.ts` (arranque), `src/bootstrap.ts` (preparación de `~/.letrado/agent`), `src/extensions/*` (branding, onboarding, seguridad, herramientas, citas, expediente), `src/lib/*` (código puro testeado), `resources/*` (SYSTEM.md, temas, skills, plantillas).

## Limitaciones conocidas (hito 1)

- Edición de `.docx` existentes con control de cambios: pendiente (fase 2). `write_docx` crea documentos nuevos.
- OCR de PDF escaneados: pendiente.
- Algunos textos internos de Pi (ajustes, actualizaciones) siguen mostrando "pi".
