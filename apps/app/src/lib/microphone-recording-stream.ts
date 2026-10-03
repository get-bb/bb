export function createMicrophoneRecordingStream(input: MediaStream) {
  const context = new AudioContext();
  try {
    const destination = context.createMediaStreamDestination();
    let source = context.createMediaStreamSource(input);
    source.connect(destination);
    return {
      stream: destination.stream,
      resume: () => context.resume(),
      replace(next: MediaStream) {
        const nextSource = context.createMediaStreamSource(next);
        nextSource.connect(destination);
        source.disconnect();
        source = nextSource;
      },
      close() {
        source.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    void context.close().catch(() => {});
    throw error;
  }
}
