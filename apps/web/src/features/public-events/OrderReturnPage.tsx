import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export function OrderReturnPage() {
  const [searchParams] = useSearchParams();
  const merchantOrderId = searchParams.get("merchantOrderId");
  const resultCode = searchParams.get("resultCode");
  const reference = searchParams.get("reference");

  const isSuccess = resultCode === "00";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div
        className={`rounded-3xl border p-8 text-center shadow-sm ${
          isSuccess
            ? "border-emerald-200 bg-emerald-50/70"
            : "border-amber-200 bg-amber-50/70"
        }`}
      >
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            isSuccess
              ? "bg-emerald-100 text-emerald-600"
              : "bg-amber-100 text-amber-600"
          }`}
        >
          {isSuccess ? (
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          )}
        </div>

        <h1
          className={`mt-4 text-2xl font-extrabold tracking-tight ${
            isSuccess ? "text-emerald-950" : "text-amber-950"
          }`}
        >
          {isSuccess ? "Payment Successful" : "Payment Pending or Failed"}
        </h1>

        <p
          className={`mt-2 text-sm leading-relaxed ${
            isSuccess ? "text-emerald-800" : "text-amber-900"
          }`}
        >
          {isSuccess
            ? "Your payment has been received and your order is being processed. Your tickets will appear in My Tickets shortly."
            : "Your payment has not been confirmed yet or was cancelled. Please check My Tickets for the latest status or try again."}
        </p>

        {(merchantOrderId || reference || resultCode) && (
          <dl className="mt-6 space-y-2.5 rounded-2xl border border-slate-200/80 bg-white p-4 text-left text-sm shadow-2xs">
            {merchantOrderId && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Order ID</dt>
                <dd className="font-mono font-semibold text-slate-900">{merchantOrderId}</dd>
              </div>
            )}
            {reference && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Reference</dt>
                <dd className="font-mono font-semibold text-slate-900">{reference}</dd>
              </div>
            )}
            {resultCode && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Result Code</dt>
                <dd className="font-mono font-semibold text-slate-900">{resultCode}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/my-tickets"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
          >
            Go to My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
          >
            Back to Events
          </Link>
        </div>
      </div>
    </div>
  );
}
