import { useEffect, useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import { MAX_PER_ACCOUNT } from "@bb/connect-db";
import type { HandleValidationError, LabelAvailability } from "@bb/connect-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { checkAvailabilityFn } from "@/server/fns";

function BrandRow({ title, tagline }: { title: string; tagline: string }) {
  return (
    <div className="mb-[18px] flex items-center gap-2.5">
      {}
      <span
        role="img"
        aria-label="bb"
        className="bb-mark h-[30px] w-[30px] rounded-lg"
      />
      <div className="leading-tight">
        <b className="block text-sm font-semibold">{title}</b>
        <span className="text-xs text-muted-foreground">{tagline}</span>
      </div>
    </div>
  );
}

const SHELL_WIDTH = {
  sm: "max-w-[430px]",
  md: "max-w-[480px]",
} as const;

export function Shell({
  children,
  footer,
  top = false,
  width = "sm",
  title = "bb connect",
  tagline = "Your bb, reachable anywhere",
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  top?: boolean;
  width?: keyof typeof SHELL_WIDTH;
  title?: string;
  tagline?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-dvh w-full flex-col px-6 pb-24",
        top ? "justify-start pt-14" : "justify-center pt-16",
      )}
    >
      <div className={cn("mx-auto w-full", SHELL_WIDTH[width])}>
        <BrandRow title={title} tagline={tagline} />
        {children}
        {footer}
      </div>
    </main>
  );
}

export function WebCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 sm:p-[22px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-subtle-foreground" />
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive-text">
      {children}
    </p>
  );
}

export function GithubMark() {
  return <HugeiconsIcon icon={GithubIcon} className="size-4" aria-hidden />;
}

function grammarCopy(err: HandleValidationError): string {
  switch (err) {
    case "too-short":
      return "At least 3 characters.";
    case "too-long":
      return "At most 30 characters.";
    case "reserved":
      return "That name is reserved. Pick another.";
    default:
      return "Lowercase letters, numbers, and dashes only.";
  }
}

function availabilityCopy(a: LabelAvailability): string | null {
  if (a.available) return null;
  if (a.reason === "taken")
    return "That address is already taken. Pick another.";
  return grammarCopy(a.error);
}

export function claimErrorCopy(err: string, max: number): string {
  switch (err) {
    case "already-claimed":
      return "You've already claimed an address on this account.";
    case "server-limit":
      return `You've reached the limit of ${max} bbs. Disconnect one to add another.`;
    case "taken":
      return "That address is already taken. Pick another.";
    case "no-handle":
      return "Claim your account address first.";
    case "too-short":
    case "too-long":
    case "reserved":
    case "invalid-format":
      return grammarCopy(err);
    default:
      return "Could not claim that address. Try another.";
  }
}

async function signInWithGithub(callbackURL: string) {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  if (data.url) window.location.href = data.url;
}

type EmailAuthMode = "sign-in" | "sign-up";

function authResponseMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("message" in value) || typeof value.message !== "string") return null;
  return value.message;
}

async function authenticateWithEmail(input: {
  email: string;
  mode: EmailAuthMode;
  name: string;
  password: string;
}): Promise<string | null> {
  const body =
    input.mode === "sign-up"
      ? { email: input.email, name: input.name, password: input.password }
      : { email: input.email, password: input.password };
  const response = await fetch(`/api/auth/${input.mode}/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody: unknown = await response.json().catch(() => null);
  if (response.ok) return null;
  return authResponseMessage(responseBody) ?? "Could not authenticate";
}

export function SignInView({
  emailPasswordEnabled,
  destination,
  title,
  tagline,
  description = "Give your bb a private URL and open it from any browser. Your code and data never leave your machine.",
}: {
  emailPasswordEnabled: boolean;
  destination: () => string;
  title?: string;
  tagline?: string;
  description?: string;
}) {
  const [mode, setMode] = useState<EmailAuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (mode === "sign-up" && !trimmedName) {
      setError("Enter your name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const authError = await authenticateWithEmail({
        email: email.trim(),
        mode,
        name: trimmedName,
        password,
      });
      if (authError) {
        setError(authError);
        return;
      }
      window.location.href = destination();
    } catch {
      setError("Could not reach the authentication service");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell title={title} tagline={tagline}>
      <WebCard>
        <h3 className="text-[17px] font-semibold tracking-tight">Sign in</h3>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">{description}</p>
        {emailPasswordEnabled ? (
          <>
            <form
              className="space-y-3"
              onSubmit={(event) => void submitEmail(event)}
            >
              {mode === "sign-up" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "sign-up" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  minLength={8}
                  required
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                className="w-full justify-center py-[11px]"
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? "Working…"
                  : mode === "sign-up"
                    ? "Create local account"
                    : "Sign in with email"}
              </Button>
            </form>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {mode === "sign-in"
                ? "New to this local Cloud?"
                : "Already registered?"}{" "}
              <button
                className="font-medium text-foreground underline-offset-2 hover:underline"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError(null);
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                }}
              >
                {mode === "sign-in" ? "Create an account" : "Sign in"}
              </button>
            </p>
            <div className="my-4 flex items-center gap-3 text-xs text-subtle-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}
        <Button
          className="w-full justify-center py-[11px]"
          type="button"
          onClick={() => void signInWithGithub(destination())}
        >
          <GithubMark />
          Continue with GitHub
        </Button>
        <p className="mt-3 text-center text-xs text-subtle-foreground">
          Up to {MAX_PER_ACCOUNT} servers per account
        </p>
      </WebCard>
    </Shell>
  );
}

export function ClaimField({
  serverUrlTemplate,
  initial = "",
  autoFocus,
  previewLead = "Your bb will live at",
  buildSubmitLabel,
  onClaim,
  onCancel,
  cancelLabel = "Cancel",
  layout,
}: {
  serverUrlTemplate: string;
  initial?: string;
  autoFocus?: boolean;
  previewLead?: string;
  buildSubmitLabel: (label: string) => string;
  onClaim: (label: string) => Promise<string | null>;
  onCancel?: () => void;
  cancelLabel?: string;
  layout: "card" | "dialog";
}) {
  const [value, setValue] = useState(initial);
  const [avail, setAvail] = useState<LabelAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const label = value.trim().toLowerCase();

  useEffect(() => {
    setSubmitError(null);
    if (!label) {
      setAvail(null);
      return;
    }
    let cancelled = false;
    setAvail(null);
    const t = setTimeout(() => {
      void checkAvailabilityFn({ data: label }).then((r) => {
        if (cancelled) return;
        setAvail("available" in r ? r : null);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [label]);

  const error = submitError ?? (avail ? availabilityCopy(avail) : null);
  const canSubmit = !busy && !!label && (avail?.available ?? false);
  const preview = serverUrlTemplate.replace("{label}", label || "you");
  const addressSuffix = serverUrlTemplate.split("{label}")[1] ?? "";

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    const err = await onClaim(label);
    setBusy(false);
    if (err) setSubmitError(err);
  }

  const submitButton = (
    <Button
      disabled={!canSubmit}
      onClick={() => void submit()}
      className={
        layout === "card" ? "w-full justify-center py-[11px]" : undefined
      }
    >
      {busy ? "Claiming…" : buildSubmitLabel(label)}
    </Button>
  );

  return (
    <div>
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card focus-within:ring-1 focus-within:ring-ring">
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          value={value}
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm outline-none placeholder:text-subtle-foreground"
          placeholder="your-bb"
          aria-label="Address"
        />
        <span className="pr-3 font-mono text-sm text-subtle-foreground">
          {addressSuffix}
        </span>
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        {previewLead}{" "}
        <code className="font-mono text-foreground">{preview}</code>
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      {layout === "card" ? (
        <div className="mt-3.5">{submitButton}</div>
      ) : (
        <div className="mt-3.5 flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          {submitButton}
        </div>
      )}
    </div>
  );
}
