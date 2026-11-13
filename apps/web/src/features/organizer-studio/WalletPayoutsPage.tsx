import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PayoutRequestSchema,
  type PayoutRequestDTO,
  type WalletDTO,
} from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function WalletPayoutsPage() {
  const queryClient = useQueryClient();

  const [amountInput, setAmountInput] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recentPayouts, setRecentPayouts] = useState<PayoutRequestDTO[]>([]);

  const {
    data: wallet,
    isLoading,
    error: walletError,
  } = useQuery<WalletDTO>({
    queryKey: ["organizer", "wallet"],
    queryFn: () => apiFetch<WalletDTO>("/v1/organizer/wallet"),
  });

  const payoutMutation = useMutation({
    mutationFn: (payload: {
      amount: number;
      bank_name: string;
      bank_account_number: string;
      bank_account_name: string;
    }) =>
      apiFetch<PayoutRequestDTO>("/v1/organizer/payouts", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["organizer", "wallet"] });
      setRecentPayouts((prev) => [created, ...prev]);
      setAmountInput("");
      setBankName("");
      setBankAccountNumber("");
      setBankAccountName("");
      setValidationError(null);
      setSuccessMessage(
        `Payout request of ${formatIDR(created.amount)} submitted (${created.status}).`
      );
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    const amount = Number(amountInput);
    const balance = wallet?.balance ?? 0;

    if (!Number.isFinite(amount) || amount <= 0) {
      setValidationError("Payout amount must be greater than 0.");
      return;
    }

    if (amount > balance) {
      setValidationError("Payout amount exceeds available wallet balance.");
      return;
    }

    const parsed = PayoutRequestSchema.safeParse({
      amount: Math.floor(amount),
      bank_name: bankName,
      bank_account_number: bankAccountNumber,
      bank_account_name: bankAccountName,
    });

    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "Invalid payout request details."
      );
      return;
    }

    payoutMutation.mutate(parsed.data);
  };

  const apiErrorMsg =
    payoutMutation.error instanceof ApiError
      ? payoutMutation.error.message
      : payoutMutation.error instanceof Error
        ? payoutMutation.error.message
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/organizer"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            &larr; Back to Organizer Studio
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            Wallet &amp; Payouts
          </h1>
          <p className="text-sm text-gray-600">
            View your available ticket revenue balance and request bank payouts.
          </p>
        </div>
      </div>

      {/* Balance Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
        <p className="text-sm font-medium text-gray-500">Available Balance</p>
        {isLoading ? (
          <p className="mt-2 text-lg text-gray-400">Loading wallet...</p>
        ) : walletError ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {walletError instanceof Error
              ? walletError.message
              : "Failed to load wallet balance."}
          </p>
        ) : (
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
            {formatIDR(wallet?.balance ?? 0)}
          </p>
        )}
      </div>

      {/* Payout Request Form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-gray-900">Request Payout</h2>

        {(validationError || apiErrorMsg) && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {validationError ?? apiErrorMsg}
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            {successMessage}
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="payout-amount"
              className="block text-sm font-medium text-gray-700"
            >
              Amount (IDR)
            </label>
            <input
              id="payout-amount"
              type="number"
              min="1"
              step="1"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="e.g. 250000"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-name"
              className="block text-sm font-medium text-gray-700"
            >
              Bank Name
            </label>
            <input
              id="bank-name"
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. BCA, Mandiri"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-account-number"
              className="block text-sm font-medium text-gray-700"
            >
              Account Number
            </label>
            <input
              id="bank-account-number"
              type="text"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="e.g. 1234567890"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-account-name"
              className="block text-sm font-medium text-gray-700"
            >
              Account Holder Name
            </label>
            <input
              id="bank-account-name"
              type="text"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              placeholder="e.g. PT Acara Indonesia"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={payoutMutation.isPending || isLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50"
            >
              {payoutMutation.isPending ? "Submitting..." : "Request Payout"}
            </button>
          </div>
        </form>
      </div>

      {/* Recent Payouts (session) */}
      {recentPayouts.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-gray-900">
            Submitted Payout Requests
          </h2>
          <ul className="mt-4 divide-y divide-gray-200">
            {recentPayouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {formatIDR(p.amount)} &rarr; {p.bank_name} ({p.bank_account_number})
                  </p>
                  <p className="text-xs text-gray-500">{p.bank_account_name}</p>
                </div>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
