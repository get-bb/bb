# Graphics for the monthly email

One or two images per theme, 560 CSS px wide, exported at 3×. Work in the
issue's local `scripts/monthly-email/issues/<yyyy-mm>/design/` (gitignored):
copy `scripts/monthly-email/design/design-base.css` there, copy Inter
(`inter-latin-wght-normal.woff2` and `inter-latin-ext-wght-normal.woff2` from
`apps/app/node_modules/@fontsource-variable/inter/files/`) into `fonts/` as
`inter-latin.woff2` and `inter-latin-ext.woff2`, and put captures in `caps/`.
Final PNGs go one level up.

## Style

- **Color:** bb's file-link blue, `oklch(0.55 0.1 250)`. The canvas is the soft
  blue radial gradient from `design-base.css`, with white cards and soft
  shadows.
- **Font:** Inter, loaded by `design-base.css` from `fonts/`. Without it,
  headless Chrome on Linux silently falls back to DejaVu.
- **Layout:** cards hug their contents and sit centered. Nothing is cut off,
  including text truncated with "…" inside a capture: shorten the sample data
  instead.
- **Size:** keep images short. Prefer bigger, less detailed crops, and make
  small things bigger by wrapping into rows rather than shrinking them into one
  line. Put two small things side by side in one image, not in two tall images.
  A theme gets a second image only when an item needs its own picture. Put text
  between any two images. Not every item needs a graphic.
- **One moment a real user could see.** Don't combine states that can't appear
  together, such as two layouts or an option beside its alternative. When the
  copy offers a choice, show one option and let the words cover the rest. Show a
  component where it lives, in its real surroundings.
- **Real product only:** real bb surfaces or measured numbers. No title cards,
  text-only graphics, device frames, stock icons or illustrations; they read as
  fake. A diagram of an unmeasured idea does too. Third-party apps (ChatGPT,
  Claude) may appear as simplified wireframes when the point is bb working with
  them, using bb's real tool names ("Control bb").
- **Capture, don't retouch.** Set up the real state, then capture it. Never edit
  pixels to remove or move UI.
- **Default settings.** Show bb as it ships. If something has to be turned on to
  appear, tell the reviewer.
- **Charts** are plain line or bar charts with labeled axes, before in grey and
  now in blue. The x-axis is what actually drives the cost (files written in
  threads you aren't viewing, not thread count). Measured values only.
- **Annotations stay subtle:** 1 px outlines in
  `color-mix(in oklch, oklch(0.55 0.1 250) 75%, transparent)` on the element's
  measured edges, small white pill labels with blue text, and 1 px leader lines.
  Don't outline things that don't need it.
- **Labels** use the names bb's UI uses (check the element's `aria-label` at the
  tag), and:
  - Label only what the email says is new. Familiar parts stay unlabeled,
    however recognizable.
  - Point at the thing that changed, not the nearest control. If it lives
    somewhere hidden (a menu, a hover state, another tab), open it in the
    capture.
  - Outline exactly what changed: the whole part when it can be replaced, only
    the added content when plugins add to it.
  - A highlight must not change how the UI reads. If an outline makes something
    look selected or active, or crowds another label, drop it and let the copy
    name it.
- **Stat cards:** a short headline holding the multiple once ("Switching threads
  got 6× faster"), then `~~before~~ → after` rows with plain metric names.
- **New things:** in a lineup, tag what's new with a small blue "New" pill and
  give each item its status underneath (Alpha, TestFlight).

## Patterns

| Pattern                                                                                                          | Use for                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| One real window, annotated from measured coordinates (`annotate-design.mjs`)                                     | A theme spread across several surfaces              |
| Two cards side by side: before → after numbers, and a measured line chart                                        | Performance, or two different features in one image |
| One annotated panel                                                                                              | A single feature                                    |
| Two states of one component side by side, with an arrow and a pill label each, shown in place above the composer | A feature with a before and after state             |
| Simplified chat windows calling bb, an arrow to the started thread, and the real plugin card                     | Integrations                                        |
| A list excerpt                                                                                                   | Registries and settings lists                       |

## Capturing real UI

1. **Run bb at the newest tag in the month, isolated.** One build is enough; for
   older items, check their components haven't changed with
   `git diff desktop-v<old> desktop-v<new> -- <dir>`. Make a worktree at
   `desktop-v<ver>`, then run `pnpm install`, `pnpm build` and
   `pnpm start:worktree`. That gives a fresh, empty data dir under
   `~/.bb-dev/<instance>` with its own ports. Pass
   `BB_SERVER_URL=http://127.0.0.1:<port>` on every bb call, and confirm
   `bb status` shows the test data dir before writing anything. Never capture a
   real user's bb.
2. **Turn on only what the graphic needs**, for example
   `bb plugin enable bb--prompt-library`, and keep everything else at its
   default. To show what plugins can add to a surface, install a tiny local
   plugin with `bb plugin install <dir>` that registers the slot with realistic
   sample content. Its `package.json` needs `bb.name`, `bb.description`,
   `bb.branding` (an icon), a `bb.server` entry (an empty default export is
   enough) and the `bb.app` entry.
3. **Sample data without running agents.** Check each command's `--help` at the
   tag; flags change.
   - Make a scratch git repo with a few uncommitted changes (October's was
     "acme-web"), then `bb project create` and one `bb thread spawn`. Stop the
     thread right away (`bb thread stop`), because a spawned agent uses a real
     provider account.
   - Add more threads for the thread list with `bb thread fork <id>`, which
     copies history without running anything, and rename them with
     `bb thread update <id> --title`. Forks add a "Forks" section to the Info
     tab; hide it in the capture.
   - Star prompts with `bb prompts star "<text>" --title "<title>"`.
   - For states you can't stage safely (a child thread waiting with a question),
     render the real component in Ladle with realistic fixture data, in a
     local-only story (step 7).
4. **Capture** with `bb browser-automation` (local headless):
   - Set the viewport (`{width, height, deviceScaleFactor: 3}`) before loading,
     and capture with `page.screenshot({clip, captureBeyondViewport: false})`.
     Without `false`, the layout reflows.
   - Measure elements with `getBoundingClientRect()` in the same session, and
     write the measurements to an annotations config holding `capture`, `page`,
     `elements` and `labels`. Give a label a `dx` to move its leader line off
     text it would cross. Generate the design with:

     ```sh
     node scripts/monthly-email/annotate-design.mjs <config.json> <out.html>
     ```

   - Runs fail after about 30 seconds in practice, and a failed run ends the
     session. Navigate in one run (don't await `goto`; sleep a few seconds),
     then capture in the next.
   - Narrow crops stay readable at half width: open the right panel or shrink
     the viewport so the chat column narrows, or set a Ladle story's width to
     about 340 px.
   - Check that every component shows its normal state. Responsive layouts
     collapse at narrow widths (at 0.48.1 the composer shrinks to one line under
     30rem; see `apps/app/src/app.css`). Panels can grow with the viewport, so
     resize the panel rather than the viewport.
   - Popovers can close but stay in the DOM. Open, clean up and capture in one
     run.
5. **Privacy.** Before capturing, hide or replace anything private: folder paths
   (set the text to "~/code/acme-web"), machine names, account emails and
   signed-in names (use made-up ones in a story), thread IDs, and the test
   thread's run log.
6. **Lists.** To show a few rows of a long list, hide the other rows of the list
   container.
7. **Components in Ladle.** Run
   `pnpm exec ladle serve --port <p> --host 127.0.0.1` from `apps/app` in the
   tag worktree. Story IDs are in `http://127.0.0.1:<p>/meta.json`; open
   `?story=<id>&mode=preview&theme=light`. If every story renders blank,
   `.ladle/plugin-sdk-app.ts` is missing exports that
   `src/lib/plugin-sdk-app-impl.tsx` has; add them locally. Add local-only
   stories for realistic sample data and never commit them.
8. **Mobile.** Load the thread at
   `{width: 390, height: 780, deviceScaleFactor: 2, isMobile: true}`; the mobile
   apps wrap the same web app.
9. **Desktop-only surfaces** (the desktop browser tab, Agent Annotations) need
   the desktop app. On a Mac, `pnpm desktop:worktree` launches it against the
   test bb; on Linux, run it under Xvfb and capture over its debugging port.
   OS-level surfaces (a phone notification) can't be captured: show the bb
   setting that controls them, or leave the item without a graphic.

## Measuring a number

When a PR shows only a "before", or nothing measured at all, measure it.
Reproduce the PR's mechanism in a small script against a scratch folder, run old
against new, repeat each point, and keep the script and raw results in the
issue's `design/bench/`. Delete the scratch folder afterwards, and say what was
measured and on what hardware. October's, for example, measured macOS
file-watching CPU for a watch over all thread storage against a single-thread
watch, in about 3 minutes on a Mac.

## Rendering

- Serve the design folder on this machine only (for example
  `python3 -m http.server --bind 127.0.0.1` in it). Then write a script that
  renders each `.c` canvas at 3× with the browser cache off, at most five
  designs per script so a run stays under 30 seconds:

  ```sh
  node scripts/monthly-email/browser-scripts.mjs designs <base-url> <out-dir> <design-name…> > scripts/monthly-email/browser/render.js
  ```

  The cache is off because a stale cached `design-base.css` once dropped the
  Inter font.

- Copy the final PNGs to `issues/<yyyy-mm>/`, and look at every one before using
  it.

## Delivery

- **Hosting:** Resend's image upload, as in [resend.md](resend.md).
- **Cleanup:** stop the test bb, Ladle and the preview server, close browser
  sessions, delete Resend drafts used only for testing (never the image-upload
  draft), and delete the test data dir and worktree.
