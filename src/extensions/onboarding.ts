import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface SubscriptionOption {
  label: string;
  provider: string;
  note?: string;
}

const OPTIONS: SubscriptionOption[] = [
  {
    label: "Claude (suscripción Pro/Max)",
    provider: "anthropic",
    note: "Anthropic factura el uso desde aplicaciones de terceros como uso extra por token, no contra los límites del plan.",
  },
  {
    label: "ChatGPT (suscripción Plus/Pro)",
    provider: "openai-codex",
    note: "Consume tu suscripción de ChatGPT.",
  },
  { label: "GitHub Copilot", provider: "github-copilot" },
  { label: "Tengo una API key u otro proveedor", provider: "" },
];

function hasAnyAuth(ctx: ExtensionContext): boolean {
  try {
    return ctx.modelRegistry.getAvailable().length > 0;
  } catch {
    return true;
  }
}

/**
 * Primer arranque: si no hay ningún proveedor autenticado, ofrece iniciar sesión con una suscripción.
 * Pi gestiona el OAuth (claude.ai, ChatGPT, Copilot) y guarda las credenciales en auth.json.
 */
export function onboardingExtension(pi: ExtensionAPI): void {
  let shown = false;

  pi.on("session_start", async (event, ctx) => {
    if (ctx.mode !== "tui" || shown || event.reason !== "startup") return;
    if (hasAnyAuth(ctx)) return;
    shown = true;

    const choice = await ctx.ui.select(
      "Bienvenido a letrado. ¿Con qué suscripción quieres trabajar?",
      OPTIONS.map((o) => o.label),
    );
    const opt = OPTIONS.find((o) => o.label === choice);
    if (!opt) {
      ctx.ui.notify("Puedes iniciar sesión más tarde con /login", "info");
      return;
    }
    if (!opt.provider) {
      ctx.ui.setEditorText("/login");
      ctx.ui.notify("Pulsa Enter para elegir proveedor y método (API key u OAuth).", "info");
      return;
    }
    ctx.ui.setEditorText(`/login ${opt.provider}`);
    ctx.ui.notify(
      [
        `Pulsa Enter para iniciar sesión con ${opt.label}.`,
        opt.note ?? "",
        "Se abrirá el navegador; en SSH pega la URL de redirección o el código cuando se te pida.",
        "Después elige el modelo con /model.",
      ]
        .filter(Boolean)
        .join("\n"),
      "info",
    );
  });

  pi.registerCommand("suscripcion", {
    description: "Elegir la suscripción (Claude, ChatGPT, Copilot) con la que trabaja letrado",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select(
        "¿Con qué suscripción quieres trabajar?",
        OPTIONS.map((o) => o.label),
      );
      const opt = OPTIONS.find((o) => o.label === choice);
      if (!opt) return;
      ctx.ui.setEditorText(opt.provider ? `/login ${opt.provider}` : "/login");
      ctx.ui.notify(`Pulsa Enter para continuar.${opt.note ? `\n${opt.note}` : ""}`, "info");
    },
  });
}
