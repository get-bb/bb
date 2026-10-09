import { useEffect, useRef, useState } from "react";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { CallToolResultSchema, ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { definePluginApp, useBbNavigate, useRpc, useSdk, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { AppSession, rpcContract } from "./server.js";

function appDocument(html: string): string {
  const policy = "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}

function AppFrame({ session }: { session: AppSession }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe?.contentWindow) return;
    let closed = false;
    const bridge = new AppBridge(null, { name: "BB", version: "0.1.0" }, {
      serverTools: {},
      serverResources: {},
      message: { text: {} },
    });
    bridge.oncalltool = async (params) => {
      const response = await rpc.call("app_call_tool", {
        id: session.id,
        threadId: session.threadId,
        name: params.name,
        arguments: params.arguments ?? {},
      });
      return CallToolResultSchema.parse(response.result);
    };
    bridge.onreadresource = async (params) => {
      const response = await rpc.call("app_read_resource", {
        id: session.id,
        threadId: session.threadId,
        uri: params.uri,
      });
      return ReadResourceResultSchema.parse(response.result);
    };
    bridge.onmessage = async (params) => {
      const text = params.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text || text.length > 4_000 || !window.confirm(`Send this MCP App message to the chat?\n\n${text}`)) {
        return { isError: true };
      }
      await sdk.threads.send({
        threadId: session.threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
      return {};
    };
    bridge.oninitialized = () => {
      if (closed) return;
      void bridge.sendToolInput({ arguments: session.arguments });
      void bridge.sendToolResult(CallToolResultSchema.parse(session.result));
    };
    void bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow))
      .catch((cause: unknown) => {
        if (!closed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    iframe.srcdoc = appDocument(session.html);
    return () => {
      closed = true;
      void bridge.close();
    };
  }, [rpc, sdk, session]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? <p role="alert" className="p-3 text-sm text-destructive">{error}</p> : null}
      <iframe
        ref={frame}
        title={`MCP App: ${session.toolName}`}
        sandbox="allow-scripts allow-forms"
        className="h-full min-h-0 w-full flex-1 border-0"
      />
    </div>
  );
}

function McpAppPanel({ threadId, params }: { threadId: string; params: unknown }) {
  const rpc = useRpc<typeof rpcContract>();
  const [session, setSession] = useState<AppSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = params && typeof params === "object" && "session" in params && typeof params.session === "string"
    ? params.session
    : null;

  useEffect(() => {
    if (!id) return;
    let active = true;
    rpc.call("app_get", { id, threadId }).then(
      (value) => { if (active) setSession(value); },
      (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { active = false; };
  }, [id, rpc, threadId]);

  if (!id) return <p className="p-4 text-sm text-muted-foreground">Call an MCP tool that provides an App to open its interface here.</p>;
  if (error) return <p role="alert" className="p-4 text-sm text-destructive">{error}</p>;
  if (!session) return <p className="p-4 text-sm text-muted-foreground">Loading MCP App…</p>;
  return <AppFrame key={session.id} session={session} />;
}

function AppDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const session = attributes.session;
  if (!session || !/^[0-9a-f-]{36}$/.test(session)) return null;
  return (
    <button
      type="button"
      className="my-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
      onClick={() => navigate.openThreadPanel({ actionId: "app", title: "MCP App", params: { session } })}
    >
      Open MCP App beside chat
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "app",
    title: "MCP App",
    icon: "AppWindow",
    component: McpAppPanel,
    layout: "flush",
  });
  app.slots.messageDirective({ id: "mcp-app", component: AppDirective });
});
