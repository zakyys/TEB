// React hook for using IndexedDB transactions
import { useState, useEffect, useCallback } from 'react';
import {
    initDB,
    getAllTransactions,
    saveTransaction,
    saveAllTransactions,
    deleteTransaction,
    migrateFromLocalStorage,
    getTransactionsCount,
} from './indexedDB';

interface Transaction {
    id: string;
    date: string;
    customer: string;
    total: number;
    status: 'completed' | 'pending' | 'cancelled' | 'refunded';
    items: Array<{
        name: string;
        quantity: number;
        price: number;
        type: 'product' | 'service';
        purchasePrice?: number;
        sku?: string;
    }>;
}

export function useTransactions() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Load transactions from IndexedDB
    const loadTransactions = useCallback(async () => {
        try {
            setLoading(true);

            // Initialize DB
            await initDB();

            // Migrate from localStorage if needed (first time)
            await migrateFromLocalStorage();

            // Get all transactions
            const data = await getAllTransactions();
            setTransactions(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load transactions:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Load on mount
    useEffect(() => {
        loadTransactions();
    }, [loadTransactions]);

    // Add new transaction
    const addTransaction = useCallback(async (transaction: Transaction) => {
        try {
            await saveTransaction(transaction);
            setTransactions(prev => [transaction, ...prev]);
        } catch (err) {
            console.error('Failed to add transaction:', err);
            throw err;
        }
    }, []);

    // Update transaction
    const updateTransaction = useCallback(async (transaction: Transaction) => {
        try {
            await saveTransaction(transaction);
            setTransactions(prev =>
                prev.map(t => t.id === transaction.id ? transaction : t)
            );
        } catch (err) {
            console.error('Failed to update transaction:', err);
            throw err;
        }
    }, []);

    // Delete transaction
    const removeTransaction = useCallback(async (id: string) => {
        try {
            await deleteTransaction(id);
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (err) {
            console.error('Failed to delete transaction:', err);
            throw err;
        }
    }, []);

    // Save all transactions (replace all)
    const saveAll = useCallback(async (newTransactions: Transaction[]) => {
        try {
            await saveAllTransactions(newTransactions);
            setTransactions(newTransactions);
        } catch (err) {
            console.error('Failed to save all transactions:', err);
            throw err;
        }
    }, []);

    // Get count
    const getCount = useCallback(async () => {
        return await getTransactionsCount();
    }, []);

    return {
        transactions,
        loading,
        error,
        loadTransactions,
        addTransaction,
        updateTransaction,
        removeTransaction,
        saveAll,
        getCount,
    };
}
