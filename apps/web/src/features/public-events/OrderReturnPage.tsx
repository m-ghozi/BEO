import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export function OrderReturnPage() {
  const [searchParams] = useSearchParams();
  const merchantOrderId = searchParams.get("merchantOrderId");
  const resultCode = searchParams.get("resultCode");
  const reference = searchParams.get("reference");

  const isSuccess = resultCode === "00";

  return (
    <div className="mx-auto max-w-xl py-12">
      <div
        className={`rounded-xl border p-8 text-center shadow-xs ${
          isSuccess
            ? "border-green-200 bg-green-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            isSuccess
              ? "bg-green-100 text-green-600"
              : "bg-amber-100 text-amber-600"
          }`}
        >
          {isSuccess ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : (
            <AlertTriangle className="h-6 w-6" />
          )}
        </div>

        <h1
          className={`mt-4 text-2xl font-bold ${
            isSuccess ? "text-green-900" : "text-amber-900"
          }`}
        >
          {isSuccess
            ? "Payment Successful"
            : "Payment Pending or Failed"}
        </h1>

        <p
          className={`mt-2 text-sm ${
            isSuccess ? "text-green-700" : "text-amber-800"
          }`}
        >
          {isSuccess
            ? "Your payment has been received and your order is being processed. Your tickets will appear in My Tickets shortly."
            : "Your payment has not been confirmed yet or was cancelled. Please check My Tickets for the latest status or try again."}
        </p>

        {(merchantOrderId || reference || resultCode) && (
          <dl className="mt-6 space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-left text-sm">
            {merchantOrderId && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Order ID</dt>
                <dd className="font-mono font-medium text-gray-900">
                  {merchantOrderId}
                </dd>
              </div>
            )}
            {reference && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Reference</dt>
                <dd className="font-mono font-medium text-gray-900">
                  {reference}
                </dd>
              </div>
            )}
            {resultCode && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Result Code</dt>
                <dd className="font-mono font-medium text-gray-900">
                  {resultCode}
                </dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/my-tickets"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500"
          >
            Go to My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50"
          >
            Back to Events
          </Link>
        </div>
      </div>
    </div>
  );
}
