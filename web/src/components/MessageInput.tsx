import { useState, useRef, useEffect } from "react";
import { SendHorizontal, ShieldAlert, ChevronDown, Brain, Search } from "lucide-react";
import { cn } from "../lib/utils";
import { validateQuery } from "../lib/sanitize";
import type { ChatMode } from "../lib/types";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  chatMode?: ChatMode;
  onToggleMode?: (mode: ChatMode) => void;
}

const MODE_OPTIONS: { key: ChatMode; label: string; desc: string; Icon: typeof Brain }[] = [
  { key: "ai", label: "AI", desc: "Ringkasan + rekomendasi LLM", Icon: Brain },
  { key: "rag", label: "RAG", desc: "Hasil langsung tanpa LLM", Icon: Search },
];

export default function MessageInput({
  onSend,
  disabled = false,
  placeholder = 'cth: "kos di Cengkareng wifi kenceng parkir luas"',
  chatMode,
  onToggleMode,
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modeOpen]);

  const activeMode = MODE_OPTIONS.find((o) => o.key === chatMode) || MODE_OPTIONS[1];

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    const check = validateQuery(trimmed);
    if (!check.ok) {
      setError(check.reason || "Pesan ditolak.");
      return;
    }
    setError(null);
    onSend(trimmed);
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message]);

  return (
    <div className="border-t border-border bg-card px-3 py-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={ref}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              "w-full resize-none rounded-xl border bg-background px-3.5 py-2.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "max-h-40 overflow-y-auto thin-scroll",
              error ? "border-destructive" : "border-border"
            )}
          />
        </div>
        {onToggleMode && chatMode && (
          <div className="relative" ref={modeRef}>
            <button
              type="button"
              onClick={() => setModeOpen((v) => !v)}
              disabled={disabled}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-2 text-xs font-medium transition-colors",
                "hover:bg-accent disabled:opacity-50",
                chatMode === "ai" ? "text-primary border-primary/30" : "text-muted-foreground"
              )}
              title={activeMode.desc}
            >
              <activeMode.Icon className="w-3.5 h-3.5" />
              <span>{activeMode.label}</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {modeOpen && (
              <div className="absolute right-0 bottom-full z-50 mb-1 w-44 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      onToggleMode(opt.key);
                      setModeOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                      chatMode === opt.key
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    )}
                  >
                    <opt.Icon className="w-3.5 h-3.5 shrink-0" />
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-[10px] opacity-60">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !message.trim()}
          className={cn(
            "inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-xl transition-all",
            "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95",
            "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed disabled:active:scale-100"
          )}
          aria-label="Kirim"
        >
          <SendHorizontal className="w-4 h-4" />
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-destructive">
          <ShieldAlert className="w-3 h-3 shrink-0" />
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> kirim ·{" "}
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd> baris baru
        </p>
      )}
    </div>
  );
}
