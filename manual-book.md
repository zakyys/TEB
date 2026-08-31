# GoldenPOS Manual Book

## 1. Pendahuluan
GoldenPOS adalah aplikasi Point of Sale (POS) sederhana untuk bengkel, yang menyimpan data secara lokal di browser (local storage). Manual ini memandu Anda menggunakan fitur utama: tambah produk, kelola produk, transaksi, backup & restore, serta pengaturan profil.

---

## 2. Navigasi & Menu Utama
Aplikasi memiliki menu utama di bagian bawah layar:
- **Dashboard**: Ringkasan penjualan, laba, stok menipis, dan akses cepat.
- **POS**: Untuk transaksi penjualan produk/layanan.
- **Products**: Kelola produk (tambah, edit, hapus, impor).
- **History**: Riwayat transaksi, detail, ekspor.
- **Profile**: Pengaturan profil, printer, backup & restore.

---

## 3. Menambah Produk
1. **Buka menu Products** dari navigasi bawah.
2. Klik **Tambah Produk** (biasanya tombol "+").
3. Isi data produk:
   - Nama Produk
   - Kategori
   - Harga Jual & Beli
   - Stok Awal
   - SKU (kode unik)
   - Threshold (batas minimum stok, opsional)
4. Klik **Simpan**.

### Import Produk Massal
- Klik **Bulk Import**.
- Download template Excel bila diperlukan, lalu isi kolom `KODE`, `NAMA BARANG`, `HARGA MODAL`, `HARGA JUAL`, dan `STOK AKHIR`.
- Upload file `.xlsx` atau `.xls`.
- SKU/KODE dan nama wajib diisi; SKU duplikat dan harga tidak valid akan ditolak.
- **Stok boleh negatif** dan akan disimpan apa adanya.
- Import meng-update produk dengan SKU yang sama dan menambahkan SKU baru.
- Kategori otomatis berdasarkan prefix SKU: `BA` BAUT OTOMOTIF, `BG` BAUT GENERAL, `BK` BAUT KAYU, `KG` KILOGRAM, `TL` TOOLS, `BT` BAUT TRUCK. Prefix asing masuk ke `NO KATEGORI` di aplikasi dan Google Sheet.

---

## 4. Mengelola Produk
- **Edit**: Klik ikon pensil pada produk, ubah data, lalu simpan.
- **Hapus**: Klik ikon tempat sampah, konfirmasi penghapusan.
- **Cari/Filter**: Gunakan kolom pencarian atau filter kategori/SKU.
- **Sortir**: Urutkan produk berdasarkan nama, harga, atau stok.

---

## 5. Transaksi (POS)
1. **Buka menu POS**.
2. Pilih pelanggan (atau tambah baru jika perlu).
3. Cari produk/layanan, tambahkan ke keranjang.
4. Atur jumlah, cek total, pilih metode pembayaran.
5. Klik **Selesaikan Transaksi**.
6. Struk dapat dicetak atau disimpan.

---

## 6. Riwayat Transaksi
- **Buka menu History**.
- Cari transaksi berdasarkan nama pelanggan, tanggal, atau ID.
- Klik transaksi untuk melihat detail item, status, dan total.
- Ekspor data ke Excel/PDF jika diperlukan.

---

## 7. Pengaturan Profil
- **Buka menu Profile**.
- Edit data profil bengkel: nama, alamat, email, telepon, avatar.
- Klik **Edit Profil**, ubah data, lalu **Simpan**.
- Reset profil ke default jika diperlukan.

### Pengaturan Printer
- Menu printer tersedia, namun fitur thermal printer belum aktif di versi lite.

---

## 8. Backup & Restore Data
### Backup Data
1. Buka **Profile > Backup & Restore**.
2. Klik **Generate Backup**.
3. Salin teks backup yang muncul, simpan di tempat aman (misal: Google Drive).

### Restore Data
1. Buka **Profile > Backup & Restore**.
2. Tempel data backup pada kolom "Tempel data backup di sini".
3. Klik **Restore Data**.
4. Konfirmasi, lalu aplikasi akan reload dengan data yang dipulihkan.

> **Penting:** Data utama produk/transaksi disimpan di browser (IndexedDB) dengan LocalStorage sebagai fallback. Backup & restore tetap hanya berlaku jika backup dipindahkan secara manual ke browser/perangkat lain. Data dapat hilang jika browser storage dihapus atau perangkat rusak. Selalu backup rutin!

---

## 9. Tips & FAQ
- **Data Hilang?**
  - Lakukan restore dari backup terakhir.
- **Pindah Komputer?**
  - Backup di komputer lama, restore di komputer baru (browser harus sama).
- **Multi User?**
  - Saat ini hanya untuk single user di satu browser.
- **Printer Thermal?**
  - Fitur akan datang, silakan kembangkan mandiri.

---

## 10. Kontak & Bantuan
Jika ada kendala, hubungi pengembang atau cek README.md.

---

Selamat menggunakan GoldenPOS! Jika ada fitur baru, tambahkan ke manual ini secara berkala. 