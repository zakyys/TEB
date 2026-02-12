import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency } from "@/lib/utils";
import { getProducts, setProducts as setCachedProducts } from "@/lib/productCache";
import { Button } from "@/components/ui/button";
import { Minus, Plus, ShoppingCart, Trash2, CreditCard } from "lucide-react";
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
  const [amountPaid, setAmountPaid] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [isCartLoaded, setIsCartLoaded] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptContent, setReceiptContent] = useState("");
  const [isUangPasSelected, setIsUangPasSelected] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [lastTransactionTotal, setLastTransactionTotal] = useState(0);

  // Discount states
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountNominalInput, setDiscountNominalInput] = useState<string>("");
  const [isEditingNominal, setIsEditingNominal] = useState(false);

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

  // Total sama dengan subtotal (tanpa PPN)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Kalkulasi diskon - use discountAmount directly if editing nominal, otherwise calculate from percent
  const parsedDiscount = parseFloat(discountPercent) || 0;
  const calculatedDiscountFromPercent = Math.round((subtotal * parsedDiscount) / 100);

  // Use discountAmount directly (it's set by both nominal input and percent input)
  const effectiveDiscount = discountAmount;
  const total = subtotal - effectiveDiscount;

  // Track if discount was set via percent input (not nominal)
  const [discountSource, setDiscountSource] = useState<'nominal' | 'percent' | null>(null);

  // Update discountAmount only when percent changes AND source is percent
  React.useEffect(() => {
    if (discountSource === 'percent' || discountSource === null) {
      setDiscountAmount(calculatedDiscountFromPercent);
      if (calculatedDiscountFromPercent > 0) {
        setDiscountNominalInput(String(calculatedDiscountFromPercent));
      } else {
        setDiscountNominalInput("");
      }
    }
  }, [calculatedDiscountFromPercent, discountSource]);

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
      discountPercent: parseFloat(discountPercent) || 0,
      discountAmount,
      customerName: customerNameInput.trim() || undefined,
    });

    // Perbarui produk di UI (CartScreen tidak pegang state products, jadi cukup persist)
    setCachedProducts(updatedProducts);

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
      discountPercent: parseFloat(discountPercent) || 0,
      discountAmount,
      customerName: hutangCustomerName.trim(),
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
                    onClick={() => updateQuantity(item.id, -1)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {/* Row 2: Harga x Qty */}
                <div className="flex items-center gap-2 mt-1 px-1">
                  <span className="text-[10px] text-blue-500 font-medium">Custom Harga</span>
                  <div className="flex items-center border rounded bg-white overflow-hidden shadow-sm">
                    <span className="px-2 text-[10px] text-muted-foreground bg-gray-50 border-r py-1 flex items-center">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editingPrices[item.id] !== undefined ? editingPrices[item.id] : item.price.toLocaleString('id-ID')}
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
                      className="w-20 px-1.5 py-1 text-right text-xs font-medium focus:ring-1 focus:ring-amber-400 focus:outline-none"
                      aria-label="Ubah harga"
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
          </div>
        )}

        {/* Discount Section */}
        {cart.length > 0 && (
          <div className="mt-4 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏷️</span>
                <span className="text-sm font-semibold text-purple-700">Diskon</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Nominal Discount Input */}
                <div className="flex items-center bg-white rounded-lg border border-orange-300 overflow-hidden">
                  <span className="px-2 py-2 bg-orange-100 text-orange-700 font-bold text-[10px]">Rp</span>
                  <input
                    type="number"
                    min="0"
                    value={discountNominalInput}
                    onFocus={(e) => {
                      setIsEditingNominal(true);
                      setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                    }}
                    onBlur={() => setIsEditingNominal(false)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDiscountNominalInput(val);
                      setDiscountSource('nominal'); // Mark source as nominal
                      const nominal = parseFloat(val) || 0;
                      // Set discountAmount directly to avoid rounding issues
                      const clampedNominal = Math.min(nominal, subtotal);
                      setDiscountAmount(clampedNominal);
                      if (subtotal > 0 && nominal >= 0) {
                        const percent = (nominal / subtotal) * 100;
                        // Max 100%
                        if (percent > 100) {
                          setDiscountPercent("100");
                        } else {
                          // Round to 1 decimal place for clean display
                          setDiscountPercent(percent.toFixed(1).replace(/\.0$/, ''));
                        }
                      } else {
                        setDiscountPercent("");
                      }
                    }}
                    placeholder="0"
                    className="w-20 px-2 py-2 text-center text-sm font-semibold focus:outline-none"
                  />
                </div>
                {/* Percentage Discount Input */}
                <div className="flex items-center bg-white rounded-lg border border-purple-300 overflow-hidden">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={discountPercent}
                    onFocus={(e) => {
                      setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDiscountSource('percent'); // Mark source as percent
                      // Max 100%
                      if (parseFloat(val) > 100) {
                        setDiscountPercent("100");
                      } else {
                        setDiscountPercent(val);
                      }
                    }}
                    placeholder="0"
                    className="w-14 px-2 py-2 text-center text-sm font-semibold focus:outline-none"
                  />
                  <span className="px-2 py-2 bg-purple-100 text-purple-700 font-bold text-sm">%</span>
                </div>
              </div>
            </div>

            {/* Quick discount buttons */}
            <div className="flex gap-2 mt-3">
              {[3, 5, 7, 10].map((percent) => (
                <button
                  key={percent}
                  onClick={() => { setDiscountSource('percent'); setDiscountPercent(String(percent)); }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${discountPercent === String(percent)
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'
                    }`}
                >
                  {percent}%
                </button>
              ))}
              {discountPercent && (
                <button
                  onClick={() => { setDiscountPercent(""); setDiscountAmount(0); setDiscountNominalInput(""); setDiscountSource(null); }}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all"
                >
                  ✕
                </button>
              )}
            </div>
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
                {discountAmount > 0 && (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-400 line-through">{formatCurrency(subtotal)}</span>
                    <span className="text-red-500 font-semibold">-{discountPercent}%</span>
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
                <pre className="text-xs sm:text-sm whitespace-pre-wrap break-words">{receiptContent}</pre>
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
