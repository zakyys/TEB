import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Product, CartItem } from '@/types/pos'
import { LS_KEYS } from '@/lib/utils'

interface PosState {
  cart: CartItem[]
  enablePPN: boolean
  // Diskon aktif keranjang dalam persen (0 = tidak aktif, boleh desimal mis. 1.67).
  // Box Rp di UI hanyalah tampilan/ekuivalen rupiah dari persen ini.
  discountPercent: number

  // Actions
  addToCart: (product: Product) => void
  updateQuantity: (id: string, quantity: number) => void
  setItemPrice: (id: string, price: number) => void
  removeFromCart: (id: string) => void
  clearCart: () => void
  setEnablePPN: (value: boolean) => void
  setDiscountPercent: (value: number) => void
  clearDiscount: () => void
}

// Hitung harga akhir satu barang dari harga acuan (basePrice) + diskon persen.
// Hasil dibulatkan ke rupiah terdekat (boleh selisih tipis dari hitungan exak).
export const computeFinalPrice = (basePrice: number, percent: number): number => {
  if (percent > 0) return Math.max(0, Math.round(basePrice * (1 - percent / 100)))
  return basePrice
}

const isDiscountActive = (percent: number) => percent > 0

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => {
      // One-time migration from legacy keys if POS_STORE not present
      let initialCart: CartItem[] = []
      let initialPPN = false
      try {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('POS_STORE')) {
          const read = (key: string) => {
            try {
              const v = localStorage.getItem(key)
              return v ? JSON.parse(v) : null
            } catch {
              return null
            }
          }
          const legacyCart = read(LS_KEYS.CART)
          const legacyPPN = read(LS_KEYS.ENABLE_PPN)
          if (Array.isArray(legacyCart)) initialCart = legacyCart
          if (typeof legacyPPN === 'boolean') initialPPN = legacyPPN

          // Optional: clean up old keys
          try {
            localStorage.removeItem(LS_KEYS.CART)
            localStorage.removeItem(LS_KEYS.ENABLE_PPN)
          } catch { }
        }
      } catch { }

      // Terapkan harga diskon ke seluruh cart.
      // Saat diskon aktif: price = harga setelah potong (basePrice tetap tersimpan).
      // Saat diskon nonaktif: price = basePrice.
      const recomputePrices = (cart: CartItem[], percent: number): CartItem[] =>
        cart.map((i) => ({
          ...i,
          basePrice: i.basePrice ?? i.price,
          price: isDiscountActive(percent)
            ? computeFinalPrice(i.basePrice ?? i.price, percent)
            : (i.basePrice ?? i.price),
        }))

      return {
        cart: initialCart,
        enablePPN: initialPPN,
        discountPercent: 0,

        addToCart: (product) => {
          set((state) => {
            const existing = state.cart.find((i) => i.id === product.id)
            if (existing) {
              // No stock limit - allow negative stock
              return {
                cart: state.cart.map((i) =>
                  i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
                ),
              }
            }
            // Barang baru langsung ikut diskon aktif (jika ada)
            const basePrice = product.price
            const price = isDiscountActive(state.discountPercent)
              ? computeFinalPrice(basePrice, state.discountPercent)
              : basePrice
            return { cart: [...state.cart, { ...product, quantity: 1, basePrice, price }] }
          })
        },

        updateQuantity: (id, quantity) => {
          if (quantity < 0) {
            // Only remove when quantity is negative (explicit delete action)
            set((state) => ({ cart: state.cart.filter((i) => i.id !== id) }))
          } else {
            // Allow 0 quantity - item stays in cart with 0 qty
            set((state) => ({
              cart: state.cart.map((i) => (i.id === id ? { ...i, quantity } : i)),
            }))
          }
        },

        // Edit manual harga. Hanya bisa dilakukan saat diskon nonaktif (box di-disable UI).
        // Harga yang diketik menjadi acuan diskon berikutnya.
        setItemPrice: (id, price) => {
          set((state) => ({
            cart: state.cart.map((i) =>
              i.id === id ? { ...i, price, basePrice: price } : i,
            ),
          }))
        },

        removeFromCart: (id) => set((state) => ({ cart: state.cart.filter((i) => i.id !== id) })),
        clearCart: () => set((state) => ({ cart: [], discountPercent: 0 })),

        setEnablePPN: (value) => set({ enablePPN: value }),

        setDiscountPercent: (value) => {
          const percent = Math.min(100, Math.max(0, value || 0))
          set((state) => ({
            discountPercent: percent,
            cart: recomputePrices(state.cart, percent),
          }))
        },

        clearDiscount: () => {
          set((state) => ({
            discountPercent: 0,
            cart: recomputePrices(state.cart, 0),
          }))
        },
      }
    },
    {
      name: 'POS_STORE',
      version: 5, // v5: diskon berbasis persen (box Rp = ekuivalen rupiah)
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        cart: state.cart,
        enablePPN: state.enablePPN,
        discountPercent: state.discountPercent,
      }),
      migrate: (persisted: any, version) => {
        const cart: CartItem[] = Array.isArray(persisted?.cart) ? persisted.cart : []
        return {
          cart: cart.map((i) => ({ ...i, basePrice: typeof i.basePrice === 'number' ? i.basePrice : i.price })),
          enablePPN: typeof persisted?.enablePPN === 'boolean' ? persisted.enablePPN : false,
          // Diskon tidak dibawa antar versi - selalu mulai nonaktif
          discountPercent: 0,
        }
      },
    },
  ),
)
