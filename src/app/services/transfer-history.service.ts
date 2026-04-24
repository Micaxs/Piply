import { Injectable, signal, inject, effect } from '@angular/core';
import { TransferService } from './transfer.service';

export interface HistoryEntry {
  id: string;
  fileName: string;
  localPath: string;
  remotePath: string;
  direction: 'Upload' | 'Download';
  size: number;
  status: 'Done' | 'Error' | 'Cancelled';
  errorMessage?: string;
  completedAt: string;
}

const STORAGE_KEY = 'piply_transfer_history';
const MAX_ENTRIES = 500;

@Injectable({ providedIn: 'root' })
export class TransferHistoryService {
  private transferSvc = inject(TransferService);
  readonly entries = signal<HistoryEntry[]>(this.loadFromStorage());
  private seenIds = new Set<string>(this.loadFromStorage().map(e => e.id));

  constructor() {
    effect(() => {
      const transfers = this.transferSvc.transfers();
      for (const t of transfers) {
        if (this.seenIds.has(t.id)) continue;
        if (t.status === 'Done' || t.status === 'Failed' || t.status === 'Cancelled') {
          this.seenIds.add(t.id);
          const status: 'Done' | 'Error' | 'Cancelled' =
            t.status === 'Done' ? 'Done' : t.status === 'Cancelled' ? 'Cancelled' : 'Error';
          const entry: HistoryEntry = {
            id: t.id,
            fileName: (t.localPath || t.remotePath).split('/').pop() ?? t.remotePath,
            localPath: t.localPath,
            remotePath: t.remotePath,
            direction: t.direction,
            size: t.totalBytes,
            status,
            errorMessage: t.error ?? undefined,
            completedAt: new Date().toISOString(),
          };
          this.entries.update(arr => {
            const updated = [entry, ...arr].slice(0, MAX_ENTRIES);
            this.saveToStorage(updated);
            return updated;
          });
        }
      }
    });
  }

  clearHistory() {
    this.entries.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  private loadFromStorage(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private saveToStorage(entries: HistoryEntry[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  }
}
