import { useState, useRef, useEffect } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "../lib/utils";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function MessageInput({
  onSend,
  disabled = false,
  placeholder = 'cth: "kos di Cengkareng wifi kenceng parkir luas"',
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
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
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              "w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "max-h-40 overflow-y-auto thin-scroll"
            )}
          />
        </div>
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
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> kirim ·{" "}
        <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd> baris baru
      </p>
    </div>
  );
}
