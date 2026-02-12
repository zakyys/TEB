/**
 * GOOGLE APPS SCRIPT - KHUSUS DATABASE PRODUK (GoldenPOS)
 * 
 * Layout:
 *   Row 1: 🕐 Terakhir Upload : [timestamp]
 *   Row 2: 🕐 Terakhir Kasir Sync : [timestamp]
 *   Row 3: KODE | Nama | Harga Beli | Harga Jual | Stok | Gross Margin %
 *   Row 4+: Data produk
 * 
 * Sheet: BA, BG, BK, KG, TL, ALL PRODUK
 * Mode: AUTO REPLACE
 */

var CATEGORY_SHEETS = ["BA", "BG", "BK", "KG", "TL"];
var ALL_SHEET = "ALL PRODUK";
var PASTE_SHEET = "MASTER";
var BACKUP_SHEET = "_BACKUP";
var HEADERS = ["KODE", "Nama", "Harga Beli", "Harga Jual", "Stok", "Gross Margin %"];
var PASTE_HEADERS = ["KODE", "Nama", "Harga Beli", "Harga Jual", "Stok"];
var DATA_START_ROW = 4; // Data mulai dari baris 4
var PASTE_DATA_ROW = 5; // Data di paste sheet mulai baris 5 (row 4 = tombol undo)

// Menu custom saat buka spreadsheet
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu("📋 MASTER")
        .addItem("↩️ Undo Terakhir", "undoLastPaste")
        .addToUi();
}

function getSheetNameFromCode(kode) {
    var prefix = String(kode).substring(0, 2).toUpperCase();
    if (CATEGORY_SHEETS.indexOf(prefix) >= 0) return prefix;
    return "BG";
}

function doGet(e) {
    if (!e || !e.parameter) return ContentService.createTextOutput("GoldenPOS Product API Aktif").setMimeType(ContentService.MimeType.TEXT);

    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ========================================
    // 1. SETUP OTOMATIS (Tombol "Cek" di app)
    // ========================================
    if (action === "setupProductSheet") {
        try {
            CATEGORY_SHEETS.forEach(function (name) {
                var sheet = ss.getSheetByName(name);
                if (!sheet) sheet = ss.insertSheet(name);
                formatSheetHeaders(sheet);
            });

            var allSheet = ss.getSheetByName(ALL_SHEET);
            if (!allSheet) allSheet = ss.insertSheet(ALL_SHEET);
            formatSheetHeaders(allSheet);
            allSheet.setTabColor("#FF6D00");

            // Sheet PASTE DARI EXCEL
            var pasteSheet = ss.getSheetByName(PASTE_SHEET);
            if (!pasteSheet) pasteSheet = ss.insertSheet(PASTE_SHEET);
            formatPasteSheet(pasteSheet);
            pasteSheet.setTabColor("#4CAF50");

            return createJsonResponse({ success: true, message: "Setup Berhasil! Sheet BA, BG, BK, KG, TL, ALL PRODUK, dan PASTE DARI EXCEL sudah dibuat." });
        } catch (err) {
            return createJsonResponse({ success: false, error: err.toString() });
        }
    }

    // ================================================
    // 2. AMBIL SEMUA PRODUK (Sync Sheet → Aplikasi)
    // ================================================
    if (action === "getProducts") {
        try {
            var products = [];

            CATEGORY_SHEETS.forEach(function (name) {
                var sheet = ss.getSheetByName(name);
                if (!sheet) return;

                var lastRow = sheet.getLastRow();
                if (lastRow < DATA_START_ROW) return;

                var data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 5).getValues();
                for (var i = 0; i < data.length; i++) {
                    if (data[i][0]) {
                        products.push({
                            kode: String(data[i][0]).toUpperCase(),
                            nama: data[i][1],
                            hargaBeli: data[i][2],
                            hargaJual: data[i][3],
                            stok: data[i][4]
                        });
                    }
                }
            });

            // Update timestamp "Terakhir Kasir Sync" di semua sheet
            var timestamp = getTimestampText();
            updateTimestamp(ss, "sync", timestamp);

            return createJsonResponse({ success: true, products: products, total: products.length });
        } catch (error) {
            return createJsonResponse({ success: false, error: error.toString() });
        }
    }

    return ContentService.createTextOutput("GoldenPOS Product API OK").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);
        var action = data.action;
        var ss = SpreadsheetApp.getActiveSpreadsheet();

        // ⚠️ TEMPORARY BLOCKER: Abaikan request lama (1 per 1)
        if (action === "updateProduct") {
            return createJsonResponse({ success: true, message: "BLOCKED - antrian lama diabaikan" });
        }
        // ⚠️ END BLOCKER

        // =====================================================
        // 3. UPDATE 1 PRODUK (Dipicu saat edit produk di app)
        // =====================================================
        if (action === "updateProductActive") {
            var p = data.product;
            var sheetName = getSheetNameFromCode(p.kode);
            var sheet = ss.getSheetByName(sheetName);
            if (!sheet) {
                sheet = ss.insertSheet(sheetName);
                formatSheetHeaders(sheet);
            }

            var lastRow = sheet.getLastRow();
            var found = false;

            if (lastRow >= DATA_START_ROW) {
                var range = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1);
                var values = range.getValues();
                for (var i = 0; i < values.length; i++) {
                    if (String(values[i][0]).toUpperCase() === String(p.kode).toUpperCase()) {
                        var row = DATA_START_ROW + i;
                        sheet.getRange(row, 1, 1, 5).setValues([[p.kode.toUpperCase(), p.nama, p.hargaBeli, p.hargaJual, p.stok]]);
                        sheet.getRange(row, 6).setFormula("=IF(D" + row + ">0;(D" + row + "-C" + row + ")/D" + row + ";0)");
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                var newRow = Math.max(sheet.getLastRow() + 1, DATA_START_ROW);
                sheet.getRange(newRow, 1, 1, 5).setValues([[p.kode.toUpperCase(), p.nama, p.hargaBeli, p.hargaJual, p.stok]]);
                sheet.getRange(newRow, 6).setFormula("=IF(D" + newRow + ">0;(D" + newRow + "-C" + newRow + ")/D" + newRow + ";0)");
                // Tambahkan format karena ini baris baru
                sheet.getRange(newRow, 3, 1, 2).setNumberFormat("#,##0");
                sheet.getRange(newRow, 6).setNumberFormat("0.0%");
            }

            rebuildAllSheet(ss);
            return createJsonResponse({ success: true });
        }

        // =====================================================
        // 4. BULK UPLOAD - AUTO REPLACE
        // =====================================================
        if (action === "bulkUpdateProducts") {
            var allProducts = data.products || [];
            if (allProducts.length === 0) return createJsonResponse({ success: false, error: "Tidak ada data produk" });

            // Kelompokkan produk berdasarkan prefix kode
            var grouped = {};
            CATEGORY_SHEETS.forEach(function (name) { grouped[name] = []; });

            allProducts.forEach(function (p) {
                var sheetName = getSheetNameFromCode(p.kode);
                grouped[sheetName].push(p);
            });

            // AUTO REPLACE per sheet kategori
            CATEGORY_SHEETS.forEach(function (name) {
                var sheet = ss.getSheetByName(name);
                if (!sheet) sheet = ss.insertSheet(name);

                // Selalu format ulang header (Row 1-3)
                formatSheetHeaders(sheet);

                // Hapus data lama (dari row 4 ke bawah)
                if (sheet.getLastRow() >= DATA_START_ROW) {
                    sheet.getRange(DATA_START_ROW, 1, sheet.getLastRow() - DATA_START_ROW + 1, 6).clearContent();
                }

                var prods = grouped[name];
                if (prods.length === 0) return;

                // Pastikan baris cukup
                var maxRows = sheet.getMaxRows();
                var neededRows = prods.length + DATA_START_ROW;
                if (neededRows > maxRows) {
                    sheet.insertRowsAfter(maxRows, neededRows - maxRows + 50);
                }

                // Tulis data (kolom A-E)
                var rowData = prods.map(function (p) {
                    return [String(p.kode).toUpperCase(), p.nama, p.hargaBeli, p.hargaJual, p.stok];
                });
                sheet.getRange(DATA_START_ROW, 1, rowData.length, 5).setValues(rowData);

                // Formula Gross Margin (kolom F)
                var formulas = [];
                for (var j = 0; j < rowData.length; j++) {
                    var r = DATA_START_ROW + j;
                    formulas.push(["=IF(D" + r + ">0;(D" + r + "-C" + r + ")/D" + r + ";0)"]);
                }
                sheet.getRange(DATA_START_ROW, 6, formulas.length, 1).setFormulas(formulas);

                // Format angka
                sheet.getRange(DATA_START_ROW, 3, rowData.length, 1).setNumberFormat("#,##0");
                sheet.getRange(DATA_START_ROW, 4, rowData.length, 1).setNumberFormat("#,##0");
                sheet.getRange(DATA_START_ROW, 5, rowData.length, 1).setNumberFormat("0");
                sheet.getRange(DATA_START_ROW, 6, rowData.length, 1).setNumberFormat("0.0%");

                sheet.autoResizeColumns(1, 6);
            });

            // Rebuild ALL PRODUK
            rebuildAllSheet(ss);

            // Update timestamp Upload
            var timestamp = getTimestampText();
            updateTimestamp(ss, "upload", timestamp);

            var stats = {};
            CATEGORY_SHEETS.forEach(function (name) { stats[name] = grouped[name].length; });

            return createJsonResponse({
                success: true,
                message: "Bulk upload selesai!",
                total: allProducts.length,
                perSheet: stats
            });
        }

    } catch (error) {
        return createJsonResponse({ success: false, error: error.toString() });
    }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

// Format header sheet (Row 1: Upload, Row 2: Sync, Row 3: Headers)
function formatSheetHeaders(sheet) {
    // === Bersihkan sisa merge/teks lama di baris 1-3 kolom G ke kanan ===
    var lastCol = sheet.getMaxColumns();
    if (lastCol > 6) {
        // Break merge & clear content baris 1-3 kolom G ke kanan
        sheet.getRange(1, 7, 3, lastCol - 6).breakApart();
        sheet.getRange(1, 7, 3, lastCol - 6).clearContent();
        sheet.getRange(1, 7, 3, lastCol - 6).clearFormat();
    }

    // Break merge lama di baris 1-2 kolom A-F (agar bisa re-merge)
    sheet.getRange(1, 1, 1, 6).breakApart();
    sheet.getRange(2, 1, 1, 6).breakApart();

    // Row 1: Terakhir Upload (merge A-F)
    sheet.getRange(1, 1, 1, 6).merge()
        .setValue("🕐 Terakhir Upload : -")
        .setFontWeight("bold")
        .setBackground("#FFECB3")
        .setFontColor("#5D4037")
        .setHorizontalAlignment("left");

    // Row 2: Terakhir Kasir Sync (merge A-F)
    sheet.getRange(2, 1, 1, 6).merge()
        .setValue("🕐 Terakhir Kasir Sync : -")
        .setFontWeight("bold")
        .setBackground("#90CAF9")
        .setFontColor("#0D47A1")
        .setHorizontalAlignment("left");

    // Row 3: Column headers
    sheet.getRange(3, 1, 1, 6).setValues([HEADERS]);
    sheet.getRange(3, 1, 1, 6).setFontWeight("bold").setBackground("#E0E0E0").setHorizontalAlignment("center");
    sheet.setFrozenRows(3);

    var sheetName = sheet.getName();
    var range = sheet.getRange("A" + DATA_START_ROW + ":A");

    // Hapus conditional formatting lama kolom A
    var rules = sheet.getConditionalFormatRules();
    var newRules = rules.filter(function (r) {
        return r.getRanges()[0].getColumn() !== 1;
    });

    // Rule 1: MERAH jika KODE duplikat (hanya cek baris data, skip header)
    var dupeRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied("=COUNTIF($A$" + DATA_START_ROW + ":$A;A" + DATA_START_ROW + ")>1")
        .setBackground("#FFCDD2")
        .setFontColor("#C62828")
        .setBold(true)
        .setRanges([range])
        .build();
    newRules.push(dupeRule);

    // Rule 2: ORANGE jika FORMAT KODE salah (hanya sheet kategori)
    if (CATEGORY_SHEETS.indexOf(sheetName) >= 0) {
        var regex = "^" + sheetName + "-[0-9]{4}[A-Za-z]*$";
        var wrongFormatRule = SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=AND(A' + DATA_START_ROW + '<>"";NOT(REGEXMATCH(UPPER(A' + DATA_START_ROW + ');"' + regex + '")))')
            .setBackground("#FFE0B2")
            .setFontColor("#E65100")
            .setBold(true)
            .setRanges([range])
            .build();
        newRules.push(wrongFormatRule);
    }

    sheet.setConditionalFormatRules(newRules);

    // Hapus SEMUA data validation lama dari kolom A (termasuk sisa versi lama)
    sheet.getRange("A1:A").clearDataValidations();

    // Data Validation baru (hanya sheet kategori, mulai dari baris data)
    if (CATEGORY_SHEETS.indexOf(sheetName) >= 0) {
        var regex = "^" + sheetName + "-[0-9]{4}[A-Za-z]*$";
        var validationRule = SpreadsheetApp.newDataValidation()
            .requireFormulaSatisfied('=AND(COUNTIF($A$' + DATA_START_ROW + ':$A;A' + DATA_START_ROW + ')<=1;OR(A' + DATA_START_ROW + '="";REGEXMATCH(UPPER(A' + DATA_START_ROW + ');"' + regex + '")))')
            .setAllowInvalid(true)
            .setHelpText("⚠️ FORMAT KODE TIDAK VALID!\n\n✅ Format benar: " + sheetName + "-XXXX (4 digit angka)\n   Contoh: " + sheetName + "-0001, " + sheetName + "-0001A\n\n❌ Salah: " + sheetName + "-01, " + sheetName + "-001, " + sheetName + "0001\n   (harus 4 digit + wajib ada tanda -)\n\n❌ Kode tidak boleh duplikat")
            .build();
        sheet.getRange("A" + DATA_START_ROW + ":A").setDataValidation(validationRule);
    }
}

// Update timestamp di semua sheet
function updateTimestamp(ss, type, timestamp) {
    var row = (type === "upload") ? 1 : 2;
    var label = (type === "upload") ? "🕐 Terakhir Upload : " : "🕐 Terakhir Kasir Sync : ";

    CATEGORY_SHEETS.forEach(function (name) {
        var s = ss.getSheetByName(name);
        if (s) s.getRange(row, 1).setValue(label + timestamp);
    });
    var allS = ss.getSheetByName(ALL_SHEET);
    if (allS) allS.getRange(row, 1).setValue(label + timestamp);
}

// Rebuild ALL PRODUK sheet
function rebuildAllSheet(ss) {
    var allSheet = ss.getSheetByName(ALL_SHEET);
    if (!allSheet) {
        allSheet = ss.insertSheet(ALL_SHEET);
        allSheet.setTabColor("#FF6D00");
    }

    // Hapus proteksi sementara agar script bisa tulis
    var protections = allSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < protections.length; p++) {
        protections[p].remove();
    }

    // Selalu format ulang header (Row 1-3) + bersihkan sisa lama
    formatSheetHeaders(allSheet);

    // Hapus data lama
    if (allSheet.getLastRow() >= DATA_START_ROW) {
        allSheet.getRange(DATA_START_ROW, 1, allSheet.getLastRow() - DATA_START_ROW + 1, 6).clearContent();
    }

    // Kumpulkan semua data dari 5 sheet kategori
    var allData = [];
    CATEGORY_SHEETS.forEach(function (name) {
        var sheet = ss.getSheetByName(name);
        if (!sheet || sheet.getLastRow() < DATA_START_ROW) return;

        var data = sheet.getRange(DATA_START_ROW, 1, sheet.getLastRow() - DATA_START_ROW + 1, 5).getValues();
        data.forEach(function (row) {
            if (row[0]) allData.push(row);
        });
    });

    if (allData.length === 0) {
        // Tetap pasang proteksi walau kosong
        protectAllSheet(allSheet);
        return;
    }

    // Pastikan baris cukup
    var maxRows = allSheet.getMaxRows();
    var neededRows = allData.length + DATA_START_ROW;
    if (neededRows > maxRows) {
        allSheet.insertRowsAfter(maxRows, neededRows - maxRows + 50);
    }

    // Tulis data
    allSheet.getRange(DATA_START_ROW, 1, allData.length, 5).setValues(allData);

    // Formula Gross Margin
    var formulas = [];
    for (var j = 0; j < allData.length; j++) {
        var r = DATA_START_ROW + j;
        formulas.push(["=IF(D" + r + ">0;(D" + r + "-C" + r + ")/D" + r + ";0)"]);
    }
    allSheet.getRange(DATA_START_ROW, 6, formulas.length, 1).setFormulas(formulas);

    // Format
    allSheet.getRange(DATA_START_ROW, 3, allData.length, 1).setNumberFormat("#,##0");
    allSheet.getRange(DATA_START_ROW, 4, allData.length, 1).setNumberFormat("#,##0");
    allSheet.getRange(DATA_START_ROW, 5, allData.length, 1).setNumberFormat("0");
    allSheet.getRange(DATA_START_ROW, 6, allData.length, 1).setNumberFormat("0.0%");
    allSheet.autoResizeColumns(1, 6);

    // Pasang proteksi setelah selesai tulis
    protectAllSheet(allSheet);
}

// Proteksi sheet ALL PRODUK agar tidak bisa diedit manual
function protectAllSheet(sheet) {
    var protection = sheet.protect();
    protection.setDescription("⚠️ JANGAN EDIT DI SINI! Edit harga/stok di sheet kategori (BA, BG, BK, KG, TL)");
    protection.setWarningOnly(true); // Tampilkan warning tapi tetap bisa diedit (tanpa perlu manage editors)
}

// Format timestamp
function getTimestampText() {
    var now = new Date();
    var jam = Utilities.formatDate(now, "Asia/Jakarta", "HH:mm");
    var tanggal = Utilities.formatDate(now, "Asia/Jakarta", "dd MMM yyyy");
    return jam + " WIB (" + tanggal + ")";
}

// JSON response helper
function createJsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// AUTO-SYNC: Saat edit manual di sheet kategori → update ALL PRODUK
//            Saat paste di PASTE DARI EXCEL → distribusi ke semua sheet
// =====================================================
function onEdit(e) {
    if (!e) return;

    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();
    var ss = e.source;

    // =========================================
    // HANDLE: KLIK TOMBOL UNDO (checkbox row 4, col 5)
    // =========================================
    if (sheetName === PASTE_SHEET && e.range.getRow() === 4 && e.range.getColumn() === 5) {
        var val = e.range.getValue();
        if (val === true) {
            // Reset checkbox dulu
            e.range.setValue(false);
            // Jalankan undo tanpa UI (simple trigger tidak bisa akses getUi)
            undoFromCheckbox(ss, sheet);
        }
        return;
    }

    // =========================================
    // HANDLE: PASTE DARI EXCEL
    // =========================================
    if (sheetName === PASTE_SHEET) {
        var lastRow = sheet.getLastRow();
        if (lastRow < PASTE_DATA_ROW) return; // Belum ada data

        // Baca semua data yang di-paste
        var pasteData = sheet.getRange(PASTE_DATA_ROW, 1, lastRow - PASTE_DATA_ROW + 1, 5).getValues();
        var validData = pasteData.filter(function (row) {
            return row[0] && String(row[0]).trim() !== "" && String(row[0]).toUpperCase() !== "KODE";
        });

        if (validData.length === 0) return;

        // Kelompokkan berdasarkan prefix
        var grouped = {};
        CATEGORY_SHEETS.forEach(function (name) { grouped[name] = []; });

        validData.forEach(function (row) {
            var target = getSheetNameFromCode(row[0]);
            grouped[target].push([
                String(row[0]).toUpperCase(),
                row[1],
                Number(row[2]) || 0,
                Number(row[3]) || 0,
                Number(row[4]) || 0
            ]);
        });

        // ⚡ BACKUP data lama sebelum replace
        backupAllData(ss);

        // AUTO REPLACE semua sheet kategori
        CATEGORY_SHEETS.forEach(function (name) {
            var catSheet = ss.getSheetByName(name);
            if (!catSheet) { catSheet = ss.insertSheet(name); }
            formatSheetHeaders(catSheet);

            // Hapus data lama
            if (catSheet.getLastRow() >= DATA_START_ROW) {
                catSheet.getRange(DATA_START_ROW, 1, catSheet.getLastRow() - DATA_START_ROW + 1, 6).clearContent();
            }

            var prods = grouped[name];
            if (prods.length === 0) return;

            // Pastikan baris cukup
            var maxRows = catSheet.getMaxRows();
            var neededRows = prods.length + DATA_START_ROW;
            if (neededRows > maxRows) {
                catSheet.insertRowsAfter(maxRows, neededRows - maxRows + 50);
            }

            // Tulis data
            catSheet.getRange(DATA_START_ROW, 1, prods.length, 5).setValues(prods);

            // Formula Gross Margin
            var formulas = [];
            for (var j = 0; j < prods.length; j++) {
                var r = DATA_START_ROW + j;
                formulas.push(["=IF(D" + r + ">0;(D" + r + "-C" + r + ")/D" + r + ";0)"]);
            }
            catSheet.getRange(DATA_START_ROW, 6, formulas.length, 1).setFormulas(formulas);

            // Format angka
            catSheet.getRange(DATA_START_ROW, 3, prods.length, 1).setNumberFormat("#,##0");
            catSheet.getRange(DATA_START_ROW, 4, prods.length, 1).setNumberFormat("#,##0");
            catSheet.getRange(DATA_START_ROW, 5, prods.length, 1).setNumberFormat("0");
            catSheet.getRange(DATA_START_ROW, 6, prods.length, 1).setNumberFormat("0.0%");
            catSheet.autoResizeColumns(1, 6);
        });

        // Rebuild ALL PRODUK
        rebuildAllSheet(ss);

        // Update timestamp
        var timestamp = getTimestampText();
        updateTimestamp(ss, "upload", timestamp);

        // Hapus data dari paste sheet + kembalikan header
        if (sheet.getLastRow() >= PASTE_DATA_ROW) {
            sheet.getRange(PASTE_DATA_ROW, 1, sheet.getLastRow() - PASTE_DATA_ROW + 1, sheet.getMaxColumns()).clearContent();
        }
        formatPasteSheet(sheet);

        // Update status di paste sheet (Row 1)
        sheet.getRange(1, 1).setValue("✅ BERHASIL! " + validData.length + " produk didistribusikan ke semua sheet (" + timestamp + ")");

        return;
    }

    // =========================================
    // HANDLE: Edit manual di sheet kategori
    // SMART REBUILD: 
    //   - Edit KODE (kolom A) → rebuild total (mencegah duplikat)
    //   - Hapus produk (kode kosong) → rebuild total
    //   - Edit nama/harga/stok (kolom B-E) → update cepat per baris
    // =========================================
    if (CATEGORY_SHEETS.indexOf(sheetName) === -1) return;

    var editedRow = e.range.getRow();
    var editedCol = e.range.getColumn();
    if (editedRow < DATA_START_ROW) return;

    // Cek apakah yang diedit adalah kolom KODE (kolom A = 1)
    var isKodeEdited = (editedCol === 1);

    // Cek apakah kode sekarang kosong (produk dihapus)
    var kode = sheet.getRange(editedRow, 1).getValue();
    var kodeKosong = (!kode || String(kode).trim() === "");

    // CASE 1: Kode diedit ATAU kode kosong → REBUILD total
    if (isKodeEdited || kodeKosong) {
        rebuildAllSheet(ss);
        return;
    }

    // CASE 2: Edit kolom lain (nama/harga/stok) → UPDATE CEPAT per baris
    var allSheet = ss.getSheetByName(ALL_SHEET);
    if (!allSheet) return;

    var kodeStr = String(kode).toUpperCase();
    var nama = sheet.getRange(editedRow, 2).getValue();
    var hargaBeli = sheet.getRange(editedRow, 3).getValue();
    var hargaJual = sheet.getRange(editedRow, 4).getValue();
    var stok = sheet.getRange(editedRow, 5).getValue();

    var lastRow = allSheet.getLastRow();
    if (lastRow < DATA_START_ROW) {
        // ALL PRODUK kosong, rebuild saja
        rebuildAllSheet(ss);
        return;
    }

    // Cari baris di ALL PRODUK berdasarkan kode
    var allData = allSheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
    var foundRow = -1;
    for (var i = 0; i < allData.length; i++) {
        if (String(allData[i][0]).toUpperCase() === kodeStr) {
            foundRow = DATA_START_ROW + i;
            break;
        }
    }

    if (foundRow > 0) {
        // Update baris yang sudah ada (CEPAT - hanya 1 baris)
        allSheet.getRange(foundRow, 1, 1, 5).setValues([[kode, nama, hargaBeli, hargaJual, stok]]);
    } else {
        // Kode tidak ditemukan di ALL PRODUK (seharusnya tidak terjadi)
        // Fallback: rebuild untuk memastikan sinkron
        rebuildAllSheet(ss);
    }
}

// Format sheet MASTER
function formatPasteSheet(sheet) {
    // Row 1: Status/instruksi (merge A-E)
    sheet.getRange(1, 1, 1, 5).merge()
        .setValue("📋 MASTER — Paste data Excel di bawah, otomatis distribusi ke semua sheet")
        .setFontWeight("bold")
        .setBackground("#C8E6C9")
        .setFontColor("#1B5E20")
        .setHorizontalAlignment("left");

    // Row 2: Column headers
    sheet.getRange(2, 1, 1, 5).setValues([PASTE_HEADERS]);
    sheet.getRange(2, 1, 1, 5).setFontWeight("bold").setBackground("#E0E0E0").setHorizontalAlignment("center");

    // Row 3: Warning merah
    sheet.getRange(3, 1, 1, 5).merge()
        .setValue("⚠️ Jika ada barang baru, jangan tambah produk disini !")
        .setFontWeight("bold")
        .setFontColor("#D32F2F")
        .setBackground("#FFCDD2")
        .setHorizontalAlignment("left");

    // Row 4: Tombol UNDO (merge A-D untuk label, E untuk checkbox)
    sheet.getRange(4, 1, 1, 4).breakApart();
    sheet.getRange(4, 1, 1, 4).merge()
        .setValue("↩️ KLIK CHECKBOX UNTUK UNDO →")
        .setFontWeight("bold")
        .setFontColor("#FFFFFF")
        .setBackground("#F44336")
        .setHorizontalAlignment("right")
        .setVerticalAlignment("middle");

    // Checkbox di kolom E row 4
    sheet.getRange(4, 5).insertCheckboxes();
    sheet.getRange(4, 5)
        .setValue(false)
        .setBackground("#F44336")
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");

    sheet.setFrozenRows(4);
    sheet.setRowHeight(4, 35);

    // Auto resize
    sheet.autoResizeColumns(1, 5);
}

// =====================================================
// BACKUP & UNDO SYSTEM
// =====================================================

// Backup semua data kategori ke sheet _BACKUP (sebelum paste replace)
function backupAllData(ss) {
    var backupSheet = ss.getSheetByName(BACKUP_SHEET);
    if (!backupSheet) {
        backupSheet = ss.insertSheet(BACKUP_SHEET);
    }
    backupSheet.clear();
    backupSheet.hideSheet(); // Sembunyikan sheet backup

    var allData = [];
    // Kumpulkan semua data dari 5 sheet kategori
    CATEGORY_SHEETS.forEach(function (name) {
        var sheet = ss.getSheetByName(name);
        if (!sheet || sheet.getLastRow() < DATA_START_ROW) return;

        var data = sheet.getRange(DATA_START_ROW, 1, sheet.getLastRow() - DATA_START_ROW + 1, 5).getValues();
        data.forEach(function (row) {
            if (row[0]) allData.push(row);
        });
    });

    if (allData.length === 0) return;

    // Tulis backup + timestamp
    backupSheet.getRange(1, 1).setValue("BACKUP: " + getTimestampText() + " | " + allData.length + " produk");
    backupSheet.getRange(2, 1, allData.length, 5).setValues(allData);
}

// Undo: Restore dari backup terakhir
function undoLastPaste() {
    var ui = SpreadsheetApp.getUi();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var backupSheet = ss.getSheetByName(BACKUP_SHEET);

    if (!backupSheet || backupSheet.getLastRow() < 2) {
        ui.alert("❌ Tidak Ada Backup", "Belum ada data backup untuk di-undo.", ui.ButtonSet.OK);
        return;
    }

    // Tampilkan info backup
    var backupInfo = backupSheet.getRange(1, 1).getValue();
    var response = ui.alert(
        "↩️ Undo Terakhir",
        "Apakah Anda yakin ingin mengembalikan data ke kondisi sebelumnya?\n\n" + backupInfo + "\n\n⚠️ Ini akan MENIMPA semua data di sheet kategori dengan data backup.",
        ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) return;

    // Baca data backup
    var backupData = backupSheet.getRange(2, 1, backupSheet.getLastRow() - 1, 5).getValues();
    var validData = backupData.filter(function (row) { return row[0]; });

    if (validData.length === 0) {
        ui.alert("❌ Data Kosong", "Backup tidak berisi data.", ui.ButtonSet.OK);
        return;
    }

    // Kelompokkan berdasarkan prefix
    var grouped = {};
    CATEGORY_SHEETS.forEach(function (name) { grouped[name] = []; });

    validData.forEach(function (row) {
        var target = getSheetNameFromCode(row[0]);
        grouped[target].push(row);
    });

    // Restore ke masing-masing sheet
    CATEGORY_SHEETS.forEach(function (name) {
        var catSheet = ss.getSheetByName(name);
        if (!catSheet) { catSheet = ss.insertSheet(name); }
        formatSheetHeaders(catSheet);

        if (catSheet.getLastRow() >= DATA_START_ROW) {
            catSheet.getRange(DATA_START_ROW, 1, catSheet.getLastRow() - DATA_START_ROW + 1, 6).clearContent();
        }

        var prods = grouped[name];
        if (prods.length === 0) return;

        var maxRows = catSheet.getMaxRows();
        var neededRows = prods.length + DATA_START_ROW;
        if (neededRows > maxRows) {
            catSheet.insertRowsAfter(maxRows, neededRows - maxRows + 50);
        }

        catSheet.getRange(DATA_START_ROW, 1, prods.length, 5).setValues(prods);

        var formulas = [];
        for (var j = 0; j < prods.length; j++) {
            var r = DATA_START_ROW + j;
            formulas.push(["=IF(D" + r + ">0;(D" + r + "-C" + r + ")/D" + r + ";0)"]);
        }
        catSheet.getRange(DATA_START_ROW, 6, formulas.length, 1).setFormulas(formulas);

        catSheet.getRange(DATA_START_ROW, 3, prods.length, 1).setNumberFormat("#,##0");
        catSheet.getRange(DATA_START_ROW, 4, prods.length, 1).setNumberFormat("#,##0");
        catSheet.getRange(DATA_START_ROW, 5, prods.length, 1).setNumberFormat("0");
        catSheet.getRange(DATA_START_ROW, 6, prods.length, 1).setNumberFormat("0.0%");
        catSheet.autoResizeColumns(1, 6);
    });

    rebuildAllSheet(ss);

    // Update status di MASTER sheet
    var masterSheet = ss.getSheetByName(PASTE_SHEET);
    if (masterSheet) {
        masterSheet.getRange(1, 1).setValue("↩️ UNDO BERHASIL! " + validData.length + " produk dikembalikan (" + getTimestampText() + ")");
    }

    ui.alert("✅ Undo Berhasil!", validData.length + " produk berhasil dikembalikan ke kondisi sebelumnya.", ui.ButtonSet.OK);
}

// Undo dari checkbox (tanpa UI dialog - untuk simple trigger onEdit)
function undoFromCheckbox(ss, masterSheet) {
    var backupSheet = ss.getSheetByName(BACKUP_SHEET);

    if (!backupSheet || backupSheet.getLastRow() < 2) {
        masterSheet.getRange(1, 1).setValue("❌ Tidak ada backup untuk di-undo");
        return;
    }

    // Baca data backup
    var backupData = backupSheet.getRange(2, 1, backupSheet.getLastRow() - 1, 5).getValues();
    var validData = backupData.filter(function (row) { return row[0]; });

    if (validData.length === 0) {
        masterSheet.getRange(1, 1).setValue("❌ Backup kosong, tidak bisa undo");
        return;
    }

    // Kelompokkan berdasarkan prefix
    var grouped = {};
    CATEGORY_SHEETS.forEach(function (name) { grouped[name] = []; });

    validData.forEach(function (row) {
        var target = getSheetNameFromCode(row[0]);
        grouped[target].push(row);
    });

    // Restore ke masing-masing sheet
    CATEGORY_SHEETS.forEach(function (name) {
        var catSheet = ss.getSheetByName(name);
        if (!catSheet) { catSheet = ss.insertSheet(name); }
        formatSheetHeaders(catSheet);

        if (catSheet.getLastRow() >= DATA_START_ROW) {
            catSheet.getRange(DATA_START_ROW, 1, catSheet.getLastRow() - DATA_START_ROW + 1, 6).clearContent();
        }

        var prods = grouped[name];
        if (prods.length === 0) return;

        var maxRows = catSheet.getMaxRows();
        var neededRows = prods.length + DATA_START_ROW;
        if (neededRows > maxRows) {
            catSheet.insertRowsAfter(maxRows, neededRows - maxRows + 50);
        }

        catSheet.getRange(DATA_START_ROW, 1, prods.length, 5).setValues(prods);

        var formulas = [];
        for (var j = 0; j < prods.length; j++) {
            var r = DATA_START_ROW + j;
            formulas.push(["=IF(D" + r + ">0;(D" + r + "-C" + r + ")/D" + r + ";0)"]);
        }
        catSheet.getRange(DATA_START_ROW, 6, formulas.length, 1).setFormulas(formulas);

        catSheet.getRange(DATA_START_ROW, 3, prods.length, 1).setNumberFormat("#,##0");
        catSheet.getRange(DATA_START_ROW, 4, prods.length, 1).setNumberFormat("#,##0");
        catSheet.getRange(DATA_START_ROW, 5, prods.length, 1).setNumberFormat("0");
        catSheet.getRange(DATA_START_ROW, 6, prods.length, 1).setNumberFormat("0.0%");
        catSheet.autoResizeColumns(1, 6);
    });

    rebuildAllSheet(ss);

    // Update status di MASTER sheet (tanpa popup)
    masterSheet.getRange(1, 1).setValue("↩️ UNDO BERHASIL! " + validData.length + " produk dikembalikan (" + getTimestampText() + ")");
}
