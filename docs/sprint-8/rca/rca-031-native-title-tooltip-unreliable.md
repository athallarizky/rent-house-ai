# RCA-031 — Tooltip native `title` tidak muncul (disabled buttons + delay)

> **Tanggal:** 2026-06-21
> **Sprint:** 9 — Pipeline action dashboard
> **Severity:** Low (UX — user ga bisa lihat info badge/action)
> **Layanan terdampak:** PipelineDashboard (badge tooltips, action buttons, warning icon)
> **Status:** ✅ Resolved

## 1. Ringkasan
Tooltip (`title` attribute) pada badge ✅, warning ⚠️, dan action buttons di
dashboard Pipeline tidak muncul saat hover.

## 2. Gejala
- Hover badge ✅ / ⚠️ / action button → tooltip tidak muncul
- Native `title` attribute di semua 3 elemen

## 3. Root Cause
Dua masalah native `title`:
1. **Disabled buttons**: Chrome **tidak fire mouse events** pada element
   `disabled` → `title` tooltip tidak pernah muncul untuk action buttons saat
   pipeline running (disabled).
2. **Delay 1-2 detik**: native `title` punya delay browser-dependent (Chrome
   ~1.5s), user sering pindah kursor sebelum muncul.

## 4. Perbaikan
Custom CSS tooltip component (`group-hover` Tailwind):
```tsx
function Tooltip({ label, children }) {
  return (
    <span className="relative inline-flex group/tab">
      {children}
      <span className="...opacity-0 group-hover/tab:opacity-100...">
        {label}
      </span>
    </span>
  );
}
```
- **Instant** (no delay).
- **Jalan di disabled buttons** — wrapper `span` tidak disabled, hover terdeteksi.
- **Styled** konsisten (dark bg, shadow, rounded).

## 5. Verifikasi
| Element | Sebelum | Sesudah |
|---------|---------|---------|
| Badge ✅ | no tooltip | count muncul instant |
| Warning ⚠️ | no tooltip | suggestion muncul |
| Action button (disabled) | no tooltip | "Pipeline aktif" muncul |

## 6. Pelajaran
Native `title` unreliable untuk UI modern — pakai custom tooltip utk reliability
+ consistency. Disabled elements butuh non-disabled wrapper.
