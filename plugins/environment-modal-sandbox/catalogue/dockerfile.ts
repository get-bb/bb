import { posix } from "node:path";
import { CatalogueError } from "./model.js";

export interface Instruction {
  line: number;
  instruction: "RUN" | "COPY" | "ENV" | "WORKDIR" | "ARG";
  argument: string;
}
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function safePath(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === ".." || part === ".git")
  )
    throw new CatalogueError(400, `Unsafe context path: ${path}`);
  return path;
}
export function parseDockerfile(text: string): Instruction[] {
  const result: Instruction[] = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    let value = lines[index]!.trim();
    if (!value || value.startsWith("#")) continue;
    while (value.endsWith("\\")) {
      if (++index >= lines.length)
        throw new CatalogueError(
          400,
          `Dockerfile line ${line}: unfinished continuation`,
        );
      value = `${value.slice(0, -1)} ${lines[index]!.trim()}`;
    }
    const match = /^([A-Za-z]+)\s+(.+)$/s.exec(value);
    const instruction = match?.[1]?.toUpperCase();
    const argument = match?.[2] ?? "";
    if (
      instruction !== "RUN" &&
      instruction !== "COPY" &&
      instruction !== "ENV" &&
      instruction !== "WORKDIR" &&
      instruction !== "ARG"
    )
      throw new CatalogueError(
        400,
        `Dockerfile line ${line}: unsupported instruction ${instruction ?? value}; bb supplies FROM and the runtime command`,
      );
    if (argument.startsWith("--") || argument.includes("<<"))
      throw new CatalogueError(
        400,
        `Dockerfile line ${line}: flags and heredocs are unsupported`,
      );
    if (
      /\b(?:BB_SERVER_URL|BB_ENROLLMENT|BB_APP_URL|MODAL_TOKEN_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|POOL_TOKEN)\b|-----BEGIN .*PRIVATE KEY-----/i.test(
        argument,
      )
    )
      throw new CatalogueError(
        400,
        `Dockerfile line ${line}: runtime credentials and server configuration cannot be baked into images`,
      );
    result.push({ line, instruction, argument });
  }
  return result;
}
export function copyArguments(step: Instruction): string[] {
  let words: string[];
  if (step.argument.startsWith("[")) {
    let value: unknown;
    try {
      value = JSON.parse(step.argument);
    } catch {
      throw new CatalogueError(
        400,
        `Dockerfile line ${step.line}: invalid COPY JSON`,
      );
    }
    if (
      !Array.isArray(value) ||
      !value.every((word): word is string => typeof word === "string")
    )
      throw new CatalogueError(
        400,
        `Dockerfile line ${step.line}: COPY requires string paths`,
      );
    words = value;
  } else {
    if (/["'\\]/.test(step.argument))
      throw new CatalogueError(
        400,
        `Dockerfile line ${step.line}: use JSON COPY for quoted paths`,
      );
    words = step.argument.split(/\s+/);
  }
  if (words.length < 2)
    throw new CatalogueError(
      400,
      `Dockerfile line ${step.line}: COPY needs source and destination`,
    );
  for (const source of words.slice(0, -1)) safePath(source);
  return words;
}
export function translateDockerfile(
  text: string,
  files: ReadonlyMap<string, { data: Buffer; executable: boolean }>,
): string[] {
  let workdir = "/";
  const result: string[] = [];
  for (const step of parseDockerfile(text)) {
    if (step.instruction === "WORKDIR") {
      if (/[\s$]/.test(step.argument))
        throw new CatalogueError(
          400,
          `Dockerfile line ${step.line}: WORKDIR must be a literal path`,
        );
      workdir = posix.resolve(workdir, step.argument);
    }
    if (step.instruction !== "COPY") {
      result.push(`${step.instruction} ${step.argument}`);
      continue;
    }
    const args = copyArguments(step);
    const destination = args.at(-1)!;
    if (destination.includes("$") || destination.includes("\0"))
      throw new CatalogueError(
        400,
        `Dockerfile line ${step.line}: COPY destination must be literal`,
      );
    const sources = args.slice(0, -1);
    if (sources.length > 1 && !destination.endsWith("/"))
      throw new CatalogueError(
        400,
        `Dockerfile line ${step.line}: multiple sources require a directory destination`,
      );
    for (const source of sources) {
      const file = files.get(source);
      if (!file)
        throw new CatalogueError(
          400,
          `Dockerfile line ${step.line}: COPY source ${source} is absent; v1 requires explicit regular-file paths`,
        );
      const target = posix.resolve(
        workdir,
        destination,
        ...(destination.endsWith("/") ? [posix.basename(source)] : []),
      );
      const encoded = file.data.toString("base64");
      result.push(
        `RUN mkdir -p ${quote(posix.dirname(target))} && : > ${quote(target)}`,
      );
      for (let offset = 0; offset < encoded.length; offset += 32768)
        result.push(
          `RUN printf '%s' ${quote(encoded.slice(offset, offset + 32768))} | base64 -d >> ${quote(target)}`,
        );
      result.push(
        `RUN chmod ${file.executable ? "755" : "644"} ${quote(target)}`,
      );
    }
  }
  return result;
}
