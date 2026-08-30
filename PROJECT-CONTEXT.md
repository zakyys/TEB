# GoldenPOS — Project Context & Handoff

> Dokumen ini adalah ringkasan teknis yang sengaja disimpan di repository agar sesi/agent berikutnya bisa melanjutkan pekerjaan tanpa menebak struktur, aturan bisnis, atau riwayat perubahan.

## 1. Identitas dan status repository

- Nama aplikasi: **GoldenPOS** / POS bengkel.
- Stack: React 18, TypeScript, Vite 6, Tailwind CSS, React Router 6, Zustand.
- Repository asal: `https://github.com/zakyyy16/POSBAUT-V11`
- Repository target aktif: `https://github.com/zakyys/TEB`
- Branch kerja: `main`
- Commit terakhir yang sudah di-push ke TEB: `7e829e3` — `fix: harden product sync and persistence`
- Remote lokal:
  - `origin` → POSBAUT-V11
  - `teb` → TEB
- Dokumen handoff ini dibuat setelah commit tersebut; perubahan dokumentasi handoff perlu di-commit dan di-push agar ikut tersimpan di TEB.

## 2. Tujuan aplikasi

Aplikasi dipakai kasir bengkel/toko baut untuk:

- mencari produk dan melakukan penjualan;
- menerima stok/pembelian;
- mengelola produk secara manual atau lewat Excel;
- sinkronisasi produk dan stok dengan Google Sheets;
- melihat riwayat transaksi, refund, dan tukar barang;
- mengirim laporan transaksi ke Google Apps Script dan Telegram;
- melakukan backup/restore data lokal.

Aplikasi sudah dipakai operasional selama sekitar enam bulan. Prinsip utama: **perbaikan incremental, jangan full rewrite, jangan mengubah alur kerja yang sudah familiar tanpa alasan kuat**.

## 3. Aturan bisnis yang tidak boleh dilanggar

1. **Stok boleh negatif.** Penjualan, refund, tukar barang, import, dan sinkronisasi tidak boleh melakukan clamp ke nol atau menolak stok negatif.
2. SKU/kode produk adalah identitas utama. Saat membandingkan SKU, normalisasi dengan `trim().toUpperCase()`.
3. Harga harus angka valid; harga negatif tidak diterima saat import/upload.
4. Produk kosong `[]` adalah state yang valid, khususnya setelah fitur **Hapus Semua**. Jangan mengisinya kembali dengan `DUMMY_PRODUCTS`.
5. Respons Google Sheets yang kosong tidak boleh menghapus data lokal yang masih berisi produk.
6. Ada dua deployment GAS yang berbeda dan tidak boleh digabung dalam satu Apps Script project:
   - laporan/transaksi;
   - database produk.
7. Jangan menggunakan URL GAS laporan sebagai fallback untuk operasi database produk atau stok.
8. Jangan menambahkan `min=0` pada input stok. `min=0` pada harga, diskon, atau kuantitas non-stok adalah aturan terpisah dan tidak otomatis berarti stok harus non-negatif.

## 4. Struktur kode penting

### Entry dan routing

- `src/main.tsx` — mount React, `BrowserRouter`, `TempoDevtools`.
- `src/App.tsx` — splash screen, inisialisasi cache produk dan stock sync, route utama, flush sebelum unload.
- `src/components/layout/BottomNavBar.tsx` — navigasi bawah.

### Halaman utama

- `src/components/home.tsx` — dashboard, laporan harian, pengiriman transaksi ke GAS utama, auto-send.
- `src/components/pos/POSScreen.tsx` — katalog POS, scan barcode, cart/payment, penyelesaian transaksi.
- `src/components/pos/CartScreen.tsx` — halaman cart/payment alternatif; juga menyelesaikan transaksi.
- `src/components/products/ProductManagement.tsx` — daftar produk, tambah/edit/hapus, import/export Excel, sync dari Sheet.
- `src/components/purchase/PurchaseInput.tsx` — penerimaan/pembelian stok dan draft nota.
- `src/components/transactions/TransactionHistory.tsx` — riwayat, delete/edit item, refund, tukar, undo exchange.
- `src/components/exchange/ExchangePage.tsx` — pencarian dan proses tukar barang.
- `src/components/profile/ProfilePage.tsx` — profil, konfigurasi GAS/Telegram, backup/restore, upload semua produk.
- `src/components/products/ProfitAnalysis.tsx` — analisis laba.

### Library/domain

- `src/lib/productCache.ts` — cache produk memory + IndexedDB + LocalStorage fallback; antrean stock sync.
- `src/lib/indexedDB.ts` — IndexedDB transaksi dan fallback LocalStorage.
- `src/lib/transactions.ts` — `completeTransactionUtil`, pengurangan stok tanpa clamp, receipt.
- `src/lib/utils.ts` — `LS_KEYS`, config, backup/restore, laporan/helper.
- `src/lib/exchange.ts` — penyimpanan catatan tukar.
- `src/lib/notes.ts` — catatan hutang/operasional.
- `src/lib/telegramSync.ts` — sinkronisasi file/data Telegram.
- `src/store/usePosStore.ts` — Zustand cart + state PPN, persisted key `POS_STORE`.
- `src/types/pos.ts` — tipe `Product`, `CartItem`, transaksi, profil.

### Google Apps Script

- `gas-report-transactions.gs` — deployment laporan/transaksi.
- `gas-product-database.gs` — deployment database produk.
- `DEPLOY-GOOGLE-SCRIPT.md` — instruksi deployment dan troubleshooting.
- File GAS legacy sudah dihapus untuk mencegah salah copy:
  - `google-apps-script.js`
  - `google-apps-script/GoldenPOS.gs`

## 5. Penyimpanan data

### Produk

- Memory: `productCache` di `src/lib/productCache.ts`.
- IndexedDB:
  - database `pos_products_db`;
  - store `products`;
  - key tunggal `__all_products__`.
- LocalStorage recovery key: `PRODUCTS`.
- `setProducts()` memperbarui memory dan LocalStorage secara sinkron, lalu menulis ke IndexedDB secara debounce.
- `initProductCache()` memakai IndexedDB sebagai sumber utama; `[]` dari IndexedDB dianggap valid. LocalStorage hanya dipakai jika IndexedDB belum memiliki snapshot.
- `flushProductCache()` dipakai sebelum unload/operasi penting.

### Transaksi

- Primary: IndexedDB database `pos_database`, store `transactions`.
- Fallback/migrasi: LocalStorage key `TRANSACTIONS` dan key lama `pos_transactions`.
- Backup transaksi sebelum clear tersedia di `pos_transactions_backup`.

### Config

Key penting di `src/lib/utils.ts`:

- `pos_gas_url` — URL deployment `gas-report-transactions.gs`.
- `pos_product_gas_url` — URL deployment `gas-product-database.gs`.
- `pos_telegram_bot_token`.
- `pos_telegram_chat_id`.
- `POS_STORE` — Zustand cart.
- `pos_pending_stock_sync` — antrean stok yang belum berhasil dikirim.

## 6. Kontrak frontend ↔ GAS database produk

### GET

`GET <productGasUrl>?action=getProducts&_=<cachebuster>`

Respons yang diharapkan:

```json
{"success":true,"products":[{"kode":"BG-001","nama":"...","hargaBeli":100,"hargaJual":150,"stok":-2}],"total":1}
```

`GET <productGasUrl>?action=setupProductSheet` membuat/menyiapkan sheet.

### POST actions

- `updateProductActive` — tambah/edit satu produk.
- `bulkUpdateProducts` — replace data kategori dari seluruh produk aplikasi.
- `batchUpdateStock` — update stok beberapa SKU sekaligus.

Sheet database produk:

- kategori: `BA`, `BG`, `BK`, `KG`, `TL`;
- agregat: `ALL PRODUK`;
- konfigurasi: `MASTER`;
- data dimulai dari baris 4; kolom utama: KODE, Nama, Harga Beli, Harga Jual, Stok.

### Catatan CORS/no-cors

- GET sync produk harus dapat membaca response JSON dan karena itu memakai request biasa.
- Upload massal sekarang mengirim `Content-Type: text/plain;charset=utf-8` agar menjadi simple request dan response dapat diverifikasi.
- Stock sync memakai `no-cors` untuk kompatibilitas GAS dan hanya dapat memastikan request tidak gagal di level jaringan; kegagalan jaringan dimasukkan kembali ke antrean.
- Jangan menyebut request `no-cors` sebagai bukti server sudah memproses data; read-back manual atau sync ulang diperlukan bila verifikasi penuh dibutuhkan.

## 7. Alur produk dan stok

1. App start: `App.tsx` menjalankan `initProductCache()`, lalu `initStockSync()`.
2. POS menyelesaikan transaksi lewat `completeTransactionUtil()`.
3. `completeTransactionUtil()` mengurangi stok tanpa clamp, menyimpan transaksi, dan memperbarui cache.
4. POS/Cart mengirim stok terbaru via `pushStockToSheet()`.
5. `productCache.ts` menggabungkan update stok yang cepat menjadi satu batch request.
6. Jika offline/tidak ada URL/request gagal, update disimpan di `pos_pending_stock_sync` dan dicoba saat online.
7. Sync manual dari Sheet mengganti detail produk dari Sheet. Auto-sync mempertahankan stok lokal untuk SKU yang sudah ada agar Sheet stale tidak menimpa stok lokal.
8. Import Excel melakukan validasi penuh dulu, baru merge ke cache. Merge berdasarkan SKU memakai `Map`.

## 8. Perubahan terakhir yang sudah dilakukan

- Memisahkan dan merapikan dua file GAS canonical serta dokumentasinya.
- Menghapus script GAS legacy yang membingungkan.
- Memperbaiki persistence IndexedDB agar menunggu transaction completion.
- Menjadikan LocalStorage snapshot sebagai fallback/recovery yang konsisten.
- Mempertahankan `[]` sebagai state valid.
- Menghapus pengisian dummy products saat cache kosong pada POS/Product Management.
- Memperketat sync GET: URL khusus produk, cache busting, `response.ok`, JSON contract, validasi row, duplikat SKU, empty-response protection.
- Memperbaiki import Excel 5.000 baris agar O(existing + imported), validasi SKU/nama/harga, dan tetap menerima stok negatif.
- Memperbaiki upload massal ke endpoint khusus produk dengan validasi respons.
- Menambah validasi backend GAS: batas 5.000, SKU duplicate, numeric validation, harga non-negatif, stok boleh negatif.
- Mengubah stock sync menjadi endpoint batch.
- Menyamakan pencocokan SKU di POS, cart, refund, exchange, dan transaction history.

## 9. Perintah validasi

Dari root repository:

```bash
npm install
npx tsc --noEmit --pretty false
npm run build
cp gas-product-database.gs /tmp/gas-product-database-check.js
cp gas-report-transactions.gs /tmp/gas-report-transactions-check.js
node --check /tmp/gas-product-database-check.js
node --check /tmp/gas-report-transactions-check.js
git diff --check
git status --short --branch
```

`npm run lint` saat ini belum dapat diandalkan karena ESLint tidak tersedia/terdaftar secara benar pada setup sebelumnya. Jangan menyatakan lint lulus tanpa memasang dan mengonfigurasi ESLint.

## 10. Checklist manual minimum

### Data produk

- [ ] Import 5.000 produk.
- [ ] Export kembali dan pastikan jumlah baris sama.
- [ ] Import SKU duplikat → harus ditolak tanpa mengubah cache.
- [ ] Import SKU/nama kosong → harus ditolak tanpa mengubah cache.
- [ ] Import harga bukan angka atau harga negatif → harus ditolak.
- [ ] Import stok `-5` → harus berhasil dan tetap `-5`.
- [ ] Hapus semua produk, refresh, pastikan tetap kosong.

### POS dan stok

- [ ] Penjualan mengurangi stok.
- [ ] Stok dapat menjadi negatif.
- [ ] Refund mengembalikan stok.
- [ ] Tukar barang memperbarui stok barang lama dan baru.
- [ ] Edit jumlah/hapus item transaksi tidak meng-clamp stok.
- [ ] Offline: lakukan transaksi, online lagi, cek antrean dan Sheet.

### Google Sheets

- [ ] URL laporan hanya dipakai untuk laporan/transaksi.
- [ ] URL produk hanya dipakai untuk setup, get products, upload, dan stok.
- [ ] `?action=getProducts` mengembalikan JSON `success: true`.
- [ ] Upload 5.000 produk berhasil dan sheet kategori terisi.
- [ ] Cek `ALL PRODUK` setelah bulk upload/stock update.
- [ ] Deploy ulang GAS setiap kali file `.gs` berubah.

## 11. Hal yang perlu diwaspadai agent berikutnya

- Jangan menggabungkan kedua GAS file; global `doGet()`/`doPost()` akan bentrok.
- Jangan menghidupkan kembali fallback `productGasUrl || gasUrl`.
- Jangan mengubah model data produk atau IndexedDB tanpa migration plan.
- Jangan memperkenalkan server/database baru sebagai bagian dari bug fix kecil.
- Jangan menghapus data production atau menjalankan upload replace tanpa konfirmasi jelas.
- Sebelum mengubah sinkronisasi, cek dulu kontrak request di frontend dan action di `gas-product-database.gs`.
- Jika ada perubahan UI shell/Vite, perlu rebuild dan verifikasi aplikasi yang berjalan; perubahan client-plugin hanya auto-reload jika watcher yang tepat sedang aktif.
- Secrets Telegram/GAS jangan ditulis ke dokumentasi atau commit. Token yang pernah tampil di screenshot sebaiknya di-rotate.

## 12. Rekomendasi pekerjaan berikutnya

Prioritas aman setelah handoff:

1. Tambahkan test utilitas terisolasi untuk normalisasi SKU, validasi import, dan perhitungan stok negatif.
2. Tambahkan read-back opsional setelah bulk upload: panggil `getProducts`, cocokkan count/SKU, tampilkan peringatan jika berbeda.
3. Audit sisa penggunaan LocalStorage transaksi yang masih bercampur dengan IndexedDB.
4. Kurangi `console.log` produksi dan error handling yang masih silent, tanpa menghilangkan log penting untuk operasi offline.
5. Pisahkan konfigurasi rahasia dari source jika aplikasi akan dipublikasikan lebih luas.
6. Pertimbangkan menambahkan ESLint secara resmi, lalu lakukan lint bertahap; jangan membuat lint blocking sebelum existing warning dibereskan.

## 13. Cara memulai sesi baru

Agent berikutnya cukup membaca file ini lalu menjalankan:

```bash
pwd
git status --short --branch
git log --oneline --decorate -5
```

Kemudian baca file yang berkaitan dengan permintaan user. Jangan mengasumsikan branch/remote aktif; cek kembali dengan `git remote -v`.
