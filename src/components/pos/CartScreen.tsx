import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, getRelativeDateBadgeClass } from "@/lib/utils";
import { getProducts, setProducts as setCachedProducts, pushStockToSheet } from "@/lib/productCache";
import { Button } from "@/components/ui/button";
import { Minus, Plus, ShoppingCart, Trash2, CreditCard, Tag } from "lucide-react";
import DiscountUnlockDialog, { formatDiscountPercent } from "@/components/pos/DiscountUnlockDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle, Download, Check } from "lucide-react";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { usePosStore } from "@/store/usePosStore";
import type { Product, CartItem } from '@/types/pos'
import { completeTransactionUtil, generateTextReceipt } from "@/lib/transactions";
import { useToast } from "@/components/ui/use-toast";
import { addNote } from "@/lib/notes";
import { Input } from "@/components/ui/input";

const CartScreen = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const cart = usePosStore(s => s.cart);
  // PPN feature removed
  const updateQuantityStore = usePosStore(s => s.updateQuantity);
  const setItemPrice = usePosStore(s => s.setItemPrice);
  const clearCart = usePosStore(s => s.clearCart);
  // Diskon keranjang dalam persen (0 = tidak aktif). Box Rp di UI = ekuivalen rupiahnya.
  const discountPercent = usePosStore(s => s.discountPercent);
  const setDiscountPercent = usePosStore(s => s.setDiscountPercent);
  const clearDiscount = usePosStore(s => s.clearDiscount);
  const isDiscountActive = discountPercent > 0;
  // Buffer ketikan lokal agar input % dan Rp tidak saling menimpa saat sedang diketik
  const [editingPct, setEditingPct] = useState<string | null>(null);
  const [editingRp, setEditingRp] = useState<string | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [isCartLoaded, setIsCartLoaded] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptContent, setReceiptContent] = useState("");
  const [isUangPasSelected, setIsUangPasSelected] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [lastTransactionTotal, setLastTransactionTotal] = useState(0);
  // Konfirmasi hapus barang dari keranjang
  const [itemToDelete, setItemToDelete] = useState<CartItem | null>(null);

  // UX diskon: barang yang box harganya di-tap saat diskon aktif -> dialog panduan
  const [unlockTarget, setUnlockTarget] = useState<CartItem | null>(null);
  // Id item yang box harganya akan difokuskan setelah diskon dihapus
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // UX diskon: konfirmasi hapus diskon dari dialog, lalu fokus ke box harga barang tsb
  const confirmUnlockDiscount = () => {
    clearDiscount();
    const id = unlockTarget?.id ?? null;
    setUnlockTarget(null);
    if (id) setFocusItemId(id);
    toast({ description: "Diskon dinonaktifkan — silakan edit harga" });
  };

  // Hutang (Debt) states
  const [isHutangMode, setIsHutangMode] = useState(false);
  const [showHutangDialog, setShowHutangDialog] = useState(false);
  const [hutangCustomerName, setHutangCustomerName] = useState("");
  const [customerNameInput, setCustomerNameInput] = useState("");

  // FIX QTY/PRICE INPUT: State untuk menyimpan nilai string sementara saat user mengetik
  const [editingQuantities, setEditingQuantities] = useState<Record<string, string>>({});
  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({});
  const printAreaRef = React.useRef<HTMLDivElement>(null);

  // Tambahkan state untuk pagination cart
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [barcodeFilter, setBarcodeFilter] = useState("");


  // Reset ke halaman 1 jika cart berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [cart]);

  useEffect(() => {
    // Data keranjang dikelola oleh Zustand (persist)
    setIsCartLoaded(true);
  }, []);

  // Total sama dengan subtotal (tanpa PPN). Saat diskon aktif, item.price sudah harga setelah potong.
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;
  // Total harga asli (sebelum diskon) untuk tampilan coret
  const originalTotal = cart.reduce((sum, item) => sum + (item.basePrice ?? item.price) * item.quantity, 0);
  // Jumlah rupiah yang benar-benar terpotong (harga asli - harga diskon)
  const totalDiscountRp = originalTotal - total;
  // Format persen: tampil bulat jika bisa (10 -> "10"), else max 2 desimal (1.67 -> "1.67")
  const formatPct = (p: number) => (p % 1 === 0 ? String(p) : String(parseFloat(p.toFixed(2))));

  // Auto-update amountPaid ketika total berubah dan Uang Pas sudah dipilih
  React.useEffect(() => {
    if (isUangPasSelected) {
      setAmountPaid(String(Math.ceil(total)));
    }
  }, [total, isUangPasSelected]);

  const change = amountPaid ? parseFloat(amountPaid) - total : 0;

  const updateQuantity = (id: string, newQuantity: number) => {
    updateQuantityStore(id, newQuantity);
  };

  // FIX QTY INPUT: Handler saat user selesai mengedit input (onBlur)
  const handleQuantityBlur = (item: CartItem) => {
    const stringValue = editingQuantities[item.id];

    // Jika tidak ada perubahan, abaikan
    if (stringValue === undefined) return;

    let finalQuantity = parseInt(stringValue, 10);

    // Validasi: jika kosong atau tidak valid, kembalikan ke 1
    if (isNaN(finalQuantity) || finalQuantity < 1) {
      finalQuantity = 1;
    }

    // No stock limit - allow any quantity (stock can go negative)

    // Panggil fungsi update utama
    updateQuantity(item.id, finalQuantity);

    // Hapus dari state editing setelah selesai
    const newEditingQuantities = { ...editingQuantities };
    delete newEditingQuantities[item.id];
    setEditingQuantities(newEditingQuantities);
  };


  // Proses pembayaran (dummy, bisa diintegrasi logic POSScreen)
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const handleProsesPembayaran = () => {
    setShowPaymentForm(true);
    setPaymentError("");
  };

  // Tambahkan: proses transaksi identik dengan POSScreen (async for IndexedDB)
  const completeTransaction = async () => {
    if (cart.length === 0) return;
    const products = getProducts() as Product[];
    const { transaction, updatedProducts } = await completeTransactionUtil({
      cart,
      products,
      paymentMethod,
      amountPaid: parseFloat(amountPaid) || 0,
      subtotal,
      tax: 0,
      total,
      customerName: customerNameInput.trim() || undefined,
      discountPercent,
    });

    // Perbarui produk di UI (CartScreen tidak pegang state products, jadi cukup persist)
    setCachedProducts(updatedProducts);

    // ★ Push stock changes to Google Sheet (bidirectional sync)
    const productsBySku = new Map(updatedProducts.map((p: any) => [String(p.sku ?? '').trim().toUpperCase(), p]));
    const stockUpdates = cart
      .filter(i => i.sku && i.sku !== '-')
      .map(cartItem => {
        const prod = productsBySku.get(String(cartItem.sku).trim().toUpperCase());
        return prod ? { sku: prod.sku, stock: prod.stock ?? 0 } : null;
      })
      .filter(Boolean) as Array<{ sku: string; stock: number }>;
    if (stockUpdates.length > 0) pushStockToSheet(stockUpdates);

    // Simpan total untuk popup
    setLastTransactionTotal(total);

    // Kosongkan cart
    clearCart();
    setPaymentMethod("cash");
    setAmountPaid("");
    setShowPaymentForm(false);
    setPaymentError("");
    setIsUangPasSelected(false);
    setCustomerNameInput("");

    // Tampilkan popup sukses
    setShowSuccessPopup(true);
  };
  // Text receipt moved to shared util (generateTextReceipt)

  // Download struk (text)
  const handleDownloadReceipt = () => {
    const blob = new Blob([receiptContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `struk_${Date.now()}.txt`;
    link.click();
  };

  // ...update handleConfirmPayment agar panggil completeTransaction
  const handleConfirmPayment = async () => {
    // Harus pilih Uang Pas dulu
    if (!isUangPasSelected) {
      setPaymentError("Klik 'Uang Pas' terlebih dahulu!");
      return;
    }
    // Cek jika ada item dengan harga 0 atau quantity 0
    const invalidItems = cart.filter(item => item.price === 0 || item.quantity === 0);
    if (invalidItems.length > 0) {
      setPaymentError("Ada item dengan harga atau qty 0. Hapus atau perbaiki dulu!");
      return;
    }
    if (!amountPaid || parseFloat(amountPaid) < total) {
      setPaymentError("Jumlah pembayaran kurang!");
      return;
    }
    setPaymentError("");
    await completeTransaction();
  };

  // Confirm Hutang - simpan sebagai note hutang dan proses transaksi
  const confirmHutang = async () => {
    if (!hutangCustomerName.trim()) {
      setPaymentError("Masukkan nama pelanggan!");
      return;
    }

    // Buat deskripsi item yang dibeli
    const itemsList = cart.map(item => `${item.name} (${item.quantity}x)`).join(", ");

    // Proses transaksi seperti biasa (dengan payment method "hutang")
    const products = getProducts() as Product[];
    const { transaction, updatedProducts } = await completeTransactionUtil({
      cart,
      products,
      paymentMethod: "hutang",
      amountPaid: 0,
      subtotal,
      tax: 0,
      total,
      customerName: hutangCustomerName.trim(),
      discountPercent,
    });

    // Simpan sebagai note hutang (dengan Transaction ID)
    addNote({
      date: new Date().toISOString(),
      content: `Hutang: ${itemsList}`,
      type: 'hutang',
      customerName: hutangCustomerName.trim(),
      amount: total,
      priority: 'penting',
      transactionId: transaction.id // Link ke transaksi ini
    });

    // Perbarui produk di UI
    setCachedProducts(updatedProducts);

    // ★ Push stock changes to Google Sheet (bidirectional sync)
    const productsBySkuHutang = new Map(updatedProducts.map((p: any) => [String(p.sku ?? '').trim().toUpperCase(), p]));
    const stockUpdatesHutang = cart
      .filter(i => i.sku && i.sku !== '-')
      .map(cartItem => {
        const prod = productsBySkuHutang.get(String(cartItem.sku).trim().toUpperCase());
        return prod ? { sku: prod.sku, stock: prod.stock ?? 0 } : null;
      })
      .filter(Boolean) as Array<{ sku: string; stock: number }>;
    if (stockUpdatesHutang.length > 0) pushStockToSheet(stockUpdatesHutang);

    // Simpan total untuk popup
    setLastTransactionTotal(total);

    // Reset states
    clearCart();
    setPaymentMethod("cash");
    setAmountPaid("");
    setShowPaymentForm(false);
    setPaymentError("");
    setIsUangPasSelected(false);
    setIsHutangMode(false);
    setShowHutangDialog(false);
    setHutangCustomerName("");

    // Toast notifikasi
    toast({
      title: "Hutang Tercatat!",
      description: `${hutangCustomerName} - ${formatCurrency(total)}`,
    });

    // Tampilkan popup sukses
    setShowSuccessPopup(true);
  };

  // Filter cart jika barcodeFilter aktif
  const filteredCart = barcodeFilter
    ? cart.filter(item => (item.sku || "").toLowerCase() === barcodeFilter.toLowerCase())
    : cart;
  const totalPages = Math.ceil(filteredCart.length / itemsPerPage);
  const paginatedCart = filteredCart.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Boolean to check if there are items with price or qty 0
  const hasInvalidItems = cart.some(item => item.price === 0 || item.quantity === 0);

  console.log("CartScreen cart:", cart);
  return (
    <div className="min-h-screen bg-background flex flex-col pb-32">
      <div className="flex items-center px-4 py-3 border-b bg-white sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <span className="text-lg">←</span>
        </Button>
        <span className="font-bold text-lg flex items-center ml-2"><ShoppingCart className="mr-2 h-5 w-5" />Keranjang</span>
      </div>
      {/* Badge status diskon — selalu terlihat walau section diskon di bawah tidak terlihat */}
      {isDiscountActive && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900">
          <Tag className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex-1">
            Diskon {formatDiscountPercent(discountPercent)}% aktif — harga custom terkunci
          </span>
          <button
            onClick={clearDiscount}
            className="text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded-full px-3 py-1 active:scale-95 transition-transform"
          >
            HAPUS
          </button>
        </div>
      )}
      {/* Dialog panduan: tap box harga terkunci -> konfirmasi hapus diskon */}
      <DiscountUnlockDialog
        open={unlockTarget !== null}
        onOpenChange={(o) => { if (!o) setUnlockTarget(null); }}
        itemName={unlockTarget?.name ?? null}
        discountPercent={discountPercent}
        onConfirm={confirmUnlockDiscount}
      />
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <h3 className="text-lg font-semibold">Keranjang Anda Kosong</h3>
            <p className="text-sm">Silakan tambahkan produk untuk memulai transaksi.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {paginatedCart.map((item) => (
              <div key={item.id} className="py-2">
                {/* Row 1: Name + SKU + Trash */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                    {item.sku && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-slate-600 border border-slate-300 flex-shrink-0">
                        {item.sku}
                      </span>
                    )}
                    <p className="font-semibold text-xs text-gray-800 break-words leading-tight">{item.name}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-full text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                    onClick={() => setItemToDelete(item)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {/* Row 2: Harga x Qty */}
                <div className="flex items-center gap-2 mt-1 px-1">
                  <span className={`text-[10px] font-medium ${isDiscountActive ? 'text-red-500' : 'text-blue-500'}`}>Custom Harga</span>
                  <div className={`flex items-center border rounded overflow-hidden shadow-sm ${isDiscountActive ? 'border-red-300 bg-red-50' : 'bg-white'}`}>
                    <span className={`px-2 text-[10px] border-r py-1 flex items-center ${isDiscountActive ? 'text-red-400 bg-red-100 border-red-200' : 'text-muted-foreground bg-gray-50'}`}>Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      readOnly={isDiscountActive}
                      value={editingPrices[item.id] !== undefined ? editingPrices[item.id] : item.price.toLocaleString('id-ID')}
                      onClick={isDiscountActive ? () => setUnlockTarget(item) : undefined}
                      ref={el => {
                        if (el && focusItemId === item.id) {
                          el.focus();
                          setFocusItemId(null);
                        }
                      }}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setEditingPrices(prev => ({ ...prev, [item.id]: val }));
                        const newPrice = parseInt(val) || 0;
                        setItemPrice(item.id, newPrice);
                      }}
                      onFocus={(e) => {
                        (e.target as HTMLInputElement).select();
                        setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                      }}
                      onBlur={() => {
                        setEditingPrices(prev => {
                          const next = { ...prev };
                          delete next[item.id];
                          return next;
                        });
                      }}
                      className={`w-20 px-1.5 py-1 text-right text-xs font-medium focus:outline-none ${isDiscountActive ? 'text-red-600 bg-red-50 cursor-pointer' : 'focus:ring-1 focus:ring-amber-400'}`}
                      aria-label={isDiscountActive ? 'Harga terkunci diskon — tap untuk hapus diskon dan edit harga' : 'Ubah harga'}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 mx-1">x</span>
                  <div className="flex items-center border rounded bg-white overflow-hidden shadow-sm">
                    <span className="px-2 text-[10px] text-muted-foreground bg-gray-50 border-r py-1 flex items-center">Qty</span>
                    <input
                      type="number"
                      value={editingQuantities[item.id] ?? item.quantity}
                      onChange={(e) => {
                        setEditingQuantities({ ...editingQuantities, [item.id]: e.target.value });
                      }}
                      onFocus={(e) => {
                        (e.target as HTMLInputElement).select();
                        setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                      }}
                      onBlur={() => handleQuantityBlur(item)}
                      placeholder="0"
                      className="w-10 px-1 py-1 text-center text-xs font-medium focus:ring-1 focus:ring-amber-400 focus:outline-none border-none"
                    />
                  </div>
                </div>
                {/* Row 3: Total + -/+ buttons (centered) */}
                <div className="flex items-center mt-1.5">
                  <p className="font-bold text-amber-600 text-sm">
                    {formatCurrency(item.price * item.quantity)}
                  </p>
                  <div className="flex-1 flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 border-slate-300"
                      onClick={() => updateQuantity(item.id, Math.max(0, item.quantity - 1))}
                      disabled={item.quantity === 0}
                    >
                      <Minus className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 border-slate-300 bg-slate-50 hover:bg-amber-50 hover:border-amber-400 transition-colors"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    >
                      <Plus className="h-4 w-4 text-slate-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 pt-4">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>&lt;</Button>
                <span className="text-sm">Halaman {currentPage} dari {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>&gt;</Button>
              </div>
            )}

            {/* Discount Section - mengontrol box custom harga tiap barang */}
            {cart.length > 0 && (
              <div className={`mt-4 p-4 rounded-xl border-2 shadow-sm transition-colors ${isDiscountActive ? 'bg-red-50 border-red-400' : 'bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-400'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏷️</span>
                    <span className={`text-sm font-semibold ${isDiscountActive ? 'text-red-600' : 'text-purple-700'}`}>Diskon</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Box Rp = ekuivalen rupiah dari diskon. Ketik di sini -> box % otomatis menyesuaikan */}
                    <div className={`flex items-center rounded-lg border overflow-hidden bg-white ${editingRp !== null || (isDiscountActive && editingPct === null) ? 'border-orange-500 ring-1 ring-orange-300' : 'border-orange-300'}`}>
                      <span className="px-2 py-2 bg-orange-100 text-orange-700 font-bold text-[10px] whitespace-nowrap">Rp</span>
                      <input
                        type="number"
                        min="0"
                        value={editingRp !== null ? editingRp : (totalDiscountRp > 0 ? Math.round(totalDiscountRp) : '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingRp(val);
                          const rp = parseFloat(val) || 0;
                          // Konversi Rp -> persen dari total harga asli
                          if (originalTotal > 0 && rp > 0) {
                            setDiscountPercent(Math.min(100, (rp / originalTotal) * 100));
                          } else {
                            setDiscountPercent(0);
                          }
                        }}
                        onFocus={(e) => {
                          setEditingRp(String(totalDiscountRp > 0 ? Math.round(totalDiscountRp) : ''));
                          setEditingPct(null);
                          setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                        }}
                        onBlur={() => setEditingRp(null)}
                        placeholder="0"
                        className="no-number-spinner w-28 px-2 py-2 text-center text-sm font-semibold focus:outline-none"
                      />
                    </div>
                    {/* Box % = sumber diskon. Ketik di sini -> box Rp otomatis menyesuaikan */}
                    <div className={`flex items-center rounded-lg border overflow-hidden bg-white ${editingPct !== null || (isDiscountActive && editingRp === null) ? 'border-purple-600 ring-1 ring-purple-300' : 'border-purple-300'}`}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={editingPct !== null ? editingPct : (discountPercent > 0 ? formatPct(discountPercent) : '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingPct(val);
                          const pct = parseFloat(val) || 0;
                          setDiscountPercent(pct);
                        }}
                        onFocus={(e) => {
                          setEditingPct(discountPercent > 0 ? formatPct(discountPercent) : '');
                          setEditingRp(null);
                          setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                        }}
                        onBlur={() => setEditingPct(null)}
                        placeholder="0"
                        className="no-number-spinner w-14 px-2 py-2 text-center text-sm font-semibold focus:outline-none"
                      />
                      <span className="px-2 py-2 bg-purple-100 text-purple-700 font-bold text-sm">%</span>
                    </div>
                  </div>
                </div>

                {/* Quick buttons + clear */}
                <div className="flex gap-2 mt-3">
                  {[3, 5, 7, 10].map((p) => (
                    <button
                      key={p}
                      onClick={() => setDiscountPercent(p)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${discountPercent === p
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'
                        }`}
                    >
                      {p}%
                    </button>
                  ))}
                  {isDiscountActive && (
                    <button
                      onClick={clearDiscount}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all"
                    >
                      ✕ Hapus
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {isDiscountActive
                    ? `Diskon ${formatPct(discountPercent)}% ≈ hemat Rp ${Math.round(totalDiscountRp).toLocaleString('id-ID')} - semua box harga otomatis menyesuaikan (merah)`
                    : 'Isi % atau Rp - keduanya saling menyesuaikan, semua box custom harga ikut berubah'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>


      {/* Ringkasan & Pembayaran - Compact inline design */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-30 pb-20">
        {isCartLoaded && cart.length > 0 && (
          <div className="p-3 space-y-2">
            {/* Baris 0: Input Nama Pelanggan */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-blue-500 font-semibold whitespace-nowrap">Nama Pelanggan</span>
              <div className="flex items-center border rounded bg-white overflow-hidden shadow-sm max-w-[140px]">
                <input
                  type="text"
                  value={customerNameInput}
                  onChange={e => setCustomerNameInput(e.target.value.toUpperCase())}
                  onFocus={e => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)}
                  placeholder="Opsional..."
                  className="w-full px-2 py-1.5 text-xs font-medium focus:ring-1 focus:ring-blue-400 focus:outline-none uppercase"
                />
              </div>
            </div>

            {/* Baris 1: Uang Pas (kiri) + Total (tengah) + Hutang (kanan) */}
            <div className="flex items-center justify-between gap-2">
              {/* Uang Pas Button - Left */}
              <Button
                type="button"
                variant={isUangPasSelected ? "default" : "outline"}
                className={`h-10 px-4 font-semibold ${isUangPasSelected ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                onClick={() => {
                  if (isUangPasSelected) {
                    // Unselect
                    setIsUangPasSelected(false);
                    setAmountPaid("");
                  } else {
                    // Select
                    setIsUangPasSelected(true);
                    setIsHutangMode(false);
                    setAmountPaid(String(Math.ceil(total)));
                  }
                  setPaymentError("");
                }}
              >
                {isUangPasSelected ? "✓ Uang Pas" : "💵 Uang Pas"}
              </Button>

              {/* Total - Center */}
              <div className="flex flex-col items-center flex-1">
                {isDiscountActive && (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-400 line-through">{formatCurrency(originalTotal)}</span>
                    <span className="text-red-500 font-semibold">
                      -{formatPct(discountPercent)}% ({formatCurrency(totalDiscountRp)})
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Total:</span>
                  <span className="text-xl font-bold text-amber-600">{formatCurrency(total)}</span>
                </div>
              </div>

              {/* Hutang Button - Right */}
              <Button
                type="button"
                variant={isHutangMode ? "default" : "outline"}
                className={`h-10 px-4 font-semibold ${isHutangMode ? "bg-red-500 hover:bg-red-600 text-white" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                onClick={() => {
                  if (isHutangMode) {
                    setIsHutangMode(false);
                  } else {
                    setIsHutangMode(true);
                    setIsUangPasSelected(false);
                    setAmountPaid("");
                    // Auto-fill hutangCustomerName from customerNameInput
                    if (customerNameInput.trim()) {
                      setHutangCustomerName(customerNameInput.trim());
                    }
                    setShowHutangDialog(true);
                  }
                  setPaymentError("");
                }}
                disabled={hasInvalidItems}
              >
                <CreditCard className="h-4 w-4 mr-1" />
                {isHutangMode ? "✓ Hutang" : "Hutang"}
              </Button>
            </div>

            {(paymentError || hasInvalidItems) && (
              <div className="text-red-600 text-xs text-center">
                {hasInvalidItems ? "Ada item dengan harga atau qty 0. Hapus atau perbaiki dulu!" : paymentError}
              </div>
            )}

            {/* Tombol Konfirmasi - aktif jika Uang Pas atau Hutang dipilih */}
            <Button
              className={`w-full h-11 text-base font-semibold ${(isUangPasSelected || isHutangMode) ? (isHutangMode ? "bg-red-500 hover:bg-red-600" : "bg-amber-600 hover:bg-amber-700") : "bg-gray-300 cursor-not-allowed"}`}
              onClick={isHutangMode ? () => setShowHutangDialog(true) : handleConfirmPayment}
              disabled={(!isUangPasSelected && !isHutangMode) || hasInvalidItems}
            >
              {isHutangMode ? "📝 Catat Hutang" : "✓ Konfirmasi Pembayaran"}
            </Button>
          </div>
        )}

        {cart.length === 0 && (
          <div className="text-center text-sm text-muted-foreground p-4">
            Tambahkan produk ke keranjang untuk melanjutkan pembayaran.
          </div>
        )}
      </div>

      {/* Success Popup Dialog */}
      <Dialog
        open={showSuccessPopup}
        onOpenChange={(open) => {
          if (!open) {
            setShowSuccessPopup(false);
            navigate("/pos");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center justify-center py-6">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-center mb-2">Transaksi Berhasil!</h3>
            <p className="text-2xl font-bold text-amber-600 mb-2">{formatCurrency(lastTransactionTotal)}</p>
            <p className="text-sm text-gray-500">Pembayaran telah diterima</p>
          </div>
          <DialogFooter>
            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => {
                setShowSuccessPopup(false);
                navigate("/pos");
              }}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Dialog Konfirmasi Hapus Barang */}
      <Dialog open={itemToDelete !== null} onOpenChange={(open) => { if (!open) setItemToDelete(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Hapus Barang?</DialogTitle>
            <DialogDescription className="text-sm">
              {itemToDelete?.name} akan dihapus dari keranjang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setItemToDelete(null)}>
              Batal
            </Button>
            <Button
              className="flex-1 bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                if (itemToDelete) updateQuantity(itemToDelete.id, -1);
                setItemToDelete(null);
              }}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Dialog Struk Pembayaran */}
      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="w-full max-w-[98vw] sm:max-w-md md:max-w-lg lg:max-w-xl p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Struk Pembayaran</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Detail transaksi Anda</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 sm:space-y-6 py-1 sm:py-2">
            <div className="text-center">
              <div className="inline-flex items-center justify-center rounded-full bg-green-100 p-2 mb-3">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                Transaksi berhasil diproses
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Berikut adalah detail struk pembayaran Anda:
              </p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-white/80 to-white/20 dark:from-gray-900/80 dark:to-gray-900/20 pointer-events-none rounded-lg" />
              <ScrollArea className="max-h-48 sm:max-h-64 w-full rounded-lg border bg-gray-50 dark:bg-gray-800 p-2 sm:p-4 mb-2">
                <div className="font-mono text-xs sm:text-sm whitespace-pre-wrap break-words">
                 {receiptContent.split("\n").map((line, index) => {
                   const relativeDateBadge = line.match(/\s*•\s*(Hari ini|HARI INI|Kemarin|2 Hari Lalu|3 Hari Lalu)\s*$/)?.[1];
                   if (line.trimStart().startsWith("Tanggal:") && relativeDateBadge) {
                     return (
                       <div key={index} className="flex flex-wrap items-center gap-1">
                         <span>{line.replace(/\s*•\s*(Hari ini|HARI INI|Kemarin|2 Hari Lalu|3 Hari Lalu)\s*$/, "")}</span>
                         <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${getRelativeDateBadgeClass(relativeDateBadge === "HARI INI" ? "Hari ini" : relativeDateBadge)}`}>
                           {relativeDateBadge === "HARI INI" ? "Hari ini" : relativeDateBadge}
                         </span>
                       </div>
                     );
                   }
                   return line ? <div key={index}>{line}</div> : <br key={index} />;
                 })}
               </div>
              </ScrollArea>
            </div>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:gap-3 pt-2 px-1 sm:px-0 pb-2">
              <Button
                variant="outline"
                onClick={handleDownloadReceipt}
                className="w-full sm:w-auto gap-2"
              >
                <Download className="h-4 w-4" />
                <span>Download Struk</span>
              </Button>
              <Button
                onClick={() => {
                  setShowReceiptDialog(false);
                  navigate("/pos");
                }}
                className="w-full sm:w-auto gap-2 bg-primary hover:bg-primary/90"
              >
                <Check className="h-4 w-4" />
                <span>Selesai</span>
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hutang Dialog - Input Customer Name */}
      <Dialog open={showHutangDialog} onOpenChange={(open) => {
        setShowHutangDialog(open);
        if (!open) {
          setPaymentError("");
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-red-500" />
              Catat Hutang
            </DialogTitle>
            <DialogDescription>
              Masukkan nama pelanggan untuk mencatat hutang.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Pelanggan</label>
              <Input
                placeholder="Masukkan nama pelanggan..."
                value={hutangCustomerName}
                onChange={(e) => setHutangCustomerName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="bg-red-50 p-3 rounded-lg border border-red-200">
              <div className="flex justify-between items-center">
                <span className="text-sm text-red-700 font-medium">Total Hutang:</span>
                <span className="text-xl font-bold text-red-600">{formatCurrency(total)}</span>
              </div>
              <div className="text-xs text-red-500 mt-1">
                {cart.length} item dalam keranjang
              </div>
            </div>
            {paymentError && (
              <div className="text-red-600 text-xs text-center bg-red-50 p-2 rounded">{paymentError}</div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowHutangDialog(false);
                setIsHutangMode(false);
                setHutangCustomerName("");
                setPaymentError("");
              }}
            >
              Batal
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmHutang}
            >
              ✓ Konfirmasi Hutang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CartScreen; 
