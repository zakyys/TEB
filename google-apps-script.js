/**
 * Google Apps Script untuk GoldenPOS
 * Fitur:
 * - Kirim data penjualan harian
 * - Kirim data tukar/refund
 * - Kirim data tamu (<12 dan >12) + daftar lost
 * - Sync produk 2-arah (Sheet <-> Website)
 */

function doGet(e) {
    // Handle manual testing / authorization runs
    if (!e || !e.parameter) {
        return ContentService.createTextOutput("GoldenPOS API OK - Ready to receive requests").setMimeType(ContentService.MimeType.TEXT);
    }

    var action = e.parameter.action;

    if (action === "getProducts") {
        try {
            var ss = SpreadsheetApp.getActiveSpreadsheet();
            var sheet = ss.getSheetByName("Produk");

            if (!sheet) {
                return ContentService.createTextOutput(JSON.stringify({
                    success: false,
                    error: "Sheet 'Produk' tidak ditemukan"
                })).setMimeType(ContentService.MimeType.JSON);
            }

            var data = sheet.getDataRange().getValues();
            var products = [];

            for (var i = 1; i < data.length; i++) {
                if (data[i][0]) {
                    products.push({
                        kode: data[i][0],
                        nama: data[i][1],
                        kategori: data[i][2],
                        hargaJual: data[i][3],
                        hargaBeli: data[i][4],
                        stok: data[i][5]
                    });
                }
            }

            return ContentService.createTextOutput(JSON.stringify({
                success: true,
                products: products
            })).setMimeType(ContentService.MimeType.JSON);

        } catch (error) {
            return ContentService.createTextOutput(JSON.stringify({
                success: false,
                error: error.toString()
            })).setMimeType(ContentService.MimeType.JSON);
        }
    }

    return ContentService.createTextOutput("GoldenPOS API OK").setMimeType(ContentService.MimeType.TEXT);
}


function doPost(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var data = JSON.parse(e.postData.contents);
        var action = data.action;

        // Update single product
        if (action === "updateProduct") {
            return updateProduct(data.product);
        }

        // Reset/Clear Sheets
        if (action === "resetSheets") {
            return resetSheets(data);
        }

        // Monthly Recap - Best Sellers
        if (action === "monthlyRecap") {
            return saveMonthlyRecap(data);
        }

        // SIMPAN BACKUP KE GOOGLE DRIVE (Run before saveSalesData to get the link)
        if (data.fullBackup) {
            data.backupInfo = saveBackupToDrive(data.fullBackup);
        }

        // Default: Kirim data penjualan
        var result = saveSalesData(data);

        // KIRIM TELEGRAM (Server Side - Anti Blokir)
        // Kita kirim pesan teks dari sini agar pasti terkirim
        if (data.sendNotification) {
            sendTelegramNotification(data);
        }

        return result;

    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// Fitur Baru: Kirim Notifikasi Telegram dari Google Script
function sendTelegramNotification(data) {
    var BOT_TOKEN = data.telegramBotToken;
    var CHAT_ID = data.telegramChatId;

    if (!BOT_TOKEN || !CHAT_ID) return; // Don't send if not configured

    try {
        var items = data.items || [];
        var visitors = data.visitors || {};
        var totalSales = items.reduce(function (sum, item) { return sum + item.total; }, 0);
        var totalTamu = (visitors.before12 || 0) + (visitors.after12 || 0);

        var message = "📊 *LAPORAN TOKO BAUT BBM*\n";
        message += "📅 " + (data.date || new Date().toLocaleDateString()) + "\n";
        message += "━━━━━━━━━━━━━━━━━━━━\n\n";

        message += "💰 *PENJUALAN HARI INI*\n";
        message += "📦 Total Item: " + items.length + " item\n";
        message += "💵 Total Omzet: Rp " + Number(totalSales).toLocaleString('id-ID') + "\n\n";

        message += "👥 *DATA TAMU*\n";
        message += "📊 Total Tamu: " + totalTamu + " orang\n";
        message += "❌ Lost: " + (visitors.lost || 0) + " orang\n\n";

        // List Lost jika ada
        if (visitors.lostList && visitors.lostList.length > 0) {
            message += "📝 *KET. LOST:*\n";
            visitors.lostList.forEach(function (desc) {
                message += "• " + desc + "\n";
            });
            message += "\n";
        }

        // Top 5 Produk
        if (items.length > 0) {
            message += "🏆 *TOP 5 TERLARIS*\n";
            var top5 = items.slice().sort(function (a, b) { return b.quantity - a.quantity }).slice(0, 5);
            top5.forEach(function (item, idx) {
                message += (idx + 1) + ". " + item.kode + " (" + item.quantity + ")\n";
            });
        }

        message += "\n⏰ Update: " + new Date().toLocaleTimeString('id-US', { timeZone: 'Asia/Jakarta' });

        var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
        var payload = {
            "chat_id": CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        };

        UrlFetchApp.fetch(url, {
            "method": "post",
            "contentType": "application/json",
            "payload": JSON.stringify(payload)
        });

    } catch (e) {
        // Ignore stats error, main priority is saving to sheet
        Logger.log("Telegram Error: " + e.toString());
    }
}

// Fitur: Simpan Full Backup ke Google Drive
function saveBackupToDrive(backupData) {
    try {
        var FOLDER_NAME = "Backup POS - BBM";

        // Get or create folder
        var folders = DriveApp.getFoldersByName(FOLDER_NAME);
        var folder;
        if (folders.hasNext()) {
            folder = folders.next();
        } else {
            folder = DriveApp.createFolder(FOLDER_NAME);
            Logger.log("Created folder: " + FOLDER_NAME);
        }

        // Generate filename: backupfull_21-01-2026_Jam_15_30.json
        var now = new Date();
        var day = String(now.getDate()).padStart(2, '0');
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var year = now.getFullYear();
        var hours = String(now.getHours()).padStart(2, '0');
        var minutes = String(now.getMinutes()).padStart(2, '0');

        var fileName = "backupfull_" + day + "-" + month + "-" + year + "_Jam_" + hours + "_" + minutes + ".json";

        // Create file content
        var jsonContent = JSON.stringify(backupData, null, 2);
        var blob = Utilities.newBlob(jsonContent, "application/json", fileName);

        // Save to folder
        var file = folder.createFile(blob);

        // Set sharing permission: Anyone with link can view
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        // Set folder sharing too
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        // Get file ID and folder URL
        var fileId = file.getId();
        var folderId = folder.getId();
        var folderUrl = "https://drive.google.com/drive/folders/" + folderId + "?usp=sharing";
        var downloadUrl = "https://drive.google.com/uc?id=" + fileId + "&export=download";

        Logger.log("Backup saved: " + fileName);
        Logger.log("Folder URL: " + folderUrl);
        Logger.log("Download URL: " + downloadUrl);

        return {
            success: true,
            fileName: fileName,
            fileId: fileId,
            folderUrl: folderUrl,
            downloadUrl: downloadUrl
        };

    } catch (error) {
        Logger.log("Drive Backup Error: " + error.toString());
        return {
            success: false,
            error: error.toString()
        };
    }
}

// Reset/Clear Sheets completely
function resetSheets(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var month = data.month || "Unknown";

    // 1. Clear Daily Sheet completely
    var dailySheetName = "Harian " + month;
    var dailySheet = ss.getSheetByName(dailySheetName);
    if (dailySheet) {
        dailySheet.clear(); // Clear everything - data, formatting, all
    }

    // 2. Reset Monthly Recap with empty structure (keep table headers)
    var recapSheetName = "Recap " + month;
    var recapSheet = ss.getSheetByName(recapSheetName);
    if (recapSheet) {
        recapSheet.clear();
    } else {
        recapSheet = ss.insertSheet(recapSheetName);
    }

    // Call saveMonthlyRecap with empty data to create structure
    saveMonthlyRecap({
        month: month,
        items: [],
        dailyVisitors: [],
        allLostList: [],
        monthlyExchanges: [],
        monthlyNotes: []
    });

    return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: "Sheets reset: " + dailySheetName + ", " + recapSheetName
    })).setMimeType(ContentService.MimeType.JSON);
}

// Save Monthly Recap to separate sheet (per month) with beautiful formatting
function saveMonthlyRecap(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var month = data.month || "Unknown";
    var sheetName = "Recap " + month; // Will result in "Recap Jan 2026"

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        // Taruh Recap tepat setelah Harian bulan yang sama
        var harianName = "Harian " + month;
        var sheets = ss.getSheets();
        var targetPos = 2;
        for (var s = 0; s < sheets.length; s++) {
            if (sheets[s].getName().indexOf(harianName) === 0) {
                targetPos = s + 2;
                break;
            }
        }
        try { ss.setActiveSheet(sheet); ss.moveActiveSheet(targetPos); } catch (e) { }
    }

    // Auto add rows if total rows are less than 1000
    var maxRows = sheet.getMaxRows();
    if (maxRows < 1000) {
        sheet.insertRowsAfter(maxRows, 1000 - maxRows);
    }

    sheet.clear(); // Clear old data to refresh

    var timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // Column widths moved to the end of the function for final enforcement

    // ═══════════════════════════════════════════════════════
    // SECTION 1: BARANG TERLARIS (Columns A-D)
    // ═══════════════════════════════════════════════════════

    // Header Title - Indigo Theme
    sheet.getRange("A1:D1").merge()
        .setValue("🏆 BARANG TERLARIS - " + month)
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#4285F4") // Match Harian (Blue)
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update) - Indigo Style
    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    sheet.getRange("A2:D2").merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#E8EAF6")
        .setFontColor("#3F51B5")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("A3:D3")
        .setValues([["Rank", "Kode Barang", "Nama Barang", "Terjual (Pcs)"]])
        .setFontWeight("bold")
        .setBackground("#E3F2FD") // Light Blue
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#4285F4", SpreadsheetApp.BorderStyle.SOLID);

    var items = data.items || [];
    // USER REQUEST: Limit to TOP 25 only
    var topItems = items.slice(0, 25);

    if (topItems.length > 0) {
        var rows = topItems.map(function (item, index) {
            var rankDisplay = item.rank;

            // Icons for Top 3
            if (item.rank == 1) rankDisplay = "🥇 " + item.rank;
            else if (item.rank == 2) rankDisplay = "🥈 " + item.rank;
            else if (item.rank == 3) rankDisplay = "🥉 " + item.rank;

            return [
                rankDisplay,
                item.kode,
                item.nama,
                item.quantity
            ];
        });

        // Write Top 25 rows
        sheet.getRange(4, 1, rows.length, 4).setValues(rows);

        // Styling for the table
        sheet.getRange(4, 1, rows.length, 4)
            .setBorder(true, true, true, true, true, true, "#BBDEFB", SpreadsheetApp.BorderStyle.SOLID)
            .setFontColor("#1565C0")
            .setFontWeight("bold")
            .setVerticalAlignment("middle");

        // Alignments
        sheet.getRange(4, 1, rows.length, 1).setHorizontalAlignment("center"); // Rank
        sheet.getRange(4, 4, rows.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("center"); // Qty

        // Zebra Striping for better readability
        for (var i = 0; i < rows.length; i++) {
            if (i % 2 != 0) { // Odd rows
                sheet.getRange(4 + i, 1, 1, 4).setBackground("#F5F7FA");
            }
        }

        // Extra highlight for Top 3
        sheet.getRange(4, 1, Math.min(rows.length, 3), 4).setBackground("#E3F2FD");
    }

    // ═══════════════════════════════════════════════════════
    // SECTION 2: DATA PENGUNJUNG (Columns F-J) -> Shifted Left
    // ═══════════════════════════════════════════════════════

    // Ensure all changes are committed before drawing
    SpreadsheetApp.flush();

    // Header Title
    sheet.getRange("F1:J1").merge()
        .setValue("👥 DATA PENGUNJUNG")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#2E7D32") // Green 800
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update) - Styled like others
    sheet.getRange("F2:J2").merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#E8F5E9") // Light Green bg
        .setFontColor("#2E7D32")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("F3:J3")
        .setValues([["📅 Tanggal", "☀️ < 12:00", "🌙 > 12:00", "Σ Total", "❌ Lost"]])
        .setFontWeight("bold")
        .setBackground("#C8E6C9") // Green 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#2E7D32", SpreadsheetApp.BorderStyle.SOLID);

    // Set '❌ Lost' header text red specifically
    sheet.getRange("J3").setFontColor("#D32F2F");

    var dailyVisitors = data.dailyVisitors || [];
    var visitorRow = 4;
    var totalBefore12 = 0;
    var totalAfter12 = 0;
    var totalLost = 0;

    if (dailyVisitors.length > 0) {
        dailyVisitors.forEach(function (day) {
            totalBefore12 += day.before12;
            totalAfter12 += day.after12;
            totalLost += day.lost;

            sheet.getRange(visitorRow, 6, 1, 5) // Column 6 = F
                .setValues([[day.date, day.before12, day.after12, (day.before12 + day.after12), day.lost]])
                .setBorder(true, true, true, true, true, true, "#A5D6A7", SpreadsheetApp.BorderStyle.SOLID);

            // Force Number Format for Visitor Counts (prevent Date auto-format)
            sheet.getRange(visitorRow, 7, 1, 4).setNumberFormat("0"); // Columns G-J (F+1 to F+4)

            // Highlight lost > 0
            if (day.lost > 0) {
                sheet.getRange(visitorRow, 10).setFontColor("red").setFontWeight("bold"); // Column 10 = J
            }

            // Center align numbers
            sheet.getRange(visitorRow, 7, 1, 4).setHorizontalAlignment("center");

            visitorRow++;
        });

        // TOTAL ROW Visitors
        sheet.getRange(visitorRow, 6, 1, 5)
            .setValues([["📊 TOTAL TAMU :", totalBefore12, totalAfter12, totalBefore12 + totalAfter12, totalLost]])
            .setFontWeight("bold")
            .setBackground("#66BB6A")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#1B5E20", SpreadsheetApp.BorderStyle.SOLID);

        // Force Number Format for Total Row as well
        sheet.getRange(visitorRow, 7, 1, 4).setNumberFormat("0").setHorizontalAlignment("center");
    }

    // ═══════════════════════════════════════════════════════
    // SECTION 3: LIST KETERANGAN LOST (Columns L-M) -> Shifted Left
    // ═══════════════════════════════════════════════════════

    // Header Title
    sheet.getRange("L1:M1").merge()
        .setValue("❌ LIST BARANG LOST")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#D32F2F") // Red 700
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update) - Red Style
    sheet.getRange("L2:M2").merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#FFEBEE")
        .setFontColor("#C62828")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("L3:M3")
        .setValues([["📅 Tanggal", "📝 Keterangan Barang"]])
        .setFontWeight("bold")
        .setBackground("#FFCDD2") // Red 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#D32F2F", SpreadsheetApp.BorderStyle.SOLID);

    var allLostList = data.allLostList || [];
    if (allLostList.length > 0) {
        var lostRow = 4;
        allLostList.forEach(function (entry) {
            sheet.getRange(lostRow, 12, 1, 2) // Column 12 = L
                .setValues([[entry.date, "• " + entry.description]])
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

            // Zebra striping for readability
            if (lostRow % 2 == 0) {
                sheet.getRange(lostRow, 12, 1, 2).setBackground("#FEEBEE");
            }

            lostRow++;
        });

    } else {
        sheet.getRange(4, 12, 1, 2).merge() // Column 12 = L
            .setValue("✅ Tidak ada barang lost bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
    }

    // Divider Column N (Spacer)
    sheet.setColumnWidth(14, 20);

    // ═══════════════════════════════════════════════════════
    // SECTION 4: LIST REFUND BARANG (Columns O-U)
    // ═══════════════════════════════════════════════════════

    // Header Title - Red Theme for Refund
    sheet.getRange("O1:U1").merge()
        .setValue("🔄 LIST REFUND BARANG")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#C62828") // Red 800
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update) - Red Style
    sheet.getRange("O2:U2").merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#FFEBEE")
        .setFontColor("#C62828")
        .setHorizontalAlignment("center");

    // Table Headers - Refund theme
    sheet.getRange("O3:U3")
        .setValues([["📅 Tgl Refund", "📅 Tgl Beli", "🏷️ Kode", "📦 Nama Barang", "📊 Qty", "💵 Harga / Pcs", "💰 Total Refund"]])
        .setFontWeight("bold")
        .setBackground("#FFCDD2") // Red 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#C62828", SpreadsheetApp.BorderStyle.SOLID);

    // Use monthlyRefunds, but fallback to monthlyExchanges or refunds to ensure data shows up
    var monthlyRefunds = data.monthlyRefunds || data.monthlyExchanges || data.refunds || data.refundList || [];
    var refundRow = 4;

    if (monthlyRefunds.length > 0) {
        monthlyRefunds.forEach(function (item) {
            // Robust property fallbacks
            var tglBeli = item.tglBeli || item.purchaseDate || "-";
            var namaBarang = item.nama || item.name || "-";
            var qty = item.quantity || item.qty || 1;
            var harga = item.hargaPcs || item.price || item.harga || 0;
            var total = item.totalRefund || item.total || (qty * harga);

            sheet.getRange(refundRow, 15, 1, 7) // Column 15 = O
                .setValues([[
                    item.date,
                    tglBeli,
                    item.kode || "-",
                    "📦 " + namaBarang, // Icon in row data
                    qty,
                    harga,
                    total
                ]])
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

            // Formatting
            sheet.getRange(refundRow, 19).setHorizontalAlignment("center").setNumberFormat("0"); // Qty (S)
            sheet.getRange(refundRow, 20).setNumberFormat("Rp #,##0");      // Harga (T)
            sheet.getRange(refundRow, 21).setNumberFormat("Rp #,##0").setFontColor("#D32F2F").setFontWeight("bold"); // Total (U)

            // Zebra striping - Red theme
            if (refundRow % 2 == 0) {
                sheet.getRange(refundRow, 15, 1, 7).setBackground("#FEEBEE");
            }

            refundRow++;
        });

        // Total Row count - Red Theme
        sheet.getRange(refundRow, 15, 1, 7).merge()
            .setValue("📊 Total Transaksi Refund: " + monthlyRefunds.length)
            .setFontWeight("bold")
            .setBackground("#C62828")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#B71C1C", SpreadsheetApp.BorderStyle.SOLID);
        refundRow++;

    } else {
        sheet.getRange(4, 15, 1, 7).merge()
            .setValue("✅ Tidak ada transaksi refund bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
        refundRow = 5;
    }

    // Divider Column V (Spacer) - Removed V and W, now V is the spacer
    sheet.setColumnWidth(22, 20);

    // ═══════════════════════════════════════════════════════
    // SECTION 5: CATATAN - REKAP BULANAN (Columns W-AC, beside Refund)
    // ═══════════════════════════════════════════════════════
    var notesRow = 1;

    // Header Title
    sheet.getRange(notesRow, 23, 1, 7).merge() // W:AC
        .setValue("📝 CATATAN - REKAP BULANAN")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#7B1FA2") // Purple 700
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");
    notesRow++;

    // Sub-header (Last Update) - Purple Style
    sheet.getRange(notesRow, 23, 1, 7).merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#F3E5F5")
        .setFontColor("#7B1FA2")
        .setHorizontalAlignment("center");
    notesRow++;

    // Table Headers
    sheet.getRange(notesRow, 23, 1, 7)
        .setValues([["📅 Tgl Buat", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "Status", "📅 Tgl Selesai"]])
        .setFontWeight("bold")
        .setBackground("#E1BEE7") // Purple 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#7B1FA2", SpreadsheetApp.BorderStyle.SOLID);
    notesRow++;

    var monthlyNotes = data.monthlyNotes || [];
    if (monthlyNotes.length > 0) {
        monthlyNotes.forEach(function (note) {
            var isHutang = note.type === 'hutang';
            var statusText = isHutang ? (note.completed ? "LUNAS ✅" : "BELUM BAYAR ⏳") : "";

            // Logika baru: Jika tgl buat dan tgl selesai sama, tulis "Di hari yg sama"
            var completedAtText = isHutang ? (note.completedAt || "-") : "";
            if (isHutang && note.completed && note.date === note.completedAt) {
                completedAtText = "Di hari yg sama";
            }

            var rowColor = (isHutang && note.completed) ? "#F5F5F5" : "#FFFFFF";

            sheet.getRange(notesRow, 23, 1, 7)
                .setValues([[
                    note.date,
                    note.type.toUpperCase(),
                    note.customerName,
                    note.content,
                    note.amount,
                    statusText,
                    completedAtText
                ]])
                .setBackground(rowColor)
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

            // Format Amount
            if (note.amount > 0) {
                sheet.getRange(notesRow, 27).setNumberFormat("Rp #,##0"); // Column 27 = AA
            }

            // Color for type
            var typeCell = sheet.getRange(notesRow, 24); // Column 24 = X
            if (note.type === 'hutang') {
                typeCell.setFontColor("#D32F2F").setFontWeight("bold");
            } else if (note.type === 'belanja') {
                typeCell.setFontColor("#2E7D32").setFontWeight("bold");
            } else {
                // Pengingat / Catatan
                typeCell.setFontColor("#7B1FA2").setFontWeight("bold");
            }

            // Color for status (Only for Hutang)
            if (isHutang) {
                var statusCell = sheet.getRange(notesRow, 28); // Column 28 = AB
                if (note.completed) statusCell.setFontColor("#2E7D32").setFontWeight("bold");
                else statusCell.setFontColor("#F57C00").setFontWeight("bold");
            }

            notesRow++;
        });
    } else {
        sheet.getRange(notesRow, 23, 1, 7).merge()
            .setValue("✅ Tidak ada catatan aktif bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
    }

    // --- FINAL ENFORCEMENT: Force Column Widths at the very end ---
    // Section 1: Barang Terlaris
    sheet.setColumnWidth(1, 40);  // A: Rank
    sheet.setColumnWidth(2, 100); // B: Kode
    sheet.setColumnWidth(3, 350); // C: Nama Barang
    sheet.setColumnWidth(4, 100); // D: Terjual
    sheet.setColumnWidth(5, 20);  // E: Spacer

    // Section 2: Data Pengunjung
    sheet.setColumnWidth(6, 120); // F: Tanggal
    sheet.setColumnWidth(7, 125); // G: < 12:00 (WIDE)
    sheet.setColumnWidth(8, 125); // H: > 12:00 (WIDE)
    sheet.setColumnWidth(9, 100); // I: Σ Total
    sheet.setColumnWidth(10, 100);// J: ❌ Lost
    sheet.setColumnWidth(11, 20); // K: Spacer

    // Section 3: Lost List
    sheet.setColumnWidth(12, 100); // L: Tanggal
    sheet.setColumnWidth(13, 300); // M: Keterangan
    sheet.setColumnWidth(14, 20);  // N: Spacer

    // Section 4: Refund
    sheet.setColumnWidth(15, 100); // O: Tgl Refund
    sheet.setColumnWidth(16, 100); // P: Tgl Beli
    sheet.setColumnWidth(17, 100); // Q: Kode
    sheet.setColumnWidth(18, 250); // R: Nama Barang
    sheet.setColumnWidth(19, 50);  // S: Qty
    sheet.setColumnWidth(20, 100); // T: Harga
    sheet.setColumnWidth(21, 100); // U: Total Refund
    sheet.setColumnWidth(22, 20);  // V: Spacer

    // Section 5: Catatan
    sheet.setColumnWidth(23, 100); // W: Tgl Buat
    sheet.setColumnWidth(24, 80);  // X: Jenis
    sheet.setColumnWidth(25, 120); // Y: Nama
    sheet.setColumnWidth(26, 300); // Z: Isi Catatan
    sheet.setColumnWidth(27, 100); // AA: Jumlah
    sheet.setColumnWidth(28, 100); // AB: Status
    sheet.setColumnWidth(29, 100); // AC: Tgl Selesai

    SpreadsheetApp.flush(); // Force apply ALL changes now

    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

// Update product
function updateProduct(product) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName("Produk");

        if (!sheet) {
            sheet = ss.insertSheet("Produk");
            sheet.appendRow(["KODE", "Nama", "Kategori", "Harga Jual", "Harga Beli", "Stok"]);
        }

        var data = sheet.getDataRange().getValues();
        var found = false;

        for (var i = 1; i < data.length; i++) {
            if (data[i][0] === product.kode) {
                sheet.getRange(i + 1, 1, 1, 6).setValues([[
                    product.kode,
                    product.nama,
                    product.kategori,
                    product.hargaJual,
                    product.hargaBeli,
                    product.stok
                ]]);
                found = true;
                break;
            }
        }

        if (!found) {
            sheet.appendRow([
                product.kode,
                product.nama,
                product.kategori,
                product.hargaJual,
                product.hargaBeli,
                product.stok
            ]);
        }

        return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}

// Save sales data with formatting
function saveSalesData(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var today = data.date || new Date().toLocaleDateString("id-ID");

    // Sheet per bulan
    var now = new Date();
    var monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    var sheetName = "Harian " + monthNames[now.getMonth()] + " " + now.getFullYear();

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        // Pindahkan Harian ke posisi paling kiri (posisi 1)
        try { ss.setActiveSheet(sheet); ss.moveActiveSheet(1); } catch (e) { }
    }

    // Auto add rows if total rows are less than 1000
    var maxRows = sheet.getMaxRows();
    if (maxRows < 1000) {
        sheet.insertRowsAfter(maxRows, 1000 - maxRows);
    }

    var items = (data.items || []).slice().reverse(); // Newest first
    var refunds = (data.refunds || []).slice().reverse(); // Newest first
    var exchanges = (data.exchanges || []).slice().reverse(); // Newest first
    var visitors = data.visitors || { before12: 0, after12: 0, total: 0, lost: 0, lostList: [] };

    // Replace mode - hapus data hari ini jika ada
    var lastRow = sheet.getLastRow();
    if (lastRow > 0) {
        var allData = sheet.getRange(1, 1, lastRow, 1).getValues();
        for (var i = allData.length - 1; i >= 0; i--) {
            if (allData[i][0] === "📅 " + today) {
                var endRow = lastRow;
                for (var j = i + 1; j < allData.length; j++) {
                    if (String(allData[j][0]).indexOf("═══") === 0) {
                        endRow = j + 1;
                        break;
                    }
                }
                sheet.deleteRows(i + 1, endRow - i);
                break;
            }
        }
    }

    // Get starting row
    var startRow = sheet.getLastRow() + 1;
    var currentRow = startRow;

    // ═══════════════════════════════════════════════════════
    // SECTION: Header Tanggal
    // ═══════════════════════════════════════════════════════

    sheet.getRange(currentRow, 1, 1, 4).merge()
        .setValue("📅 " + today)
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#4285F4")
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");
    currentRow++;

    // Sub-header (Last Update) - Styled with Icon and Indigo Theme
    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    sheet.getRange(currentRow, 1, 1, 4).merge()
        .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
        .setFontWeight("bold")
        .setFontSize(10)
        .setHorizontalAlignment("center")
        .setBackground("#E8EAF6")
        .setFontColor("#3F51B5");
    currentRow++;

    // ═══════════════════════════════════════════════════════
    // SECTION: Data Tamu
    // ═══════════════════════════════════════════════════════
    sheet.getRange(currentRow, 1, 1, 4).merge()
        .setValue("👥 TAMU HARI INI")
        .setFontWeight("bold")
        .setFontSize(11)
        .setBackground("#E8F5E9")
        .setFontColor("#2E7D32");
    currentRow++;

    // Header tamu
    sheet.getRange(currentRow, 1, 1, 4)
        .setValues([["< 12", "> 12", "Total", "❌ Lost"]])
        .setFontWeight("bold")
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);

    sheet.getRange(currentRow, 1, 1, 3).setBackground("#C8E6C9");
    sheet.getRange(currentRow, 4).setBackground("#C62828").setFontColor("#FFFFFF");
    currentRow++;

    // Data tamu
    sheet.getRange(currentRow, 1, 1, 4)
        .setValues([[visitors.before12, visitors.after12, visitors.total, visitors.lost]])
        .setNumberFormat("0") // Fix: Prevent Date auto-format (e.g. 1 -> 1 Jan 1900)
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);
    currentRow++;

    // Daftar Lost (alasan)
    var lostList = visitors.lostList || [];
    if (lostList.length > 0) {
        sheet.getRange(currentRow, 1, 1, 4).merge()
            .setValue("❌ DAFTAR LOST:")
            .setFontWeight("bold")
            .setFontColor("#FFFFFF")
            .setBackground("#C62828");
        currentRow++;

        lostList.forEach(function (desc, idx) {
            sheet.getRange(currentRow, 1, 1, 4).merge()
                .setValue("  " + (idx + 1) + ". " + desc)
                .setFontColor("#C62828")
                .setBackground("#FFEBEE");
            currentRow++;
        });
    }

    // Spacer
    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;

    // ═══════════════════════════════════════════════════════
    // SECTION: Penjualan
    // ═══════════════════════════════════════════════════════
    if (items.length > 0) {
        sheet.getRange(currentRow, 1, 1, 4).merge()
            .setValue("📦 PENJUALAN HARI INI")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#1565C0") // Dark Blue
            .setFontColor("#FFFFFF"); // White Text
        currentRow++;

        // Header penjualan
        sheet.getRange(currentRow, 1, 1, 4)
            .setValues([["KODE", "Qty", "Harga", "Total"]])
            .setFontWeight("bold")
            .setBackground("#E3F2FD") // Light Blue
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#2196F3", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        var totalSales = 0;
        items.forEach(function (item) {
            var range = sheet.getRange(currentRow, 1, 1, 4);
            range.setValues([[item.kode || "-", item.quantity, item.price, item.total]])
                .setBorder(true, true, true, true, true, true, "#90CAF9", SpreadsheetApp.BorderStyle.SOLID);

            // Jika barang belum dibayar (Hutang), tandai warna MERAH
            if (item.isHutang) {
                range.setFontColor("#D32F2F").setFontWeight("bold"); // Red Bold
            }

            sheet.getRange(currentRow, 2).setNumberFormat("0");
            sheet.getRange(currentRow, 3).setNumberFormat("0");
            sheet.getRange(currentRow, 4).setNumberFormat("#,##0");

            sheet.getRange(currentRow, 2, 1, 3).setHorizontalAlignment("right");
            totalSales += item.total;
            currentRow++;
        });

        // --- SECTION: Summary Calculations ---
        var totalSalesToday = items.reduce(function (sum, item) { return sum + item.total; }, 0);
        var totalRefundToday = refunds.reduce(function (sum, r) { return sum + (r.quantity * r.price); }, 0);
        var totalDiscountToday = (data.discount && data.discount.totalAmount) || 0;

        var notes = data.notes || [];
        var totalBelanjaKasir = notes.reduce(function (sum, n) { return sum + (n.type === 'belanja' ? (n.amount || 0) : 0); }, 0);

        // HUTANG : Barang keluar hari ini tapi BELUM BAYAR (dikirim dari item penjualan)
        var totalHutangBaru = items.reduce(function (sum, item) { return sum + (item.isHutang ? item.total : 0); }, 0);

        // PELUNASAN HUTANG : Catatan hutang lama yang LUNAS hari ini
        var totalPelunasanHutang = notes.reduce(function (sum, n) {
            // HANYA hitung jika hutang dibuat di hari sebelumnya (n.date !== data.date)
            // Jika hari ini, sudah masuk di TOTAL penjualan
            var isPelunasanLama = (n.type === 'hutang' && n.completed && n.date !== data.date);
            return sum + (isPelunasanLama ? (n.amount || 0) : 0);
        }, 0);

        // KAS HARI INI = Total - Diskon - Belanja - HutangBaru + PelunasanHutang - Refund
        var grandTotal = totalSalesToday - totalDiscountToday - totalBelanjaKasir - totalHutangBaru + totalPelunasanHutang - totalRefundToday;

        // Row 1: TOTAL (Light Blue theme)
        sheet.getRange(currentRow, 3).setValue("TOTAL :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#90CAF9").setFontColor("#000000");
        sheet.getRange(currentRow, 4).setValue(totalSalesToday).setFontWeight("bold").setBackground("#90CAF9").setFontColor("#000000").setNumberFormat("Rp #,##0");
        currentRow++;

        // Row 2: TOTAL DISKON (Orange text)
        if (totalDiscountToday > 0) {
            sheet.getRange(currentRow, 3).setValue("TOTAL DISKON :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#E65100");
            sheet.getRange(currentRow, 4).setValue(-totalDiscountToday).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#E65100").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
            currentRow++;
        }

        // Row 3: BELANJA KASIR (Purple text)
        if (totalBelanjaKasir > 0) {
            sheet.getRange(currentRow, 3).setValue("BELANJA KASIR :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#7B1FA2");
            sheet.getRange(currentRow, 4).setValue(-totalBelanjaKasir).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#7B1FA2").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
            currentRow++;
        }

        // Row: HUTANG HARI INI - Barang keluar hari ini tapi blom duit (Red text)
        if (totalHutangBaru > 0) {
            sheet.getRange(currentRow, 3).setValue("HUTANG HARI INI :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFEBEE").setFontColor("#D32F2F");
            sheet.getRange(currentRow, 4).setValue(-totalHutangBaru).setFontWeight("bold").setBackground("#FFEBEE").setFontColor("#D32F2F").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
            currentRow++;
        }

        // Row: PELUNASAN HUTANG - Duit masuk dari hutang lama (Green text)
        if (totalPelunasanHutang > 0) {
            sheet.getRange(currentRow, 3).setValue("PELUNASAN HUTANG :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#E8F5E9").setFontColor("#2E7D32");
            sheet.getRange(currentRow, 4).setValue(totalPelunasanHutang).setFontWeight("bold").setBackground("#E8F5E9").setFontColor("#2E7D32").setNumberFormat("Rp #,##0");
            currentRow++;
        }

        // Row: TOTAL REFUND
        sheet.getRange(currentRow, 3).setValue("TOTAL REFUND :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#D32F2F");
        sheet.getRange(currentRow, 4).setValue(-totalRefundToday).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#D32F2F").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
        currentRow++;

        // Row: KAS HARI INI
        sheet.getRange(currentRow, 3).setValue("KAS HARI INI :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#1565C0").setFontColor("#FFFFFF");
        sheet.getRange(currentRow, 4).setValue(grandTotal).setFontWeight("bold").setBackground("#1565C0").setFontColor("#FFFFFF").setNumberFormat("Rp #,##0");
        currentRow++;

        // Spacer
        sheet.getRange(currentRow, 1).setValue("");
        currentRow++;
    }

    // Spacer
    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;

    // ═══════════════════════════════════════════════════════
    // SECTION: Refund Barang
    // ═══════════════════════════════════════════════════════
    if (refunds.length > 0) {
        sheet.getRange(currentRow, 1, 1, 7).merge()
            .setValue("↩️ REFUND BARANG HARI INI")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#C62828") // Red
            .setFontColor("#FFFFFF"); // White Text
        currentRow++;

        // Header - Red theme
        sheet.getRange(currentRow, 1, 1, 7)
            .setValues([["📅 Tgl Refund", "📅 Tgl Beli", "🏷️ Kode", "📦 Nama Barang", "Qty", "💵 Harga/Pcs", "💰 Total Refund"]])
            .setFontWeight("bold")
            .setBackground("#FFEBEE") // Light Pink
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#D32F2F", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        var totalRefund = 0;
        refunds.forEach(function (r) {
            // Use already-formatted date strings from frontend
            var tglRefund = r.date || "-";
            var tglBeli = r.purchaseDate || "-";
            var totalItem = (r.quantity || 1) * (r.price || 0);

            sheet.getRange(currentRow, 1, 1, 7)
                .setValues([[
                    tglRefund,
                    tglBeli,
                    r.kode || "-",
                    r.nama || r.name || "-",
                    r.quantity || 1,
                    r.price || 0,
                    -totalItem
                ]])
                .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

            // Zebra striping
            if (currentRow % 2 == 0) {
                sheet.getRange(currentRow, 1, 1, 7).setBackground("#FFEBEE");
            }

            // Format Harga & Total Columns
            sheet.getRange(currentRow, 6).setNumberFormat("Rp #,##0");
            sheet.getRange(currentRow, 7).setNumberFormat("Rp #,##0;\"-Rp \"#,##0").setFontColor("#D32F2F").setFontWeight("bold");

            totalRefund += totalItem;
            currentRow++;
        });

        // Total row
        sheet.getRange(currentRow, 1, 1, 7)
            .setValues([["📊 Total Refund: " + refunds.length + " item", "", "", "", "", "TOTAL:", -totalRefund]])
            .setFontWeight("bold")
            .setBackground("#D32F2F")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#B71C1C", SpreadsheetApp.BorderStyle.SOLID);

        sheet.getRange(currentRow, 7).setNumberFormat("Rp #,##0;\"-Rp \"#,##0");

        currentRow++;
    }

    // Spacer
    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;

    // ═══════════════════════════════════════════════════════
    // SECTION: Catatan / Pengingat (Directly after Refund)
    // ═══════════════════════════════════════════════════════
    var notes = data.notes || [];
    if (notes.length > 0) {
        sheet.getRange(currentRow, 1, 1, 7).merge()
            .setValue("📝 CATATAN")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#9C27B0") // Deep Purple
            .setFontColor("#FFFFFF") // White text
            .setHorizontalAlignment("left");
        currentRow++;

        // Header Catatan - 7 Columns
        sheet.getRange(currentRow, 1, 1, 7)
            .setValues([["📅 Tgl", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "📊 Status", "📅 Tgl Selesai"]])
            .setFontWeight("bold")
            .setBackground("#E1BEE7")
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#9C27B0", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        notes.forEach(function (n) {
            var typeColor = n.type === 'hutang' ? "#D32F2F" : (n.type === 'belanja' ? "#2E7D32" : "#7B1FA2");
            var status = n.type === 'hutang' ? (n.completed ? "LUNAS ✅" : "BELUM BAYAR 🔴") : "";

            // Logika baru: Jika tgl buat dan tgl selesai sama, tulis "Hari ini"
            var tglSelesai = n.completedAt || (n.type === 'hutang' ? "-" : "");
            if (n.type === 'hutang' && n.completed && n.date === n.completedAt) {
                tglSelesai = "Hari ini";
            }

            sheet.getRange(currentRow, 1, 1, 7)
                .setValues([[
                    n.date,
                    n.type.toUpperCase(),
                    n.customerName || "-",
                    n.content,
                    n.amount,
                    status,
                    tglSelesai
                ]])
                .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

            // Style for Type Column
            sheet.getRange(currentRow, 2).setFontColor(typeColor).setFontWeight("bold");

            // Format Amount
            if (n.amount > 0) {
                sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0");
            }

            // Style for Status Column
            if (n.type === 'hutang') {
                if (n.completed) {
                    sheet.getRange(currentRow, 6).setFontColor("#2E7D32").setFontWeight("bold"); // Green
                } else {
                    sheet.getRange(currentRow, 6).setFontColor("#D32F2F").setFontWeight("bold"); // Red
                }
            }

            currentRow++;
        });

        // Spacer
        sheet.getRange(currentRow, 1).setValue("");
        currentRow++;
    }

    // ═══════════════════════════════════════════════════════
    // SECTION: Backup Google Drive (After Catatan)
    // ═══════════════════════════════════════════════════════
    if (data.backupInfo && data.backupInfo.success) {
        sheet.getRange(currentRow, 1, 1, 7).merge()
            .setValue("💾 LINK BACKUP GOOGLE DRIVE (JSON)")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#90CAF9")
            .setFontColor("#000000")
            .setHorizontalAlignment("left");
        currentRow++;

        // Row 1: Link to Folder
        sheet.getRange(currentRow, 1, 1, 7).merge()
            .setFormula('=HYPERLINK("' + data.backupInfo.folderUrl + '"; "📁 Buka Folder Backup (Google Drive)")')
            .setFontColor("#000000")
            .setFontLine("underline")
            .setBackground("#FFFFFF")
            .setHorizontalAlignment("left");
        currentRow++;

        // Row 2: Link to File
        sheet.getRange(currentRow, 1, 1, 7).merge()
            .setFormula('=HYPERLINK("' + data.backupInfo.downloadUrl + '"; "📥 Download File: ' + data.backupInfo.fileName + '")')
            .setFontColor("#000000")
            .setFontLine("underline")
            .setBackground("#FFF9C4")
            .setHorizontalAlignment("left");
        currentRow++;

        // Spacer before divider
        currentRow++;
    }

    // Divider Line (Bottom)
    sheet.getRange(currentRow, 1)
        .setValue("═══════════════════════════════════════════════════════════════════════════════════")
        .setFontColor("#000000")
        .setFontWeight("bold");
    sheet.getRange(currentRow, 1, 1, 7).setBackground("#E0E0E0");
    currentRow++;

    // Spacer
    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;


    // ═══════════════════════════════════════════════════════
    // SECTION: Tukar Barang (from exchanges) - Same format as Recap
    // ═══════════════════════════════════════════════════════
    if (exchanges.length > 0) {
        sheet.getRange(currentRow, 1, 1, 9).merge()
            .setValue("🔄 LIST TUKAR BARANG")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#FF9800")
            .setFontColor("#FFFFFF");
        currentRow++;

        // Header tukar barang - same as Recap (9 columns)
        sheet.getRange(currentRow, 1, 1, 2).setBackground("#FFE0B2"); // Date part
        sheet.getRange(currentRow, 3, 1, 3).setBackground("#FFF9C4"); // Old part
        sheet.getRange(currentRow, 6, 1, 3).setBackground("#C8E6C9"); // New part
        sheet.getRange(currentRow, 9).setBackground("#FFE0B2"); // Selisih part

        sheet.getRange(currentRow, 1, 1, 9)
            .setValues([["📅 Tgl Tukar", "📅 Tgl Beli", "📦 Barang Lama", "Qty", "💵 Harga / Pcs", "🔄 Ditukar (Baru)", "Qty", "💵 Harga / Pcs", "💰 Selisih"]])
            .setFontWeight("bold")
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#FF9800", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        var totalExchangeSelisih = 0;
        exchanges.forEach(function (ex) {
            // Format: (SKU) NAME
            var originalSku = (ex.originalItem && ex.originalItem.sku) || "-";
            var originalName = (ex.originalItem && ex.originalItem.name) || "";
            var originalDisplay = "(" + originalSku + ") " + originalName;
            var originalQty = (ex.originalItem && ex.originalItem.quantity) || 1;

            var newSku = (ex.newItem && ex.newItem.sku) || "-";
            var newName = (ex.newItem && ex.newItem.name) || "";
            var newDisplay = "(" + newSku + ") " + newName;
            var newQty = (ex.newItem && ex.newItem.quantity) || 1;
            var selisih = ex.priceDifference || 0;
            var tglTukar = ex.date ? new Date(ex.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";

            // Determine tglBeli - show "Di hari yg sama" if same as tglTukar
            var tglBeli = "-";
            if (ex.originalPurchaseDate) {
                var purchaseDateStr = new Date(ex.originalPurchaseDate).toISOString().split('T')[0];
                var exchangeDateStr = ex.date ? new Date(ex.date).toISOString().split('T')[0] : "";
                if (purchaseDateStr === exchangeDateStr) {
                    tglBeli = "Di hari yg sama";
                } else {
                    tglBeli = new Date(ex.originalPurchaseDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
                }
            }

            // Get prices - use hargaLama/hargaBaru if available, otherwise from item.price
            var hargaLama = ex.hargaLama || (ex.originalItem && ex.originalItem.price) || 0;
            var hargaBaru = ex.hargaBaru || (ex.newItem && ex.newItem.price) || 0;

            sheet.getRange(currentRow, 1, 1, 9)
                .setValues([[tglTukar, tglBeli, originalDisplay, originalQty, hargaLama, newDisplay, newQty, hargaBaru, selisih]])
                .setBorder(true, true, true, true, true, true, "#FFCC80", SpreadsheetApp.BorderStyle.SOLID);

            // Side-by-side coloring
            sheet.getRange(currentRow, 3, 1, 3).setBackground("#FFFDE7"); // Old Part - Light Yellow
            sheet.getRange(currentRow, 6, 1, 3).setBackground("#F1F8E9"); // New Part - Light Green

            // Format Harga Columns
            sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0");
            sheet.getRange(currentRow, 8).setNumberFormat("Rp #,##0");

            // Format selisih color and number format (Col 9)
            var selisihCell = sheet.getRange(currentRow, 9);
            selisihCell.setHorizontalAlignment("right")
                .setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");

            if (selisih > 0) {
                selisihCell.setFontColor("#2E7D32").setFontWeight("bold");
            } else if (selisih < 0) {
                selisihCell.setFontColor("#D32F2F").setFontWeight("bold");
            }

            totalExchangeSelisih += selisih;
            currentRow++;
        });

        // Total row
        sheet.getRange(currentRow, 1, 1, 9)
            .setValues([["📊 Total Transaksi Tukar: " + exchanges.length, "", "", "", "", "", "", "TOTAL SELISIH:", totalExchangeSelisih]])
            .setFontWeight("bold")
            .setBackground("#FF9800")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#E65100", SpreadsheetApp.BorderStyle.SOLID);

        var totalCell = sheet.getRange(currentRow, 9);
        totalCell.setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");

        currentRow++;
    }

    // Footer - no separator needed
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

// Update product
function updateProduct(product) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName("Produk");

        if (!sheet) {
            sheet = ss.insertSheet("Produk");
            sheet.appendRow(["KODE", "Nama", "Kategori", "Harga Jual", "Harga Beli", "Stok"]);
        }

        var data = sheet.getDataRange().getValues();
        var found = false;

        for (var i = 1; i < data.length; i++) {
            if (data[i][0] === product.kode) {
                sheet.getRange(i + 1, 1, 1, 6).setValues([[
                    product.kode,
                    product.nama,
                    product.kategori,
                    product.hargaJual,
                    product.hargaBeli,
                    product.stok
                ]]);
                found = true;
                break;
            }
        }

        if (!found) {
            sheet.appendRow([
                product.kode,
                product.nama,
                product.kategori,
                product.hargaJual,
                product.hargaBeli,
                product.stok
            ]);
        }

        return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}
