import React, { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowUpRight,
  Package,
  ShoppingCart,
  AlertTriangle,
  Plus,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  Trash2,
  Pencil,
  StickyNote,
  Check,
  X,
  Bell,
  ChevronDown,
  Wifi,
  WifiOff,
  ArrowDown,
  ArrowUp,
  Users,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";

import { formatCurrency, getFromLS, LS_KEYS, getStoreName, getConfig, saveToLS } from "@/lib/utils";
import { getProducts as getCachedProducts } from "@/lib/productCache";
import { safeGetAllTransactions, safeInitAndMigrate, getAllTransactions } from "@/lib/indexedDB";
import { getDailyStatsInRange, addVisitor, addVisitorLost, getVisitorStatsByDate, getLostDescriptionsByDate, removeLastVisitor, removeLastLost, getLostEntriesByDate, removeLostByTimestamp, updateLostDescription, VisitorLostLog, getVisitorStatsByTime, addVisitorBefore12, addVisitorAfter12, removeVisitorBefore12, removeVisitorAfter12 } from "@/lib/visitors";
import { getRefunds, getExchanges } from "@/lib/exchange";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as XLSX from "xlsx-js-style";
import { getNotes, getActiveNotes, getActiveNotesCount, addNote, completeNote, deleteNote, updateNote, Note, getActiveHutang, getTotalHutangAmount, clearNotes, clearHutang } from "@/lib/notes";

interface Transaction {
  id: string;
  date: string;
  customer: string;
  total: number;
  status: "completed" | "pending" | "cancelled" | "refunded";
  items: {
    name: string;
    quantity: number;
    price: number;
    type: "product" | "service";
    purchasePrice?: number;
    sku?: string;
  }[];
  offlineCreated?: boolean;
  paymentMethod?: string;
  isHutang?: boolean;
}


interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  type: "product" | "service";
  stock?: number;
  threshold?: number;
  purchasePrice?: number;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [visitorToday, setVisitorToday] = useState(0);
  const [visitorLostToday, setVisitorLostToday] = useState(0);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostDesc, setLostDesc] = useState("");
  const [lostDescriptions, setLostDescriptions] = useState<string[]>([]);
  const [lostManageOpen, setLostManageOpen] = useState(false);
  const [lostEntries, setLostEntries] = useState<VisitorLostLog[]>([]);
  const [editingLostTs, setEditingLostTs] = useState<number | null>(null);
  const [editingLostDesc, setEditingLostDesc] = useState("");
  const [visitorBefore12, setVisitorBefore12] = useState(0);
  const [visitorAfter12, setVisitorAfter12] = useState(0);
  const [visitorYesterday, setVisitorYesterday] = useState(0);
  const [avgVisitorMonth, setAvgVisitorMonth] = useState(0);
  const [soldItemsPage, setSoldItemsPage] = useState(1);
  const [sendingToSheets, setSendingToSheets] = useState(false);
  const [sheetsSent, setSheetsSent] = useState(false);
  const [successPopupOpen, setSuccessPopupOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [soldItemsPeriod, setSoldItemsPeriod] = useState<"today" | "week" | "month">("today");

  // Notes/Reminder states
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false);
  const [activeNotesCount, setActiveNotesCount] = useState(0);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newNoteType, setNewNoteType] = useState<Note['type']>("pengingat");
  const [newNoteCustomerName, setNewNoteCustomerName] = useState("");
  const [newNoteAmount, setNewNoteAmount] = useState("");
  const [confirmCompleteNoteId, setConfirmCompleteNoteId] = useState<string | null>(null);
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [showCompletedNotes, setShowCompletedNotes] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Hutang specific states
  const [hutangDialogOpen, setHutangDialogOpen] = useState(false);
  const [activeHutangCount, setActiveHutangCount] = useState(0);
  const [totalHutangAmount, setTotalHutangAmount] = useState(0);
  const [confirmCompleteHutangId, setConfirmCompleteHutangId] = useState<string | null>(null);
  const [confirmDeleteHutangId, setConfirmDeleteHutangId] = useState<string | null>(null);


  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [showSystemLog, setShowSystemLog] = useState(false);
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 100, usedPercent: 0 });

  // Update storage info
  const updateStorageInfo = async () => {
    try {
      const { getStorageEstimate } = await import('@/lib/indexedDB');
      const info = await getStorageEstimate();
      setStorageInfo(info);
    } catch (e) {
      console.error("Failed to get storage info", e);
    }
  };

  useEffect(() => {
    if (showSystemLog) {
      updateStorageInfo();
    }
  }, [showSystemLog, transactions]);

  // Calculate pending transactions for today relative to last sync
  const lastSyncTimeStrLocal = localStorage.getItem('sheets_last_sent_time');
  const lastSyncTimeLocal = lastSyncTimeStrLocal ? new Date(lastSyncTimeStrLocal).getTime() : 0;
  const todayStrLocal = new Date().toISOString().split('T')[0];

  const unsyncedToday = transactions.filter(t => {
    const trxDate = t.date || (t as any).soldAt;
    if (!trxDate) return false;
    const isToday = trxDate.startsWith(todayStrLocal);
    const trxTime = new Date(trxDate).getTime();
    return isToday && trxTime > lastSyncTimeLocal;
  });

  const pendingCount = unsyncedToday.length;
  const pendingQueueCount = unsyncedToday.filter(t => t.offlineCreated && !isOnline).length;
  const readyToSendCount = unsyncedToday.filter(t => !t.offlineCreated || (t.offlineCreated && isOnline)).length;
  const pendingItemCount = unsyncedToday.reduce((acc, t) => {
    const items = t.items || [];
    return acc + items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, 0);

  const syncedToday = transactions.filter(t => {
    const trxDate = t.date || (t as any).soldAt;
    if (!trxDate) return false;
    const isToday = trxDate.startsWith(todayStrLocal);
    const trxTime = new Date(trxDate).getTime();
    return isToday && trxTime <= lastSyncTimeLocal;
  });

  const syncedCount = syncedToday.length;
  const syncedItemCount = syncedToday.reduce((acc, t) => {
    const items = t.items || [];
    return acc + items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, 0);

  // Load from IndexedDB and localStorage
  const refreshData = async () => {
    // Initialize and migrate from localStorage if needed
    await safeInitAndMigrate();

    // Get transactions from IndexedDB
    const storedTransactions = await safeGetAllTransactions();
    const storedProducts = getCachedProducts() as Product[];
    setTransactions(storedTransactions as Transaction[]);
    setProducts(storedProducts);

    // Low stock
    const lowStock = storedProducts
      .filter(p => p.type === "product" && p.stock !== undefined && p.threshold !== undefined)
      .filter(p => (p.stock || 0) < (p.threshold || 5))
      .map(p => ({
        id: p.id,
        name: p.name,
        stock: p.stock || 0,
        threshold: p.threshold || 5,
        percentage: Math.min(Math.round(((p.stock || 0) / (p.threshold || 5)) * 100), 100),
      }))
      .slice(0, 3);
    setLowStockItems(lowStock);
  };

  useEffect(() => {
    refreshData();

    // Listen for transaction updates from other pages
    const handleTransactionUpdate = () => refreshData();
    window.addEventListener('pos:transaction:complete', handleTransactionUpdate);
    window.addEventListener('storage', handleTransactionUpdate);

    // Also refresh when page becomes visible (user comes back from POS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pos:transaction:complete', handleTransactionUpdate);
      window.removeEventListener('storage', handleTransactionUpdate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Visitor stats today, yesterday, and monthly average
  useEffect(() => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const { visitors, lost } = getVisitorStatsByDate(todayStr);
    const { before12, after12 } = getVisitorStatsByTime(todayStr);
    setVisitorToday(visitors);
    setVisitorLostToday(lost);
    setLostDescriptions(getLostDescriptionsByDate(todayStr));
    setVisitorBefore12(before12);
    setVisitorAfter12(after12);

    // Yesterday's visitors
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const { visitors: yesterdayVisitors } = getVisitorStatsByDate(yesterdayStr);
    setVisitorYesterday(yesterdayVisitors);

    // Monthly average - calculate from day 1 of current month to today
    const year = today.getFullYear();
    const month = today.getMonth();
    const dayOfMonth = today.getDate();
    let totalMonthVisitors = 0;
    let daysWithData = 0;

    for (let day = 1; day <= dayOfMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const { visitors: dayVisitors } = getVisitorStatsByDate(dateStr);
      if (dayVisitors > 0) {
        totalMonthVisitors += dayVisitors;
        daysWithData++;
      }
    }

    const avg = daysWithData > 0 ? Math.round(totalMonthVisitors / daysWithData) : 0;
    setAvgVisitorMonth(avg);
  }, [transactions]);

  // Auto-complete old notes (catatan & belanja) on app load
  // Hutang tetap pending sampai dilunasi manual
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const allNotes = getNotes();
    let changed = false;
    allNotes.forEach((n) => {
      // Skip hutang - harus dilunasi manual
      if (n.type === 'hutang') return;
      // Skip yang sudah completed
      if (n.completed) return;
      // Jika catatan dari kemarin atau lebih lama, auto-complete
      const creationDate = n.date.split('T')[0];
      if (creationDate < todayStr) {
        completeNote(n.id);
        changed = true;
      }
    });
    if (changed) {
      // Refresh notes list setelah auto-complete
      setNotesList(getNotes());
    }
    setActiveNotesCount(getActiveNotesCount());
  }, [transactions]);

  // Refresh notes list
  const refreshNotes = () => {
    const notes = getNotes();
    setNotesList(notes);
    setActiveNotesCount(getActiveNotesCount());
  };

  // Refresh hutang list
  const refreshHutang = () => {
    const activeHutang = getActiveHutang();
    setActiveHutangCount(activeHutang.length);
    setTotalHutangAmount(getTotalHutangAmount());
    refreshNotes(); // Also refresh notes to get the list
  };

  // Load hutang count on mount
  useEffect(() => {
    refreshHutang();
  }, [transactions]);

  // Handle add/edit note
  const handleSaveNote = () => {
    if (!newNoteContent.trim()) return;

    // Parse amount - remove dots for thousand separator
    const parsedAmount = newNoteAmount ? parseInt(newNoteAmount.replace(/\./g, '')) : undefined;

    if (editNoteId) {
      // Edit mode
      updateNote(editNoteId, {
        content: newNoteContent.trim(),
        type: newNoteType,
        customerName: newNoteType === 'hutang' ? newNoteCustomerName.trim() : undefined,
        amount: (newNoteType === 'hutang' || newNoteType === 'belanja') && parsedAmount ? parsedAmount : undefined,
        editedAt: new Date().toISOString()
      });
      setEditNoteId(null);
    } else {
      // Add mode
      addNote({
        date: new Date().toISOString(),
        content: newNoteContent.trim(),
        type: newNoteType,
        customerName: newNoteType === 'hutang' ? newNoteCustomerName.trim() : undefined,
        amount: (newNoteType === 'hutang' || newNoteType === 'belanja') && parsedAmount ? parsedAmount : undefined,
        priority: 'normal'
      });
    }

    // Reset form
    setNewNoteContent("");
    setNewNoteCustomerName("");
    setNewNoteAmount("");
    setNewNoteType("hutang");
    setAddNoteDialogOpen(false);
    refreshNotes();
    setNotesDialogOpen(true);
    setEditNoteId(null);
  };

  // Handle start editing note
  const handleStartEditNote = (note: Note) => {
    setEditNoteId(note.id);
    setNewNoteType(note.type);
    setNewNoteContent(note.content);
    setNewNoteCustomerName(note.customerName || "");
    setNewNoteAmount(note.amount ? note.amount.toLocaleString('id-ID') : "");
    setNotesDialogOpen(false);
    setAddNoteDialogOpen(true);
  };

  // Handle complete note
  const handleCompleteNote = (id: string) => {
    completeNote(id);
    setConfirmCompleteNoteId(null);
    refreshNotes();
    // Keep notes dialog open
    setNotesDialogOpen(true);
  };

  // Handle delete note
  const handleDeleteNote = (id: string) => {
    deleteNote(id);
    refreshNotes();
    // Keep notes dialog open
    setNotesDialogOpen(true);
  };

  // Daily sales
  const today = new Date().toISOString().split("T")[0];
  const todayTransactions = transactions.filter(
    t => t.date.includes(today) && t.status !== "refunded" && t.status !== "cancelled",
  );
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayTransactions = transactions.filter(
    t => t.date.includes(yesterdayStr) && t.status !== "refunded" && t.status !== "cancelled",
  );
  const todayTotal = todayTransactions.reduce((s, t) => s + t.total, 0);
  const yesterdayTotal = yesterdayTransactions.reduce((s, t) => s + t.total, 0);
  let percentageIncrease = 0;
  if (yesterdayTotal > 0) percentageIncrease = Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100);
  else if (todayTotal > 0) percentageIncrease = 100;

  // Today's item summary by SKU prefix (TL, BG, BA, etc.) - Frequency based (per transaction)
  const todayItemSummaryArr = (() => {
    const summary: Record<string, number> = {};
    todayTransactions.forEach(t => {
      const prefixesInTx = new Set<string>();
      t.items.forEach(item => {
        const sku = item.sku || "";
        const prefix = sku.split("-")[0].toUpperCase();
        if (prefix && prefix.length >= 2) {
          prefixesInTx.add(prefix);
        }
      });
      prefixesInTx.forEach(p => {
        summary[p] = (summary[p] || 0) + 1;
      });
    });

    const sortOrder = ["BG", "BA", "TL", "KG", "BK", "BT", "NO KATEGORI"];
    return Object.entries(summary)
      .map(([prefix, count]) => ({ prefix, qty: count }))
      .sort((a, b) => {
        const idxA = sortOrder.indexOf(a.prefix);
        const idxB = sortOrder.indexOf(b.prefix);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.prefix.localeCompare(b.prefix);
      });
  })();

  const dailySales = {
    total: todayTotal,
    transactions: todayTransactions.length,
    itemSummary: todayItemSummaryArr,
    percentageIncrease,
  };

  // 7-day and 30-day visitors
  const toStr = (d: Date) => d.toISOString().split("T")[0];
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 6);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 29);
  const rows7 = getDailyStatsInRange(toStr(d7), toStr(now));
  const rows30 = getDailyStatsInRange(toStr(d30), toStr(now));
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const buildPoints = (rows: { visitors: number; lost: number }[], key: 'visitors' | 'lost', w = 140, h = 40) => {
    const data = rows.map(r => r[key]);
    const max = Math.max(1, ...data);
    const stepX = data.length > 1 ? (w - 4) / (data.length - 1) : 0;
    return data.map((v, i) => (2 + i * stepX).toFixed(2) + "," + (h - 2 - (v / max) * (h - 6)).toFixed(2)).join(" ");
  };

  const recentTransactions = transactions
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)
    .map(t => ({
      id: t.id,
      customer: t.customer,
      amount: t.total,
      time: new Date(t.date).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      date: new Date(t.date).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      status: t.status,
    }));

  // Sales data for last 7 days (for chart)
  const sales7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split("T")[0];
    const dayTransactions = transactions.filter(
      t => t.date.includes(dateStr) && t.status !== "refunded" && t.status !== "cancelled"
    );
    return dayTransactions.reduce((sum, t) => sum + t.total, 0);
  });
  const buildSalesPoints = (data: number[], w = 80, h = 30) => {
    const max = Math.max(1, ...data);
    const stepX = data.length > 1 ? (w - 4) / (data.length - 1) : 0;
    return data.map((v, i) => (2 + i * stepX).toFixed(2) + "," + (h - 2 - (v / max) * (h - 6)).toFixed(2)).join(" ");
  };

  // Sold items today with pagination
  // Exclude adjustment transactions from exchanges (id starts with "ADJ-" or customer is "Tukar Barang")
  // These items are already recorded in "LIST TUKAR BARANG" table
  const allSoldItemsToday = todayTransactions
    .filter(t => !t.id.startsWith('ADJ-') && t.customer !== 'Tukar Barang')
    .flatMap(t => {
      // Cek apakah transaksi ini adalah hutang yang masih belum lunas
      let associatedNote = getNotes().find((n: any) => n.transactionId === t.id);

      // Fallback: Cari lewat Nama & Jumlah (Untuk transaksi lama sebelum ada ID)
      if (!associatedNote && t.paymentMethod === 'hutang') {
        const notes = getNotes();
        associatedNote = notes.find((n: any) =>
          n.type === 'hutang' &&
          // Cek kecocokan nama ATAU jika di transaksi masih tercatat "Pelanggan Umum"
          (n.customerName === t.customer || t.customer === 'Pelanggan Umum' || !t.customer) &&
          Math.abs((n.amount || 0) - t.total) < 1 &&
          n.date.split('T')[0] === t.date.split('T')[0]
        );
      }

      // Deteksi hutang dengan cara yang lebih kuat
      const isHutangMethod = t.paymentMethod === 'hutang' || (t as any).isHutang === true;
      const hasHutangItems = t.items.some((item: any) => item.isHutang === true);
      const isStillHutang = (isHutangMethod || hasHutangItems) && (!associatedNote || !associatedNote.completed);

      return t.items
        .filter(item => !(item as any).sameDayRefunded && !(item as any).refunded)
        .map(item => ({
          sku: item.sku || '-',
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price,
          isHutang: isStillHutang,
          transactionId: t.id
        }));
    });

  // Calculate total discount from today's transactions
  const todayDiscountInfo = (() => {
    let totalDiscountAmount = 0;
    const discountDetails: { percent: number; amount: number }[] = [];

    todayTransactions.forEach((t: any) => {
      if (t.discountAmount && t.discountAmount > 0) {
        totalDiscountAmount += t.discountAmount;
        discountDetails.push({
          percent: t.discountPercent || 0,
          amount: t.discountAmount
        });
      }
    });

    return {
      totalAmount: totalDiscountAmount,
      details: discountDetails,
      hasDiscount: totalDiscountAmount > 0
    };
  })();

  // Get week range in month (1-7, 8-14, 15-21, 22-end)
  const getWeekRangeInMonth = () => {
    const now = new Date();
    const currentDay = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();

    let startDay: number;
    let endDay: number;

    if (currentDay >= 1 && currentDay <= 7) {
      startDay = 1;
      endDay = 7;
    } else if (currentDay >= 8 && currentDay <= 14) {
      startDay = 8;
      endDay = 14;
    } else if (currentDay >= 15 && currentDay <= 21) {
      startDay = 15;
      endDay = 21;
    } else {
      startDay = 22;
      // End of month
      endDay = new Date(year, month + 1, 0).getDate();
    }

    const startDate = new Date(year, month, startDay).toISOString().split('T')[0];
    const endDate = new Date(year, month, endDay).toISOString().split('T')[0];

    return { startDate, endDate };
  };

  const getStartOfMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  };

  // Filter transactions by period
  const getFilteredTransactions = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (soldItemsPeriod === "today") {
      return todayTransactions;
    } else if (soldItemsPeriod === "week") {
      const { startDate, endDate } = getWeekRangeInMonth();
      return transactions.filter(t => {
        const tDate = t.date.split('T')[0];
        return tDate >= startDate && tDate <= endDate && t.status !== "refunded" && t.status !== "cancelled";
      });
    } else {
      const startOfMonth = getStartOfMonth();
      return transactions.filter(t => {
        const tDate = t.date.split('T')[0];
        return tDate >= startOfMonth && t.status !== "refunded" && t.status !== "cancelled";
      });
    }
  };

  // Get recently sold items (from latest transactions)
  const getRecentlySoldItems = () => {
    // Get all completed transactions, sorted by date descending (newest first)
    const completedTrx = transactions
      .filter(t => t.status !== "cancelled" && t.status !== "refunded")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Get items from recent transactions (limit to last 20 items)
    const recentItems: Array<{
      sku: string;
      name: string;
      quantity: number;
      price: number;
      total: number;
      soldAt: string;
    }> = [];

    for (const trx of completedTrx) {
      for (const item of trx.items) {
        recentItems.push({
          sku: item.sku || '-',
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price,
          soldAt: trx.date
        });

        // Limit to 20 recent items
        if (recentItems.length >= 20) break;
      }
      if (recentItems.length >= 20) break;
    }

    return recentItems;
  };

  const recentlySoldItems = getRecentlySoldItems();
  const soldItemsPerPage = 25;
  const soldItemsTotalPages = Math.ceil(recentlySoldItems.length / soldItemsPerPage);
  const soldItemsToday = recentlySoldItems.slice((soldItemsPage - 1) * soldItemsPerPage, soldItemsPage * soldItemsPerPage);

  // Send to Google Sheets + Monthly Recap + Telegram (ALL IN ONE)
  const sendToGoogleSheets = async () => {
    if (allSoldItemsToday.length === 0 && visitorBefore12 === 0 && visitorAfter12 === 0) {
      alert("Tidak ada data untuk dikirim");
      return;
    }

    const currentConfig = getConfig();

    // ═══════════════════════════════════════════════════════════════════
    // VALIDASI KONFIGURASI KONEKSI MULTI-TOKO
    // ═══════════════════════════════════════════════════════════════════
    const missingConfigs: string[] = [];

    if (!currentConfig.gasUrl || currentConfig.gasUrl.trim() === "") {
      missingConfigs.push("• URL Google Apps Script (GAS)");
    }
    if (!currentConfig.telegramBotToken || currentConfig.telegramBotToken.trim() === "") {
      missingConfigs.push("• Token Bot Telegram");
    }
    if (!currentConfig.telegramChatId || currentConfig.telegramChatId.trim() === "") {
      missingConfigs.push("• ID Channel/Grup Telegram");
    }

    if (missingConfigs.length > 0) {
      alert(
        `⚠️ Konfigurasi Belum Lengkap\n\n` +
        `Data tidak dapat dikirim karena pengaturan berikut belum diisi:\n\n` +
        `${missingConfigs.join("\n")}\n\n` +
        `Silakan lengkapi pengaturan di:\n` +
        `📱 Profil → Koneksi Multi-Toko → Ubah Koneksi Toko`
      );
      return;
    }
    // ═══════════════════════════════════════════════════════════════════

    const todayStr = new Date().toISOString().split('T')[0];
    const lastSentKey = 'sheets_last_sent_date';
    const lastSentDate = localStorage.getItem(lastSentKey);
    const itemsToSend = allSoldItemsToday;

    // Get today's refunds/exchanges
    const allRefunds = getRefunds();
    const allExchanges = getExchanges();
    const refundsToday = allRefunds.filter(r => r.date.split('T')[0] === todayStr);
    const exchangesToday = allExchanges.filter(e => e.date.split('T')[0] === todayStr);

    // ═══════════════════════════════════════════════════════════════════
    // AUTO-COMPLETE: Catatan & Belanja yang lewat hari ini
    // (Hutang tidak terpengaruh - tetap pending sampai dilunasi manual)
    // ═══════════════════════════════════════════════════════════════════
    const allNotes = getNotes();
    allNotes.forEach((n: any) => {
      // Skip hutang - handled separately
      if (n.type === 'hutang') return;
      // Skip if already completed
      if (n.completed) return;

      const creationDate = n.date.split('T')[0];
      // If note is from before today and not completed, auto-complete it
      if (creationDate < todayStr) {
        completeNote(n.id);
      }
    });

    setSendingToSheets(true);
    try {
      // ═══════════════════════════════════════════
      // 1. KIRIM DATA PENJUALAN HARIAN KE SHEET
      // ═══════════════════════════════════════════

      // Pre-compute summary untuk GAS
      const totalSalesForGas = itemsToSend.reduce((sum, item) => sum + item.total, 0);
      const totalHutangBaruForGas = itemsToSend.filter(i => i.isHutang).reduce((sum, i) => sum + i.total, 0);
      const totalRefundForGas = refundsToday.reduce((sum, r) => sum + (r.item.quantity * r.item.price), 0);

      const todayNotesForGas = getNotes().filter((n: any) => {
        const cDate = n.date.split('T')[0];
        const compDate = n.completedAt ? n.completedAt.split('T')[0] : null;
        return cDate === todayStr || compDate === todayStr;
      });
      // FIX: Belanja hanya dihitung dari yang DIBUAT hari ini, bukan yang auto-completed hari ini
      const totalBelanjaForGas = getNotes().filter((n: any) => {
        const cDate = n.date.split('T')[0];
        return n.type === 'belanja' && cDate === todayStr;
      }).reduce((sum, n: any) => sum + (n.amount || 0), 0);

      // Pelunasan Hutang: hanya dari hari sebelumnya yang dilunasi hari ini
      const totalPelunasanForGas = todayNotesForGas.reduce((sum, n: any) => {
        const isPelunasan = n.type === 'hutang' && n.completed && n.completedAt?.split('T')[0] === todayStr;
        const isFromPreviousDay = n.date.split('T')[0] < todayStr;
        return sum + (isPelunasan && isFromPreviousDay ? (n.amount || 0) : 0);
      }, 0);

      const kasHariIniForGas = totalSalesForGas - todayDiscountInfo.totalAmount - totalBelanjaForGas - totalHutangBaruForGas + totalPelunasanForGas - totalRefundForGas;

      const dailyPayload = {
        date: new Date().toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
        isUpdate: lastSentDate === todayStr,
        telegramBotToken: currentConfig.telegramBotToken,
        telegramChatId: currentConfig.telegramChatId,
        items: itemsToSend.map(item => ({
          kode: item.sku,
          quantity: item.quantity,
          price: item.price,
          total: item.total,
          totalFormatted: item.total.toLocaleString('id-ID'),
          isHutang: item.isHutang // Kirim status hutang ke GAS
        })),
        refunds: refundsToday.map(r => {
          let pDate = r.originalPurchaseDate;
          if (!pDate && r.transactionId) {
            const trx = transactions.find(t => t.id === r.transactionId);
            if (trx) pDate = trx.date;
          }

          let displayPDate = '-';
          if (pDate) {
            const isSameDay = r.date.split('T')[0] === pDate.split('T')[0];
            displayPDate = isSameDay ? "Di hari yg sama" : new Date(pDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
          }

          return {
            date: new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
            kode: r.item.sku,
            nama: r.item.name,
            quantity: r.item.quantity,
            price: r.item.price,
            total: r.total,
            purchaseDate: displayPDate,
            jenis: 'REFUND'
          };
        }),
        visitors: {
          before12: visitorBefore12,
          after12: visitorAfter12,
          total: visitorBefore12 + visitorAfter12,
          lost: visitorLostToday,
          lostList: lostDescriptions
        },
        // Discount info from today's transactions
        discount: {
          totalAmount: todayDiscountInfo.totalAmount,
          details: todayDiscountInfo.details,
          hasDiscount: todayDiscountInfo.hasDiscount
        },
        // Exchange difference info (total selisih harga dari penukaran hari ini)
        // Positive = customer paid more (tambah bayar), Negative = store gave refund (kembalian)
        exchangeDifference: {
          totalAmount: exchangesToday.reduce((sum, e) => sum + (e.priceDifference || 0), 0),
          count: exchangesToday.length,
          hasExchange: exchangesToday.length > 0
        },
        notes: getNotes().filter((n: any) => {
          const creationDate = n.date.split('T')[0];
          const todayStr = new Date().toISOString().split('T')[0];

          // Jika jenisnya hutang, tampilkan jika baru dibuat hari ini ATAU belum lunas
          if (n.type === 'hutang') {
            const completionDate = n.completedAt ? n.completedAt.split('T')[0] : null;
            return (creationDate === todayStr) || (completionDate === todayStr) || (!n.completed);
          }

          // Catatan & Belanja: HANYA dikirim jika dibuat hari ini
          return creationDate === todayStr;
        }).map((n: any) => ({
          date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
          type: n.type,
          customerName: n.customerName || '-',
          content: n.content,
          amount: n.amount || 0,
          completed: n.completed || false,
          completedAt: n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI INI' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : null
        })),
        // Hutang (Piutang) - terpisah dari notes
        hutang: getNotes().filter((n: any) => {
          if (n.type !== 'hutang') return false;

          const creationDate = n.date.split('T')[0];
          const completionDate = n.completedAt ? n.completedAt.split('T')[0] : null;

          // Muncul di report jika:
          // 1. Dibuat hari ini
          // 2. Dilunasi hari ini
          // 3. Masih belum lunas
          return (creationDate === todayStr) || (completionDate === todayStr) || (!n.completed);
        }).map((n: any) => ({
          date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
          customerName: n.customerName || '-',
          content: n.content,
          amount: n.amount || 0,
          completed: n.completed || false,
          completedAt: n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI INI' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : null
        })),
        // Add exchanges array for LIST TUKAR BARANG table
        exchanges: exchangesToday.map(e => {
          let pDate = e.originalPurchaseDate;
          if (!pDate && e.originalTransactionId) {
            const trx = transactions.find(t => t.id === e.originalTransactionId);
            if (trx) pDate = trx.date;
          }
          return {
            originalItem: e.originalItem,
            newItem: e.newItem,
            priceDifference: e.priceDifference || 0,
            originalPurchaseDate: pDate,
            originalTransactionId: e.originalTransactionId,
            date: e.date,
            hargaLama: e.originalItem?.price || 0,
            hargaBaru: e.newItem?.price || 0
          };
        }),
        sendNotification: true, // Tell Google Script to send Telegram message
        // Summary angka-angka untuk tabel penjualan di Google Sheet
        summary: {
          totalSales: totalSalesForGas,
          totalHutangBaru: totalHutangBaruForGas,
          totalBelanja: totalBelanjaForGas,
          totalRefund: totalRefundForGas,
          totalPelunasan: totalPelunasanForGas,
          kasHariIni: kasHariIniForGas,
        },
        // Full Backup for Google Drive (format compatible with Restore)
        fullBackup: {
          type: "full-backup",
          timestamp: new Date().toISOString(),
          version: "2.2",
          data: {
            products: getCachedProducts(),
            transactions: transactions,
            profile: getFromLS<any>(LS_KEYS.PROFILE, null),
            visitorsLog: getFromLS<any[]>(LS_KEYS.VISITORS_LOG, []),
            visitorLostLog: getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []),
            exchanges: allExchanges,
            refunds: allRefunds,
            notes: getNotes(),
            cart: getFromLS<any[]>('CART', []),
            enablePPN: getFromLS<boolean>('ENABLE_PPN', false),
            multiTokoConnection: {
              gasUrl: currentConfig.gasUrl,
              telegramBotToken: currentConfig.telegramBotToken,
              telegramChatId: currentConfig.telegramChatId,
            },
          }
        }
      };

      console.log("[GAS] Sending daily payload with fullBackup to:", currentConfig.gasUrl);
      console.log("[DEBUG] fullBackup summary:", {
        products: dailyPayload.fullBackup.data.products?.length || 0,
        transactions: dailyPayload.fullBackup.data.transactions?.length || 0,
        visitors: dailyPayload.fullBackup.data.visitorsLog?.length || 0,
        exchanges: dailyPayload.fullBackup.data.exchanges?.length || 0,
        notes: dailyPayload.fullBackup.data.notes?.length || 0,
        payloadSize: JSON.stringify(dailyPayload).length + " bytes"
      });
      await fetch(currentConfig.gasUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dailyPayload)
      });

      // ═══════════════════════════════════════════
      // 2. KIRIM REKAP BULANAN (BARANG TERLARIS + TAMU)
      // ═══════════════════════════════════════════
      const startOfMonth = getStartOfMonth();
      const monthlyTransactions = transactions.filter(t => {
        const tDate = t.date.split('T')[0];
        return tDate >= startOfMonth && t.status !== "refunded" && t.status !== "cancelled";
      });

      const itemMap: Record<string, { sku: string; name: string; quantity: number; total: number; transactionCount: number }> = {};
      monthlyTransactions.forEach(t => {
        // Track which items appeared in this transaction (to count unique transactions per item)
        const itemsInThisTransaction = new Set<string>();

        t.items.forEach(item => {
          const key = item.sku || item.name;
          itemsInThisTransaction.add(key);

          if (itemMap[key]) {
            itemMap[key].quantity += item.quantity;
            itemMap[key].total += item.quantity * item.price;
          } else {
            itemMap[key] = {
              sku: item.sku || '-',
              name: item.name,
              quantity: item.quantity,
              total: item.quantity * item.price,
              transactionCount: 0,
            };
          }
        });

        // Increment transaction count for each unique item in this transaction
        itemsInThisTransaction.forEach(key => {
          if (itemMap[key]) {
            itemMap[key].transactionCount += 1;
          }
        });
      });

      const monthlyItems = Object.values(itemMap).sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return b.total - a.total;
      });

      const now = new Date();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dailyVisitors: Array<{ date: string; before12: number; after12: number; lost: number; lostList: string[] }> = [];
      const allLostList: Array<{ date: string; description: string }> = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const { before12, after12 } = getVisitorStatsByTime(dateStr);
        const lostEntries = getLostEntriesByDate(dateStr);
        const lostCount = lostEntries.length;
        const lostDescList = getLostDescriptionsByDate(dateStr);

        // Collect all lost entries for the separate lost list section
        const formattedDate = new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
        lostDescList.forEach(desc => {
          allLostList.push({ date: formattedDate, description: desc });
        });

        if (before12 > 0 || after12 > 0 || lostCount > 0) {
          dailyVisitors.push({
            date: formattedDate,
            before12,
            after12,
            lost: lostCount,
            lostList: lostDescList
          });
        }
      }

      // Collect Monthly Exchanges/Refunds
      const allExchangesMonthly = getExchanges();
      const allRefundsMonthly = getRefunds(); // NEW: Collect Refunds too
      const startOfMonthStr = startOfMonth + 'T00:00:00.000Z';

      // 1. Process Exchanges as Refunds (since user wants to focus on Refund)
      const monthlyExchangesFormatted = allExchangesMonthly.filter((e: any) => {
        return e.date >= startOfMonthStr;
      }).map((e: any) => {
        let purchaseDate = e.originalPurchaseDate;
        if (!purchaseDate && e.originalTransactionId) {
          const originalTrx = transactions.find((t: any) => t.id === e.originalTransactionId);
          if (originalTrx) purchaseDate = originalTrx.date;
        }

        let displayTglBeli = '-';
        if (purchaseDate) {
          const isSameDay = e.date.split('T')[0] === purchaseDate.split('T')[0];
          displayTglBeli = isSameDay ? "Di hari yg sama" : new Date(purchaseDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
        }

        return {
          date: new Date(e.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          tglBeli: displayTglBeli,
          kode: e.originalItem?.sku || e.originalItem?.kode || "-",
          nama: e.originalItem?.name || e.originalItem?.nama || "-",
          quantity: e.originalItem?.quantity || 1,
          price: e.originalItem?.price || 0,
          totalRefund: e.priceDifference || 0, // Using difference for exchange
          type: "EXCHANGE"
        };
      });

      // 2. Process Actual Refunds
      const monthlyRefundsFormatted = allRefundsMonthly.filter((r: any) => {
        return r.date >= startOfMonthStr;
      }).map((r: any) => {
        let pDate = r.purchaseDate || r.originalPurchaseDate;
        if (!pDate && r.transactionId) {
          const originalTrx = transactions.find((t: any) => t.id === r.transactionId);
          if (originalTrx) pDate = originalTrx.date;
        }

        let displayTglBeli = '-';
        if (pDate) {
          const isSameDay = r.date.split('T')[0] === pDate.split('T')[0];
          displayTglBeli = isSameDay ? "Di hari yg sama" : new Date(pDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
        }

        return {
          date: new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          tglBeli: displayTglBeli,
          kode: r.item?.sku || r.kode || "-",
          nama: r.item?.name || r.nama || "-",
          quantity: r.item?.quantity || r.quantity || 1,
          price: r.item?.price || r.price || 0,
          totalRefund: r.total || (r.item?.price * (r.item?.quantity || 1)) || 0,
          type: "REFUND"
        };
      });

      // Combine both into one list for the "LIST REFUND BARANG" section
      const combinedMonthlyRefunds = [...monthlyRefundsFormatted, ...monthlyExchangesFormatted];

      // NOTE: Refunds logic can be added here similarly if stored separately in 'bengkel_refunds'
      // For now we focus on exchanges as requested.

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
      const monthYear = monthNames[now.getMonth()] + " " + now.getFullYear();

      // ═══════════════════════════════════════════
      // HITUNG PENJUALAN PER KATEGORI (berdasarkan prefix SKU)
      // ═══════════════════════════════════════════
      const categorySalesMap: Record<string, number> = {};
      monthlyTransactions.forEach(t => {
        t.items.forEach(item => {
          const sku = (item.sku || '').toUpperCase();
          const prefix = sku.substring(0, 2);
          // Map prefix ke nama kategori
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
          categorySalesMap[category] = (categorySalesMap[category] || 0) + itemTotal;
        });
      });

      // Convert to sorted array for payload
      const categorySales = Object.entries(categorySalesMap)
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total); // Terbesar dulu

      if (monthlyItems.length > 0 || monthlyExchangesFormatted.length > 0 || getNotes().length > 0) { // Send if items, exchanges, OR notes exist
        const monthlyPayload = {
          action: "monthlyRecap",
          month: monthYear,
          items: monthlyItems.map((item, idx) => ({
            rank: idx + 1,
            kode: item.sku,
            nama: item.name,
            quantity: item.quantity,
            transactionCount: item.transactionCount,
            totalSales: item.total
          })),
          categorySales: categorySales, // NEW: Penjualan per kategori
          dailyVisitors: dailyVisitors,
          allLostList: allLostList,
          monthlyRefunds: combinedMonthlyRefunds, // NEW: Standardized Refund Data
          monthlyExchanges: monthlyExchangesFormatted, // Keep for backward compatibility if needed
          monthlyNotes: getNotes().filter((n: any) => {
            // Filter catatan yang dibuat di bulan ini ATAU hutang yang masih pending
            const noteDate = n.date.split('T')[0];
            if (n.type === 'hutang' && !n.completed) return true;
            return noteDate >= startOfMonth;
          }).map((n: any) => ({
            date: new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
            type: n.type,
            customerName: n.customerName || '-',
            content: n.content,
            amount: n.amount || 0,
            completed: n.completed || false,
            completedAt: n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI YG SAMA' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : null
          })),
          telegramBotToken: currentConfig.telegramBotToken,
          telegramChatId: currentConfig.telegramChatId,
        };

        // DEBUG: Log to see transactionCount values
        console.log("[DEBUG] Monthly Items with transactionCount:", monthlyPayload.items.slice(0, 5).map(i => ({
          kode: i.kode,
          qty: i.quantity,
          trxCount: i.transactionCount
        })));

        await fetch(currentConfig.gasUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(monthlyPayload)
        });
      }

      // ═══════════════════════════════════════════
      // 3. KIRIM KE TELEGRAM (BACKUP JSON FILE)
      // ═══════════════════════════════════════════
      /*
         NOTE: Pesan teks sudah dikirim otomatis oleh Google Apps Script (Server Side).
         Di sini kita siapkan variabel untuk pesan sukses dan kirim file backup.
      */

      // Use dynamic credentials
      const TELEGRAM_BOT_TOKEN = currentConfig.telegramBotToken;
      const TELEGRAM_CHAT_ID = currentConfig.telegramChatId;

      // Variabel ini TETAP DIBUTUHKAN untuk Success Popup di bawah
      const totalPenjualan = itemsToSend.reduce((sum, item) => sum + item.total, 0);
      const totalTukar = exchangesToday.length + refundsToday.length;
      const totalTamu = visitorBefore12 + visitorAfter12;

      // Format tanggal untuk nama file
      const dateForFile = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tanggalHariIni = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      // Kirim pesan teks ke Telegram (DIHAPUS - DIGANTI OLEH GOOGLE SCRIPT)
      /* 
         Logic penyusunan pesan teks dihapus untuk menghindari ReferenceError.
         Pesan teks utama sekarang dikirim oleh Google Apps Script (flag: sendNotification: true).
         Di bawah ini hanya logic pengiriman FILE BACKUP.
      */

      try {
        // ═══════════════════════════════════════════
        // FILE: Laporan Harian (XLSX) - Format sama seperti Google Sheet (tanpa icon)
        // ═══════════════════════════════════════════
        const wb = XLSX.utils.book_new();

        // --- SHEET 1: PENJUALAN ---
        const salesRows: any[][] = [];
        // Header info
        salesRows.push([tanggalHariIni]);
        salesRows.push(['Terakhir Update: ' + now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ' WIB']);
        salesRows.push([]); // spacer
        // Data tamu summary
        salesRows.push(['TAMU HARI INI']);
        salesRows.push(['< 12', '> 12', 'Total', 'Lost']);
        salesRows.push([visitorBefore12, visitorAfter12, visitorBefore12 + visitorAfter12, visitorLostToday]);
        // Lost list
        if (lostDescriptions.length > 0) {
          salesRows.push(['DAFTAR LOST:']);
          lostDescriptions.forEach((desc, idx) => {
            salesRows.push(['  ' + (idx + 1) + '. ' + desc]);
          });
        }
        salesRows.push([]); // spacer
        // Penjualan header
        salesRows.push(['PENJUALAN HARI INI']);
        salesRows.push(['KODE', 'Qty', 'Harga', 'Total']);
        // Penjualan data
        let totalSalesXlsx = 0;
        let totalHutangBaruXlsx = 0;
        const hutangRowIndices: number[] = []; // Track baris hutang untuk diwarnai merah
        itemsToSend.forEach(item => {
          // Tandai dengan teks (HUTANG) jika belum dibayar
          const skuDisplay = item.isHutang ? `${item.sku || '-'} (HUTANG)` : (item.sku || '-');
          if (item.isHutang) {
            hutangRowIndices.push(salesRows.length); // Simpan index baris ini
          }
          salesRows.push([skuDisplay, item.quantity, item.price, item.total]);
          totalSalesXlsx += item.total;
          if (item.isHutang) totalHutangBaruXlsx += item.total;
        });

        // Summary rows data
        const totalRefundXlsx = refundsToday.reduce((sum, r) => sum + (r.item.quantity * r.item.price), 0);
        const totalDiscountXlsx = todayDiscountInfo.totalAmount;
        const todayStr = new Date().toISOString().split('T')[0];
        const todayNotes = getNotes().filter((n: any) => {
          const creationDate = n.date.split('T')[0];
          const completionDate = n.completedAt ? n.completedAt.split('T')[0] : null;
          return creationDate === todayStr || completionDate === todayStr;
        });

        // FIX: Belanja hanya dari yang DIBUAT hari ini
        const totalBelanjaKasir = getNotes().filter((n: any) => {
          const cDate = n.date.split('T')[0];
          return n.type === 'belanja' && cDate === todayStr;
        }).reduce((sum, n: any) => sum + (n.amount || 0), 0);

        // Pelunasan Hutang: HANYA hitung jika hutangnya dari HARI SEBELUMNYA
        // Ini mencegah uang Si Boy (yang hutang & lunas hari ini) dihitung dua kali
        const totalPelunasanHutangXlsx = todayNotes.reduce((sum, n: any) => {
          const isPelunasan = n.type === 'hutang' && n.completed && n.completedAt?.split('T')[0] === todayStr;
          const isFromPreviousDay = n.date.split('T')[0] < todayStr;
          return sum + (isPelunasan && isFromPreviousDay ? (n.amount || 0) : 0);
        }, 0);

        // KAS HARI INI = Penjualan - Diskon - Belanja - HutangBaru + PelunasanHutang - Refund
        const kasHariIni = totalSalesXlsx - totalDiscountXlsx - totalBelanjaKasir - totalHutangBaruXlsx + totalPelunasanHutangXlsx - totalRefundXlsx;

        salesRows.push(['', '', 'TOTAL :', totalSalesXlsx]);

        if (totalHutangBaruXlsx > 0) {
          salesRows.push(['', '', 'HUTANG HARI INI :', -totalHutangBaruXlsx]);
        }

        if (totalBelanjaKasir > 0) {
          salesRows.push(['', '', 'BELANJA KASIR :', -totalBelanjaKasir]);
        }

        salesRows.push(['', '', 'TOTAL REFUND :', -totalRefundXlsx]);

        if (totalPelunasanHutangXlsx > 0) {
          salesRows.push(['', '', 'PELUNASAN HUTANG :', totalPelunasanHutangXlsx]);
        }

        salesRows.push(['', '', 'KAS HARI INI :', kasHariIni]);

        // --- REFUND BARANG HARI INI (di bawah KAS HARI INI, sama seperti di spreadsheet) ---
        if (refundsToday.length > 0) {
          salesRows.push([]); // spacer
          salesRows.push(['REFUND BARANG HARI INI']);
          salesRows.push(['Tgl Refund', 'Tgl Beli', 'Kode', 'Nama Barang', 'Qty', 'Harga/Pcs', 'Total Refund']);
          let totalRefundSum = 0;
          refundsToday.forEach(r => {
            let pDate = r.originalPurchaseDate;
            if (!pDate && r.transactionId) {
              const trx = transactions.find(t => t.id === r.transactionId);
              if (trx) pDate = trx.date;
            }
            let displayPDate = '-';
            if (pDate) {
              const isSameDay = r.date.split('T')[0] === pDate.split('T')[0];
              displayPDate = isSameDay ? 'Di hari yg sama' : new Date(pDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
            }
            const totalItem = (r.item.quantity || 1) * (r.item.price || 0);
            salesRows.push([
              new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
              displayPDate,
              r.item.sku || '-',
              r.item.name || '-',
              r.item.quantity || 1,
              r.item.price || 0,
              -totalItem
            ]);
            totalRefundSum += totalItem;
          });
          salesRows.push(['Total Refund: ' + refundsToday.length + ' item', '', '', '', '', 'TOTAL:', -totalRefundSum]);
        }

        // --- CATATAN (di bawah refund, sama seperti di spreadsheet) ---
        const notesForXlsx = getNotes().filter((n: any) => {
          const creationDate = n.date.split('T')[0];
          const todayStr2 = new Date().toISOString().split('T')[0];
          if (n.type === 'hutang') {
            const completionDate = n.completedAt ? n.completedAt.split('T')[0] : null;
            return (creationDate === todayStr2) || (completionDate === todayStr2) || (!n.completed);
          }
          return creationDate === todayStr2;
        });
        if (notesForXlsx.length > 0) {
          salesRows.push([]); // spacer
          salesRows.push(['CATATAN']);
          salesRows.push(['Tgl', 'Jenis', 'Nama', 'Isi Catatan', 'Jumlah', 'Status', 'Tgl Selesai']);
          notesForXlsx.forEach((n: any) => {
            const status = n.type === 'hutang' ? (n.completed ? 'LUNAS' : 'BELUM BAYAR') : '';
            const tglSelesai = n.completedAt ? (n.date.split('T')[0] === n.completedAt.split('T')[0] ? 'HARI INI' : new Date(n.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')) : (n.type === 'hutang' ? '-' : '');
            salesRows.push([
              new Date(n.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''),
              n.type.toUpperCase(),
              n.customerName || '-',
              n.content,
              n.amount || 0,
              status,
              tglSelesai
            ]);
          });
        }

        const wsSales = XLSX.utils.aoa_to_sheet(salesRows);
        // Bold helper: apply bold to a row in a worksheet
        const boldRow = (ws: any, row: number, cols: number) => {
          for (let c = 0; c < cols; c++) {
            const addr = XLSX.utils.encode_cell({ r: row, c });
            if (ws[addr]) {
              ws[addr].s = { ...(ws[addr].s || {}), font: { ...(ws[addr].s?.font || {}), bold: true } };
            }
          }
        };
        // Red font helper: warnai teks merah untuk baris hutang
        const redRow = (ws: any, row: number, cols: number) => {
          for (let c = 0; c < cols; c++) {
            const addr = XLSX.utils.encode_cell({ r: row, c });
            if (ws[addr]) {
              ws[addr].s = { ...(ws[addr].s || {}), font: { ...(ws[addr].s?.font || {}), color: { rgb: 'FF0000' } } };
            }
          }
        };
        // Bold headers di sheet Penjualan
        boldRow(wsSales, 0, 8); // Tanggal
        boldRow(wsSales, 1, 8); // Terakhir Update
        // Cari row index untuk section headers
        salesRows.forEach((row, idx) => {
          const val = String(row[0] || '');
          if (val === 'TAMU HARI INI' || val === 'PENJUALAN HARI INI' || val === 'CATATAN' || val === 'DAFTAR LOST:' || val === 'REFUND BARANG HARI INI') {
            boldRow(wsSales, idx, 8);
          }
          if (val === '< 12' || val === 'KODE' || val === 'Tgl' || val === 'Tgl Refund') {
            boldRow(wsSales, idx, 8);
          }
          if (val.startsWith('Total Refund:')) {
            boldRow(wsSales, idx, 8);
          }
          const val2 = String(row[2] || '');
          if (val2 === 'TOTAL :' || val2 === 'BELANJA KASIR :' || val2 === 'TOTAL REFUND :' || val2 === 'KAS HARI INI :' || val2 === 'PELUNASAN HUTANG :' || val2 === 'HUTANG HARI INI :') {
            boldRow(wsSales, idx, 8);
          }
          // Warnai baris HUTANG HARI INI dengan merah
          if (val2 === 'HUTANG HARI INI :') {
            redRow(wsSales, idx, 8);
          }
        });
        // Warnai baris item hutang dengan font merah
        hutangRowIndices.forEach(rowIdx => {
          redRow(wsSales, rowIdx, 4);
        });
        XLSX.utils.book_append_sheet(wb, wsSales, "Penjualan");

        // --- SHEET: DATA PENGUNJUNG (bulanan, seperti di Recap spreadsheet) ---
        const visitorRows: any[][] = [];
        visitorRows.push(['DATA PENGUNJUNG - ' + monthYear]);
        visitorRows.push([]);
        visitorRows.push(['Tanggal', '< Jam 12', '> Jam 12', 'Total Tamu', 'Lost']);
        let totalB12 = 0, totalA12 = 0, totalTamu = 0, totalLost = 0;
        dailyVisitors.forEach(day => {
          const dayTotal = day.before12 + day.after12;
          visitorRows.push([day.date, day.before12, day.after12, dayTotal, day.lost]);
          totalB12 += day.before12;
          totalA12 += day.after12;
          totalTamu += dayTotal;
          totalLost += day.lost;
        });
        visitorRows.push(['TOTAL', totalB12, totalA12, totalTamu, totalLost]);

        // Daftar Lost di bawah tabel
        if (allLostList.length > 0) {
          visitorRows.push([]);
          visitorRows.push(['DAFTAR LOST']);
          visitorRows.push(['No', 'Tanggal', 'Nama Barang']);
          allLostList.forEach((item, idx) => {
            visitorRows.push([idx + 1, item.date, item.description]);
          });
        }

        const wsVisitors = XLSX.utils.aoa_to_sheet(visitorRows);
        boldRow(wsVisitors, 0, 5); // Title
        boldRow(wsVisitors, 2, 5); // Header kolom
        // Bold TOTAL row & DAFTAR LOST header
        visitorRows.forEach((row, idx) => {
          const val = String(row[0] || '');
          if (val === 'TOTAL' || val === 'DAFTAR LOST') {
            boldRow(wsVisitors, idx, 5);
          }
          if (val === 'No') {
            boldRow(wsVisitors, idx, 3);
          }
        });
        XLSX.utils.book_append_sheet(wb, wsVisitors, "Data Pengunjung");

        // --- Kirim 1 file XLSX ke Telegram ---
        const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const xlsxFileName = `Laporan-Harian-${dateForFile}.xlsx`;

        // Auto-download ke device kasir
        const downloadUrl = URL.createObjectURL(xlsxBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = xlsxFileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(downloadUrl);

        const formData1 = new FormData();
        formData1.append('chat_id', TELEGRAM_CHAT_ID);
        formData1.append('document', xlsxBlob, xlsxFileName);
        formData1.append('caption', `📊 Laporan Harian - ${tanggalHariIni}`);

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
          method: "POST",
          body: formData1
        });

        // ═══════════════════════════════════════════
        // FILE 3: Backup Full (JSON)
        // ═══════════════════════════════════════════
        let allTransactionsForBackup: any[] = [];
        try {
          allTransactionsForBackup = await getAllTransactions();
        } catch (e) {
          allTransactionsForBackup = getFromLS(LS_KEYS.TRANSACTIONS, []);
        }

        const backupData = {
          type: "full-backup",
          timestamp: now.toISOString(),
          version: "2.1",
          data: {
            products: getCachedProducts(),
            transactions: allTransactionsForBackup,
            profile: getFromLS(LS_KEYS.PROFILE, null),
            visitorsLog: getFromLS(LS_KEYS.VISITORS_LOG, []),
            visitorLostLog: getFromLS(LS_KEYS.VISITOR_LOST_LOG, []),
            exchanges: getFromLS('bengkel_exchanges', []),
            refunds: getFromLS('bengkel_refunds', []),
            purchaseNotes: getFromLS('purchase_notes', []),
            notes: getFromLS('bengkel_notes', []), // Catatan/Pengingat (hutang, dll)
            cart: getFromLS(LS_KEYS.CART, []),
            enablePPN: getFromLS(LS_KEYS.ENABLE_PPN, false),
          },
        };

        const jsonBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });

        const formData3 = new FormData();
        formData3.append('chat_id', TELEGRAM_CHAT_ID);
        formData3.append('document', jsonBlob, `Backup-Full-${dateForFile}.json`);
        formData3.append('caption', `💾 Backup Full Data - ${tanggalHariIni}`);

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
          method: "POST",
          body: formData3
        });

      } catch (telegramError) {
        console.error("Error sending to Telegram:", telegramError);
      }

      // Save sent date and time
      const nowSync = new Date();
      localStorage.setItem(lastSentKey, todayStr);
      localStorage.setItem('sheets_last_sent_time', nowSync.toISOString());


      // Show success popup
      setSuccessMessage(`✅ Data berhasil dikirim!\n\n📊 Google Sheets: ✓\n🏆 Rekap Bulanan: ✓\n📱 Telegram: ✓\n\n📦 ${itemsToSend.length} item penjualan\n👥 ${totalTamu} tamu\n🔄 ${totalTukar} tukar/refund`);
      setSuccessPopupOpen(true);

      setSheetsSent(true);
      setTimeout(() => setSheetsSent(false), 3000);
    } catch (error) {
      alert("Gagal mengirim data: " + error);
    } finally {
      setSendingToSheets(false);
    }
  };


  // State untuk kirim rekap bulanan (tidak dipakai lagi tapi tetap ada untuk kompatibilitas)
  const [sendingMonthlyRecap, setSendingMonthlyRecap] = useState(false);

  // === AUTO-KIRIM PENJUALAN BACKGROUND SERVICE ===
  const sendToGoogleSheetsRef = useRef(sendToGoogleSheets);

  useEffect(() => {
    sendToGoogleSheetsRef.current = sendToGoogleSheets;
  }); // update every render

  const [currentConfig, setCurrentConfig] = useState(getConfig());

  useEffect(() => {
    const handleConfig = () => setCurrentConfig(getConfig());
    window.addEventListener('configUpdated', handleConfig);
    return () => window.removeEventListener('configUpdated', handleConfig);
  }, []);

  useEffect(() => {
    // Check if auto send is enabled and times are configured
    if (!currentConfig.autoSendEnabled || !currentConfig.autoSendTimes) return;

    const times = currentConfig.autoSendTimes
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    if (times.length === 0) return;

    const intervalId = setInterval(() => {
      const now = new Date();
      const hour = now.getHours().toString().padStart(2, '0');
      const min = now.getMinutes().toString().padStart(2, '0');
      const currentHourMinute = `${hour}:${min}`;

      // Ambil tgl lokal agar sesuai zona waktu pengguna
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      try {
        const lastExecutedRaw = localStorage.getItem('auto_send_last_executed');
        const lastExecuted = lastExecutedRaw ? JSON.parse(lastExecutedRaw) : {};

        let shouldSend = false;
        let triggeredTime = '';

        for (const time of times) {
          // Jika waktu sekarang sudah melewati atau sama dengan waktu jadwal
          if (currentHourMinute >= time) {
            // Cek apakah hari ini jadwal tersebut sudah tereksekusi
            if (lastExecuted[time] !== todayStr) {
              shouldSend = true;
              triggeredTime = time;
              lastExecuted[time] = todayStr; // Tandai sudah tereksekusi hari ini
            }
          }
        }

        if (shouldSend) {
          console.log(`[AutoSend] Jadwal ${triggeredTime} telah tiba/terlewat (Waktu sekarang: ${currentHourMinute}), memicu pengiriman otomatis...`);
          localStorage.setItem('auto_send_last_executed', JSON.stringify(lastExecuted));

          setTimeout(() => {
            sendToGoogleSheetsRef.current();
          }, 1500);
        }
      } catch (e) {
        console.error("Auto send error", e);
      }
    }, 20000); // Check every 20 seconds

    return () => clearInterval(intervalId);
  }, [currentConfig.autoSendEnabled, currentConfig.autoSendTimes]);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <main className="flex-1 p-4 pb-20">
        {/* Header */}
        <div className="mb-6 relative flex items-center justify-center min-h-[40px]">
          <div className="absolute left-0 flex flex-col items-start gap-1">
            {isOnline ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 shadow-sm animate-in fade-in zoom-in duration-300">
                <div className="relative flex">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">Online</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-100 text-rose-600 shadow-sm animate-in fade-in zoom-in duration-300">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">Offline</span>
              </div>
            )}

            {/* Toggle Log */}
            <div className="flex items-center gap-1.5 mt-0.5 px-1">
              <Switch
                id="log-toggle"
                checked={showSystemLog}
                onCheckedChange={setShowSystemLog}
                className="scale-75 h-4 w-7 data-[state=checked]:bg-orange-500"
              />
              <Label htmlFor="log-toggle" className="text-[8px] font-bold text-muted-foreground uppercase tracking-tight cursor-pointer">
                Log
              </Label>
            </div>
          </div>
          <h1 className="text-2xl font-bold pl-10 uppercase tracking-tight">{getStoreName()}</h1>
        </div>

        {/* System Log Details Panel */}
        {showSystemLog && (
          <Card className="mb-4 bg-gray-50/50 border-dashed border-gray-200 animate-in slide-in-from-top-2 duration-300">
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-4 text-[11px]">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Log Koneksi:</span>
                    <span className={isOnline ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                      {isOnline ? "Stabil (Online)" : "Terputus (Offline)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Trakhir Sync Sheet :</span>
                    <span className="text-blue-600 font-bold">
                      {(() => {
                        const lastTime = localStorage.getItem('sheets_last_sent_time');
                        if (!lastTime) return "-";
                        const syncDate = new Date(lastTime);
                        const isToday = syncDate.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
                        const timeStr = syncDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
                        return isToday ? `Today, ${timeStr}` : syncDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                      })()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Antrean Pending:</span>
                    <span className={pendingQueueCount > 0 ? "text-orange-600 font-bold animate-pulse" : "text-gray-400"}>
                      {pendingQueueCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Data Siap Kirim:</span>
                    <span className={isOnline && readyToSendCount > 0 ? "text-blue-600 font-bold" : "text-gray-400"}>
                      {readyToSendCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-muted-foreground text-[10px] pt-0.5 opacity-80">
                    <span>Ukuran Data:</span>
                    <span>{(storageInfo.used / (1024 * 1024)).toFixed(2)} MB</span>
                  </div>
                </div>
              </div>



              {/* System Sync Context Bar */}
              <div className="space-y-1.5 border-t pt-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight">
                  <span className={isOnline ? (pendingCount > 0 ? "text-blue-600" : "text-emerald-600") : "text-orange-600"}>
                    {pendingCount > 0
                      ? `${pendingCount} Data (${pendingItemCount} item) Belum Terkirim ke Owner`
                      : syncedCount > 0
                        ? `Hari ini telah terkirim ${syncedCount} Data (${syncedItemCount} item)`
                        : "Belum ada data dikirim hari ini"}
                  </span>

                  <span className={isOnline ? (pendingCount > 0 ? "text-blue-600 font-black" : "text-emerald-600 font-black") : "text-orange-600 font-black"}>
                    {isOnline
                      ? (pendingCount > 0
                        ? <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3" /> Perlu Dikirim</span>
                        : "SYNCED")
                      : "OFFLINE"}
                  </span>

                </div>
                <Progress
                  value={100}
                  className={`h-1.5 ${isOnline ? (pendingCount > 0 ? "[&>div]:bg-blue-600" : "[&>div]:bg-emerald-500") : "[&>div]:bg-orange-500 animate-pulse"}`}
                />
                <p className="text-[9px] text-muted-foreground italic leading-tight">
                  {isOnline
                    ? (pendingCount > 0
                      ? `* Klik tombol 'Kirim Penjualan' untuk mengirim ${pendingCount} data (${pendingItemCount} item) ke Owner.`
                      : "* Semua transaksi sudah tercatat rapi di Google Sheets.")
                    : `* Perhatian: ${pendingCount} transaksi (${pendingItemCount} item) tersimpan di memori HP, belum terkirim ke Owner.`}
                </p>

              </div>

              {/* Stock Sync Status */}
              <div className="border-t pt-2 mt-1">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight">
                  <span className="text-muted-foreground">Sync Stok ke Sheet:</span>
                  {(() => {
                    const pendingRaw = localStorage.getItem('pos_pending_stock_sync');
                    const pendingCount = pendingRaw ? Object.keys(JSON.parse(pendingRaw || '{}')).length : 0;
                    if (pendingCount > 0) {
                      return (
                        <span className="text-orange-600 font-black animate-pulse">
                          ⏸ {pendingCount} pending
                        </span>
                      );
                    }
                    return <span className="text-emerald-600">✓ Synced</span>;
                  })()}
                </div>
              </div>

            </CardContent>
          </Card>
        )}


        {/* Daily Sales Summary */}

        <Card className="mb-6 border-t-4 border-t-amber-500">
          <CardHeader className="pb-0">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>OMZET HARI INI</span>
              <div className="flex items-center gap-2">
                {/* Mini Bar Chart 7 Days - Green if higher than previous, Red if lower */}
                <div className="flex items-end gap-0.5 h-8">
                  {sales7Days.map((val, i) => {
                    const max = Math.max(1, ...sales7Days);
                    const heightPercent = (val / max) * 100;
                    const isToday = i === 6;

                    // Calculate actual day label for each bar
                    const dayDate = new Date();
                    dayDate.setDate(dayDate.getDate() - (6 - i)); // 6 days ago to today
                    const dayOfWeek = dayDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
                    const dayLabelsMap = ['M', 'S', 'S', 'R', 'K', 'J', 'S']; // Minggu, Senin, Selasa, Rabu, Kamis, Jumat, Sabtu
                    const dayLabel = dayLabelsMap[dayOfWeek];

                    // Logic: First day always green, subsequent days green if >= previous, red if < previous
                    const prevVal = i === 0 ? 0 : sales7Days[i - 1];
                    const isUp = i === 0 || val >= prevVal;

                    // Modern minimalist colors
                    const barColor = isUp
                      ? (isToday ? 'bg-emerald-500' : 'bg-emerald-400')
                      : (isToday ? 'bg-rose-500' : 'bg-rose-400');
                    const labelColor = isToday
                      ? (isUp ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold')
                      : 'text-gray-400';

                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5">
                        <div
                          className={`w-2.5 rounded-t transition-all ${barColor}`}
                          style={{ height: `${Math.max(4, heightPercent * 0.28)}px` }}
                          title={`${formatCurrency(val)}`}
                        />
                        <span className={`text-[8px] ${labelColor}`}>
                          {dayLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-sm px-2 py-1 rounded-full flex items-center font-medium ${dailySales.percentageIncrease >= 0
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                    }`}>
                    {dailySales.percentageIncrease >= 0 ? (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {dailySales.percentageIncrease >= 0 ? '+' : ''}{dailySales.percentageIncrease}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">dari kemarin</span>
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-3xl font-bold text-amber-600">{formatCurrency(dailySales.total)}</div>
            <div className="flex items-center mt-2 mb-3 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 mr-1.5 text-blue-500" />
              {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>

            {/* Visitor & Lost Summary - Split-Card Style & Reverted Layout */}
            <div className="flex items-start justify-between gap-4 mt-3">
              <div className="flex flex-col gap-3 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Tamu Card */}
                  <div className="flex items-stretch overflow-hidden rounded-md border border-blue-200 dark:border-blue-900 bg-white dark:bg-gray-800 shadow-sm w-fit h-6">
                    <div className="bg-blue-500 px-1.5 flex items-center justify-center">
                      <span className="text-white text-[9px] font-bold tracking-tight">TAMU</span>
                    </div>
                    <div className="px-1.5 flex items-center justify-center min-w-[24px]">
                      <span className="font-bold text-xs text-blue-700 dark:text-blue-400">{visitorToday}</span>
                    </div>
                  </div>

                  {/* Before 12 Card */}
                  <div className="flex items-stretch overflow-hidden rounded-md border border-green-200 dark:border-green-900 bg-white dark:bg-gray-800 shadow-sm w-fit h-5">
                    <div className="bg-green-500 px-1 flex items-center justify-center">
                      <span className="text-white text-[7px] font-black flex items-center gap-0.5"><ArrowDown className="h-1.5 w-1.5 stroke-[3px]" />12</span>
                    </div>
                    <div className="px-1.5 flex items-center justify-center">
                      <span className="font-bold text-[10px] text-green-700 dark:text-green-400">{visitorBefore12}</span>
                    </div>
                  </div>
                  {/* After 12 Card */}
                  <div className="flex items-stretch overflow-hidden rounded-md border border-orange-200 dark:border-orange-900 bg-white dark:bg-gray-800 shadow-sm w-fit h-5">
                    <div className="bg-orange-500 px-1 flex items-center justify-center">
                      <span className="text-white text-[7px] font-black flex items-center gap-0.5"><ArrowUp className="h-1.5 w-1.5 stroke-[3px]" />12</span>
                    </div>
                    <div className="px-1.5 flex items-center justify-center">
                      <span className="font-bold text-[10px] text-orange-700 dark:text-orange-400">{visitorAfter12}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end shrink-0">
                {/* Lost Card */}
                <div className="flex items-stretch overflow-hidden rounded-md border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 shadow-sm w-fit h-6">
                  <div className="bg-red-500 px-1.5 flex items-center justify-center">
                    <span className="text-white text-[9px] font-black tracking-tight">LOST</span>
                  </div>
                  <div className="px-1.5 flex items-center justify-center min-w-[24px]">
                    <span className="font-bold text-xs text-red-700 dark:text-red-400">{visitorLostToday}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Visitor Comparison & Average + Lost Descriptions (side by side) */}
            <div className="flex items-start justify-between gap-4 mt-3 pt-3 border-t border-gray-100">
              {/* Left: Comparison & Average */}
              <div className="flex flex-col gap-1">
                {/* Comparison with yesterday */}
                <div className="flex items-center gap-1.5 text-xs">
                  {visitorToday > visitorYesterday ? (
                    <>
                      <span className="text-green-600">📈</span>
                      <span className="font-semibold text-green-600">+{visitorToday - visitorYesterday} tamu dari kemarin</span>
                    </>
                  ) : visitorToday < visitorYesterday ? (
                    <>
                      <span className="text-red-500">📉</span>
                      <span className="font-semibold text-red-500">{visitorToday - visitorYesterday} tamu dari kemarin</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-500">➖</span>
                      <span className="font-medium text-gray-500">Sama seperti kemarin</span>
                    </>
                  )}
                </div>
                {/* Monthly average */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>📊</span>
                  <span>Rata-rata: <span className="font-semibold text-blue-600">{avgVisitorMonth} tamu/hari</span></span>
                </div>
              </div>

              {/* Right: Lost Descriptions */}
              {lostDescriptions.length > 0 && (
                <div className="text-[10px] text-right space-y-0.5">
                  {lostDescriptions.map((desc, i) => (
                    <div key={i} className="line-clamp-1 font-semibold text-red-600 dark:text-red-400">• {desc}</div>
                  ))}
                </div>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Profit Summary */}
        {/* <Card className="mb-6 border-t-4 border-t-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Laba Bersih Keseluruhan</span>
              <ArrowUpRight className="h-4 w-4 text-green-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              let totalProfit = 0;
              transactions.filter(trx => trx.status === "completed").forEach(trx => {
                trx.items.forEach(item => {
                  let purchasePrice = (item as any).purchasePrice;
                  if (purchasePrice === undefined) {
                    const prod = products.find(p => p.name === item.name && (p as any).sku === (item as any).sku);
                    purchasePrice = (prod as any)?.purchasePrice || 0;
                  }
                  if (item.type === 'product') totalProfit += (item.price - purchasePrice) * item.quantity;
                });
              });
              return <div className="text-3xl font-bold text-green-600">{formatCurrency(totalProfit)}</div>;
            })()}
            <div className="text-sm text-muted-foreground mt-2">Akumulasi seluruh transaksi produk (harga jual - harga beli)</div>
          </CardContent>
        </Card> */}


        {/* Visitors Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            {/* Hutang Button with Badge */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 text-red-700 relative"
              onClick={() => {
                refreshHutang();
                setHutangDialogOpen(true);
              }}
            >
              💳 Hutang
              {activeHutangCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-sm animate-pulse">
                  {activeHutangCount}
                </span>
              )}
            </Button>
            {/* Notes/Reminder Button with Badge */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs border-purple-200 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 text-purple-700 relative"
              onClick={() => {
                refreshNotes();
                setNotesDialogOpen(true);
              }}
            >
              <StickyNote className="h-3.5 w-3.5 mr-1.5" />
              Catatan
              {notesList.filter(n => n.type !== 'hutang' && !n.completed).length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-sm animate-pulse">
                  {notesList.filter(n => n.type !== 'hutang' && !n.completed).length}
                </span>
              )}
            </Button>

            {/* Spacer to push Lost button to right */}
            <div className="flex-1" />

            {/* Lost Button */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs border-red-300 bg-red-100 hover:bg-red-200 hover:border-red-400 text-red-700 relative"
              onClick={() => { const todayStr = new Date().toISOString().split('T')[0]; setLostEntries(getLostEntriesByDate(todayStr)); setLostDialogOpen(true); }}
            >
              ❌ Catat Lost ({visitorLostToday})
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Tamu Sebelum Jam 12 */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3">
              <div className="mb-2">
                <span className="text-xs font-medium text-green-700">🌅 Sebelum Jam 12</span>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" className="flex-1 h-9 text-sm bg-green-100 hover:bg-green-200 border-green-300 text-green-700 font-semibold" size="sm" onClick={() => {
                  addVisitorBefore12();
                  const todayStr = new Date().toISOString().split('T')[0];
                  const { visitors } = getVisitorStatsByDate(todayStr);
                  const { before12, after12 } = getVisitorStatsByTime(todayStr);
                  setVisitorToday(visitors);
                  setVisitorBefore12(before12);
                  setVisitorAfter12(after12);
                }}>+1</Button>
                <Button variant="outline" size="sm" className="h-9 w-9 text-sm text-green-600 hover:text-red-500 hover:bg-red-50 border-green-300" onClick={() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  if (removeVisitorBefore12(todayStr)) {
                    const { visitors } = getVisitorStatsByDate(todayStr);
                    const { before12, after12 } = getVisitorStatsByTime(todayStr);
                    setVisitorToday(visitors);
                    setVisitorBefore12(before12);
                    setVisitorAfter12(after12);
                  }
                }}>-1</Button>
              </div>
            </div>
            {/* Tamu Setelah Jam 12 */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-3">
              <div className="mb-2">
                <span className="text-xs font-medium text-orange-700">🌞 Setelah Jam 12</span>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" className="flex-1 h-9 text-sm bg-orange-100 hover:bg-orange-200 border-orange-300 text-orange-700 font-semibold" size="sm" onClick={() => {
                  addVisitorAfter12();
                  const todayStr = new Date().toISOString().split('T')[0];
                  const { visitors } = getVisitorStatsByDate(todayStr);
                  const { before12, after12 } = getVisitorStatsByTime(todayStr);
                  setVisitorToday(visitors);
                  setVisitorBefore12(before12);
                  setVisitorAfter12(after12);
                }}>+1</Button>
                <Button variant="outline" size="sm" className="h-9 w-9 text-sm text-orange-600 hover:text-red-500 hover:bg-red-50 border-orange-300" onClick={() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  if (removeVisitorAfter12(todayStr)) {
                    const { visitors } = getVisitorStatsByDate(todayStr);
                    const { before12, after12 } = getVisitorStatsByTime(todayStr);
                    setVisitorToday(visitors);
                    setVisitorBefore12(before12);
                    setVisitorAfter12(after12);
                  }
                }}>-1</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Google Sheets + Telegram Quick Action */}
        <Card className="mb-6 border-l-4 border-l-emerald-500 bg-gradient-to-r from-emerald-50 via-green-50 to-white shadow-sm">
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-emerald-600" />
              Laporan Penjualan Harian
            </h3>
            {/* Single Button: Send All Data */}
            <Button
              onClick={sendToGoogleSheets}
              disabled={sendingToSheets || (allSoldItemsToday.length === 0 && visitorBefore12 === 0 && visitorAfter12 === 0)}
              className="w-full bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 hover:from-emerald-600 hover:via-green-600 hover:to-teal-600 text-white flex items-center justify-center gap-3 h-14 text-base font-bold shadow-lg rounded-xl transition-all duration-200 hover:shadow-xl hover:scale-[1.02]"
            >
              {sendingToSheets ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Mengirim data...</span>
                </>
              ) : (
                <>
                  <ShoppingCart className="h-6 w-6" />
                  <span>Kirim Penjualan Hari Ini</span>
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Lost Dialog - Combined Add & Manage */}
        <Dialog open={lostDialogOpen} onOpenChange={(open) => {
          setLostDialogOpen(open);
          if (open) {
            const todayStr = new Date().toISOString().split('T')[0];
            setLostEntries(getLostEntriesByDate(todayStr));
          }
        }}>
          <DialogContent className="top-[5%] translate-y-0 sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader><DialogTitle>❌ Catat Tamu Lost</DialogTitle></DialogHeader>

            {/* Add New Lost Form */}
            <div className="space-y-2 pb-3 border-b">
              <label className="text-sm font-medium">Tambah Lost Baru</label>
              <div className="flex gap-2">
                <Input
                  value={lostDesc}
                  onChange={(e) => setLostDesc(e.target.value)}
                  placeholder="Contoh: Hanya tanya harga, stok kosong, dll"
                  className="flex-1"
                />
                <Button onClick={() => {
                  try {
                    addVisitorLost(lostDesc);
                    const todayStr = new Date().toISOString().split('T')[0];
                    const { lost } = getVisitorStatsByDate(todayStr);
                    setVisitorLostToday(lost);
                    setLostDescriptions(getLostDescriptionsByDate(todayStr));
                    setLostEntries(getLostEntriesByDate(todayStr));
                    setLostDesc("");
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}>+ Tambah</Button>
              </div>
            </div>

            {/* Existing Lost Entries List */}
            <div className="flex-1 overflow-y-auto space-y-1 py-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Daftar Lost Hari Ini ({lostEntries.length})</label>
              {lostEntries.length === 0 ? (
                <div className="text-center text-muted-foreground py-4 text-sm">Belum ada data lost hari ini</div>
              ) : (
                lostEntries.sort((a, b) => b.ts - a.ts).map((entry) => (
                  <div key={entry.ts} className="flex items-center gap-1 px-2 py-1 bg-muted/30 rounded border border-muted/50">
                    {editingLostTs === entry.ts ? (
                      <>
                        <Input
                          value={editingLostDesc}
                          onChange={(e) => setEditingLostDesc(e.target.value)}
                          className="flex-1 h-6 text-xs"
                        />
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => {
                          if (updateLostDescription(entry.ts, editingLostDesc)) {
                            const todayStr = new Date().toISOString().split('T')[0];
                            setLostEntries(getLostEntriesByDate(todayStr));
                            setLostDescriptions(getLostDescriptionsByDate(todayStr));
                          }
                          setEditingLostTs(null);
                        }}>✓</Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingLostTs(null)}>✕</Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-xs truncate">{entry.description}</span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-blue-500" onClick={() => { setEditingLostTs(entry.ts); setEditingLostDesc(entry.description); }}>
                          <Pencil className="h-2.5 w-2.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500" onClick={() => {
                          if (removeLostByTimestamp(entry.ts)) {
                            const todayStr = new Date().toISOString().split('T')[0];
                            const { lost } = getVisitorStatsByDate(todayStr);
                            setVisitorLostToday(lost);
                            setLostEntries(getLostEntriesByDate(todayStr));
                            setLostDescriptions(getLostDescriptionsByDate(todayStr));
                          }
                        }}>
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" className="w-full" onClick={() => setLostDialogOpen(false)}>Tutup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Success Popup */}
        <Dialog open={successPopupOpen} onOpenChange={setSuccessPopupOpen}>
          <DialogContent className="max-w-xs">
            <div className="flex flex-col items-center justify-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-4xl">✅</span>
              </div>
              <h3 className="text-lg font-semibold text-center mb-2">Berhasil!</h3>
              <p className="text-sm text-muted-foreground text-center whitespace-pre-line">{successMessage}</p>
            </div>
            <DialogFooter>
              <Button className="w-full bg-green-500 hover:bg-green-600" onClick={() => setSuccessPopupOpen(false)}>
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Recently Sold */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-muted-foreground">Recently Sold</h3>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {soldItemsToday.length > 0 ? (
                  soldItemsToday.map((item, index) => (
                    <div key={index} className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          {/* Tanggal pembelian dengan icon */}
                          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-blue-500" />
                            <span className="text-blue-600">{new Date(item.soldAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{item.sku}</div>
                          <div className="font-medium text-sm truncate">{item.name}</div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="text-muted-foreground">{item.quantity} x {formatCurrency(item.price)}</div>
                          <div className="font-medium text-amber-600">{formatCurrency(item.total)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-muted-foreground">Belum ada barang terjual hari ini</div>
                )}
              </div>
              {soldItemsTotalPages > 1 && (
                <div className="flex justify-center items-center gap-2 py-3 border-t">
                  <Button variant="outline" size="sm" onClick={() => setSoldItemsPage(p => Math.max(1, p - 1))} disabled={soldItemsPage === 1}>&lt;</Button>
                  <span className="text-xs">Hal {soldItemsPage}/{soldItemsTotalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setSoldItemsPage(p => Math.min(soldItemsTotalPages, p + 1))} disabled={soldItemsPage === soldItemsTotalPages}>&gt;</Button>
                </div>
              )}
              <div className="p-4 border-t">
                <Button variant="outline" className="w-full" size="sm" onClick={() => navigate("/history")}>
                  Lihat Detail Transaksi <ArrowUpRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Notes List Dialog */}
        <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
          <DialogContent className="top-[5%] translate-y-0 max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  <StickyNote className="h-5 w-5 text-purple-600" />
                  Catatan & Belanja
                </DialogTitle>
                {notesList.filter(n => n.type !== 'hutang').length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 font-bold"
                    onClick={() => {
                      if (confirm('Hapus semua catatan?')) {
                        clearNotes(false);
                        refreshNotes();
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> HAPUS SEMUA
                  </Button>
                )}
              </div>
              <DialogDescription>
                {notesList.filter(n => n.type !== 'hutang' && !n.completed).length > 0
                  ? `${notesList.filter(n => n.type !== 'hutang' && !n.completed).length} catatan aktif`
                  : 'Tidak ada catatan aktif'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-[50vh] pr-1">
              {/* Filter tabs */}
              <div className="flex gap-2 sticky top-0 bg-white z-10 pb-2">
                <Button
                  variant={!showCompletedNotes ? "default" : "outline"}
                  size="sm"
                  className={`text-xs flex-1 ${!showCompletedNotes ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setShowCompletedNotes(false)}
                >
                  Aktif ({notesList.filter(n => n.type !== 'hutang' && !n.completed).length})
                </Button>
                <Button
                  variant={showCompletedNotes ? "default" : "outline"}
                  size="sm"
                  className={`text-xs flex-1 ${showCompletedNotes ? 'bg-gray-600 hover:bg-gray-700' : ''}`}
                  onClick={() => setShowCompletedNotes(true)}
                >
                  Selesai ({notesList.filter(n => n.type !== 'hutang' && n.completed).length})
                </Button>
              </div>

              {/* Notes list - exclude hutang type */}
              {notesList
                .filter(n => n.type !== 'hutang') // Exclude hutang - shown in separate Hutang dialog
                .filter(n => showCompletedNotes ? n.completed : !n.completed)
                .map(note => (
                  <div
                    key={note.id}
                    className={`p-2 rounded-lg border transition-all ${note.completed
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : note.type === 'hutang'
                        ? 'bg-red-50 border-red-200 shadow-sm'
                        : note.type === 'belanja'
                          ? 'bg-green-50 border-green-200 shadow-sm'
                          : 'bg-blue-50 border-blue-200 shadow-sm'
                      }`}
                  >
                    {/* 1. Header Row (Labels Left, Actions Right) */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${note.type === 'hutang'
                          ? 'bg-red-200 text-red-800'
                          : note.type === 'belanja'
                            ? 'bg-green-200 text-green-800'
                            : 'bg-blue-200 text-blue-800'
                          }`}>
                          {note.type === 'hutang' ? '💰 Hutang' : note.type === 'belanja' ? '🛒 Belanja' : '📝 Catatan'}
                        </span>

                        {note.completed && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-200 text-green-800 font-bold uppercase whitespace-nowrap">
                            ✓ Selesai
                          </span>
                        )}

                        <div className="flex items-center gap-1 opacity-70">
                          <Calendar className="h-2.5 w-2.5 text-blue-500" />
                          <span className="text-[8px] text-blue-600 font-bold whitespace-nowrap">
                            {new Date(note.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Actions Group (Horizontal) */}
                      <div className="flex items-center gap-1 shrink-0">

                        {!note.completed && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 w-6 p-0 bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-50"
                            onClick={() => handleStartEditNote(note)}
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 w-6 p-0 bg-red-50 border-red-200 text-red-500 hover:bg-red-50"
                          onClick={() => setConfirmDeleteNoteId(note.id)}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>

                    {/* 2. Content Section (Vertical flow) */}
                    <div className="flex-1 min-w-0">
                      {/* Name & Amount Row */}
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-[13px] font-black text-gray-800 leading-none uppercase tracking-tight shrink-0">
                          {note.type === 'hutang' ? (note.customerName || 'Tanpa Nama') : note.content}
                        </div>

                        <div className="flex-1 h-[1px] bg-gray-200/50" />

                        {(note.type === 'hutang' || note.type === 'belanja') && note.amount && (
                          <div className={`text-[13px] font-black ${note.type === 'hutang' ? 'text-red-600 bg-red-100/80 border-red-200/50' : 'text-green-600 bg-green-100/80 border-green-200/50'} px-2 py-0.5 rounded border shadow-sm leading-none shrink-0`}>
                            {formatCurrency(note.amount)}
                          </div>
                        )}

                        <div className="flex-1 h-[1px] bg-gray-200/50" />
                      </div>

                      {/* Description Area (Adaptive Height) */}
                      <div className={`text-[11px] leading-snug whitespace-pre-wrap ${note.type === 'hutang' ? 'text-gray-600' : 'text-gray-500'} ${note.completed ? 'line-through' : ''}`}>
                        {note.type === 'hutang' ? (
                          note.content
                        ) : (
                          note.type === 'belanja' ? 'Kebutuhan belanja harian' : 'Catatan pribadi'
                        )}
                      </div>
                    </div>
                  </div>
                ))}

              {notesList.filter(n => showCompletedNotes ? n.completed : !n.completed).length === 0 && (
                <div className="text-center py-6 text-muted-foreground">
                  <StickyNote className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{showCompletedNotes ? 'Belum ada catatan yang selesai' : 'Belum ada catatan aktif'}</p>
                </div>
              )}
            </div>

            <div className="border-t pt-3 mt-2 flex flex-col gap-2">
              <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5 uppercase tracking-wider">
                <Plus className="h-3 w-3" /> Tambah Catatan Baru :
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[10px] h-9 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 font-bold"
                  onClick={() => {
                    setNewNoteType('pengingat');
                    setAddNoteDialogOpen(true);
                    setNotesDialogOpen(false);
                  }}
                >
                  📝 CATATAN
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[10px] h-9 bg-green-50 border-green-200 text-green-700 hover:bg-green-100 font-bold"
                  onClick={() => {
                    setNewNoteType('belanja');
                    setAddNoteDialogOpen(true);
                    setNotesDialogOpen(false);
                  }}
                >
                  🛒 BELANJA
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hutang List Dialog */}
        <Dialog open={hutangDialogOpen} onOpenChange={setHutangDialogOpen}>
          <DialogContent className="top-[5%] translate-y-0 max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-red-600" />
                  💳 Daftar Hutang
                </DialogTitle>
                {notesList.filter(n => n.type === 'hutang').length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 font-bold"
                    onClick={() => {
                      if (confirm('Hapus semua hutang yang sudah LUNAS?')) {
                        clearHutang(true);
                        refreshHutang();
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> HAPUS LUNAS
                  </Button>
                )}
              </div>
              <DialogDescription>
                {activeHutangCount > 0
                  ? `${activeHutangCount} hutang aktif - Total: ${formatCurrency(totalHutangAmount)}`
                  : 'Tidak ada hutang aktif'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-[50vh] pr-1">
              {/* Filter tabs - same as Notes */}
              <div className="flex gap-2 sticky top-0 bg-white z-10 pb-2">
                <Button
                  variant={!showCompletedNotes ? "default" : "outline"}
                  size="sm"
                  className={`text-xs flex-1 ${!showCompletedNotes ? 'bg-red-600 hover:bg-red-700' : ''}`}
                  onClick={() => setShowCompletedNotes(false)}
                >
                  Belum Lunas ({notesList.filter(n => n.type === 'hutang' && !n.completed).length})
                </Button>
                <Button
                  variant={showCompletedNotes ? "default" : "outline"}
                  size="sm"
                  className={`text-xs flex-1 ${showCompletedNotes ? 'bg-gray-600 hover:bg-gray-700' : ''}`}
                  onClick={() => setShowCompletedNotes(true)}
                >
                  Lunas ({notesList.filter(n => n.type === 'hutang' && n.completed).length})
                </Button>
              </div>

              {/* Hutang list - same card style as Notes */}
              {notesList
                .filter(n => n.type === 'hutang')
                .filter(n => showCompletedNotes ? n.completed : !n.completed)
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map(hutang => (
                  <div
                    key={hutang.id}
                    className={`p-2 rounded-lg border transition-all ${hutang.completed
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : 'bg-red-50 border-red-200 shadow-sm'
                      }`}
                  >
                    {/* 1. Header Row (Labels Left, Actions Right) */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-red-200 text-red-800">
                          💰 Hutang
                        </span>

                        {hutang.completed && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-200 text-green-800 font-bold uppercase whitespace-nowrap">
                            ✓ Lunas
                          </span>
                        )}

                        <div className="flex items-center gap-1 opacity-70">
                          <Calendar className="h-2.5 w-2.5 text-red-500" />
                          <span className="text-[8px] text-red-600 font-bold whitespace-nowrap">
                            {new Date(hutang.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center shrink-0">
                        {!hutang.completed && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 bg-green-100 border-green-400 text-green-700 hover:bg-green-200 shadow-sm"
                            onClick={() => setConfirmCompleteHutangId(hutang.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 2. Content Section (Vertical flow) */}
                    <div className="flex-1 min-w-0">
                      {/* Name & Amount Row */}
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-[13px] font-black text-gray-800 leading-none uppercase tracking-tight shrink-0">
                          {hutang.customerName || 'Tanpa Nama'}
                        </div>

                        <div className="flex-1 h-[1px] bg-gray-200/50" />

                        {hutang.amount && (
                          <div className="text-[13px] font-black text-red-600 bg-red-100/80 border-red-200/50 px-2 py-0.5 rounded border shadow-sm leading-none shrink-0">
                            {formatCurrency(hutang.amount)}
                          </div>
                        )}

                        <div className="flex-1 h-[1px] bg-gray-200/50" />
                      </div>

                      {/* Description Area (Adaptive Height) */}
                      <div className={`text-[11px] leading-snug whitespace-pre-wrap text-gray-600 ${hutang.completed ? 'line-through' : ''}`}>
                        {hutang.content}
                      </div>
                    </div>
                  </div>
                ))}

              {/* Empty state */}
              {notesList.filter(n => n.type === 'hutang' && (showCompletedNotes ? n.completed : !n.completed)).length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="text-4xl mb-2">{showCompletedNotes ? '📋' : '✨'}</div>
                  <div className="font-medium">{showCompletedNotes ? 'Belum ada hutang lunas' : 'Tidak ada hutang!'}</div>
                  <div className="text-xs">{showCompletedNotes ? 'Hutang yang dilunasi akan muncul di sini' : 'Semua hutang sudah lunas'}</div>
                </div>
              )}
            </div>

            <DialogFooter className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setHutangDialogOpen(false)}
              >
                Tutup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add/Edit Note Dialog */}
        <Dialog open={addNoteDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setAddNoteDialogOpen(false);
            setEditNoteId(null);
            setNewNoteContent("");
            setNewNoteCustomerName("");
            setNewNoteAmount("");
            setNewNoteType("pengingat");
            // Reopen notes list dialog
            setNotesDialogOpen(true);
          }
        }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editNoteId ? 'Edit Catatan' : 'Tambah Catatan'}</DialogTitle>
              <DialogDescription>{editNoteId ? 'Ubah catatan yang sudah ada' : 'Buat catatan pengingat baru'}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Type Select */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Jenis Catatan</label>
                <Select value={newNoteType} onValueChange={(v) => setNewNoteType(v as Note['type'])}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih jenis" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pengingat">🔔 Pengingat</SelectItem>
                    <SelectItem value="belanja">🛒 Belanja Harian</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount (for belanja) with Rp prefix */}
              {newNoteType === 'belanja' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Total Belanja</label>
                  <div className="flex items-center border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-purple-500">
                    <span className="px-3 py-2 bg-gray-100 border-r text-sm text-gray-600 font-medium">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newNoteAmount}
                      onChange={(e) => {
                        // Remove non-digits, then format with thousand separator
                        const cleanValue = e.target.value.replace(/\D/g, '');
                        const formatted = cleanValue ? parseInt(cleanValue).toLocaleString('id-ID') : '';
                        setNewNoteAmount(formatted);
                      }}
                      placeholder="50.000"
                      className="flex-1 px-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Catatan</label>
                <Textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Isi catatan..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => {
                setAddNoteDialogOpen(false);
                setEditNoteId(null);
                setNewNoteContent("");
                setNewNoteCustomerName("");
                setNewNoteAmount("");
                setNewNoteType("hutang");
                // Reopen notes list dialog
                setNotesDialogOpen(true);
              }}>
                Batal
              </Button>
              <Button
                className="bg-purple-600 hover:bg-purple-700"
                onClick={handleSaveNote}
                disabled={!newNoteContent.trim()}
              >
                {editNoteId ? 'Simpan Perubahan' : 'Simpan'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm Complete Note Dialog */}
        <Dialog open={!!confirmCompleteNoteId} onOpenChange={(open) => !open && setConfirmCompleteNoteId(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-center">Selesaikan Catatan?</DialogTitle>
              <DialogDescription className="text-center">
                Catatan akan ditandai sebagai selesai dan dipindahkan ke tab "Selesai"
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setConfirmCompleteNoteId(null)}
              >
                Batal
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => confirmCompleteNoteId && handleCompleteNote(confirmCompleteNoteId)}
              >
                <Check className="h-4 w-4 mr-1" />
                Ya, Selesai
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirm Delete Note Dialog */}
        <Dialog open={!!confirmDeleteNoteId} onOpenChange={(open) => !open && setConfirmDeleteNoteId(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-center">Hapus Catatan?</DialogTitle>
              <DialogDescription className="text-center">
                Catatan akan dihapus permanen dan tidak bisa dikembalikan
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setConfirmDeleteNoteId(null)}
              >
                Batal
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (confirmDeleteNoteId) {
                    handleDeleteNote(confirmDeleteNoteId);
                    setConfirmDeleteNoteId(null);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Ya, Hapus
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {/* Confirm Complete Hutang Dialog */}
        <Dialog open={!!confirmCompleteHutangId} onOpenChange={(open) => !open && setConfirmCompleteHutangId(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-center">
                Lunaskan Hutang{confirmCompleteHutangId && (() => {
                  const hutang = notesList.find(n => n.id === confirmCompleteHutangId);
                  return hutang?.customerName ? ` (${hutang.customerName})` : '';
                })()}?
              </DialogTitle>
              <DialogDescription className="text-center">
                Hutang akan ditandai sebagai LUNAS dan dipindahkan ke tab "Lunas"
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setConfirmCompleteHutangId(null)}
              >
                Batal
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => {
                  if (confirmCompleteHutangId) {
                    completeNote(confirmCompleteHutangId);
                    refreshHutang();
                    setConfirmCompleteHutangId(null);
                  }
                }}
              >
                <Check className="h-4 w-4 mr-1" />
                Ya, Lunas
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirm Delete Hutang Dialog */}
        <Dialog open={!!confirmDeleteHutangId} onOpenChange={(open) => !open && setConfirmDeleteHutangId(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-center">Hapus Hutang?</DialogTitle>
              <DialogDescription className="text-center">
                Catatan hutang akan dihapus permanen dan tidak bisa dikembalikan
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => setConfirmDeleteHutangId(null)}
              >
                Batal
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (confirmDeleteHutangId) {
                    deleteNote(confirmDeleteHutangId);
                    refreshHutang();
                    setConfirmDeleteHutangId(null);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Ya, Hapus
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </main >
    </div >
  );
};

export default Dashboard;