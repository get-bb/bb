import { View } from "react-native";
import { Button, Skeleton, Text } from "@/ui";

export function FilePreviewLoading() {
  return (
    <View className="gap-2 px-4 pt-4" testID="file-preview-loading">
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </View>
  );
}

export interface FilePreviewMessageProps {
  title: string;
  detail?: string;
  onRetry?: () => void;
  onOpenExternally?: () => void;
  testID?: string;
}

/**
 * not-found / too-large / error / empty / unsupported bodies: a centered
 * headline + footnote (iOS empty state) with tinted actions.
 */
export function FilePreviewMessage({
  title,
  detail,
  onRetry,
  onOpenExternally,
  testID,
}: FilePreviewMessageProps) {
  return (
    <View className="items-center gap-4 px-6 py-10" testID={testID}>
      <View className="items-center gap-1">
        <Text variant="headline" className="text-center">
          {title}
        </Text>
        {detail ? (
          <Text
            variant="footnote"
            tone="muted"
            className="text-center"
            selectable
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {onRetry ? (
        <Button variant="outline" icon="RotateCcw" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
      {onOpenExternally ? (
        <Button
          variant="outline"
          icon="ExternalLink"
          onPress={onOpenExternally}
        >
          Open in browser
        </Button>
      ) : null}
    </View>
  );
}
