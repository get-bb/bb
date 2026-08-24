import { templateDefinitions } from "./generated/templates.generated.js";
import type { TemplateId } from "./generated/templates.generated.js";

const TEMPLATE_KINDS = ["instruction", "prompt", "system-message"] as const;

type TemplateKind = (typeof TEMPLATE_KINDS)[number];

interface TemplateDefinition {
  body: string;
  editingNotes?: string;
  fileName: string;
  id: TemplateId;
  intent?: string;
  kind: TemplateKind;
  summary?: string;
  title?: string;
  variables: Record<string, string>;
}

function isTemplateId(value: string): value is TemplateId {
  return templateDefinitions.some((definition) => definition.id === value);
}

function isTemplateKind(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).includes(value);
}

function decodeTemplateDefinitions(): Record<TemplateId, TemplateDefinition> {
  const entries = templateDefinitions.map((definition) => {
    if (!isTemplateId(definition.id)) {
      throw new Error(`Unknown generated template id: ${definition.id}`);
    }
    if (!isTemplateKind(definition.kind)) {
      throw new Error(`Unknown generated template kind: ${definition.kind}`);
    }
    return [
      definition.id,
      {
        ...definition,
        id: definition.id,
        kind: definition.kind,
      },
    ] as const;
  });
  return Object.fromEntries(entries) as Record<TemplateId, TemplateDefinition>;
}

export const templateRegistry = decodeTemplateDefinitions();
