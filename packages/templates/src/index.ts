export {
  getTemplateMetadata,
  listTemplates,
  renderTemplate,
} from "./render-template.js";
// The plugin scaffold lives at the "@bb/templates/plugin-scaffold" subpath:
// it touches node:fs and this barrel is imported by the browser app.
export type {
  TemplateId,
  TemplateVariables,
} from "./generated/templates.generated.js";
export type {
  TemplateDefinition,
  TemplateKind,
  TemplateMetadata,
} from "./registry.js";
