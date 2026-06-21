import { useEffect, useState, type ReactNode } from "react";
import { getAuth } from "../lib/auth";

interface Props {
  children: ReactNode;
  adminOnly?: boolean;
  fallback?: ReactNode;
}

export default function AuthGuard({ children, adminOnly, fallback }: Props) {
  const [status, setStatus] = useState<"loading" | "ok" | "redirect">("loading");

  useEffect(() => {
    const auth = getAuth();

    if (!auth.token || !auth.user) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || window.location.pathname;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
      return;
    }

    if (adminOnly && auth.user.role !== "admin") {
      window.location.href = "/search";
      return;
    }

    setStatus("ok");
  }, [adminOnly]);

  if (status === "loading") {
    return <>{fallback ?? <DefaultFallback />}</>;
  }

  return <>{children}</>;
}

function DefaultFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-sm text-muted-foreground animate-pulse">
        Memeriksa akses...
      </div>
    </div>
  );
}
