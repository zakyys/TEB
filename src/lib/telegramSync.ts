/**
 * Telegram Auto-Sync Service for POS
 * Automatically syncs transactions to Telegram in background
 */

import { getConfig } from './utils';
import { safeGetAllTransactions } from './indexedDB';
import { getProducts } from './productCache';

const LS_KEY_CHANNEL_ID = 'TELEGRAM_CHANNEL_ID'
const LS_KEY_LAST_SYNC = 'TELEGRAM_LAST_SYNC'
const LS_KEY_AUTO_SYNC = 'TELEGRAM_AUTO_SYNC'

// Get API base with dynamic token
const getApiBase = () => `https://api.telegram.org/bot${getConfig().telegramBotToken}`

interface SyncData {
    date: string
    syncedAt: string
    products: any[]
    transactions: any[]
    profile: any
    stats: {
        totalTransactions: number
        totalRevenue: number
        totalItems: number
        totalProfit: number
    }
}

class POSTelegramAutoSync {
    private channelId: string | null = null
    private syncInterval: number | null = null

    constructor() {
        this.loadChannelId()
        // Auto-start sync if channel ID is set
        if (this.channelId && this.isAutoSyncEnabled()) {
            this.startAutoSync()
        }
    }

    private loadChannelId() {
        try {
            this.channelId = localStorage.getItem(LS_KEY_CHANNEL_ID)
        } catch (e) {
            console.error('Error loading channel ID:', e)
        }
    }

    setChannelId(id: string) {
        this.channelId = id
        localStorage.setItem(LS_KEY_CHANNEL_ID, id)
    }

    getChannelId(): string | null {
        return this.channelId
    }

    isAutoSyncEnabled(): boolean {
        return localStorage.getItem(LS_KEY_AUTO_SYNC) === 'true'
    }

    setAutoSync(enabled: boolean) {
        localStorage.setItem(LS_KEY_AUTO_SYNC, enabled ? 'true' : 'false')
        if (enabled) {
            this.startAutoSync()
        } else {
            this.stopAutoSync()
        }
    }

    getLastSync(): Date | null {
        const stored = localStorage.getItem(LS_KEY_LAST_SYNC)
        return stored ? new Date(stored) : null
    }

    private updateLastSync() {
        localStorage.setItem(LS_KEY_LAST_SYNC, new Date().toISOString())
    }

    /**
     * Start auto-sync (every 10 minutes)
     */
    startAutoSync(intervalMs: number = 10 * 60 * 1000) {
        if (this.syncInterval) return

        console.log('[Telegram Sync] Auto-sync started, interval:', intervalMs / 1000 / 60, 'minutes')

        // Sync immediately on start
        this.syncToTelegram()

        // Then sync every interval
        this.syncInterval = window.setInterval(() => {
            this.syncToTelegram()
        }, intervalMs)
    }

    stopAutoSync() {
        if (this.syncInterval) {
            window.clearInterval(this.syncInterval)
            this.syncInterval = null
            console.log('[Telegram Sync] Auto-sync stopped')
        }
    }

    /**
     * Get today's date string in YYYY-MM-DD format
     */
    private getTodayString(): string {
        const now = new Date()
        const offset = now.getTimezoneOffset()
        const local = new Date(now.getTime() - offset * 60_000)
        return local.toISOString().split('T')[0]
    }

    /**
   * Send JSON file to channel
   */
    private async sendJsonFile(data: object, filename: string, caption?: string): Promise<{ success: boolean; file_id: string | null }> {
        if (!this.channelId) return { success: false, file_id: null }

        try {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const formData = new FormData()
            formData.append('chat_id', this.channelId)
            formData.append('document', blob, filename)
            if (caption) formData.append('caption', caption)

            const response = await fetch(`${getApiBase()}/sendDocument`, {
                method: 'POST',
                body: formData,
            })
            const result = await response.json()

            if (result.ok && result.result?.document?.file_id) {
                // Save file_id for later retrieval by Backoffice
                const fileInfo = {
                    file_id: result.result.document.file_id,
                    filename: filename,
                    date: new Date().toISOString(),
                    message_id: result.result.message_id
                }
                localStorage.setItem('TELEGRAM_LAST_FILE', JSON.stringify(fileInfo))
                console.log('[Telegram Sync] File ID saved:', result.result.document.file_id)
                return { success: true, file_id: result.result.document.file_id }
            }

            return { success: result.ok === true, file_id: null }
        } catch (error) {
            console.error('[Telegram Sync] Error sending file:', error)
            return { success: false, file_id: null }
        }
    }

    /**
     * Sync current data to Telegram
     */
    async syncToTelegram(): Promise<{ success: boolean; file_id: string | null }> {
        if (!this.channelId) {
            console.log('[Telegram Sync] No channel ID set, skipping sync')
            return { success: false, file_id: null }
        }

        try {
            // Get data from localStorage and IndexedDB
            const products = getProducts()
            const transactions = await safeGetAllTransactions()
            const profile = JSON.parse(localStorage.getItem('bengkel_profile') || '{}')

            const today = this.getTodayString()

            // Filter today's completed transactions
            const todayTransactions = transactions.filter((t: any) =>
                t.date?.startsWith(today) && t.status === 'completed'
            )

            // Calculate stats with profit
            const totalRevenue = todayTransactions.reduce((sum: number, t: any) => sum + (t.total || 0), 0)
            const totalItems = todayTransactions.reduce((sum: number, t: any) =>
                sum + (t.items?.reduce((s: number, i: any) => s + (i.quantity || 0), 0) || 0), 0
            )

            // Calculate profit from items that have purchasePrice
            const totalProfit = todayTransactions.reduce((sum: number, t: any) => {
                const txProfit = t.items?.reduce((s: number, i: any) => {
                    const itemRevenue = (i.price || 0) * (i.quantity || 0)
                    const itemCost = (i.purchasePrice || 0) * (i.quantity || 0)
                    return s + (itemRevenue - itemCost)
                }, 0) || 0
                return sum + txProfit
            }, 0)

            // Prepare sync data
            const syncData: SyncData = {
                date: today,
                syncedAt: new Date().toISOString(),
                products,
                transactions: todayTransactions,
                profile,
                stats: {
                    totalTransactions: todayTransactions.length,
                    totalRevenue,
                    totalItems,
                    totalProfit
                }
            }

            // Send main data file
            const filename = `pos_data_${today}.json`
            const caption = `📊 POS Data Sync\n📅 ${today}\n💰 Omset: Rp ${totalRevenue.toLocaleString('id-ID')}\n📈 Profit: Rp ${totalProfit.toLocaleString('id-ID')}\n👥 ${todayTransactions.length} transaksi\n📦 ${totalItems} item`

            const result = await this.sendJsonFile(syncData, filename, caption)

            if (result.success) {
                this.updateLastSync()
                console.log('[Telegram Sync] Sync successful at', new Date().toLocaleTimeString())
            } else {
                console.error('[Telegram Sync] Sync failed')
            }

            return result
        } catch (error) {
            console.error('[Telegram Sync] Error:', error)
            return { success: false, file_id: null }
        }
    }

    /**
     * Trigger manual sync (can be called from anywhere)
     * Returns { success, file_id }
     */
    manualSync(): Promise<{ success: boolean; file_id: string | null }> {
        return this.syncToTelegram()
    }

    /**
     * Get the last sent file info
     */
    getLastFileInfo(): { file_id: string; filename: string; date: string } | null {
        try {
            const stored = localStorage.getItem('TELEGRAM_LAST_FILE')
            return stored ? JSON.parse(stored) : null
        } catch {
            return null
        }
    }
}

// Export singleton instance
export const telegramAutoSync = new POSTelegramAutoSync()

// Expose to window for easy access from console or other scripts
if (typeof window !== 'undefined') {
    (window as any).telegramSync = telegramAutoSync
}
