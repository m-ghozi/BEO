import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  QRDecodeRequest,
  QRDecodeResponse,
} from "../../workers/qr-decoder.worker";

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export interface UseQRScannerOptions {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScan: (payload: string) => void;
}

export interface UseQRScannerResult {
  isCameraActive: boolean;
  cameraError: string | null;
  decoderMode: "native" | "wasm-worker" | null;
}

const SCAN_INTERVAL_MS = 180;

export function useQRScanner({
  enabled,
  videoRef,
  onScan,
}: UseQRScannerOptions): UseQRScannerResult {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [decoderMode, setDecoderMode] = useState<
    "native" | "wasm-worker" | null
  >(null);

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      setIsCameraActive(false);
      setDecoderMode(null);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let worker: Worker | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let isDecoding = false;
    let lastScanAttemptAt = 0;
    let nextMessageId = 1;

    const stopAll = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsCameraActive(false);
      setDecoderMode(null);
    };

    async function startScanner() {
      setCameraError(null);

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setCameraError("Camera access is not supported in this browser.");
        return;
      }

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = mediaStream;
        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = mediaStream;
          await videoEl.play().catch(() => {});
        }

        if (cancelled) {
          stopAll();
          return;
        }

        setIsCameraActive(true);

        const NativeBarcodeDetector = (
          window as unknown as {
            BarcodeDetector?: BarcodeDetectorConstructor;
          }
        ).BarcodeDetector;

        let detector: BarcodeDetectorLike | null = null;
        if (typeof NativeBarcodeDetector === "function") {
          detector = new NativeBarcodeDetector({ formats: ["qr_code"] });
          setDecoderMode("native");
        } else if (typeof Worker !== "undefined") {
          worker = new Worker(
            new URL("../../workers/qr-decoder.worker.ts", import.meta.url),
            { type: "module" }
          );
          worker.onmessage = (event: MessageEvent<QRDecodeResponse>) => {
            isDecoding = false;
            const text = event.data?.text?.trim();
            if (text && !cancelled) {
              onScanRef.current(text);
            }
          };
          worker.onerror = () => {
            isDecoding = false;
          };
          setDecoderMode("wasm-worker");
        } else {
          setDecoderMode("wasm-worker");
        }

        const tick = async (timestamp: number) => {
          if (cancelled) return;

          const currentVideo = videoRef.current;
          if (
            currentVideo &&
            currentVideo.readyState >= 2 &&
            currentVideo.videoWidth > 0 &&
            currentVideo.videoHeight > 0 &&
            !isDecoding &&
            timestamp - lastScanAttemptAt >= SCAN_INTERVAL_MS
          ) {
            lastScanAttemptAt = timestamp;

            if (detector) {
              isDecoding = true;
              try {
                const barcodes = await detector.detect(currentVideo);
                const rawValue = barcodes[0]?.rawValue?.trim();
                if (rawValue && !cancelled) {
                  onScanRef.current(rawValue);
                }
              } catch {
                // Ignore transient frame detection errors
              } finally {
                isDecoding = false;
              }
            } else if (worker) {
              if (!canvas) {
                canvas = document.createElement("canvas");
                ctx = canvas.getContext("2d", { willReadFrequently: true });
              }
              if (ctx && canvas) {
                canvas.width = currentVideo.videoWidth;
                canvas.height = currentVideo.videoHeight;
                ctx.drawImage(
                  currentVideo,
                  0,
                  0,
                  canvas.width,
                  canvas.height
                );
                const imageData = ctx.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height
                );
                isDecoding = true;
                const req: QRDecodeRequest = {
                  id: nextMessageId++,
                  imageData,
                };
                worker.postMessage(req);
              }
            }
          }

          if (!cancelled) {
            rafId = requestAnimationFrame(tick);
          }
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error
              ? err.message
              : "Unable to access camera. Check browser permissions."
          );
          stopAll();
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [enabled, videoRef]);

  return { isCameraActive, cameraError, decoderMode };
}
