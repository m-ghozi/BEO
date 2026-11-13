import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "./features/auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { EventsListPage } from "./features/public-events/EventsListPage";
import { EventDetailPage } from "./features/public-events/EventDetailPage";
import { MyTicketsPage } from "./features/tickets/MyTicketsPage";
import { ClaimTicketPage } from "./features/tickets/ClaimTicketPage";
import { OrganizerDashboardPage } from "./features/organizer-studio/OrganizerDashboardPage";
import { EventManagePage } from "./features/organizer-studio/EventManagePage";
import { WalletPayoutsPage } from "./features/organizer-studio/WalletPayoutsPage";
import { AgencyPortalPage } from "./features/agency-portal/AgencyPortalPage";
import { CFPPortalPage } from "./features/cfp-review/CFPPortalPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<EventsListPage />} />
        <Route path="events/:slug" element={<EventDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        {/* Protected Routes */}
        <Route
          path="my-tickets"
          element={
            <ProtectedRoute>
              <MyTicketsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="claim"
          element={
            <ProtectedRoute>
              <ClaimTicketPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer"
          element={
            <ProtectedRoute>
              <OrganizerDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer/events/:eventId"
          element={
            <ProtectedRoute>
              <EventManagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer/wallet"
          element={
            <ProtectedRoute>
              <WalletPayoutsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="agency"
          element={
            <ProtectedRoute accountType="agency">
              <AgencyPortalPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="events/:eventId/cfp"
          element={
            <ProtectedRoute>
              <CFPPortalPage />
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
