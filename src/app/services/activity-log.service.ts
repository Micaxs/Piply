import { Injectable, signal } from '@angular/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ActivityEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

const MAX_ENTRIES = 500;

@Injectable({ providedIn: 'root' })
export class ActivityLogService {
  readonly entries = signal<ActivityEntry[]>([]);
  private unlistenFn: UnlistenFn | null = null;

  async startListening(): Promise<void> {
    if (this.unlistenFn) return;
    this.unlistenFn = await listen<{ level: string; message: string }>('piply-activity-log', (event) => {
      const { level, message } = event.payload;
      const entry: ActivityEntry = {
        level: (level as 'info' | 'warn' | 'error') || 'info',
        message,
        timestamp: new Date().toISOString(),
      };
      this.entries.update(arr => [entry, ...arr].slice(0, MAX_ENTRIES));
    });
  }

  stopListening(): void {
    this.unlistenFn?.();
    this.unlistenFn = null;
  }

  clear() { this.entries.set([]); }
}
