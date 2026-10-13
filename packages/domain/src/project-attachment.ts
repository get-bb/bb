import { type PromptInput } from "./shared-types.js";

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

export type ProjectAttachmentOwnershipMode = "required" | "best-effort";

function resolvableAttachmentPath(path: string): string[] {
  if (pathLooksRuntimeReadable(path)) return [];
  try {
    return [canonicalProjectAttachmentPath(path)];
  } catch (error) {
    if (error instanceof ProjectAttachmentError) return [];
    throw error;
  }
}

function referencedAttachmentPath(
  item: PromptInput,
  mode: ProjectAttachmentOwnershipMode,
): string[] {
  if (item.type !== "localImage" && item.type !== "localFile") return [];
  if (mode === "best-effort") return resolvableAttachmentPath(item.path);
  if (pathLooksRuntimeReadable(item.path)) return [];
  return [canonicalProjectAttachmentPath(item.path)];
}

export function projectAttachmentPaths(
  input: readonly PromptInput[],
  mode: ProjectAttachmentOwnershipMode = "required",
): string[] {
  return [
    ...new Set(input.flatMap((item) => referencedAttachmentPath(item, mode))),
  ];
}

function attachmentPathFromItem(item: unknown): string[] {
  if (typeof item !== "object" || item === null) return [];
  const reference = item as { type?: unknown; path?: unknown };
  if (reference.type !== "localFile" && reference.type !== "localImage")
    return [];
  if (typeof reference.path !== "string") return [];
  return resolvableAttachmentPath(reference.path);
}

function storedInputItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return [];
  const stored = parsed as { input?: unknown; inputGroups?: unknown };
  const items = Array.isArray(stored.input) ? [...stored.input] : [];
  if (Array.isArray(stored.inputGroups))
    for (const group of stored.inputGroups)
      if (Array.isArray(group)) items.push(...group);
  return items;
}

export function storedAttachmentPaths(data: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  return [...new Set(storedInputItems(parsed).flatMap(attachmentPathFromItem))];
}
