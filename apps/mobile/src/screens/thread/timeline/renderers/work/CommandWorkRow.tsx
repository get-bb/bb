import { TerminalOutputBlock } from "@/ansi";
import type { TimelineRowRendererProps } from "../../renderers";
import { commandMetadataLines } from "./work-row-model";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:command`: title (verb + command / exploration intent, duration or
 * status decoration) over the terminal card — command line, `source:`
 * metadata, ANSI output collapsed to its tail while streaming, exit code.
 */
export function CommandWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:command">) {
  const row = item.row;
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <TerminalOutputBlock
        commandLine={`$ ${row.command}`}
        metadataLines={commandMetadataLines(row)}
        output={row.output}
        exitCode={row.exitCode}
        streaming={row.status === "pending"}
        testID="timeline-command-output"
      />
    </WorkRowShell>
  );
}
