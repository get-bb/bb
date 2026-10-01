import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";

export async function stopWindowsProcessTree(
  child: ChildProcess,
): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    execFile(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 5_000 },
      () => {
        try {
          child.kill("SIGKILL");
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
  await exited;
}
