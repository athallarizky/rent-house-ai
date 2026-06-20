import { useState, useRef, useEffect, useCallback } from "react";
import { Search, MapPin, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { listAreas } from "../lib/api";
import type { AreaEntry } from "../lib/api";

const DEBOUNCE_MS = 250;

interface AreaSwitcherProps {
  disabled?: boolean;
  onSelectArea: (regency: string) => void;
}

export default function AreaSwitcher({ disabled = false, onSelectArea }: AreaSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AreaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    inputRef.current?.focus();
    void search("");
  }, [open]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (q.length > 0 && q.length < 2) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      const areas = await listAreas(q);
      setResults(areas);
      setLoading(false);
    }, DEBOUNCE_MS);
  }, []);

  const handleSelect = (regency: string) => {
    setOpen(false);
    onSelectArea(regency);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-tight",
          "hover:bg-accent cursor-pointer transition-colors text-muted-foreground",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        title="Cari area"
      >
        <Search className="w-3 h-3" />
        <span className="hidden sm:inline">Cari area...</span>
        <ChevronDown className="w-2.5 h-2.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Ketik nama kota/kabupaten..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-72 overflow-y-auto thin-scroll py-1">
            {loading && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Mencari...
              </div>
            )}
            {!loading && results.length === 0 && query.length >= 2 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Tidak ditemukan
              </div>
            )}
            {!loading && results.length === 0 && query.length < 2 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Ketik untuk mencari area
              </div>
            )}
            {results.map((r) => (
              <button
                key={`${r.regency}|${r.province}`}
                type="button"
                onClick={() => handleSelect(r.regency)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors"
              >
                <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.regency.replace(/^Administrasi\s+/i, "")}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.province}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
