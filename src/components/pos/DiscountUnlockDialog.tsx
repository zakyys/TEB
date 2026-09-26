import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tag } from "lucide-react";

/**
 * Dialog panduan saat kasir men-tap box harga yang terkunci karena diskon
 * keranjang aktif. Mengubah dead-end (input disabled tanpa penjelasan di HP)
 * menjadi aksi terpandu: konfirmasi hapus diskon lalu langsung bisa edit harga.
 */
interface DiscountUnlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nama barang yang harganya mau diedit (opsional) */
  itemName?: string | null;
  /** Persen diskon keranjang yang sedang aktif */
  discountPercent: number;
  /** Dipanggil saat kasir menyetujui hapus diskon */
  onConfirm: () => void;
}

// Format persen: bulat jika bisa (10 -> "10"), else max 2 desimal (1.67 -> "1.67")
export const formatDiscountPercent = (p: number): string =>
  p % 1 === 0 ? String(p) : String(parseFloat(p.toFixed(2)));

const DiscountUnlockDialog: React.FC<DiscountUnlockDialogProps> = ({
  open,
  onOpenChange,
  itemName,
  discountPercent,
  onConfirm,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4 text-red-500" />
            Harga terkunci oleh diskon
          </DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed">
            Diskon <span className="font-bold text-red-600">{formatDiscountPercent(discountPercent)}%</span> sedang
            aktif, jadi semua harga otomatis menyesuaikan.
            {itemName ? (
              <>
                {" "}Untuk mengubah harga <span className="font-semibold">{itemName}</span> secara manual,
              </>
            ) : (
              " Untuk mengubah harga secara manual,"
            )}{" "}
            diskon keranjang perlu dinonaktifkan dulu.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            className="flex-1 bg-red-500 hover:bg-red-600 text-white"
            onClick={onConfirm}
          >
            Ya, Hapus Diskon &amp; Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DiscountUnlockDialog;
