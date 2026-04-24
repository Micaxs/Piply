import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { Protocol } from './connection.service';

export interface LocalEntry {
  name: string;
  path: string;
  size: number | null;
  isDir: boolean;
  modified: string | null;
}

export interface RemoteEntry {
  name: string;
  size: number | null;
  isDir: boolean;
  modified: string | null;
  permissions: string | null;
}

interface CacheEntry {
  entries: RemoteEntry[];
  cachedAt: number;
}

@Injectable({ providedIn: 'root' })
export class FileSystemService {
  readonly localEntries = signal<LocalEntry[]>([]);
  readonly remoteEntries = signal<RemoteEntry[]>([]);
  readonly localPath = signal<string>('/');
  readonly remotePath = signal<string>('/');
  readonly localLoading = signal(false);
  readonly remoteLoading = signal(false);
  readonly remoteError = signal<string | null>(null);

  private remoteCache = new Map<string, CacheEntry>();
  private sessionRemoteState = new Map<string, { path: string; entries: RemoteEntry[] }>();

  async listLocal(path: string): Promise<void> {
    this.localLoading.set(true);
    try {
      const entries = await invoke<LocalEntry[]>('list_local', { path });
      this.localEntries.set(entries);
      this.localPath.set(path);
    } finally {
      this.localLoading.set(false);
    }
  }

  async listRemote(sessionId: string, protocol: Protocol, path: string): Promise<void> {
    const cacheKey = `${sessionId}:${path}`;
    const cached = this.remoteCache.get(cacheKey);

    if (cached) {
      // Instant display from cache — no loading spinner
      this.remoteEntries.set(cached.entries);
      this.remotePath.set(path);
      this.remoteError.set(null);
      this.sessionRemoteState.set(sessionId, { path, entries: cached.entries });

      // Background refresh to keep cache fresh
      invoke<RemoteEntry[]>('list_remote', { sessionId, protocol, path })
        .then((entries) => {
          this.remoteCache.set(cacheKey, { entries, cachedAt: Date.now() });
          if (this.remotePath() === path) {
            this.remoteEntries.set(entries);
            this.sessionRemoteState.set(sessionId, { path, entries });
          }
        })
        .catch(() => {
          // Keep cached data on background refresh failure
        });
    } else {
      // No cache — show loading spinner and fetch
      this.remoteLoading.set(true);
      this.remoteError.set(null);
      try {
        const entries = await invoke<RemoteEntry[]>('list_remote', {
          sessionId,
          protocol,
          path,
        });
        this.remoteCache.set(cacheKey, { entries, cachedAt: Date.now() });
        this.remoteEntries.set(entries);
        this.remotePath.set(path);
        this.sessionRemoteState.set(sessionId, { path, entries });
      } catch (e: any) {
        this.remoteError.set(e?.toString() ?? 'Unknown error');
      } finally {
        this.remoteLoading.set(false);
      }
    }
  }

  invalidateRemoteCache(sessionId?: string): void {
    if (sessionId) {
      const prefix = `${sessionId}:`;
      for (const key of this.remoteCache.keys()) {
        if (key.startsWith(prefix)) {
          this.remoteCache.delete(key);
        }
      }
    } else {
      this.remoteCache.clear();
    }
  }

  /** Restore remote state for a session (called when switching tabs). */
  restoreRemoteState(sessionId: string): void {
    const state = this.sessionRemoteState.get(sessionId);
    if (state) {
      this.remotePath.set(state.path);
      this.remoteEntries.set(state.entries);
      this.remoteError.set(null);
    } else {
      this.remotePath.set('/');
      this.remoteEntries.set([]);
    }
  }

  /** Clear remote state for a session (called on disconnect). */
  clearSessionState(sessionId: string): void {
    this.sessionRemoteState.delete(sessionId);
    const prefix = `${sessionId}:`;
    for (const key of this.remoteCache.keys()) {
      if (key.startsWith(prefix)) this.remoteCache.delete(key);
    }
  }

  parentPath(path: string): string {
    if (path === '/' || path === '') return '/';
    const trimmed = path.replace(/\/$/, '');
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.substring(0, idx);
  }

  joinPath(base: string, name: string): string {
    const b = base.replace(/\/$/, '');
    return `${b}/${name}`;
  }
}
