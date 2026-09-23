import { ipcRenderer } from "electron";
import {
  BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL,
  BB_DESKTOP_FIND_BAR_CLOSE_CHANNEL,
  BB_DESKTOP_FIND_BAR_QUERY_CHANNEL,
  BB_DESKTOP_FIND_BAR_RESULT_CHANNEL,
  BB_DESKTOP_FIND_BAR_STEP_CHANNEL,
  findBarResultSchema,
  type FindBarQueryRequest,
  type FindBarStepRequest,
} from "./find-bar-ipc.js";

window.addEventListener("DOMContentLoaded", () => {
  const input = document.querySelector<HTMLInputElement>("#bb-find-input");
  const count = document.querySelector<HTMLElement>("#bb-find-count");
  const previousButton = document.querySelector<HTMLButtonElement>(
    'button[data-step="previous"]',
  );
  const nextButton = document.querySelector<HTMLButtonElement>(
    'button[data-step="next"]',
  );
  const closeButton = document.querySelector<HTMLButtonElement>(
    'button[data-action="close"]',
  );
  if (
    input === null ||
    count === null ||
    previousButton === null ||
    nextButton === null ||
    closeButton === null
  ) {
    return;
  }

  function sendQuery(text: string): void {
    ipcRenderer.send(BB_DESKTOP_FIND_BAR_QUERY_CHANNEL, {
      text,
    } satisfies FindBarQueryRequest);
  }

  function sendStep(forward: boolean): void {
    ipcRenderer.send(BB_DESKTOP_FIND_BAR_STEP_CHANNEL, {
      forward,
    } satisfies FindBarStepRequest);
  }

  function close(): void {
    ipcRenderer.send(BB_DESKTOP_FIND_BAR_CLOSE_CHANNEL);
  }

  function setMatches(
    matches: { activeMatchOrdinal: number; matches: number } | null,
  ): void {
    if (count === null || previousButton === null || nextButton === null) {
      return;
    }
    if (matches === null) {
      count.textContent = "";
      delete count.dataset.empty;
      previousButton.disabled = true;
      nextButton.disabled = true;
      return;
    }
    count.textContent = `${matches.activeMatchOrdinal}/${matches.matches}`;
    count.dataset.empty = String(matches.matches === 0);
    previousButton.disabled = matches.matches === 0;
    nextButton.disabled = matches.matches === 0;
  }

  input.addEventListener("input", () => {
    const text = input.value;
    if (text.length === 0) {
      setMatches(null);
    }
    sendQuery(text);
  });

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (input.value.length > 0) {
        sendStep(!event.shiftKey);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  previousButton.addEventListener("click", () => {
    sendStep(false);
  });
  nextButton.addEventListener("click", () => {
    sendStep(true);
  });
  closeButton.addEventListener("click", () => {
    close();
  });

  ipcRenderer.on(BB_DESKTOP_FIND_BAR_RESULT_CHANNEL, (_event, payload) => {
    const parsed = findBarResultSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    setMatches(parsed.data);
  });

  ipcRenderer.on(BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL, () => {
    input.focus();
    input.select();
    if (input.value.length > 0) {
      sendQuery(input.value);
    }
  });

  input.focus();
});
