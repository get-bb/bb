import { useState } from "react";
import { MarkdownPreview } from "./markdown-preview.js";
import { MarkdownMermaidDiagram } from "./markdown-mermaid-diagram.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Markdown mermaid diagram",
};

const FLOWCHART = `flowchart TD
  A[Start] --> B{Has changes?}
  B -->|Yes| C[Commit]
  B -->|No| D[Skip]
  C --> E[Push]
  D --> E`;

const SEQUENCE = `sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: Request
  S-->>U: Response`;

const STREAMING_STEPS = [
  "flowchart TD\n  A[Start]",
  "flowchart TD\n  A[Start] --> B[",
  "flowchart TD\n  A[Start] --> B[Finish]",
  "flowchart TD\n  A[Start] --> B[Finish]\n  B --> C[",
  "flowchart TD\n  A[Start] --> B[Finish]\n  B --> C[Done]",
  "flowchart TD\n  A[Start] --> B[Finish]\n  B --> C[Done]\n```\n\nDone.",
];

export function Streaming() {
  const [step, setStep] = useState(0);
  return (
    <StoryCard>
      <StoryRow label="streaming" hint="Advance through incomplete node labels">
        <div className="w-full max-w-[640px]">
          <button
            type="button"
            onClick={() =>
              setStep((current) => (current + 1) % STREAMING_STEPS.length)
            }
          >
            Next chunk ({step + 1}/{STREAMING_STEPS.length})
          </button>
          <MarkdownPreview
            content={`\`\`\`mermaid\n${STREAMING_STEPS[step]}`}
            incrementalBlocks
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="flowchart"
        hint="inline diagram; the Maximize control opens the shadow-sm viewer dialog"
      >
        <div className="w-full max-w-[640px]">
          <MarkdownMermaidDiagram preferredTheme="light" source={FLOWCHART} />
        </div>
      </StoryRow>
      <StoryRow label="sequence" hint="a second diagram kind">
        <div className="w-full max-w-[640px]">
          <MarkdownMermaidDiagram preferredTheme="light" source={SEQUENCE} />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
