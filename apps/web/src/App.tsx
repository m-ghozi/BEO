import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "./features/auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function HomePlaceholder() {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
          BEO — Universal Event Organizer
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Discover community meetups, hands-on workshops, conferences, and TED-style events.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            to="/register"
            className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Get Started
          </Link>
          <Link
            to="/login"
            className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePlaceholder />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        {/* Protected Routes placeholder for future tasks */}
        <Route
          path="my-tickets"
          element={
            <ProtectedRoute>
              <div className="p-8 text-center text-gray-600">
                <h2 className="text-2xl font-bold">My Tickets</h2>
                <p className="mt-2">Attendee ticket wallet &amp; downloads</p>
              </div>
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer/*"
          element={
            <ProtectedRoute>
              <div className="p-8 text-center text-gray-600">
                <h2 className="text-2xl font-bold">Organizer Studio</h2>
                <p className="mt-2">Manage events, sessions, tickets, and payouts</p>
              </div>
            </ProtectedRoute>
          }
        />
        <Route
          path="agency"
          element={
            <ProtectedRoute accountType="agency">
              <div className="p-8 text-center text-gray-600">
                <h2 className="text-2xl font-bold">Agency Portal</h2>
                <p className="mt-2">Bulk ticket issuance and claim tokens</p>
              </div>
            </ProtectedRoute>
          }
        />
        <Route
          path="events/:eventId/checkin"
          element={
            <ProtectedRoute>
              <div className="p-8 text-center text-gray-600">
                <h2 className="text-2xl font-bold">Venue Check-in Terminal</h2>
                <p className="mt-2">Hardware HID and camera QR scanner</p>
              </div>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <div className="p-12 text-center">
              <h2 className="text-2xl font-bold text-gray-900">404 - Page Not Found</h2>
              <p className="mt-2 text-gray-600">The page you are looking for does not exist.</p>
              <Link to="/" className="mt-4 inline-block font-medium text-indigo-600 hover:text-indigo-500">
                Back to Home
              </Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
