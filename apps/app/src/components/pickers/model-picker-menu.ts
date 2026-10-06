export const MODEL_PICKER_MENU_WIDTH_CLASS_NAME = "w-max min-w-64 max-w-80";

interface ModelLabelParts {
  base: string;
  tag: string | null;
}

export function splitModelLabelTag(label: string): ModelLabelParts {
  const match = label.match(/^(.*\S)\s*\(([^()]+)\)$/u);
  if (!match) {
    return { base: label, tag: null };
  }
  return { base: match[1], tag: match[2] };
}
