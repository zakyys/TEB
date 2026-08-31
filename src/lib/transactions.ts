import type { CartItem, Product } from '@/types/pos'
import { getFromLS, saveToLS, LS_KEYS, formatCurrency, getRelativeDateBadge } from '@/lib/utils'
import { setProducts as setCachedProducts } from '@/lib/productCache'
import { safeSaveTransaction, safeInitAndMigrate } from '@/lib/indexedDB'
import type { ProfileData } from '@/types/pos'

export interface CompleteTxParams {
  cart: CartItem[]
  products: Product[]
  paymentMethod: string
  amountPaid: number
  subtotal: number
  tax: number
  total: number
  discountPercent?: number
  discountAmount?: number
  customerName?: string
}

export interface CompleteTxResult {
  transaction: any
  updatedProducts: Product[]
}

export async function completeTransactionUtil(params: CompleteTxParams): Promise<CompleteTxResult> {
  const { cart, products, paymentMethod, amountPaid, subtotal, tax, total, discountPercent, discountAmount, customerName } = params
  if (!cart || cart.length === 0) throw new Error('Cart kosong')

  const customer = {
    id: `guest-${Date.now()}`,
    name: customerName || 'Pelanggan Umum',
    phone: '-',
  }

  const isCash = paymentMethod === 'cash'
  const change = isCash ? (amountPaid || 0) - total : 0

  const transaction = {
    id: `TRX-${Date.now().toString().substring(6)}-${Math.random().toString(36).substring(2, 6)}`,
    date: new Date().toISOString(),
    customer: customer.name,
    customerId: customer.id,
    subtotal,
    tax,
    total,
    discountPercent: discountPercent || 0,
    discountAmount: discountAmount || 0,
    isCashPayment: isCash,
    amountPaid: isCash ? amountPaid || 0 : 0,
    change,
    paymentMethod,
    status: 'completed' as const,
    items: cart.map((item) => {
      const prod = products.find((p) => p.id === item.id)
      return {
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        type: item.type,
        sku: item.sku,
        purchasePrice: prod?.purchasePrice || 0,
        isHutang: paymentMethod === 'hutang',
      }
    }),
  }

  // Update product stock
  const updatedProducts = [...products]
  cart.forEach((item) => {
    if (item.type === 'product') {
      const idx = updatedProducts.findIndex((p) => p.id === item.id)
      if (idx !== -1 && updatedProducts[idx].stock !== undefined) {
        updatedProducts[idx] = {
          ...updatedProducts[idx],
          stock: (updatedProducts[idx].stock || 0) - item.quantity,
        }
      }
    }
  })

  // Persist changes
  setCachedProducts(updatedProducts)

  // Save transaction to IndexedDB (safe - won't crash, auto fallback to localStorage)
  const saved = await safeSaveTransaction(transaction)
  if (!saved) {
    console.warn('Transaction saved to localStorage as fallback')
  }

  // Broadcast updates to any listeners (Dashboard, POS, Products pages)
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('pos:products:update', { detail: updatedProducts }))
      window.dispatchEvent(new CustomEvent('pos:transaction:complete', { detail: transaction }))
    }
  } catch { }

  return { transaction, updatedProducts }
}

export function generateTextReceipt(transactionData: any): string {
  const profile = getFromLS<ProfileData | null>(
    'bengkel_profile',
    {
      id: 'profile-1',
      name: 'Admin Toko',
      email: 'admin@tokobaut.com',
      phone: '081234567890',
      address: 'Alamat Toko Baut',
      workshopName: 'BAUT - APP KASIR',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=workshop',
    },
  )

  const receiptDate = new Date(transactionData.date);
  const dateText = `${receiptDate.toLocaleDateString('id-ID')} ${receiptDate.toLocaleTimeString('id-ID')}`;
  const relativeDateBadge = getRelativeDateBadge(transactionData.date);
  const todayText = relativeDateBadge ? ` • ${relativeDateBadge}` : '';

  let receiptContent = `
${(profile?.workshopName || 'BAUT - APP KASIR').padEnd(40)}
${(profile?.address || 'Alamat Toko').padEnd(40)}
Telp: ${(profile?.phone || 'Nomor Telepon Toko').padEnd(34)}

----------------------------------------

No. Transaksi: ${transactionData.id}
Tanggal: ${dateText}${todayText}
Pelanggan: ${transactionData.customer}
${transactionData.customerVehicle ? `Kendaraan: ${transactionData.customerVehicle}
` : ''}----------------------------------------

`

    ; (transactionData.items || []).forEach((item: any) => {
      const itemName = String(item.name || '').padEnd(25)
      const itemPrice = formatCurrency(item.price || 0)
      const itemQuantity = item.quantity || 0
      const lineTotal = formatCurrency((item.price || 0) * (item.quantity || 0))
      receiptContent += `${itemName}${itemQuantity} x ${itemPrice.padEnd(10)}${lineTotal}\n`
    })

  receiptContent += `\n----------------------------------------\n\nTotal: ${formatCurrency(transactionData.total || 0)}\n`

  if (transactionData.isCashPayment) {
    receiptContent += `Dibayar: ${formatCurrency(transactionData.amountPaid || 0)}\nKembalian: ${formatCurrency(transactionData.change || 0)}\n`
  }

  receiptContent += `\n----------------------------------------\n\nTerima kasih atas kunjungan Anda\nSilahkan datang kembali\n`

  return receiptContent
}

export function generateReceiptHtml(transactionData: any): string {
  const profile = getFromLS<ProfileData | null>(
    'bengkel_profile',
    {
      id: 'profile-1',
      name: 'Admin Toko',
      email: 'admin@tokobaut.com',
      phone: '081234567890',
      address: 'Alamat Toko Baut',
      workshopName: 'BAUT - APP KASIR',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=workshop',
    },
  )

  const itemsHtml = (transactionData.items || [])
    .map((item: any) => `
      <p style="margin: 0; display: flex; justify-content: space-between;">
        <span>${String(item.name || '')}</span>
        <span>${(item.quantity || 0)} x ${formatCurrency(item.price || 0)}</span>
      </p>
      <p style="margin: 0; text-align: right;">${formatCurrency((item.price || 0) * (item.quantity || 0))}</p>
    `)
    .join('')

  const paymentsHtml = transactionData.isCashPayment
    ? `
      <p style="margin: 0;">Dibayar: ${formatCurrency(transactionData.amountPaid || 0)}</p>
      <p style="margin: 0;">Kembalian: ${formatCurrency(transactionData.change || 0)}</p>
    `
    : ''

  const vehicleHtml = transactionData.customerVehicle
    ? `<p style="margin: 0;">Kendaraan: ${transactionData.customerVehicle}</p>`
    : ''

  return `
    <div style="padding: 20px; font-family: monospace; font-size: 12px; line-height: 1.5;">
      <div style="text-align: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 1.2em; font-weight: bold;">${profile?.workshopName || 'BAUT - APP KASIR'}</h3>
        <p style="margin: 0;">${profile?.address || 'Alamat Toko'}</p>
        <p style="margin: 0;">Telp: ${profile?.phone || 'Nomor Telepon Toko'}</p>
      </div>

      <div style="margin-bottom: 15px;">
        <p style="margin: 0;">No. Transaksi: ${transactionData.id}</p>
        <p style="margin: 0;">Tanggal: ${new Date(transactionData.date).toLocaleDateString('id-ID')} ${new Date(transactionData.date).toLocaleTimeString('id-ID')}${getRelativeDateBadge(transactionData.date) ? `  • ${getRelativeDateBadge(transactionData.date)}` : ''}</p>
        <p style="margin: 0;">Pelanggan: ${transactionData.customer}</p>
        ${vehicleHtml}
      </div>

      <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 10px 0; margin-bottom: 15px;">
        ${itemsHtml}
      </div>

      <div style="text-align: right; margin-bottom: 15px;">
        <h4 style="margin: 0; font-size: 1.1em; font-weight: bold;">Total: ${formatCurrency(transactionData.total || 0)}</h4>
        ${paymentsHtml}
      </div>

      <div style="text-align: center;">
        <p style="margin: 0;">Terima kasih atas kunjungan Anda</p>
        <p style="margin: 0;">Silahkan datang kembali</p>
      </div>
    </div>
  `
}
