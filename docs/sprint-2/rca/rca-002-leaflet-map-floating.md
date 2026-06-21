# RCA-002 — Leaflet Map "Mengambang" di Panel Kanan

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Phase 3 (3-Panel Dashboard)
> **Severity:** Medium (map tidak usable, tapi tidak block fitur lain)
> **Komponen:** `MapView.tsx`, `KosCardList.tsx`, `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Saat tab **Map** di panel kanan diaktifkan, peta Leaflet "mengambang" — keluar dari
container, menumpang ke layar/panel lain, bukan duduk manis di dalam panel 320px.
Tiga akar masalah yang saling berkaitan, semuanya konfigurasi/boilerplate Leaflet
yang ketinggalan, bukan logika bisnis:

1. **CSS Leaflet tidak pernah di-import** (penyebab utama).
2. **Wrapper flex tidak punya `min-h-0`** → tinggi container tidak ter-resolve.
3. **Tidak ada `invalidateSize`** saat container resize/toggle.

---

## 2. Gejala

- Tile peta render di luar kotak panel, menutupi chat / panel kiri.
- Marker & popup muncul di posisi yang salah relatif terhadap tile.
- Layout panel kanan jadi rusak / overflow saat mode Map aktif.

---

## 3. Root Cause Analysis

### RC-1 — `leaflet/dist/leaflet.css` belum di-import (kritis)

**Lokasi:** `web/src/components/MapView.tsx`

Sebelum fix, `MapView` meng-import `react-leaflet` + gambar marker, **tapi tidak
CSS Leaflet**:

```tsx
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
// ❌ tidak ada import "leaflet/dist/leaflet.css";
```

**Mekanisme kegagalan:** Leaflet menyusun peta dari beberapa *pane* yang semuanya
`position: absolute` relatif terhadap `.leaflet-container` (yang `position: relative`
+ overflow hidden). Seluruh aturan itu ada di `leaflet.css`. Tanpa CSS:

- `.leaflet-container` tidak jadi positioning context → pane absolute merujuk ke
  ancestor yang lebih atas (bahkan `<body>`).
- Tile layer tidak di-clip → tumpah ke luar panel.
- Z-index pane kacau → kontrol & marker bisa menumpang elemen lain.

Akibatnya peta terlihat "mengambang" di layar. `globals.css` hanya menambah
`.leaflet-container { width:100%; height:100% }` (sizing), bukan positioning —
jadi tidak cukup.

> Catatan: `react-leaflet` sengaja **tidak** include CSS-nya; developer harus
> meng-import `leaflet/dist/leaflet.css` sendiri. Ini terlupa saat impl Phase 3.

### RC-2 — wrapper flex tidak `min-h-0`

**Lokasi:** `KosCardList.tsx` (mode map) + `ChatInterface.tsx` (panel kanan)

```tsx
// KosCardList — sebelum
<div className="flex-1 relative">        {/* ❌ min-height: auto */}
  <MapView ... />
</div>
```

**Mekanisme:** flex item default `min-height: auto`, artinya ia **tidak mau**
menyusut di bawah ukuran kontennya. MapContainer minta `height:100%`, tapi karena
ancestor flex-nya tidak memberi tinggi konkret (hanya `flex: 1` tanpa `min-h-0`),
tinggi `100%` tidak ter-resolve ke pixel → Leaflet ambil ukuran default/overflow.

Setelah fix: `flex-1 min-h-0 relative` + panel kanan ditambah `h-full overflow-hidden`
agar rantai tinggi dari `ChatInterface (h-full)` → panel → `KosCardList (h-full flex
flex-col)` → wrapper map (`flex-1 min-h-0`) semuanya ter-resolve ke pixel.

### RC-3 — tidak ada `invalidateSize` saat container berubah

Leaflet menghitung ukuran viewport **sekali** saat init. Kalau container berubah
ukuran setelahnya (toggle panel kiri/kanan, resize window, atau container yang
baru saja ter-render), Leaflet tidak tahu → tile & drag offset jadi ngaco.

Sebelum fix tidak ada handler resize sama sekali.

---

## 4. Perbaikan

`web/src/components/MapView.tsx`:

```tsx
import "leaflet/dist/leaflet.css";          // RC-1
...
function AutoResize() {                       // RC-3
  const map = useMap();
  useEffect(() => {
    const r = () => map.invalidateSize();
    r();
    const t = setTimeout(r, 100);
    const ro = new ResizeObserver(r);
    ro.observe(map.getContainer());
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [map]);
  return null;
}
// <MapContainer ...><AutoResize /> ... </MapContainer>
```

`web/src/components/KosCardList.tsx` (RC-2):

```tsx
<div className="flex-1 min-h-0 relative">
```

`web/src/components/ChatInterface.tsx` (RC-2):

```tsx
<div className="w-80 shrink-0 h-full ... overflow-hidden">
```

---

## 5. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| Toggle tab Map | map tumpah ke layar | map terkunci di panel 320px |
| Toggle panel kiri/kanan | tile offset / abu-abu | `invalidateSize` reflow mulus |
| Resize window | drag tidak sync | sinkron via ResizeObserver |

`astro check` 0/0/0, `npm run build` 3 pages OK.

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | Selalu import `leaflet/dist/leaflet.css` saat pakai react-leaflet | ✅ done |
| 2 | Setiap container flex yang menampung map: `min-h-0` + rantai `h-full` | ✅ done |
| 3 | Sertakan `invalidateSize` (idealnya via ResizeObserver) untuk map di layout dinamis | ✅ done |
| 4 | Tambah note di AGENTS.md / checklist: "leaflet CSS + invalidateSize" | 🟡 backlog |

---

## 7. Pelajaran

- **Library CSS jarangan auto-loaded.** `react-leaflet` mengasumsikan kita bawa
  CSS-nya sendiri — kalau hilang, gejalanya visual (map rusak) bukan error JS,
  jadi mudah lolos dari `astro check`/build.
- **Flex + `height: 100%` itu jebakan.** Tanpa `min-h-0`, flex child tidak akan
  memberi tinggi konkret ke anaknya yang butuh pixel (Leaflet, canvas, dll).
- **Map butuh "dikabari" soal resize.** `invalidateSize` wajib kalau container
  bisa berubah ukuran pasca-mount.
