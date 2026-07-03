export {
  getTemplateMetadata,
  listTemplates,
  renderTemplate,
} from "./render-template.js";
export { scaffoldPlugin, type ScaffoldPluginArgs } from "./plugin-scaffold.js";
export type {
  TemplateId,
  TemplateVariables,
} from "./generated/templates.generated.js";
export type {
  TemplateDefinition,
  TemplateKind,
  TemplateMetadata,
} from "./registry.js";
