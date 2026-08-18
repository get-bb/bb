import { useState } from "react";
import {
  definePluginApp,
  useComposer,
  useComposerView,
} from "@get-bb/plugin-sdk/app";
import "./app.css";

function ComposerAction() {
  const composer = useComposer();
  const view = useComposerView();
  const [busy, setBusy] = useState(false);

  function toggleBusy() {
    const next = !busy;
    setBusy(next);
    composer.setInputLock(next);
    composer.setTextEffect(
      next ? { className: "composer-reference-busy" } : null,
    );
  }

  return (
    <button
      aria-pressed={busy}
      className="composer-reference-action"
      disabled={view.run.isSubmitting}
      onClick={toggleBusy}
      title={busy ? "Unlock draft" : "Lock and animate draft"}
      type="button"
    >
      {busy ? "Unlock" : "Polish"}
    </button>
  );
}

function ComposerBanner() {
  const view = useComposerView();
  return (
    <div className="composer-reference-banner">
      {view.draft.isEmpty
        ? "Start typing to see the rich-text rule."
        : `${view.draft.text.length} draft characters in ${view.scope.kind}.`}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "reference-regions",
    actions: [{ id: "polish", component: ComposerAction }],
    plusMenu: [
      {
        id: "append-checklist",
        label: "Append review checklist",
        icon: "ListChecks",
        description: "Add a short review checklist to the current draft.",
        disabled: (view) => view.run.isSubmitting,
        run: ({ composer }) => {
          composer.updateText(
            (current) =>
              `${current}${current ? "\n\n" : ""}- Verify behavior\n- Run checks`,
          );
          composer.focus();
        },
      },
    ],
    banners: [
      { id: "draft-summary", chrome: "card", component: ComposerBanner },
    ],
    richText: {
      effects: [
        {
          id: "todo-highlight",
          className: "composer-reference-highlight",
          match(text) {
            return Array.from(text.matchAll(/\bTODO\b/g), (match) => ({
              from: match.index,
              to: match.index + match[0].length,
            }));
          },
        },
      ],
      onDraftChange(draft, view) {
        console.debug("composer draft changed", {
          scope: view.scope.kind,
          text: draft.text,
          mentions: draft.mentions,
        });
      },
    },
  });
});
