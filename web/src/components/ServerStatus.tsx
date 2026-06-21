import { useEffect, useState } from "react";
import {
  Server,
  Globe,
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getServicesHealth, type ServicesHealth } from "../lib/api";

interface ServiceRow {
  key: "fastapi" | "geo_router" | "rag";
  label: string;
  desc: string;
  icon: typeof Server;
}

const ROWS: ServiceRow[] = [
  { key: "fastapi", label: "FastAPI", desc: "API utama (:8080)", icon: Server },
  { key: "geo_router", label: "Geo-Router", desc: "Resolusi area (:3001)", icon: Globe },
  { key: "rag", label: "RAG / ChromaDB", desc: "Index kos", icon: Database },
];

export default function ServerStatus() {
  const [data, setData] = useState<ServicesHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    getServicesHealth()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Status Server</h2>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {ROWS.map((row) => {
          const status = data?.[row.key];
          const ok = status?.ok;
          const Icon = row.icon;
          return (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
            >
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{row.label}</div>
                <div className="text-xs text-muted-foreground">
                  {row.desc}
                  {row.key === "rag" && typeof status?.entries === "number" && ok
                    ? ` · ${status.entries.toLocaleString("id-ID")} kos`
                    : ""}
                </div>
              </div>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
              ) : ok ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  Online
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive shrink-0">
                  <XCircle className="w-4 h-4" />
                  Offline
                </span>
              )}
            </div>
          );
        })}
      </div>

      {data && !data.all_ok && !loading && (
        <p className="mt-3 text-xs text-muted-foreground">
          Salah satu service offline. Jalankan geo-router (`services/geo-router`) dan/atau
          FastAPI (`api`) sesuai kebutuhan.
        </p>
      )}
    </section>
  );
}
