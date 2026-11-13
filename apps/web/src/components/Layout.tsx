import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, X, LogOut, Sparkles, ShieldCheck, Building2 } from "lucide-react";
import { useAuth } from "../features/auth/AuthContext";

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    setMobileMenuOpen(false);
    logout();
    navigate("/login");
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
      isActive
        ? "bg-indigo-600/10 text-indigo-700 font-semibold ring-1 ring-inset ring-indigo-600/20"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
    }`;

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-indigo-50 text-indigo-700 font-semibold"
        : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
    }`;

  const renderRoleBadge = (accountType?: string) => {
    if (!accountType) return null;
    if (accountType === "platform_admin") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          platform_admin
        </span>
      );
    }
    if (accountType === "agency") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
          <Building2 className="h-3 w-3" aria-hidden="true" />
          agency
        </span>
      );
    }
    return (
      <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
        {accountType}
      </span>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-7">
            <Link to="/" className="group flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 font-extrabold text-white shadow-sm ring-1 ring-indigo-700/15 transition-transform group-hover:scale-105">
                B
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-extrabold tracking-tight text-slate-950">
                  BEO
                </span>
                <span className="hidden sm:inline-block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Events
                </span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1.5" aria-label="Main navigation">
              <NavLink to="/" end className={navLinkClass}>
                Events
              </NavLink>
              {isAuthenticated && (
                <>
                  <NavLink to="/my-tickets" className={navLinkClass}>
                    My Tickets
                  </NavLink>
                  <NavLink to="/claim" className={navLinkClass}>
                    Claim Ticket
                  </NavLink>
                  <NavLink to="/organizer" className={navLinkClass}>
                    Organizer Studio
                  </NavLink>
                  {user?.account_type === "agency" && (
                    <NavLink to="/agency" className={navLinkClass}>
                      Agency Portal
                    </NavLink>
                  )}
                  {user?.account_type === "platform_admin" && (
                    <NavLink to="/admin" className={navLinkClass}>
                      Admin
                    </NavLink>
                  )}
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end gap-0.5">
                  <span className="text-sm font-semibold leading-none text-slate-900">
                    {user?.name}
                  </span>
                  {renderRoleBadge(user?.account_type)}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-950"
                >
                  <LogOut className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="rounded-xl px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
                >
                  <span>Sign Up</span>
                </Link>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-950 md:hidden"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-md md:hidden">
            {isAuthenticated && user && (
              <div className="mb-3 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-slate-900">{user.name}</span>
                {renderRoleBadge(user.account_type)}
              </div>
            )}
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              <NavLink
                to="/"
                end
                className={mobileNavLinkClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Events
              </NavLink>
              {isAuthenticated && (
                <>
                  <NavLink
                    to="/my-tickets"
                    className={mobileNavLinkClass}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    My Tickets
                  </NavLink>
                  <NavLink
                    to="/claim"
                    className={mobileNavLinkClass}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Claim Ticket
                  </NavLink>
                  <NavLink
                    to="/organizer"
                    className={mobileNavLinkClass}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Organizer Studio
                  </NavLink>
                  {user?.account_type === "agency" && (
                    <NavLink
                      to="/agency"
                      className={mobileNavLinkClass}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Agency Portal
                    </NavLink>
                  )}
                  {user?.account_type === "platform_admin" && (
                    <NavLink
                      to="/admin"
                      className={mobileNavLinkClass}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Admin
                    </NavLink>
                  )}
                </>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200/80 bg-white/70 py-6 text-sm text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 font-medium text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
            <span>BEO Platform — Universal Event Management</span>
          </div>
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} BEO. Crafted for live experiences.
          </p>
        </div>
      </footer>
    </div>
  );
}
export default Layout;
