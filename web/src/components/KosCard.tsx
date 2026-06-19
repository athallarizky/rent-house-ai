import { Star, MapPin, MessageSquare } from "lucide-react";
import type { KosResult } from "../lib/types";
import { tagChipClass, tagLabel } from "../lib/types";
import { cn } from "../lib/utils";

interface KosCardProps {
  kos: KosResult;
  selected?: boolean;
  onClick?: () => void;
}

export default function KosCard({ kos, selected = false, onClick }: KosCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border bg-card p-3 transition-all hover:border-primary/60 hover:shadow-sm",
        selected ? "border-primary ring-2 ring-primary/15" : "border-border"
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

      {kos.kecamatan && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <MapPin className="w-3 h-3" />
          <span className="truncate">{kos.kecamatan}</span>
        </div>
      )}

      {kos.tags?.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {kos.tags.slice(0, 4).map((tag) => (
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

      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
        <MessageSquare className="w-3 h-3" />
        <span>{kos.review_count} review</span>
        {typeof kos.score === "number" && kos.score > 0 && (
          <>
            <span className="mx-1">·</span>
            <span className="text-primary font-medium">
              {Math.round(kos.score * 100)}% cocok
            </span>
          </>
        )}
      </div>
    </button>
  );
}
