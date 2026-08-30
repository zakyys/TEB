import { Suspense, useEffect, useRef, useState } from "react";
import { useRoutes, Routes, Route } from "react-router-dom";
import Home from "./components/home";
import POSScreen from "./components/pos/POSScreen";
import ProductManagement from "./components/products/ProductManagement";
import TransactionHistory from "./components/transactions/TransactionHistory";
import ProfilePage from "./components/profile/ProfilePage";
import BottomNavBar from "./components/layout/BottomNavBar";
import routes from "tempo-routes";
import CartScreen from "@/components/pos/CartScreen";
import ExchangePage from "@/components/exchange/ExchangePage";
import PurchaseInput from "@/components/purchase/PurchaseInput";
import { Toaster } from "@/components/ui/toaster";
import { PWAStatus } from "@/components/layout/PWAStatus";
import { getStoreName } from "@/lib/utils";
import { initProductCache, flushProductCache, getProducts, initProductSync, initStockSync } from "@/lib/productCache";


// SplashScreen component
function SplashScreen() {
  const storeName = getStoreName();
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #fff7ed 100%)",
        zIndex: 9999
      }}
    >
      {/* Abstract Pattern Overlay - Orange tinted */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f97316' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Bolt and Nut SVG Logo - Orange theme */}
      <svg
        className="w-20 h-20 mb-5 animate-pulse"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Hexagonal Nut */}
        <path
          d="M50 5L87 27.5V72.5L50 95L13 72.5V27.5L50 5Z"
          fill="#fed7aa"
          stroke="#f97316"
          strokeWidth="3"
        />
        <circle cx="50" cy="50" r="18" fill="#ffffff" stroke="#f97316" strokeWidth="2" />
        {/* Center Hole */}
        <circle cx="50" cy="50" r="8" fill="#f97316" />
        {/* Cross Pattern */}
        <line x1="42" y1="50" x2="58" y2="50" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <line x1="50" y1="42" x2="50" y2="58" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
      </svg>

      {/* Store Name */}
      <span
        className="text-2xl font-bold text-orange-600 mb-1 text-center px-4 z-10"
        style={{ letterSpacing: "2px" }}
      >
        {storeName}
      </span>

      {/* Loading Text */}
      <span className="text-xs text-orange-400 z-10">Memuat aplikasi...</span>
    </div>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [storeName, setStoreName] = useState(getStoreName());
  const [backgroundSync, setBackgroundSync] = useState<{
    kind: 'product' | 'stock';
    status: 'pending' | 'syncing' | 'success' | 'error';
    pending: number;
    message: string;
  } | null>(null);
  const backgroundSyncHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update document title when store name changes
  useEffect(() => {
    document.title = `${storeName} - Aplikasi Kasir`;
  }, [storeName]);

  // Listen for storage changes (when store name is updated in settings)
  useEffect(() => {
    const handleStorageChange = () => {
      setStoreName(getStoreName());
    };

    // Listen for custom event when profile is saved
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("profileUpdated", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("profileUpdated", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    const handleBackgroundSync = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail) return;
      setBackgroundSync(detail);
      if (backgroundSyncHideTimer.current) clearTimeout(backgroundSyncHideTimer.current);
      if (detail.status === 'success') {
        backgroundSyncHideTimer.current = setTimeout(() => setBackgroundSync(null), 800);
      }
    };
    window.addEventListener('pos:background-sync', handleBackgroundSync);
    return () => {
      if (backgroundSyncHideTimer.current) clearTimeout(backgroundSyncHideTimer.current);
      window.removeEventListener('pos:background-sync', handleBackgroundSync);
    };
  }, []);

  useEffect(() => {
    // Initialize product cache during splash screen
    // By the time splash ends, products are loaded in memory
    initProductCache().then(() => {
      console.log('[App] Product cache initialized');
      // Initialize background product and stock sync after products are loaded
      initProductSync();
      initStockSync();
    }).catch(err => {
      console.error('[App] Product cache init failed:', err);
    });

    const timer = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Flush product cache before browser closes
  // beforeunload does NOT wait for async operations, so we:
  // 1. Fire the async IndexedDB write (best-effort)
  // 2. Synchronously write to localStorage as a guaranteed fallback
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best-effort async IndexedDB write (may not complete)
      flushProductCache();

      // Synchronous localStorage fallback — guaranteed to persist.
      // Keep [] too, because an intentional delete-all is valid state.
      try {
        const currentProducts = getProducts();
        localStorage.setItem('PRODUCTS', JSON.stringify(currentProducts || []));
      } catch (e) {
        console.error('[App] Sync flush fallback failed:', e);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  if (showSplash) {
    return <SplashScreen />;
  }

  return (
    <Suspense fallback={<p>Loading...</p>}>
      <>
        {backgroundSync && (
          <div
            className={`fixed top-2 left-1/2 z-[10000] -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-medium shadow-md transition-opacity ${
              backgroundSync.status === 'error'
                ? 'bg-red-50 text-red-700 border border-red-200'
                : backgroundSync.status === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}
            role="status"
            aria-live="polite"
          >
            {backgroundSync.status === 'syncing' ? '↻ ' : backgroundSync.status === 'success' ? '✓ ' : backgroundSync.status === 'error' ? '⚠ ' : '⏳ '}
            {backgroundSync.message}
          </div>
        )}
        <div className="pb-16">
          {" "}
          {/* Add padding to prevent content from being hidden behind the bottom nav */}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pos" element={<POSScreen />} />
            <Route path="/products" element={<ProductManagement />} />
            <Route path="/history" element={<TransactionHistory />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/exchange" element={<ExchangePage />} />
            <Route path="/purchase" element={<PurchaseInput />} />
            <Route path="/pos/cart" element={<CartScreen />} />
          </Routes>
          {import.meta.env.VITE_TEMPO === "true" && useRoutes(routes)}
        </div>
        <BottomNavBar />
        <PWAStatus />
        <Toaster />
      </>

    </Suspense>
  );
}

export default App;
