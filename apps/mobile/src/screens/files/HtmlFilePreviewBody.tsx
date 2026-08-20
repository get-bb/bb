import { useCallback, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { useTheme } from "@/theme";
import { Button, EmptyStatePanel, Spinner, Text } from "@/ui";

function sameUrl(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

export interface HtmlFilePreviewBodyProps {
  /**
   * Absolute URL on the profile's server of a route that serves the file with
   * `Content-Security-Policy: sandbox allow-scripts` (`buildFileTargetHtmlUrl`
   * only returns those). Cookies come from the shared jar, so pointing this
   * at any un-sandboxed route would run the file's scripts same-origin with
   * the session.
   */
  rawUrl: string;
  onOpenExternally: () => void;
  testID?: string;
}

/**
 * Renders an HTML file through one of the server's CSP-sandboxed raw routes
 * in a WebView. Invariant: `rawUrl` must be a route the server answers with
 * `Content-Security-Policy: sandbox allow-scripts`, so the page runs with an
 * opaque origin and cannot reach bb cookies or APIs even though the WebView
 * shares the cookie jar. The WebView only points at the profile's server
 * origin, never at the host's localhost (which the phone cannot reach
 * anyway).
 */
export function HtmlFilePreviewBody({
  rawUrl,
  onOpenExternally,
  testID,
}: HtmlFilePreviewBodyProps) {
  const { tokens } = useTheme();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  // The WebView shows this one document. Links inside it (main-frame
  // navigations away from `rawUrl`) go to the system browser instead of
  // steering a cookie-sharing WebView to an arbitrary site; sub-frame and
  // same-document loads are left alone.
  const initialLoadSeen = useRef(false);
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (!request.isTopFrame) return true;
      if (!initialLoadSeen.current || sameUrl(request.url, rawUrl)) {
        initialLoadSeen.current = true;
        return true;
      }
      if (/^https?:/iu.test(request.url)) {
        void Linking.openURL(request.url).catch(() => undefined);
      }
      return false;
    },
    [rawUrl],
  );
  if (failed !== null) {
    return (
      <View className="gap-3 p-4" testID={testID}>
        <EmptyStatePanel>
          <Text className="text-center text-sm text-muted-foreground">
            The HTML preview could not load.
          </Text>
          <Text variant="caption" className="pt-1 text-center">
            {failed}
          </Text>
        </EmptyStatePanel>
        <Button
          variant="outline"
          icon="ExternalLink"
          onPress={onOpenExternally}
        >
          Open in Safari
        </Button>
      </View>
    );
  }
  return (
    <View className="flex-1" testID={testID}>
      <WebView
        source={{ uri: rawUrl }}
        sharedCookiesEnabled
        originWhitelist={["*"]}
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={() => setLoading(false)}
        onError={(event) =>
          setFailed(event.nativeEvent.description || "Load failed")
        }
        onHttpError={(event) =>
          setFailed(`HTTP ${event.nativeEvent.statusCode}`)
        }
        style={{ flex: 1, backgroundColor: tokens.background }}
        testID="file-preview-webview"
      />
      {loading ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
        >
          <Spinner />
        </View>
      ) : null}
    </View>
  );
}
