import React, { useState, useEffect, useRef } from "react";
import { Product } from "@/types/pos";
import {
  getFromLS,
  saveToLS,
  LS_KEYS,
  backupProductsToFile,
  backupAllDataToFile,
  restoreFromFile,
  getStorageInfo,
  getTransactionStats,
  archiveOldTransactions,
  sendBackupAsTextToTelegram,
  getConfig,
} from "@/lib/utils";
import { getProducts as getCachedProducts } from "@/lib/productCache";
import { getTransactionsCount, getAllTransactions, getStorageEstimate, getTodayTransactions, saveTransaction } from "@/lib/indexedDB";
import { VisitorLog, VisitorLostLog } from "@/lib/visitors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Save,
  Download,
  Upload,
  Trash2,
  AlertCircle,
  Settings,
  Settings2,
  Store,
  Calendar,
  Send,
} from "lucide-react";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  workshopName: string;
  avatarUrl?: string;
}

const ProfilePage = () => {
  const [profile, setProfile] = useState<ProfileData>(
    getFromLS<ProfileData>(
      "bengkel_profile",
      {
        id: "profile-1",
        name: "Admin Toko",
        email: "admin@tokobaut.com",
        phone: "081234567890",
        address: "Alamat Toko Baut",
        workshopName: "BAUT - APP KASIR",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=workshop",
      },
    )
  );

  const [showNameDialog, setShowNameDialog] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number; usedPercent: number }>({ used: 0, total: 5242880, usedPercent: 0 });
  const [txStats, setTxStats] = useState<{ total: number; thisMonth: number; lastMonth: number; older: number; txCount: number }>({ total: 0, thisMonth: 0, lastMonth: 0, older: 0, txCount: 0 });
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveDays, setArchiveDays] = useState(-2);
  const [showArchiveStep2, setShowArchiveStep2] = useState(false);
  const [archiveBackupReady, setArchiveBackupReady] = useState(false);
  const [archiveBackupInProgress, setArchiveBackupInProgress] = useState(false);
  const [sendingTelegramBackup, setSendingTelegramBackup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings states
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState(getConfig());
  const [tempGasUrl, setTempGasUrl] = useState(config.gasUrl);
  const [tempProductGasUrl, setTempProductGasUrl] = useState(config.productGasUrl);
  const [tempBotToken, setTempBotToken] = useState(config.telegramBotToken);
  const [tempChatId, setTempChatId] = useState(config.telegramChatId);
  const [tempAutoSendEnabled, setTempAutoSendEnabled] = useState(config.autoSendEnabled || false);
  const [tempAutoSendTimes, setTempAutoSendTimes] = useState(config.autoSendTimes || "");
  const [uploadingProducts, setUploadingProducts] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  // Historical sync states
  const [sendingHistorical, setSendingHistorical] = useState(false);
  const [historicalProgress, setHistoricalProgress] = useState("");

  // IndexedDB stats
  const [dbStats, setDbStats] = useState<{ txCount: number; itemCount: number; storageUsed: number; storageQuota: number }>({
    txCount: 0, itemCount: 0, storageUsed: 0, storageQuota: 0
  });

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    if (bytes < 1024) return `${bytes} Bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  // Load IndexedDB stats function
  const loadDbStats = async () => {
    try {
      const txCount = await getTransactionsCount();
      const allTx = await getAllTransactions();
      const itemCount = allTx.reduce((sum, t) => sum + (t.items?.length || 0), 0);
      const storage = await getStorageEstimate();

      setDbStats({
        txCount,
        itemCount,
        storageUsed: storage.used,
        storageQuota: storage.quota,
      });
    } catch (err) {
      console.error('Failed to load IndexedDB stats:', err);
    }
  };

  // Load profile from localStorage and IndexedDB stats
  useEffect(() => {
    const storedProfile = getFromLS<ProfileData | null>("bengkel_profile", null);
    if (storedProfile) {
      setProfile(storedProfile);
    } else {
      saveToLS("bengkel_profile", profile);
    }

    setStorageInfo(getStorageInfo());
    getTransactionStats().then(stats => setTxStats(stats));

    // Initial load
    loadDbStats();

    // Real-time update every 2 seconds
    const interval = setInterval(() => {
      loadDbStats();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleSaveStoreName = () => {
    if (newStoreName.trim()) {
      const updatedProfile = { ...profile, workshopName: newStoreName.trim() };
      setProfile(updatedProfile);
      saveToLS("bengkel_profile", updatedProfile);
      setShowNameDialog(false);
      setNewStoreName("");

      // Dispatch event to notify App.tsx to update document title
      window.dispatchEvent(new CustomEvent("profileUpdated"));

      alert("Nama toko berhasil diubah!");
    }
  };

  const handleBackupProducts = () => {
    try {
      backupProductsToFile();
      alert("Backup produk berhasil diunduh!");
    } catch (error) {
      alert("Gagal membuat backup produk");
    }
  };

  const handleBackupAllData = async () => {
    try {
      await backupAllDataToFile();
      alert("Backup lengkap berhasil diunduh! (termasuk semua transaksi, tukar/refund, dll)");
    } catch (error) {
      alert("Gagal membuat backup lengkap");
    }
  };

  // Send backup as text to Telegram (Bot 2)
  const handleSendBackupToTelegram = async () => {
    if (sendingTelegramBackup) return;

    const confirmed = window.confirm(
      "Kirim backup lengkap sebagai TEKS ke Telegram?\n\n" +
      "Data akan dikirim dalam beberapa pesan ke channel Telegram yang dikonfigurasi.\n\n" +
      "Pastikan VITE_TELEGRAM_BOT_TOKEN_2 dan VITE_TELEGRAM_CHAT_ID_2 sudah diisi di .env"
    );

    if (!confirmed) return;

    setSendingTelegramBackup(true);
    try {
      const result = await sendBackupAsTextToTelegram();
      if (result.success) {
        alert(`✅ Backup berhasil dikirim ke Telegram!\n\n📤 ${result.messageCount} pesan terkirim`);
      } else {
        alert("❌ Gagal mengirim backup ke Telegram.\n\nPastikan kredensial Bot 2 sudah dikonfigurasi di .env");
      }
    } catch (error) {
      alert("❌ Error: " + (error as Error).message);
    } finally {
      setSendingTelegramBackup(false);
    }
  };

  const handleRestoreFromFile = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert("Pilih file backup terlebih dahulu");
      return;
    }

    if (!file.name.endsWith('.json')) {
      alert("File harus berformat JSON");
      return;
    }

    try {
      await restoreFromFile(file);
      alert("Data berhasil dipulihkan dari file! Halaman akan dimuat ulang.");
      // Small delay to ensure IndexedDB transaction completes
      await new Promise(resolve => setTimeout(resolve, 500));
      window.location.reload();
    } catch (error: any) {
      console.error("Restore error:", error);
      alert(`Gagal restore: ${error.message || 'Format file tidak valid'}`);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Reference for today's data import
  const todayDataInputRef = useRef<HTMLInputElement>(null);

  // Export today's transactions and visitors as JSON
  const handleExportTodayData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get today's transactions from IndexedDB
      const todayTransactions = await getTodayTransactions();

      // Get today's visitors from localStorage
      const allVisitors = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, []);
      const allLost = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, []);

      const todayVisitors = allVisitors.filter(v => v.date === today);
      const todayLost = allLost.filter(l => l.date === today);

      const exportData = {
        type: "today-data",
        date: today,
        timestamp: new Date().toISOString(),
        version: "1.0",
        data: {
          transactions: todayTransactions,
          visitors: todayVisitors,
          visitorLost: todayLost,
        }
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      // Filename: pos-today-YYYY-MM-DD-HH-mm.json
      const now = new Date();
      const filename = `pos-today-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
      a.download = filename;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`✅ Export berhasil!\n\n📦 ${todayTransactions.length} transaksi\n👥 ${todayVisitors.length} tamu\n❌ ${todayLost.length} lost`);
    } catch (error) {
      console.error("Error exporting today's data:", error);
      alert("Gagal mengekspor data hari ini");
    }
  };

  // Import today's transactions and visitors from JSON
  const handleImportTodayData = async () => {
    const file = todayDataInputRef.current?.files?.[0];
    if (!file) {
      alert("Pilih file terlebih dahulu");
      return;
    }

    if (!file.name.endsWith('.json')) {
      alert("File harus berformat JSON");
      return;
    }

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // Validate format
      if (importData.type !== "today-data" || !importData.data) {
        alert("Format file tidak valid. Gunakan file yang diekspor dari fitur 'Export Data Hari Ini'.");
        return;
      }

      const today = new Date().toISOString().split('T')[0];
      const { transactions, visitors, visitorLost } = importData.data;

      let importedTx = 0;
      let importedVisitors = 0;
      let importedLost = 0;

      // Import transactions - only add if ID doesn't exist
      if (Array.isArray(transactions)) {
        const existingTx = await getTodayTransactions();
        const existingIds = new Set(existingTx.map((t: any) => t.id));

        for (const tx of transactions) {
          if (!existingIds.has(tx.id)) {
            // Update date to today if importing from different day
            const txDateOnly = tx.date?.split('T')[0] || '';
            if (txDateOnly !== today) {
              const timeOnly = tx.date?.split('T')[1] || '00:00:00.000Z';
              tx.date = `${today}T${timeOnly}`;
            }
            await saveTransaction(tx);
            importedTx++;
          }
        }
      }

      // Import visitors - merge with existing, avoid duplicates by timestamp
      if (Array.isArray(visitors)) {
        const allVisitors = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, []);
        const existingTs = new Set(allVisitors.map(v => v.ts));

        for (const v of visitors) {
          if (!existingTs.has(v.ts)) {
            // Update date to today if importing from different day
            if (v.date !== today) {
              v.date = today;
            }
            allVisitors.push(v);
            importedVisitors++;
          }
        }

        if (importedVisitors > 0) {
          saveToLS(LS_KEYS.VISITORS_LOG, allVisitors);
        }
      }

      // Import visitor lost - merge with existing, avoid duplicates by timestamp
      if (Array.isArray(visitorLost)) {
        const allLost = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, []);
        const existingTs = new Set(allLost.map(l => l.ts));

        for (const l of visitorLost) {
          if (!existingTs.has(l.ts)) {
            // Update date to today if importing from different day
            if (l.date !== today) {
              l.date = today;
            }
            allLost.push(l);
            importedLost++;
          }
        }

        if (importedLost > 0) {
          saveToLS(LS_KEYS.VISITOR_LOST_LOG, allLost);
        }
      }

      // Reset file input
      if (todayDataInputRef.current) {
        todayDataInputRef.current.value = '';
      }

      // Refresh stats
      await loadDbStats();

      alert(`✅ Import berhasil!\n\n📦 ${importedTx} transaksi baru\n👥 ${importedVisitors} tamu baru\n❌ ${importedLost} lost baru\n\nData yang sudah ada tetap aman.`);

    } catch (error: any) {
      console.error("Error importing today's data:", error);
      alert(`Gagal import: ${error.message || 'File tidak valid'}`);
    }
  };

  const triggerTodayDataInput = () => {
    todayDataInputRef.current?.click();
  };

  // Send THIS MONTH's data to Google Sheets (write ulang dari awal + recap)
  const sendAllHistoricalData = async () => {
    const currentConfig = getConfig();
    const now = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const monthYear = monthNames[now.getMonth()] + " " + now.getFullYear();

    // Calculate start of current month (YYYY-MM-01)
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const todayStr = now.toISOString().split('T')[0];

    // Get all transactions from IndexedDB
    const allTransactions = await getAllTransactions();
    const completedTransactions = allTransactions.filter(t =>
      t.status !== "cancelled" && t.status !== "refunded" &&
      t.date.split('T')[0] >= startOfMonth && t.date.split('T')[0] <= todayStr
    );

    // Get all data from localStorage, filtered to this month
    const allVisitors = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, []).filter(v => v.date >= startOfMonth && v.date <= todayStr);
    const allLost = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, []).filter(l => l.date >= startOfMonth && l.date <= todayStr);
    const allExchanges = getFromLS<any[]>('bengkel_exchanges', []).filter(e => {
      const d = e.date?.split('T')[0];
      return d && d >= startOfMonth && d <= todayStr;
    });
    const allRefunds = getFromLS<any[]>('bengkel_refunds', []).filter(r => {
      const d = r.date?.split('T')[0];
      return d && d >= startOfMonth && d <= todayStr;
    });
    const allNotes = getFromLS<any[]>('bengkel_notes', []).filter(n => {
      const d = n.date?.split('T')[0];
      // Include notes created this month OR hutang that is still pending
      return (d && d >= startOfMonth && d <= todayStr) || (n.type === 'hutang' && !n.completed);
    });

    if (completedTransactions.length === 0 && allVisitors.length === 0) {
      alert("Tidak ada data bulan ini untuk dikirim");
      return;
    }

    // ═══════════════════════════════════════════
    // Step 1: Reset Sheet bulan ini dulu
    // ═══════════════════════════════════════════
    setSendingHistorical(true);
    setHistoricalProgress("🔄 Reset sheet bulan ini...");

    try {
      await fetch(currentConfig.gasUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resetSheets",
          secretKey: "zaky12345",
          month: monthYear
        })
      });
      console.log("[Historical] Sheet reset for", monthYear);
    } catch (e) {
      console.error("[Historical] Failed to reset sheet:", e);
    }

    // Small delay after reset
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ═══════════════════════════════════════════
    // Step 2: Group data by date & send per hari
    // ═══════════════════════════════════════════

    // Group transactions by date
    const transactionsByDate: Record<string, typeof allTransactions> = {};
    completedTransactions.forEach(t => {
      const dateKey = t.date.split('T')[0];
      if (!transactionsByDate[dateKey]) transactionsByDate[dateKey] = [];
      transactionsByDate[dateKey].push(t);
    });

    // Group visitors by date
    const visitorsByDate: Record<string, { before12: number; after12: number }> = {};
    allVisitors.forEach(v => {
      if (!visitorsByDate[v.date]) visitorsByDate[v.date] = { before12: 0, after12: 0 };
      const hour = new Date(v.ts).getHours();
      if (hour < 12) visitorsByDate[v.date].before12++;
      else visitorsByDate[v.date].after12++;
    });

    // Group lost by date
    const lostByDate: Record<string, string[]> = {};
    allLost.forEach(l => {
      if (!lostByDate[l.date]) lostByDate[l.date] = [];
      lostByDate[l.date].push(l.description);
    });

    // Collect all unique dates this month
    const allDates = new Set([
      ...Object.keys(transactionsByDate),
      ...Object.keys(visitorsByDate),
      ...Object.keys(lostByDate)
    ]);
    const dates = Array.from(allDates).sort();

    setHistoricalProgress(`Mengirim ${dates.length} hari data bulan ini...`);

    let successCount = 0;
    let failCount = 0;

    // Aggregate monthly data for recap
    const monthlyItems: Record<string, { sku: string; name: string; quantity: number; total: number; transactionCount: number }> = {};
    const dailyVisitorsList: { date: string; before12: number; after12: number; lost: number; lostList: string[] }[] = [];
    const allLostListForRecap: { date: string; description: string }[] = [];

    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];
      const dayTransactions = transactionsByDate[dateStr] || [];
      const dayVisitors = visitorsByDate[dateStr] || { before12: 0, after12: 0 };
      const dayLost = lostByDate[dateStr] || [];

      setHistoricalProgress(`Mengirim ${i + 1}/${dates.length}: ${dateStr}`);

      // Aggregate items for this day
      const dayItems: Record<string, { sku: string; name: string; quantity: number; price: number; total: number; isHutang: boolean }> = {};
      dayTransactions.forEach(t => {
        // Cek hutang status
        const isHutangTx = t.paymentMethod === 'hutang' || (t as any).isHutang === true;
        const associatedNote = allNotes.find((n: any) => n.transactionId === t.id);
        const isStillHutang = isHutangTx && (!associatedNote || !associatedNote.completed);

        t.items.forEach(item => {
          const key = item.sku || item.name;
          if (dayItems[key]) {
            dayItems[key].quantity += item.quantity;
            dayItems[key].total += item.quantity * item.price;
          } else {
            dayItems[key] = {
              sku: item.sku || '-',
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              total: item.quantity * item.price,
              isHutang: isStillHutang
            };
          }

          // Also aggregate for monthly recap
          const itemsInTx = new Set<string>();
          itemsInTx.add(key);
          if (monthlyItems[key]) {
            monthlyItems[key].quantity += item.quantity;
            monthlyItems[key].total += item.quantity * item.price;
          } else {
            monthlyItems[key] = {
              sku: item.sku || '-',
              name: item.name,
              quantity: item.quantity,
              total: item.quantity * item.price,
              transactionCount: 0
            };
          }
        });

        // Count unique transactions per item for recap
        const itemsInThisTx = new Set<string>();
        t.items.forEach(item => itemsInThisTx.add(item.sku || item.name));
        itemsInThisTx.forEach(key => {
          if (monthlyItems[key]) monthlyItems[key].transactionCount += 1;
        });
      });

      const itemsList = Object.values(dayItems).map(item => ({
        kode: item.sku,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
        totalFormatted: item.total.toLocaleString('id-ID'),
        isHutang: item.isHutang
      }));

      // Format date for display
      const displayDate = new Date(dateStr).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).replace(/\./g, '');

      // Collect for recap
      dailyVisitorsList.push({
        date: displayDate,
        before12: dayVisitors.before12,
        after12: dayVisitors.after12,
        lost: dayLost.length,
        lostList: dayLost
      });
      dayLost.forEach(desc => {
        allLostListForRecap.push({ date: displayDate, description: desc });
      });

      // Filter exchanges for this day
      const dayExchanges = allExchanges.filter(e => e.date.split('T')[0] === dateStr).map(e => {
        let purchaseDate = e.originalPurchaseDate;
        if (!purchaseDate && e.originalTransactionId) {
          const originalTrx = allTransactions.find(t => t.id === e.originalTransactionId);
          if (originalTrx) purchaseDate = originalTrx.date;
        }
        return {
          originalItem: e.originalItem,
          newItem: e.newItem,
          priceDifference: e.priceDifference || 0,
          originalPurchaseDate: purchaseDate,
          originalTransactionId: e.originalTransactionId,
          date: e.date,
          hargaLama: e.originalItem?.price || 0,
          hargaBaru: e.newItem?.price || 0
        };
      });

      // Filter refunds for this day
      const dayRefunds = allRefunds.filter(r => r.date.split('T')[0] === dateStr).map(r => {
        let pDate = r.originalPurchaseDate || r.purchaseDate;
        if (!pDate && r.transactionId) {
          const trx = allTransactions.find(t => t.id === r.transactionId);
          if (trx) pDate = trx.date;
        }
        let displayPDate = '-';
        if (pDate) {
          const isSameDay = r.date.split('T')[0] === pDate.split('T')[0];
          displayPDate = isSameDay ? "Di hari yg sama" : new Date(pDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
        }
        return {
          date: displayDate,
          kode: r.item?.sku || r.kode || '-',
          nama: r.item?.name || r.nama || '-',
          quantity: r.item?.quantity || r.quantity || 1,
          price: r.item?.price || r.price || 0,
          total: r.total || (r.item?.price * (r.item?.quantity || 1)) || 0,
          purchaseDate: displayPDate,
          jenis: 'REFUND'
        };
      });

      // Filter notes for this day
      const dayNotes = allNotes.filter(n => {
        const noteCreatedDate = n.date.split('T')[0];
        const completedDate = n.completedAt ? n.completedAt.split('T')[0] : null;
        if (noteCreatedDate > dateStr) return false;
        if (!n.completed) return true;
        if (completedDate && completedDate >= dateStr) return true;
        return false;
      }).map(n => {
        const completedDate = n.completedAt ? n.completedAt.split('T')[0] : null;
        const isCompletedOnThisDay = completedDate === dateStr;
        return {
          date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
          type: n.type,
          customerName: n.customerName || '-',
          content: n.content,
          amount: n.amount || 0,
          completed: isCompletedOnThisDay,
          completedAt: n.completedAt && isCompletedOnThisDay ? 'HARI INI' : (n.completedAt ? new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '') : null)
        };
      });

      // Build hutang array separately
      const dayHutang = allNotes.filter(n => {
        if (n.type !== 'hutang') return false;
        const creationDate = n.date.split('T')[0];
        const completionDate = n.completedAt ? n.completedAt.split('T')[0] : null;
        return (creationDate === dateStr) || (completionDate === dateStr) || (!n.completed);
      }).map(n => ({
        date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
        customerName: n.customerName || '-',
        content: n.content,
        amount: n.amount || 0,
        completed: n.completed || false,
        completedAt: n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI INI' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : null
      }));

      const dailyPayload = {
        date: displayDate,
        items: itemsList,
        refunds: dayRefunds,
        exchanges: dayExchanges,
        visitors: {
          before12: dayVisitors.before12,
          after12: dayVisitors.after12,
          total: dayVisitors.before12 + dayVisitors.after12,
          lost: dayLost.length,
          lostList: dayLost
        },
        notes: dayNotes,
        hutang: dayHutang,
        sendNotification: false
      };

      try {
        await fetch(currentConfig.gasUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dailyPayload)
        });
        successCount++;
        console.log(`[Historical] Sent data for ${dateStr}`);
      } catch (e) {
        console.error(`[Historical] Failed to send ${dateStr}:`, e);
        failCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // ═══════════════════════════════════════════
    // Step 3: Send Monthly Recap
    // ═══════════════════════════════════════════
    setHistoricalProgress("Mengirim rekap bulanan...");

    // Sort monthly items by quantity
    const sortedMonthlyItems = Object.values(monthlyItems)
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return b.total - a.total;
      })
      .map((item, idx) => ({
        rank: idx + 1,
        kode: item.sku,
        nama: item.name,
        quantity: item.quantity,
        transactionCount: item.transactionCount,
        totalSales: item.total
      }));

    // Format exchanges for recap
    const monthlyExchangesFormatted = allExchanges.map(e => {
      let purchaseDate = e.originalPurchaseDate;
      if (!purchaseDate && e.originalTransactionId) {
        const originalTrx = allTransactions.find(t => t.id === e.originalTransactionId);
        if (originalTrx) purchaseDate = originalTrx.date;
      }
      const exchangeDateStr = e.date ? new Date(e.date).toISOString().split('T')[0] : '';
      const purchaseDateStr = purchaseDate ? new Date(purchaseDate).toISOString().split('T')[0] : '';
      let tglBeli = '-';
      if (purchaseDate) {
        tglBeli = (purchaseDateStr === exchangeDateStr) ? 'Di hari yg sama' : new Date(purchaseDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
      }
      return {
        date: new Date(e.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        tglBeli,
        kode: e.originalItem?.sku || '-',
        nama: e.originalItem?.name || '-',
        quantity: e.originalItem?.quantity || 1,
        price: e.originalItem?.price || 0,
        totalRefund: e.priceDifference || 0,
        type: "EXCHANGE"
      };
    });

    // Format refunds for recap
    const monthlyRefundsFormatted = allRefunds.map(r => {
      let pDate = r.originalPurchaseDate || r.purchaseDate;
      const refundDateStr = r.date ? new Date(r.date).toISOString().split('T')[0] : '';
      const pDateStr = pDate ? new Date(pDate).toISOString().split('T')[0] : '';
      let tglBeli = '-';
      if (pDate) {
        tglBeli = (pDateStr === refundDateStr) ? 'Di hari yg sama' : new Date(pDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
      }
      return {
        date: new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        tglBeli,
        kode: r.item?.sku || r.kode || "-",
        nama: r.item?.name || r.nama || "-",
        quantity: r.item?.quantity || r.quantity || 1,
        price: r.item?.price || r.price || 0,
        totalRefund: r.total || 0,
        type: "REFUND"
      };
    });

    const combinedMonthlyRefunds = [...monthlyRefundsFormatted, ...monthlyExchangesFormatted];

    // Format notes for recap
    const monthlyNotes = allNotes.filter(n => {
      const noteDate = n.date.split('T')[0];
      if (n.type === 'hutang' && !n.completed) return true;
      return noteDate >= startOfMonth;
    }).map(n => ({
      date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
      type: n.type,
      customerName: n.customerName || '-',
      content: n.content,
      amount: n.amount || 0,
      completed: n.completed || false,
      completedAt: n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI YG SAMA' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : '-'
    }));

    // Hitung penjualan per kategori (berdasarkan prefix SKU)
    const historicalCategorySalesMap: Record<string, number> = {};
    completedTransactions.forEach(t => {
      t.items.forEach((item: any) => {
        const sku = (item.sku || '').toUpperCase();
        const prefix = sku.substring(0, 2);
        let category: string;
        switch (prefix) {
          case 'BA': category = 'BA'; break;
          case 'BG': category = 'BG'; break;
          case 'BK': category = 'BK'; break;
          case 'TL': category = 'TL'; break;
          case 'KG': category = 'KG'; break;
          case 'BT': category = 'BT'; break;
          default: category = 'NO KATEGORI'; break;
        }
        const itemTotal = item.quantity * item.price;
        historicalCategorySalesMap[category] = (historicalCategorySalesMap[category] || 0) + itemTotal;
      });
    });
    const historicalCategorySales = Object.entries(historicalCategorySalesMap)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    try {
      await fetch(currentConfig.gasUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "monthlyRecap",
          month: monthYear,
          items: sortedMonthlyItems,
          categorySales: historicalCategorySales, // NEW: Penjualan per kategori
          dailyVisitors: dailyVisitorsList,
          allLostList: allLostListForRecap,
          monthlyRefunds: combinedMonthlyRefunds,
          monthlyExchanges: monthlyExchangesFormatted,
          monthlyNotes: monthlyNotes,
          telegramBotToken: currentConfig.telegramBotToken,
          telegramChatId: currentConfig.telegramChatId,
        })
      });
      console.log("[Historical] Sent monthly recap for", monthYear);
    } catch (e) {
      console.error("[Historical] Failed to send monthly recap:", e);
    }

    setSendingHistorical(false);
    setHistoricalProgress("");
    alert(`✅ Data bulan ini berhasil dikirim ulang!\n\n📅 Bulan: ${monthYear}\n📊 ${dates.length} hari data dikirim\n✅ Sukses: ${successCount}${failCount > 0 ? `\n❌ Gagal: ${failCount}` : ''}\n\n🏆 Recap bulanan juga dikirim`);
  };

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Setting
        </h1>

        {/* Nama Toko */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Store className="h-5 w-5" />
              Nama Toko
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-xl font-bold text-primary">{profile.workshopName}</p>
              </div>
              <Button
                onClick={() => {
                  setNewStoreName(profile.workshopName);
                  setShowNameDialog(true);
                }}
                className="bg-amber-500 hover:bg-amber-600"
              >
                Ganti Nama
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Storage Monitor */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Monitor Penyimpanan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* IndexedDB Storage */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="flex items-center gap-2">
                    IndexedDB (Transaksi)
                    <span className="text-xs text-green-500 animate-pulse">● LIVE</span>
                  </span>
                  <span className="font-medium text-blue-600">
                    {formatBytes(dbStats.storageUsed)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="h-3 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min((dbStats.storageUsed / dbStats.storageQuota) * 100, 100) || 2}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{dbStats.storageUsed.toLocaleString()} bytes</span>
                  <span>Kuota: {formatBytes(dbStats.storageQuota)}</span>
                </div>
              </div>

              <Separator />

              {/* IndexedDB Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-600">{dbStats.itemCount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Item Terjual</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-blue-600">{dbStats.txCount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Transaksi</p>
                </div>
              </div>

              <Separator />

              {/* Cleanup buttons */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Hapus Transaksi Lama</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="col-span-2 bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700"
                    onClick={() => { setArchiveDays(-2); setArchiveBackupReady(false); setShowArchiveConfirm(true); }}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Sisakan Bulan Ini
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-700"
                    onClick={() => { setArchiveDays(-1); setArchiveBackupReady(false); setShowArchiveConfirm(true); }}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Sisakan Hari Ini
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => { setArchiveDays(0); setArchiveBackupReady(false); setShowArchiveConfirm(true); }}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Hapus Semua
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup & Restore */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Download className="h-5 w-5" />
              Backup & Restore
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={handleBackupProducts}
              className="w-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Backup Produk Saja
            </Button>
            <Button
              onClick={handleBackupAllData}
              className="w-full bg-green-500 hover:bg-green-600 flex items-center justify-center gap-2"
            >
              <Save className="h-4 w-4" />
              Backup Lengkap (Full)
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleRestoreFromFile();
                }
              }}
              className="hidden"
            />
            <Button
              onClick={triggerFileInput}
              variant="outline"
              className="w-full flex items-center justify-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Restore dari File
            </Button>
          </CardContent>
        </Card>



        {/* Multi-Toko Settings */}
        <Card className="mb-4 border-t-4 border-t-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-blue-500" />
              Koneksi Multi-Toko
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-bold text-blue-900">Konfigurasi Aktif:</p>
                  <div className="space-y-1 mt-1">
                    <p className="text-[10px] text-blue-600 font-mono break-all leading-tight">
                      <span className="font-bold">UTAMA:</span> {config.gasUrl || '-'}
                    </p>
                    <p className="text-[10px] text-orange-600 font-mono break-all leading-tight">
                      <span className="font-bold">PRODUK:</span> {config.productGasUrl || '- (belum dikonfigurasi)'}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                onClick={() => {
                  const c = getConfig();
                  setTempGasUrl(c.gasUrl);
                  setTempProductGasUrl(c.productGasUrl);
                  setTempBotToken(c.telegramBotToken);
                  setTempChatId(c.telegramChatId);
                  setTempAutoSendEnabled(c.autoSendEnabled);
                  setTempAutoSendTimes(c.autoSendTimes);
                  setSettingsOpen(true);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
              >
                Ubah Koneksi Toko
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ⚠️ Gunakan fitur ini jika Anda ingin mengalihkan aplikasi ke Google Sheets atau Telegram Toko lain.
            </p>
          </CardContent>
        </Card>

        {/* Refresh Aplikasi - Hard Reset Cache */}
        <Card className="mb-4 border-orange-200 bg-orange-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-orange-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              Refresh Aplikasi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  Update ke versi terbaru tanpa kehilangan data
                </p>
              </div>
              <Button
                onClick={async () => {
                  const confirmed = window.confirm(
                    "🔄 Refresh Aplikasi?\n\n" +
                    "Ini akan:\n" +
                    "✅ Menghapus cache aplikasi\n" +
                    "✅ Memuat ulang dengan versi terbaru\n\n" +
                    "Data Anda (produk, transaksi, dll) tetap AMAN.\n\n" +
                    "Lanjutkan?"
                  );

                  if (!confirmed) return;

                  try {
                    // 1. Unregister all service workers
                    if ('serviceWorker' in navigator) {
                      const registrations = await navigator.serviceWorker.getRegistrations();
                      for (const registration of registrations) {
                        await registration.unregister();
                        console.log('[Refresh] Service Worker unregistered');
                      }
                    }

                    // 2. Clear all caches
                    if ('caches' in window) {
                      const cacheNames = await caches.keys();
                      for (const cacheName of cacheNames) {
                        await caches.delete(cacheName);
                        console.log('[Refresh] Cache deleted:', cacheName);
                      }
                    }

                    // 3. Force reload from server (bypass cache)
                    alert("✅ Cache berhasil dihapus!\n\nAplikasi akan dimuat ulang...");
                    window.location.reload();

                  } catch (error) {
                    console.error('[Refresh] Error:', error);
                    alert("Gagal refresh. Coba refresh manual dengan Ctrl+Shift+R");
                  }
                }}
                className="bg-orange-500 hover:bg-orange-600"
              >
                🔄 Refresh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              💡 Gunakan ini jika aplikasi tidak update atau ada bug setelah update.
            </p>
          </CardContent>
        </Card>

        {/* Version Info */}
        <div className="mt-8 mb-4 text-center">
          <p className="text-xs text-muted-foreground font-medium opacity-50">
            APLIKASI TOKO BAUT - V11
          </p>
        </div>
      </div>

      {/* Change Store Name Dialog */}
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ganti Nama Toko</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="storeName">Nama Toko Baru</Label>
              <Input
                id="storeName"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="Masukkan nama toko..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNameDialog(false)}>
              Batal
            </Button>
            <Button
              onClick={handleSaveStoreName}
              className="bg-amber-500 hover:bg-amber-600"
            >
              <Save className="h-4 w-4 mr-2" />
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog - Step 1 */}
      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveDays === 0 ? "⚠️ Hapus SEMUA Transaksi & Data Operasional?" :
                archiveDays === -2 ? "🗑️ Sisakan Transaksi Bulan Ini?" :
                  archiveDays === -1 ? "🗑️ Hapus Kecuali Hari Ini?" :
                    `Hapus Transaksi > ${archiveDays} Hari?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveDays === 0 ? (
                <>
                  <span className="text-red-600 font-bold">PERINGATAN: </span>
                  Tindakan ini akan menghapus SEMUA transaksi, catatan, daftar hutang, visitor log, data tukar/refund, dan catatan pembelian.
                  <br /><br />
                  Produk dan stok tetap tersimpan, tetapi data TIDAK BISA dikembalikan!
                </>
              ) : archiveDays === -2 ? (
                <>
                  Tindakan ini akan menghapus semua transaksi <span className="font-bold">sebelum bulan ini</span>.
                  <br /><br />
                  Stok tidak diubah dan catatan terkait tetap tersimpan.
                </>
              ) : archiveDays === -1 ? (
                <>
                  Tindakan ini akan menghapus semua transaksi <span className="font-bold">KECUALI hari ini</span>.
                </>
              ) : (
                <>
                  Tindakan ini akan menghapus transaksi yang lebih dari {archiveDays} hari.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="mb-2 text-sm font-medium text-blue-900">
              Backup wajib sebelum melanjutkan penghapusan.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full border-blue-300 bg-white text-blue-700 hover:bg-blue-100"
              disabled={archiveBackupInProgress || archiveBackupReady}
              onClick={async () => {
                if (archiveBackupInProgress || archiveBackupReady) return;
                setArchiveBackupInProgress(true);
                try {
                  await backupAllDataToFile();
                  setArchiveBackupReady(true);
                  alert("✅ Backup Full berhasil di-download. Tombol Lanjutkan sekarang aktif.");
                } catch (error: any) {
                  console.error("Archive backup error:", error);
                  alert(`❌ Backup gagal: ${error?.message || "Gagal membuat backup lengkap"}. Penghapusan dibatalkan.`);
                } finally {
                  setArchiveBackupInProgress(false);
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              {archiveBackupInProgress ? "Menyiapkan Backup..." : archiveBackupReady ? "Backup Full Sudah Di-download" : "Backup Full & Download"}
            </Button>
            {!archiveBackupReady && (
              <p className="mt-2 text-xs text-blue-700">
                Klik tombol ini untuk mengunduh salinan data sebelum menghapus transaksi.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={!archiveBackupReady}
              onClick={() => {
                setShowArchiveConfirm(false);
                setShowArchiveStep2(true);
              }}
              className={archiveDays === 0 ? "bg-red-500 hover:bg-red-600" : "bg-orange-500 hover:bg-orange-600"}
            >
              Lanjutkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Confirmation Dialog - Step 2 */}
      <AlertDialog open={showArchiveStep2} onOpenChange={setShowArchiveStep2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🔴 KONFIRMASI TERAKHIR</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini TIDAK BISA dibatalkan. Yakin ingin melanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  const result = await archiveOldTransactions(archiveDays);

                  if (archiveDays === 0) {
                    // Operational reset - reload page
                    alert(`✅ Data operasional berhasil dibersihkan!\n${result.archived.toLocaleString()} transaksi dihapus.\n\nProduk dan stok tetap tersimpan.\nHalaman akan dimuat ulang.`);
                    window.location.reload();
                  } else {
                    alert(`✅ Berhasil menghapus ${result.archived.toLocaleString()} transaksi.\nTersisa ${result.remaining.toLocaleString()} transaksi.`);
                    setStorageInfo(getStorageInfo());
                    getTransactionStats().then(stats => setTxStats(stats));
                    // Refresh IndexedDB stats
                    const txCount = await getTransactionsCount();
                    const allTx = await getAllTransactions();
                    const itemCount = allTx.reduce((sum: number, t: any) => sum + (t.items?.length || 0), 0);
                    setDbStats(prev => ({ ...prev, txCount, itemCount }));
                    setShowArchiveStep2(false);
                  }
                } catch (error: any) {
                  console.error("Archive transactions error:", error);
                  setShowArchiveStep2(false);
                  alert(`❌ Gagal menghapus transaksi: ${error?.message || "Terjadi kesalahan penyimpanan"}`);
                }
              }}
              className={archiveDays === 0 ? "bg-red-600 hover:bg-red-700" : "bg-orange-500 hover:bg-orange-600"}
            >
              {archiveDays === 0 ? "YA, HAPUS DATA OPERASIONAL" : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-bold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                URL GAS Laporan & Transaksi
              </label>
              <div className="flex gap-2">
                <Input
                  value={tempGasUrl}
                  onChange={(e) => setTempGasUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="text-xs font-mono flex-1"
                  autoUppercase={false}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs px-2 h-9"
                  onClick={async () => {
                    if (!tempGasUrl) return alert("Masukkan URL dulu");

                    // Validate URL format
                    const urlLower = tempGasUrl.toLowerCase().trim();
                    if (!urlLower.startsWith("https://script.google.com/macros/s/")) {
                      return alert("❌ Format URL salah!\n\nURL harus dimulai dengan:\nhttps://script.google.com/macros/s/...");
                    }
                    if (!urlLower.endsWith("/exec")) {
                      return alert("❌ URL bukan link deployment!\n\nURL harus diakhiri dengan '/exec'\n\nAnda mungkin meng-copy link editor. Gunakan link dari Deploy > New Deployment.");
                    }

                    // Try no-cors fetch (will succeed if network is OK, even though we can't read response)
                    try {
                      await fetch(tempGasUrl, { method: "GET", mode: "no-cors" });
                      alert("✅ Format URL Valid & Server Terjangkau!\n\nURL sudah benar dan Google bisa diakses.\n\nSilakan Simpan dan coba Kirim Penjualan.");
                    } catch (e) {
                      alert("❌ Gagal mengakses server Google.\n\nPastikan:\n1. Koneksi internet aktif\n2. URL sudah benar\n\nError: " + e);
                    }
                  }}
                >
                  Cek
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">URL deployment dari gas-report-transactions.gs untuk laporan penjualan dan rekap.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                URL GAS Database Produk
              </label>
              <div className="flex gap-2">
                <Input
                  value={tempProductGasUrl}
                  onChange={(e) => setTempProductGasUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="text-xs font-mono flex-1 border-orange-200 focus-visible:ring-orange-500"
                  autoUppercase={false}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs px-2 h-9 border-orange-200 text-orange-600"
                  onClick={async () => {
                    if (!tempProductGasUrl) return alert("Masukkan URL dulu");

                    const urlLower = tempProductGasUrl.toLowerCase().trim();
                    if (!urlLower.startsWith("https://script.google.com/macros/s/")) {
                      return alert("❌ Format URL salah!");
                    }
                    if (!urlLower.endsWith("/exec")) {
                      return alert("❌ URL bukan link deployment!");
                    }

                    try {
                      // Mengirim perintah untuk setup sheet & header secara otomatis
                      await fetch(tempProductGasUrl + "?action=setupProductSheet", { method: "GET", mode: "no-cors" });
                      alert("✅ Database Produk Berhasil Disiapkan!\n\nSistem telah meminta script membuat sheet:\n• BA\n• BG\n• BK\n• KG\n• TL\n• BT (BAUT TRUCK)\n• NO KATEGORI (kode asing)\n• ALL PRODUK\n• MASTER\n\nSilakan cek Spreadsheet Database Produk Anda. Jika belum berubah, pastikan URL ini adalah deployment gas-product-database.gs dan cek menu Executions di Apps Script.");
                    } catch (e) {
                      alert("❌ Gagal mengakses server Google.");
                    }
                  }}
                >
                  Cek
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Gunakan URL deployment dari gas-product-database.gs. Jangan dikosongkan agar sinkronisasi produk memakai database kategori yang benar.</p>

              {/* Tombol Upload Semua Produk ke Sheet */}
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-2 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                disabled={uploadingProducts}
                onClick={async () => {
                  // Gunakan config yg sudah tersimpan, BUKAN temp input dialog
                  const currentConfig = getConfig();
                  const targetUrl = currentConfig.productGasUrl.trim();
                  if (!targetUrl) {
                    return alert("❌ URL GAS Database Produk belum dikonfigurasi!\n\nIsi URL GAS Database Produk lalu klik SIMPAN terlebih dahulu.");
                  }

                  // Ambil data produk dari cache
                  const products: Product[] = getCachedProducts() as Product[];
                  if (products.length === 0) {
                    return alert("❌ Tidak ada data produk di aplikasi untuk di-upload.");
                  }

                  // Konfirmasi
                  const confirmed = window.confirm(
                    `⚠️ UPLOAD PRODUK KE SHEET\n\n` +
                    `Akan mengirim ${products.length} produk SEKALIGUS ke Google Sheet.\n` +
                    `Data yang sudah ada di Sheet akan di-REPLACE (timpa).\n\n` +
                    `URL Target:\n${targetUrl.substring(0, 60)}...\n\n` +
                    `Lanjutkan?`
                  );
                  if (!confirmed) return;

                  setUploadingProducts(true);
                  setUploadProgress(`📤 Mengirim ${products.length} produk...`);

                  try {
                    // Kirim semua produk dalam 1x request (BULK)
                    const allProducts = products.map(p => ({
                      kode: (p.sku || p.id || "").trim().toUpperCase(),
                      nama: p.name,
                      hargaBeli: Number(p.purchasePrice) || 0,
                      hargaJual: Number(p.price) || 0,
                      // Stok boleh negatif; jangan gunakan Math.max(..., 0).
                      stok: Number(p.stock) || 0,
                    }));

                    const invalidProducts = allProducts.filter(p =>
                      !p.kode || p.kode === '-' || !p.nama ||
                      p.hargaBeli < 0 || p.hargaJual < 0 || !Number.isFinite(p.stok)
                    );
                    if (invalidProducts.length > 0) {
                      throw new Error(`${invalidProducts.length} produk memiliki KODE/nama kosong, harga tidak valid, atau stok bukan angka.`);
                    }
                    const uploadSkus = new Set<string>();
                    for (const product of allProducts) {
                      if (uploadSkus.has(product.kode)) {
                        throw new Error(`SKU duplikat: ${product.kode}`);
                      }
                      uploadSkus.add(product.kode);
                    }

                    const response = await fetch(targetUrl, {
                      method: "POST",
                      // GAS product endpoint menerima simple request agar response bisa dibaca.
                      headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify({
                        action: "bulkUpdateProducts",
                        products: allProducts,
                      }),
                    });

                    if (!response.ok) {
                      throw new Error(`Server mengembalikan status ${response.status}`);
                    }
                    const result = await response.json();
                    if (result.success !== true) {
                      throw new Error(result.error || "Server menolak upload");
                    }

                    alert(
                      `✅ Upload Berhasil!\n\n` +
                      `${result.total || products.length} produk ditulis ke MASTER dan diproses ke sheet kategori.\n` +
                      `Data lokal tetap tersimpan di aplikasi.`
                    );
                  } catch (err) {
                    alert(`❌ Upload gagal. Data lokal tidak diubah.\n\n${err instanceof Error ? err.message : String(err)}\n\nPastikan URL GAS Database Produk mengarah ke gas-product-database.gs dan deployment sudah diperbarui.`);
                  }

                  setUploadingProducts(false);
                  setUploadProgress("");
                }}
              >
                {uploadingProducts ? (
                  <>{uploadProgress}</>
                ) : (
                  <>📤 Upload Semua Produk ke Sheet ({getCachedProducts().length} produk)</>
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Telegram Bot Token
              </label>
              <Input
                value={tempBotToken}
                onChange={(e) => setTempBotToken(e.target.value)}
                placeholder="8272134859:AAFShI..."
                className="text-xs font-mono"
                autoUppercase={false}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Telegram Chat ID (Channel/Grup)
              </label>
              <div className="flex gap-2">
                <Input
                  value={tempChatId}
                  onChange={(e) => setTempChatId(e.target.value)}
                  placeholder="-100..."
                  className="text-xs font-mono flex-1"
                  autoUppercase={false}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs px-2 h-9"
                  onClick={async () => {
                    if (!tempBotToken || !tempChatId) {
                      return alert("Isi Bot Token dan Chat ID terlebih dahulu");
                    }

                    try {
                      const testMessage = `✅ *Tes Koneksi Berhasil!*

🏪 Toko: ${profile.workshopName || 'GoldenPOS'}
📅 Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}

_Pesan ini dikirim untuk memverifikasi koneksi Telegram._`;

                      const url = `https://api.telegram.org/bot${tempBotToken}/sendMessage`;
                      const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: tempChatId,
                          text: testMessage,
                          parse_mode: 'Markdown'
                        })
                      });

                      const result = await response.json();

                      if (result.ok) {
                        alert("✅ Telegram berhasil!\n\nPesan tes sudah terkirim ke channel/grup Anda.");
                      } else {
                        alert(`❌ Gagal kirim ke Telegram!\n\nError: ${result.description || 'Unknown error'}\n\nPastikan:\n1. Bot Token benar\n2. Chat ID benar (dengan tanda minus untuk grup/channel)\n3. Bot sudah ditambahkan ke grup/channel tersebut`);
                      }
                    } catch (e) {
                      alert(`❌ Gagal koneksi ke Telegram!\n\nError: ${e}\n\nPastikan koneksi internet aktif.`);
                    }
                  }}
                >
                  Tes
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">ID grup/channel dimulai dengan -100...</p>
            </div>

            <div className="space-y-4 pt-2 border-t mt-4">
              <label className="text-sm font-bold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Auto Kirim Penjualan (Otomatis)
              </label>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Aktifkan Auto Kirim</p>
                  <p className="text-[10px] text-muted-foreground">
                    Aplikasi akan otomatis mengirim data penjualan pada jam yang ditentukan
                  </p>
                </div>
                <Switch
                  checked={tempAutoSendEnabled}
                  onCheckedChange={setTempAutoSendEnabled}
                />
              </div>

              {tempAutoSendEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs">Waktu Kirim (Pisahkan dengan koma)</Label>
                  <Input
                    value={tempAutoSendTimes}
                    onChange={(e) => setTempAutoSendTimes(e.target.value)}
                    placeholder="Contoh: 15:00, 21:00"
                    className="text-xs font-mono"
                    autoUppercase={false}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Format 24 jam. Contoh: "09:00, 15:30, 21:00". <br />
                    <strong className="text-red-500">Penting:</strong> Aplikasi harus dalam keadaan terbuka agar auto kirim berjalan.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons Section */}
          <div className="pt-4 border-t border-dashed mt-4 space-y-2">
            <Button
              variant="outline"
              className="w-full border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={sendingHistorical}
              onClick={() => {
                const now = new Date();
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
                const monthYear = monthNames[now.getMonth()] + " " + now.getFullYear();
                if (confirm(`Kirim ulang seluruh data bulan ${monthYear} ke Google Sheets?\n\n⚠️ Sheet Harian & Recap bulan ini akan di-RESET lalu ditulis ulang dari awal.\n\nLanjutkan?`)) {
                  sendAllHistoricalData();
                }
              }}
            >
              {sendingHistorical ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  <span>{historicalProgress || "Mengirim..."}</span>
                </>
              ) : (
                <>
                  <Calendar className="h-4 w-4 mr-2" />
                  Kirim Ulang Data Bulan Ini
                </>
              )}
            </Button>

            <Button
              variant="outline"
              className="w-full border-red-300 text-red-700 hover:bg-red-50"
              onClick={async () => {
                if (!confirm("Reset Spreadsheet?\n\nSheet 'Harian' akan dikosongkan total.\nSheet 'Recap' akan di-reset dengan struktur tabel kosong.")) {
                  return;
                }

                const currentConfig = getConfig();
                const now = new Date();
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
                const monthYear = monthNames[now.getMonth()] + " " + now.getFullYear();

                try {
                  await fetch(currentConfig.gasUrl, {
                    method: "POST",
                    mode: "no-cors",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "resetSheets",
                      secretKey: "zaky12345",
                      month: monthYear
                    })
                  });

                  alert(`✅ Reset berhasil!\n\n• Harian ${monthYear} → Kosong bersih\n• Recap ${monthYear} → Struktur tabel kosong`);
                } catch (e) {
                  alert(`❌ Gagal: ${e}`);
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Reset Spreadsheet
            </Button>
          </div>

          <DialogFooter className="sm:justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Reset ke pengaturan default?")) {
                  localStorage.removeItem(LS_KEYS.GAS_URL);
                  localStorage.removeItem(LS_KEYS.PRODUCT_GAS_URL);
                  localStorage.removeItem(LS_KEYS.TELEGRAM_BOT_TOKEN);
                  localStorage.removeItem(LS_KEYS.TELEGRAM_CHAT_ID);
                  localStorage.removeItem(LS_KEYS.AUTO_SEND_SALES_ENABLED);
                  localStorage.removeItem(LS_KEYS.AUTO_SEND_SALES_TIMES);
                  const def = getConfig();
                  setTempGasUrl(def.gasUrl);
                  setTempProductGasUrl(def.productGasUrl);
                  setTempBotToken(def.telegramBotToken);
                  setTempChatId(def.telegramChatId);
                  setTempAutoSendEnabled(def.autoSendEnabled);
                  setTempAutoSendTimes(def.autoSendTimes);
                  setConfig(def);
                  alert("Pengaturan direset ke default.");
                }
              }}
            >
              Reset Default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Batal</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  saveToLS(LS_KEYS.GAS_URL, tempGasUrl.trim());
                  saveToLS(LS_KEYS.PRODUCT_GAS_URL, tempProductGasUrl.trim());
                  saveToLS(LS_KEYS.TELEGRAM_BOT_TOKEN, tempBotToken.trim());
                  saveToLS(LS_KEYS.TELEGRAM_CHAT_ID, tempChatId.trim());
                  saveToLS(LS_KEYS.AUTO_SEND_SALES_ENABLED, tempAutoSendEnabled);
                  saveToLS(LS_KEYS.AUTO_SEND_SALES_TIMES, tempAutoSendTimes.trim());

                  const updatedConfig = getConfig();
                  setConfig(updatedConfig);

                  // Trigger event to notify App layout
                  window.dispatchEvent(new CustomEvent('configUpdated'));

                  setSettingsOpen(false);
                  alert("Pengaturan berhasil disimpan!");
                }}
              >
                Simpan
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfilePage;
