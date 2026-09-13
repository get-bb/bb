import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

function detectPackageJsonIndent(content) {
  const match = /\n([ \t]+)"/u.exec(content);

  return match === null ? 2 : match[1];
}

export function createUpdatedPackageContent({
  content,
  packageJson,
  newVersion,
}) {
  const trailingNewline = content.endsWith("\n") ? "\n" : "";

  return `${JSON.stringify(
    { ...packageJson, version: newVersion },
    null,
    detectPackageJsonIndent(content),
  )}${trailingNewline}`;
}

export function parsePackageJsonWithVersion({ content, path }) {
  const packageJson = JSON.parse(content);

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    Array.isArray(packageJson)
  ) {
    throw new Error(`Invalid package JSON object in ${path}`);
  }

  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing string version field in ${path}`);
  }

  return packageJson;
}

export async function writeFilesAtomically({
  fileSystem,
  updates,
  temporarySuffix,
}) {
  const preparedUpdates = [];
  const renamedUpdates = [];

  try {
    for (const update of updates) {
      const temporaryPath = resolve(
        dirname(update.absolutePath),
        `.tmp-${process.pid}-${randomUUID()}-${temporarySuffix(update)}`,
      );

      await fileSystem.writeFile(temporaryPath, update.nextContent);
      preparedUpdates.push({ ...update, temporaryPath });
    }

    for (const update of preparedUpdates) {
      await fileSystem.rename(update.temporaryPath, update.absolutePath);
      renamedUpdates.push(update);
    }
  } catch (error) {
    for (const update of [...renamedUpdates].reverse()) {
      await fileSystem.writeFile(update.absolutePath, update.content);
    }

    for (const update of preparedUpdates) {
      await fileSystem.unlink(update.temporaryPath).catch(() => {});
    }

    throw error;
  }
}
