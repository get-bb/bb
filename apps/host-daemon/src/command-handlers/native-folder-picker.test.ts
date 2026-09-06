import { describe, expect, it } from "vitest";
import {
  pickHostFolderWithDeps,
  setNativeFolderPickerDialogProvider,
  type NativeFolderPickerExecFile,
} from "./native-folder-picker.js";

interface RecordedCall {
  args: string[];
  file: string;
}

function createRecordingExecFile(stdout: string, calls: RecordedCall[]) {
  const execFile: NativeFolderPickerExecFile = async (file, args) => {
    calls.push({ args, file });
    return { stdout };
  };
  return execFile;
}

describe("windows powershell folder picker fallback", () => {
  it("requests STA and returns the selected path", async () => {
    const calls: RecordedCall[] = [];
    const result = await pickHostFolderWithDeps({
      execFile: createRecordingExecFile("C:\\Temp\\bb picker space\r\n", calls),
      platform: "win32",
    });

    expect(result).toEqual({ path: "C:\\Temp\\bb picker space" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("powershell.exe");
    expect(calls[0]?.args).toContain("-STA");
    expect(calls[0]?.args.some((arg) => arg.includes("FolderBrowserDialog"))).toBe(true);
  });

  it("strips a trailing separator and maps empty output to null", async () => {
    const trailingCalls: RecordedCall[] = [];
    await expect(
      pickHostFolderWithDeps({
        execFile: createRecordingExecFile("C:\\Temp\\proj\\\r\n", trailingCalls),
        platform: "win32",
      }),
    ).resolves.toEqual({ path: "C:\\Temp\\proj" });

    await expect(
      pickHostFolderWithDeps({
        execFile: createRecordingExecFile("", []),
        platform: "win32",
      }),
    ).resolves.toEqual({ path: null });
  });

  it("prefers the native dialog when a provider is registered", async () => {
    setNativeFolderPickerDialogProvider({
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ["C:\\Temp\\proj"],
      }),
    });
    try {
      const calls: RecordedCall[] = [];
      const result = await pickHostFolderWithDeps({
        execFile: createRecordingExecFile("unused", calls),
        platform: "win32",
      });

      expect(result).toEqual({ path: "C:\\Temp\\proj" });
      expect(calls).toHaveLength(0);
    } finally {
      setNativeFolderPickerDialogProvider(undefined);
    }
  });

  it("reports cancellation from the native dialog as null", async () => {
    setNativeFolderPickerDialogProvider({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    try {
      await expect(
        pickHostFolderWithDeps({
          execFile: createRecordingExecFile("unused", []),
          platform: "win32",
        }),
      ).resolves.toEqual({ path: null });
    } finally {
      setNativeFolderPickerDialogProvider(undefined);
    }
  });
});
