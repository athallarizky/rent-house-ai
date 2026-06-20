import { Star, MapPin, MessageSquare, Sparkles, Quote } from "lucide-react";
import type { KosResult } from "../lib/types";
import { tagChipClass, tagLabel } from "../lib/types";
import { cn } from "../lib/utils";

interface KosCardProps {
  kos: KosResult;
  selected?: boolean;
  relevant?: boolean;
  onClick?: () => void;
}

/** Pull the first guest review out of the kos text for a one-line highlight. */
function firstReviewSnippet(text: string, max = 90): string | null {
  const m = text.match(/\[(\d)★\]\s*(.+)/);
  if (!m) return null;
  const t = m[2].trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

export default function KosCard({ kos, selected = false, relevant = false, onClick }: KosCardProps) {
  const snippet = firstReviewSnippet(kos.text || "");
  const gender = (kos.gender || "").trim();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border bg-card p-3 transition-all hover:shadow-sm",
        selected
          ? "border-primary ring-2 ring-primary/15"
          : relevant
            ? "border-2 border-primary bg-primary/5 shadow-sm"
            : "border-border opacity-85 hover:opacity-100"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm leading-snug line-clamp-2 flex-1">
          {kos.name}
        </h4>
        <div className="flex items-center gap-1 shrink-0 text-amber-500 font-bold text-sm">
          <Star className="w-3.5 h-3.5 fill-amber-500" />
          {typeof kos.rating === "number" ? kos.rating.toFixed(1) : kos.rating}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
        {kos.kecamatan && (
          <span className="inline-flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{kos.kecamatan}</span>
          </span>
        )}
        {gender && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {gender}
            </span>
          </>
        )}
      </div>

      {kos.tags?.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {kos.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                tagChipClass(tag)
              )}
            >
              {tagLabel(tag)}
            </span>
          ))}
        </div>
      )}

      {snippet && (
        <div className="mt-2 flex gap-1.5 items-start text-xs italic text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5">
          <Quote className="w-3 h-3 mt-0.5 shrink-0 not-italic" />
          <span className="line-clamp-2">{snippet}</span>
        </div>
      )}

      <div className="flex items-center gap-1 text-xs mt-2">
        <MessageSquare className="w-3 h-3 text-muted-foreground" />
        <span className="text-muted-foreground">{kos.review_count} review</span>
        {relevant && typeof kos.score === "number" && kos.score > 0 && (
          <>
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-0.5 font-semibold text-primary">
              <Sparkles className="w-3 h-3" />
              Cocok {Math.round(kos.score * 100)}%
            </span>
          </>
        )}
      </div>
    </button>
  );
}
