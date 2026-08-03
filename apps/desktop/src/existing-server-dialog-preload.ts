import { ipcRenderer } from "electron";
import {
  BB_DESKTOP_EXISTING_SERVER_DIALOG_CHOOSE_CHANNEL,
  EXISTING_SERVER_DIALOG_CHOICES,
  type ExistingServerDialogChooseRequest,
} from "./existing-server-dialog-ipc.js";

// The dialog page carries no scripts of its own (CSP default-src 'none');
// the preload wires the buttons from the isolated world instead.
window.addEventListener("DOMContentLoaded", () => {
  function choose(choice: ExistingServerDialogChooseRequest["choice"]): void {
    ipcRenderer.send(BB_DESKTOP_EXISTING_SERVER_DIALOG_CHOOSE_CHANNEL, {
      choice,
    });
  }

  for (const choice of EXISTING_SERVER_DIALOG_CHOICES) {
    const button = document.querySelector<HTMLButtonElement>(
      `button[data-choice="${choice}"]`,
    );
    button?.addEventListener("click", () => {
      choose(choice);
    });
  }

  document
    .querySelector<HTMLButtonElement>('button[data-choice="connect"]')
    ?.focus();

  window.addEventListener("keydown", (event) => {
    // Escape must not silently attach. Closing the question means "do not run".
    if (event.key === "Escape") {
      choose("quit");
    }
  });
});
