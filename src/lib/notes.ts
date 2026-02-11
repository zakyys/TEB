import { getFromLS, saveToLS } from './utils';

export interface Note {
    id: string;
    date: string; // ISO string - tanggal dibuat
    content: string;
    type: 'hutang' | 'pengingat' | 'belanja' | 'lainnya';
    customerName?: string; // Nama pelanggan (untuk hutang)
    amount?: number; // Jumlah hutang (opsional)
    priority: 'normal' | 'penting';
    completed: boolean;
    completedAt?: string; // ISO string - tanggal selesai
    editedAt?: string; // ISO string - tanggal terakhir diedit
    transactionId?: string; // ID Transaksi yang terkait
}

const NOTES_KEY = 'bengkel_notes';

export function getNotes(): Note[] {
    return getFromLS<Note[]>(NOTES_KEY, []);
}

export function getActiveNotes(): Note[] {
    return getNotes().filter(n => !n.completed);
}

export function getCompletedNotes(): Note[] {
    return getNotes().filter(n => n.completed);
}

export function getActiveNotesCount(): number {
    return getActiveNotes().length;
}

export function addNote(note: Omit<Note, 'id' | 'completed' | 'completedAt'>): Note {
    const notes = getNotes();
    const newNote: Note = {
        ...note,
        id: `NOTE-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        completed: false
    };
    notes.unshift(newNote); // Add to beginning
    saveToLS(NOTES_KEY, notes);
    return newNote;
}

export function completeNote(id: string): boolean {
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;

    notes[idx] = {
        ...notes[idx],
        completed: true,
        completedAt: new Date().toISOString()
    };
    saveToLS(NOTES_KEY, notes);
    return true;
}

export function reopenNote(id: string): boolean {
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;

    notes[idx] = {
        ...notes[idx],
        completed: false,
        completedAt: undefined
    };
    saveToLS(NOTES_KEY, notes);
    return true;
}

export function deleteNote(id: string): boolean {
    const notes = getNotes();
    const newNotes = notes.filter(n => n.id !== id);
    if (newNotes.length === notes.length) return false;
    saveToLS(NOTES_KEY, newNotes);
    return true;
}

export function deleteNoteByTransactionId(transactionId: string): boolean {
    if (!transactionId) return false;
    const notes = getNotes();
    const newNotes = notes.filter(n => n.transactionId !== transactionId);
    if (newNotes.length === notes.length) return false;
    saveToLS(NOTES_KEY, newNotes);
    return true;
}

export function updateNote(id: string, updates: Partial<Omit<Note, 'id'>>): boolean {
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;

    notes[idx] = { ...notes[idx], ...updates };
    saveToLS(NOTES_KEY, notes);
    return true;
}

// Get notes by type
export function getNotesByType(type: Note['type']): Note[] {
    return getNotes().filter(n => n.type === type);
}

// Get hutang (debt) notes yang belum lunas
export function getActiveHutang(): Note[] {
    return getNotes().filter(n => n.type === 'hutang' && !n.completed);
}

// Total hutang aktif
export function getTotalHutangAmount(): number {
    return getActiveHutang().reduce((sum, n) => sum + (n.amount || 0), 0);
}

// Menghapus semua catatan (kecuali hutang atau semuanya)
export function clearNotes(includeHutang: boolean = false): void {
    if (includeHutang) {
        saveToLS(NOTES_KEY, []);
    } else {
        const notes = getNotes();
        const nonHutangNotes = notes.filter(n => n.type === 'hutang');
        saveToLS(NOTES_KEY, nonHutangNotes);
    }
}

// Menghapus semua hutang
export function clearHutang(onlyCompleted: boolean = false): void {
    const notes = getNotes();
    let newNotes;
    if (onlyCompleted) {
        newNotes = notes.filter(n => !(n.type === 'hutang' && n.completed));
    } else {
        newNotes = notes.filter(n => n.type !== 'hutang');
    }
    saveToLS(NOTES_KEY, newNotes);
}
