import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  claimHandleFn,
  createCodeFn,
  createMachineCodeFn,
  disconnectFn,
  getDashboard,
} from "@/server/fns";
import bbIcon from "../assets/bb-icon.png";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "bb connect" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: () => getDashboard(),
  component: Home,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-6 py-16">
      <header className="flex items-center gap-3">
        <img src={bbIcon} alt="bb" className="h-8 w-8" />
        <div>
          <h1 className="text-base font-semibold leading-none">bb connect</h1>
          <p className="mt-1 text-xs text-subtle-foreground/75">Your bb, reachable anywhere</p>
        </div>
      </header>
      {children}
    </main>
  );
}

function Home() {
  const data = Route.useLoaderData();

  if (!data.authed) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Connect your bb server and open it from any browser at{" "}
              <code className="font-mono text-xs">&lt;handle&gt;.getbb.app</code>. Your code and data
              never leave your machine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void signInWithGithub()}>Continue with GitHub</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {!data.handle ? <ClaimCard /> : <ServerCard state={data} />}
      <button
        className="self-start text-xs text-subtle-foreground/75 hover:text-foreground"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </Shell>
  );
}

async function signInWithGithub() {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/dashboard" }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  if (data.url) window.location.href = data.url;
}

async function signOut() {
  // better-auth requires the JSON content-type (else 415) and a JSON body
  // (an empty body makes it 500); the browser supplies the Origin it checks.
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  window.location.href = "/dashboard";
}

function ClaimCard() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    setError(null);
    const r = await claimHandleFn({ data: handle.trim().toLowerCase() });
    setBusy(false);
    if ("ok" in r) void router.invalidate();
    else setError(r.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim your handle</CardTitle>
        <CardDescription>
          Your server will live at{" "}
          <code className="font-mono text-xs">&lt;handle&gt;.vibecodethis.site</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="sawyer"
            autoCapitalize="off"
            spellCheck={false}
            onKeyDown={(e) => e.key === "Enter" && void claim()}
          />
          <Button onClick={() => void claim()} disabled={busy || handle.length < 3}>
            Claim
          </Button>
        </div>
        {error && <p className="text-xs text-destructive-text">Could not claim: {error}</p>}
      </CardContent>
    </Card>
  );
}

type ServerState = Extract<ReturnType<typeof Route.useLoaderData>, { authed: true }>;

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

interface IssuedCode {
  code: string;
  serverUrl: string;
  expiresInMs: number;
}

function ServerCard({ state }: { state: ServerState }) {
  const router = useRouter();
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [showCli, setShowCli] = useState(false);
  const [machineCommand, setMachineCommand] = useState<string | null>(null);
  const connected = state.server?.connected ?? false;
  const online = state.server?.online ?? false;

  const status = !connected ? (
    <Badge variant="outline">Not connected</Badge>
  ) : online ? (
    <Badge>
      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success" />
      Online
    </Badge>
  ) : (
    <Badge variant="secondary">
      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning" />
      Offline
    </Badge>
  );

  async function generateCode() {
    const r = await createCodeFn();
    if ("code" in r) {
      setIssued({ code: r.code, serverUrl: r.serverUrl, expiresInMs: r.expiresInMs });
      setShowCli(false);
      setMachineCommand(null);
    }
  }

  async function addMachine() {
    const r = await createMachineCodeFn();
    if ("code" in r) {
      setMachineCommand(
        `# Run on the machine you want to add as an execution host:\n` +
          `curl -fsSL ${state.appUrl}/connect | sh -s -- machine --code ${r.code} --server ${r.serverUrl}`,
      );
    } else {
      setMachineCommand(`# Could not add machine: ${r.error}`);
    }
    setIssued(null);
  }

  async function disconnect() {
    await disconnectFn();
    void router.invalidate();
  }

  const cliCommand =
    issued === null
      ? null
      : `npx -p bb-app@latest bb connect --code ${issued.code} --server ${issued.serverUrl}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Your server</CardTitle>
          {status}
        </div>
        <CardDescription>
          <a
            href={state.serverUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-foreground underline-offset-2 hover:underline"
          >
            {state.serverUrl}
          </a>
          {state.server?.lastSeenAt && !online && (
            <span className="ml-2 text-subtle-foreground/75">
              last seen {new Date(state.server.lastSeenAt).toLocaleString()}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void generateCode()}>Generate connect code</Button>
          {connected && (
            <Button variant="secondary" onClick={() => void addMachine()}>
              Add a machine
            </Button>
          )}
          {connected && (
            <Button variant="ghost" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          )}
        </div>
        {issued && cliCommand && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-recessed px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <code className="select-all font-mono text-2xl font-semibold tracking-[0.2em]">
                {issued.code}
              </code>
              <CopyButton text={issued.code} label="Copy code" />
            </div>
            <p className="text-xs text-subtle-foreground/75">
              In bb, open <span className="text-foreground">Remote access</span> and paste this
              code. Expires in {Math.round(issued.expiresInMs / 60000)} min.
            </p>
            <button
              className="self-start text-xs text-subtle-foreground/75 underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setShowCli((v) => !v)}
            >
              {showCli ? "Hide terminal command" : "Using a terminal instead?"}
            </button>
            {showCli && (
              <div className="flex flex-col gap-2">
                <pre
                  className={cn(
                    "overflow-x-auto rounded-md border border-border bg-background px-3 py-2.5",
                    "font-mono text-xs leading-relaxed text-foreground",
                  )}
                >
                  {cliCommand}
                </pre>
                <div>
                  <CopyButton text={cliCommand} label="Copy command" />
                </div>
              </div>
            )}
          </div>
        )}
        {machineCommand && (
          <pre
            className={cn(
              "overflow-x-auto rounded-md border border-border bg-surface-recessed px-3 py-2.5",
              "font-mono text-xs leading-relaxed text-foreground",
            )}
          >
            {machineCommand}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
