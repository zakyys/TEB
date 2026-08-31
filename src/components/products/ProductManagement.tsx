import React, { useState, useEffect } from "react";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, getConfig } from "@/lib/utils";
import { getProducts as getCachedProducts, queueProductSync, setProducts as setCachedProducts } from "@/lib/productCache";
import {
  Search,
  Plus,
  Filter,
  Edit,
  Trash2,
  ChevronDown,
  Package,
  ArrowUpDown,
  Download,
  AlertTriangle,
  TrendingUp,
  X,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { BrowserMultiFormatReader } from '@zxing/browser';
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface Product {
  id: string;
  name: string;
  category: string;
  price: number; // harga jual
  purchasePrice: number; // harga beli
  stock: number;
  sku: string;
  image?: string;
  type?: string;
  threshold?: number;
}

const BarcodeScanner = ({ onDetected }: { onDetected: (code: string) => void }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const codeReaderRef = React.useRef<BrowserMultiFormatReader | null>(null);
  const [scanning, setScanning] = React.useState(false);

  React.useEffect(() => {
    if (!scanning) return;
    const codeReader = new BrowserMultiFormatReader();
    codeReaderRef.current = codeReader;
    codeReader.decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
      if (result) {
        onDetected(result.getText());
        setScanning(false);
        // @ts-ignore
        if (typeof codeReader.reset === "function") {
          // @ts-ignore
          codeReader.reset();
        }
        // @ts-ignore
        if (typeof codeReader.stopContinuousDecode === "function") {
          // @ts-ignore
          codeReader.stopContinuousDecode();
        }
      }
    });
    return () => {
      // @ts-ignore
      if (typeof codeReader.reset === "function") {
        // @ts-ignore
        codeReader.reset();
      }
      // @ts-ignore
      if (typeof codeReader.stopContinuousDecode === "function") {
        // @ts-ignore
        codeReader.stopContinuousDecode();
      }
    };
  }, [scanning, onDetected]);

  return (
    <div className="my-2">
      {scanning ? (
        <>
          <video ref={videoRef} style={{ width: '100%', maxHeight: 200 }} />
          <button className="mt-2 text-sm text-red-500" onClick={() => setScanning(false)}>Stop Scan</button>
        </>
      ) : (
        <button className="mt-2 text-sm text-amber-600" onClick={() => setScanning(true)}>Scan Barcode</button>
      )}
    </div>
  );
};

import ProfitAnalysis from "./ProfitAnalysis";

const CATEGORY_LABELS: Record<string, string> = {
  BA: 'BAUT OTOMOTIF',
  BG: 'BAUT GENERAL',
  BK: 'BAUT KAYU',
  KG: 'KILOGRAM',
  TL: 'TOOLS',
  BT: 'BAUT TRUCK',
  'NO KATEGORI': 'NO KATEGORI',
};

const getCategoryFromSku = (sku: string): string => {
  const prefix = String(sku || '').trim().substring(0, 2).toUpperCase();
  return CATEGORY_LABELS[prefix] || 'NO KATEGORI';
};

const ProductManagement = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState("name");

  // State for products
  const [products, setProducts] = useState<Product[]>([]);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    name: "",
    category: "",
    price: 0,
    purchasePrice: 0,
    stock: 0,
    sku: "",
    type: "product",
  });

  // Tambahkan state untuk dialog bulk import
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isProfitReportOpen, setIsProfitReportOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteAllStep2, setShowDeleteAllStep2] = useState(false);
  const [showNoPriceOnly, setShowNoPriceOnly] = useState(false);
  const [selectedMarginRange, setSelectedMarginRange] = useState<string>("all");
  const [selectedPrefix, setSelectedPrefix] = useState<string>("all");
  const [showProfitAnalysis, setShowProfitAnalysis] = useState(false);
  const syncRequestRef = React.useRef(0);

  // Sync products from Google Sheets - MIRROR MODE (App follows Sheet exactly)
  const syncFromSheets = async (isAuto = false) => {
    const requestId = ++syncRequestRef.current;
    if (!isAuto) {
      if (!confirm("Apakah Anda yakin ingin sinkronisasi data? \n\nData produk di HP akan diperbarui mengikuti data terbaru dari Google Sheet.")) return;
      setIsSyncing(true);
      setSyncMessage("Mengambil data dari Sheet...");
    }
    try {
      const config = getConfig();
      // Product sync must use the dedicated product deployment. Falling back to
      // the report deployment can return a valid-looking but incompatible API.
      const targetUrl = config.productGasUrl;

      if (!targetUrl) {
        if (!isAuto) throw new Error("URL GAS Database Produk belum dikonfigurasi di Setting");
        console.warn('[ProductSync] Skipped: product GAS URL is not configured');
        return;
      }

      const response = await fetch(`${targetUrl}?action=getProducts&_=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Server mengembalikan status ${response.status}`);
      }
      const text = await response.text();

      // Parse response
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Format response tidak valid");
      }

      if (data.success !== true || !Array.isArray(data.products)) {
        throw new Error(data.error || "Response Database Produk tidak valid");
      }

      if (data.products.length === 0) {
        const localCount = getCachedProducts().length;
        if (localCount > 0) {
          throw new Error(`Database Produk mengembalikan 0 produk. Data lokal (${localCount} produk) tidak diubah.`);
        }
        if (!isAuto) {
          alert("Database Produk masih kosong. Data lokal tidak diubah.");
          setSyncMessage("⚠ Database Produk kosong; tidak ada perubahan diterapkan");
        }
        return;
      }

      const parseSheetNumber = (value: unknown, field: string, sku: string): number => {
        if (value === null || value === undefined || String(value).trim() === '') return 0;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Nilai ${field} untuk SKU ${sku} tidak valid`);
        }
        // Stok boleh negatif; jangan gunakan Math.max atau validasi >= 0.
        return parsed;
      };

      // Validasi penuh sebelum cache lokal disentuh.
      const seenSkus = new Set<string>();
      const invalidRows: string[] = [];
      const normalizedSheetProducts = data.products.map((sheetProd: any, index: number) => {
        const rowNumber = index + 4; // data dimulai dari baris 4 di sheet produk
        const sku = String(sheetProd.kode ?? '').trim().toUpperCase();
        const name = String(sheetProd.nama ?? '').trim();
        if (!sku) invalidRows.push(`Baris ${rowNumber}: KODE/SKU kosong`);
        if (!name) invalidRows.push(`Baris ${rowNumber}: Nama produk kosong`);
        if (sku && seenSkus.has(sku)) invalidRows.push(`Baris ${rowNumber}: SKU ${sku} duplikat`);
        if (sku) seenSkus.add(sku);

        return {
          sku,
          name,
          category: getCategoryFromSku(sku),
          price: parseSheetNumber(sheetProd.hargaJual, 'Harga Jual', sku || '(kosong)'),
          purchasePrice: parseSheetNumber(sheetProd.hargaBeli, 'Harga Beli', sku || '(kosong)'),
          stock: parseSheetNumber(sheetProd.stok, 'Stok', sku || '(kosong)'),
        };
      });
      if (invalidRows.length > 0) {
        throw new Error(`Data Database Produk tidak valid:\n\n${invalidRows.slice(0, 20).join('\n')}${invalidRows.length > 20 ? `\n... dan ${invalidRows.length - 20} masalah lainnya` : ''}`);
      }

      // Build lookup map of current local products (by SKU) to preserve stock during auto-sync.
      const localProducts = getCachedProducts();
      const localBySku = new Map<string, { stock: number; id: string }>();
      localProducts.forEach((p: any) => {
        const sku = String(p.sku ?? '').trim().toUpperCase();
        if (sku) localBySku.set(sku, { stock: p.stock ?? 0, id: p.id });
      });

      // MERGE: Take name/price from Sheet.
      // Auto-sync keeps local stock; manual sync intentionally takes Sheet stock.
      const sheetProducts: Product[] = normalizedSheetProducts.map((sheetProd) => {
        const localData = localBySku.get(sheetProd.sku);
        return {
          id: localData?.id || `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sku: sheetProd.sku,
          name: sheetProd.name,
          category: sheetProd.category,
          price: sheetProd.price,
          purchasePrice: sheetProd.purchasePrice,
          // Stok negatif tetap dipertahankan.
          stock: isAuto ? (localData !== undefined ? localData.stock : sheetProd.stock) : sheetProd.stock,
          type: "product",
          threshold: 5
        };
      });

      if (requestId !== syncRequestRef.current) return;
      setCachedProducts(sheetProducts);
      setProducts(sheetProducts);
      try { window.dispatchEvent(new CustomEvent('pos:products:update', { detail: sheetProducts })); } catch { }

      if (!isAuto) {
          alert(`✅ Sinkronisasi Berhasil!\n\n${sheetProducts.length} produk di HP diperbarui dari Google Sheet (termasuk stok).`);
          setSyncMessage(`✓ Berhasil sync ${sheetProducts.length} produk`);
      }
      setTimeout(() => setSyncMessage(""), 5000);
    } catch (error) {
      if (!isAuto) {
        setSyncMessage(`✗ Gagal: ${(error as Error).message}`);
        setTimeout(() => setSyncMessage(""), 5000);
      }
    } finally {
      if (!isAuto) setIsSyncing(false);
    }
  };

  // Delete product from Google Sheets
  const deleteProductFromSheet = async (sku: string) => {
    try {
      const config = getConfig();
      const targetUrl = config.productGasUrl;
      if (!targetUrl || !sku) return;

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "deleteProductActive",
          kode: sku
        })
      });
      if (!response.ok) {
        throw new Error(`Server mengembalikan status ${response.status}`);
      }
      console.log(`[Sync] Deleted ${sku} from Sheet`);
    } catch (error) {
      console.error("Failed to delete product from sheet:", error);
    }
  };

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Load products from localStorage and listen to external updates
  useEffect(() => {
    const storedProducts = getCachedProducts() as Product[];
    // Cache [] adalah state yang valid (misalnya setelah Hapus Semua), jadi
    // jangan mengisinya kembali dengan produk contoh.
    setProducts(storedProducts);

    // AUTO-SYNC dari Sheet saat buka halaman
    syncFromSheets(true);

    const onProductsUpdate = (e: any) => {
      try {
        const updated = e?.detail as Product[] | undefined;
        if (updated && Array.isArray(updated)) {
          setProducts(updated);
        } else {
          setProducts(getCachedProducts() as Product[]);
        }
      } catch {
        setProducts(getCachedProducts() as Product[]);
      }
    };
    window.addEventListener('pos:products:update', onProductsUpdate);
    return () => window.removeEventListener('pos:products:update', onProductsUpdate);
  }, []);

  // Get unique categories from products
  const categories = [
    "all",
    ...Array.from(new Set(products.map((product) => product.category))),
  ];

  // Filter products based on search query and category
  // Match logic mirrors POS screen for accuracy
  const normalize = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const collapseLeadingZeros = (s: string) => s.replace(/\d+/g, (m) => String(parseInt(m, 10)));
  const matchesLoose = (text: string | undefined, query: string) => {
    if (!query) return true;
    if (!text) return false;
    const tNorm = normalize(text);
    const qNorm = normalize(query);
    if (tNorm.includes(qNorm)) return true;
    const tCollapsed = collapseLeadingZeros(tNorm);
    const qCollapsed = collapseLeadingZeros(qNorm);
    return tCollapsed.includes(qNorm) || tCollapsed.includes(qCollapsed) || tNorm.includes(qCollapsed);
  };

  const relevanceScore = (p: Product, query: string) => {
    if (!query) return 0;
    const qNorm = normalize(query);
    const qColl = collapseLeadingZeros(qNorm);
    const sku = p.sku || "";
    const name = p.name || "";
    const category = p.category || "";
    const sNorm = normalize(sku);
    const sColl = collapseLeadingZeros(sNorm);
    const nNorm = normalize(name);
    const cNorm = normalize(category);

    let score = 0;
    if (sColl === qColl) score += 1000;
    if (sNorm === qNorm) score += 900;
    if (sColl.startsWith(qColl)) score += 800;
    if (sNorm.startsWith(qNorm)) score += 700;
    if (sColl.includes(qColl)) score += 600;
    if (sNorm.includes(qNorm)) score += 500;
    if (sColl.startsWith(qColl)) score += Math.max(0, 100 - (sColl.length - qColl.length));
    else if (sColl.includes(qColl)) score += Math.max(0, 50 - (sColl.length - qColl.length));
    if (nNorm === qNorm) score += 300;
    else if (nNorm.startsWith(qNorm)) score += 250;
    else if (nNorm.includes(qNorm)) score += 200;
    if (cNorm.startsWith(qNorm)) score += 120;
    else if (cNorm.includes(qNorm)) score += 100;
    return score;
  };

  const filteredProducts = products
    .filter((product) => {
      const matchesSearch =
        matchesLoose(product.name, searchQuery) ||
        matchesLoose(product.category, searchQuery) ||
        matchesLoose(product.sku, searchQuery);
      return matchesSearch;
    })
    .filter(
      (product) =>
        selectedCategory === "all" || product.category === selectedCategory,
    )
    .filter((product) => {
      // Filter produk tanpa harga jual jika showNoPriceOnly aktif
      if (showNoPriceOnly) {
        return !product.price || product.price === 0;
      }
      return true;
    })
    .filter((product) => {
      // Filter by SKU prefix; unknown prefixes are grouped as NO KATEGORI.
      if (selectedPrefix === "all") return true;
      if (selectedPrefix === "NO KATEGORI") return getCategoryFromSku(product.sku || '') === "NO KATEGORI";
      return (product.sku || "").toUpperCase().startsWith(selectedPrefix);
    })
    /* DISABLED - Margin filter causing issues
    .filter((product) => {
      // Filter by profit margin range
      if (selectedMarginRange === "all") return true;
      
      const margin = getProfitMargin(product);
      
      if (selectedMarginRange === "<10") return margin < 10;
      if (selectedMarginRange === "10-20") return margin >= 10 && margin < 20;
      if (selectedMarginRange === "20-30") return margin >= 20 && margin < 30;
      if (selectedMarginRange === "30-40") return margin >= 30 && margin < 40;
      if (selectedMarginRange === "40-50") return margin >= 40 && margin < 50;
      if (selectedMarginRange === "50-60") return margin >= 50 && margin < 60;
      if (selectedMarginRange === "60-70") return margin >= 60 && margin < 70;
      if (selectedMarginRange === "70-80") return margin >= 70 && margin < 80;
      if (selectedMarginRange === "80-90") return margin >= 80 && margin < 90;
      if (selectedMarginRange === "90-100") return margin >= 90 && margin < 100;
      if (selectedMarginRange === ">100") return margin >= 100;
      
      return true;
    })
    */
    .sort((a, b) => {
      // When searching, prioritize SKU relevance; fall back to user-selected sort
      if (searchQuery) {
        const diff = relevanceScore(b, searchQuery) - relevanceScore(a, searchQuery);
        if (diff !== 0) return diff;
      }
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "price") return a.price - b.price;
      if (sortBy === "stock") return (a.stock || 0) - (b.stock || 0);
      return 0;
    });

  const itemsPerPage = 20;
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset ke halaman 1 jika filter berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, sortBy, selectedPrefix, showNoPriceOnly]);

  const handleAddProduct = () => {
    setNewProduct({
      name: "",
      category: "",
      price: 0,
      purchasePrice: 0,
      stock: 0,
      sku: "",
      type: "product",
      threshold: 5,
    });
    setIsAddProductOpen(true);
  };

  const toCsvBlobUrl = (rows: any[]) => {
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    return URL.createObjectURL(blob);
  };

  const handleExportExcel = (all: boolean) => {
    try {
      const list = all ? products : filteredProducts;

      // Create data array with headers matching template format
      const data: (string | number)[][] = [
        ["KODE", "NAMA BARANG", "HARGA MODAL", "HARGA JUAL", "STOK AKHIR"]
      ];

      // Add product rows
      list.forEach((p) => {
        data.push([
          p.sku || "",
          p.name || "",
          p.purchasePrice ?? 0,
          p.price ?? 0,
          p.type === "product" ? (p.stock ?? 0) : 0
        ]);
      });

      // Create worksheet and workbook
      const ws = XLSX.utils.aoa_to_sheet(data);

      // Set column widths to match template
      ws['!cols'] = [
        { wch: 12 },  // KODE
        { wch: 25 },  // NAMA BARANG
        { wch: 14 },  // HARGA MODAL
        { wch: 14 },  // HARGA JUAL
        { wch: 12 }   // STOK AKHIR
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Produk");

      // Generate file and download
      const date = new Date().toISOString().slice(0, 10);
      const filename = all ? `Produk_Export_${date}.xlsx` : `Produk_Export_Filter_${date}.xlsx`;
      XLSX.writeFile(wb, filename);

    } catch (e) {
      console.error(e);
      alert("Gagal mengekspor Excel");
    }
  };

  const saveNewProduct = () => {
    // Auto-set category from SKU prefix
    const normalizedSku = (newProduct.sku || '').trim().toUpperCase();
    const autoCategory = getCategoryFromSku(normalizedSku);
    newProduct.category = autoCategory;

    const normalizedName = (newProduct.name || '').trim().toUpperCase();
    if (!normalizedName || !normalizedSku) {
      alert("Mohon lengkapi Kode dan Nama produk");
      return;
    }
    if (products.some(p => String(p.sku || '').trim().toUpperCase() === normalizedSku)) {
      alert(`Kode ${normalizedSku} sudah digunakan.`);
      return;
    }

    const productToAdd = {
      ...newProduct,
      id: `P-${Date.now()}`,
      name: normalizedName,
      category: newProduct.category || "",
      price: newProduct.price || 0,
      stock: newProduct.type === "product" ? newProduct.stock || 0 : undefined,
      sku: normalizedSku,
      type: newProduct.type || "product",
      threshold:
        newProduct.type === "product" ? newProduct.threshold || 5 : undefined,
    } as Product;

    const updatedProducts = [...products, productToAdd];
    setProducts(updatedProducts);
    setCachedProducts(updatedProducts);

    // Masuk antrean sinkronisasi; dikirim di background dan di-retry saat buka/online lagi.
    queueProductSync(productToAdd);

    try { window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts })); } catch { }

    setIsAddProductOpen(false);
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setIsEditProductOpen(true);
  };

  const saveEditedProduct = () => {
    if (!selectedProduct) return;
    const normalizedSku = String(selectedProduct.sku || '').trim().toUpperCase();
    const normalizedName = String(selectedProduct.name || '').trim().toUpperCase();
    if (!normalizedSku || !normalizedName) {
      alert("KODE dan Nama produk wajib diisi.");
      return;
    }
    if (products.some(p => p.id !== selectedProduct.id && String(p.sku || '').trim().toUpperCase() === normalizedSku)) {
      alert(`Kode ${normalizedSku} sudah digunakan.`);
      return;
    }
    const productToSave = { ...selectedProduct, sku: normalizedSku, name: normalizedName };

    const updatedProducts = products.map((product) =>
      product.id === selectedProduct.id ? productToSave : product,
    );

    setProducts(updatedProducts);
    setCachedProducts(updatedProducts);

    // Masuk antrean sinkronisasi; dikirim di background dan di-retry saat buka/online lagi.
    queueProductSync(productToSave);

    setIsEditProductOpen(false);
  };

  const handleDeleteProduct = (productId: string) => {
    const productToDelete = products.find(p => p.id === productId);
    if (!productToDelete) return;

    if (confirm(`Apakah Anda yakin ingin menghapus produk ${productToDelete.name} dari HP ini?`)) {
      const updatedProducts = products.filter(
        (product) => product.id !== productId,
      );
      setProducts(updatedProducts);
      setCachedProducts(updatedProducts);

      // (DIHAPUS) Tidak lagi menghapus di Google Sheet agar database tetap utuh.
      // Jika ingin muncul lagi, silakan lakukan Sync.

      try { window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts })); } catch { }
    }
  };

  // Handle input changes for new product (with uppercase for text fields)
  const handleNewProductChange = (field: string, value: any) => {
    // Convert text fields to uppercase
    let processedValue = value;
    if (typeof value === "string" && ["name", "sku", "category"].includes(field)) {
      processedValue = value.toUpperCase();
    }

    setNewProduct((prev) => ({
      ...prev,
      [field]: processedValue,
    }));
  };

  // Handle input changes for edited product (with uppercase for text fields)
  const handleEditProductChange = (field: string, value: any) => {
    if (!selectedProduct) return;

    // Convert text fields to uppercase
    let processedValue = value;
    if (typeof value === "string" && ["name", "sku", "category"].includes(field)) {
      processedValue = value.toUpperCase();
    }

    setSelectedProduct((prev) => ({
      ...prev,
      [field]: processedValue,
    }));
  };

  const getStockStatusColor = (stock: number) => {
    if (stock <= 5) return "destructive";
    if (stock <= 10) return "warning";
    return "secondary";
  };

  // Calculate profit margin percentage (GROSS PROFIT MARGIN)
  // Formula: ((Harga Jual - Harga Modal) / Harga Jual) × 100
  const getProfitMargin = (product: Product): number => {
    try {
      if (!product) return 0;
      const price = Number(product.price) || 0;
      const purchasePrice = Number(product.purchasePrice) || 0;

      if (price === 0) return 0; // Tidak bisa hitung jika harga jual 0
      if (purchasePrice === 0) return 0;
      if (isNaN(price) || isNaN(purchasePrice)) return 0;

      // GROSS MARGIN: (Untung / Harga Jual) × 100
      const margin = ((price - purchasePrice) / price) * 100;
      return isFinite(margin) ? margin : 0;
    } catch {
      return 0;
    }
  };

  // Get margin color
  const getMarginColor = (margin: number): string => {
    if (!isFinite(margin) || isNaN(margin)) return "text-gray-500";
    if (margin < 10) return "text-red-500";
    if (margin < 20) return "text-orange-500";
    if (margin < 30) return "text-yellow-600";
    if (margin < 50) return "text-blue-500";
    if (margin < 100) return "text-green-500";
    return "text-emerald-600";
  };

  // Show Profit Analysis view if toggled
  if (showProfitAnalysis) {
    return <ProfitAnalysis onBack={() => setShowProfitAnalysis(false)} />;
  }

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="p-4">
        {/* Search and Filter Bar */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              placeholder="Cari produk atau SKU..."
              className="w-full pl-12 pr-12 py-3 bg-gray-100 dark:bg-gray-800 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white dark:focus:bg-gray-700 transition-all"
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

          <p className="-mt-2 px-1 text-[11px] text-muted-foreground">
            Total produk: <span className="font-semibold text-foreground">{products.filter((product) => product.type === 'product').length.toLocaleString('id-ID')}</span>
          </p>

          {/* Tombol aksi - grid 3x2 kompak tapi lebih besar */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={handleAddProduct}
              className="bg-amber-500 hover:bg-amber-600 h-11 text-xs px-1"
            >
              <Plus className="h-4 w-4 mr-1" />
              Tambah
            </Button>
            <Button
              onClick={() => syncFromSheets(false)}
              disabled={isSyncing}
              className="bg-blue-600 hover:bg-blue-700 h-11 text-xs px-1"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Sheet'}
            </Button>
            <Button
              onClick={() => handleExportExcel(true)}
              className="bg-green-500 hover:bg-green-600 h-11 text-xs px-1"
            >
              Export
            </Button>

            <Button
              onClick={() => setIsBulkImportOpen(true)}
              variant="outline"
              className="h-11 text-xs px-1 border-blue-200 text-blue-600 hover:bg-blue-50"
            >
              Bulk Import
            </Button>

            <Button
              onClick={() => setShowDeleteAllConfirm(true)}
              variant="destructive"
              className="h-11 text-xs px-1"
              disabled={products.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Hapus Semua
            </Button>

            <Button
              variant={showNoPriceOnly ? "default" : "outline"}
              className={`h-11 text-xs ${showNoPriceOnly ? 'bg-red-500 hover:bg-red-600 text-white' : ''}`}
              onClick={() => {
                setShowNoPriceOnly(!showNoPriceOnly);
                setCurrentPage(1);
              }}
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              {showNoPriceOnly ? 'Semua' : 'No Price'}
            </Button>
          </div>

          {syncMessage && (
            <div className={`mt-2 p-2 rounded text-[11px] text-center border animate-in fade-in slide-in-from-top-1 duration-300 ${syncMessage.includes('✗') || syncMessage.includes('Gagal') ? 'bg-red-50 border-red-200 text-red-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
              {syncMessage}
            </div>
          )}

          {/* Quick Prefix Filters - Lebih besar */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {["all", "BG", "BA", "TL", "KG", "BK", "BT", "NO KATEGORI"].map((prefix) => {
              const isActive = selectedPrefix === prefix;

              const activeColorMap: Record<string, string> = {
                all: "bg-gray-600 text-white border-gray-600",
                BG: "bg-emerald-600 text-white border-emerald-600",
                BA: "bg-blue-600 text-white border-blue-600",
                TL: "bg-purple-600 text-white border-purple-600",
                KG: "bg-orange-600 text-white border-orange-600",
                BK: "bg-yellow-600 text-white border-yellow-600",
                BT: "bg-cyan-600 text-white border-cyan-600",
                "NO KATEGORI": "bg-gray-700 text-white border-gray-700",
              };

              return (
                <button
                  key={prefix}
                  onClick={() => setSelectedPrefix(prefix)}
                  className={`px-[17px] py-2 rounded-full text-xs font-extrabold transition-all whitespace-nowrap shadow-sm border ${isActive
                    ? activeColorMap[prefix]
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                    }`}
                >
                  {prefix === "all" ? "SEMUA" : prefix}
                </button>
              );
            })}
          </div>

          {/* Filter Profit Margin - DISABLED FOR NOW
          <div className="mt-4">
            <Label className="text-sm font-medium mb-2 block">💰 Filter Keuntungan:</Label>
            ...
          </div>
          */}
        </div>

        {/* Product List */}
        <div className="space-y-3">
          {paginatedProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Tidak ada produk yang ditemukan
            </div>
          ) : (
            paginatedProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <CardContent className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm truncate">{product.name || '-'}</h3>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="text-[10px] px-2 py-0.5 rounded font-bold text-slate-600 bg-slate-50 border border-slate-200 uppercase">{product.sku || '-'}</span>
                            <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">{product.category || '-'}</span>
                            {/* Profit margin badge hidden for cashier view */}
                            {/* {product.purchasePrice > 0 && product.price > 0 && (() => {
                              const margin = getProfitMargin(product);
                              return margin > 0 && isFinite(margin) ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getMarginColor(margin)} bg-white border`}>
                                  +{margin.toFixed(0)}%
                                </span>
                              ) : null;
                            })()} */}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`font-medium text-sm ${!product.price || product.price === 0 ? 'text-red-500' : 'text-amber-600'}`}>
                            {formatCurrency(product.price)}
                            {(!product.price || product.price === 0) && <span className="ml-1">⚠️</span>}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            Stok: {product.type === 'product' ? (product.stock ?? 0) : '-'}
                          </span>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEditProduct(product)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteProduct(product.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>&lt;</Button>
            <span className="text-sm">Halaman {currentPage} dari {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>&gt;</Button>
          </div>
        )}
      </div>

      {/* Add Product Dialog */}
      <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-center pb-2 border-b">
            <DialogTitle className="text-lg">Tambah Produk Baru</DialogTitle>
            <DialogDescription className="text-xs">
              Isi detail produk lengkap di bawah ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[55vh] overflow-y-auto py-4">
            {/* Kategori auto-detect */}
            {newProduct.sku && (
              <div className="mb-1">
                <span className="text-sm font-bold text-blue-500 block">
                  {getCategoryFromSku(newProduct.sku || '')}
                </span>
              </div>
            )}
            {/* KODE */}
            <div className="space-y-2">
              <Label htmlFor="sku" className="text-sm font-semibold text-gray-700">KODE PRODUK</Label>
              <Input
                id="sku"
                placeholder="Contoh: BT-0001"
                value={newProduct.sku}
                onChange={(e) => handleNewProductChange("sku", e.target.value)}
                className="font-mono text-lg"
              />
              <BarcodeScanner onDetected={(code) => handleNewProductChange("sku", code)} />
            </div>
            {/* Nama Produk */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold text-gray-700">NAMA PRODUK</Label>
              <Input
                id="name"
                placeholder="Masukkan nama produk"
                value={newProduct.name}
                onChange={(e) =>
                  handleNewProductChange("name", e.target.value)
                }
                className="text-lg"
              />
            </div>
            {/* Harga */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <Label className="text-sm font-semibold text-gray-700">💰 HARGA</Label>
              <div className="grid grid-cols-2 gap-4">
                {/* Hidden Harga Beli for cashier view */}
                {/* <div className="space-y-1">
                  <Label htmlFor="purchasePrice" className="text-xs text-gray-500">Harga Beli</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
                    <Input
                      id="purchasePrice"
                      type="number"
                      placeholder="0"
                      value={newProduct.purchasePrice}
                      onChange={(e) => handleNewProductChange("purchasePrice", parseInt(e.target.value) || 0)}
                      className="pl-10 text-right font-medium"
                    />
                  </div>
                </div> */}
                <div className="space-y-1">
                  <Label htmlFor="price" className="text-xs text-gray-500">Harga Jual</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
                    <Input
                      id="price"
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={newProduct.price === 0 ? "" : newProduct.price.toLocaleString("id-ID")}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        handleNewProductChange("price", parseInt(val) || 0);
                      }}
                      className="pl-10 text-right font-medium text-amber-600"
                    />
                  </div>
                </div>
              </div>
            </div>
            {/* Stok */}
            <div className="space-y-2">
              <Label htmlFor="stock" className="text-sm font-semibold text-gray-700">📦 STOK AWAL</Label>
              <Input
                id="stock"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={newProduct.stock === 0 ? "" : newProduct.stock.toLocaleString("id-ID")}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  handleNewProductChange("stock", parseInt(val) || 0);
                }}
                className="text-lg font-medium text-center"
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 pt-4 border-t">
            <Button
              className="w-full bg-amber-500 hover:bg-amber-600 h-12 text-base font-semibold"
              onClick={saveNewProduct}
            >
              ✓ Simpan Produk
            </Button>
            <Button
              variant="outline"
              className="w-full h-10"
              onClick={() => setIsAddProductOpen(false)}
            >
              Batal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={isEditProductOpen} onOpenChange={setIsEditProductOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-center pb-2 border-b">
            <DialogTitle className="text-lg">Edit Produk</DialogTitle>
            <DialogDescription className="text-xs">
              Ubah detail produk yang dipilih lalu simpan perubahan.
            </DialogDescription>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto py-4">
              <div className="space-y-3 py-2">
                {/* Kategori auto-detect + KODE */}
                <div className="space-y-1">
                  <span className="text-xs font-bold text-blue-500">
                    {getCategoryFromSku(selectedProduct.sku || '')}
                  </span>
                  <div className="space-y-1">
                    <Label htmlFor="edit-sku" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">KODE</Label>
                    <Input
                      id="edit-sku"
                      value={selectedProduct.sku}
                      onChange={(e) => handleEditProductChange("sku", e.target.value)}
                      className="font-mono text-sm h-9"
                    />
                  </div>
                </div>

                {/* Nama Produk */}
                <div className="space-y-1">
                  <Label htmlFor="edit-name" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">NAMA PRODUK</Label>
                  <Input
                    id="edit-name"
                    value={selectedProduct.name}
                    onChange={(e) => handleEditProductChange("name", e.target.value)}
                    className="text-sm h-9"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 items-end">
                  {/* Harga Jual */}
                  <div className="space-y-1">
                    <Label htmlFor="edit-price" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">HARGA JUAL</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rp</span>
                      <Input
                        id="edit-price"
                        type="text"
                        inputMode="numeric"
                        value={selectedProduct.price === 0 ? "" : selectedProduct.price.toLocaleString("id-ID")}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          handleEditProductChange("price", parseInt(val) || 0);
                        }}
                        className="pl-9 text-right font-bold text-amber-600 h-9"
                      />
                    </div>
                  </div>
                  {/* Stok (read-only, hanya berubah via jual/refund/sync) */}
                  <div className="space-y-1">
                    <Label htmlFor="edit-stock" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">STOK</Label>
                    <Input
                      id="edit-stock"
                      type="text"
                      value={selectedProduct.stock === 0 ? "0" : selectedProduct.stock.toLocaleString("id-ID")}
                      disabled
                      className="text-right font-medium h-9 bg-gray-100 text-gray-500 cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 pt-4 border-t">
            <Button
              className="w-full bg-amber-500 hover:bg-amber-600 h-12 text-base font-semibold"
              onClick={saveEditedProduct}
            >
              ✓ Simpan Perubahan
            </Button>
            <Button
              variant="outline"
              className="w-full h-10"
              onClick={() => setIsEditProductOpen(false)}
            >
              Batal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={isBulkImportOpen} onOpenChange={setIsBulkImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">📤 Bulk Import Produk</DialogTitle>
            <DialogDescription>
              Import banyak produk sekaligus menggunakan file Excel
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-auto p-1">
            {/* Format Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-sm mb-2 text-blue-900">📋 Format File Excel:</h4>
              <div className="bg-white rounded p-3 font-mono text-xs">
                <div className="grid grid-cols-5 gap-2 font-bold mb-1 text-blue-700">
                  <div>KODE</div>
                  <div>NAMA BARANG</div>
                  <div>HARGA MODAL</div>
                  <div>HARGA JUAL</div>
                  <div>STOK AKHIR</div>
                </div>
                <div className="grid grid-cols-5 gap-2 text-muted-foreground">
                  <div>BA-100</div>
                  <div>BAUT M8</div>
                  <div>3000</div>
                  <div>5000</div>
                  <div>100</div>
                </div>
                <div className="grid grid-cols-5 gap-2 text-muted-foreground">
                  <div>BG-200</div>
                  <div>BAUT M10</div>
                  <div>5000</div>
                  <div>8000</div>
                  <div>150</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                <p>✓ Header kolom: <code className="bg-white px-1 py-0.5 rounded">KODE, NAMA BARANG, HARGA MODAL, HARGA JUAL, STOK AKHIR</code></p>
                <p>✓ Kode otomatis UPPERCASE</p>
                <p className="font-semibold text-blue-700">✓ Kategori auto-detect dari 2 huruf pertama:</p>
                <div className="ml-4 space-y-0.5">
                  <p>→ BA = BAUT OTOMOTIF</p>
                  <p>→ BG = BAUT GENERAL</p>
                  <p>→ BK = BAUT KAYU</p>
                  <p>→ KG = KILOGRAM</p>
                  <p>→ TL = TOOLS</p>
                  <p>→ BT = BAUT TRUCK</p>
                   <p>→ Prefix lain = NO KATEGORI (contoh: ZZ-001)</p>
                </div>
              </div>
            </div>

            {/* Download Sample */}
            <Button
              variant="outline"
              onClick={() => {
                const ws_data = [
                  ['KODE', 'NAMA BARANG', 'HARGA MODAL', 'HARGA JUAL', 'STOK AKHIR'],
                  ['BA-100', 'BAUT M8 OTOMOTIF', 3000, 5000, 100],
                  ['BG-200', 'BAUT M10 GENERAL', 5000, 8000, 80],
                  ['BK-300', 'BAUT KAYU 4X40', 1500, 3000, 150],
                  ['KG-001', 'PAKU KILOGRAM', 18000, 25000, 50],
                  ['TL-001', 'OBENG PLUS', 25000, 35000, 30],
                  ['BT-001', 'BAUT TRUCK M12', 8000, 12000, 20],
                  ['ZZ-001', 'BARANG LAIN', 1000, 2000, 5],
                ];
                const ws = XLSX.utils.aoa_to_sheet(ws_data);
                ws['!cols'] = [
                  { wch: 12 },  // KODE
                  { wch: 25 },  // NAMA BARANG
                  { wch: 14 },  // HARGA MODAL
                  { wch: 14 },  // HARGA JUAL
                  { wch: 12 },  // STOK AKHIR
                ];
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Produk');
                XLSX.writeFile(wb, 'Template_Import_Produk.xlsx');
              }}
              className="w-full bg-green-50 hover:bg-green-100 border-green-300 text-green-700"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template Excel (.xlsx)
            </Button>

            {/* File Upload */}
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  let imported: Product[] = [];

                  try {
                    const buffer = await file.arrayBuffer();
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    if (!firstSheetName) {
                      alert('File Excel tidak memiliki sheet');
                      return;
                    }
                    const firstSheet = workbook.Sheets[firstSheetName];
                    const data: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

                    if (data.length === 0) {
                      alert('Tidak ada data yang ditemukan dalam file');
                      return;
                    }

                    const getCell = (obj: any, keys: string[]) => {
                      for (const key of keys) {
                        if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
                          return obj[key];
                        }
                      }
                      return '';
                    };

                    const parseImportNumber = (value: unknown, field: string, rowNumber: number): number => {
                      if (value === null || value === undefined || String(value).trim() === '') return 0;
                      const parsed = typeof value === 'number'
                        ? value
                        : Number(String(value).replace(/[^0-9-]/g, ''));
                      if (!Number.isFinite(parsed)) {
                        throw new Error(`Baris ${rowNumber}: ${field} harus berupa angka`);
                      }
                      return parsed;
                    };

                    const seenSkus = new Set<string>();
                    const errors: string[] = [];
                    imported = data.map((obj: any, index: number) => {
                      const rowNumber = index + 2; // baris 1 adalah header Excel
                      const kode = String(getCell(obj, [
                        'KODE', 'kode', 'Code', 'code', 'Code ', 'KODE '
                      ])).toUpperCase().trim();
                      const name = String(getCell(obj, [
                        'NAMA BARANG', 'Nama Barang', 'Nama barang',
                        'NAMA', 'nama', 'Name', 'name'
                      ])).toUpperCase().trim();
                      const purchasePrice = parseImportNumber(getCell(obj, [
                        'HARGA MODAL', 'HARGA_MODAL', 'Modal (Price)',
                        'Modal', 'MODAL', 'modal', 'Harga Modal'
                      ]), 'Harga Modal', rowNumber);
                      const price = parseImportNumber(getCell(obj, [
                        'HARGA JUAL', 'HARGA_JUAL', 'Harga Jual',
                        'Harga jual', 'HARGA', 'harga', 'Jual', 'jual'
                      ]), 'Harga Jual', rowNumber);
                      // Stok BOLEH negatif; hanya harus berupa angka yang valid.
                      const stock = parseImportNumber(getCell(obj, [
                        'STOK AKHIR', 'STOK_AKHIR', 'STOK', 'stok', 'Qty', 'qty'
                      ]), 'Stok', rowNumber);

                      if (!kode) errors.push(`Baris ${rowNumber}: KODE/SKU kosong`);
                      if (!name) errors.push(`Baris ${rowNumber}: Nama produk kosong`);
                      if (kode && seenSkus.has(kode)) errors.push(`Baris ${rowNumber}: SKU ${kode} duplikat di file`);
                      if (kode) seenSkus.add(kode);
                      if (purchasePrice < 0) errors.push(`Baris ${rowNumber}: Harga Modal tidak boleh negatif`);
                      if (price < 0) errors.push(`Baris ${rowNumber}: Harga Jual tidak boleh negatif`);

                      return {
                        id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name,
                        category: getCategoryFromSku(kode),
                        sku: kode,
                        purchasePrice,
                        price,
                        stock,
                        type: 'product',
                        threshold: 5,
                      } as Product;
                    });

                    if (errors.length > 0) {
                      throw new Error(`Import dibatalkan karena data tidak valid:\n\n${errors.slice(0, 20).join('\n')}${errors.length > 20 ? `\n... dan ${errors.length - 20} masalah lainnya` : ''}`);
                    }

                    // Merge by normalized SKU in O(existing + imported), not nested findIndex.
                    const updatedProducts = [...products];
                    const indexBySku = new Map<string, number>();
                    updatedProducts.forEach((product, index) => {
                      const sku = String(product.sku ?? '').trim().toUpperCase();
                      if (sku) indexBySku.set(sku, index);
                    });
                    let addedCount = 0;
                    let updatedCount = 0;

                    imported.forEach((importedProduct) => {
                      const existingIndex = indexBySku.get(importedProduct.sku.toUpperCase());

                      if (existingIndex !== undefined) {
                        // Update existing product - keep ID and update editable fields.
                        updatedProducts[existingIndex] = {
                          ...updatedProducts[existingIndex],
                          name: importedProduct.name,
                          category: importedProduct.category,
                          purchasePrice: importedProduct.purchasePrice,
                          price: importedProduct.price,
                          stock: importedProduct.stock,
                        };
                        updatedCount++;
                      } else {
                        indexBySku.set(importedProduct.sku.toUpperCase(), updatedProducts.length);
                        updatedProducts.push(importedProduct);
                        addedCount++;
                      }
                    });

                    setProducts(updatedProducts);
                    setCachedProducts(updatedProducts);
                    try {
                      window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }));
                    } catch { }

                    alert(`✅ Berhasil import!\n${updatedCount} produk diupdate\n${addedCount} produk ditambahkan`);
                    setIsBulkImportOpen(false);
                    e.target.value = '';
                  } catch (error: any) {
                    alert('Error: ' + error.message);
                  }
                }}
                className="w-full cursor-pointer"
              />
              <p className="text-sm text-muted-foreground mt-2">
                Klik untuk pilih file Excel (.xlsx / .xls)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkImportOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Laporan Laba Bersih Dialog */}
      <Dialog open={isProfitReportOpen} onOpenChange={setIsProfitReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Laporan Laba Bersih</DialogTitle>
            <DialogDescription>
              Ringkasan total laba bersih berdasarkan transaksi yang tersimpan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {/* Hitung total laba bersih dari transaksi */}
            {(() => {
              let transactions = [];
              try {
                transactions = getFromLS(LS_KEYS.TRANSACTIONS, []);
              } catch { }
              let totalProfit = 0;
              transactions.forEach((trx: any) => {
                trx.items.forEach((item: any) => {
                  // Gunakan purchasePrice dari transaksi jika ada
                  let purchasePrice = item.purchasePrice;
                  if (purchasePrice === undefined) {
                    const prod = products.find(p => p.name === item.name && p.sku === item.sku);
                    purchasePrice = prod?.purchasePrice || 0;
                  }
                  if (item.type === 'product') {
                    totalProfit += (item.price - purchasePrice) * item.quantity;
                  }
                });
              });
              return <div className="text-lg font-bold">Total Laba Bersih: Rp {totalProfit.toLocaleString()}</div>;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProfitReportOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog >

      {/* Delete All Products Confirmation - Step 1 */}
      < AlertDialog open={showDeleteAllConfirm} onOpenChange={setShowDeleteAllConfirm} >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Hapus Semua Produk?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-red-600 font-bold">PERINGATAN: </span>
              Tindakan ini akan menghapus SEMUA {products.length} produk.
              <br /><br />
              Data produk TIDAK BISA dikembalikan.
              <br />
              Transaksi tidak akan terhapus, hanya data produk saja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDeleteAllConfirm(false);
                setShowDeleteAllStep2(true);
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Lanjutkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog >

      {/* Delete All Products Confirmation - Step 2 */}
      < AlertDialog open={showDeleteAllStep2} onOpenChange={setShowDeleteAllStep2} >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🔴 KONFIRMASI TERAKHIR</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan menghapus <span className="font-bold text-red-600">SEMUA {products.length} PRODUK</span>.
              <br /><br />
              Tindakan ini TIDAK BISA dibatalkan!
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Delete all products
                setProducts([]);
                setCachedProducts([]);
                try {
                  window.dispatchEvent(new CustomEvent('pos:products:update', { detail: [] }));
                } catch { }
                setShowDeleteAllStep2(false);
                alert(`✅ Semua produk berhasil dihapus!\nTransaksi tetap tersimpan.`);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              YA, HAPUS SEMUA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog >
    </div >
  );
};

export default ProductManagement;
