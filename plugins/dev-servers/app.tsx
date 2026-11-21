import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Icon } from "@bb/shared-ui/icon";
import {
  AnimatedDisclosureBody,
  SectionToggleButton,
} from "@bb/shared-ui/prompt-stack-disclosure";
import {
  definePluginApp,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  useBbNavigate,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk/app";
import { devServersContract, type HostDevServer } from "./contract.js";

const REFRESH_MS = 15_000;
const TOGGLE_ID = "thread-prompt-banner-dev-servers-toggle";
const BODY_ID = "thread-prompt-banner-dev-servers-body";
const SEGMENT_GROUP = "4_devServers";

export function useDevServers(threadId: string): HostDevServer[] {
  const query = experimental_useRpcQuery({
    contract: devServersContract,
    method: "servers.list",
    input: { threadId },
  });
  return query.data?.servers ?? [];
}

function useRefreshingDevServers(threadId: string): HostDevServer[] {
  const query = experimental_useRpcQuery({
    contract: devServersContract,
    method: "servers.list",
    input: { threadId },
  });
  const { refetch } = query;
  useEffect(() => {
    const timer = setInterval(() => void refetch(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refetch]);
  return query.data?.servers ?? [];
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function serverUrl(
  server: HostDevServer,
  clientHostname: string,
): string | null {
  if (!server.primaryHost || !LOOPBACK_HOSTNAMES.has(clientHostname))
    return null;
  return `http://localhost:${server.ports[0]!.port}`;
}

export function describeCommand(command: string | null): string {
  if (command === null) return "Unknown command";
  return command.length > 80 ? `${command.slice(0, 77)}...` : command;
}

export function summaryLabel(servers: readonly HostDevServer[]): string {
  const ports = servers.flatMap((server) =>
    server.ports.map((port) => port.port),
  );
  const shown = ports
    .slice(0, 3)
    .map((port) => `:${port}`)
    .join(" ");
  const more = ports.length > 3 ? ` +${ports.length - 3}` : "";
  return `${servers.length === 1 ? "1 server" : `${servers.length} servers`} · ${shown}${more}`;
}

function ServerRow({
  server,
  threadId,
}: {
  server: HostDevServer;
  threadId: string;
}) {
  const navigate = useBbNavigate();
  const stop = experimental_useRpcMutation({
    contract: devServersContract,
    method: "servers.stop",
  });
  const url = serverUrl(server, window.location.hostname);
  const ports = server.ports.map((port) => `:${port.port}`).join(" ");
  return (
    <li className="flex min-h-7 list-none items-center gap-2 text-xs">
      <span className="shrink-0 font-medium tabular-nums text-foreground">
        {ports}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={server.command ?? undefined}
      >
        {describeCommand(server.command)}
      </span>
      {url === null ? (
        <span className="shrink-0 text-subtle-foreground">
          {server.hostName}
        </span>
      ) : (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
          aria-label={`Open ${url}`}
          onClick={() => navigate.openUrl(url)}
        >
          Open
        </button>
      )}
      <button
        type="button"
        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-50"
        aria-label={`Stop the server on ${ports}`}
        disabled={stop.isPending}
        onClick={() => {
          stop
            .mutate({
              threadId,
              rootPid: server.rootPid,
              startedAt: server.startedAt,
            })
            .then((result) => {
              if (!result.stopped)
                toast.error(`The server on ${ports} was not found.`);
            })
            .catch((error: unknown) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : `Failed to stop the server on ${ports}.`,
              );
            });
        }}
      >
        Stop
      </button>
    </li>
  );
}

export function DevServersSummary({
  threadId,
  segments,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const servers = useDevServers(threadId);
  if (servers.length === 0) return null;
  const label = summaryLabel(servers);
  return (
    <SectionToggleButton
      buttonRef={buttonRef}
      fillRow
      id={TOGGLE_ID}
      controlsId={BODY_ID}
      icon={
        <Icon name="Globe" className="size-3.5 shrink-0" aria-hidden="true" />
      }
      label={label}
      compactLabel={
        servers.length === 1 ? "1 server" : `${servers.length} servers`
      }
      hideLabelInCompact={segments.length > 2}
      ariaLabel={`Servers: ${label}`}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

export function DevServersDetails({
  threadId,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const collapseRef = useRef<HTMLButtonElement | null>(null);
  const servers = useDevServers(threadId);
  if (servers.length === 0) return null;
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={BODY_ID}
      labelledBy={TOGGLE_ID}
      isExpanded={isExpanded}
      collapseLabel="Collapse servers"
      collapseRef={collapseRef}
      onCollapse={onToggle}
    >
      <ul className="max-h-32 overflow-y-auto px-3 pb-2 pt-1">
        {servers.map((server) => (
          <ServerRow
            key={`${server.hostId}:${server.rootPid}`}
            server={server}
            threadId={threadId}
          />
        ))}
      </ul>
    </AnimatedDisclosureBody>
  );
}

function useDevServersVisible({
  threadId,
}: ExperimentalThreadContextSegmentInput): boolean {
  return useRefreshingDevServers(threadId).length > 0;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "dev-servers",
    title: "Servers",
    group: SEGMENT_GROUP,
    order: 10,
    summary: DevServersSummary,
    details: DevServersDetails,
    useVisible: useDevServersVisible,
  });
});
