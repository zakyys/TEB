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
    var isNewSheet = false;
    if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        isNewSheet = true;
    }

    sheet.clear(); // Clear old data to refresh

    // Move Recap sheet to correct position (after Harian sheet, or at the end)
    if (isNewSheet) {
        try {
            var allSheets = ss.getSheets();
            var harianSheetName = "Harian " + month;
            var harianSheet = ss.getSheetByName(harianSheetName);
            
            if (harianSheet) {
                // Move Recap to be right after Harian (Harian at rightmost, Recap before it)
                var harianIndex = harianSheet.getIndex(); // 1-based
                ss.moveActiveSheet(harianIndex); // Move Recap to same position as Harian
                // This pushes Harian to the right
            } else {
                // No Harian sheet yet, move Recap to rightmost
                ss.moveActiveSheet(allSheets.length);
            }
        } catch (moveError) {
            Logger.log("Move sheet error: " + moveError.toString());
        }
    }

    var timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // ═══════════════════════════════════════════════════════
    // SECTION 1: BARANG TERLARIS (Columns A-E) - Added Transaksi column
    // ═══════════════════════════════════════════════════════

    // Header Title
    sheet.getRange("A1:E1").merge()
        .setValue("🏆 BARANG TERLARIS - " + month)
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#FFA000") // Amber 700
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update)
    sheet.getRange("A2:E2").merge()
        .setValue("Terakhir Update: " + timestamp)
        .setFontStyle("italic")
        .setFontColor("#666666")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("A3:E3")
        .setValues([["Rank", "Kode Barang", "Nama Barang", "Terjual (Pcs)", "Transaksi"]])
        .setFontWeight("bold")
        .setBackground("#FFECB3") // Amber 100
        .setBorder(true, true, true, true, true, true, "#FF6F00", SpreadsheetApp.BorderStyle.SOLID);

    var items = data.items || [];
    // (No restriction, show all items)

    if (items.length > 0) {
        var rows = items.map(function (item, index) {
            var rankDisplay = item.rank;
            var namaBarang = item.nama;

            // Icons for Top 3
            if (item.rank == 1) rankDisplay = "🥇 " + item.rank;
            else if (item.rank == 2) rankDisplay = "🥈 " + item.rank;
            else if (item.rank == 3) rankDisplay = "🥉 " + item.rank;

            // Rank 26 onwards: Hide Product Name (Empty)
            if (index >= 25) {
                namaBarang = "";
            }

            return [
                rankDisplay,
                item.kode,
                namaBarang,
                item.quantity,
                item.transactionCount || 0
            ];
        });

        // Write all rows (5 columns now)
        sheet.getRange(4, 1, rows.length, 5).setValues(rows);

        // Base Formatting (Borders & Qty & Transaksi)
        sheet.getRange(4, 1, rows.length, 5).setBorder(true, true, true, true, true, true, "#FFD54F", SpreadsheetApp.BorderStyle.SOLID);
        sheet.getRange(4, 4, rows.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("center"); // Qty
        sheet.getRange(4, 5, rows.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("center"); // Transaksi

        // Special Formatting for TOP 25 (Blue & Bold)
        var top25Count = Math.min(items.length, 25);
        if (top25Count > 0) {
            sheet.getRange(4, 1, top25Count, 5)
                .setFontColor("#1565C0") // Blue
                .setFontWeight("bold");

            // Highlight Background for Top 3
            sheet.getRange(4, 1, Math.min(items.length, 3), 5).setBackground("#E3F2FD"); // Light Blue
        }

        // Formatting for Rank 26+ (Normal Black)
        if (items.length > 25) {
            var remainingCount = items.length - 25;
            sheet.getRange(4 + 25, 1, remainingCount, 5)
                .setFontColor("#000000")
                .setFontWeight("normal");
        }
    }

    // Divider Column F (Spacer) - shifted from E
    sheet.setColumnWidth(6, 20); // Narrow column

    // ═══════════════════════════════════════════════════════
    // SECTION 2: DATA PENGUNJUNG (Columns G-K) -> Shifted from F-J
    // ═══════════════════════════════════════════════════════

    // Header Title
    sheet.getRange("G1:K1").merge()
        .setValue("👥 DATA PENGUNJUNG")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#2E7D32") // Green 800
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update)
    sheet.getRange("G2:K2").merge()
        .setValue("Terakhir Update: " + timestamp)
        .setFontStyle("italic")
        .setFontColor("#666666")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("G3:K3")
        .setValues([["📅 Tanggal", "☀️ < 12:00", "🌙 > 12:00", "Σ Total", "❌ Lost"]])
        .setFontWeight("bold")
        .setBackground("#C8E6C9") // Green 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#2E7D32", SpreadsheetApp.BorderStyle.SOLID);

    // Set '❌ Lost' header text red specifically
    sheet.getRange("K3").setFontColor("#D32F2F");

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

            sheet.getRange(visitorRow, 7, 1, 5) // Column 7 = G
                .setValues([[day.date, day.before12, day.after12, (day.before12 + day.after12), day.lost]])
                .setBorder(true, true, true, true, true, true, "#A5D6A7", SpreadsheetApp.BorderStyle.SOLID);

            // Force Number Format for Visitor Counts (prevent Date auto-format)
            sheet.getRange(visitorRow, 8, 1, 4).setNumberFormat("0"); // Columns H-K (G+1 to G+4)

            // Highlight lost > 0
            if (day.lost > 0) {
                sheet.getRange(visitorRow, 11).setFontColor("red").setFontWeight("bold"); // Column 11 = K
            }

            // Center align numbers
            sheet.getRange(visitorRow, 8, 1, 4).setHorizontalAlignment("center");

            visitorRow++;
        });

        // TOTAL ROW Visitors
        sheet.getRange(visitorRow, 7, 1, 5)
            .setValues([["📊 TOTAL BULAN:", totalBefore12, totalAfter12, totalBefore12 + totalAfter12, totalLost]])
            .setFontWeight("bold")
            .setBackground("#66BB6A")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#1B5E20", SpreadsheetApp.BorderStyle.SOLID);

        // Force Number Format for Total Row as well
        sheet.getRange(visitorRow, 8, 1, 4).setNumberFormat("0").setHorizontalAlignment("center");
    }

    // Divider Column L (Spacer) - shifted from K
    sheet.setColumnWidth(12, 20);

    // ═══════════════════════════════════════════════════════
    // SECTION 3: LIST KETERANGAN LOST (Columns M-N) -> Shifted from L-M
    // ═══════════════════════════════════════════════════════

    // Header Title
    sheet.getRange("M1:N1").merge()
        .setValue("❌ LIST BARANG LOST")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#D32F2F") // Red 700
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update)
    sheet.getRange("M2:N2").merge()
        .setValue("Terakhir Update: " + timestamp)
        .setFontStyle("italic")
        .setFontColor("#666666")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("M3:N3")
        .setValues([["📅 Tanggal", "📝 Keterangan Barang"]])
        .setFontWeight("bold")
        .setBackground("#FFCDD2") // Red 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#D32F2F", SpreadsheetApp.BorderStyle.SOLID);

    var allLostList = data.allLostList || [];
    if (allLostList.length > 0) {
        var lostRow = 4;
        allLostList.forEach(function (entry) {
            sheet.getRange(lostRow, 13, 1, 2) // Column 13 = M
                .setValues([[entry.date, "• " + entry.description]])
                .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

            // Zebra striping for readability
            if (lostRow % 2 == 0) {
                sheet.getRange(lostRow, 13, 1, 2).setBackground("#FEEBEE");
            }

            lostRow++;
        });

    } else {
        sheet.getRange(4, 13, 1, 2).merge() // Column 13 = M
            .setValue("✅ Tidak ada barang lost bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
    }

    // Divider Column O (Spacer) - shifted from N
    sheet.setColumnWidth(15, 20);

    // ═══════════════════════════════════════════════════════
    // SECTION 4: LIST TUKAR BARANG (Columns P-X) -> Shifted from O-W
    // ═══════════════════════════════════════════════════════

    // Header Title
    sheet.getRange("P1:X1").merge()
        .setValue("🔄 LIST TUKAR BARANG")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#EF6C00") // Orange 800
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");

    // Sub-header (Last Update)
    sheet.getRange("P2:X2").merge()
        .setValue("Terakhir Update: " + timestamp)
        .setFontStyle("italic")
        .setFontColor("#666666")
        .setHorizontalAlignment("center");

    // Table Headers
    sheet.getRange("P3:Q3").setBackground("#FFE0B2"); // Date part
    sheet.getRange("R3:T3").setBackground("#FFF9C4"); // Old Item part
    sheet.getRange("U3:W3").setBackground("#C8E6C9"); // New Item part
    sheet.getRange("X3").setBackground("#FFE0B2");    // Selisih part

    sheet.getRange("P3:X3")
        .setValues([["📅 Tgl Tukar", "📅 Tgl Beli", "📦 Barang Lama", "Qty", "💵 Harga / Pcs", "🔄 Ditukar (Baru)", "Qty", "💵 Harga / Pcs", "💰 Selisih"]])
        .setFontWeight("bold")
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#EF6C00", SpreadsheetApp.BorderStyle.SOLID);

    var monthlyExchanges = data.monthlyExchanges || [];
    var exchangeRow = 4;

    if (monthlyExchanges.length > 0) {
        monthlyExchanges.forEach(function (item) {
            var selisih = item.selisih;

            sheet.getRange(exchangeRow, 16, 1, 9) // Column 16 = P, total 9 cols to X
                .setValues([[
                    item.date,
                    item.tglBeli,
                    item.barangLama,
                    item.qtyLama,
                    item.hargaLama || 0,
                    item.barangBaru,
                    item.qtyBaru,
                    item.hargaBaru || 0,
                    selisih
                ]])
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#FFCC80", SpreadsheetApp.BorderStyle.SOLID);

            // Side-by-side coloring
            sheet.getRange(exchangeRow, 18, 1, 3).setBackground("#FFFDE7"); // Old Part (R-T) - Light Yellow
            sheet.getRange(exchangeRow, 21, 1, 3).setBackground("#F1F8E9"); // New Part (U-W) - Light Green

            // Format Harga & Selisih
            sheet.getRange(exchangeRow, 20).setNumberFormat("Rp #,##0"); // Col T
            sheet.getRange(exchangeRow, 23).setNumberFormat("Rp #,##0"); // Col W

            var selisihCell = sheet.getRange(exchangeRow, 24); // Col X
            if (selisih > 0) {
                selisihCell.setNumberFormat("Rp +#,##0").setFontColor("#2E7D32").setFontWeight("bold");
            } else if (selisih < 0) {
                selisihCell.setNumberFormat("Rp #,##0").setFontColor("#D32F2F").setFontWeight("bold");
            } else {
                selisihCell.setNumberFormat("Rp #,##0").setFontColor("#000000");
            }

            // Zebra striping
            if (exchangeRow % 2 == 0) {
                sheet.getRange(exchangeRow, 16, 1, 3).setBackground("#FFF3E0"); // A bit warmer for dates
            }

            exchangeRow++;
        });

        // Total Row count
        sheet.getRange(exchangeRow, 16, 1, 9).merge()
            .setValue("📊 Total Transaksi Tukar: " + monthlyExchanges.length)
            .setFontWeight("bold")
            .setBackground("#EF6C00")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#E65100", SpreadsheetApp.BorderStyle.SOLID);
        exchangeRow++;

    } else {
        sheet.getRange(4, 16, 1, 9).merge()
            .setValue("✅ Tidak ada transaksi tukar barang bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
        exchangeRow = 5;
    }

    // Divider Column Y (Spacer) - shifted from X
    sheet.setColumnWidth(25, 20);

    // ═══════════════════════════════════════════════════════
    // SECTION 5: CATATAN - REKAP BULANAN (Columns Z-AF) -> Shifted from Y-AE
    // ═══════════════════════════════════════════════════════
    var notesRow = 1;

    // Header Title
    sheet.getRange(notesRow, 26, 1, 7).merge() // Z:AF (column 26-32)
        .setValue("📝 CATATAN - REKAP BULANAN")
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#7B1FA2") // Purple 700
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");
    notesRow++;

    // Sub-header (Last Update)
    sheet.getRange(notesRow, 26, 1, 7).merge()
        .setValue("Terakhir Update: " + timestamp)
        .setFontStyle("italic")
        .setFontColor("#666666")
        .setHorizontalAlignment("center");
    notesRow++;

    // Table Headers
    sheet.getRange(notesRow, 26, 1, 7)
        .setValues([["📅 Tgl Buat", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "Status", "📅 Tgl Selesai"]])
        .setFontWeight("bold")
        .setBackground("#E1BEE7") // Purple 100
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#7B1FA2", SpreadsheetApp.BorderStyle.SOLID);
    notesRow++;

    var monthlyNotes = data.monthlyNotes || [];
    if (monthlyNotes.length > 0) {
        monthlyNotes.forEach(function (note) {
            var statusText = note.completed ? "SELESAI ✅" : "PENDING ⏳";
            var rowColor = note.completed ? "#F5F5F5" : "#FFFFFF";

            sheet.getRange(notesRow, 26, 1, 7)
                .setValues([[
                    note.date,
                    note.type.toUpperCase(),
                    note.customerName,
                    note.content,
                    note.amount,
                    statusText,
                    note.completedAt || "-"
                ]])
                .setBackground(rowColor)
                .setVerticalAlignment("middle")
                .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

            // Format Amount
            if (note.amount > 0) {
                sheet.getRange(notesRow, 30).setNumberFormat("Rp #,##0"); // Column 30 = AD
            }

            // Color for type
            var typeCell = sheet.getRange(notesRow, 27); // Column 27 = AA
            if (note.type === 'hutang') typeCell.setFontColor("#D32F2F").setFontWeight("bold");
            else if (note.type === 'belanja') typeCell.setFontColor("#2E7D32").setFontWeight("bold");

            // Color for status
            var statusCell = sheet.getRange(notesRow, 31); // Column 31 = AE
            if (note.completed) statusCell.setFontColor("#2E7D32").setFontWeight("bold");
            else statusCell.setFontColor("#F57C00").setFontWeight("bold");

            notesRow++;
        });
    } else {
        sheet.getRange(notesRow, 26, 1, 7).merge()
            .setValue("✅ Tidak ada catatan aktif bulan ini!")
            .setFontStyle("italic")
            .setHorizontalAlignment("center")
            .setFontColor("#43A047");
    }

    // Auto-resize columns for perfect fit
    try {
        sheet.autoResizeColumns(1, 5); // A-E (Barang Terlaris - now 5 columns)
        sheet.autoResizeColumns(7, 5); // G-K (Data Pengunjung)
        sheet.setColumnWidth(13, 100); // Date Lost (M)
        sheet.setColumnWidth(14, 300); // Description Lost (N)
        sheet.autoResizeColumns(16, 9); // P-X (Tukar Barang)
        sheet.autoResizeColumns(26, 7); // Z-AF (Catatan)
    } catch (e) { }

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
    var isNewSheet = false;
    if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        isNewSheet = true;
        
        // Move Harian sheet to rightmost position
        try {
            var allSheets = ss.getSheets();
            ss.setActiveSheet(sheet);
            ss.moveActiveSheet(allSheets.length);
        } catch (moveError) {
            Logger.log("Move Harian sheet error: " + moveError.toString());
        }
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
    // SECTION: Header Tanggal (1 baris saja)
    // ═══════════════════════════════════════════════════════
    sheet.getRange(currentRow, 1, 1, 8).merge()
        .setValue("📅 " + today)
        .setFontWeight("bold")
        .setFontSize(14)
        .setBackground("#4285F4")
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");
    currentRow++;

    // Info terakhir update
    var timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    sheet.getRange(currentRow, 1, 1, 8).merge()
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
        .setBackground("#C8E6C9")
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);

    // Set ❌ Lost header - red background and text like discount rows
    sheet.getRange(currentRow, 4)
        .setFontColor("#D32F2F")
        .setFontWeight("bold")
        .setBackground("#FFEBEE");

    currentRow++;

    // Data tamu
    sheet.getRange(currentRow, 1, 1, 4)
        .setValues([[visitors.before12, visitors.after12, visitors.total, visitors.lost]])
        .setNumberFormat("0") // Fix: Prevent Date auto-format (e.g. 1 -> 1 Jan 1900)
        .setHorizontalAlignment("center")
        .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);
    
    // Style Lost data cell - red if > 0
    if (visitors.lost > 0) {
        sheet.getRange(currentRow, 4)
            .setFontColor("#D32F2F")
            .setFontWeight("bold")
            .setBackground("#FFEBEE");
    } else {
        sheet.getRange(currentRow, 4)
            .setBackground("#FFEBEE");
    }
    currentRow++;

    // Daftar Lost (alasan)
    var lostList = visitors.lostList || [];
    if (lostList.length > 0) {
        sheet.getRange(currentRow, 1, 1, 4).merge()
            .setValue("❌ DAFTAR LOST:")
            .setFontWeight("bold")
            .setFontColor("#D32F2F")
            .setBackground("#FFEBEE");
        currentRow++;

        lostList.forEach(function (desc, idx) {
            sheet.getRange(currentRow, 1, 1, 4).merge()
                .setValue("  " + (idx + 1) + ". " + desc)
                .setFontColor("#C62828")
                .setBackground("#FFEBEE");
            currentRow++;
        });
    }

    // No spacer here to save space

    // ═══════════════════════════════════════════════════════
    // SECTION: Penjualan
    // ═══════════════════════════════════════════════════════
    if (items.length > 0) {
        sheet.getRange(currentRow, 1, 1, 4).merge()
            .setValue("📦 PENJUALAN HARI INI")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#E3F2FD")
            .setFontColor("#1565C0");
        currentRow++;

        // Header penjualan
        sheet.getRange(currentRow, 1, 1, 4)
            .setValues([["KODE", "Qty", "Harga", "Total"]])
            .setFontWeight("bold")
            .setBackground("#BBDEFB")
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#2196F3", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        var totalSales = 0;
        items.forEach(function (item) {
            sheet.getRange(currentRow, 1, 1, 4)
                .setValues([[item.kode || "-", item.quantity, item.price, item.total]])
                .setBorder(true, true, true, true, true, true, "#90CAF9", SpreadsheetApp.BorderStyle.SOLID);

            // Fix: Prevent "1 Jan 1900" by forcing Number format
            sheet.getRange(currentRow, 2).setNumberFormat("0");       // Qty - angka biasa
            sheet.getRange(currentRow, 3).setNumberFormat("0");       // Harga - angka biasa TANPA pemisah ribuan (10000)
            sheet.getRange(currentRow, 4).setNumberFormat("#,##0");   // Total - DENGAN pemisah ribuan (10.000)

            sheet.getRange(currentRow, 2, 1, 3).setHorizontalAlignment("right");
            totalSales += item.total;
            currentRow++;
        });

        // Check if there's discount
        var discount = data.discount || {};
        var hasDiscount = discount.hasDiscount || false;
        var discountAmount = discount.totalAmount || 0;

        if (hasDiscount && discountAmount > 0) {
            // SUBTOTAL row (before discount)
            sheet.getRange(currentRow, 1, 1, 4)
                .setValues([["", "", "SUBTOTAL:", totalSales]])
                .setFontWeight("bold")
                .setBackground("#BBDEFB")
                .setFontColor("#1565C0")
                .setBorder(true, true, true, true, true, true, "#2196F3", SpreadsheetApp.BorderStyle.SOLID);
            sheet.getRange(currentRow, 4).setNumberFormat("#,##0");
            sheet.getRange(currentRow, 3, 1, 2).setHorizontalAlignment("right");
            currentRow++;

            // DISCOUNT row - show each discount transaction
            var discountDetails = discount.details || [];
            discountDetails.forEach(function(d, idx) {
                var discountLabel = "Diskon " + String.fromCharCode(65 + idx); // A, B, C, ...
                if (d.percent > 0) {
                    discountLabel += " (" + d.percent + "%)";
                }
                sheet.getRange(currentRow, 1, 1, 4)
                    .setValues([["", "", discountLabel + ":", -d.amount]])
                    .setFontWeight("bold")
                    .setBackground("#FFEBEE")
                    .setFontColor("#D32F2F")
                    .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);
                sheet.getRange(currentRow, 4).setNumberFormat("-#,##0");
                sheet.getRange(currentRow, 3, 1, 2).setHorizontalAlignment("right");
                currentRow++;
            });

            // GRAND TOTAL row (after discount)
            var grandTotal = totalSales - discountAmount;
            sheet.getRange(currentRow, 1, 1, 4)
                .setValues([["", "", "GRAND TOTAL:", grandTotal]])
                .setFontWeight("bold")
                .setFontSize(11)
                .setBackground("#1976D2")
                .setFontColor("#FFFFFF")
                .setBorder(true, true, true, true, true, true, "#1565C0", SpreadsheetApp.BorderStyle.SOLID);
            sheet.getRange(currentRow, 4).setNumberFormat("#,##0");
            sheet.getRange(currentRow, 3, 1, 2).setHorizontalAlignment("right");
            currentRow++;
        } else {
            // No discount - show regular TOTAL row
            sheet.getRange(currentRow, 1, 1, 4)
                .setValues([["", "", "TOTAL:", totalSales]])
                .setFontWeight("bold")
                .setBackground("#1976D2")
                .setFontColor("#FFFFFF")
                .setBorder(true, true, true, true, true, true, "#1565C0", SpreadsheetApp.BorderStyle.SOLID);
            sheet.getRange(currentRow, 4).setNumberFormat("#,##0");  // Total dengan pemisah ribuan (10.000)
            sheet.getRange(currentRow, 3, 1, 2).setHorizontalAlignment("right");
            currentRow++;
        }
    }

    // ═══════════════════════════════════════════════════════
    // SECTION: Barang Ditukar/Refund
    // ═══════════════════════════════════════════════════════
    if (refunds.length > 0) {
        sheet.getRange(currentRow, 1, 1, 9).merge()
            .setValue("🔄 BARANG DITUKAR/REFUND HARI INI")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#FFF3E0")
            .setFontColor("#E65100");
        currentRow++;

        // Header - same format as LIST TUKAR BARANG
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

        var totalSelisih = 0;
        refunds.forEach(function (r) {
            // Format dates
            var tglTukar = "-";
            var tglBeli = r.purchaseDate || "-";

            sheet.getRange(currentRow, 1, 1, 9)
                .setValues([[
                    tglTukar,
                    tglBeli,
                    r.kode || "-",
                    r.quantity || 1,
                    r.price || 0,
                    r.jenis === "TUKAR" ? (r.kode || "-") : "-",
                    r.qtyBaru || 0,
                    r.jenis === "TUKAR" ? (r.price || 0) : 0,
                    r.selisih || 0
                ]])
                .setBorder(true, true, true, true, true, true, "#FFCC80", SpreadsheetApp.BorderStyle.SOLID);

            // Side-by-side coloring
            sheet.getRange(currentRow, 3, 1, 3).setBackground("#FFFDE7"); // Old Part - Light Yellow
            sheet.getRange(currentRow, 6, 1, 3).setBackground("#F1F8E9"); // New Part - Light Green

            // Format Harga Columns
            sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0");
            sheet.getRange(currentRow, 8).setNumberFormat("Rp #,##0");

            // Format Selisih Column (Col 9)
            var selisihCell = sheet.getRange(currentRow, 9);
            selisihCell.setHorizontalAlignment("right")
                .setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");

            if (r.selisih > 0) {
                selisihCell.setFontColor("#2E7D32").setFontWeight("bold");
            } else if (r.selisih < 0) {
                selisihCell.setFontColor("#D32F2F").setFontWeight("bold");
            }

            totalSelisih += (r.selisih || 0);
            currentRow++;
        });

        // Total row
        sheet.getRange(currentRow, 1, 1, 9)
            .setValues([["📊 Total Transaksi: " + refunds.length, "", "", "", "", "", "", "TOTAL SELISIH:", totalSelisih]])
            .setFontWeight("bold")
            .setBackground("#FF9800")
            .setFontColor("#FFFFFF")
            .setBorder(true, true, true, true, true, true, "#E65100", SpreadsheetApp.BorderStyle.SOLID);

        var totalSelisihCell = sheet.getRange(currentRow, 9);
        totalSelisihCell.setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");

        currentRow++;
    }

    // Spacer before next section if anything was written
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

    // ═══════════════════════════════════════════════════════
    // SECTION: Hutang / Piutang (Piutang Dagang)
    // ═══════════════════════════════════════════════════════
    var hutangList = data.hutang || [];
    if (hutangList.length > 0) {
        sheet.getRange(currentRow, 1, 1, 8).merge()
            .setValue("💳 DAFTAR HUTANG (PIUTANG)")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#FFEBEE")
            .setFontColor("#C62828");
        currentRow++;

        // Header Hutang
        sheet.getRange(currentRow, 1, 1, 8)
            .setValues([["📅 Tgl", "👤 Nama Pelanggan", "📝 Detail Barang/Keterangan", "💰 Jumlah", "✅", "Status", "📅 Tgl Lunas", ""]])
            .setFontWeight("bold")
            .setBackground("#FFCDD2")
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#E53935", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        var totalHutang = 0;
        hutangList.forEach(function (h) {
            var statusIcon = h.completed ? "✅" : "⏳";
            var statusText = h.completed ? "LUNAS" : "BELUM LUNAS";
            
            sheet.getRange(currentRow, 1, 1, 8)
                .setValues([[
                    h.date,
                    h.customerName || "-",
                    h.content,
                    h.amount,
                    statusIcon,
                    statusText,
                    h.completedAt || "-",
                    ""
                ]])
                .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

            // Style untuk Nama & Amount
            sheet.getRange(currentRow, 2).setFontWeight("bold");
            sheet.getRange(currentRow, 4).setNumberFormat("Rp #,##0").setFontColor("#C62828").setFontWeight("bold");

            // Style untuk Status
            var statCell = sheet.getRange(currentRow, 6);
            statCell.setFontWeight("bold").setFontColor(h.completed ? "#2E7D32" : "#D32F2F").setHorizontalAlignment("center");
            
            if (!h.completed) totalHutang += (h.amount || 0);
            currentRow++;
        });

        // Summary Hutang Aktif
        sheet.getRange(currentRow, 1, 1, 8)
            .setValues([["📊 Total Hutang Belum Lunas:", "", "", totalHutang, "", "", "", ""]])
            .setFontWeight("bold")
            .setBackground("#FFEBEE")
            .setBorder(true, true, true, true, true, true, "#E53935", SpreadsheetApp.BorderStyle.SOLID);
        sheet.getRange(currentRow, 4).setNumberFormat("Rp #,##0");
        currentRow += 2;
    }

    // ═══════════════════════════════════════════════════════
    // SECTION: Catatan / Pengingat
    // ═══════════════════════════════════════════════════════
    var notes = data.notes || [];
    if (notes.length > 0) {
        sheet.getRange(currentRow, 1, 1, 8).merge()
            .setValue("📝 CATATAN")
            .setFontWeight("bold")
            .setFontSize(11)
            .setBackground("#F3E5F5")
            .setFontColor("#7B1FA2");
        currentRow++;

        // Header Catatan
        sheet.getRange(currentRow, 1, 1, 8)
            .setValues([["📅 Tgl", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "✅", "Status", ""]])
            .setFontWeight("bold")
            .setBackground("#E1BEE7")
            .setHorizontalAlignment("center")
            .setBorder(true, true, true, true, true, true, "#9C27B0", SpreadsheetApp.BorderStyle.SOLID);
        currentRow++;

        notes.forEach(function (n) {
            var statusIcon = n.completed ? "✅" : "⏳";
            var statusText = n.completed ? "SELESAI" : "PENDING";
            var typeColor = n.type === 'hutang' ? "#D32F2F" : (n.type === 'belanja' ? "#2E7D32" : "#7B1FA2");

            sheet.getRange(currentRow, 1, 1, 8)
                .setValues([[
                    n.date,
                    n.type.toUpperCase(),
                    n.customerName || "-",
                    n.content,
                    n.amount,
                    statusIcon,
                    statusText,
                    ""
                ]])
                .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

            // Style untuk Kolom Jenis
            sheet.getRange(currentRow, 2).setFontColor(typeColor).setFontWeight("bold");

            // Format Amount
            if (n.amount > 0) {
                sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0");
            }

            // Style untuk Status
            var statCell = sheet.getRange(currentRow, 7);
            statCell.setFontWeight("bold").setFontColor(n.completed ? "#2E7D32" : "#F57C00").setHorizontalAlignment("center");

            currentRow++;
        });

        // Spacer (Condensed)
        sheet.getRange(currentRow, 1).setValue("");
        currentRow++;
    }

    // ═══════════════════════════════════════════════════════
    // SECTION: Full Backup to Google Drive
    // ═══════════════════════════════════════════════════════
    var backupResult = null;
    if (data.fullBackup) {
        backupResult = saveBackupToDrive(data.fullBackup);
        
        if (backupResult && backupResult.success) {
            // Add backup link section to sheet
            sheet.getRange(currentRow, 1, 1, 8).merge()
                .setValue("📁 FULL BACKUP")
                .setFontWeight("bold")
                .setFontSize(11)
                .setBackground("#E3F2FD")
                .setFontColor("#1565C0");
            currentRow++;
            
            sheet.getRange(currentRow, 1, 1, 8).merge()
                .setValue("📄 " + backupResult.fileName)
                .setFontColor("#424242");
            currentRow++;
            
            // Folder Link - Label in A, URL in B
            sheet.getRange(currentRow, 1).setValue("📂 LIHAT FOLDER:")
                .setFontWeight("bold")
                .setFontColor("#1976D2");
            sheet.getRange(currentRow, 2, 1, 7).merge()
                .setValue(backupResult.folderUrl)
                .setFontColor("#1976D2");
            currentRow++;
            
            // Download Link - Label in A, URL in B
            sheet.getRange(currentRow, 1).setValue("⬇️ DOWNLOAD:")
                .setFontWeight("bold")
                .setFontColor("#2E7D32");
            sheet.getRange(currentRow, 2, 1, 7).merge()
                .setValue(backupResult.downloadUrl)
                .setFontColor("#2E7D32");
            currentRow++;
            
            // Spacer
            sheet.getRange(currentRow, 1).setValue("");
            currentRow++;
        }
    }

    // Footer
    sheet.getRange(currentRow, 1, 1, 8).merge()
        .setValue("═══════════════════════════════════════════════════════════════════════════════")
        .setBackground("#E0E0E0")
        .setFontColor("#666666");

    // Return response with backup info
    var response = { success: true };
    if (backupResult) {
        response.backup = backupResult;
    }
    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
