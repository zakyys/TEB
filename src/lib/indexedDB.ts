// IndexedDB utility for POS transactions
// Provides much larger storage capacity than localStorage (~100MB+ vs 5MB)

const DB_NAME = 'pos_database';
const DB_VERSION = 1;
const STORE_TRANSACTIONS = 'transactions';

let dbInstance: IDBDatabase | null = null;

// Initialize/open the database
export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Create transactions store with id as key
            if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
                const store = db.createObjectStore(STORE_TRANSACTIONS, { keyPath: 'id' });
                // Create indexes for common queries
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('customer', 'customer', { unique: false });
            }
        };
    });
};

// Get all transactions
export const getAllTransactions = async (): Promise<any[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readonly');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            console.error('Failed to get transactions:', request.error);
            reject(request.error);
        };
    });
};

// Get recent transactions with limit (optimized for large datasets)
export const getRecentTransactions = async (limit: number = 100): Promise<any[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readonly');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.getAll();

        request.onsuccess = () => {
            const all = request.result || [];
            // Sort by date descending (newest first) and limit
            const sorted = all
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, limit);
            resolve(sorted);
        };

        request.onerror = () => {
            console.error('Failed to get recent transactions:', request.error);
            reject(request.error);
        };
    });
};

// Get today's transactions only (for dashboard)
export const getTodayTransactions = async (): Promise<any[]> => {
    const today = new Date().toISOString().split('T')[0];
    const allTransactions = await getAllTransactions();
    return allTransactions.filter(tx => {
        const txDate = tx.date?.split('T')[0] || '';
        return txDate === today;
    });
};

// Get transactions for last N days (optimized)
export const getTransactionsLastDays = async (days: number): Promise<any[]> => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const allTransactions = await getAllTransactions();
    return allTransactions
        .filter(tx => {
            const txDate = tx.date?.split('T')[0] || '';
            return txDate >= cutoffStr;
        })
        // Sort by date descending (newest first)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

// Get single transaction by ID
export const getTransaction = async (id: string): Promise<any | null> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readonly');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
};

// Save single transaction
export const saveTransaction = async (data: any): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readwrite');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.put(data);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            console.error('Failed to save transaction:', request.error);
            reject(request.error);
        };
    });
};

// Save multiple transactions (bulk)
export const saveAllTransactions = async (transactions: any[]): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readwrite');
        const store = transaction.objectStore(STORE_TRANSACTIONS);

        transaction.oncomplete = () => {
            resolve();
        };

        transaction.onerror = () => {
            console.error('Failed to save transactions:', transaction.error);
            reject(transaction.error);
        };

        // Clear existing and add all new
        store.clear();
        transactions.forEach(tx => {
            store.put(tx);
        });
    });
};

// Delete single transaction
export const deleteTransaction = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readwrite');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.delete(id);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
};

// Delete all transactions
export const clearAllTransactions = async (): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readwrite');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.clear();

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
};

// Get transactions by date range
export const getTransactionsByDateRange = async (startDate: string, endDate: string): Promise<any[]> => {
    const allTransactions = await getAllTransactions();
    return allTransactions.filter(tx => {
        const txDate = tx.date?.split('T')[0] || '';
        return txDate >= startDate && txDate <= endDate;
    });
};

// Get transactions count
export const getTransactionsCount = async (): Promise<number> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_TRANSACTIONS, 'readonly');
        const store = transaction.objectStore(STORE_TRANSACTIONS);
        const request = store.count();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
};

// Migrate data from localStorage to IndexedDB
export const migrateFromLocalStorage = async (): Promise<{ migrated: number; existed: number }> => {
    // BAUT-BBM uses 'TRANSACTIONS', BAUT-SMB uses 'pos_transactions'
    const LS_KEYS = ['TRANSACTIONS', 'pos_transactions'];

    let existingData: string | null = null;
    let usedKey: string | null = null;

    // Try both keys
    for (const key of LS_KEYS) {
        const data = localStorage.getItem(key);
        if (data) {
            existingData = data;
            usedKey = key;
            break;
        }
    }

    if (!existingData) {
        return { migrated: 0, existed: 0 };
    }

    try {
        const transactions = JSON.parse(existingData);
        if (!Array.isArray(transactions) || transactions.length === 0) {
            return { migrated: 0, existed: 0 };
        }

        // Check if IndexedDB already has data
        const existingInDB = await getTransactionsCount();
        if (existingInDB > 0) {
            console.log('IndexedDB already has data, skipping migration');
            return { migrated: 0, existed: existingInDB };
        }

        // Save to IndexedDB
        await saveAllTransactions(transactions);

        // Clear localStorage to free up space (keep backup flag)
        if (usedKey) {
            localStorage.removeItem(usedKey);
        }
        localStorage.setItem('pos_transactions_migrated', 'true');

        console.log(`✅ Migrated ${transactions.length} transactions from localStorage to IndexedDB`);
        return { migrated: transactions.length, existed: 0 };
    } catch (error) {
        console.error('Migration failed:', error);
        return { migrated: 0, existed: 0 };
    }
};

// Archive old transactions (delete older than X days)
export const archiveOldTransactionsDB = async (keepDays: number): Promise<{ archived: number; remaining: number }> => {
    const allTransactions = await getAllTransactions();

    if (keepDays === 0) {
        // Delete all
        await clearAllTransactions();
        return { archived: allTransactions.length, remaining: 0 };
    }

    const cutoffDate = new Date();
    if (keepDays === -1) {
        // Keep only today
        cutoffDate.setHours(0, 0, 0, 0);
    } else {
        cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    }
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const toKeep = allTransactions.filter(tx => {
        const txDate = tx.date?.split('T')[0] || '';
        if (keepDays === -1) {
            return txDate >= cutoffStr;
        }
        return txDate >= cutoffStr;
    });

    const archived = allTransactions.length - toKeep.length;

    await saveAllTransactions(toKeep);

    return { archived, remaining: toKeep.length };
};

// Export for backup
export const exportTransactionsForBackup = async (): Promise<any[]> => {
    return getAllTransactions();
};

// Import from backup
export const importTransactionsFromBackup = async (transactions: any[]): Promise<number> => {
    await saveAllTransactions(transactions);
    return transactions.length;
};

// Get storage estimate - calculates actual transaction data size
export const getStorageEstimate = async (): Promise<{ used: number; quota: number; usedPercent: number }> => {
    try {
        // Get actual data size by serializing transactions
        const transactions = await getAllTransactions();
        const dataString = JSON.stringify(transactions);
        const actualUsed = new Blob([dataString]).size; // Accurate byte count

        // IndexedDB has ~available space, typically 50-100MB usable
        // We use 100MB as reference quota for the progress bar
        const quota = 100 * 1024 * 1024; // 100MB
        const usedPercent = quota > 0 ? Math.round((actualUsed / quota) * 100) : 0;

        return { used: actualUsed, quota, usedPercent };
    } catch (err) {
        console.error('Failed to calculate storage:', err);
        return { used: 0, quota: 100 * 1024 * 1024, usedPercent: 0 };
    }
};

// ============ SAFE WRAPPER FUNCTIONS WITH LOCALSTORAGE FALLBACK ============
// These functions will NEVER crash the app - they fallback to localStorage if IndexedDB fails

const LS_TRANSACTIONS_KEY = 'TRANSACTIONS';

// Check if IndexedDB is available
export const isIndexedDBAvailable = (): boolean => {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
        return false;
    }
};

// Safe get all transactions - NEVER throws, returns [] on error
export const safeGetAllTransactions = async (): Promise<any[]> => {
    try {
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB not available, using localStorage');
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            return data ? JSON.parse(data) : [];
        }

        await initDB();
        return await getAllTransactions();
    } catch (err) {
        console.error('IndexedDB failed, falling back to localStorage:', err);
        try {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }
};

// Safe save transaction - NEVER throws, falls back to localStorage
export const safeSaveTransaction = async (transaction: any): Promise<boolean> => {
    // Add offline marker if currently disconnected
    if (!navigator.onLine) {
        transaction.offlineCreated = true;
    }
    try {
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB not available, using localStorage');
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            const transactions = data ? JSON.parse(data) : [];
            transactions.push(transaction);
            localStorage.setItem(LS_TRANSACTIONS_KEY, JSON.stringify(transactions));
            return true;
        }

        await initDB();
        await saveTransaction(transaction);
        return true;
    } catch (err) {
        console.error('IndexedDB save failed, falling back to localStorage:', err);
        try {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            const transactions = data ? JSON.parse(data) : [];
            transactions.push(transaction);
            localStorage.setItem(LS_TRANSACTIONS_KEY, JSON.stringify(transactions));
            return true;
        } catch (lsErr) {
            console.error('localStorage also failed:', lsErr);
            return false;
        }
    }
};

// Safe save all transactions - NEVER throws
export const safeSaveAllTransactions = async (transactions: any[]): Promise<boolean> => {
    try {
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB not available, using localStorage');
            localStorage.setItem(LS_TRANSACTIONS_KEY, JSON.stringify(transactions));
            return true;
        }

        await initDB();
        await saveAllTransactions(transactions);
        return true;
    } catch (err) {
        console.error('IndexedDB save failed, falling back to localStorage:', err);
        try {
            // Only fallback to localStorage if data is small enough
            const jsonStr = JSON.stringify(transactions);
            if (jsonStr.length < 4 * 1024 * 1024) { // 4MB limit for safety
                localStorage.setItem(LS_TRANSACTIONS_KEY, jsonStr);
                return true;
            } else {
                console.warn('Data too large for localStorage fallback');
                return false;
            }
        } catch (lsErr) {
            console.error('localStorage also failed:', lsErr);
            return false;
        }
    }
};

// Safe delete transaction - NEVER throws
export const safeDeleteTransaction = async (id: string): Promise<boolean> => {
    try {
        if (!isIndexedDBAvailable()) {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            const transactions = data ? JSON.parse(data) : [];
            const filtered = transactions.filter((t: any) => t.id !== id);
            localStorage.setItem(LS_TRANSACTIONS_KEY, JSON.stringify(filtered));
            return true;
        }

        await initDB();
        await deleteTransaction(id);
        return true;
    } catch (err) {
        console.error('IndexedDB delete failed, falling back to localStorage:', err);
        try {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            const transactions = data ? JSON.parse(data) : [];
            const filtered = transactions.filter((t: any) => t.id !== id);
            localStorage.setItem(LS_TRANSACTIONS_KEY, JSON.stringify(filtered));
            return true;
        } catch {
            return false;
        }
    }
};

// Safe get transactions count - NEVER throws
export const safeGetTransactionsCount = async (): Promise<number> => {
    try {
        if (!isIndexedDBAvailable()) {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            return data ? JSON.parse(data).length : 0;
        }

        await initDB();
        return await getTransactionsCount();
    } catch {
        try {
            const data = localStorage.getItem(LS_TRANSACTIONS_KEY);
            return data ? JSON.parse(data).length : 0;
        } catch {
            return 0;
        }
    }
};

// Safe init and migrate - NEVER throws
export const safeInitAndMigrate = async (): Promise<{ success: boolean; migrated: number }> => {
    try {
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB not available');
            return { success: false, migrated: 0 };
        }

        await initDB();
        const result = await migrateFromLocalStorage();
        return { success: true, migrated: result.migrated };
    } catch (err) {
        console.error('Init/migrate failed:', err);
        return { success: false, migrated: 0 };
    }
};

