import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import HiFolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import HiGitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import HiGitMergeIcon from "@hugeicons/core-free-icons/GitMergeIcon";
import HiLaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import PlusMinusSquare01Icon from "@hugeicons/core-free-icons/PlusMinusSquare01Icon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import changelogMd from "../../../../CHANGELOG.md?raw";
import { RELEASE_META } from "../../../../changelog-metadata";
import { useInitAnalytics } from "../landing/analytics";
import adobeLogo from "../assets/company-logos/adobe.svg";
import atlassianLogo from "../assets/company-logos/atlassian.svg";
import blackstoneLogo from "../assets/company-logos/blackstone.png";
import browserbaseLogo from "../assets/company-logos/browserbase.png";
import bytedanceLogo from "../assets/company-logos/bytedance.svg";
import customerIoLogo from "../assets/company-logos/customer-io.png";
import datadogLogo from "../assets/company-logos/datadog.svg";
import figmaLogo from "../assets/company-logos/figma.svg";
import gustoLogo from "../assets/company-logos/gusto.png";
import hubspotLogo from "../assets/company-logos/hubspot.svg";
import jetbrainsLogo from "../assets/company-logos/jetbrains.svg";
import justEatTakeawayLogo from "../assets/company-logos/just-eat-takeaway.svg";
import kernelLogo from "../assets/company-logos/kernel.png";
import linearLogo from "../assets/company-logos/linear.svg";
import metaLogo from "../assets/company-logos/meta.svg";
import microsoftLogo from "../assets/company-logos/microsoft.svg";
import moodysLogo from "../assets/company-logos/moodys.png";
import notionLogo from "../assets/company-logos/notion.png";
import oracleLogo from "../assets/company-logos/oracle.svg";
import ownerLogo from "../assets/company-logos/owner.png";
import pendoLogo from "../assets/company-logos/pendo.svg";
import renderLogo from "../assets/company-logos/render.svg";
import shopifyLogo from "../assets/company-logos/shopify.svg";
import shortcutLogo from "../assets/company-logos/shortcut.svg";
import simileLogo from "../assets/company-logos/simile.svg";
import statsigLogo from "../assets/company-logos/statsig.svg";
import stitchFixLogo from "../assets/company-logos/stitch-fix.png";
import tencentLogo from "../assets/company-logos/tencent.png";
import vercelLogo from "../assets/company-logos/vercel.svg";
import zooxLogo from "../assets/company-logos/zoox.png";
import hermesAvatar from "../assets/hermes-avatar.jpg";
import vscodeIcon from "../assets/vscode.png";
import { parseChangelog } from "../../../../changelog-parser";
import { DiscordLink, GitHubLink, SubscribeSection } from "../landing/cta";
import { siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { ClaudeIcon } from "../landing/icons";
import {
  Band,
  InstallOptions,
  ProviderChips,
  CustomizeBuild,
  SpawnSidebar,
  useCycle,
  useScrollReveal,
} from "../landing/landing-visuals";
import {
  OG_DESCRIPTION,
  SITE_DESCRIPTION,
  SITE_TITLE,
  unfurlMeta,
} from "../landing/site";

const COMPANY_PROOF = [
  ["Meta", metaLogo, "glyph"],
  ["Microsoft", microsoftLogo, "glyph"],
  ["Figma", figmaLogo, "glyph"],
  ["Notion", notionLogo, "tile"],
  ["Vercel", vercelLogo, "glyph"],
  ["Shopify", shopifyLogo, "glyph"],
  ["Adobe", adobeLogo, "glyph"],
  ["Linear", linearLogo, "glyph"],
  ["Datadog", datadogLogo, "glyph"],
  ["HubSpot", hubspotLogo, "glyph"],
  ["Atlassian", atlassianLogo, "glyph"],
  ["JetBrains", jetbrainsLogo, "glyph"],
  ["Owner.com", ownerLogo, "tile"],
  ["Pendo", pendoLogo, "glyph"],
  ["ByteDance", bytedanceLogo, "glyph"],
  ["Blackstone", blackstoneLogo, "tile"],
  ["Moody's", moodysLogo, "tile"],
  ["Shortcut", shortcutLogo, "tile"],
  ["Oracle", oracleLogo, "glyph"],
  ["Render", renderLogo, "glyph"],
  ["Tencent", tencentLogo, "glyph"],
  ["Gusto", gustoLogo, "tile"],
  ["Simile", simileLogo, "glyph"],
  ["Browserbase", browserbaseLogo, "tile"],
  ["Kernel", kernelLogo, "tile"],
  ["Customer.io", customerIoLogo, "tile"],
  ["Statsig", statsigLogo, "glyph"],
  ["Zoox", zooxLogo, "tile"],
  ["Stitch Fix", stitchFixLogo, "glyph"],
  ["Just Eat Takeaway", justEatTakeawayLogo, "glyph"],
] as const;

type CompanyProofEntry = (typeof COMPANY_PROOF)[number];

const COMPANY_PROOF_ROWS = [
  COMPANY_PROOF.filter((_, index) => index % 2 === 0),
  COMPANY_PROOF.filter((_, index) => index % 2 === 1),
];

function CompanyProofLogos({
  companies,
  duplicate = false,
}: {
  companies: readonly CompanyProofEntry[];
  duplicate?: boolean;
}) {
  return (
    <ul className="company-proof-logos" aria-hidden={duplicate || undefined}>
      {companies.map(([name, logo, kind]) => (
        <li key={name} className="company-proof-company">
          <img
            src={logo}
            alt={duplicate ? "" : name}
            width={20}
            height={20}
            className={kind === "tile" ? "company-proof-tile" : undefined}
          />
          <span aria-hidden="true">{name}</span>
        </li>
      ))}
    </ul>
  );
}

function CompanyProofMarquee({
  companies,
  reverse,
}: {
  companies: readonly CompanyProofEntry[];
  reverse: boolean;
}) {
  const [copies, setCopies] = useState(5);
  const marqueeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marquee = marqueeRef.current;
    const firstCopy = marquee?.querySelector(".company-proof-logos");
    if (!marquee || !firstCopy) return;

    const measure = () => {
      const copyWidth = firstCopy.getBoundingClientRect().width;
      if (copyWidth === 0) return;
      setCopies(Math.max(2, Math.ceil(marquee.clientWidth / copyWidth) + 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(marquee);
    observer.observe(firstCopy);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="company-proof-marquee" ref={marqueeRef}>
      <div
        className={`company-proof-track${reverse ? " is-reverse" : ""}`}
        style={
          {
            "--company-proof-copies": copies,
            "--company-proof-logos": companies.length,
          } as CSSProperties
        }
      >
        <CompanyProofLogos companies={companies} />
        {Array.from({ length: copies - 1 }, (_, i) => (
          <CompanyProofLogos key={i} companies={companies} duplicate />
        ))}
      </div>
    </div>
  );
}

const [LATEST_RELEASE] = parseChangelog(changelogMd);
if (!LATEST_RELEASE) {
  throw new Error("CHANGELOG.md must contain at least one release");
}
const LATEST_RELEASE_META = RELEASE_META[LATEST_RELEASE.version];
if (!LATEST_RELEASE_META) {
  throw new Error(
    `Latest release ${LATEST_RELEASE.version} must have presentation metadata`,
  );
}
const LATEST_RELEASE_URL = `/changelog#${LATEST_RELEASE.version.replaceAll(".", "-")}`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      ...unfurlMeta("bb", OG_DESCRIPTION, "/"),
    ],
    links: siteHeadLinks(),
  }),
  component: LandingRoute,
});

function LandingRoute() {
  useInitAnalytics();
  return <LandingPage />;
}

function useConstructMock() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const mock = document.querySelector("[data-construct]");
    if (!mock || mock.classList.contains("constructed")) {
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target;
            el.classList.add("constructing");
            observer.unobserve(el);
            timer = window.setTimeout(() => {
              el.classList.remove("constructing");
              el.classList.add("constructed");
            }, 1800);
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(mock);
    return () => {
      observer.disconnect();
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);
}

function useFitMock() {
  useEffect(() => {
    const mock = document.querySelector<HTMLElement>(".mock");
    const wrap = mock?.parentElement;
    if (!mock || !wrap) {
      return;
    }
    const fit = () => {
      const wrapStyle = getComputedStyle(wrap);
      const visibleWidth = Number.parseFloat(
        getComputedStyle(mock).getPropertyValue("--mock-visible-width"),
      );
      if (!visibleWidth) {
        mock.style.removeProperty("--mock-scale");
        return;
      }
      const slice =
        wrap.clientWidth -
        Number.parseFloat(wrapStyle.paddingLeft) -
        Number.parseFloat(wrapStyle.paddingRight);
      mock.style.setProperty("--mock-scale", String(slice / visibleWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
}

type IconProps = { className?: string };

const PanelIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarLeftIcon} className={className} />
);
const PanelRightIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarRightIcon} className={className} />
);
const ChevronLeft = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowLeft01Icon} className={className} />
);
const ChevronRight = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowRight01Icon} className={className} />
);
const ChevronDown = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowDown01Icon} className={className} />
);
const Ellipsis = ({ className }: IconProps) => (
  <HugeiconsIcon icon={MoreHorizontalIcon} className={className} />
);
const NewThreadIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={BubbleChatAddIcon} className={className} />
);
const ClockIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Clock01Icon} className={className} />
);
const GearIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Settings01Icon} className={className} />
);
const CheckIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Tick02Icon} className={className} />
);
const CircleCheckIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={CheckmarkCircle02Icon} className={className} />
);
const MessageQuestionGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={MessageQuestionIcon} className={className} />
);
const PaperPlane = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SentIcon} className={className} />
);
const Paperclip = ({ className }: IconProps) => (
  <HugeiconsIcon icon={AttachmentIcon} className={className} />
);
const FolderIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiFolderIcon} className={className} />
);
const FolderGitIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={FolderGitTwoIcon} className={className} />
);
const GitBranchIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiGitBranchIcon} className={className} />
);
const GitMergeIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiGitMergeIcon} className={className} />
);
const Spinner = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Loading03Icon} className={className} />
);
const Maximize2 = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowExpand01Icon} className={className} />
);
const MicIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Mic02Icon} className={className} />
);
const SendIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowMoveDownLeftIcon} className={className} />
);
const LaptopGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiLaptopIcon} className={className} />
);
const FileDiffIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={PlusMinusSquare01Icon} className={className} />
);

type Status = "running" | "done" | "waiting";
type Step =
  | { kind: "user"; text: string }
  | { kind: "step"; text: ReactNode }
  | { kind: "say"; text: ReactNode }
  | { kind: "spawn"; text: ReactNode; child: MockThread };
type Ask = {
  question: string;
  options: { label: string; description: string }[];
  selected: number;
};
type MockThread = {
  id: string;
  title: string;
  status: Status;
  branch: string;
  pr?: number;
  change: { files: number; add: number; del: number };
  transcript: Step[];
  stream?: Step[];
  ask?: Ask;
};

const SENTRY_SUBAGENT: MockThread = {
  id: "sentry-sub",
  title: "Reproduce the null cart",
  status: "running",
  branch: "bb/triage-sentry-spike",
  change: { files: 1, add: 14, del: 0 },
  transcript: [
    { kind: "user", text: "Reproduce the null cart in applyPromo." },
    { kind: "step", text: "Read src/checkout/applyPromo.ts" },
  ],
  stream: [
    { kind: "step", text: "Built an empty-cart fixture" },
    {
      kind: "say",
      text: (
        <>
          An active promo on an empty <code>cart</code> throws. Reproduced.
        </>
      ),
    },
    { kind: "step", text: "Wrote a failing test" },
    { kind: "say", text: "Handed the repro back to the parent thread." },
    { kind: "step", text: "Re-checked the stack trace" },
  ],
};

const SENTRY_STREAM: Step[] = [
  { kind: "step", text: "Ran 48 tests" },
  {
    kind: "say",
    text: (
      <>
        All green. The null <code>cart</code> path is covered now.
      </>
    ),
  },
  {
    kind: "spawn",
    text: (
      <>
        Spawned a subagent: <strong>Reproduce the null cart</strong>
      </>
    ),
    child: SENTRY_SUBAGENT,
  },
  { kind: "step", text: "Edited promo.test.ts" },
  { kind: "say", text: "Added a case for an empty cart with an active promo." },
  { kind: "step", text: "Checked Sentry for new events" },
  { kind: "say", text: "No new occurrences in the last 10 minutes." },
  { kind: "step", text: "Read applyPromo.ts" },
  {
    kind: "say",
    text: (
      <>
        Tightening the type so <code>cart</code> can't be null at the call site.
      </>
    ),
  },
  { kind: "step", text: "Edited 2 files" },
  {
    kind: "say",
    text: "Pushed the guard and a follow-up. Re-running the suite.",
  },
];

const LIN482_STREAM: Step[] = [
  { kind: "step", text: "Ran 12 tests" },
  { kind: "say", text: "Debounce holds for 200ms. One call, asserted." },
  {
    kind: "step",
    text: (
      <>
        Edited <code>SearchBar.tsx</code>
      </>
    ),
  },
  { kind: "say", text: "Cancelling the timer on unmount so there's no leak." },
  { kind: "step", text: "Checked the other call sites" },
  {
    kind: "say",
    text: "Two more inputs could reuse this. Noted it on LIN-482.",
  },
  { kind: "step", text: "Edited 1 file" },
  { kind: "say", text: "Verifying the debounce once more." },
];

const CHIEF_STREAM: Step[] = [
  { kind: "step", text: "Swept 4 active threads" },
  {
    kind: "say",
    text: "Sentry triage is re-running tests; LIN-482 is verifying.",
  },
  { kind: "step", text: "Checked for blockers" },
  {
    kind: "say",
    text: (
      <>
        One thread is waiting on you: <code>Refactor the timeline cache</code>.
      </>
    ),
  },
  { kind: "step", text: "Spawned 1 worker" },
  {
    kind: "say",
    text: "Dispatched the changelog follow-up. Nothing else needs you.",
  },
];

const HERO_THREADS: MockThread[] = [
  {
    id: "sentry",
    title: "Triage the Sentry spike",
    status: "running",
    branch: "bb/triage-sentry-spike",
    change: { files: 6, add: 124, del: 18 },
    stream: SENTRY_STREAM,
    transcript: [
      { kind: "user", text: "Triage the Sentry spike on checkout." },
      { kind: "step", text: "Explored 4 files" },
      {
        kind: "say",
        text: (
          <>
            The spike is one error. 92% of volume: a null <code>cart</code> in{" "}
            <code>applyPromo</code>.
          </>
        ),
      },
      { kind: "step", text: "Edited 2 files" },
      {
        kind: "say",
        text: (
          <>
            Guarded the null case and added a regression test in{" "}
            <code>promo.test.ts</code>. Re-running the suite.
          </>
        ),
      },
    ],
  },
  {
    id: "changelog",
    title: "Nightly changelog",
    status: "done",
    branch: "bb/nightly-changelog",
    pr: 418,
    change: { files: 1, add: 96, del: 4 },
    transcript: [
      { kind: "step", text: "Explored 14 commits" },
      {
        kind: "say",
        text: "14 user-facing commits since yesterday. Grouped them by area.",
      },
      { kind: "step", text: "Edited 1 file" },
      {
        kind: "say",
        text: (
          <>
            Wrote <code>CHANGELOG.md</code> and opened PR #418.
          </>
        ),
      },
    ],
  },
  {
    id: "timeline",
    title: "Refactor the timeline cache",
    status: "waiting",
    branch: "bb/timeline-cache",
    change: { files: 3, add: 41, del: 67 },
    transcript: [
      {
        kind: "user",
        text: "Refactor the timeline cache to drop the duplicate fetch.",
      },
      { kind: "step", text: "Explored 3 files" },
      { kind: "say", text: "Found the duplicate fetch. Two ways to fix it." },
    ],
    ask: {
      question: "How should I dedupe the timeline fetch?",
      options: [
        {
          label: "Shared in-flight promise",
          description: "One request in flight; everyone awaits it. Simplest.",
        },
        {
          label: "Short TTL cache",
          description: "Cache the result for a few seconds, then refetch.",
        },
      ],
      selected: 0,
    },
  },
  {
    id: "lin482",
    title: "Start on LIN-482",
    status: "running",
    branch: "bb/lin-482-debounce-search",
    change: { files: 2, add: 33, del: 5 },
    stream: LIN482_STREAM,
    transcript: [
      { kind: "step", text: "Read LIN-482" },
      {
        kind: "say",
        text: (
          <>
            “Debounce the search input.” Adding a 200ms debounce in{" "}
            <code>SearchBar</code>.
          </>
        ),
      },
      { kind: "step", text: "Edited 1 file" },
      { kind: "say", text: "Added the debounce and a test. Verifying." },
    ],
  },
];

const CHIEF: MockThread = {
  id: "chief",
  title: "Chief",
  status: "running",
  branch: "bb/chief",
  change: { files: 1, add: 12, del: 0 },
  stream: CHIEF_STREAM,
  transcript: [
    { kind: "user", text: "Anything need me?" },
    { kind: "step", text: "Swept 4 active threads" },
    {
      kind: "say",
      text: (
        <>
          One thread is waiting on you: <code>Refactor the timeline cache</code>
          . Sentry triage and LIN-482 are running; the nightly changelog merged.
        </>
      ),
    },
    { kind: "step", text: "Spawned 2 workers" },
    {
      kind: "say",
      text: "I'll keep dispatching and ping you when something needs a call.",
    },
  ],
};

function ThreadStatus({ status }: { status: Status }) {
  return (
    <span className="tstatus" aria-hidden>
      {status === "running" ? <Spinner className="trun" /> : null}
      {status === "done" ? <CircleCheckIcon className="tdone" /> : null}
      {status === "waiting" ? <MessageQuestionGlyph className="twait" /> : null}
    </span>
  );
}

const STREAM_INTERVAL_MS = 1600;
const STREAM_WINDOW = 16;

type FeedItem = { id: string; step: Step; live: boolean };

function ThreadFeed({
  thread,
  onSpawn,
}: {
  thread: MockThread;
  onSpawn: (parentId: string, child: MockThread) => void;
}) {
  const isLive =
    thread.status === "running" && (thread.stream?.length ?? 0) > 0;
  const seedItems = useMemo<FeedItem[]>(
    () =>
      thread.transcript.map((step, i) => ({
        id: `seed-${i}`,
        step,
        live: false,
      })),
    [thread.transcript],
  );
  const [items, setItems] = useState<FeedItem[]>(seedItems);

  useEffect(() => {
    if (!isLive) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const pool = thread.stream ?? [];
    let cursor = 0;
    let serial = 0;
    const id = window.setInterval(() => {
      const step = pool[cursor % pool.length];
      cursor += 1;
      serial += 1;
      if (step.kind === "spawn") {
        onSpawn(thread.id, step.child);
      }
      setItems((prev) => {
        const next = [...prev, { id: `live-${serial}`, step, live: true }];
        return next.length > STREAM_WINDOW
          ? next.slice(next.length - STREAM_WINDOW)
          : next;
      });
    }, STREAM_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [thread.id, isLive, thread.stream, onSpawn]);

  return (
    <div className={isLive ? "feed feed-live" : "feed"}>
      {items.map(({ id, step, live }, index) => {
        const style: CSSProperties = live
          ? { animation: "c-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both" }
          : { animationDelay: `${0.66 + index * 0.09}s` };
        if (step.kind === "user") {
          return (
            <div key={id} className="msg-user" style={style}>
              {step.text}
            </div>
          );
        }
        if (step.kind === "step") {
          return (
            <div key={id} className="msg-step" style={style}>
              <ChevronRight className="step-chev" />
              {step.text}
            </div>
          );
        }
        if (step.kind === "spawn") {
          return (
            <div key={id} className="msg-step msg-spawn" style={style}>
              <GitBranchIcon className="step-chev" />
              {step.text}
            </div>
          );
        }
        return (
          <div key={id} className="msg-say" style={style}>
            {step.text}
          </div>
        );
      })}
    </div>
  );
}

function AskQuestion({ ask }: { ask: Ask }) {
  const [selected, setSelected] = useState(ask.selected);
  return (
    <div className="composer">
      <div className="askq">
        <div className="askq-q">{ask.question}</div>
        <div className="askq-opts">
          {ask.options.map((opt, i) => (
            <button
              key={opt.label}
              type="button"
              className={i === selected ? "askq-opt on" : "askq-opt"}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
            >
              <span className="askq-radio">
                {i === selected ? <CheckIcon className="askq-check" /> : null}
              </span>
              <span className="askq-text">
                <span className="askq-label">{opt.label}</span>
                <span className="askq-desc">{opt.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="askq-actions">
          <span className="askq-cancel">Cancel</span>
          <span className="askq-submit">Submit answer</span>
        </div>
      </div>
    </div>
  );
}

type DiffLine = { t: "ctx" | "add" | "del"; text: string };
const DIFF_LINES: DiffLine[] = [
  { t: "ctx", text: 'it("applies a valid promo", () => {' },
  { t: "ctx", text: "  const cart = makeCart([item]);" },
  { t: "del", text: '  expect(applyPromo(cart, "SAVE10"))' },
  { t: "add", text: '  expect(applyPromo(cart, "SAVE10").total)' },
  { t: "add", text: "    .toBeCloseTo(8.99);" },
  { t: "ctx", text: "});" },
  { t: "ctx", text: "" },
  { t: "add", text: 'it("ignores a null cart", () => {' },
  { t: "add", text: '  expect(() => applyPromo(null, "SAVE10"))' },
  { t: "add", text: "    .not.toThrow();" },
  { t: "add", text: "});" },
];

function Composer({ thread }: { thread?: MockThread }) {
  const isNew = !thread;
  return (
    <div className={isNew ? "composer composer-new" : "composer"}>
      {thread ? (
        <div className="pr-bar">
          <GitMergeIcon className="pr-ic" />
          <span className="pr-strong">
            {thread.pr ? `PR #${thread.pr}` : "Working tree"}
          </span>
          <span className="pr-dim">
            · {thread.pr ? "Merged" : "Uncommitted"} · {thread.change.files}{" "}
            {thread.change.files === 1 ? "file" : "files"},
          </span>
          <span className="pr-add">+{thread.change.add}</span>
          <span className="pr-del">-{thread.change.del}</span>
          <ChevronDown className="pr-ic pr-chev" />
        </div>
      ) : null}
      <div className="composer-box">
        <div className="composer-top">
          <textarea
            className="composer-input"
            rows={1}
            placeholder={
              isNew
                ? "Ask anything. @ to mention files or folders"
                : "Ask for a follow-up. @ to mention files, folders, sections, or threads"
            }
            aria-label={isNew ? "Start a new thread" : "Message this thread"}
          />
          <Maximize2 className="cb-expand" />
        </div>
        <div className="composer-row">
          <span className="model">
            <ClaudeIcon className="model-ic" />
            Opus 4.8 1M
            <ChevronDown className="chev-sm" />
          </span>
          <span className="composer-actions" aria-hidden>
            <Paperclip className="composer-clip" />
            <MicIcon className="composer-clip" />
            <span className="send-btn">
              <SendIcon className="send-ic" />
            </span>
          </span>
        </div>
      </div>
      <div className="context-row">
        <span className="ctx">
          <FolderIcon className="ctx-ic" />
          <span>{isNew ? "paper-ultra-slop" : "bb"}</span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx">
          {isNew ? (
            <LaptopGlyph className="ctx-ic" />
          ) : (
            <FolderGitIcon className="ctx-ic" />
          )}
          <span>{isNew ? "Work locally" : "Worktree"}</span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx">
          <GitBranchIcon className="ctx-ic" />
          <span className="ctx-branch">
            {isNew ? "Current (main)" : thread.branch}
          </span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx-perm">
          Full Access
          <ChevronDown className="ctx-chev" />
        </span>
        {thread && thread.status === "running" ? (
          <Spinner className="ctx-spin" />
        ) : null}
      </div>
    </div>
  );
}

function DiffPanel({
  thread,
  onClose,
}: {
  thread: MockThread;
  onClose: () => void;
}) {
  return (
    <aside className="diff-panel" aria-label="Changes">
      <div className="diff-head">
        <FileDiffIcon className="diff-ic" />
        <span className="diff-title">Changes</span>
        <span className="diff-stat pr-add">+{thread.change.add}</span>
        <span className="diff-stat pr-del">-{thread.change.del}</span>
        <button
          type="button"
          className="diff-close"
          aria-label="Hide changes"
          onClick={onClose}
        >
          <PanelRightIcon className="ri" />
        </button>
      </div>
      <div className="diff-file">
        <FolderGitIcon className="diff-file-ic" />
        promo.test.ts
      </div>
      <div className="diff-body">
        {DIFF_LINES.map((line, i) => (
          <div key={i} className={`dl dl-${line.t}`}>
            <span className="dl-sign">
              {line.t === "add" ? "+" : line.t === "del" ? "-" : " "}
            </span>
            <span className="dl-text">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function HeroAppMock() {
  const [activeId, setActiveId] = useState(HERO_THREADS[0].id);
  const [view, setView] = useState<"thread" | "new">("thread");
  const [diffOpen, setDiffOpen] = useState(false);
  const [spawned, setSpawned] = useState<Record<string, MockThread[]>>({});
  const spawnedChildren = useMemo(
    () => Object.values(spawned).flat(),
    [spawned],
  );
  const thread =
    [CHIEF, ...HERO_THREADS, ...spawnedChildren].find(
      (candidate) => candidate.id === activeId,
    ) ?? HERO_THREADS[0];

  const openThread = (id: string) => {
    setActiveId(id);
    setView("thread");
  };

  const handleSpawn = useCallback((parentId: string, child: MockThread) => {
    setSpawned((prev) => {
      const kids = prev[parentId] ?? [];
      if (kids.some((existing) => existing.id === child.id)) {
        return prev;
      }
      return { ...prev, [parentId]: [...kids, child] };
    });
  }, []);

  return (
    <section className="mockup-wrap">
      <div
        className="mock"
        data-construct
        aria-label="Interactive preview of the bb app"
      >
        <div className="mock-bar">
          <div className="bar-left">
            <span className="mock-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="bar-menu" aria-hidden>
              <PanelIcon className="ri bar-ic" />
            </span>
            <span className="bar-nav" aria-hidden>
              <ChevronLeft className="ri" />
              <ChevronRight className="ri" />
            </span>
          </div>
          <div className="bar-main">
            {view === "thread" ? (
              <>
                <span className="bar-title">{thread.title}</span>
                <Ellipsis className="ri bar-kebab" />
                <span className="bar-actions">
                  <span className="editor-btn" aria-hidden>
                    <img src={vscodeIcon} alt="" className="editor-ic" />
                    <ChevronDown className="chev-xs" />
                  </span>
                  <span className="commit-btn" aria-hidden>
                    Commit
                  </span>
                  <button
                    type="button"
                    className={diffOpen ? "bar-toggle active" : "bar-toggle"}
                    aria-label={diffOpen ? "Hide changes" : "Show changes"}
                    aria-pressed={diffOpen}
                    onClick={() => setDiffOpen((open) => !open)}
                  >
                    <PanelRightIcon className="ri" />
                  </button>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="mock-body">
          <aside className="side">
            <button
              type="button"
              className={view === "new" ? "side-act active-act" : "side-act"}
              aria-pressed={view === "new"}
              onClick={() => setView("new")}
            >
              <NewThreadIcon className="sa-ic" />
              New thread
            </button>
            <div className="side-act">
              <ClockIcon className="sa-ic" />
              Automations
            </div>
            <div className="side-label">Pinned</div>
            <button
              type="button"
              className={
                view === "thread" && activeId === "chief"
                  ? "trow trow-pin active"
                  : "trow trow-pin"
              }
              aria-pressed={view === "thread" && activeId === "chief"}
              onClick={() => openThread("chief")}
            >
              <span className="trow-title">Chief</span>
            </button>
            <div className="side-label">All Threads</div>
            <ul className="threads">
              {HERO_THREADS.map((candidate, index) => {
                const isActive = view === "thread" && candidate.id === activeId;
                const kids = spawned[candidate.id] ?? [];
                return (
                  <li
                    key={candidate.id}
                    style={{ animationDelay: `${0.6 + index * 0.06}s` }}
                  >
                    <button
                      type="button"
                      className={isActive ? "trow active" : "trow"}
                      aria-pressed={isActive}
                      onClick={() => openThread(candidate.id)}
                    >
                      <span className="trow-title">{candidate.title}</span>
                      <ThreadStatus status={candidate.status} />
                    </button>
                    {kids.length > 0 ? (
                      <ul className="threads thread-kids">
                        {kids.map((kid) => {
                          const kidActive =
                            view === "thread" && kid.id === activeId;
                          return (
                            <li key={kid.id} className="kid-li">
                              <button
                                type="button"
                                className={
                                  kidActive
                                    ? "trow trow-kid active"
                                    : "trow trow-kid"
                                }
                                aria-pressed={kidActive}
                                onClick={() => openThread(kid.id)}
                              >
                                <span className="trow-title">{kid.title}</span>
                                <ThreadStatus status={kid.status} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="side-foot" aria-hidden>
              <GearIcon className="sa-ic" />
            </div>
          </aside>

          {view === "thread" ? (
            <div className="main">
              <ThreadFeed
                key={thread.id}
                thread={thread}
                onSpawn={handleSpawn}
              />
              {thread.ask ? (
                <AskQuestion ask={thread.ask} />
              ) : (
                <Composer thread={thread} />
              )}
            </div>
          ) : (
            <div className="main main-new">
              <Composer />
            </div>
          )}

          {view === "thread" && diffOpen ? (
            <DiffPanel thread={thread} onClose={() => setDiffOpen(false)} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AgentChat() {
  const { cycle, leaving } = useCycle(6000, 600);
  return (
    <div
      className="tg"
      aria-label="Texting the Crunch bot, which spawns a bb thread"
    >
      <div className="tg-bar">
        <ChevronLeft className="tg-back" />
        <span className="tg-contact">
          <span className="tg-name">Sawyer&rsquo;s Hermes</span>
          <span className="tg-sub">bot</span>
        </span>
        <span className="tg-av" aria-hidden>
          <img src={hermesAvatar} alt="" />
        </span>
      </div>
      <div className="tg-feed">
        <div className={leaving ? "tg-msgs leaving" : "tg-msgs"} key={cycle}>
          <div className="tg-msg tg-out" style={{ animationDelay: "0.3s" }}>
            <span className="tg-bubble">
              spawn a thread to fix the failing CI on main
              <span className="tg-time">9:41</span>
            </span>
          </div>
          <div className="tg-msg tg-in" style={{ animationDelay: "1.4s" }}>
            <span className="tg-bubble">
              On it. Spawning a worker thread.
              <span className="tg-cmd mono">bb spawn "fix CI on main"</span>
            </span>
          </div>
          <div className="tg-msg tg-in" style={{ animationDelay: "2.4s" }}>
            <div className="tg-thread">
              <div className="tg-thread-top">
                <span aria-hidden="true" className="bb-mark tg-thread-mark" />
                <span className="tg-thread-eyebrow">Worker thread</span>
                <span className="tg-stat" aria-hidden>
                  <span
                    className="tg-stat-spawn"
                    style={{ animationDelay: "3.5s" }}
                  >
                    <Spinner className="tg-spin" />
                    spawning
                  </span>
                  <span
                    className="tg-stat-run"
                    style={{ animationDelay: "3.5s" }}
                  >
                    <span className="tg-rdot" />
                    running
                  </span>
                </span>
              </div>
              <div className="tg-thread-title">Fix CI on main</div>
              <div className="tg-thread-branch mono">bb/fix-ci-on-main</div>
            </div>
          </div>
        </div>
      </div>
      <div className="tg-input">
        <Paperclip className="tg-attach" />
        <span className="tg-field">Message</span>
        <span className="tg-send" aria-hidden>
          <PaperPlane className="tg-send-ic" />
        </span>
      </div>
    </div>
  );
}

function LandingPage() {
  const [companyProofPaused, setCompanyProofPaused] = useState(false);
  const [companyProofInView, setCompanyProofInView] = useState(false);
  const companyProofRef = useRef<HTMLElement>(null);
  useScrollReveal();
  useConstructMock();
  useFitMock();

  useEffect(() => {
    const companyProof = companyProofRef.current;
    if (!companyProof) return;

    const observer = new IntersectionObserver(([entry]) => {
      setCompanyProofInView(entry?.isIntersecting ?? false);
    });
    observer.observe(companyProof);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="wrap">
      <SiteNav />

      <header className="hero">
        <a className="updates-callout" href={LATEST_RELEASE_URL}>
          <span className="updates-label">New</span>
          <span className="updates-title">{LATEST_RELEASE_META.headline}</span>
          <ChevronRight className="updates-arrow" />
        </a>
        <h1>The IDE that builds itself</h1>
        <p className="sub">
          bb can control, customize, and automate itself, laying the groundwork
          for your own software factory.
        </p>

        <InstallOptions placement="hero" />

        <div className="providers">
          <span className="label">Works with</span>
          <ProviderChips />
        </div>
      </header>

      <HeroAppMock />

      <section
        ref={companyProofRef}
        className={`company-proof${companyProofPaused ? " is-paused" : ""}${companyProofInView ? "" : " is-offscreen"}`}
        aria-labelledby="company-proof-title"
      >
        <div className="company-proof-heading">
          <h2 id="company-proof-title">Used by builders at</h2>
          <button
            type="button"
            className="company-proof-toggle"
            aria-label={
              companyProofPaused
                ? "Resume company logos"
                : "Pause company logos"
            }
            onClick={() => setCompanyProofPaused((paused) => !paused)}
          >
            <HugeiconsIcon
              icon={companyProofPaused ? PlayIcon : PauseIcon}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="company-proof-rows">
          {COMPANY_PROOF_ROWS.map((companies, index) => (
            <CompanyProofMarquee
              key={index}
              companies={companies}
              reverse={index === 1}
            />
          ))}
        </div>
      </section>

      <Band title="Fully customizable." flip visual={<CustomizeBuild />}>
        <p>
          Almost anything in bb can be changed in a single prompt. Ask for your
          Linear issues and they appear: a panel in your sidebar, a{" "}
          <code>bb linear</code> command, and a skill that teaches every agent
          to use it.
        </p>
        <p>
          Many of bb&rsquo;s own features are built with the same tools you
          have. The GitHub integration, agent memory, scheduled jobs, and even
          remote access are all plugins.
        </p>
        <p>Nothing is stopping you from building your ideal workbench.</p>
      </Band>

      <Band title="Anything can kick off work." visual={<AgentChat />}>
        <p>
          The same CLI your agents use is open to any program you write: a shell
          script, a cron job, or your own Hermes Agent or OpenClaw bot in
          Telegram, Signal, or Slack. Each can spawn a thread that&rsquo;s
          waiting in your sidebar when you are.
        </p>
        <p>
          It runs on your machine, and is waiting for you when you&rsquo;re
          back.
        </p>
      </Band>

      <Band title="The gang's all here" flip visual={<SpawnSidebar />}>
        <p>
          Claude Code, Codex, Cursor, Pi, OpenCode, Grok, omp, and Hermes all
          live in bb. Give a task to whichever fits, and have one agent spawn
          and manage another, each in its own thread.
        </p>
        <p>
          Each runs on your own subscription: the provider plan you already pay
          for, billed by them, not bb.
        </p>
        <div className="providers">
          <ProviderChips />
        </div>
      </Band>

      <section className="statement" data-reveal>
        <h2 className="sec-title">Fork it. Make it your own.</h2>
        <p>
          bb is MIT-licensed end to end. Fork the repo, customize the agents,
          tools, and UI, and deploy your own build across your whole
          organization. It still runs local-first on your machines, on the
          provider subscriptions you already pay for.
        </p>
        <div className="cta-row">
          <GitHubLink placement="local" className="btn btn-ghost">
            View the source →
          </GitHubLink>
        </div>
      </section>

      <section className="closer" data-reveal>
        <h2 className="sec-title">Put your agents to work.</h2>
        <p>Free, open source, and local-first. Install in under a minute.</p>
        <InstallOptions placement="closer" />
        <div className="cta-row cta-row-secondary">
          <GitHubLink placement="closer" className="btn btn-ghost">
            View on GitHub
          </GitHubLink>
        </div>
      </section>

      <SubscribeSection
        reveal
        blurb={
          <>Product updates and what we&rsquo;re building next. No spam.</>
        }
      />

      <SiteFooter />
    </div>
  );
}
