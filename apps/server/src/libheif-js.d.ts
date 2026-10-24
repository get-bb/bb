declare module "libheif-js/wasm-bundle.js" {
  interface HeifImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  interface HeifImage {
    is_primary(): boolean;
    get_width(): number;
    get_height(): number;
    display(
      data: HeifImageData,
      callback: (result: HeifImageData | null) => void,
    ): void;
    free(): void;
  }

  class HeifDecoder {
    decoder: { delete(): void } | null;
    decode(buffer: Uint8Array): HeifImage[];
  }

  const libheif: {
    ready: Promise<unknown>;
    HeifDecoder: typeof HeifDecoder;
  };
  export default libheif;
}
