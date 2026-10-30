---
name: docs-walkthroughs
description: "Record a short walkthrough video for a bb docs tutorial or how-to page: a shot list from the page's numbered steps, an isolated dev bb driven by browser automation, text captions placed next to the UI, privacy scrub, mp4 plus poster plus text version, user QA, and re-recording only the steps whose UI changed. Use when a page under apps/web/content/docs needs a walkthrough video or its video is out of date."
---

# Record walkthrough videos for bb docs

A walkthrough is a 30–60 second silent screen recording of one tutorial or
how-to page. Each numbered step on the page is one shot, and each shot shows a
short text caption next to the part of the app it describes. There is no voice.

Everything here runs from this repo:

| File                    | What it does                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `start-dev-bb.sh`       | Starts an isolated dev bb with an empty data dir in `.tmp/docs-walkthrough/bb-data` and its own ports (server 47186, host daemon 47187) |
| `dev-cli.mjs`           | Runs the repo's `bb` CLI against that dev server only, and lists the private strings to replace                                         |
| `record.mjs`            | Drives headless Chrome over the DevTools protocol, draws captions and a pointer, records, and encodes the files                         |
| `shots/<page-slug>.mjs` | The shot list for one page's video                                                                                                      |

It needs Chrome or Chromium and `ffmpeg` with libx264 on the recording machine.
If they are missing, `npx @puppeteer/browsers install chrome-headless-shell@stable`
installs Chrome, and `npx ffmpeg-static` prints the path of a static ffmpeg.

## Rules

- **One page, one video.** Start from a `tutorial` or `how-to` page. Concept
  pages may have a tour video whose shots follow the page's table rows.
- **One shot per numbered step,** in the page's order, so step 3 of the video
  is step 3 of the page.
- **Captions are the step's own words,** cut to one short docs-style sentence
  (about 12 words). No marketing, no new facts, no keys or names the page
  doesn't use.
- **Captions sit next to what they describe:** give each shot an `anchor`, the
  control or area it talks about. The caption card is placed beside it and the
  anchor gets a 1 px outline in bb's file-link blue. Type and colors are
  getbb.app's: Inter, `--ink` text on `--bg`, the step number in `--accent`.
- **Real bb UI only,** from an isolated dev bb at current `main` or the PR
  branch, never a real user's bb or data. No title cards, no music, no voice.
- **Short and small:** 30–60 seconds and under 3 MB. CI fails over 3 MB.
- **The user reviews every video before it ships.** Send the mp4 and poster
  for QA and wait for an explicit yes before merging.

## 1. Start an isolated dev bb

From a checkout of this repo that isn't the one your own bb runs from:

```sh
git fetch origin
git switch --detach origin/main
pnpm install
pnpm exec turbo run build --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/app --filter=@bb/cli
.bb/skills/docs-walkthroughs/start-dev-bb.sh
```

Keep it running. It refuses to start when `.tmp/docs-walkthrough/bb-data`
already exists, so every recording starts from an empty bb; set
`WALKTHROUGH_REUSE=1` only to re-record against the same staged state. Set
`WALKTHROUGH_PORT` (server port; the host daemon uses the next one) when 47186
is taken, and export the same value for the recorder.

Every `bb` command you run for the walkthrough targets the dev server. Use
`bb()` from `dev-cli.mjs` in shot lists, and in a shell clear the variables
that point at your own bb first:

```sh
unset BB_THREAD_ID BB_ENVIRONMENT_ID BB_THREAD_STORAGE BB_PROJECT_ID BB_CLI BB_CLI_REEXEC
export BB_SERVER_URL=http://127.0.0.1:47186 BB_HOST_DAEMON_PORT=47187
pnpm bb:dev status
```

`bb status` must print the `.tmp/docs-walkthrough/bb-data` data dir. If it
prints anything else, stop: the command would change a real bb.

## 2. Stage the state, with nothing private in it

- Make a throwaway Git repository under `.tmp/docs-walkthrough/`, such as
  `acme-web`, and add it: `pnpm bb:dev project create --name acme-web --root "$PWD/.tmp/docs-walkthrough/acme-web"`.
- Rename the machine: `pnpm bb:dev machine rename <machine-id> Studio`
  (`pnpm bb:dev machine list --json` shows the ID).
- Stay signed out of bb account, so no email appears.
- When a step needs agent output, send a short prompt that touches only the
  demo project, and wait for it off camera (`before`, below).

`privacyReplacements()` in `dev-cli.mjs` replaces your home path, the
checkout path, the host name, the user name, thread, environment, project and
host IDs, and emails on screen before any frame is captured. It keeps
replacing as the page changes. Add any other private string you see while
staging as an extra pair.

## 3. Write the shot list

Copy the page's numbered steps into `shots/<page-slug>.mjs`:

```js
import { DEV_SERVER_URL, menuItem, privacyReplacements } from "../dev-cli.mjs";

export default {
  title: "Quickstart: delegate work to child threads",
  baseUrl: DEV_SERVER_URL,
  replacements: privacyReplacements(),
  poster: { step: 3 },
  async setup(page) {},
  shots: [
    {
      caption: "Open Settings → Projects and choose Add a project.",
      anchor: { text: "Add a project", closest: "button" },
      before: (page) => page.goto("/settings/projects", { text: "acme-web" }),
      run: (page) => page.hover({ text: "Add a project", closest: "button" }),
      hold: 1600,
    },
  ],
};
```

| Field               | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `title`             | The page title; the first line of the text version                |
| `setup(page)`       | Runs once, off camera                                             |
| `poster.step`       | The step whose last frame becomes the poster                      |
| `before(page)`      | Runs off camera before the step: navigation, waiting for an agent |
| `anchor`            | Where the caption goes; a function is called when the step starts |
| `run(page)`         | The on-camera actions                                             |
| `after`             | A new anchor for the caption once `run` finishes                  |
| `lead`, `hold`      | Milliseconds on screen before and after `run` (900 and 2200)      |
| `css`, `chromeArgs` | Extra CSS for every page, and extra Chrome flags                  |

Targets are a CSS selector, or `{ text, within, closest, nth, contains }`,
which finds the deepest visible element whose text or `aria-label` is `text`.
`page` has `goto`, `click`, `contextClick`, `hover`, `type`, `paste`, `press`,
`waitFor`, `exists`, `wait`, `path`, `evaluate` and `offCamera(fn)`, which
pauses the recording while `fn` runs (an npm install, an agent's turn). Clicks
move a visible pointer first.

The terminal draws text on a canvas, where nothing can be replaced. Shot lists
that show it pass `chromeArgs: ["--disable-webgl"]` so it falls back to HTML
text, set a short prompt off camera (`export PS1='~/code $ '; clear`), and work
in a short neutral folder such as `/var/tmp/code`. If the terminal's letters
look spaced out, the machine has no monospace font: set
`WALKTHROUGH_MONO_FONT` to a `.ttf`, as `shots/quickstart-build-a-plugin.mjs`
does.

Time the shots so the whole video is 30–60 seconds: about 4–8 seconds each.
Agent work, page loads and anything else slow belongs in `before`, where the
recording is paused.

## 4. Record

```sh
node .bb/skills/docs-walkthroughs/record.mjs \
  --shots .bb/skills/docs-walkthroughs/shots/<page-slug>.mjs \
  --out apps/web/public/docs-videos/<page-slug>/<name> \
  --chrome "$(command -v chromium || command -v google-chrome)" \
  --ffmpeg "$(command -v ffmpeg)"
```

It records light mode at 1280×720 and writes:

| File                | What it is                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `<name>.mp4`        | H.264, 30 fps, no audio                                            |
| `<name>-poster.jpg` | The poster frame                                                   |
| `<name>.txt`        | The page title and the numbered captions: the video's text version |
| `<name>.vtt`        | The captions with each step's start and end, used for re-recording |

Watch the whole mp4 and look at the poster before you go on. Check every
frame for leftover private details, captions covering what they describe, and
anything cut off. Re-record until it is clean.

## 5. Surfaces only the desktop app has

Native menus, the tray and other desktop-only surfaces aren't in a browser.
Capture them from the Linux desktop app, attached to the same dev server,
under a virtual display (`xvfb`, `xdotool`):

```sh
pnpm exec turbo run build --filter=@bb/desktop
Xvfb :99 -screen 0 2880x1800x24 &
export DISPLAY=:99
dir="$PWD/.tmp/docs-walkthrough"
cd apps/desktop
BB_DATA_DIR="$dir/bb-data" BB_SERVER_PORT=47186 BB_HOST_DAEMON_PORT=47187 \
BB_SERVER_URL=http://127.0.0.1:47186 BB_DESKTOP_ATTACH_WITHOUT_PROMPT=1 NODE_ENV=production \
  pnpm exec electron --user-data-dir="$dir/desktop" --force-device-scale-factor=2 \
  --remote-debugging-port=9229 .
```

- Add `GTK_THEME=Adwaita:dark` for the dark capture; the menus and the app
  follow it.
- To show saved servers, write neutral ones into
  `$dir/desktop/server-target.json` before starting, such as `Work` and
  `Home lab` (`customServerUrls` and `customServerNames`).
- Under Xvfb there is no window manager, so the menu bar is hidden: run
  `xdotool search --name bb windowfocus`, then `xdotool key alt` to show it,
  and `xdotool mousemove <x> <y> click 1` to open a menu.
- Capture with `ffmpeg -f x11grab -video_size 2880x1800 -i :99 -frames:v 1 shot.png`,
  then crop with `-vf crop=w:h:x:y`. Stills follow the docs-images rules:
  light and dark at 2×, even width and height, nothing cut off.
- To record the app window instead, pass `record.mjs --cdp <url>` with the
  `webSocketDebuggerUrl` from `http://127.0.0.1:9229/json/version`.

If `electron` can't find its binary, run `node node_modules/electron/install.js`
in `apps/desktop` first.

## 6. Embed it

Put the video right below the opening paragraph, on one line so it doesn't
count toward the page's word budget:

```mdx
<Video
  src="/docs-videos/<page-slug>/<name>"
  title="<page title>, step by step"
  width={1280}
  height={720}
/>
```

The player has a poster and controls, starts muted and never autoplays. The
**Text version** link under it opens `<name>.txt`, and the page's `.md` copy
links the video and its text version. The `@bb/web` tests fail when a file is
missing or the mp4 is over 3 MB.

## 7. Get the user's QA

Send the user the mp4 and poster paths, the video's length and size, and the
text version. Say which steps were re-recorded. Fix what they report and send
it again; ship only after they pass it.

## 8. Re-record when the page's sources change

The freshness check flags a page when a commit touches its `sources`. Check
which steps that commit changed on screen, and re-record only those:

```sh
.bb/skills/docs-walkthroughs/start-dev-bb.sh
node .bb/skills/docs-walkthroughs/record.mjs --shots … --out … --only 2,4
```

Start from a fresh dev bb and stage it as in step 2; the shot list's `setup`
and `before` hooks rebuild the rest.

`--only` still runs every step, so the app reaches the same state, but keeps
the other steps' footage from the existing mp4, using the timings in its
`.vtt`. If a caption changed, re-record that step too, since captions are part
of the picture. If the page gained or lost a step, record every step again.
Then send the result for QA (step 7) and set the page's `verified` date.

## 9. Clean up

Stop `start-dev-bb.sh` with Ctrl-C, and delete `.tmp/docs-walkthrough`
(the dev bb's data and the demo projects) and any frames you kept with
`--keep-frames`.
