import Handlebars from "handlebars";
import type {
  TemplateId,
  TemplateVariables,
} from "./generated/templates.generated.js";
import { templateRegistry } from "./registry.js";

let partialsRegistered = false;
function ensurePartialsRegistered() {
  if (partialsRegistered) return;
  for (const definition of Object.values(templateRegistry)) {
    Handlebars.registerPartial(definition.id, definition.body);
  }
  partialsRegistered = true;
}

const compiledTemplateCache = new Map<
  TemplateId,
  HandlebarsTemplateDelegate<TemplateVariables[TemplateId]>
>();

function getCompiledTemplate<TTemplateId extends TemplateId>(
  templateId: TTemplateId,
) {
  const cached = compiledTemplateCache.get(templateId);
  if (cached) {
    return cached as HandlebarsTemplateDelegate<TemplateVariables[TTemplateId]>;
  }

  const compiled = Handlebars.compile<TemplateVariables[TTemplateId]>(
    templateRegistry[templateId].body,
    { noEscape: true },
  );
  compiledTemplateCache.set(
    templateId,
    compiled as HandlebarsTemplateDelegate<TemplateVariables[TemplateId]>,
  );
  return compiled;
}

export function renderTemplate<TTemplateId extends TemplateId>(
  templateId: TTemplateId,
  variables: TemplateVariables[TTemplateId],
): string {
  ensurePartialsRegistered();
  return getCompiledTemplate(templateId)(variables).trim();
}
