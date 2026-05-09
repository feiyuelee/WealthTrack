import type { AccountBalance, Asset, TradePlan, Transaction, User } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail || payload.message || message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ message: string }>("/api/auth/logout", { method: "POST" }),
  assets: () => request<{ assets: Asset[] }>("/api/assets"),
  accountBalances: () => request<{ accountBalances: AccountBalance[] }>("/api/account-balances"),
  transactions: () => request<{ transactions: Transaction[] }>("/api/transactions"),
  tradePlans: () => request<{ tradePlans: TradePlan[] }>("/api/trade-plans"),
  saveTradePlan: (payload: TradePlan) =>
    request<{ tradePlan: TradePlan }>("/api/trade-plans", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteTradePlan: (id: string) => request<{ message: string }>(`/api/trade-plans/${encodeURIComponent(id)}`, { method: "DELETE" })
};
