import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ScanBarcode,
} from "lucide-react";
import { CheckinScanSchema, type CheckinResultDTO } from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useQRScanner } from "./useQRScanner";

type ScanStatus = "success" | "duplicate" | "invalid";

interface ScanLogEntry {
  id: string;
  status: ScanStatus;
  scanMode: "hid" | "webcam";
  qrPayload: string;
  ticketCode?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  message: string;
  timestamp: string;
}

const MAX_RECENT_SCANS = 25;
const WEBCAM_COOLDOWN_MS = 2500;

export function CheckinPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();

  const [hidValue, setHidValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [lastResult, setLastResult] = useState<ScanLogEntry | null>(null);
  const [recentScans, setRecentScans] = useState<ScanLogEntry[]>([]);

  const hidInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSubmittingRef = useRef(false);
  const lastWebcamScanRef = useRef<{ payload: string; at: number } | null>(
    null
  );

  useEffect(() => {
    hidInputRef.current?.focus();
  }, []);

  const recordScan = useCallback((entry: ScanLogEntry) => {
    setLastResult(entry);
    setRecentScans((prev) => [entry, ...prev].slice(0, MAX_RECENT_SCANS));
  }, []);

  const submitScan = useCallback(
    async (rawPayload: string, scanMode: "hid" | "webcam") => {
      if (!eventId || isSubmittingRef.current) {
        return;
      }

      const parsed = CheckinScanSchema.safeParse({
        qr_payload: rawPayload,
        scan_mode: scanMode,
      });
      if (!parsed.success) {
        return;
      }

      if (scanMode === "webcam") {
        const now = Date.now();
        const prev = lastWebcamScanRef.current;
        if (
          prev &&
          prev.payload === parsed.data.qr_payload &&
          now - prev.at < WEBCAM_COOLDOWN_MS
        ) {
          return;
        }
        lastWebcamScanRef.current = {
          payload: parsed.data.qr_payload,
          at: now,
        };
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nowIso = new Date().toISOString();

      try {
        const res = await apiFetch<CheckinResultDTO>(
          `/v1/events/${eventId}/checkin`,
          {
            method: "POST",
            body: JSON.stringify(parsed.data),
          }
        );

        const resultStatus: ScanStatus =
          res.result === "duplicate"
            ? "duplicate"
            : res.result === "invalid"
              ? "invalid"
              : "success";

        recordScan({
          id: entryId,
          status: resultStatus,
          scanMode,
          qrPayload: parsed.data.qr_payload,
          ticketCode: res.ticket_code,
          attendeeName: res.attendee_name,
          attendeeEmail: res.attendee_email,
          message:
            resultStatus === "success"
              ? "Ticket verified and checked in"
              : resultStatus === "duplicate"
                ? "Ticket already checked in"
                : "Invalid ticket",
          timestamp: res.checked_in_at ?? nowIso,
        });
      } catch (err) {
        let status: ScanStatus = "invalid";
        let message = "Invalid or unrecognized ticket";

        if (err instanceof ApiError) {
          if (err.status === 409) {
            status = "duplicate";
            message = err.message || "Ticket already checked in";
          } else if (err.status === 403) {
            status = "invalid";
            message =
              err.message ||
              "Forbidden: You do not have check-in permission for this event.";
          } else {
            message = err.message || message;
          }
        } else if (err instanceof Error) {
          message = err.message;
        }

        recordScan({
          id: entryId,
          status,
          scanMode,
          qrPayload: parsed.data.qr_payload,
          message,
          timestamp: nowIso,
        });
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        if (scanMode === "hid") {
          setHidValue("");
          hidInputRef.current?.focus();
        }
      }
    },
    [eventId, recordScan]
  );

  const handleWebcamScan = useCallback(
    (payload: string) => {
      void submitScan(payload, "webcam");
    },
    [submitScan]
  );

  const { isCameraActive, cameraError, decoderMode } = useQRScanner({
    enabled: webcamEnabled,
    videoRef,
    onScan: handleWebcamScan,
  });

  const handleHidSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    void submitScan(hidValue, "hid");
  };

  const handleHidKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isSubmittingRef.current) {
      e.preventDefault();
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to={eventId ? `/organizer/events/${eventId}` : "/organizer"}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            &larr; Back to Event Management
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            Venue Check-in Terminal
          </h1>
          <p className="text-sm text-gray-600">
            Event ID: <span className="font-mono">{eventId}</span>
            {user ? ` · Operator: ${user.name}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setWebcamEnabled((prev) => !prev)}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            webcamEnabled
              ? "bg-gray-900 text-white hover:bg-gray-800"
              : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {webcamEnabled ? (
            <>
              <CameraOff className="h-4 w-4" />
              Disable Webcam Scanner
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              Enable Webcam Scanner
            </>
          )}
        </button>
      </div>

      {/* Live Scan Result Banner */}
      {lastResult && (
        <div
          role={lastResult.status === "success" ? "status" : "alert"}
          className={`rounded-xl border p-5 shadow-xs ${
            lastResult.status === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : lastResult.status === "duplicate"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <div className="flex items-start gap-3">
            {lastResult.status === "success" ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            ) : lastResult.status === "duplicate" ? (
              <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
            ) : (
              <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">
                {lastResult.status === "success"
                  ? "Check-in Successful"
                  : lastResult.status === "duplicate"
                    ? "Duplicate Scan"
                    : "Check-in Failed"}
              </p>
              <p className="mt-0.5 text-sm font-medium">{lastResult.message}</p>

              {(lastResult.attendeeName || lastResult.ticketCode) && (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {lastResult.attendeeName && (
                    <span>
                      Attendee:{" "}
                      <strong className="font-semibold">
                        {lastResult.attendeeName}
                      </strong>
                    </span>
                  )}
                  {lastResult.attendeeEmail && (
                    <span>Email: {lastResult.attendeeEmail}</span>
                  )}
                  {lastResult.ticketCode && (
                    <span>
                      Ticket:{" "}
                      <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs font-semibold">
                        {lastResult.ticketCode}
                      </code>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scanner Controls Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hardware HID Scanner Input */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Hardware HID Scanner
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Keep this field focused when using a USB/Bluetooth QR barcode
            scanner. Press Enter to submit manually.
          </p>

          <form onSubmit={handleHidSubmit} className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="hid-qr-input"
                className="block text-sm font-medium text-gray-700"
              >
                Hardware HID Scanner Input
              </label>
              <input
                ref={hidInputRef}
                id="hid-qr-input"
                type="text"
                autoFocus
                autoComplete="off"
                value={hidValue}
                onChange={(e) => setHidValue(e.target.value)}
                onKeyDown={handleHidKeyDown}
                placeholder="Scan QR code or paste payload..."
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !hidValue.trim()}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isSubmitting ? "Verifying Ticket..." : "Check In Ticket"}
            </button>
          </form>
        </div>

        {/* Webcam Scanner */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Webcam QR Scanner
              </h2>
            </div>
            {isCameraActive && decoderMode && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                {decoderMode === "native"
                  ? "Native BarcodeDetector"
                  : "zxing-wasm Worker"}
              </span>
            )}
          </div>

          {cameraError && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {cameraError}
            </div>
          )}

          {webcamEnabled ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
            </div>
          ) : (
            <div className="mt-4 flex aspect-video items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
              Webcam scanner is off. Click &ldquo;Enable Webcam Scanner&rdquo;
              to scan attendee QR codes using your device camera.
            </div>
          )}
        </div>
      </div>

      {/* Recent Scan Log */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-gray-900">
          Recent Scans ({recentScans.length})
        </h2>

        {recentScans.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No scans recorded in this session yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200">
            {recentScans.map((scan) => (
              <li
                key={scan.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        scan.status === "success"
                          ? "bg-emerald-100 text-emerald-800"
                          : scan.status === "duplicate"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                      }`}
                    >
                      {scan.status.toUpperCase()}
                    </span>
                    <span className="font-medium text-gray-900">
                      {scan.attendeeName ?? scan.message}
                    </span>
                    {scan.ticketCode && (
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                        {scan.ticketCode}
                      </code>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {scan.message} · Mode: {scan.scanMode.toUpperCase()}
                  </p>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(scan.timestamp).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
