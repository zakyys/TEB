# 📋 Cara Deploy Google Apps Script untuk Rekap Barang Terlaris & Jumlah Tamu

## ⚠️ MASALAH YANG DITEMUKAN

Frontend sudah bekerja dengan baik dan mengirim data, tetapi **Google Apps Script tidak menulis data** ke sheet. Ini karena:
1. Script mungkin belum dideploy ulang dengan kode terbaru
2. URL yang digunakan mungkin salah atau mengarah ke deployment lama

## ✅ SOLUSI: Deploy Ulang Google Apps Script

### Langkah 1: Buka Google Apps Script Editor

1. Buka Google Sheets yang ingin Anda gunakan untuk menyimpan data
2. Klik **Extensions** → **Apps Script**
3. Hapus semua kode yang ada di editor

### Langkah 2: Copy Script Baru

1. Buka file `google-apps-script.js` di folder project ini
2. Copy **SEMUA ISI** file tersebut
3. Paste ke Apps Script Editor

### Langkah 3: Deploy Web App

1. Klik tombol **Deploy** → **New deployment**
2. Klik icon **gear/roda gigi** di sebelah "Select type"
3. Pilih **Web app**
4. Isi konfigurasi:
   - **Description**: "POS Data API v2" (atau versi lainnya)
   - **Execute as**: "Me" (email Anda)
   - **Who has access**: **"Anyone"** ⚠️ PENTING!
5. Klik **Deploy**
6. Authorize aplikasi jika diminta
7. **COPY URL** yang diberikan (format: `https://script.google.com/macros/s/AKfycby...`)

### Langkah 4: Update URL di Aplikasi

Ada **2 URL berbeda** yang perlu diupdate:

#### URL 1: Penjualan Harian (Sudah Ada)
```
https://script.google.com/macros/s/AKfycbykzjXtQ4nDX0d9cxLRbW9Cl3jJU1ywIBQxc90nYHlECnD3wzQRV-XKJiY00Hj4yDcIIA/exec
```

#### URL 2: Rekap Barang Terlaris & Tamu (Perlu Diupdate)
```
https://script.google.com/macros/s/AKfycby_OOLN6N3TqYpntzorY7rftDcs4i3p3rCkQ3p8IqVi_rYuqIVXxjzeMYAtwGeRlD-w/exec
```

⚠️ **REKOMENDASI**: Gunakan **URL yang sama** untuk kedua fitur (dari deployment baru)

### Langkah 5: Test Ulang

1. Buka aplikasi POS di browser
2. Klik tombol **"Rekap Barang Terlaris"**
3. Tunggu popup "Berhasil!"
4. Cek Google Sheets Anda:
   - Harus ada sheet baru dengan nama bulan (misal: "Des 2025")
   - Sheet berisi:
     - ✅ Ranking barang paling laku
     - ✅ Data tamu harian (<12 dan >12) per tanggal
     - ✅ Total keseluruhan

## 📝 Catatan Penting

### Data yang Dikirim:
- **Barang Terlaris**: Semua produk yang terjual bulan ini, diurutkan berdasarkan quantity
- **Data Tamu**: Data harian jumlah tamu <12 tahun dan >12 tahun untuk setiap hari dalam bulan berjalan

### Format Sheet yang Dibuat:
```
📊 BARANG PALING LAKU BULAN INI - Des 2025
Terakhir Update: 27/12/2025 09:00:00

Rank | KODE    | Nama Produk | Qty Terjual | Total Penjualan
1    | BA-0133 | ANTING 2 ABS | 15         | 112500
2    | BA-0228 | ABRASIVE ... | 10         | 250000
...

GRAND TOTAL: ...

════════════════════════════════════════════════════════════
👥 DATA TAMU HARIAN BULAN INI

Tanggal          | <12 Tahun | >12 Tahun | Total
27 Desember 2025 | 5         | 8         | 13
26 Desember 2025 | 3         | 6         | 9
...

TOTAL BULAN INI: 25 | 45 | 70
```

## 🔧 Troubleshooting

### "Berhasil" tapi data tidak muncul di Sheet?
1. Pastikan URL di kode sudah benar (lihat Langkah 4)
2. Pastikan deployment setting "Who has access" = **"Anyone"**
3. Deploy ulang dengan versi baru
4. Clear cache browser dan refresh aplikasi POS

### Error saat authorize?
1. Gunakan akun Google yang memiliki akses ke Sheet
2. Berikan semua permission yang diminta
3. Jika ditolak, coba gunakan mode incognito

### Sheet tidak terbuat otomatis?
- Pastikan Apps Script memiliki permission untuk membuat sheet baru
- Cek apakah ada error di Apps Script Execution log (View → Executions)

## 📞 Perlu Bantuan?

Jika masih ada masalah setelah mengikuti langkah ini, berikan informasi:
1. Screenshot error (jika ada)
2. Browser console log
3. Apps Script execution log
