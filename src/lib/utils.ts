import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { getAllTransactions, saveAllTransactions, clearAllTransactions, initDB, safeInitAndMigrate } from "./indexedDB";
import { getProducts, setProducts, flushProductCache } from "./productCache";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Local Storage Keys
export const LS_KEYS = {
  PRODUCTS: "PRODUCTS",
  TRANSACTIONS: "TRANSACTIONS",
  CART: "CART",
  PROFILE: "PROFILE",
  ENABLE_PPN: "ENABLE_PPN",
  VISITORS_LOG: "VISITORS_LOG",
  VISITOR_LOST_LOG: "VISITOR_LOST_LOG",
  GAS_URL: "pos_gas_url",
  PRODUCT_GAS_URL: "pos_product_gas_url",
  TELEGRAM_BOT_TOKEN: "pos_telegram_bot_token",
  TELEGRAM_CHAT_ID: "pos_telegram_chat_id",
  AUTO_SEND_SALES_ENABLED: "auto_send_sales_enabled",
  AUTO_SEND_SALES_TIMES: "auto_send_sales_times",
};

// Local Storage Utility Functions
export function getFromLS<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error getting item ${key} from localStorage:`, error);
    return defaultValue;
  }
}

export function saveToLS(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving item ${key} to localStorage:`, error);
  }
}

// Some legacy settings are stored as raw strings, while newer settings use JSON.
// Read both formats so Backup Full preserves the exact persisted value.
function getStoredValue<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  } catch (error) {
    console.error(`Error getting stored value ${key}:`, error);
    return defaultValue;
  }
}

function saveStoredValue(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else if (typeof value === 'string' && !value.startsWith('{') && !value.startsWith('[')) {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    console.error(`Error saving stored value ${key}:`, error);
  }
}

// Format currency in IDR
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function getRelativeDateBadge(value: string | Date | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  const daysAgo = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (daysAgo === 0) return "Hari ini";
  if (daysAgo === 1) return "Kemarin";
  if (daysAgo === 2) return "2 Hari Lalu";
  if (daysAgo === 3) return "3 Hari Lalu";
  return null;
}

// Backup all POS data to a text string
export function backupData(): string {
  try {
    const dataToBackup = {
      products: getProducts(),
      transactions: getFromLS(LS_KEYS.TRANSACTIONS, []),
      profile: getFromLS(LS_KEYS.PROFILE, null),
    };

    // Convert to Base64 to make it more compact and avoid special character issues
    return btoa(JSON.stringify(dataToBackup));
  } catch (error) {
    console.error("Error creating backup:", error);
    throw new Error("Gagal membuat backup data");
  }
}

// Restore all POS data from a backup string
// Fix #11: Now saves transactions to IndexedDB (primary) + localStorage (fallback)
export async function restoreData(backupString: string): Promise<void> {
  try {
    // Decode from Base64
    const decodedData = atob(backupString);
    const parsedData = JSON.parse(decodedData);

    // Validate the data structure
    if (
      !Array.isArray(parsedData.products) ||
      !Array.isArray(parsedData.transactions)
    ) {
      throw new Error("Format data backup tidak valid");
    }

    // Restore products via product cache (persists to IndexedDB + memory)
    setProducts(parsedData.products);

    // Save transactions to IndexedDB (primary) AND localStorage (fallback)
    saveToLS(LS_KEYS.TRANSACTIONS, parsedData.transactions);
    try {
      await saveAllTransactions(parsedData.transactions);
    } catch (e) {
      console.warn('[restoreData] IndexedDB save failed, localStorage fallback used:', e);
    }

    if (parsedData.profile) {
      saveToLS(LS_KEYS.PROFILE, parsedData.profile);
    }
  } catch (error) {
    console.error("Error restoring data:", error);
    throw new Error("Gagal memulihkan data dari backup");
  }
}

// Backup products only as downloadable JSON file
export async function backupProductsToFile(): Promise<void> {
  try {
    // Ensure the latest in-memory product/stock changes are durable before export.
    await flushProductCache();
    const products = getProducts();
    const backupData = {
      type: "products-only",
      timestamp: new Date().toISOString(),
      version: "1.0",
      data: {
        products: products,
      },
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Filename: pos-products-YYYY-MM-DD-HH-mm.json
    const now = new Date();
    const filename = `pos-products-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser time to start the download before releasing the Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Error backing up products:", error);
    throw new Error("Gagal membuat backup produk");
  }
}

// Generate backup file object (for sharing, not downloading)
export function generateBackupFileObject(): File {
  try {
    const products = getProducts();
    const backupData = {
      type: "products-only",
      timestamp: new Date().toISOString(),
      version: "1.0",
      data: {
        products: products,
      },
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const now = new Date();
    const filename = `pos-products-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;

    const file = new File([jsonString], filename, { type: "application/json" });
    return file;
  } catch (error) {
    console.error("Error generating backup file:", error);
    throw new Error("Gagal membuat file backup");
  }
}

// Share backup to WhatsApp owner
export async function shareBackupToWhatsApp(ownerPhone: string = "6289523964793"): Promise<void> {
  try {
    const file = generateBackupFileObject();

    // Try native Share API first (works on mobile/PWA)
    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Backup Produk POS',
        text: 'Backup produk terbaru dari BAUT - APP KASIR'
      });
      return;
    }

    // Fallback: Download file + open WhatsApp
    // Download the file
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Open WhatsApp with message
    const fileName = file.name;
    const message = `📦 BACKUP PRODUK BAUT - APP KASIR\n\nFile backup sudah di-download otomatis!\n\n📁 Nama file: ${fileName}\n📍 Lokasi: Folder "Download" di HP\n\n🔹 CARA KIRIM:\n1. Klik tombol 📎 (attach) di WhatsApp ini\n2. Pilih "Document" atau "File"\n3. Cari file: ${fileName}\n4. Kirim!\n\nTerima kasih! 🙏`;
    const whatsappUrl = `https://wa.me/${ownerPhone}?text=${encodeURIComponent(message)}`;

    // Wait a bit for download to finish, then open WhatsApp
    setTimeout(() => {
      window.open(whatsappUrl, '_blank');
    }, 500);

  } catch (error) {
    console.error("Error sharing to WhatsApp:", error);
    throw new Error("Gagal mengirim backup ke WhatsApp");
  }
}

// Backup all data as downloadable JSON file.
// Includes primary stores plus recovery queues/drafts that affect data safety.
export async function backupAllDataToFile(): Promise<void> {
  try {
    // Complete pending migrations/writes before taking the snapshot.
    await safeInitAndMigrate();
    // Flush the product cache so the backup reflects the latest in-memory state.
    await flushProductCache();

    let allTransactions: any[] = [];
    let transactionSource: 'indexeddb' | 'localstorage' = 'indexeddb';
    try {
      allTransactions = await getAllTransactions();
    } catch (e) {
      transactionSource = 'localstorage';
      allTransactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
      if (!Array.isArray(allTransactions) || allTransactions.length === 0) {
        allTransactions = getFromLS<any[]>('pos_transactions', []);
      }
    }

    if (!Array.isArray(allTransactions)) {
      throw new Error('Data transaksi tidak valid');
    }

    // Include legacy snapshots for diagnosis/recovery, but never replace a
    // valid empty IndexedDB store with potentially stale localStorage data.
    const localStorageTransactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
    const legacyTransactions = getFromLS<any[]>('pos_transactions', []);

    const persistedPosStore = getFromLS<any | null>('POS_STORE', null);
    const activeCart = Array.isArray(persistedPosStore?.state?.cart)
      ? persistedPosStore.state.cart
      : getFromLS<any[]>(LS_KEYS.CART, []);
    const enablePPN = typeof persistedPosStore?.state?.enablePPN === 'boolean'
      ? persistedPosStore.state.enablePPN
      : getFromLS(LS_KEYS.ENABLE_PPN, false);

    const backupData = {
      type: "full-backup",
      timestamp: new Date().toISOString(),
      version: "2.3",
      data: {
        products: getProducts(),
        transactions: allTransactions,
        transactionSource,
        // Keep legacy transaction snapshots available for recovery diagnostics.
        transactionSnapshots: {
          localStorage: localStorageTransactions,
          legacy: legacyTransactions,
        },
        profile: getFromLS('bengkel_profile', getFromLS(LS_KEYS.PROFILE, null)),
        visitorsLog: getFromLS(LS_KEYS.VISITORS_LOG, []),
        visitorLostLog: getFromLS(LS_KEYS.VISITOR_LOST_LOG, []),
        exchanges: getFromLS('bengkel_exchanges', []),
        refunds: getFromLS('bengkel_refunds', []),
        purchaseNotes: getFromLS('purchase_notes', []),
        notes: getFromLS('bengkel_notes', []),
        cart: activeCart,
        enablePPN,
        posStore: persistedPosStore,
        purchaseDraft: getFromLS('nota_draft', null),
        pendingStockSync: getFromLS('pos_pending_stock_sync', {}),
        pendingProductSync: getFromLS('pos_pending_product_sync', {}),
        syncMetadata: {
          sheetsLastSentTime: getStoredValue<string | null>('sheets_last_sent_time', null),
          autoSendLastExecuted: getStoredValue<Record<string, string>>('auto_send_last_executed', {}),
          telegramChannelId: getStoredValue<string | null>('TELEGRAM_CHANNEL_ID', null),
          telegramAutoSync: getStoredValue<boolean>('TELEGRAM_AUTO_SYNC', false),
          telegramLastSync: getStoredValue<string | null>('TELEGRAM_LAST_SYNC', null),
          telegramLastFile: getStoredValue<Record<string, unknown> | null>('TELEGRAM_LAST_FILE', null),
        },
        // Connection settings are retained for existing restore compatibility.
        multiTokoConnection: {
          gasUrl: getFromLS(LS_KEYS.GAS_URL, ""),
          productGasUrl: getFromLS(LS_KEYS.PRODUCT_GAS_URL, ""),
          telegramBotToken: getFromLS(LS_KEYS.TELEGRAM_BOT_TOKEN, ""),
          telegramChatId: getFromLS(LS_KEYS.TELEGRAM_CHAT_ID, ""),
        },
        selectedPrinter: getStoredValue<string | null>('selectedPrinter', null),
      },
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const now = new Date();
    const filename = `pos-full-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser time to start the download before releasing the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Error backing up all data:", error);
    throw new Error("Gagal membuat backup lengkap");
  }
}

// Restore data from uploaded JSON file
export function restoreFromFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const jsonString = e.target?.result as string;
        const backupData = JSON.parse(jsonString);

        // Validate backup format
        if (!backupData.type || !backupData.data) {
          throw new Error("Format file backup tidak valid");
        }

        // Restore based on backup type
        if (backupData.type === "products-only") {
          if (!Array.isArray(backupData.data.products)) {
            throw new Error("Data produk tidak valid");
          }
          setProducts(backupData.data.products);

        } else if (backupData.type === "full-backup") {
          if (!Array.isArray(backupData.data.products) ||
            !Array.isArray(backupData.data.transactions)) {
            throw new Error("Data backup lengkap tidak valid");
          }

          // Restore products and wait for the product cache to become durable.
          setProducts(backupData.data.products);
          await flushProductCache();

          // Restore transactions to both localStorage AND IndexedDB.
          saveToLS(LS_KEYS.TRANSACTIONS, backupData.data.transactions);
          try {
            await initDB();
            await saveAllTransactions(backupData.data.transactions);
          } catch (dbError) {
            console.warn("Failed to save to IndexedDB, localStorage used as fallback:", dbError);
          }

          if (backupData.data.profile) {
            // The running app reads bengkel_profile; keep the legacy PROFILE key
            // too for older screens/backups that still use LS_KEYS.PROFILE.
            saveToLS('bengkel_profile', backupData.data.profile);
            saveToLS(LS_KEYS.PROFILE, backupData.data.profile);
          }

          // Restore the current Zustand POS state when present. Older backups only
          // have cart/enablePPN fields, so support both formats.
          if (backupData.data.posStore?.state && typeof backupData.data.posStore.state === 'object') {
            saveToLS('POS_STORE', backupData.data.posStore);
          } else {
            const currentPosStore = getFromLS<any | null>('POS_STORE', null);
            const currentState = currentPosStore?.state && typeof currentPosStore.state === 'object'
              ? currentPosStore.state
              : {};
            saveToLS('POS_STORE', {
              name: 'POS_STORE',
              version: currentPosStore?.version ?? 3,
              state: {
                ...currentState,
                ...(Array.isArray(backupData.data.cart) ? { cart: backupData.data.cart } : {}),
                ...(typeof backupData.data.enablePPN === 'boolean' ? { enablePPN: backupData.data.enablePPN } : {}),
              },
            });
          }

          // Restore the purchase draft and pending sync queues when included in
          // newer backups. Missing fields are left untouched for old backups.
          if (Object.prototype.hasOwnProperty.call(backupData.data, 'purchaseDraft')) {
            if (backupData.data.purchaseDraft === null || backupData.data.purchaseDraft === undefined) {
              localStorage.removeItem('nota_draft');
            } else {
              saveToLS('nota_draft', backupData.data.purchaseDraft);
            }
          }
          if (Object.prototype.hasOwnProperty.call(backupData.data, 'pendingStockSync')) {
            saveToLS('pos_pending_stock_sync', backupData.data.pendingStockSync || {});
          }
          if (Object.prototype.hasOwnProperty.call(backupData.data, 'pendingProductSync')) {
            saveToLS('pos_pending_product_sync', backupData.data.pendingProductSync || {});
          }

          // Restore visitor data if available (version 1.1+)
          if (Array.isArray(backupData.data.visitorsLog)) {
            saveToLS(LS_KEYS.VISITORS_LOG, backupData.data.visitorsLog);
          }
          if (Array.isArray(backupData.data.visitorLostLog)) {
            saveToLS(LS_KEYS.VISITOR_LOST_LOG, backupData.data.visitorLostLog);
          }

          // Restore exchange and refund records (version 2.0+)
          if (Array.isArray(backupData.data.exchanges)) {
            saveToLS('bengkel_exchanges', backupData.data.exchanges);
          }
          if (Array.isArray(backupData.data.refunds)) {
            saveToLS('bengkel_refunds', backupData.data.refunds);
          }

          // Restore purchase notes (version 2.0+)
          if (Array.isArray(backupData.data.purchaseNotes)) {
            saveToLS('purchase_notes', backupData.data.purchaseNotes);
          }

          // Restore notes/catatan (version 2.0+)
          if (Array.isArray(backupData.data.notes)) {
            saveToLS('bengkel_notes', backupData.data.notes);
          }

          // Restore cart (version 2.0+)
          if (Array.isArray(backupData.data.cart)) {
            saveToLS(LS_KEYS.CART, backupData.data.cart);
          }

          // Restore PPN setting (version 2.0+)
          if (backupData.data.enablePPN !== undefined) {
            saveToLS(LS_KEYS.ENABLE_PPN, backupData.data.enablePPN);
          }

          // Restore sync metadata when included in newer backups.
          if (backupData.data.syncMetadata) {
            const syncMetadata = backupData.data.syncMetadata;
            const metadataKeys: Record<string, string> = {
              sheetsLastSentTime: 'sheets_last_sent_time',
              autoSendLastExecuted: 'auto_send_last_executed',
              telegramChannelId: 'TELEGRAM_CHANNEL_ID',
              telegramAutoSync: 'TELEGRAM_AUTO_SYNC',
              telegramLastSync: 'TELEGRAM_LAST_SYNC',
              telegramLastFile: 'TELEGRAM_LAST_FILE',
            };
            for (const [field, key] of Object.entries(metadataKeys)) {
              if (Object.prototype.hasOwnProperty.call(syncMetadata, field)) {
                saveStoredValue(key, syncMetadata[field]);
              }
            }
          }

          if (Object.prototype.hasOwnProperty.call(backupData.data, 'selectedPrinter')) {
            if (backupData.data.selectedPrinter === null || backupData.data.selectedPrinter === undefined) {
              localStorage.removeItem('selectedPrinter');
            } else {
              saveStoredValue('selectedPrinter', backupData.data.selectedPrinter);
            }
          }

          // Restore Multi-Toko Connection Settings (version 2.2+)
          if (backupData.data.multiTokoConnection) {
            const conn = backupData.data.multiTokoConnection;
            if (conn.gasUrl) {
              saveToLS(LS_KEYS.GAS_URL, conn.gasUrl);
            }
            if (conn.productGasUrl) {
              saveToLS(LS_KEYS.PRODUCT_GAS_URL, conn.productGasUrl);
            }
            if (conn.telegramBotToken) {
              saveToLS(LS_KEYS.TELEGRAM_BOT_TOKEN, conn.telegramBotToken);
            }
            if (conn.telegramChatId) {
              saveToLS(LS_KEYS.TELEGRAM_CHAT_ID, conn.telegramChatId);
            }
          }
        } else if (backupData.type === "today-data") {
          // Handle today-data backup (import only, won't overwrite)
          throw new Error("File ini adalah backup data hari ini. Gunakan tombol 'Import Data Hari Ini' untuk mengimpornya.");
        } else {
          throw new Error("Tipe backup tidak dikenali");
        }

        resolve();
      } catch (error) {
        console.error("Error restoring from file:", error);
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Gagal membaca file"));
    };

    reader.readAsText(file);
  });
}

// Get store name from profile
export function getStoreName(): string {
  const profile = getFromLS<{ workshopName?: string } | null>("bengkel_profile", null);
  return profile?.workshopName || "BAUT - APP KASIR";
}

// Get Dynamic Config with Fallbacks
export function getConfig() {
  // Use getFromLS to properly parse JSON-stringified values (saveToLS uses JSON.stringify)
  return {
    gasUrl: getFromLS<string>(LS_KEYS.GAS_URL, ""),
    productGasUrl: getFromLS<string>(LS_KEYS.PRODUCT_GAS_URL, ""),
    telegramBotToken: getFromLS<string>(LS_KEYS.TELEGRAM_BOT_TOKEN, ""),
    telegramChatId: getFromLS<string>(LS_KEYS.TELEGRAM_CHAT_ID, ""),
    autoSendEnabled: getFromLS<boolean>(LS_KEYS.AUTO_SEND_SALES_ENABLED, false),
    autoSendTimes: getFromLS<string>(LS_KEYS.AUTO_SEND_SALES_TIMES, "")
  };
}

// Check localStorage usage and health
export function getStorageInfo(): { used: number; total: number; usedPercent: number; itemCount: Record<string, number> } {
  let totalSize = 0;
  const itemCount: Record<string, number> = {};

  for (const key of Object.keys(localStorage)) {
    const value = localStorage.getItem(key) || "";
    const size = value.length * 2; // UTF-16 = 2 bytes per char
    totalSize += size;

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        itemCount[key] = parsed.length;
      }
    } catch {
      itemCount[key] = 1;
    }
  }

  // Approximate limit is 5MB for most browsers
  const limit = 5 * 1024 * 1024;
  return {
    used: totalSize,
    total: limit,
    usedPercent: Math.round((totalSize / limit) * 100),
    itemCount
  };
}

// Validate and fix corrupted data
export function validateAndFixData(): { fixed: boolean; issues: string[] } {
  const issues: string[] = [];
  let fixed = false;

  // Check transactions
  try {
    const transactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
    if (!Array.isArray(transactions)) {
      saveToLS(LS_KEYS.TRANSACTIONS, []);
      issues.push("Transactions data was corrupted - reset to empty");
      fixed = true;
    }
  } catch (e) {
    saveToLS(LS_KEYS.TRANSACTIONS, []);
    issues.push("Transactions parse error - reset to empty");
    fixed = true;
  }

  // Check products
  try {
    const products = getProducts();
    if (!Array.isArray(products)) {
      setProducts([]);
      issues.push("Products data was corrupted - reset to empty");
      fixed = true;
    }
  } catch (e) {
    setProducts([]);
    issues.push("Products parse error - reset to empty");
    fixed = true;
  }

  return { fixed, issues };
}

// Archive old transactions.
// If keepDays = 0, delete ALL transactions and operational logs.
// If keepDays = -1, keep only today's transactions.
// If keepDays = -2, keep transactions from the current calendar month onward.
// Date cleanup deliberately does not change stock: deleting history must not undo sales.
export async function archiveOldTransactions(keepDays: number = -2): Promise<{ archived: number; remaining: number }> {
  const formatLocalDate = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const getTransactionLocalDate = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const dateValue = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;

    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? null : formatLocalDate(parsed);
  };

  const now = new Date();
  const todayStr = formatLocalDate(now);
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // IndexedDB is primary. Only use localStorage when it cannot be opened/read.
  let usingIndexedDB = true;
  let transactions: any[];
  try {
    await initDB();
    transactions = await getAllTransactions();
  } catch (err) {
    console.error('Failed to get transactions from IndexedDB:', err);
    usingIndexedDB = false;
    transactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
  }

  if (!Array.isArray(transactions)) {
    throw new Error('Data transaksi tidak valid');
  }

  const saveTransactionsAsync = async (txs: any[]) => {
    if (!usingIndexedDB) {
      saveToLS(LS_KEYS.TRANSACTIONS, txs);
      return;
    }

    // Keep legacy/localStorage readers in sync after a successful DB write.
    await saveAllTransactions(txs);
    saveToLS(LS_KEYS.TRANSACTIONS, txs);
  };

  // Hapus Semua is an explicit local operational reset. Products and stock remain.
  if (keepDays === 0) {
    const archivedCount = transactions.length;

    if (usingIndexedDB) {
      await clearAllTransactions();
    }

    saveToLS(LS_KEYS.TRANSACTIONS, []);
    saveToLS(LS_KEYS.VISITORS_LOG, []);
    saveToLS(LS_KEYS.VISITOR_LOST_LOG, []);
    saveToLS(LS_KEYS.CART, []);
    saveToLS('bengkel_notes', []);
    saveToLS('bengkel_exchanges', []);
    saveToLS('bengkel_refunds', []);
    saveToLS('purchase_notes', []);

    // Clear the current Zustand cart while preserving other POS settings.
    const persistedPosStore = getFromLS<any | null>('POS_STORE', null);
    if (persistedPosStore?.state && typeof persistedPosStore.state === 'object') {
      saveToLS('POS_STORE', {
        ...persistedPosStore,
        state: { ...persistedPosStore.state, cart: [] },
      });
    }

    console.log(`✅ Device reset: ${archivedCount} transaksi dihapus (produk tidak berubah)`);
    return { archived: archivedCount, remaining: 0 };
  }

  let shouldKeep: (transaction: any) => boolean;

  if (keepDays === -1) {
    // Keep only the user's local calendar day. Invalid dates are retained for safety.
    shouldKeep = (transaction) => {
      const txDate = getTransactionLocalDate(transaction.date);
      return txDate === null || txDate === todayStr;
    };
  } else if (keepDays === -2) {
    // "Sisakan Bulan Ini": remove only dates before the current calendar month.
    // Current/future dates and invalid records are retained rather than guessed as old.
    shouldKeep = (transaction) => {
      const txDate = getTransactionLocalDate(transaction.date);
      return txDate === null || txDate >= currentMonthStart;
    };
  } else {
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    const cutoffStr = formatLocalDate(cutoffDate);

    shouldKeep = (transaction) => {
      const txDate = getTransactionLocalDate(transaction.date);
      return txDate === null || txDate >= cutoffStr;
    };
  }

  const retainedTransactions = transactions.filter(shouldKeep);
  const archivedCount = transactions.length - retainedTransactions.length;

  await saveTransactionsAsync(retainedTransactions);

  return {
    archived: archivedCount,
    remaining: retainedTransactions.length,
  };
}

// Get item count by period (counts total items, not transactions)
export async function getTransactionStats(): Promise<{ total: number; thisMonth: number; lastMonth: number; older: number; txCount: number }> {
  // Read from IndexedDB (primary source), fallback to localStorage
  let transactions: any[];
  try {
    transactions = await getAllTransactions();
  } catch (err) {
    console.warn('getTransactionStats: IndexedDB failed, falling back to localStorage:', err);
    transactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
  }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];

  let thisMonth = 0, lastMonth = 0, older = 0, total = 0;

  transactions.forEach(t => {
    const txDate = t.date?.split('T')[0] || '';
    const itemCount = t.items?.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0) || 1;
    total += itemCount;

    if (txDate >= thisMonthStart) {
      thisMonth += itemCount;
    } else if (txDate >= lastMonthStart) {
      lastMonth += itemCount;
    } else {
      older += itemCount;
    }
  });

  return { total, thisMonth, lastMonth, older, txCount: transactions.length };
}

// ============ SMART SEARCH UTILITIES ============

/**
 * Normalize string for search - remove special chars, lowercase
 */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Collapse leading zeros in numbers (e.g., "0106" -> "106")
 */
export function collapseLeadingZeros(s: string): string {
  return s.replace(/\d+/g, (m) => String(parseInt(m, 10)));
}

/**
 * Loose matching for search - ignores dashes, spaces, case, and leading zeros
 * @param text - The text to search in
 * @param query - The search query
 * @returns true if text matches query loosely
 */
export function matchesLoose(text: string | undefined, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  const tNorm = normalizeSearch(text);
  const qNorm = normalizeSearch(query);
  if (tNorm.includes(qNorm)) return true;
  const tCollapsed = collapseLeadingZeros(tNorm);
  const qCollapsed = collapseLeadingZeros(qNorm);
  return tCollapsed.includes(qNorm) || tCollapsed.includes(qCollapsed) || tNorm.includes(qCollapsed);
}

/**
 * Calculate relevance score for sorting search results
 * Higher score = more relevant (should appear first)
 * @param sku - The SKU to score
 * @param query - The search query
 * @returns Relevance score (higher = more relevant)
 */
export function getSearchRelevance(sku: string | undefined, query: string): number {
  if (!query || !sku) return 0;
  const qNorm = normalizeSearch(query);
  const skuNorm = normalizeSearch(sku);
  const skuCollapsed = collapseLeadingZeros(skuNorm);
  const qCollapsed = collapseLeadingZeros(qNorm);

  // Exact match = highest priority
  if (skuNorm === qNorm || skuCollapsed === qCollapsed) return 1000;

  // Starts with query = high priority
  if (skuNorm.startsWith(qNorm) || skuCollapsed.startsWith(qCollapsed)) return 500 - skuNorm.length;

  // Contains query = medium priority (shorter SKU = more relevant)
  if (skuNorm.includes(qNorm) || skuCollapsed.includes(qCollapsed)) return 100 - skuNorm.length;

  return 0;
}

/**
 * Sort items by search relevance based on SKU
 * @param items - Array of items with sku property
 * @param query - The search query
 * @returns Sorted array (most relevant first)
 */
export function sortBySearchRelevance<T extends { sku?: string }>(items: T[], query: string): T[] {
  if (!query) return items;
  return [...items].sort((a, b) => {
    const scoreA = getSearchRelevance(a.sku, query);
    const scoreB = getSearchRelevance(b.sku, query);
    return scoreB - scoreA; // Higher score first
  });
}

/**
 * Smart search and sort - filter items then sort by relevance
 * @param items - Array of items to search
 * @param query - The search query
 * @param searchFields - Array of field names to search in
 * @returns Filtered and sorted array
 */
export function smartSearch<T extends Record<string, any>>(
  items: T[],
  query: string,
  searchFields: (keyof T)[]
): T[] {
  if (!query) return items;

  // Filter items that match any search field
  const filtered = items.filter(item =>
    searchFields.some(field => matchesLoose(String(item[field] || ''), query))
  );

  // Sort by SKU relevance if sku field exists
  if ('sku' in (items[0] || {})) {
    return sortBySearchRelevance(filtered as (T & { sku?: string })[], query);
  }

  return filtered;
}

// ============ TELEGRAM JSON TEXT BACKUP ============

/**
 * Get second Telegram bot credentials for JSON text backup
 */
function getTelegramBot2Credentials() {
  const config = getConfig();
  return { botToken: config.telegramBotToken, chatId: config.telegramChatId };
}

/**
 * Send a text message to Telegram (Bot 2)
 */
async function sendTelegramTextMessage(text: string): Promise<boolean> {
  const { botToken, chatId } = getTelegramBot2Credentials();

  if (!botToken || !chatId) {
    console.error('[Telegram Bot 2] Missing credentials');
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();
    return result.ok === true;
  } catch (error) {
    console.error('[Telegram Bot 2] Error sending message:', error);
    return false;
  }
}

/**
 * Split text into chunks of specified max length
 * Telegram has 4096 character limit per message
 */
function splitTextIntoChunks(text: string, maxLength: number = 4000): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  // Split by newlines to avoid breaking in the middle of lines
  const lines = text.split('\n');

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      // If single line is too long, split it
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.substring(0, maxLength));
          remaining = remaining.substring(maxLength);
        }
        currentChunk = remaining;
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Send full backup JSON as a document to Telegram Bot 2
 * Returns { success: boolean, messageCount: number }
 */
export async function sendBackupAsTextToTelegram(): Promise<{ success: boolean; messageCount: number }> {
  try {
    // Check credentials
    const { botToken, chatId } = getTelegramBot2Credentials();
    if (!botToken || !chatId) {
      throw new Error('Telegram Bot 2 credentials not configured. Set VITE_TELEGRAM_BOT_TOKEN_2 and VITE_TELEGRAM_CHAT_ID_2 in .env');
    }

    // Get all data for backup
    let allTransactions: any[] = [];
    try {
      allTransactions = await getAllTransactions();
    } catch (e) {
      allTransactions = getFromLS(LS_KEYS.TRANSACTIONS, []);
    }

    const backupData = {
      type: "full-backup-text",
      timestamp: new Date().toISOString(),
      version: "2.0",
      data: {
        products: getProducts(),
        transactions: allTransactions,
        profile: getFromLS(LS_KEYS.PROFILE, null),
        visitorsLog: getFromLS(LS_KEYS.VISITORS_LOG, []),
        visitorLostLog: getFromLS(LS_KEYS.VISITOR_LOST_LOG, []),
        exchanges: getFromLS('bengkel_exchanges', []),
        refunds: getFromLS('bengkel_refunds', []),
        purchaseNotes: getFromLS('purchase_notes', []),
        notes: getFromLS('bengkel_notes', []),
      },
    };

    // Convert to JSON string with array wrapper for Supabase compatibility
    const jsonString = '[ ' + JSON.stringify(backupData) + ' ]';

    // Calculate stats
    const productCount = backupData.data.products.length;
    const transactionCount = backupData.data.transactions.length;
    const notesCount = backupData.data.notes?.length || 0;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

    // Create filename
    const filename = `backup-${dateStr}-${timeStr}.json`;

    // Create blob and send as document (file only, no caption)
    const blob = new Blob([jsonString], { type: 'application/json' });
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', blob, filename);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.ok) {
      console.log(`[Telegram Bot 2] Backup document sent successfully`);
      return { success: true, messageCount: 1 };
    } else {
      console.error('[Telegram Bot 2] Failed to send document:', result);
      return { success: false, messageCount: 0 };
    }

  } catch (error) {
    console.error('[Telegram Bot 2] Error sending backup:', error);
    return { success: false, messageCount: 0 };
  }
}
