interface AreaChipsProps {
  areas?: { name: string; emoji?: string }[];
}

const DEFAULT_AREAS: { name: string; emoji: string }[] = [
  { name: "Cengkareng", emoji: "🏙️" },
  { name: "Jakarta Barat", emoji: "🏙️" },
  { name: "Bandung", emoji: "🏙️" },
  { name: "Surabaya", emoji: "🏙️" },
  { name: "Yogyakarta", emoji: "🏙️" },
  { name: "Tangerang", emoji: "🏙️" },
];

export default function AreaChips({ areas = DEFAULT_AREAS }: AreaChipsProps) {
  return (
    <div className="w-full max-w-2xl">
      <p className="text-sm text-muted-foreground mb-3 text-center">
        Area populer:
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {areas.map((area) => (
          <a
            key={area.name}
            href={`/search?area=${encodeURIComponent(area.name)}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors"
          >
            {area.emoji && <span>{area.emoji}</span>}
            <span>{area.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
