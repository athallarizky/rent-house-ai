import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "../lib/utils";
import { getAuth } from "../lib/auth";

const NAV = [
  { href: "/", label: "Beranda", emoji: "🏡" },
  { href: "/search", label: "Pencarian", emoji: "🔍" },
  { href: "/pipeline", label: "Pipeline", emoji: "📊", admin: true },
  { href: "/users", label: "Users", emoji: "👥", admin: true },
  { href: "/settings", label: "Pengaturan", emoji: "⚙️" },
];

interface MobileNavProps {
  currentPath: string;
}

/**
 * Global navigation (Beranda / Pencarian / Pengaturan) for mobile.
 * Desktop uses the persistent sidebar in DashboardLayout; this island renders
 * a hamburger that opens a drawer overlay so mobile users can navigate between
 * pages (the sidebar is `hidden md:flex`).
 */
export default function MobileNav({ currentPath }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    currentPath === href || (href !== "/" && currentPath.startsWith(href + "/"));

  const isAdmin = getAuth().user?.role === "admin";
  const visibleNav = NAV.filter((item) => !item.admin || isAdmin);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden p-2 -ml-1 rounded-md hover:bg-accent transition-colors"
        aria-label="Buka menu navigasi"
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-64 h-full bg-card border-r border-border shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border p-4">
              <a
                href="/"
                className="flex items-center gap-2"
                onClick={() => setOpen(false)}
              >
                <span className="text-xl">🏠</span>
                <div>
                  <div className="font-bold leading-none">Kos AI</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Cari kos dengan AI
                  </div>
                </div>
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md hover:bg-accent"
                aria-label="Tutup menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {visibleNav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span>{item.emoji}</span>
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="border-t border-border p-4">
              <p className="text-xs text-muted-foreground">Kos AI v0.1.0</p>
            </div>
          </div>
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
