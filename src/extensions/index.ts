import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { brandingExtension } from "./branding.js";
import { citationsExtension } from "./citations.js";
import { expedienteExtension } from "./expediente.js";
import { legalToolsExtension } from "./legal-tools.js";
import { onboardingExtension } from "./onboarding.js";
import { safetyExtension } from "./safety.js";

/**
 * Orden relevante: los handlers de `tool_call` corren en orden de registro
 * (seguridad antes que herramientas) y `tool_result` de citas debe ver el contenido final.
 */
export const extensionFactories: InlineExtension[] = [
  { name: "letrado-branding", factory: brandingExtension, hidden: true },
  { name: "letrado-onboarding", factory: onboardingExtension, hidden: true },
  { name: "letrado-safety", factory: safetyExtension },
  { name: "letrado-tools", factory: legalToolsExtension },
  { name: "letrado-expediente", factory: expedienteExtension },
  { name: "letrado-citations", factory: citationsExtension },
];
