import {
  DEV_SERVER_URL,
  bb,
  menuItem,
  privacyReplacements,
  until,
} from "../dev-cli.mjs";

const NEW_THREAD_COMPOSER = "#root-compose-prompt";
const THREAD_COMPOSER = "#thread-detail-follow-up-composer";
const PROMPT =
  "Add a checkout page to this app. Split the work into two parts that don't touch the same files. Start a child thread for each part with `bb thread spawn --parent-self` and no --environment, so each gets its own worktree, with a short title and a prompt that says exactly what to build and how to test it. Don't do the parts yourself, and don't merge them yet. When every child is done, tell me what each one changed.";
const MERGE =
  "Merge each child thread's branch into this branch, resolve any conflicts, and run the tests. Tell me what you merged.";
const CHANGED_FILES = { text: " files, ", contains: true, closest: "button" };

export const state = { parent: null, children: [] };

const thread = (id) => bb(["thread", "show", id]).thread;
const children = () =>
  bb(["thread", "list", "--parent-thread", state.parent]).filter(
    (child) => !child.archivedAt,
  );
const idle = (id) => thread(id).status === "idle";

export default {
  title: "Quickstart: delegate work to child threads",
  baseUrl: DEV_SERVER_URL,
  scheme: "light",
  replacements: privacyReplacements(),
  poster: { step: 3 },
  async setup(page) {
    await page.goto("/", NEW_THREAD_COMPOSER);
    await page.click('button[aria-label^="Project"]');
    await page.click(menuItem("acme-web"));
    await page.click('button[aria-label="Permission mode"]');
    await page.click(menuItem("Full Access"));
  },
  shots: [
    {
      caption: "Open Settings → Projects and choose Add a project.",
      anchor: { text: "Add a project", closest: "button" },
      before: (page) => page.goto("/settings/projects", { text: "acme-web" }),
      run: (page) => page.hover({ text: "Add a project", closest: "button" }),
      hold: 1600,
    },
    {
      caption:
        "Choose New thread, pick your project and Worktree, then ask for child threads.",
      anchor: 'button[aria-label^="New thread ("]',
      async before(page) {
        await page.goto("/", NEW_THREAD_COMPOSER);
        await page.waitFor('button[aria-label="Project: acme-web"]');
      },
      async run(page) {
        await page.click('button[aria-label^="New thread ("]');
        await page.waitFor(NEW_THREAD_COMPOSER);
        await page.click('button[aria-label="Environment"]');
        await page.click(menuItem("Worktree"));
        await page.click(NEW_THREAD_COMPOSER);
        await page.paste(PROMPT);
        await page.wait(900);
        await page.press("Enter");
        await page.wait(1200);
      },
      hold: 1200,
    },
    {
      caption:
        "Each child appears under the parent. The Active child threads card tracks them.",
      anchor: { text: "Active child threads", contains: true },
      async before(page) {
        state.parent = /thr_[a-z0-9]+/u.exec(await page.path())?.[0];
        if (!state.parent) throw new Error("the parent thread did not open");
        state.children = await until(
          () => {
            const list = children();
            return (
              list.length >= 2 && list.every((child) => child.title) && list
            );
          },
          { what: "two child threads" },
        );
        await page.waitFor(
          { text: "Active child threads", contains: true },
          60_000,
        );
        await page.wait(1500);
      },
      hold: 3600,
    },
    {
      caption:
        "Open a child and press Ctrl+D (⌘D on a Mac) to open its Diff tab.",
      anchor: () => ({ text: state.children[0].title }),
      async before() {
        await until(() => state.children.every((child) => idle(child.id)), {
          what: "the children to finish",
          timeout: 900_000,
        });
        await until(() => idle(state.parent), { what: "the parent to reply" });
        state.children = children();
      },
      async run(page) {
        await page.click({ text: state.children[0].title });
        await page.waitFor(CHANGED_FILES);
        await page.wait(600);
        await page.press("d", { ctrl: true });
        await page.waitFor({ text: "All changes" });
        await page.wait(600);
      },
      after: { text: "All changes", closest: "button" },
      hold: 2600,
    },
    {
      caption: "Ask the parent to merge each child's branch and run the tests.",
      anchor: () => ({ text: thread(state.parent).title }),
      async run(page) {
        await page.click({ text: thread(state.parent).title });
        await page.waitFor(THREAD_COMPOSER);
        await page.click(THREAD_COMPOSER);
        await page.paste(MERGE);
        await page.wait(700);
        await page.press("Enter");
        await page.wait(1500);
      },
      after: THREAD_COMPOSER,
      hold: 1500,
    },
    {
      caption:
        "When the parent has merged them, archive each child from the sidebar.",
      anchor: () => ({ text: state.children[0].title }),
      async before(page) {
        await until(() => idle(state.parent), {
          what: "the parent to merge",
          timeout: 900_000,
        });
        await page.wait(1000);
      },
      async run(page) {
        for (const child of state.children) {
          await page.contextClick({ text: child.title });
          await page.click(menuItem("Archive"));
          await page.wait(900);
        }
      },
      hold: 1800,
    },
  ],
};
