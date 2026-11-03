// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { forwardLateImeInput } from "./terminal-late-ime-input";

let terminal: Terminal;
let host: HTMLDivElement;
let sent: string[];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  host = document.createElement("div");
  document.body.append(host);
  terminal = new Terminal({ cols: 40, rows: 5 });
  terminal.open(host);
  sent = [];
  terminal.onData((data) => sent.push(data));
});

afterEach(() => {
  terminal.dispose();
  host.remove();
  vi.restoreAllMocks();
});

function textarea(): HTMLTextAreaElement {
  if (!terminal.textarea) {
    throw new Error("Expected terminal textarea");
  }
  return terminal.textarea;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function imeKeyDown(text: string) {
  fireEvent.keyDown(textarea(), { key: text, keyCode: 229 });
}

function imeKeyUp(text: string) {
  fireEvent.keyUp(textarea(), { key: text, keyCode: 0 });
}

function insertText(text: string) {
  const element = textarea();
  element.value += text;
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: text,
      inputType: "insertText",
    }),
  );
}

describe("forwardLateImeInput", () => {
  it("sends a candidate that iOS inserts after xterm's keydown check", async () => {
    const forwarding = forwardLateImeInput(terminal);
    try {
      imeKeyDown("你好");
      await nextTask();
      insertText("你好");
      imeKeyUp("你好");
      await nextTask();
      expect(sent).toEqual(["你好"]);
    } finally {
      forwarding.dispose();
    }
  });

  it("leaves text inserted before xterm's keydown check to xterm", async () => {
    const forwarding = forwardLateImeInput(terminal);
    try {
      imeKeyDown("你好");
      insertText("你好");
      imeKeyUp("你好");
      await nextTask();
      expect(sent).toEqual(["你好"]);
    } finally {
      forwarding.dispose();
    }
  });

  it("leaves late text to xterm once the key has been released", async () => {
    const forwarding = forwardLateImeInput(terminal);
    try {
      imeKeyDown("你好");
      await nextTask();
      imeKeyUp("你好");
      insertText("你好");
      await nextTask();
      expect(sent).toEqual(["你好"]);
    } finally {
      forwarding.dispose();
    }
  });

  it("sends consecutive iOS candidates once each", async () => {
    const forwarding = forwardLateImeInput(terminal);
    try {
      for (const text of ["你好", "世界"]) {
        imeKeyDown(text);
        await nextTask();
        insertText(text);
        imeKeyUp(text);
      }
      await nextTask();
      expect(sent).toEqual(["你好", "世界"]);
    } finally {
      forwarding.dispose();
    }
  });
});
