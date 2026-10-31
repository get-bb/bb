import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [appUrl, shots, label] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  throw new Error("Chrome debugging endpoint never came up");
}

const socket = new WebSocket(await pageSocket());
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickButton = (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((e) => e.innerText.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
const waitForText = async (text, timeoutMs = 60000) => {
  for (let waited = 0; waited < timeoutMs; waited += 1000) {
    if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for "${text}"`);
};
const shot = (name) =>
  execFileSync("import", ["-window", "root", join(shots, `${label}-${name}.png`)]);
const zenityOpen = () => {
  try {
    execFileSync("xdotool", ["search", "--name", "Choose a project folder"]);
    return true;
  } catch {
    return false;
  }
};
const closeDialogs = async () => {
  if (zenityOpen()) {
    execFileSync("bash", ["-c", 'xdotool key --window "$(xdotool search --name "Choose a project folder" | head -1)" Escape']);
  } else {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  await sleep(2000);
};

const results = {};
await send("Page.navigate", { url: appUrl });
await waitForText("Connect a coding agent");
await clickButton("Skip for now");
await waitForText("Add your projects");
await waitForText("Choose a folder");
await sleep(1500);
results.guideClicked = await clickButton("Choose a folder");
await sleep(4000);
results.guideNativeDialog = zenityOpen();
results.guideBbDialog = await evaluate(`!!document.querySelector("[role=dialog]")`);
shot("guide-choose-a-folder");
await closeDialogs();

await clickButton("Skip setup");
await sleep(2000);
await send("Page.navigate", { url: new URL("/settings/projects", appUrl).toString() });
await waitForText("Add a project");
await sleep(1500);
results.settingsClicked = await clickButton("Add a project");
await sleep(4000);
results.settingsNativeDialog = zenityOpen();
results.settingsBbDialog = await evaluate(`!!document.querySelector("[role=dialog]")`);
shot("settings-add-a-project");
await closeDialogs();

console.log(JSON.stringify({ label, ...results }));
socket.close();
