import assert from "node:assert/strict";
import { join } from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";

const directory = process.argv.at(-1);
app.setPath("userData", join(directory, "profile"));
async function main() {
  await app.whenReady();
  let window;
  let page;
  try {
    window = new BrowserWindow({
      width: 800,
      height: 500,
      webPreferences: { backgroundThrottling: false },
    });
    await window.loadFile(join(directory, "index.html"));
    page = new WebContentsView();
    window.contentView.addChildView(page);
    page.setBounds({ x: 0, y: 100, width: 800, height: 400 });
    await page.webContents.loadURL(
      "data:text/html,<button>Embedded page</button>",
    );
    const host = window.webContents;
    const settled = () =>
      host.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    await settled();
    const bounds = await host.executeJavaScript(
      "JSON.stringify(document.querySelector('input').getBoundingClientRect())",
    );
    const { x, y, height } = JSON.parse(bounds);
    const point = { x: Math.round(x + 60), y: Math.round(y + height / 2) };
    const selection = () =>
      host.executeJavaScript(
        "(() => { const i=document.querySelector('input'); return {start:i.selectionStart,end:i.selectionEnd,length:i.value.length}; })()",
      );
    const mouse = (type, x = point.x) =>
      host.sendInputEvent({
        type,
        x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
    const click = async () => {
      host.focus();
      for (const type of ["mouseMove", "mouseDown", "mouseUp"]) mouse(type);
      await settled();
    };
    const selectAll = async (label) => {
      const value = await selection();
      assert.equal(value.start, 0, label);
      assert.equal(value.end, value.length, label);
    };
    for (let cycle = 0; cycle < 12; cycle++) {
      page.webContents.focus();
      await settled();
      await click();
      await selectAll(`page to address cycle ${cycle + 1}`);
      await click();
      const caret = await selection();
      assert.equal(caret.start, caret.end, "second click places caret");
    }
    console.log("PASS: 12 native page/address focus cycles and second clicks");
    page.webContents.focus();
    await settled();
    host.focus();
    mouse("mouseDown");
    mouse("mouseMove", point.x + 60);
    mouse("mouseUp", point.x + 60);
    await settled();
    const drag = await selection();
    assert.ok(
      drag.end > drag.start && drag.end - drag.start < drag.length,
      "drag preserves partial selection",
    );
    console.log("PASS: native drag selection after page focus");
    page.webContents.focus();
    await settled();
    host.focus();
    await host.executeJavaScript("document.querySelector('button').focus()");
    host.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    host.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await settled();
    await selectAll("keyboard focus selects whole URL");
    host.sendInputEvent({ type: "char", keyCode: "x" });
    await settled();
    assert.equal(
      await host.executeJavaScript("document.querySelector('input').value"),
      "x",
      "typing replaces selected URL",
    );
    console.log("PASS: Tab selects URL and typing replaces it");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    page?.webContents.close();
    window?.destroy();
    app.exit(process.exitCode ?? 0);
  }
}
void main();
