# Pipeline Monitor — Trello Power-Up

Power-Up untuk memonitor pipeline **per region × stage**, plus progress checklist tiap kartu.
Tombol **Pipeline Monitor** muncul di header board; klik untuk membuka dashboard full-screen.

## Isi paket

| File | Fungsi |
|---|---|
| `manifest.json` | Deklarasi Power-Up (nama, capability, connector) |
| `index.html` | Connector — halaman tak terlihat yang dimuat Trello |
| `js/client.js` | Registrasi tombol board + pembuka modal |
| `dashboard.html` | Modal dashboard — mengambil data via Trello Power-Up client |
| `js/app.js` | Logika agregasi + renderer (dipakai dashboard & preview) |
| `preview.html` | **Buka di browser** untuk lihat tampilan pakai data contoh, tanpa deploy |
| `icon.svg` | Ikon tombol |

## Lihat dulu tanpa deploy

Double-click `preview.html`. Datanya contoh (meniru board Anda), tapi seluruh tampilan dan interaksi sama.

## Deploy (± 10 menit)

Power-Up wajib di-host lewat **HTTPS**. Pilih salah satu, semuanya gratis:

### Opsi A — Netlify Drop (paling cepat, tanpa akun teknis)

1. Buka <https://app.netlify.com/drop>
2. Drag **folder `pipeline-monitor-powerup`** ke halaman itu.
3. Salin URL yang muncul, misal `https://witty-cat-123.netlify.app`
4. Connector URL Anda = `https://witty-cat-123.netlify.app/index.html`

### Opsi B — Vercel

```bash
cd pipeline-monitor-powerup
npx vercel --prod
```

Connector URL = `https://<nama-project>.vercel.app/index.html`

### Opsi C — GitHub Pages

1. Push folder ini ke repo GitHub.
2. Settings → Pages → Source: `main` / root → Save.
3. Connector URL = `https://<user>.github.io/<repo>/index.html`

## Daftarkan ke Trello

1. Buka <https://trello.com/power-ups/admin>
2. **New** → pilih Workspace Anda → isi nama `Pipeline Monitor` → Create.
3. Tab **Basic Information**: isi **Iframe connector URL** dengan URL dari langkah deploy
   (`https://.../index.html`) → Save.
4. Tab **Capabilities**: aktifkan **board-buttons** → Save.
5. Buka board *NEW INITIATIVES PIPELINE* → menu kanan → **Power-Ups** → **Custom** →
   Add pada *Pipeline Monitor*.
6. Tombol **Pipeline Monitor** muncul di header board.

> Kalau Anda memakai flow manifest (Trello akan menanyakan "Manifest URL"), isi
> `https://.../manifest.json` — kedua cara didukung paket ini.

## Cara Power-Up ini membaca board Anda

- **Stage** = nama list, prefiks angka dibuang (`1. CONTACT` → `CONTACT`).
- **Region** = label yang **berawalan angka + titik**, mis. `3. FROZENLAND 3 (SUMATERA 2)`.
  Kartu tanpa label bernomor masuk baris **Tanpa Region** — berguna sebagai daftar "belum dikategorikan".
- **Brand** = label yang **tanpa angka**, mis. `FROZENLAND`, `SPLASHBOM` → jadi dropdown filter.
- **Progress checklist** = badge checklist kartu (`checkItems` / `checkItemsChecked`).
  Persentase di sel matriks = total item selesai ÷ total item di sel itu, bukan rata-rata per kartu,
  jadi kartu besar berbobot lebih besar.
- Kartu yang di-archive diabaikan.

Kalau nanti Anda ganti pola penamaan label, cukup ubah `REGION_RE` di `js/app.js`.

## Fitur dashboard

- **KPI**: total kartu, pipeline aktif (Contact+Nego+Deal), Operating, Canceled,
  win rate, kesiapan checklist keseluruhan.
- **Matriks Region × Stage**: angka besar = jumlah kartu, angka kecil + bar = kesiapan checklist.
  Klik sel mana pun → daftar kartu di dalamnya, diurutkan dari progress terendah,
  klik nama kartu → langsung buka kartunya.
- **Tab Progress Checklist**: semua kartu per region dengan bar progress, terendah di atas.
- **Export CSV**: matriks siap ditempel ke Excel/Sheets.
- Filter brand (Frozenland / Splashbom) berlaku ke semua tampilan.

## Ide lanjutan (belum dibuat, tinggal bilang)

1. **Card badge kesiapan** — tampilkan `86%` langsung di muka kartu di board, tanpa buka dashboard.
2. **Aging / stale detector** — tandai kartu yang tidak bergerak > 30 hari.
3. **Snapshot mingguan** — simpan angka tiap Jumat via `t.set('board','shared',…)` agar tren bisa dibandingkan antar minggu.
4. **Target vs aktual** — isi target unit per region, dashboard tampilkan gap.
5. **Laporan otomatis** — kirim ringkasan matriks ke email/WhatsApp tiap Senin pagi (lewat scheduled task, bukan Power-Up).
