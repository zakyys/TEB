import React, { useState, useEffect, useMemo } from "react";
import { safeGetAllTransactions } from "@/lib/indexedDB";
import { formatCurrency } from "@/lib/utils";
import {
  Trophy,
  RefreshCw,
  PackageSearch,
  CalendarDays,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Nama bulan Indonesia (lowercase, sesuai format label periode)
const MONTHS_ID = [
  "januari", "februari", "maret", "april", "mei", "juni",
  "juli", "agustus", "september", "oktober", "november", "desember",
];

const formatDateId = (d: Date, withYear: boolean) =>
  `${d.getDate()} ${MONTHS_ID[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;

// Deteksi kata screw/sekrup/skrup/ring sebagai kata utuh (bukan potongan kata lain)
const SCREW_RING_RE = /\b(screw|sekrup|skrup|ring)\b/i;
const isScrewOrRing = (name: string) => SCREW_RING_RE.test(name || "");

interface AggItem {
  key: string;
  name: string;
  sku: string;
  qty: number;
  revenue: number;
}

interface BestSellersProps {
  className?: string;
}

const BestSellers = ({ className = "" }: BestSellersProps) => {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodMonths, setPeriodMonths] = useState<1 | 2 | 3>(1);
  const [excludeScrewRing, setExcludeScrewRing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const stored = await safeGetAllTransactions();
      setTransactions(Array.isArray(stored) ? stored : []);
      setNow(new Date());
    } catch (e) {
      console.error("Gagal memuat transaksi:", e);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  // Rentang periode: mulai dari tanggal 1, (N-1) bulan ke belakang sampai hari ini.
  // Contoh: sekarang 21 september + periode 2 bulan -> mulai 1 agustus.
  const { rangeStart, periodLabel } = useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth() - (periodMonths - 1), 1);
    const withYear = start.getFullYear() !== now.getFullYear();
    return {
      rangeStart: start,
      periodLabel: `${formatDateId(start, withYear)} - ${formatDateId(now, withYear)}`,
    };
  }, [now, periodMonths]);

  // Agregasi item terjual dari transaksi selesai dalam periode
  const { ranked, txCount } = useMemo(() => {
    const map = new Map<string, AggItem>();
    let count = 0;
    transactions.forEach((t) => {
      if (t?.status !== "completed") return;
      // Lewati transaksi penyesuaian selisih tukar barang (ADJ-) — bukan penjualan produk.
      const isExchangeAdjustment =
        String(t?.customer || "") === "Tukar Barang" ||
        String(t?.id || "").startsWith("ADJ-");
      if (isExchangeAdjustment) return;
      const d = new Date(t.date);
      if (isNaN(d.getTime()) || d < rangeStart || d > now) return;
      count++;
      (t.items || []).forEach((item: any) => {
        // Lewati item yang sudah di-refund (konsisten dengan laporan harian di home).
        if (item?.sameDayRefunded || item?.refunded) return;
        const name = String(item?.name || "(tanpa nama)");
        if (excludeScrewRing && isScrewOrRing(name)) return;
        const qty = Number(item?.quantity) || 0;
        const price = Number(item?.price) || 0;
        const key = String(item?.sku || name).trim().toUpperCase();
        const prev = map.get(key);
        if (prev) {
          prev.qty += qty;
          prev.revenue += qty * price;
        } else {
          map.set(key, { key, name, sku: String(item?.sku || ""), qty, revenue: qty * price });
        }
      });
    });
    const list = Array.from(map.values()).sort(
      (a, b) => b.qty - a.qty || b.revenue - a.revenue
    );
    return { ranked: list, txCount: count };
  }, [transactions, rangeStart, now, excludeScrewRing]);

  const MAX_SHOW = 100;
  const visible = ranked.slice(0, MAX_SHOW);

  const getRankStyle = (rank: number) => {
    if (rank === 1) return "bg-amber-400 text-white shadow-amber-300/50";
    if (rank === 2) return "bg-gray-300 text-gray-700 shadow-gray-200/50";
    if (rank === 3) return "bg-orange-300 text-orange-900 shadow-orange-200/50";
    return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  };

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Barang Paling Banyak Terjual
          </h1>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
            <CalendarDays className="h-3 w-3" />
            Periode: {periodLabel}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 flex-shrink-0"
          onClick={loadTransactions}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filter Periode */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-full p-1 mb-2">
        {([1, 2, 3] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPeriodMonths(m)}
            className={`flex-1 py-2 rounded-full text-xs font-bold transition-all ${
              periodMonths === m
                ? "bg-amber-500 text-white shadow"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {m} Bulan
          </button>
        ))}
      </div>

      {/* Filter Kategori Nama */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 no-scrollbar">
        <button
          onClick={() => setExcludeScrewRing(false)}
          className={`px-4 py-2 rounded-full text-xs font-extrabold transition-all whitespace-nowrap shadow-sm border ${
            !excludeScrewRing
              ? "bg-gray-600 text-white border-gray-600"
              : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 dark:bg-gray-900 dark:border-gray-700"
          }`}
        >
          Semua
        </button>
        <button
          onClick={() => setExcludeScrewRing(true)}
          className={`px-4 py-2 rounded-full text-xs font-extrabold transition-all whitespace-nowrap shadow-sm border ${
            excludeScrewRing
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 dark:bg-gray-900 dark:border-gray-700"
          }`}
        >
          Tanpa Screw/Ring
        </button>
      </div>

      {/* Ringkasan kecil */}
      <p className="text-[11px] text-muted-foreground mb-3">
        {ranked.length} barang • {txCount} transaksi selesai
      </p>

      {/* Isi */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-3 text-amber-500" />
          <p className="text-sm">Memuat data penjualan...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <PackageSearch className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-sm font-semibold text-gray-400 dark:text-gray-500">
            Belum ada penjualan di periode ini
          </p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
            Coba pilih periode lain atau ubah filter
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item, idx) => {
            const rank = idx + 1;
            return (
              <div
                key={item.key}
                className="flex items-center gap-3 bg-card border rounded-xl p-3"
              >
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 shadow-sm ${getRankStyle(rank)}`}
                >
                  {rank}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{item.name}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {item.sku ? `${item.sku} • ` : ""}
                    Omzet {formatCurrency(item.revenue)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-sm text-amber-600">{item.qty}x</p>
                  <p className="text-[10px] text-muted-foreground">terjual</p>
                </div>
              </div>
            );
          })}
          {ranked.length > MAX_SHOW && (
            <p className="text-center text-[11px] text-muted-foreground py-2">
              +{ranked.length - MAX_SHOW} barang lainnya tidak ditampilkan
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default BestSellers;
