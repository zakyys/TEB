import { getFromLS, saveToLS, LS_KEYS } from '@/lib/utils'

export interface ExchangeItem {
    sku: string
    name: string
    quantity: number
    price: number
}

export interface ExchangeRecord {
    id: string
    date: string // ISO string
    originalItem: ExchangeItem
    newItem: ExchangeItem
    priceDifference: number // positive = customer pays more, negative = refund
    notes?: string
    originalTransactionId?: string
    originalPurchaseDate?: string // ISO string - tanggal beli awal
}

const EXCHANGE_KEY = 'bengkel_exchanges'

export function getExchanges(): ExchangeRecord[] {
    return getFromLS<ExchangeRecord[]>(EXCHANGE_KEY, [])
}

export function addExchange(record: Omit<ExchangeRecord, 'id'>): ExchangeRecord {
    const exchanges = getExchanges()
    const newRecord: ExchangeRecord = {
        ...record,
        id: `EXC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    }
    exchanges.push(newRecord)
    saveToLS(EXCHANGE_KEY, exchanges)
    return newRecord
}

export function getExchangesByDateRange(startDate: string, endDate: string): ExchangeRecord[] {
    const exchanges = getExchanges()
    return exchanges.filter(e => {
        const d = e.date.split('T')[0]
        return d >= startDate && d <= endDate
    })
}

export function getExchangesToday(): ExchangeRecord[] {
    const today = new Date().toISOString().split('T')[0]
    return getExchangesByDateRange(today, today)
}

export function getExchangesThisWeek(): ExchangeRecord[] {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    return getExchangesByDateRange(weekStart.toISOString().split('T')[0], now.toISOString().split('T')[0])
}

export function getExchangesThisMonth(): ExchangeRecord[] {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return getExchangesByDateRange(monthStart.toISOString().split('T')[0], now.toISOString().split('T')[0])
}

export function deleteExchange(id: string): boolean {
    const exchanges = getExchanges()
    const newExchanges = exchanges.filter(e => e.id !== id)
    if (newExchanges.length === exchanges.length) return false
    saveToLS(EXCHANGE_KEY, newExchanges)
    return true
}

export function updateExchange(id: string, updates: Partial<ExchangeRecord>): boolean {
    const exchanges = getExchanges()
    const idx = exchanges.findIndex(e => e.id === id)
    if (idx === -1) return false
    exchanges[idx] = { ...exchanges[idx], ...updates }
    saveToLS(EXCHANGE_KEY, exchanges)
    return true
}

// Refund Log
export interface RefundRecord {
    id: string
    date: string // ISO string - tanggal tukar
    item: {
        sku: string
        name: string
        quantity: number
        price: number
    }
    total: number
    transactionId: string
    originalPurchaseDate?: string // ISO string - tanggal beli awal
    notes?: string
}

const REFUND_KEY = 'bengkel_refunds'

export function getRefunds(): RefundRecord[] {
    return getFromLS<RefundRecord[]>(REFUND_KEY, [])
}

export function addRefund(record: Omit<RefundRecord, 'id'>): RefundRecord {
    const refunds = getRefunds()
    const newRecord: RefundRecord = {
        ...record,
        id: `RFD-${Date.now().toString().substring(6)}`
    }
    refunds.push(newRecord)
    saveToLS(REFUND_KEY, refunds)
    return newRecord
}

