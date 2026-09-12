import React, { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  User,
  useGetMe,
  getGetMeQueryKey,
  setCredentialsMode,
  setCsrfTokenGetter,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Read the CSRF token the API issues in a deliberately script-readable cookie.
 * Its companion session cookie is `HttpOnly` and cannot be read here — which
 * is the point: the session token is no longer reachable from page scripts,
 * so an XSS anywhere in the app or its dependencies can no longer walk off
 * with a seven-day credential.
 */
function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)gst_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Configure the shared API client once, before any hook can fire a request.
setCredentialsMode("include");
setCsrfTokenGetter(readCsrfCookie);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  /**
   * Whether a session might exist. The session cookie is invisible to script,
   * so the only way to know is to ask the server. `/auth/me` succeeds when the
   * cookie is valid and 401s when it is not, which is also what signs a user
   * out after a revoked or expired session.
   */
  const [maybeSignedIn, setMaybeSignedIn] = useState(true);

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: maybeSignedIn,
      retry: false,
      // The server is the authority on whether the session is still good, so
      // don't serve a stale "signed in" answer across a tab focus.
      refetchOnWindowFocus: true,
    },
  });

  useEffect(() => {
    if (isError) setMaybeSignedIn(false);
  }, [isError]);

  const login = (newUser: User) => {
    // The server has already set the session cookie on the login response.
    setMaybeSignedIn(true);
    queryClient.setQueryData(getGetMeQueryKey(), newUser);
    setLocation(newUser.role === "admin" ? "/admin" : "/dashboard");
  };

  const logout = () => {
    // Only the server can clear an HttpOnly cookie, so tell it to.
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": readCsrfCookie() ?? "" },
    }).catch(() => undefined);

    setMaybeSignedIn(false);
    queryClient.clear();
    setLocation("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading: maybeSignedIn && isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
