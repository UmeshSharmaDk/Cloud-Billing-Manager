import React, { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { User, useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("gst_token"));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Set the global token getter for API calls
  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("gst_token"));
  }, []);

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: {
      enabled: !!token,
      queryKey: getGetMeQueryKey(),
      retry: false,
    },
  });

  // Handle case where token is invalid or expired
  useEffect(() => {
    if (token && !isUserLoading && !user) {
      // If we have a token but fetching user failed, log out
      localStorage.removeItem("gst_token");
      setToken(null);
      setLocation("/login");
    }
  }, [token, user, isUserLoading, setLocation]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("gst_token", newToken);
    setToken(newToken);
    queryClient.setQueryData(getGetMeQueryKey(), newUser);
    if (newUser.role === "admin") {
      setLocation("/admin");
    } else {
      setLocation("/dashboard");
    }
  };

  const logout = () => {
    localStorage.removeItem("gst_token");
    setToken(null);
    queryClient.clear();
    setLocation("/login");
  };

  const isLoading = !!token && isUserLoading;

  return (
    <AuthContext.Provider value={{ user: user || null, token, isLoading, login, logout }}>
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
