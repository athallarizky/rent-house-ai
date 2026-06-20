import { useMemo } from "react";
import {
  ArrowLeft,
  Phone,
  MapPin,
  Star,
  MessageSquare,
  Users,
  ExternalLink,
} from "lucide-react";
import type { KosResult } from "../lib/types";
import { tagChipClass, tagLabel } from "../lib/types";
import { cn } from "../lib/utils";

interface KosDetailProps {
  kos: KosResult;
  onBack: () => void;
}

interface ParsedReview {
  rating: number | null;
  text: string;
}

interface ParsedKos {
  sections: { heading: string; body: string[] };
  reviews: ParsedReview[];
}

function parseKosText(text: string): ParsedKos {
  const lines = text.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  const reviews: ParsedReview[] = [];

  const reviewRe = /\[(\d)★\]\s*(.*)/;

  for (const raw of lines) {
    const line = raw.trim();
    const rmatch = line.match(reviewRe);
    if (rmatch) {
      reviews.push({ rating: Number(rmatch[1]), text: rmatch[2] });
      continue;
    }
    if (line.startsWith("## ")) {
      current = { heading: line.replace(/^##\s+/, ""), body: [] };
      sections.push(current);
    } else if (line.startsWith("# ")) {
      current = { heading: line.replace(/^#\s+/, ""), body: [] };
      sections.push(current);
    } else if (line) {
      if (!current) {
        current = { heading: "Info", body: [] };
        sections.push(current);
      }
      current.body.push(line);
    }
  }

  return { sections: sections[0] ?? { heading: "", body: [] }, reviews };
}

export default function KosDetail({ kos, onBack }: KosDetailProps) {
  const parsed = useMemo(() => parseKosText(kos.text || ""), [kos.text]);
  const mapsUrl = kos.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(kos.place_id)}`
    : `https://www.google.com/maps/search/?api=1&query=${kos.lat},${kos.lon}`;
  const phoneDigits = kos.phone ? kos.phone.replace(/[^\d+]/g, "") : "";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Kembali ke daftar
      </button>

      <div className="flex-1 overflow-y-auto thin-scroll px-3 pb-12 space-y-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-bold text-base leading-snug">{kos.name}</h3>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm mt-2">
            <span className="flex items-center gap-1 text-amber-500 font-semibold">
              <Star className="w-4 h-4 fill-amber-500" />
              {typeof kos.rating === "number" ? kos.rating.toFixed(1) : kos.rating}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <MessageSquare className="w-3.5 h-3.5" />
              {kos.review_count} review
              {parsed.reviews.length > 0 && parsed.reviews.length < kos.review_count && (
                <span className="text-[11px] opacity-60">
                  · {parsed.reviews.length} tersedia
                </span>
              )}
            </span>
            {kos.gender && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3.5 h-3.5" />
                {kos.gender}
              </span>
            )}
            {kos.kecamatan && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />
                {kos.kecamatan}
              </span>
            )}
          </div>

          {kos.tags?.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {kos.tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    tagChipClass(tag)
                  )}
                >
                  {tagLabel(tag)}
                </span>
              ))}
            </div>
          )}
        </div>

        {phoneDigits && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <a
              href={`tel:${phoneDigits}`}
              className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-green-700 hover:bg-green-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Phone className="w-4 h-4" />
                {kos.phone}
              </span>
              <span className="text-xs">Hubungi</span>
            </a>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <span className="text-sm font-medium">Lihat di Google Maps</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {parsed.sections.body.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">{parsed.sections.heading || "Informasi"}</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              {parsed.sections.body.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        )}

        {parsed.reviews.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-3">
              Review tamu ({parsed.reviews.length})
            </h4>
            <div className="space-y-3">
              {parsed.reviews.map((rev, i) => (
                <div key={i} className="border-l-2 border-amber-300 pl-3">
                  <div className="flex items-center gap-1 text-xs text-amber-500 font-semibold mb-0.5">
                    {[...Array(5)].map((_, s) => (
                      <Star
                        key={s}
                        className={cn(
                          "w-3 h-3",
                          rev.rating && s < rev.rating ? "fill-amber-500" : "fill-transparent text-amber-300"
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-sm">{rev.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
