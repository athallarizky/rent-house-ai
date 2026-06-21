import { useEffect, useState } from "react";
import { Home, Star, MapPin, Loader2 } from "lucide-react";
import { getHealth } from "../lib/api";

interface StatCard {
  icon: typeof Home;
  value: string;
  label: string;
  accent: string;
}

const FALLBACK_CARDS: StatCard[] = [
  { icon: Home, value: "152", label: "Kos terindeks", accent: "text-blue-600" },
  { icon: Star, value: "1.416", label: "Reviews terindex", accent: "text-amber-500" },
  { icon: MapPin, value: "Cengkareng", label: "Area aktif", accent: "text-green-600" },
];

export default function StatsCards() {
  const [cards, setCards] = useState<StatCard[]>(FALLBACK_CARDS);
  const [status, setStatus] = useState<"loading" | "online" | "offline">("loading");

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((data) => {
        if (cancelled) return;
        setStatus("online");
        if (typeof data.entries === "number") {
          setCards((prev) => [
            { ...prev[0], value: data.entries!.toLocaleString("id-ID") },
            prev[1],
            prev[2],
          ]);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full max-w-2xl">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center shadow-sm"
            >
              <Icon className={`w-5 h-5 mx-auto mb-1.5 ${card.accent}`} />
              <div className="text-base sm:text-xl md:text-2xl font-bold tracking-tight break-words leading-tight">
                {status === "loading" && i === 0 ? (
                  <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
                ) : (
                  card.value
                )}
              </div>
              <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                {card.label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs">
        {status === "online" && (
          <span className="inline-flex items-center gap-1 text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            API terhubung
          </span>
        )}
        {status === "offline" && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
            Mode demo (API offline)
          </span>
        )}
        {status === "loading" && (
          <span className="text-muted-foreground">Memuat statistik…</span>
        )}
      </div>
    </div>
  );
}
