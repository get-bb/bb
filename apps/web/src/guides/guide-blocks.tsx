import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LightboxImage } from "../blog/lightbox";
import { brandProse } from "../compare/compare-page";
import { trackLandingEvent } from "../landing/analytics";
import type { GuideShot } from "./guide-types";
import { copyPlainText } from "../lib/copy-plain-text";

export const PROMPT_COPIED = "Prompt copied. Paste it into a bb thread.";
const TEXT_COPIED = "Copied to clipboard";
const COPIED_MS = 1600;

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => {});

export function CopyToast({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announce = useCallback((next: string) => {
    clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div
        className={message ? "gd-toast show" : "gd-toast"}
        role="status"
        aria-live="polite"
      >
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useCopy(text: string, message: string) {
  const announce = useContext(AnnounceContext);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    if (!(await copyPlainText(text))) {
      return;
    }
    announce(message);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, [announce, message, text]);
  return { copied, copy };
}

function CodeCopy({ text }: { text: string }) {
  const { copied, copy } = useCopy(text, TEXT_COPIED);
  return (
    <button type="button" className="gd-code-copy" onClick={copy}>
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className="gd-ic"
      />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function joinContinuations(command: string): string {
  return command.replace(/\s*\\\n\s*/g, " ");
}

function splitCommands(command: string): string[] {
  return command.split(/(?<!\\)\n/);
}

const APP_ICONS = {
  settings: { icon: Settings01Icon, label: "Settings" },
  "side-panel": { icon: SidebarRightIcon, label: "Side panel" },
  plus: { icon: PlusSignIcon, label: "Add" },
  more: { icon: MoreHorizontalIcon, label: "More" },
  "send-options": { icon: ArrowDown01Icon, label: "Send options" },
  annotate: { icon: BubbleChatAddIcon, label: "Annotate elements" },
} satisfies Record<string, { icon: IconSvgElement; label: string }>;

export type AppIcon = keyof typeof APP_ICONS;

export function Ui({
  icon,
  children,
}: {
  icon: AppIcon;
  children?: ReactNode;
}) {
  const app = APP_ICONS[icon];
  return (
    <strong className="gd-ui">
      <span
        className="gd-ui-icon"
        role="img"
        aria-label={children ? undefined : app.label}
      >
        <HugeiconsIcon icon={app.icon} aria-hidden="true" />
      </span>
      {children ? <span>{children}</span> : null}
    </strong>
  );
}

interface GuidePrompt {
  guide: string;
  prompt: string;
}

export const GuidePromptContext = createContext<GuidePrompt>({
  guide: "",
  prompt: "",
});

export function CopyPromptButton() {
  const { guide, prompt } = useContext(GuidePromptContext);
  const { copied, copy } = useCopy(prompt, PROMPT_COPIED);
  return (
    <button
      type="button"
      className="gd-inline-copy"
      onClick={() => {
        copy();
        trackLandingEvent({
          name: "guide_prompt_copied",
          properties: { guide, placement: "step" },
        });
      }}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className="gd-ic"
      />
      {copied ? "Copied" : "Copy for agent"}
    </button>
  );
}

export function CommandBlock({
  label = "Terminal",
  command,
}: {
  label?: string;
  command: string;
}) {
  return (
    <div className="gd-code">
      <div className="gd-code-bar">
        <span className="gd-code-label">{label}</span>
        <CodeCopy text={joinContinuations(command)} />
      </div>
      <pre>
        {splitCommands(command).map((line, index) => (
          <Fragment key={index}>
            {index > 0 ? "\n" : null}
            <span className="gd-dollar">$ </span>
            {line}
          </Fragment>
        ))}
      </pre>
    </div>
  );
}

export function FileBlock({
  name,
  contents,
}: {
  name: string;
  contents: string;
}) {
  return (
    <div className="gd-code">
      <div className="gd-code-bar">
        <span className="gd-code-label">{name}</span>
        <CodeCopy text={contents} />
      </div>
      <pre>{contents}</pre>
    </div>
  );
}

export function PromptBlock({
  name,
  prompt,
}: {
  name: string;
  prompt: string;
}) {
  return (
    <div className="gd-code gd-code-prompt">
      <div className="gd-code-bar">
        <span className="gd-code-label">{name}</span>
        <CodeCopy text={prompt} />
      </div>
      <pre>{prompt}</pre>
    </div>
  );
}

export function Substeps({ children }: { children: ReactNode }) {
  return <ol className="gd-substeps">{brandProse(children)}</ol>;
}

export function ProductShot({ shot }: { shot: GuideShot }) {
  const image = (
    <LightboxImage
      src={shot.src}
      alt={shot.alt}
      size={{ width: shot.width, height: shot.height }}
    />
  );
  if (shot.height > shot.width) {
    return (
      <figure className="gd-shot gd-shot-phone">
        <div className="cmp-phone">
          <div className="cmp-phone-screen">{image}</div>
        </div>
      </figure>
    );
  }
  return (
    <figure className="gd-shot gd-shot-wide">
      <div
        className="gd-shot-frame"
        style={{ maxWidth: `${shot.width / 2}px` }}
      >
        {image}
      </div>
    </figure>
  );
}

export function BulletList({ children }: { children: ReactNode }) {
  return <ul className="gd-list">{brandProse(children)}</ul>;
}
