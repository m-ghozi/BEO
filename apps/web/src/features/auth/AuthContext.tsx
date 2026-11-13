import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type {
  UserDTO,
  AuthResponse,
  AccountType,
  LoginInput,
  RegisterInput,
} from "@beo/contracts";
import { apiFetch } from "../../lib/api";

const TOKEN_KEY = "beo_token";
const USER_KEY = "beo_user";

export interface AuthContextType {
  user: UserDTO | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getInitialUser(): UserDTO | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserDTO) : null;
  } catch {
    return null;
  }
}

function getInitialToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getInitialToken);
  const [user, setUser] = useState<UserDTO | null>(getInitialUser);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beo:unauthorized", handleUnauthorized);
      return () => {
        window.removeEventListener("beo:unauthorized", handleUnauthorized);
      };
    }
  }, [logout]);

  const login = useCallback(async (credentials: LoginInput) => {
    const res = await apiFetch<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });

    setToken(res.token);
    setUser(res.user);

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    }
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    const res = await apiFetch<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });

    setToken(res.token);
    setUser(res.user);

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout,
    }),
    [user, token, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export interface ProtectedRouteProps {
  children?: ReactNode;
  accountType?: AccountType | AccountType[];
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  accountType,
  redirectTo = "/login",
}: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  if (accountType) {
    const allowed = Array.isArray(accountType)
      ? accountType.includes(user?.account_type as AccountType)
      : user?.account_type === accountType;

    if (!allowed) {
      return (
        <div
          role="alert"
          className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <span className="text-2xl font-bold">403</span>
          </div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            Permission Denied (403 Forbidden)
          </h2>
          <p className="max-w-md text-gray-600">
            You do not have the required permissions (
            {Array.isArray(accountType) ? accountType.join(", ") : accountType}
            ) to access this page. Current role: {user?.account_type || "none"}.
          </p>
        </div>
      );
    }
  }

  return children ? <>{children}</> : <Outlet />;
}
