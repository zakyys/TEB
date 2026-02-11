import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { getAllTransactions, saveAllTransactions, clearAllTransactions, initDB } from "./indexedDB";

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

// Format currency in IDR
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

// Backup all POS data to a text string
export function backupData(): string {
  try {
    const dataToBackup = {
      products: getFromLS(LS_KEYS.PRODUCTS, []),
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
export function restoreData(backupString: string): void {
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

    // Restore data to localStorage
    saveToLS(LS_KEYS.PRODUCTS, parsedData.products);
    saveToLS(LS_KEYS.TRANSACTIONS, parsedData.transactions);

    if (parsedData.profile) {
      saveToLS(LS_KEYS.PROFILE, parsedData.profile);
    }
  } catch (error) {
    console.error("Error restoring data:", error);
    throw new Error("Gagal memulihkan data dari backup");
  }
}

// Backup products only as downloadable JSON file
export function backupProductsToFile(): void {
  try {
    const products = getFromLS(LS_KEYS.PRODUCTS, []);
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
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error backing up products:", error);
    throw new Error("Gagal membuat backup produk");
  }
}

// Generate backup file object (for sharing, not downloading)
export function generateBackupFileObject(): File {
  try {
    const products = getFromLS(LS_KEYS.PRODUCTS, []);
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

// Backup all data as downloadable JSON file
export async function backupAllDataToFile(): Promise<void> {
  try {
    // Get transactions from IndexedDB (primary source)
    let allTransactions: any[] = [];
    try {
      allTransactions = await getAllTransactions();
    } catch (e) {
      // Fallback to localStorage if IndexedDB fails
      allTransactions = getFromLS(LS_KEYS.TRANSACTIONS, []);
    }

    // Get exchange and refund records
    const exchanges = getFromLS('bengkel_exchanges', []);
    const refunds = getFromLS('bengkel_refunds', []);

    // Get purchase notes if any
    const purchaseNotes = getFromLS('purchase_notes', []);

    const backupData = {
      type: "full-backup",
      timestamp: new Date().toISOString(),
      version: "2.2", // Upgraded version with Multi-Toko connection
      data: {
        products: getFromLS(LS_KEYS.PRODUCTS, []),
        transactions: allTransactions, // From IndexedDB
        profile: getFromLS(LS_KEYS.PROFILE, null),
        visitorsLog: getFromLS(LS_KEYS.VISITORS_LOG, []),
        visitorLostLog: getFromLS(LS_KEYS.VISITOR_LOST_LOG, []),
        exchanges: exchanges, // Exchange records
        refunds: refunds, // Refund records
        purchaseNotes: purchaseNotes, // Purchase notes
        notes: getFromLS('bengkel_notes', []), // Catatan/Notes
        cart: getFromLS(LS_KEYS.CART, []), // Current cart
        enablePPN: getFromLS(LS_KEYS.ENABLE_PPN, false), // PPN setting
        // Multi-Toko Connection Settings (version 2.2+)
        multiTokoConnection: {
          gasUrl: getFromLS(LS_KEYS.GAS_URL, ""),
          productGasUrl: getFromLS(LS_KEYS.PRODUCT_GAS_URL, ""),
          telegramBotToken: getFromLS(LS_KEYS.TELEGRAM_BOT_TOKEN, ""),
          telegramChatId: getFromLS(LS_KEYS.TELEGRAM_CHAT_ID, ""),
        },
      },
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Filename: pos-full-YYYY-MM-DD-HH-mm.json
    const now = new Date();
    const filename = `pos-full-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          saveToLS(LS_KEYS.PRODUCTS, backupData.data.products);

        } else if (backupData.type === "full-backup") {
          if (!Array.isArray(backupData.data.products) ||
            !Array.isArray(backupData.data.transactions)) {
            throw new Error("Data backup lengkap tidak valid");
          }

          // Restore products to localStorage
          saveToLS(LS_KEYS.PRODUCTS, backupData.data.products);

          // Restore transactions to both localStorage AND IndexedDB
          saveToLS(LS_KEYS.TRANSACTIONS, backupData.data.transactions);
          try {
            await initDB();
            await saveAllTransactions(backupData.data.transactions);
          } catch (dbError) {
            console.warn("Failed to save to IndexedDB, localStorage used as fallback:", dbError);
          }

          if (backupData.data.profile) {
            saveToLS(LS_KEYS.PROFILE, backupData.data.profile);
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
    telegramChatId: getFromLS<string>(LS_KEYS.TELEGRAM_CHAT_ID, "")
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
    const products = getFromLS<any[]>(LS_KEYS.PRODUCTS, []);
    if (!Array.isArray(products)) {
      saveToLS(LS_KEYS.PRODUCTS, []);
      issues.push("Products data was corrupted - reset to empty");
      fixed = true;
    }
  } catch (e) {
    saveToLS(LS_KEYS.PRODUCTS, []);
    issues.push("Products parse error - reset to empty");
    fixed = true;
  }

  return { fixed, issues };
}

// Archive old transactions (keep only last X days)
// If keepDays = 0, delete ALL transactions
// If keepDays = -1, delete all EXCEPT today
export async function archiveOldTransactions(keepDays: number = 60): Promise<{ archived: number; remaining: number }> {
  // Initialize IndexedDB
  await initDB();

  // Get transactions from IndexedDB
  let transactions: any[];
  try {
    transactions = await getAllTransactions();
  } catch (err) {
    console.error('Failed to get transactions from IndexedDB:', err);
    transactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
  }

  const products = getFromLS<any[]>(LS_KEYS.PRODUCTS, []);

  // Helper to return stock for transactions
  const returnStockForTransactions = (transactionsToDelete: any[]) => {
    transactionsToDelete.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach((item: any) => {
          // Find product by SKU or name
          const productIndex = products.findIndex(
            p => p.sku === item.sku || p.name === item.name
          );
          if (productIndex !== -1 && products[productIndex].stock !== undefined) {
            products[productIndex].stock += item.quantity || 1;
          }
        });
      }
    });
    saveToLS(LS_KEYS.PRODUCTS, products);
  };

  // Helper to save transactions to IndexedDB
  const saveTransactionsAsync = async (txs: any[]) => {
    try {
      await saveAllTransactions(txs);
    } catch (err) {
      console.error('Failed to save to IndexedDB:', err);
      // Only fallback to localStorage if data is small
      if (txs.length < 500) {
        try {
          saveToLS(LS_KEYS.TRANSACTIONS, txs);
        } catch (lsErr) {
          console.error('localStorage also failed:', lsErr);
        }
      } else {
        console.warn('Data too large for localStorage fallback');
      }
    }
  };

  // If keepDays is 0, delete ALL transactions, visitors, and lost logs (DEVICE RESET)
  // NOTE: Does NOT return stock - this is for clean device, not refunds
  if (keepDays === 0) {
    const archivedCount = transactions.length;
    // Clear IndexedDB transactions
    await clearAllTransactions();
    // Clear localStorage backup
    saveToLS(LS_KEYS.TRANSACTIONS, []);
    // Clear all visitor and lost data
    saveToLS(LS_KEYS.VISITORS_LOG, []);
    saveToLS(LS_KEYS.VISITOR_LOST_LOG, []);
    // Clear cart
    saveToLS(LS_KEYS.CART, []);
    // Clear notes/catatan
    saveToLS('bengkel_notes', []);
    // Clear exchanges and refunds
    saveToLS('bengkel_exchanges', []);
    saveToLS('bengkel_refunds', []);
    // Clear purchase notes
    saveToLS('purchase_notes', []);
    console.log(`✅ Device reset: ${archivedCount} transaksi dihapus (produk tidak berubah)`);
    return {
      archived: archivedCount,
      remaining: 0
    };
  }

  // If keepDays is -1, keep only TODAY's transactions
  if (keepDays === -1) {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTransactions = transactions.filter(t => {
      const txDate = t.date?.split('T')[0] || '';
      return txDate === todayStr;
    });
    const transactionsToDelete = transactions.filter(t => {
      const txDate = t.date?.split('T')[0] || '';
      return txDate !== todayStr;
    });
    // Return stock for deleted transactions
    returnStockForTransactions(transactionsToDelete);
    const archivedCount = transactionsToDelete.length;
    await saveTransactionsAsync(todayTransactions);
    return {
      archived: archivedCount,
      remaining: todayTransactions.length
    };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const recentTransactions = transactions.filter(t => {
    const txDate = t.date?.split('T')[0] || '';
    return txDate >= cutoffStr;
  });

  const transactionsToDelete = transactions.filter(t => {
    const txDate = t.date?.split('T')[0] || '';
    return txDate < cutoffStr;
  });

  // Return stock for deleted transactions
  returnStockForTransactions(transactionsToDelete);

  const archivedCount = transactionsToDelete.length;

  await saveTransactionsAsync(recentTransactions);

  return {
    archived: archivedCount,
    remaining: recentTransactions.length
  };
}

// Get item count by period (counts total items, not transactions)
export function getTransactionStats(): { total: number; thisMonth: number; lastMonth: number; older: number; txCount: number } {
  const transactions = getFromLS<any[]>(LS_KEYS.TRANSACTIONS, []);
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
        products: getFromLS(LS_KEYS.PRODUCTS, []),
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
