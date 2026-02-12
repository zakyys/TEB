import React, { useState, useEffect } from "react";
import { getFromLS, LS_KEYS, formatCurrency, saveToLS } from "@/lib/utils";
import { getProducts as getCachedProducts, setProducts as setCachedProducts } from "@/lib/productCache";
import { ArrowLeft, TrendingUp, Edit2, Check, X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface Product {
    id: string;
    name: string;
    category: string;
    price: number;
    purchasePrice: number;
    stock: number;
    sku: string;
    type: string;
    threshold?: number;
}

const ProfitAnalysis = ({ onBack }: { onBack: () => void }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedMarginRange, setSelectedMarginRange] = useState<string>("<10");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editModal, setEditModal] = useState(0);
    const [editJual, setEditJual] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 100;

    useEffect(() => {
        const storedProducts = getCachedProducts() as Product[];
        setProducts(storedProducts);
    }, []);

    // Save edited product
    const handleSaveEdit = (productId: string) => {
        const updatedProducts = products.map(p =>
            p.id === productId
                ? { ...p, purchasePrice: editModal, price: editJual }
                : p
        );
        setProducts(updatedProducts);
        setCachedProducts(updatedProducts);

        // Dispatch event for other components
        window.dispatchEvent(new Event('products-updated'));

        setEditingId(null);
    };

    // Start editing
    const handleEdit = (product: Product) => {
        setEditingId(product.id);
        setEditModal(product.purchasePrice);
        setEditJual(product.price);
    };

    // Search helper functions (same as ProductManagement)
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
        const sNorm = normalize(sku);
        const sColl = collapseLeadingZeros(sNorm);
        const nNorm = normalize(name);

        let score = 0;
        if (sColl === qColl) score += 1000;
        if (sNorm === qNorm) score += 900;
        if (sColl.startsWith(qColl)) score += 800;
        if (sNorm.startsWith(qNorm)) score += 700;
        if (sColl.includes(qColl)) score += 600;
        if (sNorm.includes(qNorm)) score += 500;
        if (nNorm.includes(qNorm)) score += 100;

        return score;
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

    const getBgColor = (margin: number): string => {
        if (!isFinite(margin) || isNaN(margin)) return "bg-gray-50";
        if (margin < 10) return "bg-red-50";
        if (margin < 20) return "bg-orange-50";
        if (margin < 30) return "bg-yellow-50";
        if (margin < 50) return "bg-blue-50";
        if (margin < 100) return "bg-green-50";
        return "bg-emerald-50";
    };

    // Filter products
    const filteredProducts = products
        .filter((product) => {
            // Only show products with purchase price
            if (!product.purchasePrice || product.purchasePrice === 0) return false;
            if (!product.price || product.price === 0) return false;

            // Search filter (bypass margin filter when searching)
            if (searchQuery) {
                return matchesLoose(product.sku, searchQuery) || matchesLoose(product.name, searchQuery);
            }

            // Margin range filter (only apply when NOT searching)
            const margin = getProfitMargin(product);

            if (selectedMarginRange === "<10") return margin < 10;
            if (selectedMarginRange === "<20") return margin < 20;
            if (selectedMarginRange === "<30") return margin < 30;
            if (selectedMarginRange === "<40") return margin < 40;
            if (selectedMarginRange === "<50") return margin < 50;
            if (selectedMarginRange === "<60") return margin < 60;
            if (selectedMarginRange === "<70") return margin < 70;
            if (selectedMarginRange === "<80") return margin < 80;
            if (selectedMarginRange === "<90") return margin < 90;
            if (selectedMarginRange === "<100") return margin < 100;

            return true;
        })
        .sort((a, b) => {
            // When searching, prioritize relevance
            if (searchQuery) {
                const diff = relevanceScore(b, searchQuery) - relevanceScore(a, searchQuery);
                if (diff !== 0) return diff;
            }
            // Otherwise sort by margin descending
            return getProfitMargin(b) - getProfitMargin(a);
        });

    // Pagination
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    // Reset to page 1 when filter or search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedMarginRange, searchQuery]);

    return (
        <div className="bg-background min-h-screen pb-20">
            <div className="p-4">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <TrendingUp className="h-6 w-6 text-green-600" />
                            Analisa Keuntungan
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Daftar produk berdasarkan persentase keuntungan
                        </p>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="text"
                        placeholder="Cari kode atau nama produk..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 h-12 text-base"
                    />
                </div>

                {/* Filter Margin */}
                <div className="mb-4">
                    <Label className="text-sm font-medium mb-2 block">💰 Filter Keuntungan (Gross Margin):</Label>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {[
                            { value: "<10", label: "<10%", color: "bg-red-100 hover:bg-red-200 text-red-700" },
                            { value: "<20", label: "<20%", color: "bg-orange-100 hover:bg-orange-200 text-orange-700" },
                            { value: "<30", label: "<30%", color: "bg-yellow-100 hover:bg-yellow-200 text-yellow-700" },
                            { value: "<40", label: "<40%", color: "bg-lime-100 hover:bg-lime-200 text-lime-700" },
                            { value: "<50", label: "<50%", color: "bg-green-100 hover:bg-green-200 text-green-700" },
                            { value: "<60", label: "<60%", color: "bg-teal-100 hover:bg-teal-200 text-teal-700" },
                            { value: "<70", label: "<70%", color: "bg-cyan-100 hover:bg-cyan-200 text-cyan-700" },
                            { value: "<80", label: "<80%", color: "bg-blue-100 hover:bg-blue-200 text-blue-700" },
                            { value: "<90", label: "<90%", color: "bg-indigo-100 hover:bg-indigo-200 text-indigo-700" },
                            { value: "<100", label: "<100%", color: "bg-purple-100 hover:bg-purple-200 text-purple-700 font-bold" },
                        ].map((range) => (
                            <Button
                                key={range.value}
                                size="sm"
                                variant={selectedMarginRange === range.value ? "default" : "outline"}
                                className={`flex-shrink-0 ${selectedMarginRange === range.value ? '' : range.color}`}
                                onClick={() => setSelectedMarginRange(range.value)}
                            >
                                {range.label}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Stats Summary */}
                <Card className="mb-4">
                    <CardContent className="p-4">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-2xl font-bold text-green-600">{filteredProducts.length}</p>
                                <p className="text-xs text-muted-foreground">Total Produk</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-blue-600">
                                    {filteredProducts.length > 0
                                        ? (filteredProducts.reduce((sum, p) => sum + getProfitMargin(p), 0) / filteredProducts.length).toFixed(0)
                                        : 0}%
                                </p>
                                <p className="text-xs text-muted-foreground">Rata-rata</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-600">
                                    {filteredProducts.length > 0 ? getProfitMargin(filteredProducts[0]).toFixed(0) : 0}%
                                </p>
                                <p className="text-xs text-muted-foreground">Tertinggi</p>
                            </div>
                        </div>
                        {totalPages > 1 && (
                            <div className="mt-3 text-center text-sm text-muted-foreground">
                                Menampilkan {startIndex + 1}-{Math.min(endIndex, filteredProducts.length)} dari {filteredProducts.length} produk
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Product List */}
                <div className="space-y-2">
                    {paginatedProducts.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {filteredProducts.length === 0
                                ? "Tidak ada produk dengan filter ini"
                                : "Tidak ada produk di halaman ini"}
                        </div>
                    ) : (
                        paginatedProducts.map((product) => {
                            const margin = getProfitMargin(product);
                            return (
                                <Card key={product.id} className={`${getBgColor(margin)} border-l-4 ${getMarginColor(margin).replace('text-', 'border-')}`}>
                                    <CardContent className="p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-mono text-sm font-semibold text-gray-700">{product.sku}</span>
                                                    <span className="px-2 py-0.5 bg-white rounded text-xs">{product.category}</span>

                                                    {/* Edit Button */}
                                                    {editingId !== product.id && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 w-6 p-0 ml-auto"
                                                            onClick={() => handleEdit(product)}
                                                        >
                                                            <Edit2 className="h-3 w-3" />
                                                        </Button>
                                                    )}
                                                </div>
                                                <h3 className="font-medium text-sm mb-2">{product.name}</h3>

                                                {editingId === product.id ? (
                                                    // Edit Mode
                                                    <div className="space-y-2">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <Label className="text-xs text-muted-foreground">Modal</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={editModal}
                                                                    onChange={(e) => setEditModal(Number(e.target.value))}
                                                                    className="h-8 text-sm"
                                                                />
                                                            </div>
                                                            <div>
                                                                <Label className="text-xs text-muted-foreground">Jual</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={editJual}
                                                                    onChange={(e) => setEditJual(Number(e.target.value))}
                                                                    className="h-8 text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Button
                                                                size="sm"
                                                                className="h-7 flex-1 bg-green-600 hover:bg-green-700"
                                                                onClick={() => handleSaveEdit(product.id)}
                                                            >
                                                                <Check className="h-3 w-3 mr-1" />
                                                                Simpan
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 flex-1"
                                                                onClick={() => setEditingId(null)}
                                                            >
                                                                <X className="h-3 w-3 mr-1" />
                                                                Batal
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // View Mode
                                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                                        <div>
                                                            <p className="text-muted-foreground">Modal</p>
                                                            <p className="font-semibold text-gray-700">{formatCurrency(product.purchasePrice)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-muted-foreground">Jual</p>
                                                            <p className="font-semibold text-amber-600">{formatCurrency(product.price)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-muted-foreground">Untung</p>
                                                            <p className="font-semibold text-green-600">{formatCurrency(product.price - product.purchasePrice)}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <div className={`text-3xl font-bold ${getMarginColor(margin)}`}>
                                                    {margin.toFixed(0)}%
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">Margin</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>

                        <div className="flex items-center gap-2">
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum;
                                if (totalPages <= 5) {
                                    pageNum = i + 1;
                                } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                } else {
                                    pageNum = currentPage - 2 + i;
                                }

                                return (
                                    <Button
                                        key={pageNum}
                                        variant={currentPage === pageNum ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCurrentPage(pageNum)}
                                        className="w-10"
                                    >
                                        {pageNum}
                                    </Button>
                                );
                            })}
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProfitAnalysis;
