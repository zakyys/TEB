/**
 * Product Cache with IndexedDB backend
 * 
 * Architecture:
 * - In-memory cache for INSTANT synchronous reads (no JSON.parse!)
 * - IndexedDB for persistent storage (100MB+ capacity)
 * - localStorage as migration source and tiny fallback
 * 
 * Usage:
 *   import { getProducts, setProducts, initProductCache } from '@/lib/productCache';
 *   
 *   // On app start (once):
 *   await initProductCache();
 *   
 *   // Read (synchronous, instant):
 *   const products = getProducts();
 *   
 *   // Write (updates cache instantly, persists in background):
 *   setProducts(updatedProducts);
 */

// ============ IndexedDB for Products ============
const PRODUCT_DB_NAME = 'pos_products_db';
const PRODUCT_DB_VERSION = 1;
const PRODUCT_STORE = 'products';
const PRODUCT_BULK_KEY = '__all_products__'; // Single key for bulk storage
const PRODUCTS_LS_KEY = 'PRODUCTS';

let productDB: IDBDatabase | null = null;
let pendingProductWrite: Promise<boolean> = Promise.resolve(true);

const persistProductsToLocalStorage = (products: any[]): boolean => {
    try {
        // Keep an explicit [] snapshot so a deliberate delete-all is not
        // confused with "no snapshot" during the next app startup.
        localStorage.setItem(PRODUCTS_LS_KEY, JSON.stringify(products));
        return true;
    } catch (err) {
        console.error('[ProductCache] localStorage fallback failed:', err);
        return false;
    }
};

const openProductDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (productDB) {
            resolve(productDB);
            return;
        }

        const request = indexedDB.open(PRODUCT_DB_NAME, PRODUCT_DB_VERSION);

        request.onerror = () => {
            console.error('[ProductCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            productDB = request.result;
            resolve(productDB);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            // Simple key-value store for bulk product data
            if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
                db.createObjectStore(PRODUCT_STORE);
            }
        };
    });
};

// Read all products from IndexedDB
const readProductsFromDB = async (): Promise<any[] | null> => {
    try {
        const db = await openProductDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(PRODUCT_STORE, 'readonly');
            const store = tx.objectStore(PRODUCT_STORE);
            const request = store.get(PRODUCT_BULK_KEY);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    } catch (err) {
        console.error('[ProductCache] Failed to read from IndexedDB:', err);
        return null;
    }
};

// Write all products to IndexedDB
const writeProductsToDB = async (products: any[]): Promise<boolean> => {
    try {
        const db = await openProductDB();
        return new Promise((resolve) => {
            const tx = db.transaction(PRODUCT_STORE, 'readwrite');
            const store = tx.objectStore(PRODUCT_STORE);
            const request = store.put(products, PRODUCT_BULK_KEY);
            let requestFailed = false;

            request.onerror = () => {
                requestFailed = true;
                console.error('[ProductCache] Failed to write to IndexedDB:', request.error);
            };
            tx.oncomplete = () => resolve(!requestFailed);
            tx.onerror = () => {
                console.error('[ProductCache] IndexedDB transaction failed:', tx.error);
                resolve(false);
            };
            tx.onabort = () => {
                console.error('[ProductCache] IndexedDB transaction aborted:', tx.error);
                resolve(false);
            };
        });
    } catch (err) {
        console.error('[ProductCache] IndexedDB write failed:', err);
        return false;
    }
};

// ============ In-Memory Cache ============
let productCache: any[] | null = null;
let isInitialized = false;
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the product cache.
 * Call this ONCE on app startup (e.g., in App.tsx or main.tsx).
 * Loads products from IndexedDB, falling back to localStorage for migration.
 */
export async function initProductCache(): Promise<any[]> {
    try {
        // Try IndexedDB first
        const fromDB = await readProductsFromDB();
        // A stored empty array is valid data (for example after "Hapus Semua").
        // Do not fall back to a stale localStorage snapshot in that case.
        if (Array.isArray(fromDB)) {
            productCache = fromDB;
            isInitialized = true;
            persistProductsToLocalStorage(fromDB);
            console.log(`[ProductCache] Loaded ${fromDB.length} products from IndexedDB`);
            return productCache;
        }

        // Fallback: migrate from localStorage only when IndexedDB has no snapshot.
        const lsData = localStorage.getItem(PRODUCTS_LS_KEY);
        if (lsData) {
            try {
                const parsed = JSON.parse(lsData);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    productCache = parsed;
                    isInitialized = true;

                    // Migrate to IndexedDB in background. Keep the same snapshot
                    // in localStorage as a recovery copy.
                    writeProductsToDB(parsed).then(success => {
                        if (success) {
                            console.log(`[ProductCache] Migrated ${parsed.length} products from localStorage to IndexedDB`);
                            persistProductsToLocalStorage(parsed);
                        } else {
                            persistProductsToLocalStorage(parsed);
                        }
                    });

                    return productCache;
                }
            } catch (parseErr) {
                console.error('[ProductCache] Failed to parse localStorage:', parseErr);
            }
        }

        // No data found anywhere
        productCache = [];
        isInitialized = true;
        return productCache;
    } catch (err) {
        console.error('[ProductCache] Init failed, using empty array:', err);
        productCache = [];
        isInitialized = true;
        return productCache;
    }
}

/**
 * Get all products (SYNCHRONOUS - instant read from memory).
 * If cache hasn't been initialized yet, falls back to localStorage once.
 * This is the drop-in replacement for getFromLS(LS_KEYS.PRODUCTS, []).
 */
export function getProducts(): any[] {
    if (productCache !== null) {
        return productCache;
    }

    // First call before init completed - cold start fallback
    // This only happens if getProducts() is called before initProductCache() finishes
    try {
        const lsData = localStorage.getItem(PRODUCTS_LS_KEY);
        if (lsData) {
            productCache = JSON.parse(lsData);
            return productCache!;
        }
    } catch (err) {
        console.error('[ProductCache] Cold start localStorage fallback failed:', err);
    }

    productCache = [];
    return productCache;
}

/**
 * Set/update all products.
 * Updates the in-memory cache INSTANTLY (synchronous for callers),
 * then persists to IndexedDB in background (debounced to avoid excessive writes).
 * 
 * This is the drop-in replacement for saveToLS(LS_KEYS.PRODUCTS, products).
 */
export function setProducts(products: any[]): void {
    // Update in-memory cache immediately (synchronous)
    productCache = products;

    // Keep a synchronous recovery snapshot. This also records [] deliberately,
    // so a delete-all survives reload if IndexedDB is unavailable.
    persistProductsToLocalStorage(products);

    // Debounce the IndexedDB write (100ms) to batch rapid updates
    if (writeDebounceTimer) {
        clearTimeout(writeDebounceTimer);
    }

    writeDebounceTimer = setTimeout(() => {
        writeDebounceTimer = null;
        pendingProductWrite = writeProductsToDB(products).then(success => {
            if (!success) {
                console.error('[ProductCache] Background write failed; localStorage snapshot retained');
            }
            return success;
        }).catch(err => {
            console.error('[ProductCache] Background write failed:', err);
            return false;
        });
    }, 100);

    // Also fire the update event so POS page refreshes
    window.dispatchEvent(new CustomEvent('pos:products:update', { detail: products }));
}

/**
 * Force flush: immediately write current cache to IndexedDB.
 * Call this before app unload or important operations.
 */
export async function flushProductCache(): Promise<void> {
    if (writeDebounceTimer) {
        clearTimeout(writeDebounceTimer);
        writeDebounceTimer = null;
    }
    if (productCache) {
        persistProductsToLocalStorage(productCache);
        // Wait for any write already in flight, then durably write the latest
        // in-memory snapshot as well.
        await pendingProductWrite;
        const success = await writeProductsToDB(productCache);
        if (!success) {
            console.warn('[ProductCache] Flush failed; localStorage snapshot retained');
        }
    }
}

/**
 * Check if product cache has been initialized
 */
export function isProductCacheReady(): boolean {
    return isInitialized;
}

/**
 * Get product count without iterating
 */
export function getProductCount(): number {
    return productCache?.length ?? 0;
}

/**
 * Find a single product by SKU (uses cached data)
 */
export function findProductBySku(sku: string): any | undefined {
    if (!productCache) return undefined;
    return productCache.find(p => p.sku === sku);
}

/**
 * Find a single product by name (uses cached data)
 */
export function findProductByName(name: string): any | undefined {
    if (!productCache) return undefined;
    return productCache.find(p => p.name === name);
}

// ============ Background Product Sync (Offline Resilience) ============

const PENDING_PRODUCT_KEY = 'pos_pending_product_sync';
type ProductSyncPayload = {
    kode: string;
    nama: string;
    hargaBeli: number;
    hargaJual: number;
    stok: number;
};

type BackgroundSyncStatus = 'pending' | 'syncing' | 'success' | 'error';

let pendingProductSync: Map<string, ProductSyncPayload> = new Map();
let productSyncTimer: ReturnType<typeof setTimeout> | null = null;
let productSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
let productSyncInFlight = false;
let productSyncInitialized = false;

function emitBackgroundSync(
    kind: 'product' | 'stock',
    status: BackgroundSyncStatus,
    pending: number,
    message: string,
): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('pos:background-sync', {
        detail: { kind, status, pending, message },
    }));
}

function getProductGasUrl(): string {
    try {
        const raw = localStorage.getItem('pos_product_gas_url');
        return raw ? String(JSON.parse(raw) || '').trim() : '';
    } catch {
        return '';
    }
}

function persistPendingProducts(): void {
    try {
        if (pendingProductSync.size > 0) {
            localStorage.setItem(PENDING_PRODUCT_KEY, JSON.stringify(Object.fromEntries(pendingProductSync)));
        } else {
            localStorage.removeItem(PENDING_PRODUCT_KEY);
        }
    } catch (error) {
        console.error('[ProductSync] Failed to persist pending products:', error);
    }
}

function loadPendingProducts(): void {
    try {
        const raw = localStorage.getItem(PENDING_PRODUCT_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const [kode, product] of Object.entries(data || {})) {
            if (product && typeof product === 'object') {
                pendingProductSync.set(kode, product as ProductSyncPayload);
            }
        }
        if (pendingProductSync.size > 0) {
            emitBackgroundSync('product', 'pending', pendingProductSync.size,
                `${pendingProductSync.size} perubahan produk menunggu dikirim ke Sheet`);
        }
    } catch (error) {
        console.error('[ProductSync] Failed to load pending products:', error);
    }
}

function scheduleProductSync(delay = 500): void {
    if (productSyncRetryTimer) {
        clearTimeout(productSyncRetryTimer);
        productSyncRetryTimer = null;
    }
    if (productSyncTimer) clearTimeout(productSyncTimer);
    productSyncTimer = setTimeout(() => {
        productSyncTimer = null;
        void flushPendingProducts();
    }, delay);
}

/**
 * Initialize product sync queue and retry pending add/edit operations on startup.
 */
export function initProductSync(): void {
    if (productSyncInitialized) return;
    productSyncInitialized = true;
    loadPendingProducts();

    const retry = () => {
        if (pendingProductSync.size > 0) {
            emitBackgroundSync('product', 'pending', pendingProductSync.size,
                `${pendingProductSync.size} perubahan produk menunggu dikirim ke Sheet`);
            scheduleProductSync(500);
        }
    };
    window.addEventListener('online', retry);
    window.addEventListener('configUpdated', retry);

    if (pendingProductSync.size > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
        scheduleProductSync(1500);
    }
}

/**
 * Save an add/edit operation locally and send it in the background.
 * The latest operation for each SKU replaces older pending data.
 */
export function queueProductSync(product: any): void {
    const kode = String(product?.sku ?? '').trim().toUpperCase();
    if (!kode || kode === '-') return;

    const payload: ProductSyncPayload = {
        kode,
        nama: String(product?.name ?? '').trim(),
        hargaBeli: Number(product?.purchasePrice) || 0,
        hargaJual: Number(product?.price) || 0,
        // Negative stock is valid and must be preserved.
        stok: Number(product?.stock) || 0,
    };
    pendingProductSync.set(kode, payload);
    persistPendingProducts();
    emitBackgroundSync('product', 'pending', pendingProductSync.size,
        `Produk ${kode} disimpan, menunggu sinkronisasi ke Sheet`);

    if (!productSyncInitialized) initProductSync();
    if (typeof navigator === 'undefined' || navigator.onLine) scheduleProductSync();
}

async function flushPendingProducts(): Promise<void> {
    if (productSyncInFlight || pendingProductSync.size === 0) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        emitBackgroundSync('product', 'pending', pendingProductSync.size,
            `${pendingProductSync.size} produk menunggu koneksi internet`);
        return;
    }

    const gasUrl = getProductGasUrl();
    if (!gasUrl) {
        emitBackgroundSync('product', 'error', pendingProductSync.size,
            'Produk tersimpan lokal; URL GAS Database Produk belum diisi');
        if (productSyncRetryTimer) clearTimeout(productSyncRetryTimer);
        productSyncRetryTimer = setTimeout(() => {
            productSyncRetryTimer = null;
            if (pendingProductSync.size > 0) emitBackgroundSync('product', 'pending', pendingProductSync.size,
                `${pendingProductSync.size} produk menunggu konfigurasi URL GAS`);
        }, 10000);
        return;
    }

    productSyncInFlight = true;
    const batch = Array.from(pendingProductSync.entries());
    let syncedCount = 0;

    try {
        for (const [kode, payload] of batch) {
            if (pendingProductSync.get(kode) !== payload) continue;
            emitBackgroundSync('product', 'syncing', pendingProductSync.size,
                `Mengirim ${kode} ke Google Sheet...`);

            try {
                const response = await fetch(gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'updateProductActive', product: payload }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result.success !== true) throw new Error(result.error || 'Server menolak perubahan');
                if (pendingProductSync.get(kode) === payload) {
                    pendingProductSync.delete(kode);
                    syncedCount++;
                }
            } catch (error) {
                console.error(`[ProductSync] Failed ${kode}:`, error);
            }
        }
    } finally {
        productSyncInFlight = false;
        persistPendingProducts();
    }

    if (pendingProductSync.size > 0) {
        emitBackgroundSync('product', 'error', pendingProductSync.size,
            `${syncedCount} tersinkron; ${pendingProductSync.size} masih menunggu dan akan dicoba lagi`);
        if (productSyncRetryTimer) clearTimeout(productSyncRetryTimer);
        productSyncRetryTimer = setTimeout(() => {
            productSyncRetryTimer = null;
            void flushPendingProducts();
        }, 10000);
    } else if (syncedCount > 0) {
        emitBackgroundSync('product', 'success', 0,
            `${syncedCount} perubahan produk berhasil dikirim ke Sheet`);
    }
}

// ============ Push Stock to Sheet (Bidirectional Sync + Offline Resilience) ============

const PENDING_STOCK_KEY = 'pos_pending_stock_sync';
let pendingStockUpdates: Map<string, number> = new Map();
let stockPushTimer: ReturnType<typeof setTimeout> | null = null;
let stockSyncInitialized = false;

/**
 * Save pending updates to localStorage so they survive browser close
 */
function _persistPending(): void {
    try {
        if (pendingStockUpdates.size > 0) {
            const data = Object.fromEntries(pendingStockUpdates);
            localStorage.setItem(PENDING_STOCK_KEY, JSON.stringify(data));
        } else {
            localStorage.removeItem(PENDING_STOCK_KEY);
        }
    } catch { /* ignore quota errors */ }
}

/**
 * Load pending updates from localStorage (from previous session)
 */
function _loadPending(): void {
    try {
        const raw = localStorage.getItem(PENDING_STOCK_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            for (const [kode, stok] of Object.entries(data)) {
                if (!pendingStockUpdates.has(kode)) {
                    pendingStockUpdates.set(kode, stok as number);
                }
            }
            console.log(`[StockSync] Loaded ${Object.keys(data).length} pending updates from previous session`);
        }
    } catch { /* ignore parse errors */ }
}

/**
 * Initialize stock sync: load pending from localStorage, listen for online event.
 * Called once on app startup.
 */
export function initStockSync(): void {
    if (stockSyncInitialized) return;
    stockSyncInitialized = true;

    _loadPending();

    window.addEventListener('online', () => {
        console.log('[StockSync] 📶 Device back online, flushing pending updates...');
        _flushStockToSheet();
    });

    if (navigator.onLine && pendingStockUpdates.size > 0) {
        console.log('[StockSync] Online with pending updates from previous session, flushing...');
        setTimeout(() => _flushStockToSheet(), 3000);
    }
}

/**
 * Queue stock changes to be pushed to Google Sheet.
 * Debounced (2s). Persisted to localStorage for offline resilience.
 */
export function pushStockToSheet(updates: Array<{ sku: string; stock: number }>): void {
    for (const u of updates) {
        const sku = String(u.sku ?? '').trim().toUpperCase();
        if (sku && sku !== '-') {
            pendingStockUpdates.set(sku, u.stock);
        }
    }

    // Persist immediately (survive crash/close)
    _persistPending();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.log(`[StockSync] ⏸ Offline — ${pendingStockUpdates.size} updates queued (saved to localStorage)`);
        emitBackgroundSync('stock', 'pending', pendingStockUpdates.size,
            `${pendingStockUpdates.size} perubahan stok menunggu koneksi internet`);
        return;
    }

    if (stockPushTimer) clearTimeout(stockPushTimer);
    stockPushTimer = setTimeout(() => _flushStockToSheet(), 2000);
}

async function _flushStockToSheet(): Promise<void> {
    if (pendingStockUpdates.size === 0) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.log('[StockSync] Still offline, keeping updates queued');
        emitBackgroundSync('stock', 'pending', pendingStockUpdates.size,
            `${pendingStockUpdates.size} perubahan stok menunggu koneksi internet`);
        return;
    }

    // Take snapshot and clear pending
    const updates = Array.from(pendingStockUpdates.entries()).map(([kode, stok]) => ({
        kode,
        stok
    }));
    pendingStockUpdates.clear();
    _persistPending();

    try {
        let gasUrl = '';
        try {
            // Product stock must never fall back to the report deployment.
            const raw = localStorage.getItem('pos_product_gas_url');
            if (raw) gasUrl = JSON.parse(raw);
        } catch { /* fallback */ }

        if (!gasUrl) {
            console.log('[StockSync] No product GAS URL configured; keeping updates queued');
            for (const u of updates) pendingStockUpdates.set(u.kode, u.stok);
            _persistPending();
            return;
        }

        console.log(`[StockSync] Pushing ${updates.length} stock updates...`);
        const products = productCache || [];
        const productsBySku = new Map(products.map((p: any) => [String(p.sku ?? '').trim().toUpperCase(), p]));
        const normalizedUpdates = updates.map(u => ({
            kode: String(u.kode).trim().toUpperCase(),
            stok: u.stok,
        }));
        const stockUpdates = normalizedUpdates.filter(u => productsBySku.has(u.kode));

        const missing = normalizedUpdates.filter(u => !productsBySku.has(u.kode));
        for (const u of missing) pendingStockUpdates.set(u.kode, u.stok);
        if (stockUpdates.length === 0) {
            _persistPending();
            return;
        }

        const response = await fetch(gasUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "batchUpdateStock",
                updates: stockUpdates,
            }),
        });

        // no-cors responses are opaque, so this only confirms request delivery;
        // failed network requests remain queued for retry.
        if (!response || (response.type !== 'opaque' && !response.ok)) {
            throw new Error(`Stock sync ditolak (status ${response?.status ?? 'unknown'})`);
        }
        console.log(`[StockSync] ✓ Batch request sent for ${stockUpdates.length} stock updates`);
        _persistPending();
        emitBackgroundSync('stock', 'success', pendingStockUpdates.size,
            `${stockUpdates.length} perubahan stok berhasil dikirim ke Sheet`);
    } catch (err) {
        console.error('[StockSync] Failed:', err);
        emitBackgroundSync('stock', 'error', pendingStockUpdates.size,
            'Perubahan stok belum terkirim; akan dicoba lagi');
        for (const u of updates) {
            if (!pendingStockUpdates.has(u.kode)) {
                pendingStockUpdates.set(u.kode, u.stok);
            }
        }
        _persistPending();
    }
}
