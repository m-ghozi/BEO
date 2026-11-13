import { readBarcodes } from "zxing-wasm/reader";

export interface QRDecodeRequest {
  id: number;
  imageData: ImageData;
}

export interface QRDecodeResponse {
  id: number;
  text: string | null;
  error?: string;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<QRDecodeRequest>) => void) | null;
  postMessage: (message: QRDecodeResponse) => void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = async (event: MessageEvent<QRDecodeRequest>) => {
  const { id, imageData } = event.data;
  try {
    const results = await readBarcodes(imageData, {
      formats: ["QRCode"],
      tryHarder: false,
      maxNumberOfSymbols: 1,
    });
    const text = results[0]?.text ?? null;
    workerScope.postMessage({ id, text });
  } catch (err) {
    workerScope.postMessage({
      id,
      text: null,
      error: err instanceof Error ? err.message : "QR decode failed",
    });
  }
};
