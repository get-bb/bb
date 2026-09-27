import {
  loadAsk,
  parse,
  type AskModel,
  type OrtModule,
} from "@ai-ecoverse/gpu-ask.js";
import * as ort from "onnxruntime-web/wasm";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

ort.env.wasm.wasmPaths = { wasm, mjs };
ort.env.wasm.numThreads = 1;

let model: Promise<AskModel> | null = null;
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  queue = queue.then(async () => {
    try {
      model ??= loadAsk(`${self.location.origin}/gpu-ask/v13/`, {
        ort: ort as unknown as OrtModule,
      });
      const result = await parse(await model, text);
      self.postMessage({ id, questions: result.questions });
    } catch (error) {
      model = null;
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
