import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  CreditCard,
  Landmark,
  UploadCloud,
  Ticket,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import type { EventDTO, TicketTypeDTO, OrderDTO } from "@beo/contracts";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

export interface CheckoutFormProps {
  event: Pick<EventDTO, "id" | "title" | "slug"> | EventDTO;
  ticketTypes: TicketTypeDTO[];
  onSuccess?: (order: OrderDTO) => void;
}

interface AttendeeFormState {
  name: string;
  email: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutForm({ event, ticketTypes, onSuccess }: CheckoutFormProps) {
  const { user } = useAuth();

  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<string>(
    ticketTypes[0]?.id || ""
  );
  const [buyerEmail, setBuyerEmail] = useState<string>(user?.email || "");
  const [quantity, setQuantity] = useState<number>(1);
  const [attendees, setAttendees] = useState<AttendeeFormState[]>([
    { name: user?.name || "", email: user?.email || "" },
  ]);
  const [paymentMethod, setPaymentMethod] = useState<"free" | "duitku" | "manual_transfer">(
    (ticketTypes[0]?.price === 0 ? "free" : "duitku") as "free" | "duitku" | "manual_transfer"
  );

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Success states
  const [confirmedOrder, setConfirmedOrder] = useState<OrderDTO | null>(null);
  const [duitkuPaymentUrl, setDuitkuPaymentUrl] = useState<string | null>(null);
  const [manualOrderId, setManualOrderId] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState<string>("");
  const [proofSubmitted, setProofSubmitted] = useState<boolean>(false);
  const [proofSubmitting, setProofSubmitting] = useState<boolean>(false);
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);

  const selectedTicket = ticketTypes.find((t) => t.id === selectedTicketTypeId) || ticketTypes[0];
  const isFree = selectedTicket ? selectedTicket.price === 0 : false;
  const totalPrice = selectedTicket ? selectedTicket.price * quantity : 0;

  const handleTicketTypeChange = (id: string) => {
    setSelectedTicketTypeId(id);
    const chosen = ticketTypes.find((t) => t.id === id);
    if (chosen && chosen.price === 0) {
      setPaymentMethod("free");
    } else if (paymentMethod === "free") {
      setPaymentMethod("duitku");
    }
  };

  const handleQuantityChange = (newQty: number) => {
    const validQty = Math.max(1, Math.min(10, newQty));
    setQuantity(validQty);
    setAttendees((prev) => {
      const updated = [...prev];
      if (updated.length < validQty) {
        while (updated.length < validQty) {
          updated.push({ name: "", email: "" });
        }
      } else {
        return updated.slice(0, validQty);
      }
      return updated;
    });
  };

  const handleAttendeeChange = (index: number, field: "name" | "email", value: string) => {
    setAttendees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedTicket) {
      setError("Please select a ticket type");
      return;
    }

    if (!buyerEmail.trim() || !EMAIL_REGEX.test(buyerEmail.trim())) {
      setError("A valid buyer email is required");
      return;
    }

    for (let i = 0; i < attendees.length; i++) {
      const att = attendees[i];
      if (!att.name.trim() || !att.email.trim() || !EMAIL_REGEX.test(att.email.trim())) {
        setError("Each attendee must have a valid name and email");
        return;
      }
    }

    const effectivePaymentMethod = isFree ? "free" : paymentMethod;

    setIsSubmitting(true);
    try {
      const order = await apiFetch<OrderDTO>(`/v1/events/${event.id}/orders`, {
        method: "POST",
        body: JSON.stringify({
          ticket_type_id: selectedTicket.id,
          buyer_email: buyerEmail.trim(),
          payment_method: effectivePaymentMethod,
          attendees: attendees.map((a) => ({
            name: a.name.trim(),
            email: a.email.trim(),
          })),
        }),
      });

      if (onSuccess) {
        onSuccess(order);
      }

      if (effectivePaymentMethod === "free") {
        setConfirmedOrder(order);
      } else if (effectivePaymentMethod === "duitku") {
        const payRes = await apiFetch<{ payment_url: string }>(
          `/v1/orders/${order.id}/pay/duitku`,
          { method: "POST" }
        );
        setDuitkuPaymentUrl(payRes.payment_url);
        try {
          if (typeof window !== "undefined" && typeof window.location.assign === "function") {
            window.location.assign(payRes.payment_url);
          }
        } catch {
          // fallback if test environment or blocked
        }
      } else if (effectivePaymentMethod === "manual_transfer") {
        setManualOrderId(order.id);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to place order";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProofSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrderId) return;
    if (!proofFile && !proofUrl.trim()) {
      setError("Please upload a receipt file or provide a valid proof file URL");
      return;
    }

    setError(null);
    setProofSubmitting(true);
    try {
      if (proofFile) {
        const formData = new FormData();
        formData.append("file", proofFile);
        await apiFetch<{ status: string; proof_file_url?: string }>(
          `/v1/orders/${manualOrderId}/proof-upload`,
          {
            method: "POST",
            body: formData,
          }
        );
      } else {
        await apiFetch<{ status: string }>(`/v1/orders/${manualOrderId}/proof`, {
          method: "POST",
          body: JSON.stringify({
            proof_file_url: proofUrl.trim(),
          }),
        });
      }
      setProofSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit payment proof";
      setError(message);
    } finally {
      setProofSubmitting(false);
    }
  };

  // State: Manual Transfer Proof Submitted
  if (proofSubmitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center shadow-2xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-lg font-bold text-emerald-950">Payment Proof Submitted!</h3>
        <p className="mt-2 text-sm text-emerald-800">
          Your order is now <strong>pending verification</strong> by the organizer. Once verified, your
          tickets will be sent to <strong>{buyerEmail}</strong>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/my-tickets"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-500"
          >
            Go to My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
          >
            Explore More Events
          </Link>
        </div>
      </div>
    );
  }

  // State: Manual Transfer Pending Proof
  if (manualOrderId) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-bold tracking-tight text-slate-950">
          Manual Bank Transfer Details
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Please transfer the exact total amount to complete your reservation.
        </p>

        <div className="my-5 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Due
          </div>
          <div className="mt-0.5 text-2xl font-extrabold text-indigo-600 tabular-nums">
            IDR {totalPrice.toLocaleString("id-ID")}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-200/80 pt-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Bank:</span>{" "}
              <strong className="text-slate-900">BCA (Bank Central Asia)</strong>
            </div>
            <div>
              <span className="text-slate-500">Account No:</span>{" "}
              <strong className="font-mono text-slate-900">123-456-7890</strong>
            </div>
            <div>
              <span className="text-slate-500">Account Name:</span>{" "}
              <strong className="text-slate-900">BEO Events Indonesia</strong>
            </div>
            <div>
              <span className="text-slate-500">Order ID:</span>{" "}
              <span className="font-mono text-xs text-slate-800">{manualOrderId}</span>
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleProofSubmit} className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-4 transition-colors hover:border-indigo-300">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <UploadCloud className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              <label htmlFor="proof-file-upload" className="cursor-pointer">
                Upload Transfer Receipt (Image or PDF)
              </label>
            </div>
            <input
              id="proof-file-upload"
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
            />
            {proofFile && (
              <p className="mt-2 text-xs font-medium text-indigo-600">
                Selected file: {proofFile.name}
              </p>
            )}
          </div>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="mx-3 flex-shrink text-xs font-medium uppercase tracking-wider text-slate-400">
              or paste URL
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <div>
            <label htmlFor="proof-file-url" className="block text-sm font-medium text-slate-700">
              Proof File URL / Transfer Receipt URL
            </label>
            <input
              id="proof-file-url"
              type="url"
              placeholder="https://example.com/receipt.jpg"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">
              Alternatively, upload your receipt to cloud storage and paste the public link here.
            </p>
          </div>

          <button
            type="submit"
            disabled={proofSubmitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {proofSubmitting ? "Submitting..." : "Submit Payment Proof"}
          </button>
        </form>
      </div>
    );
  }

  // State: Duitku Redirection
  if (duitkuPaymentUrl) {
    return (
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-6 text-center shadow-2xs">
        <h3 className="text-xl font-bold text-indigo-950">Redirecting to Payment...</h3>
        <p className="mt-2 text-sm text-indigo-800">
          If you are not redirected automatically within a few seconds, click the link below:
        </p>
        <div className="mt-5">
          <a
            href={duitkuPaymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            <span>Proceed to Duitku Payment</span>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    );
  }

  // State: Free Instant Confirmation
  if (confirmedOrder) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center shadow-2xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-xl font-bold text-emerald-950">Registration Confirmed!</h3>
        <p className="mt-2 text-sm text-emerald-800">
          Your free tickets for <strong>{event.title}</strong> have been issued. Confirmation details
          have been sent to <strong>{confirmedOrder.buyer_email}</strong>.
        </p>
        {confirmedOrder.tickets && confirmedOrder.tickets.length > 0 && (
          <div className="mt-5 rounded-xl border border-emerald-200/80 bg-white p-4 text-left shadow-2xs">
            <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Ticket className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>Issued Tickets ({confirmedOrder.tickets.length})</span>
            </div>
            <div className="divide-y divide-slate-100">
              {confirmedOrder.tickets.map((t) => {
                const claimPath = t.claim_token
                  ? `/claim?token=${encodeURIComponent(t.claim_token)}`
                  : null;
                return (
                  <div key={t.id} className="space-y-1.5 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{t.attendee_name}</span>
                      <span className="font-mono text-xs font-semibold text-indigo-600">
                        {t.ticket_code}
                      </span>
                    </div>
                    {t.claim_token && claimPath && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                        <span className="truncate">
                          Claim Token:{" "}
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">
                            {t.claim_token}
                          </code>
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Link
                            to={claimPath}
                            className="font-semibold text-indigo-600 underline hover:text-indigo-500"
                          >
                            Claim Ticket
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              const fullUrl =
                                typeof window !== "undefined" && window.location?.origin
                                  ? `${window.location.origin}${claimPath}`
                                  : claimPath;
                              void navigator.clipboard?.writeText(fullUrl);
                              setCopiedTicketId(t.id);
                              setTimeout(() => {
                                setCopiedTicketId((prev) => (prev === t.id ? null : prev));
                              }, 2000);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            {copiedTicketId === t.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                <span>Copy Claim Link</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/my-tickets"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-500"
          >
            View in My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Default: Checkout Form
  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <h3 className="text-xl font-bold tracking-tight text-slate-950">
          Select Tickets &amp; Register
        </h3>
        <Ticket className="h-5 w-5 text-indigo-600" aria-hidden="true" />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {/* Ticket Tier Selection */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">Ticket Type</label>
        <div className="space-y-2.5">
          {ticketTypes.map((tier) => {
            const isTierSelected = tier.id === selectedTicketTypeId;
            return (
              <label
                key={tier.id}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all ${
                  isTierSelected
                    ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600/20"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="ticket_tier"
                    value={tier.id}
                    checked={isTierSelected}
                    onChange={() => handleTicketTypeChange(tier.id)}
                    className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <div className="font-semibold text-slate-950">{tier.name}</div>
                    {tier.quota && (
                      <div className="text-xs text-slate-500 tabular-nums">
                        Available: {tier.quota} tickets
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-slate-950 tabular-nums">
                    {tier.price === 0 ? "Free" : `IDR ${tier.price.toLocaleString("id-ID")}`}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Ticket Quantity */}
      <div>
        <label htmlFor="ticket-quantity" className="block text-sm font-semibold text-slate-700">
          Ticket Quantity
        </label>
        <select
          id="ticket-quantity"
          aria-label="Ticket Quantity"
          value={quantity}
          onChange={(e) => handleQuantityChange(Number(e.target.value))}
          className="mt-1.5 block w-36 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "ticket" : "tickets"}
            </option>
          ))}
        </select>
      </div>

      {/* Buyer Email */}
      <div>
        <label htmlFor="buyer-email" className="block text-sm font-semibold text-slate-700">
          Buyer Email
        </label>
        <input
          id="buyer-email"
          type="email"
          required
          placeholder="your.email@example.com"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          Order receipt and ticket claim tokens will be sent to this email.
        </p>
      </div>

      {/* Attendees */}
      <div className="space-y-4 border-t border-slate-200/80 pt-4">
        <h4 className="text-sm font-semibold text-slate-900">
          Attendee Information ({attendees.length})
        </h4>

        {attendees.map((att, idx) => (
          <div
            key={idx}
            className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Ticket #{idx + 1}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`attendee-${idx + 1}-name`}
                  className="block text-xs font-medium text-slate-700"
                >
                  Attendee {idx + 1} Name
                </label>
                <input
                  id={`attendee-${idx + 1}-name`}
                  type="text"
                  required
                  placeholder="Full name"
                  value={att.name}
                  onChange={(e) => handleAttendeeChange(idx, "name", e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <label
                  htmlFor={`attendee-${idx + 1}-email`}
                  className="block text-xs font-medium text-slate-700"
                >
                  Attendee {idx + 1} Email
                </label>
                <input
                  id={`attendee-${idx + 1}-email`}
                  type="email"
                  required
                  placeholder="email@example.com"
                  value={att.email}
                  onChange={(e) => handleAttendeeChange(idx, "email", e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payment Method (for paid tickets) */}
      {!isFree && (
        <div className="space-y-2.5 border-t border-slate-200/80 pt-4">
          <label className="block text-sm font-semibold text-slate-700">Payment Method</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                paymentMethod === "duitku"
                  ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600/20"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                id="payment-duitku"
                name="payment_method"
                value="duitku"
                checked={paymentMethod === "duitku"}
                onChange={() => setPaymentMethod("duitku")}
                className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <CreditCard className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
              <span className="text-sm font-medium text-slate-900">
                Duitku (VA / QRIS / E-Wallet)
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                paymentMethod === "manual_transfer"
                  ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600/20"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                id="payment-manual"
                name="payment_method"
                value="manual_transfer"
                checked={paymentMethod === "manual_transfer"}
                onChange={() => setPaymentMethod("manual_transfer")}
                className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <Landmark className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
              <span className="text-sm font-medium text-slate-900">
                Manual Transfer / Bank Transfer
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Total & Submit Button */}
      <div className="border-t border-slate-200/80 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">Total</span>
          <span className="text-2xl font-extrabold text-slate-950 tabular-nums">
            {isFree ? "Free" : `IDR ${totalPrice.toLocaleString("id-ID")}`}
          </span>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {isSubmitting
            ? "Processing..."
            : isFree
            ? "Complete Registration"
            : "Reserve Tickets & Pay"}
        </button>
      </div>
    </form>
  );
}

export default CheckoutForm;
