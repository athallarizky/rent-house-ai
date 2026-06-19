import { useMemo } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { Filters, KosResult } from "../lib/types";
import { TAG_LABELS } from "../lib/types";
import { cn } from "../lib/utils";

interface FilterChipsProps {
  results: KosResult[];
  filters: Filters;
  onToggle: (key: string) => void;
  onReset?: () => void;
  activeCount?: number;
}

const FILTER_TAGS = ["wifi", "ac", "parkir", "dapur", "kamar_mandi_dalam"];
const GENDER_OPTIONS: { key: Filters["gender"]; label: string }[] = [
  { key: "putri", label: "Putri" },
  { key: "putra", label: "Putra" },
  { key: "campur", label: "Campur" },
];

export default function FilterChips({
  results,
  filters,
  onToggle,
  onReset,
  activeCount = 0,
}: FilterChipsProps) {
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      for (const t of r.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [results]);

  const genderCounts = useMemo(() => {
    const counts: Record<string, number> = { putri: 0, putra: 0, campur: 0 };
    for (const r of results) {
      const g = (r.gender || "").toLowerCase();
      if (counts[g] !== undefined) counts[g]++;
    }
    return counts;
  }, [results]);

  if (results.length === 0) return null;

  return (
    <div className="border-t border-border bg-card/50 px-4 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Filter</span>
        {activeCount > 0 && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <X className="w-3 h-3" />
            Reset ({activeCount})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTER_TAGS.map((tag) => {
          const active = !!filters[tag];
          const count = tagCounts[tag] || 0;
          if (count === 0 && !active) return null;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              disabled={count === 0}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-30",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              )}
            >
              {TAG_LABELS[tag] || tag}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}

        <span className="w-px self-stretch bg-border mx-1" />

        {GENDER_OPTIONS.map((opt) => {
          const active = filters.gender === opt.key;
          const count = genderCounts[opt.key as keyof typeof genderCounts] || 0;
          if (count === 0 && !active) return null;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onToggle(opt.key as string)}
              disabled={count === 0}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-30",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              )}
            >
              {opt.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
