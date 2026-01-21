export interface Product {
  id: string
  name: string
  price: number
  category: string
  type: 'product' | 'service'
  stock?: number
  sku?: string
  purchasePrice?: number
}

export interface CartItem extends Product {
  quantity: number
}

export interface ProfileData {
  id: string
  name: string
  email: string
  phone: string
  address: string
  workshopName: string
  avatarUrl?: string
}

