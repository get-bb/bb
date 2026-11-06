import type {
  ExperimentalDesktopBrowserHostRequest,
  ExperimentalDesktopBrowserScope,
  ExperimentalDesktopBrowserCreateInput,
  ExperimentalDesktopBrowserAcquireInput,
  ExperimentalDesktopBrowserTabRequest,
  ExperimentalDesktopBrowserLeaseRequest,
  ExperimentalDesktopBrowserInstances,
  ExperimentalDesktopBrowserTabs,
  ExperimentalDesktopBrowserCreated,
  ExperimentalDesktopBrowserCapture,
  ExperimentalDesktopBrowserConnection,
  ExperimentalDesktopBrowserLease,
  ExperimentalDesktopBrowserInstanceRequest,
  ExperimentalDesktopBrowserImportCookiesInput,
  ExperimentalDesktopBrowserImportSources,
  ExperimentalDesktopBrowserImportOutcome,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type {
  ExperimentalDesktopBrowserHostRequest,
  ExperimentalDesktopBrowserScope,
  ExperimentalDesktopBrowserCreateInput,
  ExperimentalDesktopBrowserAcquireInput,
  ExperimentalDesktopBrowserTabRequest,
  ExperimentalDesktopBrowserLeaseRequest,
  ExperimentalDesktopBrowserInstances,
  ExperimentalDesktopBrowserTabs,
  ExperimentalDesktopBrowserCreated,
  ExperimentalDesktopBrowserCapture,
  ExperimentalDesktopBrowserConnection,
  ExperimentalDesktopBrowserLease,
  ExperimentalDesktopBrowserInstanceRequest,
  ExperimentalDesktopBrowserImportCookiesInput,
  ExperimentalDesktopBrowserImportSources,
  ExperimentalDesktopBrowserImportOutcome,
} from "@bb/server-contract";

export interface ExperimentalDesktopBrowsersArea {
  listInstances(
    input: ExperimentalDesktopBrowserHostRequest,
  ): Promise<ExperimentalDesktopBrowserInstances>;
  listTabs(
    input: ExperimentalDesktopBrowserScope,
  ): Promise<ExperimentalDesktopBrowserTabs>;
  createTab(
    input: ExperimentalDesktopBrowserCreateInput,
  ): Promise<ExperimentalDesktopBrowserCreated>;
  acquireControl(
    input: ExperimentalDesktopBrowserAcquireInput,
  ): Promise<ExperimentalDesktopBrowserLease>;
  openConnection(
    input: ExperimentalDesktopBrowserLeaseRequest,
  ): Promise<ExperimentalDesktopBrowserConnection>;
  releaseControl(
    input: ExperimentalDesktopBrowserLeaseRequest,
  ): Promise<{ ok: true }>;
  revealTab(input: ExperimentalDesktopBrowserTabRequest): Promise<{ ok: true }>;
  closeTab(input: ExperimentalDesktopBrowserTabRequest): Promise<{ ok: true }>;
  captureTab(
    input: ExperimentalDesktopBrowserTabRequest,
  ): Promise<ExperimentalDesktopBrowserCapture>;
  listImportSources(
    input: ExperimentalDesktopBrowserInstanceRequest,
  ): Promise<ExperimentalDesktopBrowserImportSources>;
  importCookies(
    input: ExperimentalDesktopBrowserImportCookiesInput,
  ): Promise<ExperimentalDesktopBrowserImportOutcome>;
  subscribe(
    input: ExperimentalDesktopBrowserScope & {
      onChange: (result: ExperimentalDesktopBrowserTabs) => void;
      onError: (error: Error) => void;
    },
  ): { dispose(): void };
}

export function createDesktopBrowsersArea({
  operations,
}: CreateSdkAreaArgs): ExperimentalDesktopBrowsersArea {
  const { call } = operations;
  const listTabs = (input: ExperimentalDesktopBrowserScope) =>
    call("desktopBrowsers.listTabs", input);
  return {
    listInstances: (input) => call("desktopBrowsers.listInstances", input),
    listTabs,
    createTab: (input) => call("desktopBrowsers.createTab", input),
    acquireControl: (input) => call("desktopBrowsers.acquireControl", input),
    openConnection: (input) => call("desktopBrowsers.openConnection", input),
    releaseControl: (input) => call("desktopBrowsers.releaseControl", input),
    revealTab: (input) => call("desktopBrowsers.revealTab", input),
    closeTab: (input) => call("desktopBrowsers.closeTab", input),
    captureTab: (input) => call("desktopBrowsers.captureTab", input),
    listImportSources: (input) =>
      call("desktopBrowsers.listImportSources", input),
    importCookies: (input) => call("desktopBrowsers.importCookies", input),
    subscribe(input) {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let previous = "";
      const scope: ExperimentalDesktopBrowserScope = {
        hostId: input.hostId,
        instanceId: input.instanceId,
        generation: input.generation,
        threadId: input.threadId,
      };
      const poll = async () => {
        try {
          const result = await listTabs(scope);
          const serialized = JSON.stringify(result);
          if (!disposed && serialized !== previous) {
            previous = serialized;
            input.onChange(result);
          }
        } catch (error) {
          if (!disposed)
            input.onError(
              error instanceof Error ? error : new Error(String(error)),
            );
        } finally {
          if (!disposed)
            timer = setTimeout(() => {
              void poll();
            }, 2000);
        }
      };
      void poll();
      return {
        dispose() {
          disposed = true;
          clearTimeout(timer);
        },
      };
    },
  };
}
