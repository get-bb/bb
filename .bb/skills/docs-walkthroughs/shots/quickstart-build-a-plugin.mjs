import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_SERVER_URL, bb, privacyReplacements, until } from "../dev-cli.mjs";

const CODE_DIR = process.env.WALKTHROUGH_CODE_DIR ?? "/var/tmp/code";
const PLUGIN_DIR = path.join(CODE_DIR, "bb-plugin-hello");
const TERMINAL = ".xterm";
const MONO_FONT =
  process.env.WALKTHROUGH_MONO_FONT ??
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";
const TERMINAL_FONT_CSS = existsSync(MONO_FONT)
  ? `@font-face { font-family: "Walkthrough Mono"; src: url(data:font/ttf;base64,${readFileSync(MONO_FONT).toString("base64")}); }
     :root { --font-terminal: "Walkthrough Mono", monospace !important; }`
  : "";
const RAIL_ITEM = (title) => `button[aria-label="${title}"]`;

const installed = () =>
  bb(["plugin", "list"]).plugins.some(
    (plugin) => plugin.id === "hello" && plugin.status === "running",
  );

async function command(page, line) {
  await page.click(TERMINAL);
  await page.type(line, 55);
  await page.wait(300);
  await page.press("Enter");
}

export default {
  title: "Quickstart: build your first plugin",
  baseUrl: DEV_SERVER_URL,
  scheme: "light",
  replacements: privacyReplacements([[CODE_DIR, "~/code"]]),
  chromeArgs: ["--disable-webgl", "--disable-3d-apis"],
  css: TERMINAL_FONT_CSS,
  poster: { step: 3 },
  async setup(page) {
    if (existsSync(PLUGIN_DIR))
      throw new Error(`${PLUGIN_DIR} exists; delete it first`);
    await page.goto("/", { text: "Build a plugin" });
    await page.click({ text: "Build a plugin" });
    await page.waitFor("#thread-detail-follow-up-composer");
    await page.wait(1000);
    if (!(await page.exists('button[aria-label^="Open new tab"]'))) {
      await page.click('button[aria-label^="Show right panel"]');
    }
    await page.click('button[aria-label^="Open new tab"]');
    await page.wait(800);
    await page.click({ text: "Start terminal" });
    await page.waitFor(TERMINAL);
    await page.click('button[aria-label="Maximize pane"]');
    await page.wait(800);
    await command(
      page,
      "export PS1='\\[\\e[1;34m\\]~/code\\[\\e[0m\\] $ '; clear",
    );
    await page.wait(800);
  },
  shots: [
    {
      caption:
        "In the folder where you keep your code, run bb plugin new hello.",
      anchor: TERMINAL,
      async run(page) {
        await command(page, "bb plugin new hello");
        await page.offCamera(() =>
          until(
            () =>
              existsSync(path.join(PLUGIN_DIR, "node_modules")) &&
              existsSync(path.join(PLUGIN_DIR, "package-lock.json")),
            {
              what: "the scaffold's npm install",
              every: 1000,
            },
          ).then(() => page.wait(2500)),
        );
      },
      hold: 2400,
    },
    {
      caption:
        "Install it from its folder, then confirm the full-trust prompt.",
      anchor: TERMINAL,
      async run(page) {
        await command(page, "cd bb-plugin-hello");
        await command(page, "bb plugin install .");
        await page.wait(1500);
        await page.type("y", 0);
        await page.press("Enter");
        await page.offCamera(async () => {
          await until(installed, {
            what: "the plugin to install",
            every: 1500,
          });
          for (const todo of bb(["hello", "list"]))
            bb(["hello", "remove", todo.id]);
          await page.waitFor(RAIL_ITEM("Example todos"), 60_000);
          await page.wait(1500);
        });
      },
      hold: 2400,
    },
    {
      caption:
        "Open Example todos. A todo added from the terminal appears without a reload.",
      anchor: RAIL_ITEM("Example todos"),
      async run(page) {
        await page.click(RAIL_ITEM("Example todos"));
        await page.wait(1500);
        bb(["plugin", "run", "hello", "add", "Ship it"], { json: false });
        await page.waitFor({ text: "Ship it" });
      },
      after: { text: "Ship it" },
      hold: 2600,
    },
    {
      caption:
        "Run bb plugin dev and change the title in app.tsx. The sidebar shows the new name.",
      anchor: TERMINAL,
      async before(page) {
        await page.click({ text: "Build a plugin" });
        await page.waitFor(TERMINAL);
        await page.wait(800);
      },
      async run(page) {
        await command(page, "bb plugin dev");
        await page.offCamera(async () => {
          await page.wait(5000);
          const app = path.join(PLUGIN_DIR, "app.tsx");
          writeFileSync(
            app,
            readFileSync(app, "utf8").replace(
              'title: "Example todos"',
              'title: "My todos"',
            ),
          );
          await page.waitFor(RAIL_ITEM("My todos"), 90_000);
          await page.wait(1000);
        });
        await page.click(RAIL_ITEM("My todos"));
        await page.wait(1200);
      },
      after: RAIL_ITEM("My todos"),
      hold: 2400,
    },
    {
      caption: "Find every place a plugin can add to bb in the Plugin Guide.",
      before: (page) => page.goto("https://getbb.app/plugin-guide"),
      hold: 3200,
    },
  ],
};
