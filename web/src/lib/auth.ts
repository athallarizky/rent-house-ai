const AUTH_KEY = "kos-ai.auth";

interface AuthUser {
  email: string;
  role: "admin" | "user";
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

export function getAuth(): AuthState {
  if (typeof localStorage === "undefined") return { token: null, user: null };
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw);
    if (!parsed.token || !parsed.user) return { token: null, user: null };
    if (isTokenExpired(parsed.token)) {
      clearAuth();
      return { token: null, user: null };
    }
    return parsed;
  } catch {
    return { token: null, user: null };
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const auth = getAuth();
  return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

export async function login(email: string, password: string): Promise<AuthState> {
  const { API_URL } = await import("./api");
  const resp = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || "Login gagal");
  }
  const data = await resp.json();
  setAuth(data.token, data.user);
  return { token: data.token, user: data.user };
}

export async function logout() {
  clearAuth();
  window.location.href = "/login";
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { API_URL } = await import("./api");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  const resp = await fetch(`${API_URL}/auth/password`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal mengubah password");
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}
