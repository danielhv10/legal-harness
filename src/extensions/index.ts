import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { brandingExtension } from "./branding.js";
import { citationsExtension } from "./citations.js";
import { editorExtension } from "./editor.js";
import { expedienteExtension } from "./expediente.js";
import { legalToolsExtension } from "./legal-tools.js";
import { onboardingExtension } from "./onboarding.js";
import { safetyExtension } from "./safety.js";
import { tareasExtension } from "./tareas.js";
import { toolRenderersExtension } from "./tool-renderers.js";
import { widgetsExtension } from "./widgets.js";

/**
 * Orden relevante: los handlers de `tool_call` corren en orden de registro
 * (seguridad antes que herramientas) y `tool_result` de citas debe ver el contenido final.
 */
export const extensionFactories: InlineExtension[] = [
  { name: "letrado-branding", factory: brandingExtension, hidden: true },
  { name: "letrado-tool-renderers", factory: toolRenderersExtension, hidden: true },
  { name: "letrado-onboarding", factory: onboardingExtension, hidden: true },
  { name: "letrado-safety", factory: safetyExtension },
  { name: "letrado-tools", factory: legalToolsExtension },
  { name: "letrado-expediente", factory: expedienteExtension },
  { name: "letrado-citations", factory: citationsExtension },
  { name: "letrado-widgets", factory: widgetsExtension, hidden: true },
  { name: "letrado-tareas", factory: tareasExtension },
  { name: "letrado-editor", factory: editorExtension, hidden: true },
];
