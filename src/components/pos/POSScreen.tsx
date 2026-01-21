import React, { useState, useEffect, useRef, useCallback } from "react";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, getStoreName, normalizeSearch, collapseLeadingZeros, matchesLoose, getSearchRelevance } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Plus,
  Minus,
  ShoppingCart,
  Printer,
  CreditCard,
  Banknote,
  X,
  Check,
  Download,
  CheckCircle,
  ScanBarcode,
} from "lucide-react";
import { EscPos } from '@tillpos/xml-escpos-helper';
import html2canvas from 'html2canvas';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { DUMMY_PRODUCTS } from "@/lib/dummyData";
import { usePosStore } from "@/store/usePosStore";
import { useToast } from "@/components/ui/use-toast";
import { completeTransactionUtil, generateTextReceipt, generateReceiptHtml } from "@/lib/transactions";
import type { Product, CartItem, ProfileData } from '@/types/pos'
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

// Types moved to '@/types/pos'

const ScannerPreview = ({
  onDetected,
  onClose
}: {
  onDetected: (code: string) => void,
  onClose: () => void
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    let active = true;

    const initScanner = async () => {
      if (videoRef.current) {
        try {
          const hints = new Map();
          // TRY_HARDER helps with accuracy. Since we only check ONE format now, it will still be fast.
          hints.set(DecodeHintType.TRY_HARDER, true);
          // Optimize: Only search for Code 39 as requested by user
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.CODE_39
          ]);

          // timeBetweenScansMillis = 200ms
          const codeReader = new BrowserMultiFormatReader(hints, 200);
          codeReaderRef.current = codeReader;

          const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
          const selectedDeviceId = videoInputDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('belakang'))?.deviceId;

          console.log("Scanner starting. Devices:", videoInputDevices);
          console.log("Selected device:", selectedDeviceId);

          const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result, error) => {
            if (!active) return;
            if (result) {
              console.log("Barcode detected:", result.getText());
              onDetected(result.getText());
              if (controlsRef.current) controlsRef.current.stop();
              onClose();
            }
          });
          controlsRef.current = controls;
        } catch (err) {
          if (active) {
            console.error("Scanner error:", err);
            onClose();
            alert("Gagal membuka kamera. Pastikan izin kamera diberikan dan halaman diakses via HTTPS atau localhost.");
          }
        }
      }
    };

    initScanner();

    return () => {
      active = false;
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
      codeReaderRef.current = null;
    };
  }, [onDetected, onClose]);

  return (
    <div className="w-full max-w-lg mb-4 relative bg-black rounded-2xl overflow-hidden border-2 border-amber-500 shadow-xl ring-4 ring-amber-500/10 transition-all animate-in fade-in zoom-in duration-300" style={{ aspectRatio: '16/4.5' }}>
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
      />
      {/* Scanning Overlay - Scanner Box with Corners */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {/* Scanner Box */}
        <div className="relative w-[70%] h-[60%]">
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-amber-400" style={{ borderWidth: '3px 0 0 3px' }} />
          <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-amber-400" style={{ borderWidth: '3px 3px 0 0' }} />
          <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-amber-400" style={{ borderWidth: '0 0 3px 3px' }} />
          <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-amber-400" style={{ borderWidth: '0 3px 3px 0' }} />

          {/* Animated scanning line */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse shadow-[0_0_10px_red]" />
        </div>

        {/* Dark overlay around scanner box */}
        <div className="absolute inset-0 bg-black/40" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 15% 20%, 15% 80%, 85% 80%, 85% 20%, 15% 20%)' }} />
      </div>

      {/* Top Banner */}
      <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center">
        <span className="text-white text-[10px] font-bold flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          SCANNING BARCODE...
        </span>
        <Button
          size="icon"
          variant="destructive"
          className="h-8 w-8 rounded-full shadow-lg"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none px-4">
        <span className="bg-black/60 text-white text-[9px] sm:text-[11px] px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10 uppercase tracking-widest font-medium">
          Arahkan Barcode ke dalam kotak
        </span>
      </div>
    </div>
  );
};



const POSScreen = () => {
  const { toast } = useToast();
  // Load products from localStorage
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    // Load products from localStorage or use default data if empty
    const storedProducts = getFromLS<Product[]>(LS_KEYS.PRODUCTS, DUMMY_PRODUCTS);
    if (storedProducts.length === 0) {
      saveToLS(LS_KEYS.PRODUCTS, DUMMY_PRODUCTS);
      setProducts(DUMMY_PRODUCTS);
    } else {
      setProducts(storedProducts);
    }

    // Listen for external products updates (e.g., after transaction or product edits)
    const onProductsUpdate = (e: any) => {
      try {
        const updated = e?.detail as Product[] | undefined;
        if (updated && Array.isArray(updated)) {
          setProducts(updated);
        } else {
          const stored = getFromLS<Product[]>(LS_KEYS.PRODUCTS, DUMMY_PRODUCTS);
          setProducts(stored);
        }
      } catch {
        const stored = getFromLS<Product[]>(LS_KEYS.PRODUCTS, DUMMY_PRODUCTS);
        setProducts(stored);
      }
    };
    window.addEventListener('pos:products:update', onProductsUpdate);

    // Cart, selected customer, and PPN are managed by Zustand store (persisted)

    return () => {
      window.removeEventListener('pos:products:update', onProductsUpdate);
    };
  }, []);

  // State
  const cart = usePosStore((s) => s.cart);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [isScanning, setIsScanning] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptContent, setReceiptContent] = useState<string>('');
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Add a ref to store the last transaction data
  const lastTransactionRef = useRef<any>(null);

  // PPN feature removed

  // Cart actions from store
  const addToCartStore = usePosStore((s) => s.addToCart);
  const updateQuantityStore = usePosStore((s) => s.updateQuantity);
  const setItemPrice = usePosStore((s) => s.setItemPrice);
  const clearCart = usePosStore((s) => s.clearCart);

  // Floating cart bottom sheet state (for mobile)
  const [showMobileCart, setShowMobileCart] = useState(false);

  // Helper: is mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const navigate = useNavigate();


  // Relevance score to prioritize SKU matches (exact > startsWith > includes)
  const relevanceScore = (item: Product, query: string) => {
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

  const filteredItems = products
    .filter((item) => {
      const matchesSearch =
        matchesLoose(item.name, searchTerm) ||
        matchesLoose(item.category, searchTerm) ||
        matchesLoose(item.sku, searchTerm);
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "products" && item.type === "product") ||
        (activeTab === "services" && item.type === "service");
      return matchesSearch && matchesTab;
    })
    .sort((a, b) => (searchTerm ? relevanceScore(b, searchTerm) - relevanceScore(a, searchTerm) : 0));

  // Tambahkan state untuk pagination produk
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset ke halaman 1 jika filter berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab]);

  // Calculate totals
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  // Total sama dengan subtotal (tanpa PPN)
  const tax = 0;
  const total = subtotal;
  const change = amountPaid ? parseFloat(amountPaid) - total : 0;

  // Add item to cart (allow negative stock)
  const addToCart = (product: Product) => {
    // No stock validation - allow negative stock
    addToCartStore(product);
  };

  // Update item quantity in cart
  const updateQuantity = (product: Product, newQuantity: number) => {
    const inCart = cart.find(ci => ci.id === product.id);
    if (!inCart && newQuantity > 0) {
      // If item not in cart, add it first then update to desired quantity
      addToCartStore(product);
      updateQuantityStore(product.id, newQuantity);
    } else {
      updateQuantityStore(product.id, newQuantity);
    }
  };

  // Cart and PPN are persisted by Zustand store

  // Handle payment process
  const processPayment = async () => {
    if (paymentMethod === "cash" && parseFloat(amountPaid) < total) {
      // Optionally show an error message here for insufficient payment
      alert("Jumlah pembayaran kurang!");
      return; // Insufficient payment
    }
    setShowPaymentDialog(false);
    // Call completeTransaction after successful payment processing
    await completeTransaction();
    // showReceiptDialog is set to true inside completeTransaction now
    // setShowReceiptDialog(true); // Removed, as it's handled in completeTransaction
  };

  // Handle transaction completion
  const completeTransaction = async () => {
    if (cart.length === 0) return;
    const { transaction, updatedProducts } = await completeTransactionUtil({
      cart,
      products,
      paymentMethod,
      amountPaid: parseFloat(amountPaid) || 0,
      subtotal,
      tax,
      total,
    })

    setProducts(updatedProducts)

    const generatedReceiptText = generateTextReceipt(transaction)
    setReceiptContent(generatedReceiptText)
    lastTransactionRef.current = transaction

    clearCart()
    setPaymentMethod("cash")
    setAmountPaid("")
    setShowReceiptDialog(true)

    // Show toast indicator that stock has been updated
    const affected = cart.filter((i) => i.type === 'product').length
    toast({
      title: "Stok diperbarui",
      description: affected > 0
        ? `${affected} produk stoknya telah dikurangi`
        : `Transaksi selesai.`,
    })
  };

  // Text receipt now from shared util (generateTextReceipt)

  // Function to handle receipt download (image file)
  const handleDownloadReceipt = async (format: 'png' | 'jpeg' = 'png') => {
    // Use the ref to get the last transaction data
    const transactionData = lastTransactionRef.current;

    if (!transactionData) {
      alert("Tidak ada data transaksi terbaru untuk diunduh.");
      return;
    }

    // Create a temporary div to render the HTML receipt for capture
    const receiptContainer = document.createElement('div');
    receiptContainer.style.position = 'absolute'; // Position off-screen
    receiptContainer.style.left = '-9999px';
    receiptContainer.style.top = '-9999px';
    receiptContainer.innerHTML = generateReceiptHtml(transactionData); // Generate HTML content

    document.body.appendChild(receiptContainer);

    try {
      // Use html2canvas to capture the content
      const canvas = await html2canvas(receiptContainer, {
        scale: 2, // Increase scale for better resolution
        logging: false, // Disable html2canvas logging
        useCORS: true, // Enable CORS if loading external images (e.g., avatar)
      });

      // Create an image data URL
      const imageDataUrl = format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9); // 0.9 quality for JPEG

      // Create a download link
      const link = document.createElement('a');
      link.href = imageDataUrl;
      const filename = `struk_${transactionData.id}.${format}`; // Use transaction ID for filename
      link.download = filename;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error("Failed to download receipt image:", error);
      alert(`Gagal mengunduh struk sebagai ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Clean up the temporary container
      document.body.removeChild(receiptContainer);
    }

    // Dialog remains open after download
    // setShowReceiptDialog(false);
  };

  // Function to generate HTML receipt content for image capture


  const handleBarcodeDetected = useCallback((code: string) => {
    setSearchTerm(code);
    setActiveTab('all');
    setCurrentPage(1);
  }, []);


  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-background">
      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Products/Services Section */}
        <div className="flex-1 px-4 pt-4 flex flex-col overflow-hidden">
          {/* Camera Scan Preview - Above Search Bar */}
          {isScanning && (
            <ScannerPreview
              onDetected={(code) => {
                handleBarcodeDetected(code);
                setIsScanning(false);
              }}
              onClose={() => setIsScanning(false)}
            />
          )}

          <div className="flex items-center gap-2 mb-4">
            {/* Search Bar - Elongated */}
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
              <input
                type="text"
                placeholder="MASUKKAN KODE"
                className="w-full pl-12 pr-12 py-3 bg-gray-100 dark:bg-gray-800 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white dark:focus:bg-gray-700 transition-all font-medium h-11"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 bg-gray-400 hover:bg-gray-500 rounded-full transition-colors"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>

            <Button
              onClick={() => {
                // Check if Secure Context (Requirement for Camera)
                if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                  alert("ERROR: Browser memblokir kamera karena koneksi tidak aman (Bukan HTTPS). \n\nGunakan 'localhost' atau aktifkan HTTPS agar kamera bisa berfungsi.");
                  return;
                }
                setSearchTerm("");
                setIsScanning(!isScanning);
              }}
              variant="outline"
              className={`h-11 px-4 text-[11px] font-extrabold rounded-full flex items-center gap-1.5 shadow-sm transition-all active:scale-95 ${isScanning
                ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                : "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300"
                }`}
            >
              {isScanning ? <X className="h-5 w-5" /> : <ScanBarcode className="h-5 w-5" />}
              <span>{isScanning ? "TUTUP" : "SCAN"}</span>
            </Button>
          </div>



          <ScrollArea className="flex-1 pr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {paginatedItems.map((item) => {
                const inCart = cart.find(ci => ci.id === item.id);
                const qty = inCart?.quantity || 0;
                const maxed = item.type === 'product' && item.stock !== undefined && qty >= (item.stock || 0);
                return (
                  <Card
                    key={item.id}
                    className="hover:border-primary transition-colors"
                  >
                    <CardContent className="p-3">
                      <div className="flex gap-2">
                        {/* Left side - product info */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm leading-tight break-words">{item.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="font-semibold text-amber-600">{formatCurrency(item.price)}</span>
                            {item.type === "product" && item.stock !== undefined && (
                              <span className="text-xs text-muted-foreground">Stok: {item.stock}</span>
                            )}
                          </div>
                        </div>
                        {/* Right side - Kode + Category + controls */}
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {/* Kode & Category badges at top right */}
                          <div className="flex items-center gap-1">
                            {item.category && (
                              <div className="text-[10px] text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded bg-blue-50">
                                {item.category}
                              </div>
                            )}
                            {item.sku && (
                              <div className="text-xs text-slate-600 border border-slate-300 px-2 py-0.5 rounded bg-white">
                                {item.sku}
                              </div>
                            )}
                          </div>
                          {/* Quantity controls below */}
                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 border-slate-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (qty > 0) updateQuantity(item, qty - 1);
                              }}
                              disabled={qty === 0}
                              aria-label="Kurangi 1"
                            >
                              <Minus className="h-4 w-4 text-slate-600" />
                            </Button>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qty === 0 ? "" : qty.toLocaleString('id-ID')}
                              placeholder="0"
                              onClick={(e) => {
                                e.stopPropagation();
                                (e.target as HTMLInputElement).select();
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                const val = e.target.value.replace(/\D/g, "");
                                const newQty = parseInt(val) || 0;
                                updateQuantity(item, newQty);
                              }}
                              className="w-12 h-9 text-center text-sm font-bold border-2 border-slate-200 rounded-md focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none transition-all"
                              aria-label="Ubah kuantitas"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 border-slate-300 bg-slate-50 hover:bg-amber-50 hover:border-amber-400 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                addToCart(item);
                              }}
                              aria-label="Tambah 1"
                            >
                              <Plus className="h-4 w-4 text-slate-600" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Custom price input - centered below */}
                      {qty > 0 && (
                        <div
                          className="flex items-center gap-2 mt-2 pt-2 border-t pl-4"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs text-blue-500 font-medium">Custom Harga</span>
                          <div className="flex items-center border rounded bg-white overflow-hidden">
                            <span className="px-2 text-sm text-muted-foreground bg-gray-50 border-r h-8 flex items-center">Rp</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="0"
                              value={(inCart?.price ?? item.price).toLocaleString('id-ID')}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                // Remove dots/commas and parse as number
                                const cleanValue = e.target.value.replace(/\./g, '').replace(/,/g, '');
                                const newPrice = parseInt(cleanValue) || 0;
                                setItemPrice(item.id, newPrice);
                              }}
                              className="w-24 px-2 py-1 h-8 text-right text-sm focus:ring-1 focus:ring-amber-400 focus:outline-none"
                              aria-label="Ubah harga item di keranjang"
                              title="Ubah harga item di keranjang"
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
          {/* Spacer for fixed bottom bar */}
          <div className="h-16 shrink-0"></div>
        </div>

        {/* Fixed Bottom Bar: Pagination Left, Cart Right - Always visible above navbar */}
        <div className="fixed bottom-16 left-0 right-0 flex items-center justify-between py-2 px-4 border-t bg-background gap-4 z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]">
          {/* Pagination Controls - Left */}
          {totalPages > 1 ? (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>&lt;</Button>
              <div className="flex flex-col items-center leading-tight">
                <span className="text-[10px] text-muted-foreground">Halaman</span>
                <span className="text-xs font-medium">{currentPage} / {totalPages}</span>
              </div>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>&gt;</Button>
            </div>
          ) : (
            <div></div>
          )}

          {/* Cart Button - Right */}
          {cart.length > 0 && (
            <button
              className="flex items-center gap-4 px-6 py-3.5 rounded-2xl shadow-lg bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-base focus:outline-none focus:ring-2 focus:ring-amber-400 hover:from-amber-600 hover:to-amber-700 transition-all active:scale-95"
              onClick={() => navigate('/pos/cart')}
            >
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                <span className="font-bold">{cart.length}</span>
              </div>
              <div className="w-px h-5 bg-white/40"></div>
              <span className="font-extrabold tracking-tight">{formatCurrency(total)}</span>
            </button>
          )}
        </div>

        {/* Cart Section - Hidden to match mobile view (use FAB + cart page instead) */}
        {/* Sidebar keranjang disembunyikan, gunakan FAB + halaman cart */}
      </div>

      {/* Mobile Cart Bottom Sheet */}
      <Dialog open={showMobileCart} onOpenChange={setShowMobileCart}>
        <DialogContent className="fixed bottom-0 left-0 right-0 w-full max-w-full sm:max-w-full m-0 rounded-t-2xl p-0 z-[100]" style={{ maxHeight: '90vh', minHeight: '40vh' }}>
          <DialogHeader>
            <DialogTitle>Keranjang</DialogTitle>
            <DialogDescription>
              Lihat dan edit isi keranjang Anda sebelum checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col h-full max-h-[90vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-bold text-lg flex items-center"><ShoppingCart className="mr-2 h-5 w-5" />Keranjang</span>
              <Button variant="ghost" size="icon" onClick={() => setShowMobileCart(false)}><X className="h-5 w-5" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto px-1">
              {cart.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">Keranjang kosong</div>
              ) : (
                <div className="p-4 space-y-3">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b last:border-b-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">Harga:</span>
                          <input
                            type="number"
                            min="0"
                            value={item.price}
                            onChange={e => {
                              const newPrice = parseInt(e.target.value) || 0;
                              setItemPrice(item.id, newPrice);
                            }}
                            className="w-20 px-1 py-0.5 border rounded text-right text-sm"
                          />
                          <span className="text-xs text-muted-foreground">x {item.quantity}</span>
                        </div>
                      </div>
                      <div className="flex flex-row items-center gap-2 mt-1 sm:mt-0">
                        <div className="font-semibold text-amber-600 min-w-[80px] text-right">
                          {formatCurrency(item.price * item.quantity)}
                        </div>
                        <div className="flex items-center">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => updateQuantity(item, item.quantity - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="mx-2 text-sm">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => updateQuantity(item, item.quantity + 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-white dark:bg-muted">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>

                <Separator className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-amber-600">{formatCurrency(total)}</span>
                </div>
              </div>
              <Button
                className="w-full mt-4 bg-amber-600 hover:bg-amber-700"
                size="lg"
                disabled={cart.length === 0}
                onClick={() => {
                  setShowMobileCart(false);
                  setShowPaymentDialog(true);
                }}
              >
                Proses Pembayaran
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Proses Pembayaran</DialogTitle>
            <DialogDescription>
              Masukkan jumlah pembayaran dan pilih metode pembayaran.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">
                  {formatCurrency(total)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Total Pembayaran
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Metode Pembayaran</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih metode pembayaran" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">
                    <div className="flex items-center">
                      <Banknote className="mr-2 h-4 w-4" />
                      Tunai
                    </div>
                  </SelectItem>
                  <SelectItem value="card">
                    <div className="flex items-center">
                      <CreditCard className="mr-2 h-4 w-4" />
                      Kartu Debit/Kredit
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentMethod === "cash" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Jumlah Dibayar</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                />
                {/* Tombol pembulatan dan uang pas */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setAmountPaid(String(Math.ceil(total)))}>
                    Uang Pas
                  </Button>
                  {[10000, 20000, 50000, 100000].map((nom) => (
                    <Button key={nom} type="button" variant="outline" size="sm" onClick={() => setAmountPaid(String(nom))}>
                      {formatCurrency(nom)}
                    </Button>
                  ))}
                  {/* Pembulatan ke atas ke 1000 terdekat */}
                  <Button type="button" variant="outline" size="sm" onClick={() => setAmountPaid(String(Math.ceil(total / 1000) * 1000))}>
                    Bulatkan ke {formatCurrency(Math.ceil(total / 1000) * 1000)}
                  </Button>
                </div>
                {parseFloat(amountPaid) >= total && (
                  <div className="flex justify-between text-sm">
                    <span>Kembalian:</span>
                    <span className="font-medium">
                      {formatCurrency(change)}
                    </span>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowPaymentDialog(false)}
              >
                Batal
              </Button>
              <Button
                onClick={processPayment}
                disabled={
                  paymentMethod === "cash" &&
                  (parseFloat(amountPaid) < total || !amountPaid)
                }
                className="bg-amber-600 hover:bg-amber-700"
              >
                Selesaikan Pembayaran
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog - Modernized */}
      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="w-full max-w-[98vw] sm:max-w-md md:max-w-lg lg:max-w-xl p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Struk Pembayaran</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Detail transaksi Anda</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 sm:space-y-6 py-1 sm:py-2">
            {/* Print Area - Hidden - Now used for HTML capture */}
            <div ref={printAreaRef} id="print-area" className="hidden">
              {/* HTML content for image capture will be rendered here temporarily */}
            </div>

            {/* Transaction Info */}
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

            {/* Display Receipt Content (Text) */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-white/80 to-white/20 dark:from-gray-900/80 dark:to-gray-900/20 pointer-events-none rounded-lg" />
              {/* Pada ScrollArea struk pembayaran */}
              <ScrollArea className="max-h-48 sm:max-h-64 w-full rounded-lg border bg-gray-50 dark:bg-gray-800 p-2 sm:p-4 mb-2">
                <pre className="text-xs sm:text-sm whitespace-pre-wrap break-words">{receiptContent}</pre>
              </ScrollArea>
            </div>

            {/* Action Buttons */}
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:gap-3 pt-2 px-1 sm:px-0 pb-2">
              <Button
                variant="outline"
                onClick={() => handleDownloadReceipt('png')}
                className="w-full sm:w-auto gap-2"
              >
                <Download className="h-4 w-4" />
                <span>Download Struk</span>
              </Button>
              {/* <Button
                variant="outline"
                onClick={() => handleDownloadReceipt('jpeg')}
                className="w-full sm:w-auto gap-2"
              >
                <Download className="h-4 w-4" />
                <span>Download Struk (JPG)</span>
              </Button> */}
              <Button
                onClick={() => setShowReceiptDialog(false)}
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

export default POSScreen;
