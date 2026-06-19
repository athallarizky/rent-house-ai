import { useState, useRef, useEffect } from "react";
import { Search } from "lucide-react";

interface SearchBarProps {
  initialValue?: string;
  placeholder?: string;
}

export default function SearchBar({
  initialValue = "",
  placeholder = 'cth: "kos di Cengkareng wifi kenceng parkir luas"',
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const q = query.trim();
    const target = q ? `/search?q=${encodeURIComponent(q)}` : `/search`;
    window.location.href = target;
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="w-full max-w-2xl">
      <div className="flex items-center gap-2 rounded-2xl border-2 border-border bg-card shadow-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all p-2">
        <div className="pl-3 text-muted-foreground">
          <Search className="w-5 h-5" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
    </form>
  );
}
