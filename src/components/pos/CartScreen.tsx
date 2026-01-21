import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle, Download, Check } from "lucide-react";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { usePosStore } from "@/store/usePosStore";
import type { Product, CartItem } from '@/types/pos'
import { completeTransactionUtil, generateTextReceipt } from "@/lib/transactions";
import { useToast } from "@/components/ui/use-toast";

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

  // FIX QTY INPUT: State untuk menyimpan nilai string sementara saat user mengetik
  const [editingQuantities, setEditingQuantities] = useState<Record<string, string>>({});
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
  const total = subtotal;
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
    const products = getFromLS<Product[]>(LS_KEYS.PRODUCTS, []);
    const { transaction, updatedProducts } = await completeTransactionUtil({
      cart,
      products,
      paymentMethod,
      amountPaid: parseFloat(amountPaid) || 0,
      subtotal,
      tax: 0,
      total,
    });

    // Perbarui produk di UI (CartScreen tidak pegang state products, jadi cukup persist)
    saveToLS(LS_KEYS.PRODUCTS, updatedProducts);

    // Simpan total untuk popup
    setLastTransactionTotal(total);

    // Kosongkan cart
    clearCart();
    setPaymentMethod("cash");
    setAmountPaid("");
    setShowPaymentForm(false);
    setPaymentError("");
    setIsUangPasSelected(false);

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
    if (!amountPaid || parseFloat(amountPaid) < total) {
      setPaymentError("Jumlah pembayaran kurang!");
      return;
    }
    setPaymentError("");
    await completeTransaction();
  };

  // Filter cart jika barcodeFilter aktif
  const filteredCart = barcodeFilter
    ? cart.filter(item => (item.sku || "").toLowerCase() === barcodeFilter.toLowerCase())
    : cart;
  const totalPages = Math.ceil(filteredCart.length / itemsPerPage);
  const paginatedCart = filteredCart.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
              <div key={item.id} className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-800 break-words leading-tight">{item.name}</p>
                      {item.sku && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300">
                          {item.sku}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-500">Harga:</span>
                      <input
                        type="number"
                        min="0"
                        value={item.price}
                        onChange={e => {
                          const newPrice = parseInt(e.target.value) || 0;
                          setItemPrice(item.id, newPrice);
                        }}
                        className="w-24 px-2 py-1 border rounded-lg text-right text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none transition"
                      />
                      <span className="text-xs text-gray-500">x</span>
                      <input
                        type="number"
                        // FIX QTY INPUT: Menggunakan state sementara untuk 'value'
                        value={editingQuantities[item.id] ?? item.quantity}
                        // FIX QTY INPUT: onChange hanya mengubah state string sementara
                        onChange={(e) => {
                          setEditingQuantities({ ...editingQuantities, [item.id]: e.target.value });
                        }}
                        // FIX QTY INPUT: Logika utama dijalankan saat user selesai edit
                        onBlur={() => handleQuantityBlur(item)}
                        placeholder="Qty"
                        className="w-14 px-2 py-1 border rounded-lg text-center text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none transition"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="font-bold text-amber-600 text-lg">
                    {formatCurrency(item.price * item.quantity)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full border-amber-400 text-amber-600 hover:bg-amber-50"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full border-amber-400 text-amber-600 hover:bg-amber-50"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50"
                      onClick={() => updateQuantity(item.id, 0)}
                    >
                      <Trash2 className="h-4 w-4" />
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
      </div>


      {/* Ringkasan & Pembayaran - Compact inline design */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-30 pb-20">
        {isCartLoaded && cart.length > 0 && (
          <div className="p-3 space-y-2">
            {/* Baris 1: Uang Pas + Total */}
            <div className="flex items-center justify-between gap-2">
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
                    setAmountPaid(String(Math.ceil(total)));
                  }
                  setPaymentError("");
                }}
              >
                {isUangPasSelected ? "✓ Uang Pas" : "💵 Uang Pas"}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Total:</span>
                <span className="text-xl font-bold text-amber-600">{formatCurrency(total)}</span>
              </div>
            </div>

            {paymentError && (
              <div className="text-red-600 text-xs text-center">{paymentError}</div>
            )}

            {/* Tombol Konfirmasi - hanya aktif jika Uang Pas dipilih */}
            <Button
              className={`w-full h-11 text-base font-semibold ${isUangPasSelected ? "bg-amber-600 hover:bg-amber-700" : "bg-gray-300 cursor-not-allowed"}`}
              onClick={handleConfirmPayment}
              disabled={!isUangPasSelected}
            >
              ✓ Konfirmasi Pembayaran
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
    </div>
  );
};

export default CartScreen; 
