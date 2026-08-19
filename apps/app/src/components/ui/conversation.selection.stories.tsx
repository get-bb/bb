import { useLayoutEffect, useRef } from "react";
import { AppSelectAllController } from "@/components/AppSelectAllController";
import { ConversationTimeline } from "./conversation.js";

export default {
  title: "foundation/Selection Policy",
};

function ShadowSelectionSurface() {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null || host.shadowRoot !== null) return;
    host.attachShadow({ mode: "open" }).innerHTML = `
      <p>Shadow file line one</p>
      <button type="button">Shadow action</button>
      <p>Shadow file line two</p>
      <input value="Shadow editor draft" />
    `;
  }, []);

  return (
    <section
      className="mt-4 select-text rounded-md border border-border p-4"
      data-select-all-scope=""
      data-testid="mixed-shadow-scope"
    >
      <p>Light preview header</p>
      <div ref={hostRef} />
      <p>Light preview footer</p>
    </section>
  );
}

export const Policy = () => {
  useLayoutEffect(() => {
    document.documentElement.classList.add("bb-app-shell-root");
    document.body.classList.add("bb-app-shell");
    return () => {
      document.documentElement.classList.remove("bb-app-shell-root");
      document.body.classList.remove("bb-app-shell");
    };
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-[180px_minmax(0,1fr)_280px] bg-background text-foreground">
      <AppSelectAllController />
      <aside
        data-testid="sidebar"
        className="border-r border-border bg-sidebar p-4"
      >
        Sidebar chrome
        <button
          type="button"
          className="mt-8 block select-text font-mono"
          data-select-all-scope=""
          data-testid="diagnostic-value"
        >
          Workspace: /tmp/selection-qa
        </button>
      </aside>

      <main data-thread-window="" className="flex min-w-0 flex-col p-4">
        <ConversationTimeline className="relative min-h-56 w-full rounded-md border border-border p-4">
          <article className="ml-40" data-testid="main-message-row">
            <p className="select-text" data-testid="main-message">
              Main timeline message
            </p>
            <button data-testid="message-action" type="button">
              Message action
            </button>
          </article>
          <article className="ml-40">
            <p data-testid="second-main-message">
              Second main timeline message
            </p>
          </article>
          <details className="ml-40" open>
            <summary>Markdown details summary</summary>
            <p>Markdown details body</p>
          </details>
          <label className="ml-40">
            <input type="checkbox" /> Markdown task label
          </label>
        </ConversationTimeline>
        <div
          contentEditable
          suppressContentEditableWarning
          data-testid="composer"
          className="mt-4 rounded-md border border-border p-3"
        >
          Composer draft
        </div>
        <ShadowSelectionSurface />
      </main>

      <aside
        data-thread-window=""
        data-testid="side-chat"
        className="border-l border-border bg-surface-recessed p-4"
      >
        <ConversationTimeline>
          <p className="select-text" data-testid="side-chat-message">
            Side chat message
          </p>
        </ConversationTimeline>
      </aside>
    </div>
  );
};
