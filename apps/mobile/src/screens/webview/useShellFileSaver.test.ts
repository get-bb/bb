import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDownload } from "react-native-webview";
import { useShellFileSaver } from "./useShellFileSaver";

const mocks = vi.hoisted(() => ({
  share: vi.fn(),
  remove: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useCallback: <T>(callback: T) => callback,
    useRef: <T>(current: T) => ({ current }),
  };
});
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Share: { share: mocks.share },
}));
vi.mock("react-native-webview/lib/NativeRNCWebViewModule", () => ({
  default: { nativeDownloadsSupported: () => true },
}));
vi.mock("@/ui", () => ({ toast: { error: mocks.error } }));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get parentDirectory() {
      return { exists: true, delete: () => mocks.remove(this.uri) };
    }
  },
}));

function event(nativeEvent: FileDownload) {
  return { nativeEvent };
}

const first = "file:///cache/bb-webkit-downloads/first/notes.zip";
const second = "file:///cache/bb-webkit-downloads/second/notes.zip";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.share.mockResolvedValue({ action: "sharedAction" });
});

describe("native download presentation", () => {
  it.each(["sharedAction", "dismissedAction"])(
    "deletes the temporary file after %s",
    async (action) => {
      let finish: (value: { action: string }) => void = () => undefined;
      mocks.share.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const receive = useShellFileSaver();
      receive(
        event({ downloadUrl: "https://server.example/file", filePath: first }),
      );
      expect(mocks.share).toHaveBeenCalledWith({ url: first });
      expect(mocks.remove).not.toHaveBeenCalled();
      finish({ action });
      await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(first));
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );

  it("cleans up after a share failure and allows a later download", async () => {
    mocks.share.mockRejectedValueOnce(new Error("Share failed"));
    const receive = useShellFileSaver();
    receive(
      event({ downloadUrl: "blob:https://server.example/1", filePath: first }),
    );
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Couldn't save the file", {
        description: "Share failed",
      }),
    );
    expect(mocks.remove).toHaveBeenCalledWith(first);
    receive(
      event({ downloadUrl: "https://server.example/file", filePath: second }),
    );
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(second));
    expect(mocks.share).toHaveBeenCalledTimes(2);
  });

  it("discards a second completed file without closing the first share sheet", async () => {
    let finish: () => void = () => undefined;
    mocks.share.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const receive = useShellFileSaver();
    receive(
      event({ downloadUrl: "https://server.example/file", filePath: first }),
    );
    receive(
      event({ downloadUrl: "https://server.example/file", filePath: second }),
    );
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(second));
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalledWith(first);
    finish();
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(first));
    receive(
      event({ downloadUrl: "https://server.example/file", filePath: second }),
    );
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(2));
  });

  it("reports WebKit failures without downloading the URL again", () => {
    useShellFileSaver()(
      event({
        downloadUrl: "https://server.example/file",
        error: "The server answered 401.",
      }),
    );
    expect(mocks.error).toHaveBeenCalledWith("Couldn't save the file", {
      description: "The server answered 401.",
    });
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
