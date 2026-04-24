import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FolderNode } from '../components/folder-tree/folder-tree.component';

export type Protocol = 'ftp' | 'sftp' | 'ftps';

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: Protocol;
  username: string;
  password: string;
  remotePath: string;
  folder: string[];
  keyId?: string;
}

export interface ActiveSession {
  sessionId: string;
  profile: ConnectionProfile;
}

@Injectable({ providedIn: 'root' })
export class ConnectionService {
  readonly connections = signal<ConnectionProfile[]>([]);
  readonly folders = signal<FolderNode[]>([]);
  readonly sessions = signal<ActiveSession[]>([]);
  readonly activeIndex = signal<number>(0);
  readonly activeSession = computed<ActiveSession | null>(() =>
    this.sessions()[this.activeIndex()] ?? null
  );

  /** Per-tab saved local directory path. */
  tabLocalPaths: string[] = [];
  private unlistenFn: UnlistenFn | null = null;

  constructor() {
    listen('piply-connections-changed', () => {
      void this.refreshState();
    }).then((fn) => {
      this.unlistenFn = fn;
    }).catch(() => {});
  }

  async loadConnections(): Promise<void> {
    try {
      // Try to load encrypted connections first
      const conns = await invoke<ConnectionProfile[]>('load_connections_encrypted');
      this.connections.set(conns);
    } catch (e) {
      console.error('Failed to load encrypted connections, falling back to plaintext:', e);
      // Fallback to old command for safety
      const conns = await invoke<ConnectionProfile[]>('get_connections');
      this.connections.set(conns);
    }
  }

  async loadFoldersTree(): Promise<void> {
    try {
      const folders = await invoke<FolderNode[]>('load_folders_nested');
      this.folders.set(folders);
    } catch (e) {
      console.error('Failed to load folders:', e);
      this.folders.set([]);
    }
  }

  async refreshState(): Promise<void> {
    await Promise.all([this.loadConnections(), this.loadFoldersTree()]);
  }

  async saveConnection(profile: ConnectionProfile): Promise<ConnectionProfile> {
    const saved = await invoke<ConnectionProfile>('save_connection', { profile });
    await this.refreshState();
    await emit('piply-connections-changed', null);
    return saved;
  }

  async deleteConnection(id: string): Promise<void> {
    await invoke('delete_connection', { id });
    await this.refreshState();
    await emit('piply-connections-changed', null);
  }

  /** Connect and ADD as a new tab (always adds, never replaces). */
  async connect(profile: ConnectionProfile): Promise<string> {
    const result = await invoke<{ sessionId: string }>('connect', {
      request: { profile },
    });
    const session: ActiveSession = { sessionId: result.sessionId, profile };
    this.sessions.update(s => [...s, session]);
    this.activeIndex.set(this.sessions().length - 1);
    return result.sessionId;
  }

  /** Connect and REPLACE the tab at the given index. */
  async connectInTab(profile: ConnectionProfile, tabIndex: number): Promise<string> {
    const existing = this.sessions()[tabIndex];
    if (existing) {
      try {
        await invoke('disconnect', {
          sessionId: existing.sessionId,
          protocol: existing.profile.protocol,
        });
      } catch {}
    }
    const result = await invoke<{ sessionId: string }>('connect', {
      request: { profile },
    });
    const session: ActiveSession = { sessionId: result.sessionId, profile };
    this.sessions.update(s => {
      const updated = [...s];
      updated[tabIndex] = session;
      return updated;
    });
    this.activeIndex.set(tabIndex);
    return result.sessionId;
  }

  /** Disconnect the session at the given tab index and remove the tab. */
  async disconnectAt(index: number): Promise<void> {
    const session = this.sessions()[index];
    if (!session) return;
    try {
      await invoke('disconnect', {
        sessionId: session.sessionId,
        protocol: session.profile.protocol,
      });
    } catch {}
    this.sessions.update(s => s.filter((_, i) => i !== index));
    const newLen = this.sessions().length;
    if (newLen === 0) {
      this.activeIndex.set(0);
    } else {
      this.activeIndex.set(Math.min(this.activeIndex(), newLen - 1));
    }
  }

  /** Disconnect the currently active session. */
  async disconnect(): Promise<void> {
    await this.disconnectAt(this.activeIndex());
  }

  setActiveIndex(index: number): void {
    if (index >= 0 && index < this.sessions().length) {
      this.activeIndex.set(index);
    }
  }

  async loadFoldersLegacy(): Promise<string[]> {
    try {
      return await invoke<string[]>('load_folders');
    } catch (e) {
      console.error('Failed to load folders:', e);
      return [];
    }
  }

  async addFolder(folder: string): Promise<string[]> {
    return await invoke<string[]>('add_folder', { folder });
  }

  async removeFolder(folder: string): Promise<string[]> {
    return await invoke<string[]>('remove_folder', { folder });
  }

  async renameFolder(oldName: string, newName: string): Promise<string[]> {
    return await invoke<string[]>('rename_folder', { oldName, newName });
  }

  async addFolderNested(parentPath: string[], name: string): Promise<any> {
    const folders = await invoke<FolderNode[]>('add_folder_nested', { parentPath, name });
    this.folders.set(folders);
    await emit('piply-connections-changed', null);
    return folders;
  }

  async removeFolderNested(path: string[]): Promise<any> {
    const folders = await invoke<FolderNode[]>('remove_folder_nested', { path });
    this.folders.set(folders);
    await emit('piply-connections-changed', null);
    return folders;
  }

  async renameFolderNested(path: string[], newName: string): Promise<any> {
    const folders = await invoke<FolderNode[]>('rename_folder_nested', { path, newName });
    this.folders.set(folders);
    await emit('piply-connections-changed', null);
    return folders;
  }

  async moveFolderNested(fromPath: string[], toParentPath: string[]): Promise<any> {
    const folders = await invoke<FolderNode[]>('move_folder_nested', { fromPath, toParentPath });
    this.folders.set(folders);
    await emit('piply-connections-changed', null);
    return folders;
  }
}
