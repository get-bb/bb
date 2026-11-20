export type AgentInstructionSection =
  | { kind: "tool"; pluginId: string | null; toolName: string; text: string }
  | { kind: "plugin"; pluginId: string; text: string }
  | { kind: "dynamic"; pluginId: string; text: string }
  | { kind: "user"; source: string; text: string }
  | { kind: "workspace"; source: string; text: string };

function sectionHeading(section: AgentInstructionSection): string | null {
  switch (section.kind) {
    case "tool":
      return section.pluginId === null
        ? null
        : `The following instructions come from the BB plugin "${section.pluginId}" for its tool "${section.toolName}":`;
    case "plugin":
      return `The following instructions come from the BB plugin "${section.pluginId}":`;
    case "dynamic":
      return `The following dynamic instructions come from the BB plugin "${section.pluginId}":`;
    case "user":
      return `The following user instructions come from ${section.source}:`;
    case "workspace":
      return `The following workspace instructions come from ${section.source}:`;
  }
}

export function formatAgentInstructions(
  sections: readonly AgentInstructionSection[],
): string {
  return sections
    .flatMap((section) => {
      const heading = sectionHeading(section);
      return heading === null ? [section.text] : [heading, section.text];
    })
    .join("\n\n");
}
