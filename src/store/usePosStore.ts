import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Product, CartItem } from '@/types/pos'
import { LS_KEYS } from '@/lib/utils'

interface PosState {
  cart: CartItem[]
  enablePPN: boolean

  // Actions
  addToCart: (product: Product) => void
  updateQuantity: (id: string, quantity: number) => void
  setItemPrice: (id: string, price: number) => void
  removeFromCart: (id: string) => void
  clearCart: () => void
  setEnablePPN: (value: boolean) => void
}

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

      return {
        cart: initialCart,
        enablePPN: initialPPN,

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
            return { cart: [...state.cart, { ...product, quantity: 1 }] }
          })
        },

        updateQuantity: (id, quantity) => {
          if (quantity <= 0) {
            set((state) => ({ cart: state.cart.filter((i) => i.id !== id) }))
          } else {
            set((state) => ({
              cart: state.cart.map((i) => (i.id === id ? { ...i, quantity } : i)),
            }))
          }
        },

        setItemPrice: (id, price) => {
          set((state) => ({
            cart: state.cart.map((i) => (i.id === id ? { ...i, price } : i)),
          }))
        },

        removeFromCart: (id) => set((state) => ({ cart: state.cart.filter((i) => i.id !== id) })),
        clearCart: () => set({ cart: [] }),

        setEnablePPN: (value) => set({ enablePPN: value }),
      }
    },
    {
      name: 'POS_STORE',
      version: 3, // Bump version to trigger migration
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        cart: state.cart,
        enablePPN: state.enablePPN,
      }),
      migrate: (persisted: any, version) => {
        // No shape change for now; ensure defaults
        return {
          cart: Array.isArray(persisted?.cart) ? persisted.cart : [],
          enablePPN: typeof persisted?.enablePPN === 'boolean' ? persisted.enablePPN : false,
        }
      },
    },
  ),
)
