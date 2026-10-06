import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getImageSize } from "../blog/image-sizes";
import { LightboxImage } from "../blog/lightbox";
import { brandProse } from "../landing/prose";
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
        <span className="gd-dollar">$ </span>
        {command}
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

export function OutputBlock({ children }: { children: ReactNode }) {
  return (
    <div className="gd-code gd-output">
      <div className="gd-code-bar">
        <span className="gd-code-label">Output</span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Substeps({ children }: { children: ReactNode }) {
  return <ol className="gd-substeps">{brandProse(children)}</ol>;
}

export function Note({
  title,
  warn = false,
  children,
}: {
  title: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={warn ? "gd-note gd-note-warn" : "gd-note"}>
      <strong>{title}</strong> {brandProse(children)}
    </div>
  );
}

export function DoneWhen({ children }: { children: ReactNode }) {
  return (
    <div className="gd-check">
      <span className="cmp-mark cmp-mark-yes">
        <HugeiconsIcon icon={Tick02Icon} aria-hidden="true" />
      </span>
      <span>
        <strong>Done when</strong> {children}
      </span>
    </div>
  );
}

export interface Ring {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ProductShot({
  src,
  alt,
  caption,
  ring,
}: {
  src: string;
  alt: string;
  caption: ReactNode;
  ring: Ring | null;
}) {
  const size = getImageSize(src);
  return (
    <figure className="gd-shot">
      <div
        className="gd-shot-frame"
        style={size ? { maxWidth: `${size.width / 2}px` } : undefined}
      >
        <LightboxImage src={src} alt={alt} />
        {ring ? (
          <span
            className="gd-ring"
            aria-hidden="true"
            style={{
              left: `${ring.left}%`,
              top: `${ring.top}%`,
              width: `${ring.width}%`,
              height: `${ring.height}%`,
            }}
          />
        ) : null}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function MorePath({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="gd-more" id={id}>
      <summary>
        {title}
        <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden="true" />
      </summary>
      <div className="gd-more-body">{brandProse(children)}</div>
    </details>
  );
}

export function PromptCard({ prompt }: { prompt: string }) {
  return (
    <div className="gd-prompt-card">
      <q>{prompt}</q>
      <CodeCopy text={prompt} />
    </div>
  );
}
