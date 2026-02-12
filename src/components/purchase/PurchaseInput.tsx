import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    ArrowLeft,
    Plus,
    Trash2,
    FileText,
    Package,
    CheckCircle,
    Calendar,
    Search,
    ChevronDown,
    ChevronUp,
    History,
    Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, normalizeSearch, collapseLeadingZeros, matchesLoose } from "@/lib/utils";
import { getProducts as getCachedProducts, setProducts as setCachedProducts } from "@/lib/productCache";
import { useToast } from "@/components/ui/use-toast";
import type { Product } from "@/types/pos";

interface PurchaseItem {
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

interface PurchaseNote {
    id: string;
    date: string;
    items: PurchaseItem[];
    grandTotal: number;
    createdAt: string;
}

const NOTA_DRAFT_KEY = "nota_draft";

interface NotaDraft {
    items: PurchaseItem[];
    noteDate: string;
    // Current input being edited
    currentInput?: {
        selectedProductId: string | null;
        searchTerm: string;
        currentQty: number;
        currentPrice: number;
    };
}

// Helper to get draft from localStorage
const getDraft = (): NotaDraft | null => {
    try {
        const data = localStorage.getItem(NOTA_DRAFT_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
};

const PurchaseInput = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [products, setProducts] = useState<Product[]>([]);

    // Initialize items and noteDate from draft (lazy initialization)
    const [items, setItems] = useState<PurchaseItem[]>(() => {
        const draft = getDraft();
        return draft?.items || [];
    });
    const [noteDate, setNoteDate] = useState(() => {
        const draft = getDraft();
        return draft?.noteDate || new Date().toISOString().split("T")[0];
    });

    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [showSuccessDialog, setShowSuccessDialog] = useState(false);

    // Search state - also persisted
    const [searchTerm, setSearchTerm] = useState(() => {
        const draft = getDraft();
        return draft?.currentInput?.searchTerm || "";
    });
    const [showSearchResults, setShowSearchResults] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
        const draft = getDraft();
        return draft?.currentInput?.selectedProductId || null;
    });

    // Current input row - also persisted
    const [currentQty, setCurrentQty] = useState<number>(() => {
        const draft = getDraft();
        return draft?.currentInput?.currentQty || 1;
    });
    const [currentPrice, setCurrentPrice] = useState<number>(() => {
        const draft = getDraft();
        return draft?.currentInput?.currentPrice || 0;
    });

    const searchInputRef = useRef<HTMLInputElement>(null);

    // Get selected product from products list
    const selectedProduct = selectedProductId
        ? products.find(p => p.id === selectedProductId) || null
        : null;

    // History state
    const [purchaseHistory, setPurchaseHistory] = useState<PurchaseNote[]>([]);
    const [selectedNote, setSelectedNote] = useState<PurchaseNote | null>(null);
    const [showNoteDetail, setShowNoteDetail] = useState(false);
    const [historyDateFilter, setHistoryDateFilter] = useState("");

    // Load products and history
    useEffect(() => {
        const storedProducts = getCachedProducts() as Product[];
        setProducts(storedProducts);

        // Load purchase history
        const history = getFromLS<PurchaseNote[]>("purchase_notes", []);
        // Sort by date descending (newest first)
        setPurchaseHistory(history.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ));
    }, []);

    // Save draft to localStorage whenever any data changes
    useEffect(() => {
        const draft: NotaDraft = {
            items,
            noteDate,
            currentInput: {
                selectedProductId,
                searchTerm,
                currentQty,
                currentPrice
            }
        };
        localStorage.setItem(NOTA_DRAFT_KEY, JSON.stringify(draft));
    }, [items, noteDate, selectedProductId, searchTerm, currentQty, currentPrice]);

    // Relevance score (same as POS)
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

    // Filtered and sorted products (same logic as POS)
    const filteredProducts = products
        .filter((item) => {
            if (!searchTerm) return false;
            return (
                matchesLoose(item.name, searchTerm) ||
                matchesLoose(item.category, searchTerm) ||
                matchesLoose(item.sku, searchTerm)
            );
        })
        .sort((a, b) => relevanceScore(b, searchTerm) - relevanceScore(a, searchTerm))
        .slice(0, 10);

    // Handle search change
    const handleSearchChange = (value: string) => {
        setSearchTerm(value.toUpperCase());
        setShowSearchResults(value.length > 0);

        // Auto-select if exact match
        if (value.length >= 2) {
            const exactMatch = products.find(
                (p) => p.sku && p.sku.toUpperCase() === value.toUpperCase()
            );
            if (exactMatch) {
                // Don't auto-select, let user pick from list
            }
        }
    };

    // Select product from search
    const selectProduct = (product: Product) => {
        setSelectedProductId(product.id);
        setSearchTerm(product.sku || "");
        setCurrentPrice(product.purchasePrice || 0);
        setShowSearchResults(false);
    };

    // Add item to list
    const addItemToList = () => {
        if (!selectedProduct) {
            toast({ title: "Error", description: "Pilih produk dari daftar", variant: "destructive" });
            return;
        }
        if (currentQty < 1) {
            toast({ title: "Error", description: "Jumlah minimal 1", variant: "destructive" });
            return;
        }

        // Check if already in list
        const existing = items.find((i) => i.productId === selectedProduct.id);
        if (existing) {
            setItems(
                items.map((i) =>
                    i.productId === selectedProduct.id
                        ? {
                            ...i,
                            quantity: i.quantity + currentQty,
                            unitPrice: currentPrice,
                            totalPrice: (i.quantity + currentQty) * currentPrice,
                        }
                        : i
                )
            );
        } else {
            const newItem: PurchaseItem = {
                productId: selectedProduct.id,
                sku: selectedProduct.sku || "",
                name: selectedProduct.name,
                quantity: currentQty,
                unitPrice: currentPrice,
                totalPrice: currentQty * currentPrice,
            };
            setItems([...items, newItem]);
        }

        // Reset
        setSearchTerm("");
        setSelectedProductId(null);
        setCurrentQty(1);
        setCurrentPrice(0);
        searchInputRef.current?.focus();
    };

    // Remove item
    const removeItem = (productId: string) => {
        setItems(items.filter((i) => i.productId !== productId));
    };

    // Calculate grand total
    const grandTotal = items.reduce((sum, i) => sum + i.totalPrice, 0);

    // Process purchase
    const processPurchase = () => {
        if (items.length === 0) {
            toast({
                title: "Error",
                description: "Tambahkan minimal 1 barang",
                variant: "destructive",
            });
            return;
        }

        const updatedProducts = products.map((p) => {
            const purchasedItem = items.find((i) => i.productId === p.id);
            if (purchasedItem) {
                return {
                    ...p,
                    stock: (p.stock || 0) + purchasedItem.quantity,
                    purchasePrice: purchasedItem.unitPrice,
                };
            }
            return p;
        });

        setProducts(updatedProducts);
        setCachedProducts(updatedProducts);

        const purchaseNote: PurchaseNote = {
            id: `PN-${Date.now()}`,
            date: noteDate,
            items: items,
            grandTotal: grandTotal,
            createdAt: new Date().toISOString(),
        };

        const existingNotes = getFromLS<PurchaseNote[]>("purchase_notes", []);
        const newNotes = [...existingNotes, purchaseNote];
        saveToLS("purchase_notes", newNotes);

        // Update history list
        setPurchaseHistory(newNotes.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ));

        try {
            window.dispatchEvent(
                new CustomEvent("pos:products:update", { detail: updatedProducts })
            );
        } catch { }

        setShowConfirmDialog(false);
        setShowSuccessDialog(true);
        setItems([]);
        setNoteDate(new Date().toISOString().split("T")[0]);
        setSelectedProductId(null);
        setSearchTerm("");
        setCurrentQty(1);
        setCurrentPrice(0);

        // Clear draft after successful processing
        localStorage.removeItem(NOTA_DRAFT_KEY);
    };

    const currentTotal = currentQty * currentPrice;

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b z-20 px-4 py-3">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-lg font-bold">Input Nota Belanja</h1>
                        <p className="text-xs text-muted-foreground">
                            Restok barang & update harga modal
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Tanggal Nota */}
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <Label className="text-sm font-semibold">Tanggal Nota</Label>
                        </div>
                        <Input
                            type="date"
                            value={noteDate}
                            onChange={(e) => setNoteDate(e.target.value)}
                            className="mt-2"
                        />
                    </CardContent>
                </Card>

                {/* Search & Input Form */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Tambah Barang</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {/* Search Input */}
                        <div className="relative">
                            <Label className="text-xs text-gray-500">Cari Kode / Nama Barang</Label>
                            <div className="relative mt-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    ref={searchInputRef}
                                    placeholder="Ketik kode atau nama barang..."
                                    value={searchTerm}
                                    onChange={(e) => handleSearchChange(e.target.value)}
                                    onFocus={() => searchTerm && setShowSearchResults(true)}
                                    className="pl-9 font-mono"
                                />
                            </div>

                            {/* Search Results Dropdown */}
                            {showSearchResults && filteredProducts.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {filteredProducts.map((product) => (
                                        <div
                                            key={product.id}
                                            className="p-3 hover:bg-amber-50 cursor-pointer border-b last:border-b-0"
                                            onClick={() => selectProduct(product)}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-sm truncate">{product.name}</p>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <span className="font-mono bg-gray-100 px-1 rounded">{product.sku}</span>
                                                        <span>{product.category}</span>
                                                    </div>
                                                </div>
                                                <div className="text-right text-xs">
                                                    <p className="text-muted-foreground">Stok: {product.stock ?? 0}</p>
                                                    <p className="text-amber-600">{formatCurrency(product.purchasePrice || 0)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {showSearchResults && searchTerm && filteredProducts.length === 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg p-4 text-center text-muted-foreground">
                                    Produk tidak ditemukan
                                </div>
                            )}
                        </div>

                        {/* Selected Product Display */}
                        {selectedProduct && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium text-sm">{selectedProduct.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku}</p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => {
                                            setSelectedProductId(null);
                                            setSearchTerm("");
                                            setCurrentPrice(0);
                                        }}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Jumlah & Harga */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-xs text-gray-500">Jumlah Masuk</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={currentQty}
                                    onChange={(e) => setCurrentQty(parseInt(e.target.value) || 1)}
                                    className="text-center"
                                />
                            </div>
                            <div>
                                <Label className="text-xs text-gray-500">Harga Satuan</Label>
                                <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                                        Rp
                                    </span>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={currentPrice}
                                        onChange={(e) => setCurrentPrice(parseInt(e.target.value) || 0)}
                                        className="pl-7 text-right"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Harga Total (Auto) */}
                        <div className="bg-amber-50 rounded-lg p-3 flex justify-between items-center">
                            <span className="text-sm font-medium">Harga Total:</span>
                            <span className="font-bold text-amber-600">
                                {formatCurrency(currentTotal)}
                            </span>
                        </div>

                        {/* Add Button */}
                        <Button
                            onClick={addItemToList}
                            disabled={!selectedProduct}
                            className="w-full bg-amber-500 hover:bg-amber-600"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Tambah ke Daftar
                        </Button>
                    </CardContent>
                </Card>

                {/* Items List */}
                {items.length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Daftar Barang ({items.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-1 text-xs font-semibold text-gray-500 border-b pb-2">
                                <div className="col-span-3">Kode</div>
                                <div className="col-span-3">Nama</div>
                                <div className="col-span-1 text-center">Qty</div>
                                <div className="col-span-2 text-right">Harga</div>
                                <div className="col-span-2 text-right">Total</div>
                                <div className="col-span-1"></div>
                            </div>

                            {/* Items */}
                            {items.map((item) => (
                                <div
                                    key={item.productId}
                                    className="grid grid-cols-12 gap-1 text-xs items-center py-1 border-b"
                                >
                                    <div className="col-span-3 font-mono truncate">{item.sku}</div>
                                    <div className="col-span-3 truncate">{item.name}</div>
                                    <div className="col-span-1 text-center">{item.quantity}</div>
                                    <div className="col-span-2 text-right">
                                        {formatCurrency(item.unitPrice)}
                                    </div>
                                    <div className="col-span-2 text-right font-medium text-amber-600">
                                        {formatCurrency(item.totalPrice)}
                                    </div>
                                    <div className="col-span-1 text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-destructive"
                                            onClick={() => removeItem(item.productId)}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}

                            {/* Grand Total */}
                            <div className="border-t pt-3 flex justify-between">
                                <span className="font-semibold">GRAND TOTAL:</span>
                                <span className="font-bold text-lg text-amber-600">
                                    {formatCurrency(grandTotal)}
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Empty State */}
                {items.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                        <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Belum ada barang</p>
                    </div>
                )}

                {/* Process Button */}
                {items.length > 0 && (
                    <Button
                        onClick={() => setShowConfirmDialog(true)}
                        className="w-full bg-green-600 hover:bg-green-700 h-12 text-base font-semibold"
                    >
                        ✓ Proses Nota Belanja
                    </Button>
                )}

                {/* Purchase History - Grouped by Date */}
                {purchaseHistory.length > 0 && (
                    <Card className="mt-6">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <History className="h-4 w-4" />
                                    Riwayat Nota ({purchaseHistory.length})
                                </CardTitle>
                                <Input
                                    type="date"
                                    value={historyDateFilter}
                                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                                    className="w-36 h-8 text-xs"
                                    placeholder="Filter tanggal"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Group by date */}
                            {(() => {
                                // Filter by date if filter is set
                                const filteredHistory = historyDateFilter
                                    ? purchaseHistory.filter(note => note.date === historyDateFilter)
                                    : purchaseHistory;

                                if (filteredHistory.length === 0) {
                                    return (
                                        <div className="text-center py-4 text-muted-foreground text-sm">
                                            Tidak ada nota untuk tanggal ini
                                        </div>
                                    );
                                }

                                // Group notes by date
                                const grouped: { [key: string]: PurchaseNote[] } = {};
                                filteredHistory.forEach(note => {
                                    const dateKey = note.date;
                                    if (!grouped[dateKey]) grouped[dateKey] = [];
                                    grouped[dateKey].push(note);
                                });

                                // Sort dates descending
                                const sortedDates = Object.keys(grouped).sort((a, b) =>
                                    new Date(b).getTime() - new Date(a).getTime()
                                );

                                // Download Excel function
                                const downloadExcel = (dateKey: string, notes: PurchaseNote[]) => {
                                    const rows: any[] = [];
                                    let noteNum = notes.length;

                                    notes.forEach((note, noteIdx) => {
                                        // Add note header
                                        rows.push({
                                            "Nota": `Nota #${noteNum - noteIdx}`,
                                            "Kode": "",
                                            "Nama": "",
                                            "Qty": "",
                                            "Harga": "",
                                            "Total": formatCurrency(note.grandTotal)
                                        });

                                        // Add items
                                        note.items.forEach(item => {
                                            rows.push({
                                                "Nota": "",
                                                "Kode": item.sku,
                                                "Nama": item.name,
                                                "Qty": item.quantity,
                                                "Harga": item.unitPrice,
                                                "Total": item.totalPrice
                                            });
                                        });

                                        // Add empty row separator
                                        if (noteIdx < notes.length - 1) {
                                            rows.push({});
                                        }
                                    });

                                    // Add grand total
                                    const grandTotal = notes.reduce((sum, n) => sum + n.grandTotal, 0);
                                    rows.push({});
                                    rows.push({
                                        "Nota": "GRAND TOTAL",
                                        "Kode": "",
                                        "Nama": "",
                                        "Qty": "",
                                        "Harga": "",
                                        "Total": grandTotal
                                    });

                                    const ws = XLSX.utils.json_to_sheet(rows);
                                    const wb = XLSX.utils.book_new();
                                    XLSX.utils.book_append_sheet(wb, ws, "Nota Belanja");

                                    const dateStr = new Date(dateKey).toLocaleDateString("id-ID", {
                                        day: "2-digit",
                                        month: "2-digit",
                                        year: "numeric"
                                    }).replace(/\//g, "-");

                                    XLSX.writeFile(wb, `Nota_Belanja_${dateStr}.xlsx`);
                                };

                                return sortedDates.slice(0, 10).map((dateKey, dateIdx) => (
                                    <div key={dateKey}>
                                        {/* Separator between date groups */}
                                        {dateIdx > 0 && (
                                            <div className="border-t-2 border-dashed border-gray-300 my-4" />
                                        )}

                                        <div className="border rounded-lg overflow-hidden">
                                            {/* Date header with download button */}
                                            <div className="p-2 bg-gray-100 flex items-center justify-between">
                                                <span className="text-xs font-medium text-gray-600">
                                                    📅 {new Date(dateKey).toLocaleDateString("id-ID", {
                                                        weekday: "long",
                                                        day: "numeric",
                                                        month: "long",
                                                        year: "numeric"
                                                    })}
                                                    <span className="text-gray-400 ml-2">
                                                        ({grouped[dateKey].length} nota)
                                                    </span>
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        downloadExcel(dateKey, grouped[dateKey]);
                                                    }}
                                                >
                                                    <Download className="h-3 w-3 mr-1" />
                                                    Excel
                                                </Button>
                                            </div>

                                            {/* Notes for this date */}
                                            <div className="divide-y divide-dashed">
                                                {grouped[dateKey].map((note, idx) => (
                                                    <div
                                                        key={note.id}
                                                        className="p-3 bg-white hover:bg-amber-50 cursor-pointer flex justify-between items-center"
                                                        onClick={() => {
                                                            setSelectedNote(note);
                                                            setShowNoteDetail(true);
                                                        }}
                                                    >
                                                        <div>
                                                            <p className="font-medium text-sm">
                                                                Nota #{grouped[dateKey].length - idx}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {note.items.length} item
                                                            </p>
                                                        </div>
                                                        <div className="text-right flex items-center gap-2">
                                                            <p className="font-bold text-amber-600">
                                                                {formatCurrency(note.grandTotal)}
                                                            </p>
                                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Date total */}
                                            <div className="p-2 bg-amber-50 border-t flex justify-between text-sm">
                                                <span className="font-medium">Total {new Date(dateKey).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>
                                                <span className="font-bold text-amber-600">
                                                    {formatCurrency(grouped[dateKey].reduce((sum, n) => sum + n.grandTotal, 0))}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </CardContent>
                    </Card>
                )}

                {/* Monthly Summary */}
                {purchaseHistory.length > 0 && (() => {
                    const now = new Date();
                    const currentMonth = now.getMonth();
                    const currentYear = now.getFullYear();

                    const thisMonthNotes = purchaseHistory.filter(note => {
                        const noteDate = new Date(note.date);
                        return noteDate.getMonth() === currentMonth && noteDate.getFullYear() === currentYear;
                    });

                    const thisMonthTotal = thisMonthNotes.reduce((sum, n) => sum + n.grandTotal, 0);
                    const thisMonthCount = thisMonthNotes.length;

                    const monthName = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

                    return (
                        <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                            <CardContent className="py-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-blue-100">Total Belanja {monthName}</p>
                                        <p className="text-2xl font-bold">{formatCurrency(thisMonthTotal)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-blue-100">Jumlah Nota</p>
                                        <p className="text-2xl font-bold">{thisMonthCount}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })()}
            </div>

            {/* Confirm Dialog */}
            <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Konfirmasi Nota Belanja</DialogTitle>
                        <DialogDescription>Pastikan data sudah benar</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="bg-amber-50 p-4 rounded-lg">
                            <p className="text-sm text-amber-800">⚠️ Tindakan ini akan:</p>
                            <ul className="text-sm text-amber-700 mt-2 space-y-1">
                                <li>• Menambah stok {items.reduce((s, i) => s + i.quantity, 0)} unit dari {items.length} produk</li>
                                <li>• Memperbarui harga modal produk</li>
                            </ul>
                        </div>

                        <div className="border rounded-lg p-3">
                            <p className="text-sm text-muted-foreground">Tanggal Nota:</p>
                            <p className="font-medium">{new Date(noteDate).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                        </div>

                        <div className="border rounded-lg p-3">
                            <p className="text-sm text-muted-foreground">Grand Total:</p>
                            <p className="font-bold text-xl text-amber-600">
                                {formatCurrency(grandTotal)}
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="flex-col gap-2">
                        <Button
                            onClick={processPurchase}
                            className="w-full bg-green-600 hover:bg-green-700"
                        >
                            ✓ Konfirmasi & Proses
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => setShowConfirmDialog(false)}
                        >
                            Batal
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Success Dialog */}
            <Dialog
                open={showSuccessDialog}
                onOpenChange={setShowSuccessDialog}
            >
                <DialogContent className="sm:max-w-sm">
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle className="h-10 w-10 text-green-600" />
                        </div>
                        <h3 className="text-xl font-bold text-center mb-2">
                            Nota Berhasil Diproses!
                        </h3>
                        <p className="text-sm text-muted-foreground text-center">
                            Stok dan harga modal telah diperbarui
                        </p>
                    </div>
                    <DialogFooter>
                        <Button
                            className="w-full bg-green-600 hover:bg-green-700"
                            onClick={() => setShowSuccessDialog(false)}
                        >
                            OK
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Note Detail Dialog */}
            <Dialog open={showNoteDetail} onOpenChange={setShowNoteDetail}>
                <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Detail Nota Belanja
                        </DialogTitle>
                        {selectedNote && (
                            <DialogDescription>
                                {new Date(selectedNote.date).toLocaleDateString("id-ID", {
                                    weekday: "long",
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric"
                                })}
                            </DialogDescription>
                        )}
                    </DialogHeader>

                    {selectedNote && (
                        <div className="space-y-3">
                            {/* Items list */}
                            <div className="border rounded-lg overflow-hidden">
                                <div className="p-2 bg-gray-50 text-xs font-semibold text-gray-500 grid grid-cols-12 gap-1">
                                    <div className="col-span-5">Barang</div>
                                    <div className="col-span-3 text-center">Qty × Harga</div>
                                    <div className="col-span-4 text-right">Total</div>
                                </div>
                                <div className="divide-y">
                                    {selectedNote.items.map((item, idx) => (
                                        <div key={idx} className="p-2 bg-white text-xs grid grid-cols-12 gap-1 items-center">
                                            <div className="col-span-5">
                                                <p className="font-mono text-muted-foreground">{item.sku}</p>
                                                <p className="truncate font-medium">{item.name}</p>
                                            </div>
                                            <div className="col-span-3 text-center text-muted-foreground">
                                                {item.quantity} × {formatCurrency(item.unitPrice)}
                                            </div>
                                            <div className="col-span-4 text-right font-medium text-amber-600">
                                                {formatCurrency(item.totalPrice)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Grand Total */}
                            <div className="bg-amber-50 p-4 rounded-lg flex justify-between items-center">
                                <span className="font-semibold text-lg">GRAND TOTAL</span>
                                <span className="font-bold text-xl text-amber-600">
                                    {formatCurrency(selectedNote.grandTotal)}
                                </span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            className="w-full"
                            variant="outline"
                            onClick={() => setShowNoteDetail(false)}
                        >
                            Tutup
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default PurchaseInput;
