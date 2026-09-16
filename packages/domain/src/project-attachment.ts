import { promptInputSchema, type PromptInput } from "./shared-types.js";
import { z } from "zod";

export class ProjectAttachmentError extends Error {}

export function pathLooksRuntimeReadable(path: string): boolean {
  return /^[\\/]|^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(path);
}

export function canonicalProjectAttachmentPath(path: string): string {
  if (pathLooksRuntimeReadable(path) || path.includes("\0")) {
    throw new ProjectAttachmentError(
      "Attachment path escapes project directory",
    );
  }
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new ProjectAttachmentError(
          "Attachment path escapes project directory",
        );
      }
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    throw new ProjectAttachmentError(
      "Attachment path must refer to a file inside the project directory",
    );
  }
  if (parts[0] === ".pending")
    throw new ProjectAttachmentError("Attachment path is reserved for uploads");
  return parts.join("/");
}

export function projectAttachmentPaths(
  input: readonly PromptInput[],
): string[] {
  return [
    ...new Set(
      input.flatMap((item) =>
        (item.type === "localImage" || item.type === "localFile") &&
        !pathLooksRuntimeReadable(item.path)
          ? [canonicalProjectAttachmentPath(item.path)]
          : [],
      ),
    ),
  ];
}

const attachmentEventInputSchema = z.object({
  input: z.array(promptInputSchema),
  inputGroups: z.array(z.array(promptInputSchema)).optional(),
});

export function parseAttachmentEventInput(data: string): PromptInput[] {
  const parsed = attachmentEventInputSchema.parse(JSON.parse(data));
  return [...parsed.input, ...(parsed.inputGroups?.flat() ?? [])];
}
