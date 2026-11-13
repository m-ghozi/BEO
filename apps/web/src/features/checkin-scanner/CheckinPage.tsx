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
  Keyboard,
  ArrowLeft,
} from "lucide-react";
import { CheckinScanSchema, type CheckinResultDTO } from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useQRScanner } from "./useQRScanner";

type ScanStatus = "success" | "duplicate" | "invalid";

interface ScanLogEntry {
  id: string;
  status: ScanStatus;
  scanMode: "hid" | "webcam" | "manual";
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
  const [manualTicketCode, setManualTicketCode] = useState("");
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
    async (rawPayload: string, scanMode: "hid" | "webcam" | "manual") => {
      if (!eventId || isSubmittingRef.current) {
        return;
      }

      let requestPayload: { qr_payload: string; scan_mode: "hid" | "webcam" | "manual" };
      if (scanMode === "manual") {
        const trimmed = rawPayload.trim();
        if (!trimmed) {
          return;
        }
        requestPayload = { qr_payload: trimmed, scan_mode: "manual" };
      } else {
        const parsed = CheckinScanSchema.safeParse({
          qr_payload: rawPayload,
          scan_mode: scanMode,
        });
        if (!parsed.success) {
          return;
        }
        requestPayload = parsed.data;
      }

      if (scanMode === "webcam") {
        const now = Date.now();
        const prev = lastWebcamScanRef.current;
        if (
          prev &&
          prev.payload === requestPayload.qr_payload &&
          now - prev.at < WEBCAM_COOLDOWN_MS
        ) {
          return;
        }
        lastWebcamScanRef.current = {
          payload: requestPayload.qr_payload,
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
            body: JSON.stringify(requestPayload),
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
          qrPayload: requestPayload.qr_payload,
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
          qrPayload: requestPayload.qr_payload,
          message,
          timestamp: nowIso,
        });
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        if (scanMode === "hid") {
          setHidValue("");
          hidInputRef.current?.focus();
        } else if (scanMode === "manual") {
          setManualTicketCode("");
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

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    void submitScan(manualTicketCode, "manual");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div>
          <Link
            to={eventId ? `/organizer/events/${eventId}` : "/organizer"}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Event Management</span>
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
            Venue Check-in Terminal
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Event ID: <span className="font-mono text-xs text-slate-800">{eventId}</span>
            {user ? ` · Operator: ${user.name}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setWebcamEnabled((prev) => !prev)}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
            webcamEnabled
              ? "bg-slate-950 text-white hover:bg-slate-800"
              : "border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50"
          }`}
        >
          {webcamEnabled ? (
            <>
              <CameraOff className="h-4 w-4" aria-hidden="true" />
              <span>Disable Webcam Scanner</span>
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span>Enable Webcam Scanner</span>
            </>
          )}
        </button>
      </div>

      {/* High-visibility Gate Scan Result Banner */}
      {lastResult && (
        <div
          role={lastResult.status === "success" ? "status" : "alert"}
          className={`rounded-2xl border-2 p-6 shadow-sm ${
            lastResult.status === "success"
              ? "border-emerald-400 bg-emerald-50 text-emerald-950"
              : lastResult.status === "duplicate"
                ? "border-amber-400 bg-amber-50 text-amber-950"
                : "border-rose-400 bg-rose-50 text-rose-950"
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                lastResult.status === "success"
                  ? "bg-emerald-100 text-emerald-700"
                  : lastResult.status === "duplicate"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-rose-100 text-rose-700"
              }`}
            >
              {lastResult.status === "success" ? (
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              ) : lastResult.status === "duplicate" ? (
                <AlertTriangle className="h-7 w-7" aria-hidden="true" />
              ) : (
                <XCircle className="h-7 w-7" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xl font-extrabold tracking-tight">
                {lastResult.status === "success"
                  ? "Check-in Successful"
                  : lastResult.status === "duplicate"
                    ? "Duplicate Scan"
                    : "Check-in Failed"}
              </p>
              <p className="mt-0.5 text-sm font-semibold">{lastResult.message}</p>

              {(lastResult.attendeeName || lastResult.ticketCode) && (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                  {lastResult.attendeeName && (
                    <span>
                      Attendee:{" "}
                      <strong className="font-bold">
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
                      <code className="rounded-lg bg-white/80 px-2 py-0.5 font-mono text-xs font-bold ring-1 ring-black/10">
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
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <ScanBarcode className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold text-slate-950">
              Hardware HID Scanner
            </h2>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Keep this field focused when using a USB/Bluetooth QR barcode
            scanner. Press Enter to submit manually.
          </p>

          <form onSubmit={handleHidSubmit} className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="hid-qr-input"
                className="block text-sm font-semibold text-slate-700"
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
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !hidValue.trim()}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {isSubmitting ? "Verifying Ticket..." : "Check In Ticket"}
            </button>
          </form>
        </div>

        {/* Webcam Scanner */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Camera className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-bold text-slate-950">
                Webcam QR Scanner
              </h2>
            </div>
            {isCameraActive && decoderMode && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {decoderMode === "native"
                  ? "Native BarcodeDetector"
                  : "zxing-wasm Worker"}
              </span>
            )}
          </div>

          {cameraError && (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {cameraError}
            </div>
          )}

          {webcamEnabled ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
            </div>
          ) : (
            <div className="mt-4 flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
              Webcam scanner is off. Click &ldquo;Enable Webcam Scanner&rdquo;
              to scan attendee QR codes using your device camera.
            </div>
          )}
        </div>
      </div>

      {/* Manual Ticket Code Check-in */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-bold text-slate-950">
            Manual Ticket Code Check-in
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Enter a participant&apos;s raw ticket code (e.g.{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
            BEO-XXXX
          </code>
          ) when their screen cannot be scanned.
        </p>

        <form
          onSubmit={handleManualSubmit}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label
              htmlFor="manual-ticket-code-input"
              className="block text-sm font-semibold text-slate-700"
            >
              Manual Ticket Code
            </label>
            <input
              id="manual-ticket-code-input"
              type="text"
              autoComplete="off"
              value={manualTicketCode}
              onChange={(e) => setManualTicketCode(e.target.value)}
              placeholder="e.g. BEO-XXXX"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !manualTicketCode.trim()}
            className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {isSubmitting ? "Checking In..." : "Manual Check-In"}
          </button>
        </form>
      </div>

      {/* Recent Scan Log */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <h2 className="text-lg font-bold text-slate-950">
          Recent Scans ({recentScans.length})
        </h2>

        {recentScans.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No scans recorded in this session yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {recentScans.map((scan) => (
              <li
                key={scan.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        scan.status === "success"
                          ? "bg-emerald-100 text-emerald-800"
                          : scan.status === "duplicate"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {scan.status.toUpperCase()}
                    </span>
                    <span className="font-semibold text-slate-900">
                      {scan.attendeeName ?? scan.message}
                    </span>
                    {scan.ticketCode && (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                        {scan.ticketCode}
                      </code>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {scan.message} · Mode: {scan.scanMode.toUpperCase()}
                  </p>
                </div>
                <span className="text-xs text-slate-400 tabular-nums">
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
