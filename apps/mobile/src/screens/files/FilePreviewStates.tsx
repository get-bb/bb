import { View } from "react-native";
import { Button, EmptyStatePanel, Skeleton, Text } from "@/ui";

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

/** not-found / too-large / error / empty / unsupported bodies. */
export function FilePreviewMessage({
  title,
  detail,
  onRetry,
  onOpenExternally,
  testID,
}: FilePreviewMessageProps) {
  return (
    <View className="gap-3 p-4" testID={testID}>
      <EmptyStatePanel>
        <Text className="text-center text-sm text-muted-foreground">
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" className="pt-1 text-center">
            {detail}
          </Text>
        ) : null}
      </EmptyStatePanel>
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
