/**
 * GOLDENPOS - GAS LAPORAN & TRANSAKSI
 *
 * Gunakan file ini pada deployment URL GAS Laporan & Transaksi.
 * Fitur:
 * - Laporan penjualan harian
 * - Rekap bulanan dan penjualan per kategori
 * - Data tamu, catatan, hutang, refund, dan tukar barang
 * - Notifikasi Telegram dan backup ke Google Drive
 *
 * Jangan digabung dengan gas-product-database.gs.
 */

function doGet(e) {
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

    if (action === "updateProduct") {
      return updateProduct(data.product);
    }

    if (action === "updateProductActive") {
      return updateProduct(data.product);
    }

    if (action === "resetSheets") {
      return resetSheets(data);
    }

    if (action === "monthlyRecap") {
      return saveMonthlyRecap(data);
    }

    if (data.fullBackup) {
      data.backupInfo = saveBackupToDrive(data.fullBackup);
    }

    var result = saveSalesData(data);

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

  if (!BOT_TOKEN || !CHAT_ID) return;

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

    if (visitors.lostList && visitors.lostList.length > 0) {
      message += "📝 *KET. LOST:*\n";
      visitors.lostList.forEach(function (desc) {
        message += "• " + desc + "\n";
      });
      message += "\n";
    }

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
    Logger.log("Telegram Error: " + e.toString());
  }
}

// Fitur: Simpan Full Backup ke Google Drive
function saveBackupToDrive(backupData) {
  try {
    var FOLDER_NAME = "Backup POS - BBM";

    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(FOLDER_NAME);
      Logger.log("Created folder: " + FOLDER_NAME);
    }

    var now = new Date();
    var day = String(now.getDate()).padStart(2, '0');
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var year = now.getFullYear();
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');

    var fileName = "backupfull_" + day + "-" + month + "-" + year + "_Jam_" + hours + "_" + minutes + ".json";

    var jsonContent = JSON.stringify(backupData, null, 2);
    var blob = Utilities.newBlob(jsonContent, "application/json", fileName);

    var file = folder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var folderId = folder.getId();
    var folderUrl = "https://drive.google.com/drive/folders/" + folderId + "?usp=sharing";
    var downloadUrl = "https://drive.google.com/uc?id=" + fileId + "&export=download";

    Logger.log("Backup saved: " + fileName);

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

  var dailySheetName = "Harian " + month;
  var dailySheet = ss.getSheetByName(dailySheetName);
  if (dailySheet) {
    dailySheet.clear();
  }

  var recapSheetName = "Recap " + month;
  var recapSheet = ss.getSheetByName(recapSheetName);
  if (recapSheet) {
    recapSheet.clear();
  } else {
    recapSheet = ss.insertSheet(recapSheetName);
  }

  saveMonthlyRecap({
    month: month,
    items: [],
    categorySales: [],
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

// Save Monthly Recap to separate sheet
function saveMonthlyRecap(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var month = data.month || "Unknown";
  var sheetName = "Recap " + month;

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
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

  var maxRows = sheet.getMaxRows();
  if (maxRows < 1000) {
    sheet.insertRowsAfter(maxRows, 1000 - maxRows);
  }

  sheet.clear();

  var timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  var now = new Date();
  var timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');

  // ═══════════════════════════════════════════════════════
  // SECTION 0: PENJUALAN PER KATEGORI (Columns A-B, Rows 1-8)
  // ═══════════════════════════════════════════════════════
  sheet.getRange("A1:D1").merge()
    .setValue("💰 PENJUALAN PER KATEGORI - " + month)
    .setFontWeight("bold").setFontSize(13)
    .setBackground("#F57F17").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.getRange("A2:D2").merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#FFF8E1").setFontColor("#F57F17")
    .setHorizontalAlignment("center");

  var categorySales = data.categorySales || [];
  var catRow = 3;
  if (categorySales.length > 0) {
    categorySales.forEach(function (cat) {
      sheet.getRange(catRow, 1).setValue(cat.category)
        .setFontWeight("bold").setFontSize(11).setFontColor("#E65100")
        .setHorizontalAlignment("center");
      sheet.getRange(catRow, 2).setValue(cat.total)
        .setFontWeight("bold").setFontSize(11).setFontColor("#1B5E20")
        .setNumberFormat("\"Rp\"#,##0");
      sheet.getRange(catRow, 1, 1, 2)
        .setBorder(true, true, true, true, true, true, "#FFD54F", SpreadsheetApp.BorderStyle.SOLID);
      if (catRow % 2 == 0) {
        sheet.getRange(catRow, 1, 1, 2).setBackground("#FFF8E1");
      }
      catRow++;
    });
  } else {
    sheet.getRange(catRow, 1, 1, 2).merge()
      .setValue("Belum ada data penjualan")
      .setFontStyle("italic").setFontColor("#9E9E9E")
      .setHorizontalAlignment("center");
    catRow++;
  }

  // Spacer row before BARANG TERLARIS
  var topItemsStartRow = catRow + 1;

  // ═══════════════════════════════════════════════════════
  // SECTION 1: BARANG TERLARIS (Columns A-D, starts after category sales)
  // ═══════════════════════════════════════════════════════
  sheet.getRange(topItemsStartRow, 1, 1, 4).merge()
    .setValue("🏆 BARANG TERLARIS - " + month)
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#4285F4").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.getRange(topItemsStartRow + 1, 1, 1, 4).merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#E8EAF6").setFontColor("#3F51B5")
    .setHorizontalAlignment("center");

  sheet.getRange(topItemsStartRow + 2, 1, 1, 4)
    .setValues([["Rank", "Kode Barang", "Nama Barang", "Terjual (Pcs)"]])
    .setFontWeight("bold").setBackground("#E3F2FD")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#4285F4", SpreadsheetApp.BorderStyle.SOLID);

  var items = data.items || [];
  var topItems = items.slice(0, 25);
  var dataStartRow = topItemsStartRow + 3;

  if (topItems.length > 0) {
    var rows = topItems.map(function (item, index) {
      var rankDisplay = item.rank;
      if (item.rank == 1) rankDisplay = "🥇 " + item.rank;
      else if (item.rank == 2) rankDisplay = "🥈 " + item.rank;
      else if (item.rank == 3) rankDisplay = "🥉 " + item.rank;
      return [rankDisplay, item.kode, item.nama, item.quantity];
    });

    sheet.getRange(dataStartRow, 1, rows.length, 4).setValues(rows);
    sheet.getRange(dataStartRow, 1, rows.length, 4)
      .setBorder(true, true, true, true, true, true, "#BBDEFB", SpreadsheetApp.BorderStyle.SOLID)
      .setFontColor("#1565C0").setFontWeight("bold").setVerticalAlignment("middle");
    sheet.getRange(dataStartRow, 1, rows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(dataStartRow, 4, rows.length, 1).setNumberFormat("#,##0").setHorizontalAlignment("center");

    for (var i = 0; i < rows.length; i++) {
      if (i % 2 != 0) { sheet.getRange(dataStartRow + i, 1, 1, 4).setBackground("#F5F7FA"); }
    }
    sheet.getRange(dataStartRow, 1, Math.min(rows.length, 3), 4).setBackground("#E3F2FD");
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 2: DATA PENGUNJUNG (Columns F-J)
  // ═══════════════════════════════════════════════════════
  SpreadsheetApp.flush();

  sheet.getRange("F1:J1").merge()
    .setValue("👥 DATA PENGUNJUNG")
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#2E7D32").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.getRange("F2:J2").merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#E8F5E9").setFontColor("#2E7D32")
    .setHorizontalAlignment("center");

  sheet.getRange("F3:J3")
    .setValues([["📅 Tanggal", "☀️ < 12:00", "🌙 > 12:00", "Σ Total", "❌ Lost"]])
    .setFontWeight("bold").setBackground("#C8E6C9")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#2E7D32", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("J3").setFontColor("#D32F2F");

  var dailyVisitors = data.dailyVisitors || [];
  var visitorRow = 4;
  var totalBefore12 = 0, totalAfter12 = 0, totalLost = 0;

  if (dailyVisitors.length > 0) {
    dailyVisitors.forEach(function (day) {
      totalBefore12 += day.before12;
      totalAfter12 += day.after12;
      totalLost += day.lost;

      sheet.getRange(visitorRow, 6, 1, 5)
        .setValues([[day.date, day.before12, day.after12, (day.before12 + day.after12), day.lost]])
        .setBorder(true, true, true, true, true, true, "#A5D6A7", SpreadsheetApp.BorderStyle.SOLID);
      sheet.getRange(visitorRow, 7, 1, 4).setNumberFormat("0");
      if (day.lost > 0) {
        sheet.getRange(visitorRow, 10).setFontColor("red").setFontWeight("bold");
      }
      sheet.getRange(visitorRow, 7, 1, 4).setHorizontalAlignment("center");
      visitorRow++;
    });

    sheet.getRange(visitorRow, 6, 1, 5)
      .setValues([["📊 TOTAL TAMU :", totalBefore12, totalAfter12, totalBefore12 + totalAfter12, totalLost]])
      .setFontWeight("bold").setBackground("#66BB6A").setFontColor("#FFFFFF")
      .setBorder(true, true, true, true, true, true, "#1B5E20", SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(visitorRow, 7, 1, 4).setNumberFormat("0").setHorizontalAlignment("center");
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 3: LIST KETERANGAN LOST (Columns L-M)
  // ═══════════════════════════════════════════════════════
  sheet.getRange("L1:M1").merge()
    .setValue("❌ LIST BARANG LOST")
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#D32F2F").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.getRange("L2:M2").merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#FFEBEE").setFontColor("#C62828")
    .setHorizontalAlignment("center");

  sheet.getRange("L3:M3")
    .setValues([["📅 Tanggal", "📝 Keterangan Barang"]])
    .setFontWeight("bold").setBackground("#FFCDD2")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#D32F2F", SpreadsheetApp.BorderStyle.SOLID);

  var allLostList = data.allLostList || [];
  if (allLostList.length > 0) {
    var lostRow = 4;
    allLostList.forEach(function (entry) {
      sheet.getRange(lostRow, 12, 1, 2)
        .setValues([[entry.date, "• " + entry.description]])
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
        .setVerticalAlignment("middle")
        .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);
      if (lostRow % 2 == 0) {
        sheet.getRange(lostRow, 12, 1, 2).setBackground("#FEEBEE");
      }
      lostRow++;
    });
  } else {
    sheet.getRange(4, 12, 1, 2).merge()
      .setValue("✅ Tidak ada barang lost bulan ini!")
      .setFontStyle("italic").setHorizontalAlignment("center").setFontColor("#43A047");
  }

  sheet.setColumnWidth(14, 20);

  // ═══════════════════════════════════════════════════════
  // SECTION 4: LIST REFUND BARANG (Columns O-U)
  // ═══════════════════════════════════════════════════════
  sheet.getRange("O1:U1").merge()
    .setValue("🔄 LIST REFUND BARANG")
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#C62828").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  sheet.getRange("O2:U2").merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#FFEBEE").setFontColor("#C62828")
    .setHorizontalAlignment("center");

  sheet.getRange("O3:U3")
    .setValues([["📅 Tgl Refund", "📅 Tgl Beli", "🏷️ Kode", "📦 Nama Barang", "📊 Qty", "💵 Harga / Pcs", "💰 Total Refund"]])
    .setFontWeight("bold").setBackground("#FFCDD2")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#C62828", SpreadsheetApp.BorderStyle.SOLID);

  var monthlyRefunds = data.monthlyRefunds || data.monthlyExchanges || data.refunds || data.refundList || [];
  var refundRow = 4;

  if (monthlyRefunds.length > 0) {
    monthlyRefunds.forEach(function (item) {
      var tglBeli = item.tglBeli || item.purchaseDate || "-";
      var namaBarang = item.nama || item.name || "-";
      var qty = item.quantity || item.qty || 1;
      var harga = item.hargaPcs || item.price || item.harga || 0;
      var total = item.totalRefund || item.total || (qty * harga);

      sheet.getRange(refundRow, 15, 1, 7)
        .setValues([[item.date, tglBeli, item.kode || "-", "📦 " + namaBarang, qty, harga, total]])
        .setVerticalAlignment("middle")
        .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

      sheet.getRange(refundRow, 19).setHorizontalAlignment("center").setNumberFormat("0");
      sheet.getRange(refundRow, 20).setNumberFormat("Rp #,##0");
      sheet.getRange(refundRow, 21).setNumberFormat("Rp #,##0").setFontColor("#D32F2F").setFontWeight("bold");
      if (refundRow % 2 == 0) {
        sheet.getRange(refundRow, 15, 1, 7).setBackground("#FEEBEE");
      }
      refundRow++;
    });

    sheet.getRange(refundRow, 15, 1, 7).merge()
      .setValue("📊 Total Transaksi Refund: " + monthlyRefunds.length)
      .setFontWeight("bold").setBackground("#C62828").setFontColor("#FFFFFF")
      .setBorder(true, true, true, true, true, true, "#B71C1C", SpreadsheetApp.BorderStyle.SOLID);
    refundRow++;
  } else {
    sheet.getRange(4, 15, 1, 7).merge()
      .setValue("✅ Tidak ada transaksi refund bulan ini!")
      .setFontStyle("italic").setHorizontalAlignment("center").setFontColor("#43A047");
    refundRow = 5;
  }

  sheet.setColumnWidth(22, 20);

  // ═══════════════════════════════════════════════════════
  // SECTION 5: CATATAN - REKAP BULANAN (Columns W-AC)
  // ═══════════════════════════════════════════════════════
  var notesRow = 1;
  sheet.getRange(notesRow, 23, 1, 7).merge()
    .setValue("📝 CATATAN - REKAP BULANAN")
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#7B1FA2").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");
  notesRow++;

  sheet.getRange(notesRow, 23, 1, 7).merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setBackground("#F3E5F5").setFontColor("#7B1FA2")
    .setHorizontalAlignment("center");
  notesRow++;

  sheet.getRange(notesRow, 23, 1, 7)
    .setValues([["📅 Tgl Buat", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "Status", "📅 Tgl Selesai"]])
    .setFontWeight("bold").setBackground("#E1BEE7")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#7B1FA2", SpreadsheetApp.BorderStyle.SOLID);
  notesRow++;

  var monthlyNotes = data.monthlyNotes || [];
  if (monthlyNotes.length > 0) {
    monthlyNotes.forEach(function (note) {
      var isHutang = note.type === 'hutang';
      var statusText = isHutang ? (note.completed ? "LUNAS ✅" : "BELUM BAYAR ⏳") : "";
      var completedAtText = isHutang ? (note.completedAt || "-") : "";
      var rowColor = (isHutang && note.completed) ? "#F5F5F5" : "#FFFFFF";

      sheet.getRange(notesRow, 23, 1, 7)
        .setValues([[note.date, note.type.toUpperCase(), note.customerName, note.content, note.amount, statusText, completedAtText]])
        .setBackground(rowColor).setVerticalAlignment("middle")
        .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

      if (note.amount > 0) {
        sheet.getRange(notesRow, 27).setNumberFormat("Rp #,##0");
      }

      var typeCell = sheet.getRange(notesRow, 24);
      if (note.type === 'hutang') typeCell.setFontColor("#D32F2F").setFontWeight("bold");
      else if (note.type === 'belanja') typeCell.setFontColor("#2E7D32").setFontWeight("bold");
      else typeCell.setFontColor("#7B1FA2").setFontWeight("bold");

      if (isHutang) {
        var statusCell = sheet.getRange(notesRow, 28);
        if (note.completed) statusCell.setFontColor("#2E7D32").setFontWeight("bold");
        else statusCell.setFontColor("#F57C00").setFontWeight("bold");
      }

      notesRow++;
    });
  } else {
    sheet.getRange(notesRow, 23, 1, 7).merge()
      .setValue("✅ Tidak ada catatan aktif bulan ini!")
      .setFontStyle("italic").setHorizontalAlignment("center").setFontColor("#43A047");
  }

  // Column widths
  sheet.setColumnWidth(1, 40); sheet.setColumnWidth(2, 100); sheet.setColumnWidth(3, 350);
  sheet.setColumnWidth(4, 100); sheet.setColumnWidth(5, 20);
  sheet.setColumnWidth(6, 120); sheet.setColumnWidth(7, 125); sheet.setColumnWidth(8, 125);
  sheet.setColumnWidth(9, 100); sheet.setColumnWidth(10, 100); sheet.setColumnWidth(11, 20);
  sheet.setColumnWidth(12, 100); sheet.setColumnWidth(13, 300); sheet.setColumnWidth(14, 20);
  sheet.setColumnWidth(15, 100); sheet.setColumnWidth(16, 100); sheet.setColumnWidth(17, 100);
  sheet.setColumnWidth(18, 250); sheet.setColumnWidth(19, 50); sheet.setColumnWidth(20, 100);
  sheet.setColumnWidth(21, 100); sheet.setColumnWidth(22, 20);
  sheet.setColumnWidth(23, 100); sheet.setColumnWidth(24, 80); sheet.setColumnWidth(25, 120);
  sheet.setColumnWidth(26, 300); sheet.setColumnWidth(27, 100); sheet.setColumnWidth(28, 100);
  sheet.setColumnWidth(29, 100);

  SpreadsheetApp.flush();

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
          product.kode, product.nama, product.kategori,
          product.hargaJual, product.hargaBeli, product.stok
        ]]);
        found = true;
        break;
      }
    }

    if (!found) {
      sheet.appendRow([product.kode, product.nama, product.kategori,
        product.hargaJual, product.hargaBeli, product.stok]);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════
 * saveSalesData - UPDATED
 * 
 * PERUBAHAN:
 * 1. Item hutang diwarnai MERAH di tabel penjualan
 * 2. HUTANG HARI INI muncul setelah TOTAL (kalau ada hutang belum lunas)
 * 3. PELUNASAN HUTANG muncul (kalau ada pelunasan dari hari sebelumnya)
 * 4. Kalau hutang dilunasi sore, item jadi hitam lagi & HUTANG HARI INI hilang
 * 5. Urutan: TOTAL → HUTANG HARI INI → BELANJA KASIR → TOTAL REFUND → PELUNASAN HUTANG → KAS HARI INI
 * ═══════════════════════════════════════════════════════════════
 */
function saveSalesData(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = data.date || new Date().toLocaleDateString("id-ID");

  var now = new Date();
  var monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  var sheetName = "Harian " + monthNames[now.getMonth()] + " " + now.getFullYear();

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    try { ss.setActiveSheet(sheet); ss.moveActiveSheet(1); } catch (e) { }
  }

  var maxRows = sheet.getMaxRows();
  if (maxRows < 1000) {
    sheet.insertRowsAfter(maxRows, 1000 - maxRows);
  }

  var items = (data.items || []).slice().reverse();
  var refunds = (data.refunds || []).slice().reverse();
  var exchanges = (data.exchanges || []).slice().reverse();
  var visitors = data.visitors || { before12: 0, after12: 0, total: 0, lost: 0, lostList: [] };
  var summary = data.summary || {}; // NEW: Pre-computed summary dari app

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

  var startRow = sheet.getLastRow() + 1;
  var currentRow = startRow;

  // ═══════════════════════════════════════════════════════
  // SECTION: Header Tanggal
  // ═══════════════════════════════════════════════════════
  sheet.getRange(currentRow, 1, 1, 4).merge()
    .setValue("📅 " + today)
    .setFontWeight("bold").setFontSize(14)
    .setBackground("#4285F4").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");
  currentRow++;

  var timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
  sheet.getRange(currentRow, 1, 1, 4).merge()
    .setValue("🕒 Terakhir Update: " + timeStr + " WIB")
    .setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center")
    .setBackground("#E8EAF6").setFontColor("#3F51B5");
  currentRow++;

  // ═══════════════════════════════════════════════════════
  // SECTION: Data Tamu
  // ═══════════════════════════════════════════════════════
  sheet.getRange(currentRow, 1, 1, 4).merge()
    .setValue("👥 TAMU HARI INI")
    .setFontWeight("bold").setFontSize(11)
    .setBackground("#E8F5E9").setFontColor("#2E7D32");
  currentRow++;

  sheet.getRange(currentRow, 1, 1, 4)
    .setValues([["< 12", "> 12", "Total", "❌ Lost"]])
    .setFontWeight("bold").setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(currentRow, 1, 1, 3).setBackground("#C8E6C9");
  sheet.getRange(currentRow, 4).setBackground("#C62828").setFontColor("#FFFFFF");
  currentRow++;

  sheet.getRange(currentRow, 1, 1, 4)
    .setValues([[visitors.before12, visitors.after12, visitors.total, visitors.lost]])
    .setNumberFormat("0").setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#4CAF50", SpreadsheetApp.BorderStyle.SOLID);
  currentRow++;

  // Daftar Lost
  var lostList = visitors.lostList || [];
  if (lostList.length > 0) {
    sheet.getRange(currentRow, 1, 1, 4).merge()
      .setValue("❌ DAFTAR LOST:")
      .setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#C62828");
    currentRow++;

    lostList.forEach(function (desc, idx) {
      sheet.getRange(currentRow, 1, 1, 4).merge()
        .setValue("  " + (idx + 1) + ". " + desc)
        .setFontColor("#C62828").setBackground("#FFEBEE");
      currentRow++;
    });
  }

  sheet.getRange(currentRow, 1).setValue("");
  currentRow++;

  // ═══════════════════════════════════════════════════════
  // SECTION: Penjualan - UPDATED dengan warna merah untuk hutang
  // ═══════════════════════════════════════════════════════
  if (items.length > 0) {
    sheet.getRange(currentRow, 1, 1, 4).merge()
      .setValue("📦 PENJUALAN HARI INI")
      .setFontWeight("bold").setFontSize(11)
      .setBackground("#1565C0").setFontColor("#FFFFFF");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 4)
      .setValues([["KODE", "Qty", "Harga", "Total"]])
      .setFontWeight("bold").setBackground("#E3F2FD")
      .setHorizontalAlignment("center")
      .setBorder(true, true, true, true, true, true, "#2196F3", SpreadsheetApp.BorderStyle.SOLID);
    currentRow++;

    var totalSales = 0;
    items.forEach(function (item) {
      sheet.getRange(currentRow, 1, 1, 4)
        .setValues([[item.kode || "-", item.quantity, item.price, item.total]])
        .setBorder(true, true, true, true, true, true, "#90CAF9", SpreadsheetApp.BorderStyle.SOLID);

      sheet.getRange(currentRow, 2).setNumberFormat("0");
      sheet.getRange(currentRow, 3).setNumberFormat("0");
      sheet.getRange(currentRow, 4).setNumberFormat("#,##0");
      sheet.getRange(currentRow, 2, 1, 3).setHorizontalAlignment("right");

      // ★ BARU: Warnai item hutang dengan MERAH
      if (item.isHutang) {
        sheet.getRange(currentRow, 1, 1, 4)
          .setFontColor("#D32F2F")  // Merah
          .setFontWeight("bold");
      }

      totalSales += item.total;
      currentRow++;
    });

    // ═══════════════════════════════════════════════════════
    // SUMMARY SECTION - UPDATED ORDER & LOGIC
    // Pakai data dari summary payload (sudah dihitung di app)
    // ═══════════════════════════════════════════════════════
    var sumTotalSales = summary.totalSales || totalSales;
    var sumHutangBaru = summary.totalHutangBaru || 0;
    var sumBelanja = summary.totalBelanja || 0;
    var sumRefund = summary.totalRefund || 0;
    var sumPelunasan = summary.totalPelunasan || 0;
    var sumKasHariIni = summary.kasHariIni || (sumTotalSales - sumBelanja - sumHutangBaru + sumPelunasan - sumRefund);

    // Row 1: TOTAL (Light Blue)
    sheet.getRange(currentRow, 3).setValue("TOTAL :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#90CAF9").setFontColor("#000000");
    sheet.getRange(currentRow, 4).setValue(sumTotalSales).setFontWeight("bold").setBackground("#90CAF9").setFontColor("#000000").setNumberFormat("Rp #,##0");
    currentRow++;

    // Row 2: HUTANG HARI INI (Red - hanya muncul kalau ada)
    if (sumHutangBaru > 0) {
      sheet.getRange(currentRow, 3).setValue("HUTANG HARI INI :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#D32F2F");
      sheet.getRange(currentRow, 4).setValue(-sumHutangBaru).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#D32F2F").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
      currentRow++;
    }

    // Row 3: BELANJA KASIR (Purple)
    if (sumBelanja > 0) {
      sheet.getRange(currentRow, 3).setValue("BELANJA KASIR :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#7B1FA2");
      sheet.getRange(currentRow, 4).setValue(-sumBelanja).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#7B1FA2").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
      currentRow++;
    }

    // Row 4: TOTAL REFUND (Red)
    sheet.getRange(currentRow, 3).setValue("TOTAL REFUND :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#D32F2F");
    sheet.getRange(currentRow, 4).setValue(-sumRefund).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#D32F2F").setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
    currentRow++;

    // Row 5: PELUNASAN HUTANG (Green - hanya muncul kalau ada)
    if (sumPelunasan > 0) {
      sheet.getRange(currentRow, 3).setValue("PELUNASAN HUTANG :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#FFFFFF").setFontColor("#2E7D32");
      sheet.getRange(currentRow, 4).setValue(sumPelunasan).setFontWeight("bold").setBackground("#FFFFFF").setFontColor("#2E7D32").setNumberFormat("Rp #,##0");
      currentRow++;
    }

    // Row 6: KAS HARI INI (Dark Blue)
    sheet.getRange(currentRow, 3).setValue("KAS HARI INI :").setFontWeight("bold").setHorizontalAlignment("right").setBackground("#1565C0").setFontColor("#FFFFFF");
    sheet.getRange(currentRow, 4).setValue(sumKasHariIni).setFontWeight("bold").setBackground("#1565C0").setFontColor("#FFFFFF").setNumberFormat("Rp #,##0");
    currentRow++;

    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;
  }

  sheet.getRange(currentRow, 1).setValue("");
  currentRow++;

  // ═══════════════════════════════════════════════════════
  // SECTION: Refund Barang
  // ═══════════════════════════════════════════════════════
  if (refunds.length > 0) {
    sheet.getRange(currentRow, 1, 1, 7).merge()
      .setValue("↩️ REFUND BARANG HARI INI")
      .setFontWeight("bold").setFontSize(11)
      .setBackground("#C62828").setFontColor("#FFFFFF");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 7)
      .setValues([["📅 Tgl Refund", "📅 Tgl Beli", "🏷️ Kode", "📦 Nama Barang", "Qty", "💵 Harga/Pcs", "💰 Total Refund"]])
      .setFontWeight("bold").setBackground("#FFEBEE")
      .setHorizontalAlignment("center")
      .setBorder(true, true, true, true, true, true, "#D32F2F", SpreadsheetApp.BorderStyle.SOLID);
    currentRow++;

    var totalRefund = 0;
    refunds.forEach(function (r) {
      var tglRefund = r.date || "-";
      var tglBeli = r.purchaseDate || "-";
      var totalItem = (r.quantity || 1) * (r.price || 0);

      sheet.getRange(currentRow, 1, 1, 7)
        .setValues([[tglRefund, tglBeli, r.kode || "-", r.nama || r.name || "-", r.quantity || 1, r.price || 0, -totalItem]])
        .setBorder(true, true, true, true, true, true, "#EF9A9A", SpreadsheetApp.BorderStyle.SOLID);

      if (currentRow % 2 == 0) {
        sheet.getRange(currentRow, 1, 1, 7).setBackground("#FFEBEE");
      }

      sheet.getRange(currentRow, 6).setNumberFormat("Rp #,##0");
      sheet.getRange(currentRow, 7).setNumberFormat("Rp #,##0;\"-Rp \"#,##0").setFontColor("#D32F2F").setFontWeight("bold");

      totalRefund += totalItem;
      currentRow++;
    });

    sheet.getRange(currentRow, 1, 1, 7)
      .setValues([["📊 Total Refund: " + refunds.length + " item", "", "", "", "", "TOTAL:", -totalRefund]])
      .setFontWeight("bold").setBackground("#D32F2F").setFontColor("#FFFFFF")
      .setBorder(true, true, true, true, true, true, "#B71C1C", SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(currentRow, 7).setNumberFormat("Rp #,##0;\"-Rp \"#,##0");
    currentRow++;
  }

  sheet.getRange(currentRow, 1).setValue("");
  currentRow++;

  // ═══════════════════════════════════════════════════════
  // SECTION: Catatan
  // ═══════════════════════════════════════════════════════
  var notes = data.notes || [];
  if (notes.length > 0) {
    sheet.getRange(currentRow, 1, 1, 7).merge()
      .setValue("📝 CATATAN")
      .setFontWeight("bold").setFontSize(11)
      .setBackground("#9C27B0").setFontColor("#FFFFFF")
      .setHorizontalAlignment("left");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 7)
      .setValues([["📅 Tgl", "🏷️ Jenis", "👤 Nama", "📝 Isi Catatan", "💰 Jumlah", "📊 Status", "📅 Tgl Selesai"]])
      .setFontWeight("bold").setBackground("#E1BEE7")
      .setHorizontalAlignment("center")
      .setBorder(true, true, true, true, true, true, "#9C27B0", SpreadsheetApp.BorderStyle.SOLID);
    currentRow++;

    notes.forEach(function (n) {
      var typeColor = n.type === 'hutang' ? "#D32F2F" : (n.type === 'belanja' ? "#2E7D32" : "#7B1FA2");
      var status = n.type === 'hutang' ? (n.completed ? "LUNAS ✅" : "BELUM BAYAR 🔴") : "";
      var tglSelesai = n.completedAt || (n.type === 'hutang' ? "-" : "");

      sheet.getRange(currentRow, 1, 1, 7)
        .setValues([[n.date, n.type.toUpperCase(), n.customerName || "-", n.content, n.amount, status, tglSelesai]])
        .setBorder(true, true, true, true, true, true, "#CE93D8", SpreadsheetApp.BorderStyle.SOLID);

      sheet.getRange(currentRow, 2).setFontColor(typeColor).setFontWeight("bold");
      if (n.amount > 0) { sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0"); }
      if (n.type === 'hutang') {
        if (n.completed) sheet.getRange(currentRow, 6).setFontColor("#2E7D32").setFontWeight("bold");
        else sheet.getRange(currentRow, 6).setFontColor("#D32F2F").setFontWeight("bold");
      }
      currentRow++;
    });

    sheet.getRange(currentRow, 1).setValue("");
    currentRow++;
  }

  // ═══════════════════════════════════════════════════════
  // SECTION: Backup Google Drive
  // ═══════════════════════════════════════════════════════
  if (data.backupInfo && data.backupInfo.success) {
    sheet.getRange(currentRow, 1, 1, 7).merge()
      .setValue("💾 LINK BACKUP GOOGLE DRIVE (JSON)")
      .setFontWeight("bold").setFontSize(11)
      .setBackground("#90CAF9").setFontColor("#000000")
      .setHorizontalAlignment("left");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 7).merge()
      .setFormula('=HYPERLINK("' + data.backupInfo.folderUrl + '"; "📁 Buka Folder Backup (Google Drive)")')
      .setFontColor("#000000").setFontLine("underline")
      .setBackground("#FFFFFF").setHorizontalAlignment("left");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 7).merge()
      .setFormula('=HYPERLINK("' + data.backupInfo.downloadUrl + '"; "📥 Download File: ' + data.backupInfo.fileName + '")')
      .setFontColor("#000000").setFontLine("underline")
      .setBackground("#FFF9C4").setHorizontalAlignment("left");
    currentRow++;

    currentRow++;
  }

  // Divider Line
  sheet.getRange(currentRow, 1)
    .setValue("═══════════════════════════════════════════════════════════════════════════════════")
    .setFontColor("#000000").setFontWeight("bold");
  sheet.getRange(currentRow, 1, 1, 7).setBackground("#E0E0E0");
  currentRow++;

  sheet.getRange(currentRow, 1).setValue("");
  currentRow++;

  // ═══════════════════════════════════════════════════════
  // SECTION: Tukar Barang
  // ═══════════════════════════════════════════════════════
  if (exchanges.length > 0) {
    sheet.getRange(currentRow, 1, 1, 9).merge()
      .setValue("🔄 LIST TUKAR BARANG")
      .setFontWeight("bold").setFontSize(11)
      .setBackground("#FF9800").setFontColor("#FFFFFF");
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 2).setBackground("#FFE0B2");
    sheet.getRange(currentRow, 3, 1, 3).setBackground("#FFF9C4");
    sheet.getRange(currentRow, 6, 1, 3).setBackground("#C8E6C9");
    sheet.getRange(currentRow, 9).setBackground("#FFE0B2");

    sheet.getRange(currentRow, 1, 1, 9)
      .setValues([["📅 Tgl Tukar", "📅 Tgl Beli", "📦 Barang Lama", "Qty", "💵 Harga / Pcs", "🔄 Ditukar (Baru)", "Qty", "💵 Harga / Pcs", "💰 Selisih"]])
      .setFontWeight("bold").setHorizontalAlignment("center")
      .setBorder(true, true, true, true, true, true, "#FF9800", SpreadsheetApp.BorderStyle.SOLID);
    currentRow++;

    var totalExchangeSelisih = 0;
    exchanges.forEach(function (ex) {
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

      var tglBeli = "-";
      if (ex.originalPurchaseDate) {
        var purchaseDateStr = new Date(ex.originalPurchaseDate).toISOString().split('T')[0];
        var exchangeDateStr = ex.date ? new Date(ex.date).toISOString().split('T')[0] : "";
        if (purchaseDateStr === exchangeDateStr) tglBeli = "Di hari yg sama";
        else tglBeli = new Date(ex.originalPurchaseDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
      }

      var hargaLama = ex.hargaLama || (ex.originalItem && ex.originalItem.price) || 0;
      var hargaBaru = ex.hargaBaru || (ex.newItem && ex.newItem.price) || 0;

      sheet.getRange(currentRow, 1, 1, 9)
        .setValues([[tglTukar, tglBeli, originalDisplay, originalQty, hargaLama, newDisplay, newQty, hargaBaru, selisih]])
        .setBorder(true, true, true, true, true, true, "#FFCC80", SpreadsheetApp.BorderStyle.SOLID);

      sheet.getRange(currentRow, 3, 1, 3).setBackground("#FFFDE7");
      sheet.getRange(currentRow, 6, 1, 3).setBackground("#F1F8E9");
      sheet.getRange(currentRow, 5).setNumberFormat("Rp #,##0");
      sheet.getRange(currentRow, 8).setNumberFormat("Rp #,##0");

      var selisihCell = sheet.getRange(currentRow, 9);
      selisihCell.setHorizontalAlignment("right").setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");
      if (selisih > 0) selisihCell.setFontColor("#2E7D32").setFontWeight("bold");
      else if (selisih < 0) selisihCell.setFontColor("#D32F2F").setFontWeight("bold");

      totalExchangeSelisih += selisih;
      currentRow++;
    });

    sheet.getRange(currentRow, 1, 1, 9)
      .setValues([["📊 Total Transaksi Tukar: " + exchanges.length, "", "", "", "", "", "", "TOTAL SELISIH:", totalExchangeSelisih]])
      .setFontWeight("bold").setBackground("#FF9800").setFontColor("#FFFFFF")
      .setBorder(true, true, true, true, true, true, "#E65100", SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(currentRow, 9).setNumberFormat("\"Rp \"+#,##0;\"Rp \"-#,##0;\"Rp \"0");
    currentRow++;
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}
