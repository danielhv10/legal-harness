import { copyFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExpedienteSection, readExpediente } from "../lib/expediente.js";
import { state } from "../state.js";
import { resourcesDir } from "../version.js";

const ENTRY_TYPE = "letrado-expediente";

interface ExpedienteEntry {
  dir: string | null;
}

export function expedienteExtension(pi: ExtensionAPI): void {
  function activate(dir: string): string {
    const info = readExpediente(dir);
    state.setExpediente({ dir: info.dir, name: info.name, instructions: info.instructions });
    pi.setSessionName(info.name);
    return info.name;
  }

  pi.on("session_start", async (_event, ctx) => {
    state.setExpediente({});
    // Restaurar el último expediente activo de la rama (persistido con appendEntry).
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i];
      if (e && e.type === "custom" && e.customType === ENTRY_TYPE) {
        const data = e.data as ExpedienteEntry | undefined;
        if (data?.dir && existsSync(data.dir)) activate(data.dir);
        break;
      }
    }
  });

  pi.on("before_agent_start", async (event) => {
    const dir = state.expediente.dir;
    if (!dir || !existsSync(dir)) return;
    event.systemPromptOptions.sections.expediente = buildExpedienteSection(readExpediente(dir));
  });

  pi.registerCommand("expediente", {
    description: "Activa un expediente: /expediente <dir> · /expediente init [dir] · /expediente off",
    handler: async (args, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (!sub) {
        ctx.ui.notify(
          state.expediente.dir
            ? `Expediente activo: ${state.expediente.name}\n${state.expediente.dir}`
            : "Sin expediente activo. Usa /expediente <dir> o /expediente init [dir]",
          "info",
        );
        return;
      }
      if (sub === "off") {
        state.setExpediente({});
        pi.appendEntry(ENTRY_TYPE, { dir: null } satisfies ExpedienteEntry);
        ctx.ui.notify("Expediente desactivado", "info");
        return;
      }
      const target = resolve(ctx.cwd, sub === "init" ? (rest[0] ?? ".") : sub);
      if (!existsSync(target) || !statSync(target).isDirectory()) {
        ctx.ui.notify(`No existe el directorio ${target}`, "error");
        return;
      }
      if (sub === "init" || !existsSync(join(target, "EXPEDIENTE.md"))) {
        const create =
          sub === "init" ||
          (ctx.hasUI &&
            (await ctx.ui.confirm(
              "Crear plantillas",
              `No hay EXPEDIENTE.md en ${target}.\n¿Crear EXPEDIENTE.md y AGENTS.md de plantilla?`,
            )));
        if (create) {
          const res = resourcesDir();
          if (!existsSync(join(target, "EXPEDIENTE.md")))
            copyFileSync(join(res, "EXPEDIENTE.md"), join(target, "EXPEDIENTE.md"));
          if (!existsSync(join(target, "AGENTS.md")))
            copyFileSync(join(res, "AGENTS.expediente.md"), join(target, "AGENTS.md"));
          ctx.ui.notify(
            "Plantillas creadas: EXPEDIENTE.md y AGENTS.md. Rellena las partes, el estado y los plazos.",
            "info",
          );
        }
      }
      const name = activate(target);
      pi.appendEntry(ENTRY_TYPE, { dir: target } satisfies ExpedienteEntry);
      ctx.ui.notify(`Expediente activo: ${name}`, "info");
    },
  });
}
