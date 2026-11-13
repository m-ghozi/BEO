import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors hover:text-indigo-600 ${
      isActive ? "text-indigo-600 font-semibold" : "text-gray-600"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-sm">
                B
              </span>
              <span className="text-lg font-bold tracking-tight text-gray-900">
                BEO
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              <NavLink to="/" end className={navLinkClass}>
                Events
              </NavLink>
              {isAuthenticated && (
                <>
                  <NavLink to="/my-tickets" className={navLinkClass}>
                    My Tickets
                  </NavLink>
                  <NavLink to="/organizer" className={navLinkClass}>
                    Organizer Studio
                  </NavLink>
                  {user?.account_type === "agency" && (
                    <NavLink to="/agency" className={navLinkClass}>
                      Agency Portal
                    </NavLink>
                  )}
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-sm font-medium text-gray-900">
                    {user?.name}
                  </span>
                  <span className="text-xs uppercase tracking-wider text-indigo-600 font-semibold">
                    {user?.account_type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-2xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-indigo-600"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-500">
        <div className="mx-auto max-w-7xl px-4">
          <p>© {new Date().getFullYear()} BEO Platform. Universal Event Management.</p>
        </div>
      </footer>
    </div>
  );
}
export default Layout;
