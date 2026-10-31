import {
  pickHostFolder,
  resolveFolderPickerCommand,
} from "../../apps/host-daemon/src/command-handlers/native-folder-picker.ts";

const [scenario, expected] = process.argv.slice(2);

function sameFolder(left: string, right: string): boolean {
  const normalize = (path: string) =>
    process.platform === "win32" ? path.toLowerCase() : path;
  return normalize(left) === normalize(right);
}

async function outcome(): Promise<
  { kind: "picked"; path: string | null } | { kind: "failed"; code: string }
> {
  try {
    return { kind: "picked", path: (await pickHostFolder()).path };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : String(error);
    return { kind: "failed", code };
  }
}

const picker = resolveFolderPickerCommand();
const result = await outcome();
console.log(JSON.stringify({ scenario, picker: picker?.command ?? null, result }));

const ok =
  scenario === "pick"
    ? result.kind === "picked" &&
      result.path !== null &&
      expected !== undefined &&
      sameFolder(result.path, expected)
    : scenario === "cancel"
      ? result.kind === "picked" && result.path === null
      : scenario === "failure"
        ? picker !== null &&
          result.kind === "failed" &&
          result.code === "folder_picker_failed"
        : scenario === "missing"
          ? picker === null &&
            result.kind === "failed" &&
            result.code === "unsupported_platform"
          : false;

if (!ok) {
  console.error(`FAIL ${scenario}`);
  process.exit(1);
}
console.log(`PASS ${scenario}`);
