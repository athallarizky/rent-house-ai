import { useEffect, useRef, useState } from "react";
import { ChevronDown, MapPin, Check } from "lucide-react";
import type { District } from "../lib/types";
import { cn } from "../lib/utils";

interface DistrictSwitcherProps {
  regency: string | null;
  currentDistrict: string | null;
  siblings: District[];
  onSwitch: (district: string) => void;
  disabled?: boolean;
}

export default function DistrictSwitcher({
  regency,
  currentDistrict,
  siblings,
  onSwitch,
  disabled = false,
}: DistrictSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hasSiblings = siblings.length > 1;
  const regencyShort = regency ? regency.replace(/^Administrasi\s+/i, "") : null;

  const handlePick = (name: string) => {
    setOpen(false);
    if (name !== currentDistrict) onSwitch(name);
  };

  if (!currentDistrict) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin className="w-3 h-3" />
        <span>Pilih area</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => hasSiblings && !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-tight max-w-[180px]",
          hasSiblings && !disabled
            ? "hover:bg-accent cursor-pointer"
            : "cursor-default",
          disabled && "opacity-50"
        )}
        title={hasSiblings ? "Ganti district" : undefined}
      >
        <MapPin className="w-3 h-3 shrink-0 text-primary" />
        {regencyShort && (
          <span className="text-muted-foreground truncate">{regencyShort} ›</span>
        )}
        <span className="font-semibold text-foreground truncate">{currentDistrict}</span>
        {hasSiblings && (
          <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && hasSiblings && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-card">
            <p className="text-[11px] text-muted-foreground">
              District di {regencyShort || regency}
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto thin-scroll py-1">
            {siblings.map((d) => {
              const active = d.name === currentDistrict;
              return (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => handlePick(d.name)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-primary/10 text-primary" : "hover:bg-accent"
                  )}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="w-3 h-3 shrink-0 opacity-60" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  {d.postalCodes && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {d.postalCodes.length}
                    </span>
                  )}
                  {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="px-3 py-1.5 border-t border-border bg-card">
            <p className="text-[10px] text-muted-foreground">
              Memuat ulang data district…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
