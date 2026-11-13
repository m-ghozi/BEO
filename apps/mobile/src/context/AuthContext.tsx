import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LoginSchema,
  RegisterSchema,
  type AuthResponse,
  type UserDTO,
} from "@beo/contracts";
import {
  apiFetch,
  getStoredToken,
  setStoredToken,
  setUnauthorizedHandler,
} from "../services/api";
import { registerForPushNotificationsAsync } from "../services/notifications";

const USER_STORAGE_KEY = "beo_auth_user";

export interface AuthContextValue {
  user: UserDTO | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  syncPushToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readStoredUser(): Promise<UserDTO | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserDTO;
  } catch {
    return null;
  }
}

async function writeStoredUser(user: UserDTO | null): Promise<void> {
  if (user === null) {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

/**
 * Provides authentication state, session persistence, and push token syncing.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(async () => {
    await setStoredToken(null);
    await writeStoredUser(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void writeStoredUser(null);
      setToken(null);
      setUser(null);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          getStoredToken(),
          readStoredUser(),
        ]);
        if (!active) return;
        if (storedToken) {
          setToken(storedToken);
          setUser(storedUser);
        } else {
          await writeStoredUser(null);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const syncPushToken = useCallback(async (): Promise<string | null> => {
    try {
      const pushToken = await registerForPushNotificationsAsync();
      if (!pushToken) {
        return null;
      }
      await apiFetch("/v1/me/push-token", {
        method: "POST",
        body: JSON.stringify({ token: pushToken }),
      });
      return pushToken;
    } catch {
      return null;
    }
  }, []);

  const persistAuthResponse = useCallback(
    async (res: AuthResponse) => {
      await setStoredToken(res.token);
      await writeStoredUser(res.user);
      setToken(res.token);
      setUser(res.user);
      void syncPushToken();
    },
    [syncPushToken]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const parsed = LoginSchema.parse({ email, password });
      const res = await apiFetch<AuthResponse>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      await persistAuthResponse(res);
    },
    [persistAuthResponse]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const parsed = RegisterSchema.parse({
        name,
        email,
        password,
        account_type: "standard",
      });
      const res = await apiFetch<AuthResponse>("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      await persistAuthResponse(res);
    },
    [persistAuthResponse]
  );

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      login,
      register,
      logout,
      syncPushToken,
    }),
    [user, token, isLoading, login, register, logout, syncPushToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Returns the active AuthContext value; must be called inside AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
