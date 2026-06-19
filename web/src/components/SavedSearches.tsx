import { useState } from "react";
import { Plus, Trash2, History, MapPin } from "lucide-react";
import type { SavedSearch } from "../lib/types";
import { cn, formatRelativeTime } from "../lib/utils";

interface SavedSearchesProps {
  searches: SavedSearch[];
  activeSearchId: string | null;
  onSelect: (search: SavedSearch) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function SavedSearches({
  searches,
  activeSearchId,
  onSelect,
  onNew,
  onDelete,
}: SavedSearchesProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Hapus pencarian ini?")) {
      setDeletingId(id);
      onDelete(id);
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-card">
      <div className="p-3 border-b border-border">
        <button
          type="button"
          onClick={onNew}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Pencarian Baru
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {searches.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            <History className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Belum ada riwayat pencarian</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {searches.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-lg transition-colors group relative",
                  activeSearchId === s.id
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-accent border border-transparent"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4
                      className={cn(
                        "text-sm font-medium truncate",
                        activeSearchId === s.id ? "text-primary" : "text-foreground"
                      )}
                    >
                      {s.query_text}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <MapPin className="w-2.5 h-2.5" />
                        {s.area}
                      </span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.result_count} hasil
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {formatRelativeTime(s.created_at)}
                    </p>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleDelete(s.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleDelete(s.id, e as unknown as React.MouseEvent);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1 cursor-pointer"
                    aria-label="Hapus pencarian"
                  >
                    {deletingId === s.id ? (
                      <Trash2 className="w-3.5 h-3.5 animate-pulse" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <p className="text-[11px] text-muted-foreground text-center">
          {searches.length} {searches.length === 1 ? "pencarian" : "pencarian"} tersimpan
        </p>
      </div>
    </div>
  );
}
