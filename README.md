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
- `src/lib/` : Utilitas, dummy data
- `src/App.tsx` : Routing utama
- `src/main.tsx` : Entry point aplikasi

### 6. Fitur Utama
- Manajemen produk (tambah, edit, hapus, import)
- Transaksi POS
- Riwayat transaksi
- Backup & restore data (local storage)
- Pengaturan profil

---

## 📚 Panduan Pengguna

Lihat file [manual-book.md](./manual-book.md) untuk panduan penggunaan aplikasi secara lengkap.

---
