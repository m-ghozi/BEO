import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, User, Building2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import { RegisterSchema } from "@beo/contracts";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"standard" | "agency">("standard");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = RegisterSchema.safeParse({
      name,
      email,
      password,
      account_type: accountType,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid input");
      return;
    }

    try {
      setLoading(true);
      await register({
        name,
        email,
        password,
        account_type: accountType,
      });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to create account. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[72vh] items-center justify-center py-8">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/15">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">
            Create a BEO Account
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Register as an attendee, event organizer, or corporate agency
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-semibold text-slate-700"
            >
              Full name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              placeholder="Alex Johnson"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-semibold text-slate-700"
            >
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              placeholder="alex@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-slate-700"
            >
              Password (min 6 characters)
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Account Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex cursor-pointer flex-col items-center rounded-xl border p-3.5 text-center transition-all ${
                  accountType === "standard"
                    ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="account_type"
                  value="standard"
                  checked={accountType === "standard"}
                  onChange={() => setAccountType("standard")}
                  className="sr-only"
                />
                <User className="mb-1.5 h-4 w-4 text-indigo-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-950">Standard</span>
                <span className="text-xs text-slate-500">Attendee / Organizer</span>
              </label>

              <label
                className={`flex cursor-pointer flex-col items-center rounded-xl border p-3.5 text-center transition-all ${
                  accountType === "agency"
                    ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="account_type"
                  value="agency"
                  checked={accountType === "agency"}
                  onChange={() => setAccountType("agency")}
                  className="sr-only"
                />
                <Building2 className="mb-1.5 h-4 w-4 text-indigo-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-950">Agency</span>
                <span className="text-xs text-slate-500">Bulk Ticket Partner</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-indigo-600 hover:text-indigo-500"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
export default RegisterPage;
