---
name: docs-images
description: "Capture the screenshots a bb docs page needs and replace its <Shot todo> placeholders: isolated dev bb, browser automation, privacy scrub, light and dark at 2×, annotations, alt text. Use when a page under apps/web/content/docs has a <Shot> placeholder or needs a new or updated image."
---

# Capture images for bb docs

A docs page marks each image it needs with a placeholder while it is drafted:

```mdx
<Shot todo="Settings → Plugins, enable switches outlined" />
```

CI fails while any `<Shot` remains in `apps/web/content/docs/`. This skill
turns each placeholder into a real capture and replaces it with:

```mdx
<Screenshot
  src="/docs-images/<page-slug>/<name>"
  alt="Settings → Plugins lists each plugin with an enable switch on the right."
  width={720}
  height={420}
/>
```

## Rules

- **Text first.** A screenshot goes where a reader has to find a control. A
  diagram goes on a concept page. Reference pages have no images.
  Troubleshooting pages show an image only to point at where an error appears.
  If the text already makes the control easy to find, delete the placeholder
  instead of capturing it.
- **Real bb UI only,** captured from an isolated dev bb at current `main`.
  Never use a real user's bb or data.
- **Private details replaced before capture:** paths, machine names, emails
  and thread IDs.
- **Light and dark versions** of each image, at 2×.
- **Subtle annotations** in bb's file-link blue: 1 px outlines and small pill
  labels, only on what the text talks about.
- **Short crops:** nothing cut off, no title cards, and no illustrations of
  things that weren't measured.
- **A full-sentence alt text** that names the control.

## 1. Start an isolated dev bb at current main

Work in a checkout of this repo that is not the one you run your own bb from.

```sh
git fetch origin
git switch --detach origin/main
pnpm install
pnpm start:worktree
```

If the page documents a change made in the same PR, capture from that branch
rebased on current `origin/main` instead.

`pnpm start:worktree` builds the app and serves it with this checkout's own data
directory and ports, skipping first-run setup. Keep it running in a terminal
and note the `[start:worktree] App` URL it prints. It never touches the data of
the bb you use day to day.

Drive the dev bb's CLI from a second shell, after clearing the variables that
point at your own bb:

```sh
unset BB_SERVER_URL BB_HOST_DAEMON_PORT BB_THREAD_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE BB_PROJECT_ID BB_CLI BB_CLI_REEXEC
pnpm bb:dev status
```

## 2. Stage the state the page describes, with nothing private in it

- Projects: create them from a throwaway folder with a neutral name, such as
  `/tmp/acme/web`, never a real checkout:
  `pnpm bb:dev project create --name "acme-web" --root /tmp/acme/web --json`.
- Machine name: rename the dev machine to a neutral name, such as
  `pnpm bb:dev machine rename <machine-id> "Studio Mac"`. Find the ID with
  `pnpm bb:dev machine list --json`.
- Threads: give them realistic titles that say what the page is about. If a
  thread needs agent output, use a short prompt that touches only the demo
  project.
- Stay signed out of bb account, so no email appears.

Anything private that is still on screen (your home path, user name, host
name, a thread ID in a URL or label) is replaced in the page before capture;
see step 4.

## 3. Open a headless browser on the same machine

Use your own bb's Browser Automation plugin, on the machine that runs the dev
bb, so `localhost` reaches it. Enable the plugin first if needed with
`bb plugin enable browser-automation`.

```sh
bb browser-automation open --backend local --headless --machine <host-id> --json
```

Keep the session ID. Scripts run in that browser; its pages are Playwright
pages.

## 4. Capture light and dark at 2×

Write one script per image and run it twice, once with `scheme = "light"` and
once with `scheme = "dark"`, without changing anything else:

```js
const scheme = "light";
const out = `/tmp/docs-images/${scheme}.png`;
const p = await browser.getPage("main");
const cdp = await p.context().newCDPSession(p);
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  mobile: false,
});
await p.emulateMedia({ colorScheme: scheme });
await p.goto("<App URL><path of the screen>");
await p.evaluate(() => localStorage.setItem("bb.theme", "system"));
await p.reload();
await p.waitForLoadState("networkidle");

await p.evaluate((replacements) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const [from, to] of replacements) {
      node.nodeValue = node.nodeValue.replaceAll(from, to);
    }
  }
}, [
  ["/home/<you>", "/Users/alex"],
  ["<your-host-name>", "Studio Mac"],
]);

const target = await p.locator("<selector of the control>").boundingBox();
await p.evaluate(({ box, label }) => {
  const outline = document.createElement("div");
  Object.assign(outline.style, {
    position: "fixed",
    left: `${box.x - 4}px`,
    top: `${box.y - 4}px`,
    width: `${box.width + 8}px`,
    height: `${box.height + 8}px`,
    border: "1px solid var(--file-accent)",
    borderRadius: "6px",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  const pill = document.createElement("div");
  pill.textContent = label;
  Object.assign(pill.style, {
    position: "fixed",
    left: `${box.x - 4}px`,
    top: `${box.y + box.height + 8}px`,
    padding: "1px 8px",
    borderRadius: "999px",
    background: "var(--file-accent)",
    color: "var(--canvas)",
    font: "500 11px/18px var(--font-sans)",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.body.append(outline, pill);
}, { box: target, label: "Enable switch" });

await p.screenshot({
  path: out,
  type: "png",
  clip: { x: 240, y: 60, width: 720, height: 420 },
});
undefined;
```

```sh
bb browser-automation run <session-id> --script-file capture.js --script-host <host-id> --timeout 2m --json
```

- `deviceScaleFactor: 2` makes the PNG twice the `clip` size. The `clip`
  width and height become the `<Screenshot>` `width` and `height`.
- `--file-accent` is bb's file-link blue in both themes, so the same script
  annotates light and dark correctly. Outline only what the text names, and
  skip the pill when the outline is self-explanatory.
- The text replacements run after the page loads and before the capture. Add
  every private string you saw while staging.
- Choose the `clip` so the control and enough context to find it are in frame,
  with nothing cut off at the edges.
- Check each capture before you keep it: run
  `bb browser-automation screenshot <session-id> --page main --json` and read
  the returned image, or read the PNG itself if you are on the browser host.
  Look for leftover private details, a wrong theme, and cut-off controls.

## 5. Put the files in the repo and replace the placeholder

Save the pair as:

```text
apps/web/public/docs-images/<page-slug>/<name>-light.png
apps/web/public/docs-images/<page-slug>/<name>-dark.png
```

If the browser host is another machine, copy each file with
`bb file read <path> --host <host-id> --json`; the content is base64.

Replace the `<Shot>` with a `<Screenshot>` whose `src` is
`/docs-images/<page-slug>/<name>` (no suffix or extension), whose `width` and
`height` are the clip size, and whose `alt` is a full sentence naming the
control. The page shows the dark file when the reader's system is dark.

## 6. Check and clean up

```sh
pnpm exec turbo run test --filter=@bb/web
```

The docs tests fail while any `<Shot` remains, when a `<Screenshot>` has no
light or dark file, when a file isn't exactly twice its `width` and `height`,
or when the alt text isn't a sentence. Open the page on the dev server in light
and dark to check the result.

Then close the browser session with `bb browser-automation close <session-id>`,
stop `pnpm start:worktree` with Ctrl-C, and delete the throwaway folders and
temporary captures.
