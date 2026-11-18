import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Image, Linking, View } from "react-native";
import { Button, GROUPED_CARD_RADIUS, Icon, Text } from "@/ui";

interface WidgetPhoto {
  uri: string;
}

interface WidgetPhotoCaptureProps {
  onCancel: () => void;
  onUsePhoto: (photo: WidgetPhoto) => Promise<void>;
}

interface CameraSize {
  width: number;
  height: number;
}

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 960;
const CARD_STYLE = {
  borderRadius: GROUPED_CARD_RADIUS,
  borderCurve: "continuous" as const,
};

export function WidgetPhotoCapture({
  onCancel,
  onUsePhoto,
}: WidgetPhotoCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<WidgetPhoto | null>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View
        className="items-center gap-4 border border-border bg-surface-grouped-cell px-6 py-6"
        style={CARD_STYLE}
      >
        <Icon name="Camera" size={32} />
        <Text variant="bodyLarge" className="text-center">
          bb needs camera access to take a photo for your new thread.
        </Text>
        {permission.canAskAgain ? (
          <Button onPress={() => void requestPermission()}>Allow camera</Button>
        ) : (
          <Button
            variant="outline"
            onPress={() => void Linking.openSettings()}
            icon="Settings"
          >
            Open Settings
          </Button>
        )}
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
      </View>
    );
  }

  const configureCamera = async () => {
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      const bounded = (sizes ?? [])
        .map((size) => ({ label: size, ...parseSize(size) }))
        .filter(
          (size): size is { label: string; width: number; height: number } =>
            size.width > 0 &&
            size.height > 0 &&
            size.width <= MAX_WIDTH &&
            size.height <= MAX_HEIGHT,
        )
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      setPictureSize(bounded?.label);
      setCameraReady(true);
    } catch {
      setError("Could not prepare the camera. Try again.");
    }
  };

  const capture = async () => {
    setError(null);
    try {
      const result = await cameraRef.current?.takePictureAsync({
        quality: 0.55,
      });
      if (!result?.uri) throw new Error("No image data returned");
      setPhoto({ uri: result.uri });
    } catch {
      setError("Could not take the photo. Try again.");
    }
  };

  const submitPhoto = async () => {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUsePhoto(photo);
    } catch {
      setError(
        "Could not start the thread with this photo. Retry or take another photo.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-4">
      <View
        className="overflow-hidden bg-surface-grouped-cell"
        style={[CARD_STYLE, { height: 360 }]}
      >
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            resizeMode="contain"
            style={{ flex: 1 }}
            accessibilityLabel="Photo preview"
          />
        ) : (
          <CameraView
            key={cameraAttempt}
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            pictureSize={pictureSize}
            onCameraReady={() => void configureCamera()}
            onMountError={() => {
              setCameraReady(false);
              setError("Could not open the camera. Try again.");
            }}
          />
        )}
      </View>
      {error ? (
        <Text tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {photo ? (
        <View className="gap-3">
          <Button onPress={() => void submitPhoto()} loading={busy}>
            Start thread with photo
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => {
              setPhoto(null);
              setError(null);
              setCameraReady(false);
            }}
          >
            Retake
          </Button>
        </View>
      ) : cameraReady ? (
        <Button onPress={() => void capture()}>Take photo</Button>
      ) : error ? (
        <Button
          variant="outline"
          onPress={() => {
            setError(null);
            setCameraAttempt((attempt) => attempt + 1);
          }}
        >
          Retry camera
        </Button>
      ) : (
        <Button disabled>Preparing camera</Button>
      )}
      <Button variant="ghost" disabled={busy} onPress={onCancel}>
        Cancel
      </Button>
    </View>
  );
}

function parseSize(value: string): CameraSize {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  return { width: Number(match?.[1] ?? 0), height: Number(match?.[2] ?? 0) };
}
