# Panduan Setup Google Apps Script GoldenPOS

Aplikasi ini memakai **dua deployment Google Apps Script yang terpisah**. Jangan menempelkan kedua script ke satu project Apps Script karena keduanya memiliki fungsi `doGet()` dan `doPost()` sendiri.

## Ringkasan file

| Kebutuhan | File yang disalin ke Apps Script | URL di aplikasi |
|---|---|---|
| Laporan penjualan, rekap bulanan, data tamu, refund, tukar barang, Telegram, backup | `gas-report-transactions.gs` | **URL Google Apps Script (GAS)** |
| Database produk, kategori, stok, `ALL PRODUK`, bulk upload, sinkronisasi stok | `gas-product-database.gs` | **URL Spreadsheet Database Produk** |

File GAS lama sudah dihapus dari repository agar tidak tertukar.

---

# A. Setup URL utama — laporan/transaksi

Gunakan spreadsheet yang ingin menyimpan laporan penjualan.

## 1. Pasang script laporan

1. Buka Google Spreadsheet laporan.
2. Pilih **Extensions → Apps Script**.
3. Hapus kode lama di editor.
4. Buka file `gas-report-transactions.gs` dari repository ini.
5. Copy **seluruh isi file**.
6. Paste ke Apps Script Editor.
7. Klik **Save**.

## 2. Deploy sebagai Web App

1. Klik **Deploy → New deployment**.
2. Pilih tipe **Web app**.
3. Atur:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Klik **Deploy**.
5. Berikan izin yang diminta Google.
6. Copy URL yang berakhiran `/exec`.

## 3. Masukkan ke aplikasi

Buka:

```text
Profile → Koneksi Multi-Toko → Ubah Koneksi Toko
```

Masukkan URL tersebut ke:

```text
URL Google Apps Script (GAS)
```

URL ini dipakai untuk:

- laporan penjualan harian;
- rekap bulanan;
- data tamu;
- refund dan tukar barang;
- backup laporan ke Google Drive;
- notifikasi Telegram.

Klik **Simpan** setelah URL diisi.

---

# B. Setup URL database produk

Gunakan spreadsheet yang ingin menjadi database produk. Sebaiknya pisahkan dari spreadsheet laporan agar data lebih mudah dikelola.

## 1. Pasang script database produk

1. Buka Google Spreadsheet database produk.
2. Pilih **Extensions → Apps Script**.
3. Hapus kode lama di editor.
4. Buka file `gas-product-database.gs` dari repository ini.
5. Copy **seluruh isi file**.
6. Paste ke Apps Script Editor.
7. Klik **Save**.

## 2. Deploy sebagai Web App

1. Klik **Deploy → New deployment**.
2. Pilih tipe **Web app**.
3. Atur:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Klik **Deploy**.
5. Berikan izin yang diminta Google.
6. Copy URL yang berakhiran `/exec`.

## 3. Masukkan ke aplikasi

Di halaman pengaturan yang sama, masukkan URL ke:

```text
URL Spreadsheet Database Produk (Berbeda)
```

Klik **Simpan**.

## 4. Buat format sheet dari aplikasi

Klik tombol **Cek** di sebelah URL database produk.

Tombol ini akan menjalankan setup otomatis dan membuat:

```text
BA
BG
BK
KG
TL
ALL PRODUK
MASTER
```

Struktur sheet produk:

- Baris 1: waktu upload terakhir
- Baris 2: waktu sinkronisasi kasir terakhir
- Baris 3: header kolom
- Baris 4 dan seterusnya: data produk

Jangan mengedit sheet `ALL PRODUK` secara manual. Sheet tersebut dibuat otomatis dari sheet kategori.

## 5. Pasang trigger perubahan sheet

Di spreadsheet database produk, buka menu custom:

```text
📋 MASTER → ⚙️ Setup Auto-Sync (1x saja)
```

Lakukan satu kali saja. Trigger ini membantu memperbarui `ALL PRODUK` ketika baris di sheet kategori dihapus atau ditambahkan.

---

# C. Aturan penggunaan sehari-hari

## Menambah atau mengedit produk

Gunakan aplikasi POS atau sheet kategori:

```text
BA / BG / BK / KG / TL
```

Setelah perubahan dari sheet, jalankan **Sync Sheet** di aplikasi.

## Upload semua produk dari aplikasi

Gunakan tombol:

```text
Profile → Koneksi Multi-Toko → Upload Semua Produk ke Sheet
```

Fitur ini menulis ulang data produk di sheet kategori. Pastikan backup sudah tersedia sebelum menggunakannya.

## Sinkronisasi produk ke aplikasi

Gunakan:

```text
Products → Sync Sheet
```

Aplikasi akan membaca produk dari sheet kategori database produk.

## Laporan penjualan

Gunakan URL utama untuk laporan. Aplikasi akan membuat/memperbarui sheet seperti:

```text
Harian <Bulan> <Tahun>
Recap <Bulan> <Tahun>
```

---

# D. Cara mengecek URL secara manual

## Cek URL laporan

Buka URL utama di browser. Response teks:

```text
GoldenPOS API OK - Ready to receive requests
```

menunjukkan endpoint dapat dijangkau.

## Cek URL database produk

Tambahkan parameter berikut pada URL database produk:

```text
?action=getProducts
```

Contoh:

```text
https://script.google.com/macros/s/ID_DEPLOYMENT/exec?action=getProducts
```

Response database produk yang benar berbentuk JSON, misalnya:

```json
{
  "success": true,
  "products": [],
  "total": 0
}
```

Untuk membuat format sheet dari browser, gunakan:

```text
?action=setupProductSheet
```

---

# E. Troubleshooting

## Tombol Cek tidak membuat sheet

Periksa hal berikut:

1. Yang ditekan adalah tombol **Cek** di sebelah **URL Spreadsheet Database Produk**, bukan tombol URL utama.
2. URL tersebut berasal dari deployment file `gas-product-database.gs`.
3. URL berakhiran `/exec`, bukan URL editor Apps Script.
4. Deployment memakai **Execute as: Me**.
5. Akses disetel ke **Anyone**.
6. Script sudah disimpan dan deployment dibuat ulang setelah perubahan kode.
7. Google sudah meminta dan menerima otorisasi script.

## Response mengatakan `Sheet 'Produk' tidak ditemukan`

URL masih mengarah ke script lama. Database produk terbaru tidak memakai satu sheet `Produk`; database ini memakai:

```text
BA, BG, BK, KG, TL, ALL PRODUK, MASTER
```

Deploy ulang menggunakan `gas-product-database.gs`.

## Produk tidak muncul saat Sync Sheet

1. Pastikan URL database produk sudah disimpan.
2. Pastikan sheet kategori berisi data mulai dari baris 4.
3. Pastikan KODE produk memiliki prefix yang sesuai: `BA`, `BG`, `BK`, `KG`, atau `TL`.
4. Pastikan Apps Script database produk sudah dideploy ulang.
5. Cek **Executions** di Apps Script untuk melihat error.

## Penting tentang dua script

Jangan menempelkan kedua file berikut dalam satu Apps Script project:

```text
gas-report-transactions.gs
gas-product-database.gs
```

Keduanya memiliki router `doGet()` dan `doPost()` sendiri. Deploy sebagai dua project/URL terpisah.
