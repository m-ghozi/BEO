import { useState } from "react";
import { Link } from "react-router-dom";
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
  const [proofUrl, setProofUrl] = useState<string>("");
  const [proofSubmitted, setProofSubmitted] = useState<boolean>(false);
  const [proofSubmitting, setProofSubmitting] = useState<boolean>(false);

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

    // Validate attendees
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
        // Request Duitku payment redirect URL
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
    if (!proofUrl.trim()) {
      setError("Please provide a valid proof file URL");
      return;
    }

    setError(null);
    setProofSubmitting(true);
    try {
      await apiFetch<{ status: string }>(`/v1/orders/${manualOrderId}/proof`, {
        method: "POST",
        body: JSON.stringify({
          proof_file_url: proofUrl.trim(),
        }),
      });
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
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mt-3 text-lg font-bold text-green-900">Payment Proof Submitted!</h3>
        <p className="mt-2 text-sm text-green-700">
          Your order is now <strong>pending verification</strong> by the organizer. Once verified, your
          tickets will be sent to <strong>{buyerEmail}</strong>.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <Link
            to="/my-tickets"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-green-500"
          >
            Go to My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50"
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
      <div className="rounded-xl border border-indigo-100 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-bold text-gray-900">Manual Bank Transfer Details</h3>
        <p className="mt-1 text-sm text-gray-600">
          Please transfer the exact total amount to complete your reservation.
        </p>

        <div className="my-4 rounded-lg bg-gray-50 p-4 border border-gray-200">
          <div className="text-sm text-gray-600">Total Due:</div>
          <div className="text-2xl font-bold text-indigo-600">
            IDR {totalPrice.toLocaleString("id-ID")}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-500">Bank:</span> <strong>BCA (Bank Central Asia)</strong>
            </div>
            <div>
              <span className="text-gray-500">Account No:</span> <strong>123-456-7890</strong>
            </div>
            <div>
              <span className="text-gray-500">Account Name:</span> <strong>BEO Events Indonesia</strong>
            </div>
            <div>
              <span className="text-gray-500">Order ID:</span> <span className="font-mono text-xs">{manualOrderId}</span>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleProofSubmit} className="space-y-4">
          <div>
            <label htmlFor="proof-file-url" className="block text-sm font-medium text-gray-700">
              Proof File URL / Transfer Receipt URL
            </label>
            <input
              id="proof-file-url"
              type="url"
              required
              placeholder="https://example.com/receipt.jpg"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Upload your receipt to cloud storage or an image host and paste the public link here.
            </p>
          </div>

          <button
            type="submit"
            disabled={proofSubmitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50"
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
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 text-center">
        <h3 className="text-xl font-bold text-indigo-900">Redirecting to Payment...</h3>
        <p className="mt-2 text-sm text-indigo-700">
          If you are not redirected automatically within a few seconds, click the link below:
        </p>
        <div className="mt-5">
          <a
            href={duitkuPaymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-indigo-500"
          >
            Proceed to Duitku Payment
          </a>
        </div>
      </div>
    );
  }

  // State: Free Instant Confirmation
  if (confirmedOrder) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mt-3 text-xl font-bold text-green-900">Registration Confirmed!</h3>
        <p className="mt-2 text-sm text-green-700">
          Your free tickets for <strong>{event.title}</strong> have been issued. Confirmation details
          have been sent to <strong>{confirmedOrder.buyer_email}</strong>.
        </p>
        {confirmedOrder.tickets && confirmedOrder.tickets.length > 0 && (
          <div className="mt-4 rounded-lg bg-white p-3 text-left border border-green-200">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Issued Tickets ({confirmedOrder.tickets.length})
            </div>
            {confirmedOrder.tickets.map((t) => (
              <div key={t.id} className="flex justify-between py-1 text-sm border-b last:border-0 border-gray-100">
                <span className="font-medium text-gray-900">{t.attendee_name}</span>
                <span className="font-mono text-indigo-600 font-semibold">{t.ticket_code}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-4">
          <Link
            to="/my-tickets"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-green-500"
          >
            View in My Tickets
          </Link>
          <Link
            to="/"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Default: Checkout Form
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-xl font-bold text-gray-900">Select Tickets &amp; Register</h3>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Ticket Tier Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Ticket Type</label>
        <div className="space-y-2">
          {ticketTypes.map((tier) => {
            const isTierSelected = tier.id === selectedTicketTypeId;
            return (
              <label
                key={tier.id}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors ${
                  isTierSelected
                    ? "border-indigo-600 bg-indigo-50/50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="ticket_tier"
                    value={tier.id}
                    checked={isTierSelected}
                    onChange={() => handleTicketTypeChange(tier.id)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  />
                  <div>
                    <div className="font-semibold text-gray-900">{tier.name}</div>
                    {tier.quota && (
                      <div className="text-xs text-gray-500">Available: {tier.quota} tickets</div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-gray-900">
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
        <label htmlFor="ticket-quantity" className="block text-sm font-medium text-gray-700">
          Ticket Quantity
        </label>
        <select
          id="ticket-quantity"
          aria-label="Ticket Quantity"
          value={quantity}
          onChange={(e) => handleQuantityChange(Number(e.target.value))}
          className="mt-1 block w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
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
        <label htmlFor="buyer-email" className="block text-sm font-medium text-gray-700">
          Buyer Email
        </label>
        <input
          id="buyer-email"
          type="email"
          required
          placeholder="your.email@example.com"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Order receipt and ticket claim tokens will be sent to this email.
        </p>
      </div>

      {/* Attendees */}
      <div className="space-y-4 pt-2 border-t border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">
          Attendee Information ({attendees.length})
        </h4>

        {attendees.map((att, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              Ticket #{idx + 1}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`attendee-${idx + 1}-name`}
                  className="block text-xs font-medium text-gray-700"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-xs focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label
                  htmlFor={`attendee-${idx + 1}-email`}
                  className="block text-xs font-medium text-gray-700"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-xs focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payment Method (for paid tickets) */}
      {!isFree && (
        <div className="space-y-2 pt-2 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700">Payment Method</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                paymentMethod === "duitku"
                  ? "border-indigo-600 bg-indigo-50/50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                id="payment-duitku"
                name="payment_method"
                value="duitku"
                checked={paymentMethod === "duitku"}
                onChange={() => setPaymentMethod("duitku")}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
              />
              <span className="text-sm font-medium text-gray-900">
                Duitku (VA / QRIS / E-Wallet)
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                paymentMethod === "manual_transfer"
                  ? "border-indigo-600 bg-indigo-50/50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                id="payment-manual"
                name="payment_method"
                value="manual_transfer"
                checked={paymentMethod === "manual_transfer"}
                onChange={() => setPaymentMethod("manual_transfer")}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
              />
              <span className="text-sm font-medium text-gray-900">
                Manual Transfer / Bank Transfer
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Total & Submit Button */}
      <div className="pt-4 border-t border-gray-200">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-base font-medium text-gray-700">Total</span>
          <span className="text-2xl font-bold text-gray-900">
            {isFree ? "Free" : `IDR ${totalPrice.toLocaleString("id-ID")}`}
          </span>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-indigo-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
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
