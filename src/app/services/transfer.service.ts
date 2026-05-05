import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Protocol } from './connection.service';
import { FileSystemService } from './filesystem.service';

export type TransferStatus = 'Queued' | 'InProgress' | 'Paused' | 'Done' | 'Failed' | 'Cancelled';
export type TransferDirection = 'Upload' | 'Download';
export type TransferPriority = 'low' | 'medium' | 'high';

export interface TransferItem {
  id: string;
  sessionId: string;
  localPath: string;
  remotePath: string;
  direction: TransferDirection;
  status: TransferStatus;
  bytesTransferred: number;
  totalBytes: number;
  error: string | null;
  /** Monotonically increasing insertion index — used for stable queue ordering. */
  order: number;
}

export interface TransferProgressEvent {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  status: TransferStatus;
}

const ACTIVE: ReadonlySet<TransferStatus> = new Set(['Queued', 'InProgress', 'Paused']);
const TERMINAL: ReadonlySet<TransferStatus> = new Set(['Done', 'Failed', 'Cancelled']);

@Injectable({ providedIn: 'root' })
export class TransferService {
  readonly transfers = signal<TransferItem[]>([]);
  private unlistenFn: UnlistenFn | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Returns poll delay (ms) based on how many transfers are actively changing. */
  private nextPollDelay(): number {
    const active = this.transfers().filter(t => ACTIVE.has(t.status)).length;
    if (active > 500) return 2000;
    if (active > 100) return 750;
    return 300;
  }

  private priorityMap = new Map<string, TransferPriority>();
  readonly priorityOrder: Record<TransferPriority, number> = { high: 0, medium: 1, low: 2 };

  setPriority(transferId: string, priority: TransferPriority): void {
    this.priorityMap.set(transferId, priority);
    this.transfers.update(t => [...t]);
  }

  getPriority(transferId: string): TransferPriority {
    return this.priorityMap.get(transferId) ?? 'medium';
  }

  comparePriority(a: string, b: string): number {
    return this.priorityOrder[this.getPriority(a)] - this.priorityOrder[this.getPriority(b)];
  }

  constructor(private fs: FileSystemService) {}

  async startListening(): Promise<void> {
    if (this.unlistenFn) return;
    this.unlistenFn = await listen<TransferProgressEvent>('transfer-progress', (event) => {
      const update = event.payload;
      let completedSessionId: string | undefined;
      this.transfers.update((items) => {
        const idx = items.findIndex((t) => t.id === update.transferId);
        if (idx === -1) return items;
        const updated = [...items];
        const prev = updated[idx];
        updated[idx] = {
          ...prev,
          bytesTransferred: update.bytesTransferred,
          totalBytes: update.totalBytes,
          status: update.status,
        };
        if (update.status === 'Done' && prev.status !== 'Done') {
          completedSessionId = prev.sessionId;
        }
        return updated;
      });
      if (completedSessionId) {
        this.fs.invalidateRemoteCache(completedSessionId);
      }
    });
  }

  stopListening(): void {
    this.unlistenFn?.();
    this.unlistenFn = null;
    this.stopPolling();
  }

  /** Poll Rust at an adaptive rate while transfers are active; stops automatically. */
  private startPolling(): void {
    if (this.pollTimer !== null) return;
    const schedule = async () => {
      await this.refreshTransfers();
      const hasActive = this.transfers().some(t => ACTIVE.has(t.status));
      if (hasActive) {
        this.pollTimer = setTimeout(schedule, this.nextPollDelay());
      } else {
        this.pollTimer = null;
      }
    };
    this.pollTimer = setTimeout(schedule, this.nextPollDelay());
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async upload(
    sessionId: string,
    protocol: Protocol,
    localPath: string,
    remotePath: string
  ): Promise<string> {
    const transferId = await invoke<string>('upload', {
      sessionId,
      protocol,
      localPath,
      remotePath,
    });
    await this.refreshTransfers();
    this.startPolling();
    return transferId;
  }

  async download(
    sessionId: string,
    protocol: Protocol,
    remotePath: string,
    localPath: string,
    fileSize?: number
  ): Promise<string> {
    const transferId = await invoke<string>('download', {
      sessionId,
      protocol,
      remotePath,
      localPath,
      fileSize: fileSize ?? null,
    });
    await this.refreshTransfers();
    this.startPolling();
    return transferId;
  }

  async cancelTransfer(transferId: string): Promise<void> {
    await invoke('cancel_transfer', { transferId });
    await this.refreshTransfers();
  }

  async pauseTransfer(transferId: string): Promise<void> {
    await invoke('pause_transfer', { transferId });
    await this.refreshTransfers();
  }

  async resumeTransfer(transferId: string): Promise<void> {
    await invoke('resume_transfer', { transferId });
    await this.refreshTransfers();
  }

  async refreshTransfers(): Promise<void> {
    const prevItems = this.transfers();
    const items = await invoke<TransferItem[]>('get_transfer_status');

    // Detect newly completed transfers and invalidate remote cache
    const prevMap = new Map(prevItems.map(t => [t.id, t]));
    for (const item of items) {
      const prev = prevMap.get(item.id);
      if (item.status === 'Done' && (!prev || prev.status !== 'Done')) {
        this.fs.invalidateRemoteCache(item.sessionId);
      }
    }

    // Preserve terminal items that are no longer in the Rust response
    const incomingIds = new Set(items.map(t => t.id));
    const preserved = prevItems.filter(
      t => TERMINAL.has(t.status) && !incomingIds.has(t.id)
    );
    this.transfers.set([...items, ...preserved]);
  }

  progressPercent(item: TransferItem): number {
    if (!item.totalBytes) return 0;
    return Math.min(100, Math.round((item.bytesTransferred / item.totalBytes) * 100));
  }
}
