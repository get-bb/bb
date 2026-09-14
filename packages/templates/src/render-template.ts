import Handlebars from "handlebars";
import {
  templateDefinitions,
  type TemplateId,
  type TemplateVariables,
} from "./generated/templates.generated.js";

const templateBodyById = Object.fromEntries(
  templateDefinitions.map((definition) => [definition.id, definition.body]),
) as Record<TemplateId, string>;

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
    templateBodyById[templateId],
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
  return getCompiledTemplate(templateId)(variables).trim();
}
