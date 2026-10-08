import type { ReactNode } from "react";
import { WhatsNewCard, WhatsNewOffNotice } from "./card.js";
import { WhatsNewNotes } from "./notes.js";
import type { ReleaseNotes } from "./state.js";

export default {
  title: "plugins/What's new",
};

const noop = () => {};

const NATIVE_WINDOWS: ReleaseNotes = {
  version: "0.45.0",
  date: "October 2, 2026",
  headline: "Native Windows support, service tiers, and faster conversations",
  visual: "native-windows",
  hero: null,
  lede: [
    {
      kind: "paragraph",
      text: "bb now runs natively on Windows, lets you pick a **service tier** per thread, and streams long conversations faster.",
    },
  ],
  sections: [
    {
      title: "Highlights",
      blocks: [
        {
          kind: "list",
          items: [
            "**Native Windows:** install the desktop app and run agents on Windows machines.",
            "**Service tiers:** choose a faster or cheaper tier from the model picker.",
            "**Faster conversations:** long threads stream and scroll smoothly.",
          ],
        },
      ],
    },
    {
      title: "Fixes",
      blocks: [
        {
          kind: "list",
          items: ["Fixed `bb status` output when a machine is offline."],
        },
      ],
    },
    {
      title: "Thanks",
      blocks: [
        {
          kind: "paragraph",
          text: "[@ada](https://github.com/ada), [@grace](https://github.com/grace)",
        },
      ],
    },
  ],
};

const DIFF_FILTERING: ReleaseNotes = {
  version: "0.44.0",
  date: "September 25, 2026",
  headline: "Diff filtering, safer archiving, and plugin safe mode",
  visual: "diff-filter",
  hero: null,
  lede: [
    {
      kind: "paragraph",
      text: "Filter large diffs, recover archived threads more safely, and troubleshoot plugins with safe mode.",
    },
  ],
  sections: [
    {
      title: "Highlights",
      blocks: [
        {
          kind: "list",
          items: [
            "Filter the diff panel with globs like `*.md` or `!*.test.ts`.",
          ],
        },
      ],
    },
  ],
};

const SAVED_DRAFTS: ReleaseNotes = {
  ...DIFF_FILTERING,
  version: "0.43.3",
  date: "September 18, 2026",
  headline: "Saved drafts, browser annotations, and live browser previews",
  visual: "saved-drafts",
};

const NEXT_RELEASE: ReleaseNotes = {
  ...DIFF_FILTERING,
  version: "0.46.0",
  date: null,
  headline: null,
  visual: null,
  lede: [{ kind: "paragraph", text: "The next release is ready to install." }],
};

function Themes({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {(["light", "dark"] as const).map((theme) => (
        <div key={theme} className={`${theme} ${className}`}>
          {children}
        </div>
      ))}
    </div>
  );
}

export function SidebarCard() {
  return (
    <Themes className="flex flex-wrap items-start gap-4 bg-sidebar p-6 text-sidebar-foreground">
      {[NATIVE_WINDOWS, DIFF_FILTERING, NEXT_RELEASE].map((release) => (
        <div key={release.version} className="w-64">
          <WhatsNewCard
            release={release}
            onOpen={noop}
            onDismiss={noop}
            onTurnOff={noop}
          />
        </div>
      ))}
    </Themes>
  );
}

export function TurnedOffNotice() {
  return (
    <Themes className="bg-sidebar p-6 text-sidebar-foreground">
      <div className="w-64">
        <WhatsNewOffNotice
          settingsHref="/settings/plugins/bb--whats-new"
          onUndo={noop}
          onClose={noop}
        />
      </div>
    </Themes>
  );
}

export function UpdatesSection() {
  return (
    <Themes className="space-y-10 bg-background p-6 text-foreground">
      <div className="max-w-2xl">
        <WhatsNewNotes
          current={NATIVE_WINDOWS}
          skipped={[]}
          updatedFrom={null}
          available={null}
        />
      </div>
      <div className="max-w-2xl">
        <WhatsNewNotes
          current={NATIVE_WINDOWS}
          skipped={[DIFF_FILTERING, SAVED_DRAFTS]}
          updatedFrom="0.43.0"
          available={NEXT_RELEASE}
        />
      </div>
    </Themes>
  );
}
