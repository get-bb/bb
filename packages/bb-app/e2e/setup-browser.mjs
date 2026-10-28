import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function setupBrowser({ executable, profile, url }) {
  const browser = spawn(
    executable,
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let failure;
  browser.on("error", (error) => {
    failure = error;
  });
  const wait = async (check, message, timeout = 60_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const result = await check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(message);
  };
  try {
    const port = await wait(async () => {
      try {
        return (
          await readFile(join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
      } catch {
        return null;
      }
    }, "Browser must start");
    const pages = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const socket = new WebSocket(
      pages.find((page) => page.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      clearTimeout(callback.timer);
      message.error
        ? callback.reject(new Error(message.error.message))
        : callback.resolve(message.result);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser timed out: ${method}`));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert(!result.exceptionDetails, "Browser evaluation must succeed");
      return result.result.value;
    };
    await send("Page.navigate", { url });
    const clickInstall = async (provider) => {
      const point = await wait(
        () =>
          evaluate(`(() => {
        const row = document.querySelector('[data-agent-id="' + ${JSON.stringify(provider)} + '"]');
        const button = row && [...row.querySelectorAll('button')].find(button => button.textContent.trim() === 'Install' && !button.disabled);
        if (!button) return null;
        const box = button.getBoundingClientRect();
        return box.width && box.height ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
      })()`),
        `Setup must offer ${provider} Install`,
      );
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      });
    };
    return {
      browser,
      evaluate,
      send,
      wait,
      clickInstall,
      close() {
        socket.close();
        browser.kill();
      },
    };
  } catch (error) {
    browser.kill();
    throw error;
  }
}
