import { useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { registerSW } from 'virtual:pwa-register';

export function PWAStatus() {
    const { toast } = useToast();

    useEffect(() => {
        // Log PWA status to console instead of toasts
        console.log('[PWA] Sistem Offline Aktif');

        registerSW({
            onNeedRefresh() {
                console.log('[PWA] Versi baru tersedia');
            },
            onOfflineReady() {
                console.log('[PWA] Aplikasi siap digunakan offline');
            },
        });
    }, []);

    return null;
}


