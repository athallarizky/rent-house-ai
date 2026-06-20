import { useState, useRef, useEffect } from "react";
import { Search, ShieldAlert } from "lucide-react";
import { validateQuery } from "../lib/sanitize";

interface SearchBarProps {
  initialValue?: string;
  placeholder?: string;
}

export default function SearchBar({
  initialValue = "",
  placeholder = 'cth: "kos di Cengkareng wifi kenceng parkir luas"',
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const q = query.trim();
    if (q) {
      const check = validateQuery(q);
      if (!check.ok) {
        setError(check.reason || "Pencarian ditolak.");
        return;
      }
    }
    setError(null);
    const target = q ? `/search?q=${encodeURIComponent(q)}` : `/search`;
    window.location.href = target;
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="w-full max-w-2xl">
      <div className={`flex items-center gap-2 rounded-2xl border-2 bg-card shadow-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all p-2 ${error ? "border-destructive" : "border-border"}`}>
        <div className="pl-3 text-muted-foreground">
          <Search className="w-5 h-5" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          aria-label="Cari kos"
          className="flex-1 bg-transparent border-0 outline-none text-base md:text-lg placeholder:text-muted-foreground/70 py-2"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          <Search className="w-4 h-4" />
          <span className="hidden sm:inline">Cari</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
}
