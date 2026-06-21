import { useState } from "react";
import { Loader2 } from "lucide-react";
import { login } from "../lib/auth";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
          await login(email, password);
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get("redirect") || "/search";
          window.location.href = redirect;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Login gagal");
        } finally {
          setLoading(false);
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          placeholder="admin@kos.ai"
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm
                     placeholder:text-muted-foreground focus:outline-none focus:ring-2
                     focus:ring-primary/20 focus:border-primary"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm
                     placeholder:text-muted-foreground focus:outline-none focus:ring-2
                     focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg
                   bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium
                   hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? "Masuk..." : "Masuk"}
      </button>
    </form>
  );
}
