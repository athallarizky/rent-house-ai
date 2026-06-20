import { useEffect, useRef } from "react";
import { AlertTriangle, X, Info } from "lucide-react";
import { cn } from "../lib/utils";

export type ConfirmVariant = "default" | "danger";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Custom cancel label; pass `null` to hide the cancel button (alert/info mode). */
  cancelLabel?: string | null;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Reusable confirmation / alert dialog.
 *
 * - Two-button confirm (default): Cancel + Confirm
 * - Single-button alert: pass `cancelLabel={null}`
 * - `variant="danger"` styles the confirm button destructive (for delete actions)
 *
 * Closes on backdrop click or Escape. Replaces native window.confirm / window.alert
 * which can't be styled and block the page.
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  variant = "default",
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // focus the confirm button so Enter activates the primary action
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isDanger = variant === "danger";
  const Icon = isDanger ? AlertTriangle : Info;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <div
            className={cn(
              "w-9 h-9 shrink-0 rounded-lg flex items-center justify-center",
              isDanger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="confirm-title" className="font-semibold text-sm leading-snug">
              {title}
            </h3>
            {message && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 -mt-1 -mr-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          {cancelLabel !== null && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors",
              isDanger ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
