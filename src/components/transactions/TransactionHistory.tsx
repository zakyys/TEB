import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, normalizeSearch, collapseLeadingZeros, matchesLoose, getSearchRelevance } from "@/lib/utils";
import { safeGetAllTransactions, safeSaveAllTransactions, safeInitAndMigrate } from "@/lib/indexedDB";
import { getProducts, setProducts, pushStockToSheet } from "@/lib/productCache";
import { DUMMY_TRANSACTIONS, DUMMY_PRODUCTS } from "@/lib/dummyData";
import { Search, Calendar, Printer, RotateCcw, ChevronRight, ChevronLeft, Info, X, ArrowRight, Banknote, RefreshCw, ShoppingCart, Pencil, Trash2, Minus, Plus, ScanBarcode, Tag } from "lucide-react";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { saveAs } from "file-saver";
import { useToast } from "@/components/ui/use-toast";
import { getDailyStatsInRange } from "@/lib/visitors";
import { getExchanges, ExchangeRecord, addRefund, getRefunds, RefundRecord, addExchange, deleteExchange, deleteRefund } from "@/lib/exchange";
import { getNotes, deleteNoteByTransactionId, updateNote, completeNote } from "@/lib/notes";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProfileData } from "@/types/pos";

type ItemType = "product" | "service";

interface TransactionItem {
  name: string;
  quantity: number;
  price: number;
  type: ItemType;
  sku?: string;
  purchasePrice?: number;
  sameDayRefunded?: boolean;
  refunded?: boolean;
  refundDate?: string;
  refundedQty?: number;
}

interface Transaction {
  id: string;
  date: string; // ISO string
  customer: string;
  total: number;
  status: "completed" | "pending" | "cancelled" | "refunded";
  items: TransactionItem[];
  discountPercent?: string;
  discountAmount?: number;
}

const BarcodeScanner = ({ onDetected, onStart }: { onDetected: (code: string) => void, onStart?: () => void }) => {
  const controlsRef = useRef<any | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);

  const stopScanner = () => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
  };

  useEffect(() => {
    if (scanning) {
      const codeReader = new BrowserMultiFormatReader();
      const videoElement = videoRef.current;
      if (videoElement) {
        codeReader.decodeFromVideoDevice(undefined, videoElement, (result, error, controls) => {
          if (controls && !controlsRef.current) controlsRef.current = controls;
          if (result && controlsRef.current) {
            onDetected(result.getText());
            stopScanner();
            setScanning(false);
          }
        });
      }
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [scanning, onDetected]);

  return (
    <div className="mb-4">
      {scanning ? (
        <div className="border border-amber-400 rounded-lg p-2 bg-amber-50">
          <video ref={videoRef} className="w-full max-h-40 rounded-md" />
          <button
            className="mt-2 w-full py-2 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md flex items-center justify-center gap-1"
            onClick={() => setScanning(false)}
          >
            <X className="h-3 w-3" /> Stop Scan
          </button>
        </div>
      ) : (
        <button
          className="w-full py-2.5 px-3 text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-full transition-colors shadow-sm flex items-center justify-center gap-2"
          onClick={() => { if (onStart) onStart(); setScanning(true); }}
        >
          <ScanBarcode className="h-5 w-5" /> Scan Barcode (Kamera)
        </button>
      )}
    </div>
  );
};

type TabValue = "all" | "completed" | "history";

const TransactionHistory: React.FC = () => {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Default: show all transactions (no date filter)
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  // If opening detail from "Item Terjual", capture the clicked item index
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [visitorDetail, setVisitorDetail] = useState<{ date: string; notes: string[] } | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>("completed");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [tukarFilter, setTukarFilter] = useState<'all' | 'today' | 'month'>('all');

  // Exchange feature states
  const [showExchangeOptions, setShowExchangeOptions] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showExchangeConfirm, setShowExchangeConfirm] = useState(false);
  const [productPickerSearch, setProductPickerSearch] = useState("");
  const [productPickerPage, setProductPickerPage] = useState(1);
  const [selectedNewProduct, setSelectedNewProduct] = useState<any>(null);
  const [exchangeItemToReturn, setExchangeItemToReturn] = useState<{ item: TransactionItem, index: number } | null>(null);
  const [customPrice, setCustomPrice] = useState<number | null>(null); // Custom price for exchange
  const [exchangeQuantity, setExchangeQuantity] = useState(1);
  const [returnQuantity, setReturnQuantity] = useState(1); // Qty yang akan dikembalikan/ditukar dari barang lama

  // State for delete confirmation (2 step)
  const [deleteConfirm, setDeleteConfirm] = useState<{ transactionId: string; itemIndex: number; step: 1 | 2 } | null>(null);

  // State for editing quantity
  const [editingItem, setEditingItem] = useState<{ transactionId: string; itemIndex: number; currentQty: number } | null>(null);

  // State for exchange delete confirmation
  const [exchangeToDelete, setExchangeToDelete] = useState<ExchangeRecord | null>(null);

  // State for refund delete confirmation
  const [refundToDelete, setRefundToDelete] = useState<RefundRecord | null>(null);

  // State for refund confirmation
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);

  // State for highlighted exchange (from navigation)
  const [highlightedExchangeId, setHighlightedExchangeId] = useState<string | null>(null);
  // State for flashing card after undo refund
  const [flashingCard, setFlashingCard] = useState<{ transactionId: string; itemIndex: number } | null>(null);
  // State for undo refund confirmation (simple: transactionId + itemIndex)
  const [undoRefundConfirm, setUndoRefundConfirm] = useState<{ transactionId: string; itemIndex: number } | null>(null);
  const location = useLocation();
  const exchangeCardRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Pagination state for "Item Terjual" tab
  const [itemTerjualPage, setItemTerjualPage] = useState(1);
  // Pagination state for "Transaksi" tab
  const [transaksiPage, setTransaksiPage] = useState(1);
  // Pagination state for "Tukar" tab  
  const [tukarPage, setTukarPage] = useState(1);
  const ITEMS_PER_PAGE = 25;

  // Reset pagination when filters change
  useEffect(() => {
    setItemTerjualPage(1);
    setTransaksiPage(1);
    setTukarPage(1);
  }, [searchQuery, dateRange]);

  // Load transactions from IndexedDB (safe - won't crash)
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeRecord[]>([]);
  const [refundHistory, setRefundHistory] = useState<RefundRecord[]>([]);

  const loadData = async () => {
    // Initialize IndexedDB and migrate from localStorage if needed (safe - won't crash)
    await safeInitAndMigrate();

    // Load from IndexedDB (safe - returns [] on error)
    const stored = await safeGetAllTransactions();
    if (stored.length > 0) {
      setTransactions(stored as Transaction[]);
    } else {
      // Fallback to localStorage or dummy data
      const lsData = getFromLS<Transaction[]>(LS_KEYS.TRANSACTIONS, []);
      if (lsData.length > 0) {
        setTransactions(lsData);
        // Save to IndexedDB for future use (safe - won't crash)
        await safeSaveAllTransactions(lsData);
      } else {
        setTransactions(DUMMY_TRANSACTIONS as Transaction[]);
      }
    }
    // Load history
    setExchangeHistory(getExchanges());
    setRefundHistory(getRefunds());
  };

  useEffect(() => {
    loadData();
  }, []);

  // Also refresh when tab changes to history
  useEffect(() => {
    if (activeTab === 'history') {
      setExchangeHistory(getExchanges());
      setRefundHistory(getRefunds());
    }
  }, [activeTab]);

  // Handle navigation state for highlighting exchange
  useEffect(() => {
    const state = location.state as { highlightExchangeId?: string; tab?: string } | null;
    if (state?.highlightExchangeId) {
      // Switch to history tab
      if (state.tab === 'history') {
        setActiveTab('history');
      }
      // Set highlighted exchange
      setHighlightedExchangeId(state.highlightExchangeId);

      // Scroll to the card after a short delay (wait for render)
      setTimeout(() => {
        const cardEl = exchangeCardRefs.current[state.highlightExchangeId!];
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);

      // Remove highlight after 3 seconds
      setTimeout(() => {
        setHighlightedExchangeId(null);
      }, 3000);

      // Clear location state to prevent re-highlighting on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const matchesDate = (iso: string) => {
    const d = iso.split("T")[0];
    if (dateRange.start && d < dateRange.start) return false;
    if (dateRange.end && d > dateRange.end) return false;
    return true;
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (!matchesDate(t.date)) return false;
      if (!searchQuery) return true;

      const q = searchQuery.toLowerCase();

      // Search by transaction ID or customer
      if (t.id.toLowerCase().includes(q) || t.customer.toLowerCase().includes(q)) {
        return true;
      }

      // Search by item name or SKU (using loose matching like POS)
      const hasMatchingItem = t.items.some(item =>
        matchesLoose(item.name, searchQuery) ||
        matchesLoose(item.sku, searchQuery)
      );

      return hasMatchingItem;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchQuery, dateRange]);

  // Date-only filtered transactions (no search), for item-level filtering
  const dateFilteredTransactions = useMemo(() => {
    return transactions.filter(t => matchesDate(t.date));
  }, [transactions, dateRange]);


  // Export helpers (flatten items)
  const getExportRows = () => {
    const products = getProducts();
    const visitorLogs = getFromLS<any[]>(LS_KEYS.VISITORS_LOG, []);
    const lostLogs = getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []);

    const rows: any[] = [];
    filteredTransactions
      .filter(t => t.status === "completed")
      .forEach(trx => {
        const dateOnly = trx.date.split("T")[0];
        const tamu = visitorLogs.filter((e) => e.date === dateOnly).length;
        const lost = lostLogs.filter((e) => e.date === dateOnly).length;
        trx.items.forEach(item => {
          let sku = item.sku;
          if (!sku) {
            const prod = products.find(p => p.name === item.name);
            sku = prod?.sku || "-";
          }
          rows.push({
            tanggal: dateOnly,
            id_transaksi: trx.id,
            kode: sku,
            nama: item.name,
            qty: item.quantity,
            harga_jual_per_pcs: item.price,
            total: item.price * item.quantity,
            tamu_harian: tamu,
            tamu_lost_harian: lost,
          });
        });
      });
    return rows;
  };

  const handleExportCSV = () => {
    const ws = XLSX.utils.json_to_sheet(getExportRows());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv" });
    saveAs(blob, `penjualan_${dateRange.start || "all"}_${dateRange.end || "all"}.csv`);
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(getExportRows());
    XLSX.utils.book_append_sheet(wb, ws, "Penjualan");

    // Visitors sheet with notes
    const allLost = getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []);
    const vRows = getDailyStatsInRange(dateRange.start || undefined, dateRange.end || undefined).map(r => ({
      date: r.date,
      visitors: r.visitors,
      lost: r.lost,
      lost_notes: allLost.filter(e => e.date === r.date).map(e => e.description).join(" | "),
    }));
    if (vRows.length) {
      const ws2 = XLSX.utils.json_to_sheet(vRows);
      XLSX.utils.book_append_sheet(wb, ws2, "Visitors");
    }

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buf], { type: "application/octet-stream" }), `penjualan_${dateRange.start || "all"}_${dateRange.end || "all"}.xlsx`);
  };

  const handleExportPDF = () => {
    const rows = getExportRows();
    const doc = new jsPDF();
    doc.text("Laporan Penjualan", 14, 10);
    (doc as any).autoTable({
      head: [["Tanggal", "ID Transaksi", "Kode", "Nama", "Qty", "Total", "Tamu", "Lost"]],
      body: rows.map(r => [r.tanggal, r.id_transaksi, r.kode, r.nama, r.qty, r.total, r.tamu_harian, r.tamu_lost_harian]),
      startY: 20,
    });
    doc.save(`penjualan_${dateRange.start || "all"}_${dateRange.end || "all"}.pdf`);
  };

  // Visitors export
  const handleExportVisitorsCSV = () => {
    const lostLogs = getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []);
    const rows = getDailyStatsInRange(dateRange.start || undefined, dateRange.end || undefined).map(r => ({
      tanggal: r.date,
      tamu: r.visitors,
      lost: r.lost,
      keterangan_lost: lostLogs.filter(e => e.date === r.date).map(e => e.description).join(" | "),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv" });
    saveAs(blob, `visitors_${dateRange.start || "all"}_${dateRange.end || "all"}.csv`);
  };

  const handleExportVisitorsPDF = () => {
    const lostLogs = getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []);
    const rows = getDailyStatsInRange(dateRange.start || undefined, dateRange.end || undefined);
    const doc = new jsPDF();
    doc.text("Laporan Visitors", 14, 10);
    (doc as any).autoTable({
      head: [["Tanggal", "Tamu", "Lost", "Keterangan Lost"]],
      body: rows.map(r => [r.date, r.visitors, r.lost, lostLogs.filter(e => e.date === r.date).map(e => e.description).join(" | ")]),
      startY: 20,
    });
    doc.save(`visitors_${dateRange.start || "all"}_${dateRange.end || "all"}.pdf`);
  };

  // Delete individual item from transaction and return stock
  const deleteTransactionItem = async (transactionId: string, itemIndex: number) => {
    // Get the item to delete first to return stock
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction) return;

    const itemToDelete = transaction.items[itemIndex];
    if (!itemToDelete) return;

    // Check if this is a refunded item (undo refund scenario - any refund flag)
    const isRefundedItem = (itemToDelete as any).sameDayRefunded || (itemToDelete as any).refunded || (itemToDelete as any).partiallyRefunded;

    if (isRefundedItem) {
      // UNDO REFUND: Merge qty back to original card (same SKU, not refunded)
      const originalItemIndex = transaction.items.findIndex((it, idx) =>
        idx !== itemIndex &&
        it.sku === itemToDelete.sku &&
        !(it as any).sameDayRefunded &&
        !(it as any).refunded
      );

      let updatedTransactions: Transaction[];
      let flashCardIndex = -1;

      if (originalItemIndex !== -1) {
        // Found original card - merge qty back
        updatedTransactions = transactions.map(t => {
          if (t.id !== transactionId) return t;

          const newItems = t.items.map((it, idx) => {
            if (idx === originalItemIndex) {
              // Add qty from deleted refunded item to original
              return { ...it, quantity: it.quantity + itemToDelete.quantity };
            }
            return it;
          }).filter((_, idx) => idx !== itemIndex); // Remove the refunded card

          // Recalculate total (exclude sameDayRefunded items)
          const newTotal = newItems.reduce((sum, it) => {
            if ((it as any).sameDayRefunded) return sum;
            return sum + (it.price * it.quantity);
          }, 0);

          return { ...t, items: newItems, total: newTotal };
        });

        // Calculate new index for flash (account for removed item)
        flashCardIndex = originalItemIndex > itemIndex ? originalItemIndex - 1 : originalItemIndex;
      } else {
        // No original card found - just remove the flag and keep item as normal
        updatedTransactions = transactions.map(t => {
          if (t.id !== transactionId) return t;

          const newItems = t.items.map((it, idx) => {
            if (idx === itemIndex) {
              // Remove ALL refund flags, item becomes normal
              const { sameDayRefunded, refundedQty, refunded, partiallyRefunded, ...cleanItem } = it as any;
              return cleanItem;
            }
            return it;
          });

          // Recalculate total
          const newTotal = newItems.reduce((sum, it) => {
            if ((it as any).sameDayRefunded) return sum;
            return sum + (it.price * it.quantity);
          }, 0);

          return { ...t, items: newItems, total: newTotal };
        });

        flashCardIndex = itemIndex;
      }

      setTransactions(updatedTransactions);
      safeSaveAllTransactions(updatedTransactions);

      // If this was a different-day refund, also delete the refund record and reduce stock
      if ((itemToDelete as any).refunded && !(itemToDelete as any).sameDayRefunded) {
        // Find and delete refund record matching this item
        const refunds = getRefunds();
        const matchingRefund = refunds.find(r =>
          r.transactionId === transactionId &&
          r.item.sku === itemToDelete.sku
        );

        if (matchingRefund) {
          deleteRefund(matchingRefund.id);
          setRefundHistory(getRefunds()); // Refresh list
        }

        // Reduce stock (refund was returned, now we're undoing it)
        const products = getProducts();
        const productIndex = products.findIndex(p => p.sku === itemToDelete.sku || p.name === itemToDelete.name);
        if (productIndex !== -1 && products[productIndex].stock !== undefined) {
          products[productIndex].stock -= itemToDelete.quantity || 1;
          setProducts(products);
          // ★ Push stock to Sheet (bidirectional sync)
          pushStockToSheet([{ sku: products[productIndex].sku, stock: products[productIndex].stock }]);
        }
      }

      // Trigger flash animation
      if (flashCardIndex !== -1) {
        setFlashingCard({ transactionId, itemIndex: flashCardIndex });
        setTimeout(() => setFlashingCard(null), 2000); // Flash for 2 seconds
      }

      setDeleteConfirm(null);
      toast({
        title: "Refund Dibatalkan",
        description: `${itemToDelete.quantity} pcs dikembalikan ke item asli`,
        variant: "default"
      });
      return;
    }

    // Normal delete flow (not refunded item)
    // Return stock
    const products = getProducts();
    const productIndex = products.findIndex(
      p => p.sku === itemToDelete.sku || p.name === itemToDelete.name
    );
    if (productIndex !== -1 && products[productIndex].stock !== undefined) {
      products[productIndex].stock += itemToDelete.quantity || 1;
      setProducts(products);
    }

    const updatedTransactions = transactions.map(t => {
      if (t.id === transactionId) {
        const newItems = t.items.filter((_, idx) => idx !== itemIndex);
        // If no items left, remove entire transaction
        if (newItems.length === 0) {
          // Jika transaksi dihapus, hapus juga catatan hutang yang terkait jika ada
          deleteNoteByTransactionId(transactionId);
          return null;
        }
        // Recalculate total
        const newTotal = newItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        return { ...t, items: newItems, total: newTotal };
      }
      return t;
    }).filter(Boolean) as Transaction[];

    setTransactions(updatedTransactions);
    safeSaveAllTransactions(updatedTransactions);

    setDeleteConfirm(null);
    toast({
      title: "Item Dihapus & Stok Kembali",
      description: "Item berhasil dihapus dan stok dikembalikan",
      variant: "default"
    });
  };

  // Update item quantity and adjust stock
  const updateItemQuantity = async (transactionId: string, itemIndex: number, newQty: number) => {
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction) return;

    const item = transaction.items[itemIndex];
    if (!item) return;

    const oldQty = item.quantity;
    const qtyDiff = oldQty - newQty; // positive = returning stock, negative = taking from stock

    // Update stock first
    const products = getProducts();
    const productIndex = products.findIndex((p: any) => p.sku === item.sku || p.name === item.name);
    if (productIndex !== -1 && products[productIndex].type === 'product') {
      products[productIndex].stock = (products[productIndex].stock || 0) + qtyDiff;
      setProducts(products);
      window.dispatchEvent(new CustomEvent('pos:products:update', { detail: products }));
    }

    // Update transaction
    const updatedTransactions = transactions.map(t => {
      if (t.id === transactionId) {
        const newItems = [...t.items];
        if (newQty <= 0) {
          // Remove item if qty is 0 or less
          newItems.splice(itemIndex, 1);
        } else {
          newItems[itemIndex] = { ...newItems[itemIndex], quantity: newQty };
        }
        // Remove transaction if no items left
        if (newItems.length === 0) return null;
        // Recalculate total
        const newTotal = newItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        return { ...t, items: newItems, total: newTotal };
      }
      return t;
    }).filter(Boolean) as Transaction[];

    setTransactions(updatedTransactions);
    safeSaveAllTransactions(updatedTransactions);

    setEditingItem(null);
    toast({
      title: qtyDiff > 0 ? "Qty Dikurangi" : "Qty Ditambah",
      description: `Qty diubah dari ${oldQty} ke ${newQty}. ${qtyDiff > 0 ? 'Stok +' + qtyDiff : 'Stok ' + qtyDiff}`,
      variant: "default"
    });
  };

  const handleTransactionClick = (t: Transaction) => {
    setSelectedTransaction(t);
    setSelectedItemIndex(null); // show all items when opened from transaction list
    setIsDialogOpen(true);
  };

  const createReturnTransaction = () => {
    if (!selectedTransaction) return;
    const trxId = selectedTransaction.id;
    const validIndex = selectedItemIndex !== null && selectedItemIndex >= 0 && selectedItemIndex < selectedTransaction.items.length;
    const products = getProducts();

    // Check if same day refund (once for entire function)
    const refundDate = new Date().toISOString().split('T')[0];
    const purchaseDate = selectedTransaction.date.split('T')[0];
    const isSameDayRefund = refundDate === purchaseDate;

    if (validIndex) {
      // Partial return: remove or reduce the selected item based on returnQuantity
      const item = selectedTransaction.items[selectedItemIndex!];
      const qtyToReturn = Math.min(returnQuantity, item.quantity); // Qty yang akan di-refund
      const deduct = item.price * qtyToReturn;

      // Get SKU once
      let sku = item.sku;
      if (!sku) {
        const prod = products.find(p => p.name === item.name);
        sku = prod?.sku || '-';
      }

      // Only log refund if different day (same day = cancel, no tracking needed)
      if (!isSameDayRefund) {
        addRefund({
          date: new Date().toISOString(),
          item: {
            sku,
            name: item.name,
            quantity: qtyToReturn,
            price: item.price
          },
          total: deduct,
          transactionId: trxId,
          originalPurchaseDate: selectedTransaction.date
        });
      }

      // Update stock (return item) - only for qtyToReturn
      const updatedProducts = products.map(p => {
        if (p.sku === sku && p.stock !== undefined) {
          return { ...p, stock: p.stock + qtyToReturn };
        }
        return p;
      });
      setProducts(updatedProducts);
      window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }));

      // ★ Push stock to Sheet (bidirectional sync)
      pushStockToSheet([{ sku, stock: updatedProducts.find((p: any) => p.sku === sku)?.stock ?? 0 }]);

      // Smart refund logic (already checked at function start)
      if (isSameDayRefund) {
        // Same day: Mark item as refunded or split for partial refund
        const updated = transactions.map(t => {
          if (t.id !== trxId) return t;
          let newItems = [...t.items];
          const remainingQty = item.quantity - qtyToReturn;

          if (remainingQty <= 0) {
            // Full refund: Mark item as fully refunded (same day)
            newItems[selectedItemIndex!] = { ...item, sameDayRefunded: true, refundedQty: qtyToReturn };
          } else {
            // Partial refund: SPLIT into 2 cards
            // 1. Update original card with remaining qty (normal)
            newItems[selectedItemIndex!] = { ...item, quantity: remainingQty };

            // 2. Add new card for refunded qty (red card)
            const refundedCard = {
              ...item,
              quantity: qtyToReturn,
              sameDayRefunded: true,
              refundedQty: qtyToReturn
            };
            // Insert refunded card right after the original
            newItems.splice(selectedItemIndex! + 1, 0, refundedCard);
          }

          // Recalculate transaction total (exclude sameDayRefunded items)
          const newTotal = newItems.reduce((sum, it) => {
            if ((it as any).sameDayRefunded) return sum; // Exclude refunded items from total
            return sum + (it.price * it.quantity);
          }, 0);

          return { ...t, items: newItems, total: newTotal };
        });
        setTransactions(updated);
        safeSaveAllTransactions(updated);
      } else {
        // Different day: Mark item as refunded or split for partial refund
        const updated = transactions.map(t => {
          if (t.id !== trxId) return t;
          let newItems = [...t.items];
          const remainingQty = item.quantity - qtyToReturn;
          const refundDateStr = new Date().toISOString(); // Store refund date

          if (remainingQty <= 0) {
            // Full refund: Mark item as fully refunded
            newItems[selectedItemIndex!] = { ...item, refunded: true, refundedQty: qtyToReturn, refundDate: refundDateStr };
          } else {
            // Partial refund: SPLIT into 2 cards (like same-day)
            // 1. Update original card with remaining qty (normal)
            newItems[selectedItemIndex!] = { ...item, quantity: remainingQty };

            // 2. Add new card for refunded qty (red card)
            const refundedCard = {
              ...item,
              quantity: qtyToReturn,
              refunded: true,
              refundedQty: qtyToReturn,
              refundDate: refundDateStr
            };
            // Insert refunded card right after the original
            newItems.splice(selectedItemIndex! + 1, 0, refundedCard);
          }

          return { ...t, items: newItems };
        });
        setTransactions(updated);
        safeSaveAllTransactions(updated);
      }

      // ★ UPDATE HUTANG NOTE: Kurangi jumlah hutang jika transaksi ini adalah hutang
      const isHutangTrx = (selectedTransaction as any).paymentMethod === 'hutang' || (selectedTransaction as any).isHutang;
      if (isHutangTrx) {
        const allNotes = getNotes();
        // Cari note hutang yang terkait dengan transaksi ini
        let hutangNote = allNotes.find((n: any) => n.transactionId === trxId && n.type === 'hutang');
        // Fallback: cari berdasarkan nama & jumlah
        if (!hutangNote) {
          hutangNote = allNotes.find((n: any) =>
            n.type === 'hutang' &&
            !n.completed &&
            n.date.split('T')[0] === selectedTransaction.date.split('T')[0] &&
            (n.customerName === selectedTransaction.customer || selectedTransaction.customer === 'Pelanggan Umum')
          );
        }
        if (hutangNote && !hutangNote.completed) {
          const refundedAmount = item.price * qtyToReturn;
          const newAmount = Math.max(0, (hutangNote.amount || 0) - refundedAmount);
          // Update deskripsi qty: "(4x)" → "(2x)"
          let updatedContent = hutangNote.content;
          const qtyMatch = updatedContent.match(/\((\d+)x\)\s*$/);
          if (qtyMatch) {
            const oldQty = parseInt(qtyMatch[1]);
            const newQty = Math.max(0, oldQty - qtyToReturn);
            updatedContent = updatedContent.replace(/\(\d+x\)\s*$/, `(${newQty}x)`);
          }
          if (newAmount <= 0) {
            // Hutang lunas karena semua item di-refund
            updateNote(hutangNote.id, { amount: 0, content: updatedContent });
            completeNote(hutangNote.id);
          } else {
            updateNote(hutangNote.id, { amount: newAmount, content: updatedContent });
          }
        }
      }

      setIsDialogOpen(false);
      setSelectedItemIndex(null);
      setReturnQuantity(1); // Reset return qty

      toast({
        title: "Refund Berhasil",
        description: `${qtyToReturn} pcs ${item.name} berhasil di-refund. Stok +${qtyToReturn}`,
      });
    } else {
      // Full transaction refund (already checked at function start)
      // Fix #12: Read products once, accumulate stock changes, write once
      let currentProducts = getProducts().map(p => ({ ...p })); // shallow clone all

      selectedTransaction.items.forEach(item => {
        let sku = item.sku;
        if (!sku) {
          const prod = currentProducts.find(p => p.name === item.name);
          sku = prod?.sku || '-';
        }

        // Only log refund if different day
        if (!isSameDayRefund) {
          addRefund({
            date: new Date().toISOString(),
            item: {
              sku,
              name: item.name,
              quantity: item.quantity,
              price: item.price
            },
            total: item.price * item.quantity,
            transactionId: trxId,
            originalPurchaseDate: selectedTransaction.date
          });
        }

        // Accumulate stock changes
        const pIdx = currentProducts.findIndex(p => p.sku === sku && p.stock !== undefined);
        if (pIdx !== -1) {
          currentProducts[pIdx].stock += item.quantity;
        }
      });

      // Write all stock changes once
      setProducts(currentProducts);

      // ★ Push stock to Sheet (bidirectional sync)
      const stockUpdates = selectedTransaction.items
        .filter(item => item.sku && item.sku !== '-')
        .map(item => {
          const prod = currentProducts.find((p: any) => p.sku === item.sku);
          return prod ? { sku: prod.sku, stock: prod.stock ?? 0 } : null;
        })
        .filter(Boolean) as Array<{ sku: string; stock: number }>;
      if (stockUpdates.length > 0) pushStockToSheet(stockUpdates);
      window.dispatchEvent(new CustomEvent('pos:products:update', { detail: currentProducts }));

      // Smart refund logic for full refund (already checked at function start)
      if (isSameDayRefund) {
        // Same day: Mark all items as refunded (same day)
        const updated = transactions.map(t => {
          if (t.id !== trxId) return t;
          const newItems = t.items.map(item => ({ ...item, sameDayRefunded: true, refundedQty: item.quantity }));
          return { ...t, items: newItems };
        });
        setTransactions(updated);
        safeSaveAllTransactions(updated);
      } else {
        // Different day: Mark all items as refunded
        const updated = transactions.map(t => {
          if (t.id !== trxId) return t;
          const newItems = t.items.map(item => ({ ...item, refunded: true, refundedQty: item.quantity }));
          return { ...t, items: newItems };
        });
        setTransactions(updated);
        safeSaveAllTransactions(updated);
      }

      // ★ UPDATE HUTANG NOTE: Full refund = hapus/lunas hutang
      const isHutangTrx = (selectedTransaction as any).paymentMethod === 'hutang' || (selectedTransaction as any).isHutang;
      if (isHutangTrx) {
        const allNotes = getNotes();
        let hutangNote = allNotes.find((n: any) => n.transactionId === trxId && n.type === 'hutang');
        if (!hutangNote) {
          hutangNote = allNotes.find((n: any) =>
            n.type === 'hutang' &&
            !n.completed &&
            n.date.split('T')[0] === selectedTransaction.date.split('T')[0] &&
            (n.customerName === selectedTransaction.customer || selectedTransaction.customer === 'Pelanggan Umum')
          );
        }
        if (hutangNote && !hutangNote.completed) {
          // Update deskripsi: tandai semua item sudah di-refund
          let updatedContent = hutangNote.content;
          const qtyMatch = updatedContent.match(/\((\d+)x\)\s*$/);
          if (qtyMatch) {
            updatedContent = updatedContent.replace(/\(\d+x\)\s*$/, '(0x - REFUND)');
          }
          updateNote(hutangNote.id, { amount: 0, content: updatedContent });
          completeNote(hutangNote.id);
        }
      }

      setIsDialogOpen(false);
    }
  };

  const handlePrintReceipt = () => {
    if (!selectedTransaction) return;
    // Allow the print area to render before printing
    setTimeout(() => window.print(), 50);
  };

  // Handle clicking exchange button - show options
  const handleExchangeClick = () => {
    if (!selectedTransaction) return;
    const validIndex = selectedItemIndex !== null && selectedItemIndex >= 0 && selectedItemIndex < selectedTransaction.items.length;
    const item = validIndex ? selectedTransaction.items[selectedItemIndex!] : selectedTransaction.items[0];
    const index = validIndex ? selectedItemIndex! : 0;
    setExchangeItemToReturn({ item, index });
    setExchangeQuantity(1); // Default ke 1 untuk barang baru
    setReturnQuantity(1); // Default ke 1 untuk qty yang akan dikembalikan
    setShowExchangeOptions(true);
  };

  // Handle selecting exchange with new product
  const handleChooseExchange = () => {
    setShowExchangeOptions(false);
    setShowProductPicker(true);
    setProductPickerSearch("");
    setProductPickerPage(1);
    setSelectedNewProduct(null);
  };

  // Handle refund only (no exchange)
  const handleRefundOnly = () => {
    setShowExchangeOptions(false);
    setShowRefundConfirm(false);
    createReturnTransaction();
  };

  // Handle selecting new product in picker
  const handleSelectNewProduct = (product: any) => {
    setSelectedNewProduct(product);
    setShowProductPicker(false);
    setShowExchangeConfirm(true);
  };

  // Process the exchange
  const processExchange = async () => {
    if (!selectedTransaction || !exchangeItemToReturn || !selectedNewProduct) return;

    const products = getProducts();
    const oldItem = exchangeItemToReturn.item;
    const oldItemIndex = exchangeItemToReturn.index;
    const trxId = selectedTransaction.id;
    const qtyToReturn = Math.min(returnQuantity, oldItem.quantity); // Qty barang lama yang dikembalikan
    const newQty = exchangeQuantity; // Qty barang baru yang didapat

    // Get SKU for old item
    let oldSku = oldItem.sku;
    if (!oldSku) {
      const prod = products.find(p => p.name === oldItem.name);
      oldSku = prod?.sku || '-';
    }

    // Calculate price difference: (barang baru × qty baru) - (barang lama × qty dikembalikan)
    // Use customPrice if set, otherwise use product's default price
    const actualPrice = customPrice ?? selectedNewProduct.price;
    const oldTotal = oldItem.price * qtyToReturn;
    const newTotal = actualPrice * newQty;
    const priceDiff = newTotal - oldTotal;

    // Add exchange record
    addExchange({
      date: new Date().toISOString(),
      originalItem: {
        sku: oldSku,
        name: oldItem.name,
        quantity: qtyToReturn,
        price: oldItem.price
      },
      newItem: {
        sku: selectedNewProduct.sku || '-',
        name: selectedNewProduct.name,
        quantity: newQty,
        price: actualPrice // Use custom price if set
      },
      priceDifference: priceDiff,
      originalTransactionId: trxId,
      originalPurchaseDate: selectedTransaction.date // Tanggal beli awal
    });

    // Update stock: +returned qty for returned item, -new qty for new item
    let updatedProducts = products.map(p => {
      if (p.sku === oldSku && p.stock !== undefined) {
        return { ...p, stock: p.stock + qtyToReturn };
      }
      if (p.sku === selectedNewProduct.sku && p.stock !== undefined) {
        return { ...p, stock: p.stock - newQty };
      }
      return p;
    });
    setProducts(updatedProducts);
    window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }));

    // === NEW LOGIC: Proper Retail Accounting ===
    // 1. Update ORIGINAL transaction: ONLY remove/reduce old item (reduces omset on original date)
    const updatedOriginal = transactions.map(t => {
      if (t.id !== trxId) return t;

      let newItems = [...t.items];
      const remainingQty = oldItem.quantity - qtyToReturn;

      if (remainingQty <= 0) {
        // Remove old item completely if all qty exchanged
        newItems.splice(oldItemIndex, 1);
      } else {
        // Reduce qty of old item if partial exchange
        newItems[oldItemIndex] = { ...oldItem, quantity: remainingQty };
      }

      // If no items left, mark as refunded
      if (newItems.length === 0) {
        return { ...t, items: newItems, total: 0, status: 'refunded' as const };
      }

      const totalAmount = newItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
      return { ...t, items: newItems, total: totalAmount };
    });

    // 2. Create NEW transaction for price difference (selisih)
    // This represents the ACTUAL CASH change today:
    // - Positive: customer pays extra (kas masuk)
    // - Negative: store gives refund (kas keluar)
    let finalTransactions = [...updatedOriginal];

    if (priceDiff !== 0) {
      // Record adjustment transaction for any non-zero difference
      // Use EX- prefix for exchange items
      const newTransaction: Transaction = {
        id: `ADJ-${Date.now().toString().substring(6)}`,
        date: new Date().toISOString(), // TODAY's date
        customer: 'Tukar Barang', // Mark as exchange
        total: priceDiff, // The selisih (can be positive or negative)
        status: 'completed',
        items: [{
          name: `Selisih Tukar: ${oldItem.name} → ${selectedNewProduct.name}`,
          sku: `EX-${Date.now().toString().substring(8)}`, // Exchange reference, not product SKU
          price: priceDiff,
          quantity: 1,
          type: 'product' as const
        }]
      };
      finalTransactions = [...updatedOriginal, newTransaction];
    }
    // Note: If priceDiff === 0, no cash change, no adjustment transaction needed

    setTransactions(finalTransactions);
    await safeSaveAllTransactions(finalTransactions);

    // Show toast with clear breakdown
    toast({
      title: "Tukar berhasil!",
      description: `Omset ${new Date(selectedTransaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}: -${formatCurrency(oldTotal)} | Kas hari ini: ${priceDiff >= 0 ? '+' : ''}${formatCurrency(priceDiff)}`,
    });

    // Reset and close all dialogs
    setShowExchangeConfirm(false);
    setIsDialogOpen(false);
    setSelectedNewProduct(null);
    setExchangeItemToReturn(null);
    setSelectedItemIndex(null);
    setCustomPrice(null);
    setReturnQuantity(1); // Reset return qty
  };

  // Get filtered products for picker with pagination - using smart search like POS
  const PRODUCTS_PER_PAGE = 30;

  // Relevance score to prioritize SKU matches (exact > startsWith > includes) - same as POS
  const relevanceScore = (item: any, query: string) => {
    if (!query) return 0;
    const qNorm = normalizeSearch(query);
    const qColl = collapseLeadingZeros(qNorm);
    const sku = item.sku || "";
    const name = item.name || "";
    const category = item.category || "";
    const sNorm = normalizeSearch(sku);
    const sColl = collapseLeadingZeros(sNorm);
    const nNorm = normalizeSearch(name);
    const cNorm = normalizeSearch(category);

    let score = 0;
    // SKU priority
    if (sColl === qColl) score += 1000;
    if (sNorm === qNorm) score += 900;
    if (sColl.startsWith(qColl)) score += 800;
    if (sNorm.startsWith(qNorm)) score += 700;
    if (sColl.includes(qColl)) score += 600;
    if (sNorm.includes(qNorm)) score += 500;
    // Favor shorter remainder when startsWith/includes
    if (sColl.startsWith(qColl)) score += Math.max(0, 100 - (sColl.length - qColl.length));
    else if (sColl.includes(qColl)) score += Math.max(0, 50 - (sColl.length - qColl.length));
    // Name/Category as secondary signals
    if (nNorm === qNorm) score += 300;
    else if (nNorm.startsWith(qNorm)) score += 250;
    else if (nNorm.includes(qNorm)) score += 200;
    if (cNorm.startsWith(qNorm)) score += 120;
    else if (cNorm.includes(qNorm)) score += 100;

    return score;
  };

  const getFilteredProducts = () => {
    const products = getProducts();
    let filtered = products;
    if (productPickerSearch) {
      // Use matchesLoose for flexible search like POS
      filtered = products
        .filter(p =>
          matchesLoose(p.name, productPickerSearch) ||
          matchesLoose(p.sku, productPickerSearch) ||
          matchesLoose(p.category, productPickerSearch)
        )
        .sort((a, b) => relevanceScore(b, productPickerSearch) - relevanceScore(a, productPickerSearch));
    }
    return filtered;
  };

  const filteredProductsForPicker = getFilteredProducts();
  const totalPickerPages = Math.ceil(filteredProductsForPicker.length / PRODUCTS_PER_PAGE);
  const paginatedPickerProducts = filteredProductsForPicker.slice(
    (productPickerPage - 1) * PRODUCTS_PER_PAGE,
    productPickerPage * PRODUCTS_PER_PAGE
  );

  // Reset page when search changes
  const handlePickerSearchChange = (value: string) => {
    setProductPickerSearch(value);
    setProductPickerPage(1);
  };

  const handleBarcodeDetected = useCallback((code: string) => {
    setSearchQuery(code);
    setItemTerjualPage(1);
  }, []);

  // Undo/Cancel exchange - revert stock and transactions (NEW LOGIC)
  const undoExchange = async (exchange: ExchangeRecord) => {
    const products = getProducts();

    // 1. Revert stock: +newItem qty (barang baru dikembalikan ke stok), -originalItem qty (barang lama diambil kembali)
    let updatedProducts = products.map(p => {
      if (p.sku === exchange.newItem.sku && p.stock !== undefined) {
        return { ...p, stock: p.stock + exchange.newItem.quantity };
      }
      if (p.sku === exchange.originalItem.sku && p.stock !== undefined) {
        return { ...p, stock: p.stock - exchange.originalItem.quantity };
      }
      return p;
    });
    setProducts(updatedProducts);
    window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }));

    // 2. Find and DELETE the new transaction (created on exchange date for new item)
    // AND also delete the Selisih Tukar adjustment transaction (ADJ- with EX- item)
    const exchangeDate = new Date(exchange.date).toISOString().split('T')[0];

    let updatedTransactions = transactions.filter(t => {
      // Check if this is the exchange transaction (created on exchange date, has only the new item)
      const txDate = t.date.split('T')[0];
      if (txDate !== exchangeDate) return true; // Keep transactions from other dates

      // Check if this transaction only has the new item with exact qty
      if (t.items.length === 1 &&
        t.items[0].sku === exchange.newItem.sku &&
        t.items[0].quantity === exchange.newItem.quantity) {
        // This is the exchange transaction, remove it
        return false;
      }

      // Also check for Selisih Tukar adjustment transaction (ADJ- transactions with "Selisih Tukar:" item)
      // Match by checking if the item name contains both original and new item names
      if (t.id.startsWith('ADJ-') && t.items.length === 1 && t.items[0].name.startsWith('Selisih Tukar:')) {
        // Check if this Selisih Tukar matches our exchange (item names should be included)
        const selisihName = t.items[0].name;
        if (selisihName.includes(exchange.originalItem.name) && selisihName.includes(exchange.newItem.name)) {
          // This is the Selisih Tukar transaction for this exchange, remove it
          return false;
        }
      }

      return true;
    });

    // 3. Restore original item qty in the ORIGINAL transaction
    if (exchange.originalTransactionId) {
      updatedTransactions = updatedTransactions.map(t => {
        if (t.id !== exchange.originalTransactionId) return t;

        let newItems = [...t.items];

        // Add back originalItem qty
        const oldItemIndex = newItems.findIndex(it => it.sku === exchange.originalItem.sku);
        if (oldItemIndex >= 0) {
          newItems[oldItemIndex] = {
            ...newItems[oldItemIndex],
            quantity: newItems[oldItemIndex].quantity + exchange.originalItem.quantity
          };
        } else {
          // Item was fully removed, add it back
          newItems.push({
            name: exchange.originalItem.name,
            sku: exchange.originalItem.sku,
            price: exchange.originalItem.price,
            quantity: exchange.originalItem.quantity,
            type: 'product' as const
          });
        }

        const totalAmount = newItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
        return { ...t, items: newItems, total: totalAmount, status: 'completed' as const };
      });
    }

    setTransactions(updatedTransactions);
    await safeSaveAllTransactions(updatedTransactions);

    // 4. Delete exchange record
    deleteExchange(exchange.id);
    setExchangeHistory(getExchanges());

    // 5. Show toast
    toast({
      title: "Tukar Dibatalkan",
      description: `Omset dikembalikan ke semula. ${exchange.originalItem.name} (+${exchange.originalItem.quantity}), ${exchange.newItem.name} (stok +${exchange.newItem.quantity})`,
    });

    setExchangeToDelete(null);
  };

  // Handle delete refund - remove refund record and restore stock
  const handleDeleteRefund = (refund: RefundRecord) => {
    const products = getProducts();

    // Restore stock: subtract the refunded quantity (because refund added it back)
    const updatedProducts = products.map(p => {
      if (p.sku === refund.item.sku && p.stock !== undefined) {
        return { ...p, stock: p.stock - refund.item.quantity };
      }
      return p;
    });
    setProducts(updatedProducts);
    window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }));
    // ★ Push stock to Sheet (bidirectional sync)
    pushStockToSheet([{ sku: refund.item.sku, stock: updatedProducts.find((p: any) => p.sku === refund.item.sku)?.stock ?? 0 }]);

    // Delete the refund record
    deleteRefund(refund.id);

    // Refresh refund history
    setRefundHistory(getRefunds());

    // Close dialog
    setRefundToDelete(null);

    toast({
      title: "Refund Dibatalkan",
      description: `${refund.item.name} (${refund.item.quantity} pcs) - Stok dikurangi kembali`,
      variant: "default"
    });
  };


  return (
    <div className="bg-background h-screen flex flex-col overflow-hidden">
      <div className="container mx-auto px-2 sm:px-4 py-2 flex-1 flex flex-col min-h-0">

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <div className="relative flex-1 min-w-[180px] sm:min-w-[240px] max-w-xs">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              placeholder="KODE / NAMA"
              className="w-full pl-12 pr-12 py-3 bg-gray-100 dark:bg-gray-800 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white dark:focus:bg-gray-700 transition-all font-medium"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 bg-gray-400 hover:bg-gray-500 rounded-full transition-colors"
              >
                <X className="h-3 w-3 text-white" />
              </button>
            )}
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange({ start: e.target.value, end: e.target.value })}
              className="w-36 pl-9 pr-3 py-3 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="flex gap-2 mb-4 bg-transparent p-0 shrink-0">
            <TabsTrigger value="completed" className="flex-1 py-3 px-4 text-sm font-semibold text-gray-500 bg-white border border-gray-200 rounded-xl transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 data-[state=active]:scale-[1.02] hover:border-purple-300 hover:text-purple-600">Terjual</TabsTrigger>
            <TabsTrigger value="all" className="flex-1 py-3 px-4 text-sm font-semibold text-gray-500 bg-white border border-gray-200 rounded-xl transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 data-[state=active]:scale-[1.02] hover:border-purple-300 hover:text-purple-600">Transaksi</TabsTrigger>
            <TabsTrigger value="history" className="flex-1 py-3 px-4 text-sm font-semibold text-gray-500 bg-white border border-gray-200 rounded-xl transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:border-transparent data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/30 data-[state=active]:scale-[1.02] hover:border-purple-300 hover:text-purple-600">History</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto pb-16 px-0.5">
            {/* Hari ini (default uses today's date via dateRange) */}
            <TabsContent value="all" className="space-y-4 mt-0">
              {(() => {
                const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
                const startIndex = (transaksiPage - 1) * ITEMS_PER_PAGE;
                const paginatedTransactions = filteredTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                return paginatedTransactions.length ? (
                  <>
                    <div className="text-[10px] text-muted-foreground mb-2 px-1">
                      Menampilkan {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, filteredTransactions.length)} dari {filteredTransactions.length} transaksi
                    </div>
                    {paginatedTransactions.map(t => (
                      <Card key={t.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => handleTransactionClick(t)}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{t.customer}</p>
                              <p className="text-[11px] text-muted-foreground">{t.id} • {new Date(t.date).toLocaleString("id-ID")}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-amber-600 text-sm">{formatCurrency(t.total)}</p>
                              <Badge variant={t.status === "completed" ? "default" : t.status === "pending" ? "secondary" : t.status === "cancelled" ? "destructive" : "outline"} className="mt-1 h-5 text-[10px]">
                                {t.status === "completed" ? "Selesai" : t.status === "pending" ? "Pending" : t.status === "cancelled" ? "Batal" : "Refund"}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-dashed">
                            <div className="flex flex-wrap gap-1.5">
                              {t.items.slice(0, 3).map((item, idx) => (
                                <div key={idx} className="flex items-center gap-1 bg-gray-50 dark:bg-gray-800/50 px-2 py-0.5 rounded text-[10px] text-muted-foreground border border-gray-100 dark:border-gray-800">
                                  <span className="font-medium text-gray-700 dark:text-gray-300 line-clamp-1">{item.name}</span>
                                  <span className="text-amber-600 font-bold shrink-0">x{item.quantity}</span>
                                </div>
                              ))}
                              {t.items.length > 3 && (
                                <div className="text-[10px] text-muted-foreground px-1 py-0.5">
                                  +{t.items.length - 3} lainnya...
                                </div>
                              )}
                            </div>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-[10px] text-muted-foreground italic">Total {t.items.length} item</span>
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    {/* Pagination controls for Transaksi */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-4 pt-2 border-t">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => setTransaksiPage(1)}
                          disabled={transaksiPage === 1}
                        >
                          Awal
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => setTransaksiPage(p => Math.max(1, p - 1))}
                          disabled={transaksiPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-medium px-2">
                          {transaksiPage} / {totalPages}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => setTransaksiPage(p => Math.min(totalPages, p + 1))}
                          disabled={transaksiPage === totalPages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => setTransaksiPage(totalPages)}
                          disabled={transaksiPage === totalPages}
                        >
                          Akhir
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
                    <Info className="h-8 w-8" />
                    <div className="font-medium">Tidak ada transaksi</div>
                    <div className="text-sm">Jika belum ada transaksi hari ini, daftar akan kosong—ubah tanggal untuk melihat hari lain.</div>
                  </div>
                );
              })()}
            </TabsContent>

            {/* Item Terjual - Grid 2 kolom dengan tombol tukar */}
            <TabsContent value="completed" className="space-y-2">
              {(() => {
                const products = getProducts();
                const allItems = filteredTransactions
                  .filter((t) => t.status === "completed")
                  .flatMap((transaction) =>
                    transaction.items
                      // Fix: Map with ORIGINAL index first, then filter
                      // This preserves the correct index for refund operations
                      .map((item, originalIndex) => ({ item, originalIndex }))
                      .filter(({ item }) => {
                        if (!searchQuery) return true;
                        const itemSku = item.sku || products.find((p: any) => p.name === item.name)?.sku || "";
                        return matchesLoose(item.name, searchQuery) || matchesLoose(itemSku, searchQuery) || matchesLoose(transaction.customer, searchQuery);
                      })
                      .map(({ item, originalIndex }) => {
                        const itemSku = item.sku || products.find((p: any) => p.name === item.name)?.sku || "";
                        return {
                          transaction,
                          item,
                          itemIndex: originalIndex,
                          relevance: getSearchRelevance(itemSku, searchQuery) + (matchesLoose(item.name, searchQuery) ? 50 : 0) + (matchesLoose(transaction.customer, searchQuery) ? 80 : 0)
                        };
                      })
                  )
                  .sort((a, b) => {
                    if (searchQuery) {
                      // Prioritize relevance if searching
                      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
                    }
                    // Secondary: Date (newest first)
                    return new Date(b.transaction.date).getTime() - new Date(a.transaction.date).getTime();
                  });

                // Pagination logic
                const totalItems = allItems.length;
                const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
                const startIndex = (itemTerjualPage - 1) * ITEMS_PER_PAGE;
                const endIndex = startIndex + ITEMS_PER_PAGE;
                const paginatedItems = allItems.slice(startIndex, endIndex);

                return allItems.length > 0 ? (
                  <>
                    {/* Pagination info & controls - top */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-sm text-muted-foreground">
                        {startIndex + 1}-{Math.min(endIndex, totalItems)} dari {totalItems} item
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => setItemTerjualPage(p => Math.max(1, p - 1))}
                          disabled={itemTerjualPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-medium px-2">
                          {itemTerjualPage}/{totalPages}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => setItemTerjualPage(p => Math.min(totalPages, p + 1))}
                          disabled={itemTerjualPage === totalPages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {paginatedItems.map(({ transaction, item, itemIndex }) => {
                        const sku = item.sku || products.find((p: any) => p.name === item.name)?.sku || "-";
                        const isDeleting = deleteConfirm?.transactionId === transaction.id && deleteConfirm?.itemIndex === itemIndex;
                        const isSelisihTukar = item.name.startsWith("Selisih Tukar:");
                        const isSelisihPositif = isSelisihTukar && item.price > 0;
                        const isSelisihNegatif = isSelisihTukar && item.price < 0;

                        // Card colors: Green for positive selisih, Red for negative selisih
                        const getCardClass = () => {
                          if (isSelisihPositif) return 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200 dark:from-emerald-950/30 dark:to-green-950/30 dark:border-emerald-800';
                          if (isSelisihNegatif) return 'bg-gradient-to-br from-red-50 to-rose-50 border-red-200 dark:from-red-950/30 dark:to-rose-950/30 dark:border-red-800';
                          return '';
                        };

                        const getTextClass = () => {
                          if (isSelisihPositif) return 'text-emerald-600 dark:text-emerald-400';
                          if (isSelisihNegatif) return 'text-red-600 dark:text-red-400';
                          return 'text-muted-foreground';
                        };

                        const getIconClass = () => {
                          if (isSelisihPositif) return 'text-emerald-500';
                          if (isSelisihNegatif) return 'text-red-500';
                          return 'text-blue-500';
                        };

                        const getNameClass = () => {
                          if (isSelisihPositif) return 'text-emerald-700 dark:text-emerald-300';
                          if (isSelisihNegatif) return 'text-red-700 dark:text-red-300';
                          return '';
                        };

                        const getPriceClass = () => {
                          if (isSelisihPositif) return 'text-emerald-600 dark:text-emerald-400';
                          if (isSelisihNegatif) return 'text-red-600 dark:text-red-400';
                          return 'text-amber-600';
                        };

                        // Check if this card should be flashing
                        const isFlashing = flashingCard?.transactionId === transaction.id && flashingCard?.itemIndex === itemIndex;

                        return (
                          <Card
                            key={`${transaction.id}-${itemIndex}`}
                            className={`hover:border-primary transition-colors ${(item as any).refunded || (item as any).partiallyRefunded || (item as any).sameDayRefunded
                              ? 'bg-red-50 border-red-200'
                              : getCardClass()
                              } ${isFlashing ? 'animate-pulse ring-2 ring-green-500 ring-offset-2' : ''}`}
                          >
                            <CardContent className="p-3">
                              <div className="flex gap-2">
                                {/* Left side - product info */}
                                <div className="flex-1 min-w-0">
                                  {/* Tanggal pembelian */}
                                  <div className={`flex items-center gap-1 text-[10px] mb-1 ${getTextClass()}`}>
                                    <Calendar className={`h-3.5 w-3.5 ${getIconClass()}`} />
                                    <span>{isSelisihTukar ? 'Tanggal Tukar' : 'Tanggal Beli'}: {new Date(transaction.date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                                  </div>
                                  <div className={`font-medium text-sm leading-tight break-words ${getNameClass()}`}>
                                    {item.name}
                                    {(item as any).sameDayRefunded && <span className="ml-2 text-red-600 font-bold">(Refunded - Dihari yang sama)</span>}
                                    {(item as any).refunded && <span className="ml-2 text-red-600 font-bold">(Refunded{(item as any).refundDate ? ` - ${new Date((item as any).refundDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}` : ''})</span>}
                                    {(item as any).partiallyRefunded && <span className="ml-2 text-orange-600 font-bold">(Partial Refund)</span>}
                                  </div>
                                  <div className={`text-xs mt-1 ${isSelisihTukar ? getTextClass() + '/70' : 'text-muted-foreground'}`}>
                                    {item.quantity} x {formatCurrency(item.price)}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`font-semibold ${(item as any).refunded || (item as any).partiallyRefunded || (item as any).sameDayRefunded
                                      ? 'text-red-600 line-through'
                                      : getPriceClass()
                                      }`}>
                                      {isSelisihNegatif ? '' : ''}{formatCurrency(item.price * item.quantity)}
                                    </span>
                                    {/* Tombol Refund - Exchange feature disabled, disabled if already refunded */}
                                    {!isSelisihTukar && !(item as any).refunded && !(item as any).partiallyRefunded && !(item as any).sameDayRefunded && !(item as any).sameDayPartialRefund && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-4 ml-auto text-sm font-medium text-red-600 border-red-300 hover:text-red-800 hover:bg-red-50 hover:border-red-400"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedTransaction(transaction);
                                          setSelectedItemIndex(itemIndex);
                                          setExchangeItemToReturn({ item, index: itemIndex });
                                          setReturnQuantity(1); // Default ke 1 untuk qty yang akan dikembalikan
                                          // Show confirmation dialog first
                                          setShowRefundConfirm(true);
                                        }}
                                      >
                                        <RotateCcw className="h-4 w-4 mr-1.5" />
                                        Refund
                                      </Button>
                                    )}
                                    {/* Tombol Batalkan Refund - untuk card yang sudah di-refund (any refund flag) */}
                                    {((item as any).sameDayRefunded || (item as any).refunded || (item as any).partiallyRefunded) && (
                                      undoRefundConfirm?.transactionId === transaction.id && undoRefundConfirm?.itemIndex === itemIndex ? (
                                        // Confirm state - show "Yakin?" button
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-8 px-4 ml-auto text-sm font-medium bg-green-600 hover:bg-green-700 text-white"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteTransactionItem(transaction.id, itemIndex);
                                            setUndoRefundConfirm(null);
                                          }}
                                        >
                                          Yakin Batalkan?
                                        </Button>
                                      ) : (
                                        // Normal state - show "Batalkan Refund" button
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 px-4 ml-auto text-sm font-medium text-green-600 border-green-300 hover:text-green-800 hover:bg-green-50 hover:border-green-400"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setUndoRefundConfirm({ transactionId: transaction.id, itemIndex });
                                          }}
                                        >
                                          <RotateCcw className="h-4 w-4 mr-1.5" />
                                          Batalkan Refund
                                        </Button>
                                      )
                                    )}
                                  </div>
                                </div>
                                {/* Right side - SKU + action buttons */}
                                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                  {/* SKU badge */}
                                  <div className="text-[10px] px-2 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200">
                                    {sku}
                                  </div>
                                  {/* Hutang / Lunas / Customer label */}
                                  {(() => {
                                    const isHutangTrx = (transaction as any).paymentMethod === 'hutang' || (transaction as any).isHutang || (item as any).isHutang;
                                    if (isHutangTrx) {
                                      // Check if hutang is lunas by looking at notes
                                      const allNotes = getNotes();
                                      const hutangNote = allNotes.find((n: any) =>
                                        n.type === 'hutang' && (
                                          n.transactionId === transaction.id ||
                                          (n.date.split('T')[0] === transaction.date.split('T')[0] && n.customerName === transaction.customer)
                                        )
                                      );
                                      const isLunas = hutangNote?.completed;
                                      const customerName = transaction.customer || hutangNote?.customerName || '-';
                                      return isLunas ? (
                                        <div className="text-[9px] px-2 py-0.5 rounded font-bold text-green-700 bg-green-50 border border-green-200">
                                          {customerName} - LUNAS ✓
                                        </div>
                                      ) : (
                                        <div className="text-[9px] px-2 py-0.5 rounded font-bold text-red-600 bg-red-50 border border-red-200">
                                          Hutang - {customerName}
                                        </div>
                                      );
                                    }
                                    // Non-hutang: tampilkan nama pelanggan jika ada
                                    const custName = transaction.customer;
                                    if (custName && custName !== 'Pelanggan Umum') {
                                      return (
                                        <div className="text-[9px] px-2 py-0.5 rounded font-bold text-blue-600 bg-blue-50 border border-blue-200">
                                          {custName}
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                  {/* Action buttons - Edit & Delete (hidden for Selisih Tukar items and refunded items) */}
                                  {isSelisihTukar ? (
                                    // Show info text instead of edit/delete buttons
                                    <div className={`text-[9px] text-right italic ${isSelisihPositif ? 'text-emerald-500' : 'text-red-500'}`}>
                                      Batalkan di tab History
                                    </div>
                                  ) : ((item as any).sameDayRefunded || (item as any).refunded || (item as any).partiallyRefunded) ? (
                                    // Refunded item - no edit/delete buttons (use Batalkan Refund button instead)
                                    null
                                  ) : editingItem?.transactionId === transaction.id && editingItem?.itemIndex === itemIndex ? (
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setEditingItem({ ...editingItem, currentQty: Math.max(0, editingItem.currentQty - 1) })}
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <span className={`min-w-[24px] text-center text-sm font-medium ${editingItem.currentQty === 0 ? 'text-red-500' : ''}`}>
                                        {editingItem.currentQty}
                                      </span>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setEditingItem({ ...editingItem, currentQty: editingItem.currentQty + 1 })}
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => updateItemQuantity(transaction.id, itemIndex, editingItem.currentQty)}
                                        disabled={editingItem.currentQty === 0}
                                        title={editingItem.currentQty === 0 ? "Qty tidak boleh 0. Gunakan tombol hapus untuk menghapus item." : ""}
                                      >
                                        OK
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setEditingItem(null)}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : isDeleting ? (
                                    deleteConfirm.step === 1 ? (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 text-xs"
                                        onClick={() => setDeleteConfirm({ transactionId: transaction.id, itemIndex, step: 2 })}
                                      >
                                        Yakin?
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 text-xs bg-red-700 hover:bg-red-800"
                                        onClick={() => deleteTransactionItem(transaction.id, itemIndex)}
                                      >
                                        HAPUS!
                                      </Button>
                                    )
                                  ) : (
                                    // Normal mode - show edit and delete buttons
                                    <div className="flex items-center gap-1">
                                      <div className="flex flex-col items-center">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                          onClick={() => setEditingItem({ transactionId: transaction.id, itemIndex, currentQty: item.quantity })}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <span className="text-[8px] text-blue-400 -mt-1">QTY</span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => setDeleteConfirm({ transactionId: transaction.id, itemIndex, step: 1 })}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div >

                    {/* Pagination controls - bottom */}
                    {
                      totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-4 pt-2 border-t">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setItemTerjualPage(1)}
                            disabled={itemTerjualPage === 1}
                          >
                            Awal
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setItemTerjualPage(p => Math.max(1, p - 1))}
                            disabled={itemTerjualPage === 1}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm font-medium px-3">
                            Hal {itemTerjualPage} dari {totalPages}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setItemTerjualPage(p => Math.min(totalPages, p + 1))}
                            disabled={itemTerjualPage === totalPages}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setItemTerjualPage(totalPages)}
                            disabled={itemTerjualPage === totalPages}
                          >
                            Akhir
                          </Button>
                        </div>
                      )
                    }
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Tidak ada transaksi selesai
                  </div>
                );
              })()}
            </TabsContent>

            {/* History Tab - Exchanges & Refunds */}
            <TabsContent value="history" className="space-y-6">
              {(() => {
                const filteredExchanges = exchangeHistory.filter(e => {
                  if (!matchesDate(e.date)) return false;
                  if (!searchQuery) return true;

                  return (
                    matchesLoose(e.originalItem.name, searchQuery) ||
                    matchesLoose(e.originalItem.sku, searchQuery) ||
                    matchesLoose(e.newItem.name, searchQuery) ||
                    matchesLoose(e.newItem.sku, searchQuery) ||
                    e.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    e.originalTransactionId?.toLowerCase().includes(searchQuery.toLowerCase())
                  );
                });

                const filteredRefunds = refundHistory.filter(r => {
                  if (!matchesDate(r.date)) return false;
                  if (!searchQuery) return true;

                  return (
                    matchesLoose(r.item.name, searchQuery) ||
                    matchesLoose(r.item.sku, searchQuery) ||
                    r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.transactionId?.toLowerCase().includes(searchQuery.toLowerCase())
                  );
                });

                // Exchange feature disabled - only show refunds
                const allActivity = [
                  // ...filteredExchanges.map(ex => {
                  //   const relevance = Math.max(
                  //     getSearchRelevance(ex.originalItem.sku, searchQuery),
                  //     getSearchRelevance(ex.newItem.sku, searchQuery)
                  //   );
                  //   return { type: 'exchange', data: ex, date: ex.date, relevance };
                  // }),
                  ...filteredRefunds.map(rf => {
                    const relevance = getSearchRelevance(rf.item.sku, searchQuery);
                    return { type: 'refund', data: rf, date: rf.date, relevance };
                  })
                ].sort((a, b) => {
                  if (searchQuery) {
                    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
                  }
                  return new Date(b.date).getTime() - new Date(a.date).getTime();
                });

                const totalPages = Math.ceil(allActivity.length / ITEMS_PER_PAGE);
                const startIndex = (tukarPage - 1) * ITEMS_PER_PAGE;
                const paginatedActivity = allActivity.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                return (
                  <div className="space-y-6">
                    {allActivity.length > 0 ? (
                      <>
                        <div className="text-[10px] text-muted-foreground mb-2 px-1">
                          Menampilkan {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, allActivity.length)} dari {allActivity.length} baris riwayat
                        </div>
                        <div className="space-y-4">
                          {paginatedActivity.map((item, idx) => {
                            if (item.type === 'exchange') {
                              const ex = item.data as any as ExchangeRecord;
                              const isHighlighted = highlightedExchangeId === ex.id;
                              return (
                                <Card
                                  key={ex.id}
                                  ref={(el) => { exchangeCardRefs.current[ex.id] = el; }}
                                  className={`overflow-hidden border-l-4 border-l-purple-500 shadow-sm transition-all duration-300 ${isHighlighted ? 'ring-4 ring-purple-400 ring-opacity-75 bg-purple-50' : ''}`}
                                  style={isHighlighted ? { animation: 'slow-pulse 2s ease-in-out infinite' } : {}}
                                >
                                  <CardContent className="p-3 sm:p-4">
                                    <div className="flex justify-between items-start mb-3">
                                      <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                        <RefreshCw className="h-3 w-3" /> Tukar: {new Date(ex.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                                      </div>
                                      <div className="text-[9px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground uppercase">
                                        {ex.id}
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 bg-muted/30 p-2 rounded-lg border border-dashed">
                                      <div className="space-y-0.5">
                                        <div className="text-[9px] text-red-600 font-bold uppercase">Dikembalikan</div>
                                        <div className="text-xs font-semibold leading-tight line-clamp-2">{ex.originalItem.name}</div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground">{ex.originalItem.quantity} pcs</span>
                                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">{ex.originalItem.sku || '-'}</span>
                                        </div>
                                        {/* Tanggal Beli */}
                                        <div className="text-[9px] text-blue-600 mt-1 flex items-center gap-1">
                                          {(() => {
                                            if (!ex.originalPurchaseDate) return null;
                                            const purchaseDate = new Date(ex.originalPurchaseDate).toISOString().split('T')[0];
                                            const exchangeDate = new Date(ex.date).toISOString().split('T')[0];
                                            if (purchaseDate === exchangeDate) {
                                              return <><Calendar className="h-3 w-3" /> Tanggal Beli: Di hari yg sama</>;
                                            }
                                            return <><Calendar className="h-3 w-3" /> Tanggal Beli: {new Date(ex.originalPurchaseDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</>;
                                          })()}
                                        </div>
                                      </div>
                                      <ArrowRight className="h-3.5 w-3.5 text-purple-500" />
                                      <div className="space-y-0.5 text-right">
                                        <div className="text-[9px] text-green-600 font-bold uppercase">Ditukar</div>
                                        <div className="text-xs font-semibold leading-tight line-clamp-2">{ex.newItem.name}</div>
                                        <div className="flex items-center justify-end gap-1.5">
                                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">{ex.newItem.sku || '-'}</span>
                                          <span className="text-[10px] text-muted-foreground">{ex.newItem.quantity} pcs</span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="mt-3 flex justify-between items-end">
                                      <div className="flex items-center gap-2">
                                        <div className="text-[9px] text-muted-foreground">
                                          Ref: {ex.originalTransactionId || '-'}
                                        </div>
                                        {/* Cancel exchange button - opens dialog */}
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 px-2 text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50"
                                          onClick={() => setExchangeToDelete(ex)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-1" />
                                          Batalkan
                                        </Button>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-[9px] text-muted-foreground uppercase font-bold">Selisih</div>
                                        <div className={`text-xs font-bold ${ex.priceDifference > 0 ? 'text-amber-600' : ex.priceDifference < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                          {ex.priceDifference > 0 ? '+' : ''}{formatCurrency(ex.priceDifference)}
                                        </div>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            } else {
                              const rf = item.data as RefundRecord;
                              return (
                                <Card key={rf.id} className="overflow-hidden border-l-4 border-l-purple-500 shadow-sm">
                                  <CardContent className="p-3 sm:p-4">
                                    {/* Header with status on left and purchase date on right */}
                                    <div className="flex justify-between items-start mb-3">
                                      {/* Left: Status with date */}
                                      <div className="flex items-center gap-1.5">
                                        <RotateCcw className="h-3.5 w-3.5 text-red-600" />
                                        <span className="text-xs font-semibold text-red-600 uppercase">DIKEMBALIKAN</span>
                                        <span className="text-xs text-muted-foreground">
                                          {new Date(rf.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                                        </span>
                                      </div>
                                      {/* Right: Tanggal Beli */}
                                      {rf.originalPurchaseDate && (
                                        <div className="text-[10px] text-blue-600 flex items-center gap-1">
                                          <Calendar className="h-3 w-3" />
                                          <span>Tanggal Beli: {new Date(rf.originalPurchaseDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Product name - smaller font size */}
                                    <div className="text-sm font-bold leading-tight mb-2">{rf.item.name}</div>

                                    {/* Quantity and SKU in inline badges */}
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-blue-600 font-semibold">{rf.item.quantity} pcs</span>
                                      <span className="text-[10px] px-2 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">
                                        {rf.item.sku || 'N/A'}
                                      </span>
                                    </div>

                                    {/* Footer with Batalkan button only */}
                                    <div className="mt-3 flex justify-end">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-3 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5 font-medium"
                                        onClick={() => setRefundToDelete(rf)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Batalkan
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            }
                          })}
                        </div>

                        {/* Pagination controls for Tukar/History */}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 mt-6 pt-2 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => setTukarPage(1)}
                              disabled={tukarPage === 1}
                            >
                              Awal
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              onClick={() => setTukarPage(p => Math.max(1, p - 1))}
                              disabled={tukarPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-xs font-medium px-2">
                              {tukarPage} / {totalPages}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              onClick={() => setTukarPage(p => Math.min(totalPages, p + 1))}
                              disabled={tukarPage === totalPages}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => setTukarPage(totalPages)}
                              disabled={tukarPage === totalPages}
                            >
                              Akhir
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="py-12 text-center text-muted-foreground border rounded-xl bg-muted/10 flex flex-col items-center gap-2">
                        <RotateCcw className="h-8 w-8 opacity-20" />
                        <div className="font-medium">Tidak ada riwayat refund</div>
                        <div className="text-xs">Ubah filter tanggal untuk mencari data lain</div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Visitor Detail Dialog */}
      <Dialog open={!!visitorDetail} onOpenChange={(o) => { if (!o) setVisitorDetail(null); }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Detail Tamu Harian</DialogTitle>
            <DialogDescription>Ringkasan jumlah tamu dan catatan lost.</DialogDescription>
          </DialogHeader>
          {visitorDetail && (() => {
            const vLogs = getFromLS<any[]>(LS_KEYS.VISITORS_LOG, []);
            const lLogs = getFromLS<any[]>(LS_KEYS.VISITOR_LOST_LOG, []);
            const dateStr = new Date(visitorDetail.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
            const vCount = vLogs.filter(e => e.date === visitorDetail.date).length;
            const lCount = lLogs.filter(e => e.date === visitorDetail.date).length;
            const notes = visitorDetail.notes;
            return (
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <div className="font-medium">Tanggal</div>
                  <div className="text-sm text-muted-foreground">{dateStr}</div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-sm">Tamu: <span className="font-semibold">{vCount}</span></div>
                  <div className="text-sm">Lost: <span className="font-semibold">{lCount}</span></div>
                </div>
                <div>
                  <div className="font-medium">Keterangan Lost</div>
                  {!notes.length ? (
                    <div className="text-sm text-muted-foreground">Tidak ada catatan</div>
                  ) : (
                    <ul className="list-disc pl-5 text-sm space-y-1">{notes.map((n, i) => (<li key={i}>{n}</li>))}</ul>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Transaction Detail Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) setSelectedItemIndex(null); }}>
        <DialogContent className="w-full max-w-[98vw] sm:max-w-md p-2 sm:p-6 max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Detail Transaksi</DialogTitle>
            <DialogDescription>Daftar item, total, dan aksi transaksi.</DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{selectedTransaction.id}</p>
                    <p className="text-sm text-muted-foreground">{new Date(selectedTransaction.date).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <Badge variant={selectedTransaction.status === "completed" ? "default" : selectedTransaction.status === "pending" ? "secondary" : selectedTransaction.status === "cancelled" ? "destructive" : "outline"} className="mt-1">
                    {selectedTransaction.status === "completed" ? "Selesai" : selectedTransaction.status === "pending" ? "Pending" : selectedTransaction.status === "cancelled" ? "Batal" : "Refund"}
                  </Badge>
                </div>
                <div>
                  <p className="font-medium">Pelanggan</p>
                  <p>{selectedTransaction.customer}</p>
                </div>
                <p className="font-medium mb-2">Item</p>
                <div className="space-y-2">
                  {(() => {
                    const list = (selectedItemIndex !== null && selectedItemIndex >= 0 && selectedItemIndex < selectedTransaction.items.length)
                      ? selectedTransaction.items.filter((_, i) => i === selectedItemIndex)
                      : selectedTransaction.items;
                    return list.map((item, index) => {
                      const allProducts = getProducts();
                      let sku = item.sku; if (!sku) { const prod = allProducts.find(p => p.name === item.name); sku = prod?.sku || "-"; }
                      return (
                        <div key={index} className="flex justify-between">
                          <div>
                            <p>{item.name}</p>
                            <div className="mt-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">
                                {sku}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{item.quantity} x {formatCurrency(item.price)}<Badge variant="outline" className="ml-2 text-xs">{item.type === 'product' ? 'Produk' : 'Jasa'}</Badge></p>
                          </div>
                          <p className="font-medium">{formatCurrency(item.quantity * item.price)}</p>
                        </div>
                      );
                    });
                  })()}
                </div>
                <Separator className="my-2" />
                <div className="space-y-1.5 bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                  {(() => {
                    const isSingleItem = selectedItemIndex !== null && selectedItemIndex >= 0 && selectedItemIndex < selectedTransaction.items.length;
                    const subtotal = isSingleItem
                      ? (selectedTransaction.items[selectedItemIndex].price * selectedTransaction.items[selectedItemIndex].quantity)
                      : selectedTransaction.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                    const hasDiscount = !isSingleItem && (selectedTransaction.discountAmount || 0) > 0;

                    return (
                      <>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">{isSingleItem ? 'Subtotal Item' : 'Subtotal'}</span>
                          <span className={hasDiscount ? "line-through text-muted-foreground" : "font-semibold"}>
                            {formatCurrency(subtotal)}
                          </span>
                        </div>

                        {hasDiscount && (
                          <div className="flex justify-between items-center text-sm py-1 px-2 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-rose-600 dark:text-rose-400 font-medium border border-rose-100 dark:border-rose-900/50">
                            <div className="flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5" />
                              <span>Diskon ({selectedTransaction.discountPercent}%)</span>
                            </div>
                            <span>-{formatCurrency(selectedTransaction.discountAmount || 0)}</span>
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-1 mt-1 border-t border-gray-200 dark:border-gray-700">
                          <span className="font-bold text-gray-900 dark:text-gray-100">{isSingleItem ? 'Total Item' : 'Total Akhir'}</span>
                          <span className="text-xl font-black text-amber-600 tracking-tight">
                            {formatCurrency(isSingleItem ? subtotal : selectedTransaction.total)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 flex items-center justify-center gap-2" onClick={handlePrintReceipt}>
                  <Printer className="h-4 w-4" /> Cetak Struk
                </Button>
                {selectedTransaction.status === "completed" && (
                  <Button variant="outline" className="flex-1 flex items-center justify-center gap-2" onClick={handleExchangeClick}>
                    <RotateCcw className="h-4 w-4" /> {(selectedItemIndex !== null && selectedItemIndex >= 0 && selectedItemIndex < selectedTransaction.items.length) ? 'Tukar Item Ini' : 'Tukar'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden print area for 58mm receipt */}
      {
        selectedTransaction && (
          <div className="print-area">
            {(() => {
              const profile = getFromLS<ProfileData | null>(
                'bengkel_profile',
                {
                  id: 'profile-1',
                  name: 'Admin Toko',
                  email: 'admin@tokobautbbm.com',
                  phone: '081234567890',
                  address: 'Alamat Toko Baut BBM',
                  workshopName: 'TOKO BAUT BBM',
                  avatarUrl: ''
                }
              );
              const trx = selectedTransaction;
              const subtotal = trx.items.reduce((s, it) => s + it.price * it.quantity, 0);
              const dateStr = `${new Date(trx.date).toLocaleDateString('id-ID')} ${new Date(trx.date).toLocaleTimeString('id-ID')}`;
              return (
                <div className="receipt">
                  <div className="center" style={{ marginBottom: 8 }}>
                    <h3>{profile?.workshopName || 'TOKO BAUT BBM'}</h3>
                    <p>{profile?.address || 'Alamat Toko'}</p>
                    <p>Telp: {profile?.phone || '-'}</p>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <p>No. Transaksi: {trx.id}</p>
                    <p>Tanggal: {dateStr}</p>
                    <p>Pelanggan: {trx.customer}</p>
                  </div>

                  <div className="divider" />
                  <div>
                    {trx.items.map((item, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>
                        <div>{item.name}</div>
                        <div className="row"><span>{item.quantity} x {formatCurrency(item.price)}</span><span>{formatCurrency(item.quantity * item.price)}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="divider" />

                  <div className="row"><strong>Subtotal</strong><strong>{formatCurrency(subtotal)}</strong></div>
                  <div className="row"><strong>Total</strong><strong>{formatCurrency(trx.total)}</strong></div>

                  <div className="center" style={{ marginTop: 8 }}>
                    <p>Terima kasih atas kunjungan Anda</p>
                    <p>Silakan datang kembali</p>
                  </div>
                </div>
              );
            })()}
          </div>
        )
      }

      {/* Exchange Options Dialog */}
      <Dialog open={showExchangeOptions} onOpenChange={(open) => {
        setShowExchangeOptions(open);
        if (!open) setReturnQuantity(1); // Reset when closed
      }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pilih Aksi</DialogTitle>
            <DialogDescription>
              Tentukan jumlah yang ingin ditukar/refund, lalu pilih aksi.
            </DialogDescription>
          </DialogHeader>
          {exchangeItemToReturn && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium flex-1">{exchangeItemToReturn.item.name}</div>
                  {(() => {
                    const products = getProducts();
                    let sku = exchangeItemToReturn.item.sku;
                    if (!sku) {
                      const prod = products.find(p => p.name === exchangeItemToReturn.item.name);
                      sku = prod?.sku || '-';
                    }
                    return (
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">
                        {sku}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-xs text-muted-foreground">
                  Dibeli: {exchangeItemToReturn.item.quantity} x {formatCurrency(exchangeItemToReturn.item.price)}
                </div>
                {selectedTransaction && (
                  <div className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Tanggal Beli: {new Date(selectedTransaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                )}
              </div>

              {/* Qty Selector */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-sm font-medium text-amber-800 mb-2">Jumlah yang akan dikembalikan:</div>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 border-amber-300 hover:bg-amber-100"
                    onClick={() => setReturnQuantity(q => Math.max(1, q - 1))}
                    disabled={returnQuantity <= 1}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <div className="flex flex-col items-center">
                    <input
                      type="number"
                      inputMode="numeric"
                      className="text-2xl font-bold text-amber-700 min-w-[50px] w-[70px] text-center bg-transparent border-b-2 border-amber-300 focus:border-amber-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={returnQuantity}
                      min={1}
                      max={exchangeItemToReturn.item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        if (val >= 0 && val <= exchangeItemToReturn.item.quantity) {
                          setReturnQuantity(val);
                        }
                      }}
                      onBlur={() => {
                        if (returnQuantity < 1) setReturnQuantity(1);
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground">dari {exchangeItemToReturn.item.quantity} pcs</span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 border-amber-300 hover:bg-amber-100"
                    onClick={() => setReturnQuantity(q => Math.min(exchangeItemToReturn.item.quantity, q + 1))}
                    disabled={returnQuantity >= exchangeItemToReturn.item.quantity}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 text-center text-sm font-semibold text-amber-700">
                  Nilai: {formatCurrency(exchangeItemToReturn.item.price * returnQuantity)}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  className="w-full h-14 bg-amber-500 hover:bg-amber-600 flex items-center justify-center gap-3"
                  onClick={handleChooseExchange}
                >
                  <RefreshCw className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">Tukar dengan Barang Lain</div>
                    <div className="text-xs opacity-80">Tukar {returnQuantity} pcs dengan barang lain</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-14 flex items-center justify-center gap-3 border-red-200 hover:bg-red-50 hover:border-red-300"
                  onClick={handleRefundOnly}
                >
                  <Banknote className="h-5 w-5 text-red-500" />
                  <div className="text-left">
                    <div className="font-medium text-red-600">Refund Saja</div>
                    <div className="text-xs text-muted-foreground">Kembalikan {formatCurrency(exchangeItemToReturn.item.price * returnQuantity)}</div>
                  </div>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Product Picker Dialog - Full Screen */}
      <Dialog open={showProductPicker} onOpenChange={setShowProductPicker}>
        <DialogContent className="w-full max-w-full h-[100dvh] flex flex-col p-0 rounded-none overflow-hidden">
          <DialogHeader className="p-4 pb-2 border-b shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowProductPicker(false)}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div>
                <DialogTitle>Pilih Barang Pengganti</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Cari dan pilih barang yang akan ditukar.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="p-4 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Cari produk..."
                className="w-full pl-10 pr-10 py-3 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                value={productPickerSearch}
                onChange={(e) => handlePickerSearchChange(e.target.value)}
                autoFocus
              />
              {productPickerSearch && (
                <button
                  onClick={() => handlePickerSearchChange("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 bg-red-500 hover:bg-red-600 rounded-full"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
            {/* Page info */}
            <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
              <span>{filteredProductsForPicker.length} produk ditemukan</span>
              <span>Halaman {productPickerPage} dari {totalPickerPages || 1}</span>
            </div>
          </div>
          <ScrollArea className="flex-1 min-h-0 px-4 pt-2 pb-24">
            <div className="space-y-2">
              {paginatedPickerProducts.map((product) => {
                const isSelected = selectedNewProduct?.id === product.id;
                return (
                  <Card
                    key={product.id}
                    className={`hover:border-primary transition-colors ${isSelected ? 'border-amber-500 bg-amber-50' : ''}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex gap-2">
                        {/* Left side - product info */}
                        <div className="flex-1 min-w-0" onClick={() => {
                          setSelectedNewProduct(product);
                          setCustomPrice(null);
                          if (exchangeQuantity === 0) setExchangeQuantity(1);
                        }}>
                          <div className="font-medium text-sm leading-tight break-words">{product.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="font-semibold text-amber-600">{formatCurrency(product.price)}</span>
                            {product.stock !== undefined && (
                              <span className="text-xs text-muted-foreground">Stok: {product.stock}</span>
                            )}
                          </div>
                        </div>
                        {/* Right side - Category + SKU + qty controls */}
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {/* Category & SKU badges at top right */}
                          <div className="flex items-center gap-1">
                            {product.category && (
                              <div className="text-[10px] text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded bg-blue-50">
                                {product.category}
                              </div>
                            )}
                            {product.sku && (
                              <div className="text-[10px] px-2 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">
                                {product.sku}
                              </div>
                            )}
                          </div>
                          {/* Quantity controls */}
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isSelected && exchangeQuantity > 1) {
                                  setExchangeQuantity(q => q - 1);
                                } else if (isSelected && exchangeQuantity === 1) {
                                  setSelectedNewProduct(null);
                                  setExchangeQuantity(0);
                                }
                              }}
                              disabled={!isSelected}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <div className="min-w-[32px] h-7 flex items-center justify-center text-sm font-medium border rounded bg-white">
                              {isSelected ? exchangeQuantity : 0}
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isSelected) {
                                  setSelectedNewProduct(product);
                                  setExchangeQuantity(1);
                                } else {
                                  setExchangeQuantity(q => q + 1);
                                }
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Custom Price input - only show when selected */}
                      {isSelected && (
                        <div
                          className="flex items-center gap-2 mt-2 pt-2 border-t pl-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs text-blue-500 font-medium">Custom Harga</span>
                          <div className="flex items-center border rounded bg-white overflow-hidden">
                            <span className="px-2 text-xs text-muted-foreground bg-gray-50 py-1 border-r">Rp</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              step="1000"
                              placeholder={String(product.price)}
                              value={customPrice ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCustomPrice(val === '' ? null : parseInt(val) || 0);
                              }}
                              className="w-24 px-2 py-1 text-right text-sm focus:ring-1 focus:ring-amber-400 focus:outline-none"
                              title="Ubah harga jual (opsional)"
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {paginatedPickerProducts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Tidak ada produk ditemukan
                </div>
              )}
            </div>
          </ScrollArea>
          {/* Bottom Bar: Pagination + Cart */}
          <div className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur border-t shadow-lg">
            {/* Pagination */}
            {totalPickerPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setProductPickerPage(p => Math.max(1, p - 1))}
                  disabled={productPickerPage === 1}
                >
                  &lt;
                </Button>
                <span className="text-xs font-medium">
                  {productPickerPage}/{totalPickerPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setProductPickerPage(p => Math.min(totalPickerPages, p + 1))}
                  disabled={productPickerPage === totalPickerPages}
                >
                  &gt;
                </Button>
              </div>
            ) : <div />}
            {/* Cart Button - Minimalist */}
            {selectedNewProduct && exchangeQuantity > 0 ? (
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-all shadow-md"
                onClick={() => {
                  setShowProductPicker(false);
                  setShowExchangeConfirm(true);
                }}
              >
                <RefreshCw className="h-4 w-4" />
                <span>{exchangeQuantity}x</span>
                <span className="font-bold">{formatCurrency((customPrice ?? selectedNewProduct.price) * exchangeQuantity)}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <div className="text-xs text-muted-foreground">Pilih barang untuk tukar</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Exchange Confirmation Dialog */}
      <Dialog open={showExchangeConfirm} onOpenChange={setShowExchangeConfirm}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md [&>button]:bg-red-500 [&>button]:hover:bg-red-600 [&>button]:text-white [&>button]:rounded-full">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowExchangeConfirm(false);
                  setShowProductPicker(true);
                }}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div>
                <DialogTitle>Konfirmasi Tukar</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Pastikan data tukar sudah benar.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {exchangeItemToReturn && selectedNewProduct && (() => {
            const qtyToReturn = Math.min(returnQuantity, exchangeItemToReturn.item.quantity);
            const oldTotal = exchangeItemToReturn.item.price * qtyToReturn;
            const actualPrice = customPrice ?? selectedNewProduct.price; // Use custom price if set
            const newTotal = actualPrice * exchangeQuantity;
            const diff = newTotal - oldTotal;
            return (
              <div className="space-y-4">
                {/* Info sisa qty jika partial */}
                {qtyToReturn < exchangeItemToReturn.item.quantity && (
                  <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg text-center text-xs text-blue-700">
                    ℹ️ Sisa <span className="font-bold">{exchangeItemToReturn.item.quantity - qtyToReturn} pcs</span> {exchangeItemToReturn.item.name} tetap di transaksi
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex-1 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="text-xs text-red-600 font-medium mb-1">Barang Lama (dikembalikan)</div>
                    <div className="font-medium text-sm">{exchangeItemToReturn.item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {qtyToReturn} x {formatCurrency(exchangeItemToReturn.item.price)}
                    </div>
                    <div className="font-semibold text-red-600 mt-1">{formatCurrency(oldTotal)}</div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="text-xs text-green-600 font-medium mb-1">Barang Baru (ditukar)</div>
                    <div className="font-medium text-sm">{selectedNewProduct.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {exchangeQuantity} x {formatCurrency(actualPrice)}
                      {customPrice !== null && customPrice !== selectedNewProduct.price && (
                        <span className="ml-1 text-amber-600">(custom)</span>
                      )}
                    </div>
                    <div className="font-semibold text-green-600 mt-1">{formatCurrency(newTotal)}</div>
                  </div>
                </div>

                {/* Price Difference */}
                <div className={`p-4 rounded-lg text-center ${diff > 0 ? 'bg-amber-50 border border-amber-200' :
                  diff < 0 ? 'bg-green-50 border border-green-200' :
                    'bg-gray-50 border border-gray-200'
                  }`}>
                  <div className="text-sm text-muted-foreground mb-1">Selisih Harga</div>
                  <div className={`text-2xl font-bold ${diff > 0 ? 'text-amber-600' :
                    diff < 0 ? 'text-green-600' :
                      'text-gray-600'
                    }`}>
                    {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                  </div>
                  <div className="text-sm mt-1">
                    {diff > 0 ? '⬆️ Pelanggan tambah bayar' :
                      diff < 0 ? '⬇️ Kembalian untuk pelanggan' :
                        '✓ Tidak ada selisih'}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowExchangeConfirm(false);
                      setShowProductPicker(true);
                    }}
                  >
                    Ganti Barang
                  </Button>
                  <Button
                    className="flex-1 bg-amber-500 hover:bg-amber-600"
                    onClick={processExchange}
                  >
                    Konfirmasi Tukar
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Cancel Exchange Confirmation Dialog */}
      <Dialog open={!!exchangeToDelete} onOpenChange={(open) => !open && setExchangeToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl">Batalkan Tukar?</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              Tukar akan dibatalkan dan stok akan dikembalikan seperti semula
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 sm:justify-center mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setExchangeToDelete(null)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              onClick={() => exchangeToDelete && undoExchange(exchangeToDelete)}
            >
              <Trash2 className="h-4 w-4" />
              Ya, Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Confirmation Dialog */}
      <Dialog open={showRefundConfirm} onOpenChange={(open) => !open && setShowRefundConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl">Konfirmasi Refund</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              {exchangeItemToReturn && (
                <>
                  Anda akan me-refund <span className="font-semibold text-foreground">{exchangeItemToReturn.item.name}</span>.
                  <br />
                  <span className="text-xs mt-2 block">Stok akan dikembalikan dan transaksi akan tercatat sebagai refund.</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Qty Selector in confirmation dialog */}
          {exchangeItemToReturn && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="text-sm font-medium text-red-800 mb-2 text-center">Jumlah yang akan di-refund:</div>
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 border-red-300 hover:bg-red-100"
                  onClick={() => setReturnQuantity(q => Math.max(1, q - 1))}
                  disabled={returnQuantity <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="flex flex-col items-center">
                  <input
                    type="number"
                    inputMode="numeric"
                    className="text-2xl font-bold text-red-700 min-w-[50px] w-[70px] text-center bg-transparent border-b-2 border-red-300 focus:border-red-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    value={returnQuantity}
                    min={1}
                    max={exchangeItemToReturn.item.quantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      if (val >= 0 && val <= exchangeItemToReturn.item.quantity) {
                        setReturnQuantity(val);
                      }
                    }}
                    onBlur={() => {
                      if (returnQuantity < 1) setReturnQuantity(1);
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">dari {exchangeItemToReturn.item.quantity} pcs</span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 border-red-300 hover:bg-red-100"
                  onClick={() => setReturnQuantity(q => Math.min(exchangeItemToReturn.item.quantity, q + 1))}
                  disabled={returnQuantity >= exchangeItemToReturn.item.quantity}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 text-center text-sm font-semibold text-red-700">
                Nilai: {formatCurrency(exchangeItemToReturn.item.price * returnQuantity)}
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-3 sm:justify-center mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowRefundConfirm(false)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2 bg-red-600 hover:bg-red-700"
              onClick={handleRefundOnly}
            >
              <RotateCcw className="h-4 w-4" />
              Ya, Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Refund Confirmation Dialog */}
      <Dialog open={!!refundToDelete} onOpenChange={(open) => !open && setRefundToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl">Batalkan Refund?</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              {refundToDelete && (
                <>
                  Anda akan membatalkan refund untuk <span className="font-semibold text-foreground">{refundToDelete.item.name}</span> sebanyak <span className="font-semibold text-foreground">{refundToDelete.item.quantity} pcs</span>.
                  <br />
                  <span className="text-xs mt-2 block">Stok akan dikurangi kembali dan refund akan dihapus dari riwayat.</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 sm:justify-center mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRefundToDelete(null)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              onClick={() => refundToDelete && handleDeleteRefund(refundToDelete)}
            >
              <Trash2 className="h-4 w-4" />
              Ya, Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
};

export default TransactionHistory;
