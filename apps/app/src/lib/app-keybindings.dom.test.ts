// @vitest-environment jsdom

import { expect, it } from "vitest";
import { isEditableKeyboardTarget } from "./app-keybindings";

it("recognizes form controls and contenteditable descendants", () => {
  const input = document.createElement("input");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  const child = document.createElement("span");
  editor.append(child);
  expect(isEditableKeyboardTarget(input)).toBe(true);
  expect(isEditableKeyboardTarget(child)).toBe(true);
  expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(
    false,
  );
});
