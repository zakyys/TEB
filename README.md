# GoldenPOS

GoldenPOS adalah aplikasi Point of Sale (POS) berbasis React + TypeScript + Vite untuk kebutuhan bengkel, dengan penyimpanan data di local storage browser.

---

## 🚀 Panduan Developer

### 1. Instalasi

Pastikan sudah terinstall Node.js (disarankan versi 18+).

```bash
npm install
```

### 2. Menjalankan Aplikasi (Development)

```bash
npm run dev
```

Aplikasi akan berjalan di `http://localhost:5173` (atau port lain sesuai output terminal).

### 3. Build untuk Produksi

```bash
npm run build
```

Hasil build ada di folder `dist/`.

### 4. Preview Build

```bash
npm run preview
```

### 5. Struktur Project (Ringkasan)
- `src/components/` : Komponen utama (POS, Produk, Transaksi, dsb)
- `src/lib/` : Utilitas, cache produk, IndexedDB, sinkronisasi, dan domain logic
- `src/store/` : State cart Zustand yang dipersist
- `src/App.tsx` : Routing utama dan inisialisasi cache/stock sync
- `src/main.tsx` : Entry point aplikasi
- `gas-report-transactions.gs` : Google Apps Script laporan/transaksi
- `gas-product-database.gs` : Google Apps Script database produk
- `DEPLOY-GOOGLE-SCRIPT.md` : Panduan dua deployment GAS
- `PROJECT-CONTEXT.md` : Handoff teknis lengkap untuk sesi/pengembang berikutnya

> **Catatan penting:** aplikasi menggunakan dua deployment GAS terpisah. Stok boleh negatif dan produk kosong (`[]`) adalah state yang valid. Baca [PROJECT-CONTEXT.md](./PROJECT-CONTEXT.md) sebelum melakukan perubahan besar.

### 6. Fitur Utama
- Manajemen produk (tambah, edit, hapus, import)
- Transaksi POS
- Riwayat transaksi
- Backup & restore data (local storage)
- Pengaturan profil

---

## 📚 Dokumentasi

- [manual-book.md](./manual-book.md) — panduan penggunaan sehari-hari.
- [DEPLOY-GOOGLE-SCRIPT.md](./DEPLOY-GOOGLE-SCRIPT.md) — setup dua deployment Google Apps Script.
- [PROJECT-CONTEXT.md](./PROJECT-CONTEXT.md) — struktur kode, storage, kontrak API, aturan bisnis, status terakhir, dan handoff teknis.

---
