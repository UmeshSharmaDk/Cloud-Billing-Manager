import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearToken, loadToken, saveToken, setSession } from "./api";
import type { User } from "./types";

type Auth = {
  user: User | null;
  ready: boolean;
  /** Resolves to an mfaToken when the account needs an authenticator code next. */
  signIn: (email: string, password: string) => Promise<string | null>;
  finishMfa: (mfaToken: string, code: string) => Promise<void>;
  /** Swap in a new session token (two-factor enrolment issues one) and reload the user. */
  adopt: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const forget = useCallback(async () => {
    setSession(null);
    setUser(null);
    queryClient.clear();
    await clearToken();
  }, [queryClient]);

  useEffect(() => {
    (async () => {
      const saved = await loadToken();
      if (saved) {
        setSession(saved, forget);
        try {
          setUser(await api<User>("/auth/me"));
        } catch {
          // Expired, revoked, or offline: ask to sign in again rather than show stale data.
          await forget();
        }
      }
      setReady(true);
    })();
  }, [forget]);

  const start = useCallback(async (res: { token: string; user: User }) => {
    await saveToken(res.token);
    setSession(res.token, forget);
    setUser(res.user);
  }, [forget]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User } | { mfaRequired: true; mfaToken: string }>("/auth/login", { method: "POST", body: { email, password } });
    if ("mfaRequired" in res) return res.mfaToken;
    await start(res);
    return null;
  }, [start]);

  const finishMfa = useCallback(async (mfaToken: string, code: string) => {
    await start(await api<{ token: string; user: User }>("/auth/mfa/login", { method: "POST", body: { mfaToken, code } }));
  }, [start]);

  const adopt = useCallback(async (token: string) => {
    await saveToken(token);
    setSession(token, forget);
    setUser(await api<User>("/auth/me"));
  }, [forget]);

  const signOut = useCallback(async () => {
    // Revokes this token on the server; sign out locally even if that fails.
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
    await forget();
  }, [forget]);

  return <AuthContext.Provider value={{ user, ready, signIn, finishMfa, adopt, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}
