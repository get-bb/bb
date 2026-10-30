import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@bb/shared-ui/icon";
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  CHANGELOG_ENTRIES,
  changelogEntriesQueryOptions,
  RELEASE_META,
  releaseMetaQueryOptions,
  type ChangelogBlock,
} from "./changelog-preview";
import { findReleaseEntry, nightlyBaseVersion } from "./release-notes-model";
import { getReleaseNotesUrl, openReleaseNotesOnWeb } from "./release-notes";

const MARKDOWN_IMAGE_ONLY = /^!\[[^\]]*\]\([^)]*\)$/;

const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  img: () => null,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      onClick={(event) => {
        event.preventDefault();
        if (href !== undefined) {
          openUrlInExternalBrowser(href);
        }
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 font-mono text-foreground">
      {children}
    </code>
  ),
  strong: ({ children }) => (
    <strong className="font-medium text-foreground">{children}</strong>
  ),
};

function Inline({ text }: { text: string }) {
  return (
    <ReactMarkdown components={INLINE_COMPONENTS} skipHtml>
      {text}
    </ReactMarkdown>
  );
}

function Blocks({ blocks }: { blocks: ChangelogBlock[] }) {
  return blocks.map((block, index) => {
    if (block.kind === "list") {
      return (
        <ul key={index} className="mt-1 space-y-1">
          {block.items.map((item) => (
            <li
              key={item}
              className="relative pl-3 before:absolute before:top-[0.55em] before:left-0 before:size-1 before:rounded-full before:bg-border"
            >
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    }
    if (MARKDOWN_IMAGE_ONLY.test(block.text.trim())) {
      return null;
    }
    return (
      <p key={index} className="mt-1 first:mt-0">
        <Inline text={block.text} />
      </p>
    );
  });
}

export interface ReleaseNotesPanelProps {
  id: string;
  version: string;
}

export function ReleaseNotesPanel({ id, version }: ReleaseNotesPanelProps) {
  const changelogQuery = useQuery(changelogEntriesQueryOptions());
  const entry = findReleaseEntry(
    version,
    changelogQuery.data,
    CHANGELOG_ENTRIES,
  );
  const notesVersion = entry?.version ?? version;
  const bundledMeta = RELEASE_META[notesVersion];
  const metaQuery = useQuery(
    releaseMetaQueryOptions(bundledMeta === undefined),
  );
  const releaseMeta = bundledMeta ?? metaQuery.data?.[notesVersion];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreAbove, setMoreAbove] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const syncFade = (node: HTMLDivElement | null) => {
    if (node !== null) {
      setMoreAbove(node.scrollTop > 0);
      setMoreBelow(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    }
  };
  useEffect(() => {
    syncFade(scrollRef.current);
  }, [entry]);

  return (
    <section
      id={id}
      aria-label={`bb ${version} changelog`}
      data-updates-domain="release-notes"
      className="bg-sidebar px-4 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      {releaseMeta === undefined ? (
        <h3 className="mb-2 text-xs font-medium text-foreground">
          What&apos;s new in bb {notesVersion}
        </h3>
      ) : (
        <div className="mb-2">
          <h3 className="text-xs font-medium text-foreground">
            {releaseMeta.headline}
          </h3>
          <p className="text-2xs">
            bb {notesVersion} · {releaseMeta.date}
          </p>
        </div>
      )}
      {entry === null ? (
        <p>
          {changelogQuery.isPending
            ? "Loading the changelog…"
            : changelogQuery.isError
              ? "Couldn't load the changelog."
              : `bb ${version} has no changelog in the app.`}
        </p>
      ) : (
        <div className="relative min-w-0">
          <div
            ref={scrollRef}
            data-release-notes-scroll
            onScroll={(event) => syncFade(event.currentTarget)}
            className="max-h-48 overflow-x-hidden overflow-y-auto pr-2 break-words"
          >
            <Blocks blocks={entry.lede} />
            {entry.sections.map((section) => (
              <div key={section.title} className="mt-3">
                <h4 className="font-semibold text-foreground">
                  {section.title}
                </h4>
                <Blocks blocks={section.blocks} />
              </div>
            ))}
          </div>
          {moreAbove ? (
            <OverflowFade placement="above" tone="sidebar" inset />
          ) : null}
          {moreBelow ? (
            <OverflowFade placement="below" tone="sidebar" inset />
          ) : null}
        </div>
      )}
      <div className="mt-2 flex items-baseline justify-end gap-3">
        {entry !== null && nightlyBaseVersion(version) !== null ? (
          <p className="mr-auto min-w-0 text-2xs">
            This build includes changes since {entry.version}
          </p>
        ) : null}
        <a
          href={getReleaseNotesUrl(notesVersion)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(event) => {
            event.preventDefault();
            openReleaseNotesOnWeb(version, notesVersion);
          }}
        >
          Full changelog
          <Icon aria-hidden name="ExternalLink" className="size-3" />
        </a>
      </div>
    </section>
  );
}
