import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, ArrowLeftRight, Trash2, Calendar, Package } from "lucide-react";
import { formatCurrency, getFromLS, LS_KEYS } from "@/lib/utils";
import {
    getExchanges,
    addExchange,
    deleteExchange,
    getExchangesToday,
    getExchangesThisWeek,
    getExchangesThisMonth,
    ExchangeRecord,
    ExchangeItem
} from "@/lib/exchange";

interface Transaction {
    id: string;
    date: string;
    customer: string;
    total: number;
    status: string;
    items: {
        name: string;
        quantity: number;
        price: number;
        sku?: string;
    }[];
}

interface Product {
    id: string;
    name: string;
    price: number;
    sku?: string;
    stock?: number;
}

const ExchangePage = () => {
    const [searchCode, setSearchCode] = useState("");
    const [searchResults, setSearchResults] = useState<{ transaction: Transaction, item: Transaction['items'][0], itemIndex: number }[]>([]);
    const [exchanges, setExchanges] = useState<ExchangeRecord[]>([]);
    const [filter, setFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

    // Exchange dialog state
    const [exchangeDialogOpen, setExchangeDialogOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<{ transaction: Transaction, item: Transaction['items'][0] } | null>(null);
    const [newItemSearch, setNewItemSearch] = useState("");
    const [newItemResults, setNewItemResults] = useState<Product[]>([]);
    const [selectedNewItem, setSelectedNewItem] = useState<Product | null>(null);
    const [exchangeQty, setExchangeQty] = useState(1);
    const [exchangeNotes, setExchangeNotes] = useState("");

    // Load exchanges
    useEffect(() => {
        loadExchanges();
    }, [filter]);

    const loadExchanges = () => {
        let data: ExchangeRecord[];
        switch (filter) {
            case 'today':
                data = getExchangesToday();
                break;
            case 'week':
                data = getExchangesThisWeek();
                break;
            case 'month':
                data = getExchangesThisMonth();
                break;
            default:
                data = getExchanges();
        }
        setExchanges(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    };

    // Search transactions by SKU/code
    const handleSearch = () => {
        if (!searchCode.trim()) {
            setSearchResults([]);
            return;
        }

        const transactions = getFromLS<Transaction[]>(LS_KEYS.TRANSACTIONS, []);
        const results: { transaction: Transaction, item: Transaction['items'][0], itemIndex: number }[] = [];

        transactions.forEach(t => {
            if (t.status === 'completed') {
                t.items.forEach((item, idx) => {
                    if (item.sku?.toLowerCase().includes(searchCode.toLowerCase()) ||
                        item.name?.toLowerCase().includes(searchCode.toLowerCase())) {
                        results.push({ transaction: t, item, itemIndex: idx });
                    }
                });
            }
        });

        // Sort by date descending
        results.sort((a, b) => new Date(b.transaction.date).getTime() - new Date(a.transaction.date).getTime());
        setSearchResults(results.slice(0, 20)); // Limit to 20 results
    };

    // Search products for new item
    const handleNewItemSearch = (query: string) => {
        setNewItemSearch(query);
        if (!query.trim()) {
            setNewItemResults([]);
            return;
        }

        const products = getFromLS<Product[]>(LS_KEYS.PRODUCTS, []);
        const results = products.filter(p =>
            p.sku?.toLowerCase().includes(query.toLowerCase()) ||
            p.name?.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 10);
        setNewItemResults(results);
    };

    // Open exchange dialog
    const openExchangeDialog = (transaction: Transaction, item: Transaction['items'][0]) => {
        setSelectedItem({ transaction, item });
        setExchangeQty(item.quantity);
        setSelectedNewItem(null);
        setNewItemSearch("");
        setNewItemResults([]);
        setExchangeNotes("");
        setExchangeDialogOpen(true);
    };

    // Process exchange
    const processExchange = () => {
        if (!selectedItem || !selectedNewItem) return;

        const originalItem: ExchangeItem = {
            sku: selectedItem.item.sku || '-',
            name: selectedItem.item.name,
            quantity: exchangeQty,
            price: selectedItem.item.price
        };

        const newItem: ExchangeItem = {
            sku: selectedNewItem.sku || '-',
            name: selectedNewItem.name,
            quantity: exchangeQty,
            price: selectedNewItem.price
        };

        const priceDiff = (newItem.price * newItem.quantity) - (originalItem.price * originalItem.quantity);

        const exchangeRecord = addExchange({
            date: new Date().toISOString(),
            originalItem,
            newItem,
            priceDifference: priceDiff,
            notes: exchangeNotes,
            originalTransactionId: selectedItem.transaction.id,
            originalPurchaseDate: selectedItem.transaction.date
        });

        // Update stock (return original, deduct new)
        const products = getFromLS<Product[]>(LS_KEYS.PRODUCTS, []);
        const updatedProducts = products.map(p => {
            if (p.sku === originalItem.sku && p.stock !== undefined) {
                return { ...p, stock: p.stock + exchangeQty };
            }
            if (p.sku === newItem.sku && p.stock !== undefined) {
                return { ...p, stock: p.stock - exchangeQty };
            }
            return p;
        });
        localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(updatedProducts));

        // Create adjustment transaction if there's a price difference
        if (priceDiff !== 0) {
            const transactions = getFromLS<Transaction[]>(LS_KEYS.TRANSACTIONS, []);
            const adjustmentTransaction: Transaction = {
                id: `ADJ-${Date.now().toString().substring(6)}`,
                date: new Date().toISOString(),
                customer: 'Tukar Barang',
                total: priceDiff, // positive = additional payment, negative = refund
                status: 'completed',
                items: [{
                    name: priceDiff > 0
                        ? `Selisih tukar: ${originalItem.name} → ${newItem.name}`
                        : `Kembalian tukar: ${originalItem.name} → ${newItem.name}`,
                    quantity: 1,
                    price: priceDiff,
                    sku: exchangeRecord.id
                }]
            };
            transactions.push(adjustmentTransaction);
            localStorage.setItem(LS_KEYS.TRANSACTIONS, JSON.stringify(transactions));
        }

        setExchangeDialogOpen(false);
        setSearchResults([]);
        setSearchCode("");
        loadExchanges();

        let message = 'Tukar berhasil!';
        if (priceDiff > 0) {
            message += `\n\n💰 Tambah bayar: ${formatCurrency(priceDiff)}\n(Ditambahkan ke penjualan hari ini)`;
        } else if (priceDiff < 0) {
            message += `\n\n💸 Kembalian: ${formatCurrency(Math.abs(priceDiff))}\n(Dikurangi dari penjualan hari ini)`;
        } else {
            message += '\n\nHarga sama, tidak ada selisih.';
        }
        alert(message);
    };

    // Delete exchange record
    const handleDeleteExchange = (id: string) => {
        if (confirm('Hapus catatan tukar ini?')) {
            deleteExchange(id);
            loadExchanges();
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-background">
            <main className="flex-1 p-4 pb-20">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ArrowLeftRight className="h-6 w-6" />
                        Tukar Barang
                    </h1>
                    <p className="text-muted-foreground">Cari dan tukar barang dari transaksi sebelumnya</p>
                </div>

                {/* Search Section */}
                <Card className="mb-6">
                    <CardContent className="p-4">
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Cari kode/nama barang yang mau ditukar..."
                                    className="pl-10"
                                    value={searchCode}
                                    onChange={(e) => setSearchCode(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                            <Button onClick={handleSearch} className="bg-amber-500 hover:bg-amber-600">
                                Cari
                            </Button>
                        </div>

                        {/* Search Results */}
                        {searchResults.length > 0 && (
                            <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                                <p className="text-sm text-muted-foreground">Ditemukan {searchResults.length} item:</p>
                                {searchResults.map((result, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                                        <div className="flex-1">
                                            <div className="font-medium text-sm">{result.item.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                Kode: {result.item.sku || '-'} • {result.item.quantity}x{formatCurrency(result.item.price)} = {formatCurrency(result.item.quantity * result.item.price)}
                                            </div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(result.transaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                <span className="ml-2">• ID: {result.transaction.id}</span>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            className="bg-purple-500 hover:bg-purple-600"
                                            onClick={() => openExchangeDialog(result.transaction, result.item)}
                                        >
                                            <ArrowLeftRight className="h-4 w-4 mr-1" />
                                            Tukar
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Exchange History */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex items-center justify-between">
                            <span>Riwayat Tukar Barang</span>
                            <div className="flex gap-1">
                                {(['all', 'today', 'week', 'month'] as const).map(f => (
                                    <Button
                                        key={f}
                                        size="sm"
                                        variant={filter === f ? 'default' : 'outline'}
                                        onClick={() => setFilter(f)}
                                        className="text-xs h-7"
                                    >
                                        {f === 'all' ? 'Semua' : f === 'today' ? 'Hari Ini' : f === 'week' ? 'Minggu' : 'Bulan'}
                                    </Button>
                                ))}
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {exchanges.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                Belum ada data tukar barang
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {exchanges.map(ex => (
                                    <div key={ex.id} className="p-3 border rounded-lg">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="text-xs text-muted-foreground mb-1">
                                                    {new Date(ex.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    <span className="ml-2">• {ex.id}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <div className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs">
                                                        <div className="font-medium">{ex.originalItem.name}</div>
                                                        <div>{ex.originalItem.sku} • {ex.originalItem.quantity}x{formatCurrency(ex.originalItem.price)}</div>
                                                    </div>
                                                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                                                    <div className="bg-green-50 text-green-700 px-2 py-1 rounded text-xs">
                                                        <div className="font-medium">{ex.newItem.name}</div>
                                                        <div>{ex.newItem.sku} • {ex.newItem.quantity}x{formatCurrency(ex.newItem.price)}</div>
                                                    </div>
                                                </div>
                                                {ex.priceDifference !== 0 && (
                                                    <div className={`text-xs mt-1 ${ex.priceDifference > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                                        Selisih: {formatCurrency(Math.abs(ex.priceDifference))} {ex.priceDifference > 0 ? '(Tambah bayar)' : '(Kembalian)'}
                                                    </div>
                                                )}
                                                {ex.notes && <div className="text-xs text-muted-foreground mt-1">Catatan: {ex.notes}</div>}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive h-8 w-8 p-0"
                                                onClick={() => handleDeleteExchange(ex.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </main>

            {/* Exchange Dialog */}
            <Dialog open={exchangeDialogOpen} onOpenChange={setExchangeDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Tukar Barang</DialogTitle>
                    </DialogHeader>

                    {selectedItem && (
                        <div className="space-y-4">
                            {/* Original Item */}
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Barang Lama:</label>
                                <div className="mt-1 p-3 bg-red-50 rounded-lg">
                                    <div className="font-medium">{selectedItem.item.name}</div>
                                    <div className="text-sm text-muted-foreground">
                                        Kode: {selectedItem.item.sku || '-'} • Harga: {formatCurrency(selectedItem.item.price)}
                                    </div>
                                </div>
                            </div>

                            {/* Quantity */}
                            <div>
                                <label className="text-sm font-medium">Jumlah yang ditukar:</label>
                                <Input
                                    type="number"
                                    min="1"
                                    max={selectedItem.item.quantity}
                                    value={exchangeQty}
                                    onChange={(e) => setExchangeQty(Math.min(selectedItem.item.quantity, parseInt(e.target.value) || 1))}
                                    className="mt-1"
                                />
                            </div>

                            {/* Search New Item */}
                            <div>
                                <label className="text-sm font-medium">Cari barang pengganti:</label>
                                <Input
                                    placeholder="Ketik kode atau nama barang..."
                                    value={newItemSearch}
                                    onChange={(e) => handleNewItemSearch(e.target.value)}
                                    className="mt-1"
                                />
                                {newItemResults.length > 0 && (
                                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                                        {newItemResults.map(p => (
                                            <div
                                                key={p.id}
                                                className={`p-2 rounded cursor-pointer text-sm ${selectedNewItem?.id === p.id ? 'bg-green-100 border-green-500 border' : 'bg-muted hover:bg-muted/80'}`}
                                                onClick={() => setSelectedNewItem(p)}
                                            >
                                                <div className="font-medium">{p.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Kode: {p.sku || '-'} • {formatCurrency(p.price)} • Stok: {p.stock ?? '-'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Selected New Item */}
                            {selectedNewItem && (
                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">Barang Pengganti:</label>
                                    <div className="mt-1 p-3 bg-green-50 rounded-lg">
                                        <div className="font-medium">{selectedNewItem.name}</div>
                                        <div className="text-sm text-muted-foreground">
                                            Kode: {selectedNewItem.sku || '-'} • Harga: {formatCurrency(selectedNewItem.price)}
                                        </div>
                                    </div>
                                    <div className="mt-2 text-sm">
                                        <span className="font-medium">Selisih harga: </span>
                                        <span className={(selectedNewItem.price - selectedItem.item.price) * exchangeQty > 0 ? 'text-amber-600' : 'text-green-600'}>
                                            {formatCurrency(Math.abs((selectedNewItem.price - selectedItem.item.price) * exchangeQty))}
                                            {(selectedNewItem.price - selectedItem.item.price) * exchangeQty > 0 ? ' (Tambah bayar)' : (selectedNewItem.price - selectedItem.item.price) * exchangeQty < 0 ? ' (Kembalian)' : ' (Sama)'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <div>
                                <label className="text-sm font-medium">Catatan (opsional):</label>
                                <Input
                                    placeholder="Alasan tukar, dll..."
                                    value={exchangeNotes}
                                    onChange={(e) => setExchangeNotes(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExchangeDialogOpen(false)}>Batal</Button>
                        <Button
                            className="bg-purple-500 hover:bg-purple-600"
                            onClick={processExchange}
                            disabled={!selectedNewItem}
                        >
                            Proses Tukar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ExchangePage;
