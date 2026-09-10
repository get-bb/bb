import { readFileSync } from "node:fs";
import {
  mimeTypeFromExtension,
  type PromptInput,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ImageContent } from "@earendil-works/pi-ai";

interface ExtractedPiPromptInput {
  text?: string;
  images: ImageContent[];
}

interface SelectedPiSkill {
  chunkIndex: number;
  end: number;
  name: string;
  start: number;
}

export function extractPiPromptInput(
  input: PromptInput[],
): ExtractedPiPromptInput {
  const chunks: string[] = [];
  const images: ImageContent[] = [];
  const skills: SelectedPiSkill[] = [];
  for (const item of input) {
    if (item.type === "text") {
      const chunkIndex = chunks.push(item.text) - 1;
      for (const mention of item.mentions) {
        const resource = mention.resource;
        if (
          resource.kind === "command" &&
          resource.source === "skill" &&
          resource.trigger === "/" &&
          mention.start < mention.end &&
          mention.end <= item.text.length &&
          item.text.slice(mention.start, mention.end) ===
            `${resource.trigger}${resource.name}`
        ) {
          skills.push({
            chunkIndex,
            end: mention.end,
            name: resource.name,
            start: mention.start,
          });
        }
      }
    } else if (item.type === "localImage") {
      try {
        const data = readFileSync(item.path).toString("base64");
        images.push({
          type: "image",
          data,
          mimeType: mimeTypeFromExtension(item.path),
        });
      } catch {}
    } else if (item.type === "localFile") {
      chunks.push(`[Attached file: ${item.path}]`);
    }
  }
  const [skill] = skills;
  if (skills.length === 1 && skill) {
    const chunk = chunks[skill.chunkIndex];
    if (chunk !== undefined) {
      chunks[skill.chunkIndex] =
        `${chunk.slice(0, skill.start)}${chunk.slice(skill.end)}`;
      const argumentsText = chunks.join("\n");
      const separator = argumentsText.startsWith(" ") ? "" : " ";
      return {
        text: `/skill:${skill.name}${argumentsText ? `${separator}${argumentsText}` : ""}`,
        images,
      };
    }
  }
  return { text: chunks.length > 0 ? chunks.join("\n") : undefined, images };
}
