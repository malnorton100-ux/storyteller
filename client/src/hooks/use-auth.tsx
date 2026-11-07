import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, queryClient } from "@/lib/queryClient";

export type AuthUser = { id: string; email: string; name: string | null };

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (data: { email: string; password: string }) => Promise<AuthUser>;
  register: (data: { name: string; email: string; password: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const onSignedIn = (u: AuthUser) => {
    queryClient.clear();
    queryClient.setQueryData(["/api/auth/me"], u);
  };

  const loginMutation = useMutation({
    mutationFn: (data: { email: string; password: string }) => postJson("/api/auth/login", data) as Promise<AuthUser>,
    onSuccess: onSignedIn,
  });
  const registerMutation = useMutation({
    mutationFn: (data: { name: string; email: string; password: string }) =>
      postJson("/api/auth/register", data) as Promise<AuthUser>,
    onSuccess: onSignedIn,
  });
  const logoutMutation = useMutation({
    mutationFn: () => postJson("/api/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["/api/auth/me"], null);
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        login: loginMutation.mutateAsync,
        register: registerMutation.mutateAsync,
        logout: async () => {
          await logoutMutation.mutateAsync();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
