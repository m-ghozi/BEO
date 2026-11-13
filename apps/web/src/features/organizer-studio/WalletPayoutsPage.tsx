import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, ArrowLeft, Landmark, Clock } from "lucide-react";
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

  const {
    data: wallet,
    isLoading,
    error: walletError,
  } = useQuery<WalletDTO>({
    queryKey: ["organizer", "wallet"],
    queryFn: () => apiFetch<WalletDTO>("/v1/organizer/wallet"),
  });

  const {
    data: payouts = [],
    isLoading: payoutsLoading,
    error: payoutsError,
  } = useQuery<PayoutRequestDTO[]>({
    queryKey: ["organizer", "payouts"],
    queryFn: () => apiFetch<PayoutRequestDTO[]>("/v1/organizer/payouts"),
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
      queryClient.invalidateQueries({ queryKey: ["organizer", "payouts"] });
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/organizer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Organizer Studio</span>
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">
            Wallet &amp; Payouts
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            View your available ticket revenue balance and request bank payouts.
          </p>
        </div>
      </div>

      {/* Balance KPI Card */}
      <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg sm:p-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
          <Wallet className="h-4 w-4" aria-hidden="true" />
          <span>Available Balance</span>
        </div>
        {isLoading ? (
          <p className="mt-3 text-lg text-slate-300">Loading wallet...</p>
        ) : walletError ? (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {walletError instanceof Error
              ? walletError.message
              : "Failed to load wallet balance."}
          </p>
        ) : (
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-white tabular-nums sm:text-4xl">
            {formatIDR(wallet?.balance ?? 0)}
          </p>
        )}
      </div>

      {/* Payout Request Form */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-indigo-600" aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-950">Request Payout</h2>
        </div>

        {(validationError || apiErrorMsg) && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {validationError ?? apiErrorMsg}
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            {successMessage}
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="payout-amount"
              className="block text-sm font-semibold text-slate-700"
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
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm tabular-nums shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-name"
              className="block text-sm font-semibold text-slate-700"
            >
              Bank Name
            </label>
            <input
              id="bank-name"
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. BCA, Mandiri"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-account-number"
              className="block text-sm font-semibold text-slate-700"
            >
              Account Number
            </label>
            <input
              id="bank-account-number"
              type="text"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="e.g. 1234567890"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              required
            />
          </div>

          <div>
            <label
              htmlFor="bank-account-name"
              className="block text-sm font-semibold text-slate-700"
            >
              Account Holder Name
            </label>
            <input
              id="bank-account-name"
              type="text"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              placeholder="e.g. PT Acara Indonesia"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              required
            />
          </div>

          <div className="flex justify-end sm:col-span-2">
            <button
              type="submit"
              disabled={payoutMutation.isPending || isLoading}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {payoutMutation.isPending ? "Submitting..." : "Request Payout"}
            </button>
          </div>
        </form>
      </div>

      {/* Payout History */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-slate-500" aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-950">Payout History</h2>
        </div>
        {payoutsLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading payout history...</p>
        ) : payoutsError ? (
          <p role="alert" className="mt-4 text-sm text-rose-600">
            {payoutsError instanceof Error
              ? payoutsError.message
              : "Failed to load payout history."}
          </p>
        ) : payouts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No payout requests submitted yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3.5 text-sm"
              >
                <div>
                  <p className="font-semibold text-slate-950 tabular-nums">
                    {formatIDR(p.amount)} &rarr; {p.bank_name}{" "}
                    <span className="font-mono text-xs text-slate-600">
                      ({p.bank_account_number})
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.bank_account_name} &middot;{" "}
                    {new Date(p.requested_at ?? p.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
