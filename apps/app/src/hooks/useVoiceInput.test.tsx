// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: vi.fn(),
  },
}));

type FakeTrack = {
  stop: () => void;
};

type FakeStream = {
  getTracks: () => FakeTrack[];
};

class FakeWakeLockSentinel
  extends EventTarget
  implements WakeLockSentinel
{
  onrelease: WakeLockSentinel["onrelease"] = null;
  released = false;
  readonly type: WakeLockType = "screen";

  async release(): Promise<void> {
    if (this.released) {
      return;
    }

    this.released = true;
    const event = new Event("release");
    this.dispatchEvent(event);
    if (this.onrelease) {
      this.onrelease.call(this, event);
    }
  }
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(_candidate: string): boolean {
    return true;
  }

  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void | Promise<void>) | null = null;
  state: RecordingState = "inactive";

  constructor(_stream: FakeStream, options?: MediaRecorderOptions) {
    super();
    fakeMediaRecorders.push(this);
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start(_timeslice?: number): void {
    this.state = "recording";
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.state = "inactive";
    void this.onstop?.(new Event("stop"));
  }
}

type VoiceInputHookOptions = Parameters<typeof useVoiceInput>[0];

const fakeMediaRecorders: FakeMediaRecorder[] = [];

function setDocumentVisibility(visibilityState: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

function installVoiceRecordingBrowserMocks(): void {
  fakeMediaRecorders.length = 0;

  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  setDocumentVisibility("visible");

  const fakeTrack: FakeTrack = {
    stop: vi.fn(),
  };
  const fakeStream: FakeStream = {
    getTracks: () => [fakeTrack],
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => fakeStream),
    },
  });

  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
}

function installWakeLock(request: WakeLock["request"]): void {
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request,
    } satisfies WakeLock,
  });
}

function createVoiceInputOptions(): VoiceInputHookOptions {
  return {
    onTranscript: vi.fn(),
    onTranscribe: vi.fn(async () => "transcript"),
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(window, "MediaRecorder");
  Reflect.deleteProperty(globalThis, "MediaRecorder");
  Reflect.deleteProperty(window, "isSecureContext");
  setDocumentVisibility("visible");
});

describe("useVoiceInput wake lock", () => {
  it("requests a screen wake lock while recording and releases it when canceled", async () => {
    installVoiceRecordingBrowserMocks();
    const requestedTypes: WakeLockType[] = [];
    const sentinel = new FakeWakeLockSentinel();
    installWakeLock(async (type = "screen") => {
      requestedTypes.push(type);
      return sentinel;
    });

    const { result } = renderHook(() =>
      useVoiceInput(createVoiceInputOptions()),
    );
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(requestedTypes).toEqual(["screen"]));
    expect(sentinel.released).toBe(false);

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => expect(sentinel.released).toBe(true));
  });

  it("keeps recording when wake lock is unsupported", async () => {
    installVoiceRecordingBrowserMocks();

    const { result } = renderHook(() =>
      useVoiceInput(createVoiceInputOptions()),
    );
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isRecording).toBe(true);
    expect(fakeMediaRecorders).toHaveLength(1);
  });

  it("keeps recording when wake lock is denied", async () => {
    installVoiceRecordingBrowserMocks();
    installWakeLock(async () => {
      throw new DOMException("Wake lock denied", "NotAllowedError");
    });

    const { result } = renderHook(() =>
      useVoiceInput(createVoiceInputOptions()),
    );
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isRecording).toBe(true);
    expect(fakeMediaRecorders).toHaveLength(1);
  });

  it("reacquires the wake lock after returning to a visible document", async () => {
    installVoiceRecordingBrowserMocks();
    const availableSentinels = [
      new FakeWakeLockSentinel(),
      new FakeWakeLockSentinel(),
    ];
    const grantedSentinels: FakeWakeLockSentinel[] = [];
    const requestedTypes: WakeLockType[] = [];
    installWakeLock(async (type = "screen") => {
      requestedTypes.push(type);
      const sentinel = availableSentinels.shift();
      if (!sentinel) {
        throw new DOMException("Wake lock unavailable", "NotAllowedError");
      }
      grantedSentinels.push(sentinel);
      return sentinel;
    });

    const { result } = renderHook(() =>
      useVoiceInput(createVoiceInputOptions()),
    );
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(requestedTypes).toEqual(["screen"]));

    await act(async () => {
      await grantedSentinels[0]?.release();
    });
    setDocumentVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(requestedTypes).toEqual(["screen"]);

    setDocumentVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(requestedTypes).toEqual(["screen", "screen"]));
  });
});
