import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
  useSdk,
  useSettings,
  type PluginHomepageSectionProps,
} from "@get-bb/plugin-sdk/app";
import {
  detectTipClient,
  hasNotificationNudge,
  readNotificationEnvironment,
  readTipClientEnvironment,
} from "./client.js";
import { runTipAction } from "./actions.js";
import type { TipView, tipsRpcContract } from "./contract.js";
import { TipsGallery, TipsHiddenNotice } from "./gallery.js";
import { recordTipEvent } from "./telemetry.js";

const TIPS_CHANGED_CHANNEL = "tips-changed";
const COMPACT_LAYOUT_QUERY = "(max-width: 767px)";
const MIN_GALLERY_WIDTH = 520;

function subscribeCompactLayout(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isCompactLayout(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
}

function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribeCompactLayout,
    isCompactLayout,
    isCompactLayout,
  );
}

function useElementWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      setWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

function promptOf(tip: TipView | undefined): string | null {
  return tip?.action.kind === "prompt" ? tip.action.prompt : null;
}

function TipsGallerySection({
  projectId,
  client,
  reportedShown,
}: {
  projectId: string | null;
  client: ReturnType<typeof detectTipClient>;
  reportedShown: Set<string>;
}) {
  const rpc = useRpc<typeof tipsRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const composer = useComposer();
  const settings = useSettings();
  const enabled = settings.values?.enabled !== false;
  const [tips, setTips] = useState<readonly TipView[]>([]);
  const [revision, setRevision] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [filledId, setFilledId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const visited = useRef(false);
  const isEmpty = composer.isEmpty;

  useRealtime(TIPS_CHANGED_CHANNEL, () => {
    setRevision((current) => current + 1);
  });

  useEffect(() => {
    if (!enabled) {
      setTips([]);
      return;
    }
    let active = true;
    const visit = !visited.current;
    visited.current = true;
    rpc.call("current", { client, projectId, visit }).then(
      (result) => {
        if (active) setTips(result.tips);
      },
      () => {
        if (active) setTips([]);
      },
    );
    return () => {
      active = false;
    };
  }, [client, enabled, projectId, revision, rpc]);

  const showing = enabled && !dismissed && tips.length > 0;
  useEffect(() => {
    if (!showing) return;
    tips.forEach((tip, index) => {
      if (reportedShown.has(tip.id)) return;
      reportedShown.add(tip.id);
      recordTipEvent(sdk, "tip_shown", tip, index);
    });
  }, [reportedShown, sdk, showing, tips]);

  const preview = promptOf(tips.find((tip) => tip.id === previewId));
  useEffect(() => {
    composer.experimental_setPlaceholderPreview(
      isEmpty && preview !== null ? preview.trimEnd() : null,
    );
  }, [composer, isEmpty, preview]);

  const filled = isEmpty ? null : filledId;

  const activate = useCallback(
    (tip: TipView) => {
      const result = runTipAction(tip, {
        replaceDraft: (update) => composer.replace(update),
        focusComposer: () => composer.focus(),
        openAppRoute: (path) => navigate.experimental_openAppRoute(path),
        runAppCommand: (commandId) =>
          navigate.experimental_runAppCommand(commandId),
        openUrl: (url) => navigate.openUrl(url),
      });
      if (tip.action.kind === "prompt") {
        setPreviewId(null);
        setFilledId(tip.id);
      }
      setNotice(result.announcement);
      recordTipEvent(
        sdk,
        "tip_used",
        tip,
        tips.findIndex((shown) => shown.id === tip.id),
      );
      void rpc.call("act", { id: tip.id }).catch(() => {});
    },
    [composer, navigate, rpc, sdk, tips],
  );

  const turnOff = useCallback(() => {
    setDismissed(true);
    setPreviewId(null);
    void rpc.call("setEnabled", { enabled: false }).catch(() => {});
  }, [rpc]);

  const undo = useCallback(() => {
    setDismissed(false);
    void rpc.call("setEnabled", { enabled: true }).catch(() => {});
  }, [rpc]);

  if (dismissed) return <TipsHiddenNotice onUndo={undo} />;
  if (!showing) return null;
  return (
    <TipsGallery
      tips={tips}
      filledId={filled}
      notice={notice}
      onPreview={setPreviewId}
      onActivate={activate}
      onDismiss={turnOff}
    />
  );
}

function TipsHomepageSection({
  projectId,
  experimental_setupComplete,
}: PluginHomepageSectionProps) {
  const client = useMemo(
    () => ({
      ...detectTipClient(readTipClientEnvironment()),
      notificationNudge: hasNotificationNudge(readNotificationEnvironment()),
    }),
    [],
  );
  const onPhone =
    client.surface === "mobile-app" || client.surface === "mobile-web";
  const compact = useCompactLayout();
  const [measure, width] = useElementWidth();
  const [reportedShown] = useState(() => new Set<string>());
  const fits = width >= MIN_GALLERY_WIDTH;
  if (onPhone || experimental_setupComplete !== true) return null;
  return (
    <div ref={measure} data-tips-section="">
      {!compact && fits ? (
        <TipsGallerySection
          projectId={projectId}
          client={client}
          reportedShown={reportedShown}
        />
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "tips",
    component: TipsHomepageSection,
  });
});
