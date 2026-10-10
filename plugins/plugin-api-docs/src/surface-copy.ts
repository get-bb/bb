export const COPY_TOKEN =
  /(`[^`]+`)|(\[[^\]]+\]\([a-z0-9-]+\))|(\{experimental\})/g;

export function plainSurfaceCopy(text: string): string {
  return text
    .split(COPY_TOKEN)
    .filter((part) => part !== undefined)
    .map((part) => {
      if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) {
        return part.slice(1, -1);
      }
      if (part === "{experimental}") return "";
      return /^\[([^\]]+)\]\([a-z0-9-]+\)$/.exec(part)?.[1] ?? part;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}
