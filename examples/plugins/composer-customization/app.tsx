import { useState } from "react";
import { definePluginApp, useComposer } from "@get-bb/plugin-sdk/app";
import "./app.css";

function ComposerAction() {
  const composer = useComposer();
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
      disabled={composer.isSubmitting}
      onClick={toggleBusy}
      title={busy ? "Unlock draft" : "Lock and animate draft"}
      type="button"
    >
      {busy ? "Unlock" : "Polish"}
    </button>
  );
}

function ComposerBanner() {
  const composer = useComposer();
  const mentionCount = composer.draft.mentions.length;
  return (
    <div className="composer-reference-banner">
      {composer.isEmpty
        ? "Start typing to see the rich-text rule."
        : `${composer.text.length} draft characters and ${mentionCount} mentions in ${composer.scope.kind}.`}
      {composer.isSubmittingBlocked && composer.submittingBlockedReason
        ? ` ${composer.submittingBlockedReason}`
        : null}
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
        disabled: (composer) => composer.isSubmitting,
        run: ({ composer }) => {
          composer.insert("- Verify behavior\n- Run checks", {
            at: "end",
            block: true,
          });
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
    },
  });
});
