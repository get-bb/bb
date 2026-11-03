import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  findReleaseEntry,
  nightlyBaseVersion,
  type SourceUpdateNotes,
} from "./release-notes-model";
import {
  getReleaseNotesUrl,
  getSourceCompareUrl,
  openReleaseNotesOnWeb,
  openSourceCompareOnWeb,
} from "./release-notes";

const MARKDOWN_IMAGE_ONLY = /^!\[[^\]]*\]\([^)]*\)$/;
const COMMIT_SUBJECT_PULL_REQUEST = /^(.*?)\s*\(#(\d+)\)$/;
const PULL_REQUEST_BASE_URL = "https://github.com/get-bb/bb/pull/";
const FOOTER_LINK_CLASS_NAME =
  "inline-flex w-fit shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs whitespace-nowrap text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

function ExternalLink({
  href,
  className,
  onOpen,
  children,
}: {
  href: string;
  className: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

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

function pluralCommits(count: number): string {
  return `${String(count)} new commit${count === 1 ? "" : "s"} on main`;
}

function IncomingCommits({ update }: { update: SourceUpdateNotes }) {
  const remaining = update.commitCount - update.subjects.length;
  return (
    <ul className="mt-1 space-y-1">
      {update.subjects.map((subject, index) => {
        const match = COMMIT_SUBJECT_PULL_REQUEST.exec(subject);
        const pullRequest = match?.[2] ?? null;
        const href = `${PULL_REQUEST_BASE_URL}${pullRequest ?? ""}`;
        return (
          <li
            key={index}
            className="relative pl-3 before:absolute before:top-[0.55em] before:left-0 before:size-1 before:rounded-full before:bg-border"
          >
            {match === null ? subject : match[1]}
            {pullRequest === null ? null : (
              <>
                {" "}
                <ExternalLink
                  href={href}
                  className="whitespace-nowrap text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                  onOpen={() => openUrlInExternalBrowser(href)}
                >
                  #{pullRequest}
                </ExternalLink>
              </>
            )}
          </li>
        );
      })}
      {remaining > 0 ? (
        <li className="pl-3">and {String(remaining)} more</li>
      ) : null}
    </ul>
  );
}

export interface ReleaseNotesPanelProps {
  id: string;
  version: string;
  sourceUpdate: SourceUpdateNotes | null;
}

export function ReleaseNotesPanel({
  id,
  version,
  sourceUpdate,
}: ReleaseNotesPanelProps) {
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
  }, [entry, sourceUpdate]);

  return (
    <section
      id={id}
      aria-label={`bb ${version} changelog`}
      data-updates-domain="release-notes"
      className="bg-sidebar px-4 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      {sourceUpdate !== null ? (
        <div className="mb-2">
          <h3 className="text-xs font-medium text-foreground">
            {pluralCommits(sourceUpdate.commitCount)}
          </h3>
          <p className="text-2xs">
            {sourceUpdate.from === null
              ? sourceUpdate.to.slice(0, 7)
              : `${sourceUpdate.from.slice(0, 7)} → ${sourceUpdate.to.slice(0, 7)}`}
          </p>
        </div>
      ) : releaseMeta === undefined ? (
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
      {sourceUpdate === null && entry === null ? (
        <p>
          {changelogQuery.isPending
            ? "Loading the changelog…"
            : changelogQuery.isError
              ? "Couldn't load the changelog."
              : `bb ${version} has no changelog in the app.`}
        </p>
      ) : null}
      {sourceUpdate !== null || entry !== null ? (
        <div className="relative min-w-0">
          <div
            ref={scrollRef}
            data-release-notes-scroll
            onScroll={(event) => syncFade(event.currentTarget)}
            className="max-h-48 overflow-x-hidden overflow-y-auto pr-2 break-words"
          >
            {sourceUpdate !== null ? (
              <IncomingCommits update={sourceUpdate} />
            ) : entry !== null ? (
              <>
                <Blocks blocks={entry.lede} />
                {entry.sections.map((section) => (
                  <div key={section.title} className="mt-3">
                    <h4 className="font-semibold text-foreground">
                      {section.title}
                    </h4>
                    <Blocks blocks={section.blocks} />
                  </div>
                ))}
              </>
            ) : null}
          </div>
          {moreAbove ? (
            <OverflowFade placement="above" tone="sidebar" inset />
          ) : null}
          {moreBelow ? (
            <OverflowFade placement="below" tone="sidebar" inset />
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline justify-end gap-3">
        {entry !== null && nightlyBaseVersion(version) !== null ? (
          <p className="mr-auto min-w-0 text-2xs">
            This build includes changes since {entry.version}
          </p>
        ) : null}
        {sourceUpdate === null ? (
          <ExternalLink
            href={getReleaseNotesUrl(notesVersion)}
            className={FOOTER_LINK_CLASS_NAME}
            onOpen={() => openReleaseNotesOnWeb(version, notesVersion)}
          >
            Full changelog
            <Icon aria-hidden name="ExternalLink" className="size-3" />
          </ExternalLink>
        ) : (
          <ExternalLink
            href={getSourceCompareUrl(sourceUpdate)}
            className={FOOTER_LINK_CLASS_NAME}
            onOpen={() => openSourceCompareOnWeb(version, sourceUpdate)}
          >
            Compare on GitHub
            <Icon aria-hidden name="ExternalLink" className="size-3" />
          </ExternalLink>
        )}
      </div>
    </section>
  );
}
