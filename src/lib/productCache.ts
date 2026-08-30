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

    if (!navigator.onLine) {
        console.log(`[StockSync] ⏸ Offline — ${pendingStockUpdates.size} updates queued (saved to localStorage)`);
        return;
    }

    if (stockPushTimer) clearTimeout(stockPushTimer);
    stockPushTimer = setTimeout(() => _flushStockToSheet(), 2000);
}

async function _flushStockToSheet(): Promise<void> {
    if (pendingStockUpdates.size === 0) return;

    if (!navigator.onLine) {
        console.log('[StockSync] Still offline, keeping updates queued');
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
    } catch (err) {
        console.error('[StockSync] Failed:', err);
        for (const u of updates) {
            if (!pendingStockUpdates.has(u.kode)) {
                pendingStockUpdates.set(u.kode, u.stok);
            }
        }
        _persistPending();
    }
}
