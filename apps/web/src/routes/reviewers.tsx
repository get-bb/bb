import { createFileRoute } from "@tanstack/react-router";

import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";
import reviewersCss from "../landing/reviewers.css?url";

const PAGE_TITLE = "Evaluate bb in 10 minutes";
const PAGE_DESCRIPTION = "A 10-minute way to evaluate the current bb fairly.";

export const Route = createFileRoute("/reviewers")({
  head: () => ({
    meta: pageMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/reviewers"),
    links: siteHeadLinks(blogCss, reviewersCss),
  }),
  component: ReviewersRoute,
});

function ReviewersRoute() {
  useInitAnalytics();

  return (
    <div className="wrap">
      <SiteNav />

      <main className="post article reviewers">
        <div className="post-body">
          <h1>{PAGE_TITLE}</h1>
          <p className="lede">{PAGE_DESCRIPTION}</p>

          <p>
            <strong>Current build:</strong>{" "}
            <a className="release-link" href="/">
              https://getbb.app/
            </a>{" "}
            (macOS on Apple Silicon; Windows and Linux are Alpha; Intel Macs and
            remote machines via <code>npx bb-app@latest</code>). MIT-licensed
            and free to use; it runs on the AI plans you already pay for.
          </p>

          <h2>The 10-minute evaluation</h2>
          <ol>
            <li>
              <strong>Install and open a project (2 min).</strong> Use a fresh
              install with default settings; setup leaves optional plugins off,
              as shipped. Sign in to the agents you already use. Use a scratch
              repository: agents can push branches and open pull requests when a
              task calls for it.
            </li>
            <li>
              <strong>Ask an agent to set something up (2 min).</strong>{" "}
              Example: "Every weekday at 9, check open pull requests and send me
              a summary." The agent creates the scheduled job itself, and you
              can run it once right away to see the summary. Needs GitHub signed
              in on this machine (ask the agent to set it up).
            </li>
            <li>
              <strong>Hand off work (2 min).</strong> "Add a remove(list, item)
              function to todo.js. Split this change: one thread writes it,
              another reviews it." The agent starts a writer and a reviewer as
              child threads. If a child needs you, its question shows up in the
              parent's banner and you answer it there.
            </li>
            <li>
              <strong>Ask for a tool bb doesn't have (a few minutes).</strong>{" "}
              "Build me a new plugin that adds a panel to the sidebar listing my
              open GitHub PRs, and install it." The agent builds and installs
              the plugin, and the panel appears in the sidebar. Needs GitHub
              signed in on this machine (ask the agent to set it up).
            </li>
            <li>
              <strong>Visuals in the chat (1 min).</strong> Ask for a chart of
              something in the repo; inline visualizations render it in the
              thread.
            </li>
          </ol>

          <h2 id="short-answers">Short answers</h2>
          <table aria-labelledby="short-answers">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Answer</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Bloat</th>
                <td>
                  Most of bb is plugins, and the optional ones are off until you
                  turn them on. You add what you need, and agents build the
                  rest.
                </td>
              </tr>
              <tr>
                <th scope="row">Visuals in the chat</th>
                <td>
                  Inline visualizations are on by default, and plugins can
                  render custom blocks through an experimental code-fence
                  renderer slot.
                </td>
              </tr>
              <tr>
                <th scope="row">Subagents</th>
                <td>
                  Child threads with their own context; the parent shows which
                  children need you and lets you answer in place.
                </td>
              </tr>
              <tr>
                <th scope="row">Performance</th>
                <td>
                  We make no speed claims. Measure it on the release you test.
                </td>
              </tr>
              <tr>
                <th scope="row">Providers</th>
                <td>
                  Claude Code, Codex and Pi built in; Cursor, opencode, Grok
                  Build, oh-my-pi, Hermes Agent, Amp and other ACP agents once
                  installed.
                </td>
              </tr>
            </tbody>
          </table>

          <p>Checked on bb 0.46.1, Oct 20, 2026.</p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
