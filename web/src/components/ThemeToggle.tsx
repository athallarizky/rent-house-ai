import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { getStoredTheme, storeTheme, applyTheme, type Theme } from "../lib/theme";
import { cn } from "../lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export default function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  // React to OS theme changes while in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const handleChange = (t: Theme) => {
    setTheme(t);
    storeTheme(t);
    applyTheme(t);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-background p-0.5",
        className
      )}
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleChange(opt.value)}
            aria-label={opt.label}
            aria-pressed={active}
            title={opt.label}
            className={cn(
              "inline-flex items-center justify-center rounded-md transition-colors",
              compact ? "w-7 h-7" : "w-8 h-7 px-1",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
