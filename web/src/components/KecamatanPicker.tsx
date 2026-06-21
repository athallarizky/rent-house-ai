import { MapPin, Search } from "lucide-react";
import type { District } from "../lib/types";

interface KecamatanPickerProps {
  districts: District[];
  onPick: (name: string) => void;
  onPickAll?: () => void;
  disabled?: boolean;
}

export default function KecamatanPicker({
  districts,
  onPick,
  onPickAll,
  disabled = false,
}: KecamatanPickerProps) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Pilih kecamatan:
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {districts.map((d) => (
          <button
            key={d.name}
            type="button"
            disabled={disabled}
            onClick={() => onPick(d.name)}
            className="text-left border border-border rounded-lg p-2.5 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
              <div className="font-medium text-sm truncate">{d.name}</div>
            </div>
            {d.postalCodes && d.postalCodes.length > 0 && (
              <div className="text-[11px] text-muted-foreground mt-0.5 pl-5">
                {d.postalCodes.length} kode pos
              </div>
            )}
          </button>
        ))}
      </div>

      {onPickAll && (
        <button
          type="button"
          disabled={disabled}
          onClick={onPickAll}
          className="w-full mt-2 border-2 border-dashed border-border rounded-lg p-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          <Search className="w-3.5 h-3.5" />
          Cari di SEMUA kecamatan (lebih lambat)
        </button>
      )}
    </div>
  );
}
