import { Injectable, signal } from '@angular/core';

export interface ShortcutBinding {
  action: string;
  label: string;
  description: string;
  key: string;
}

const DEFAULTS: ShortcutBinding[] = [
  { action: 'connect',    label: 'Connect',         description: 'Open Connection Manager',   key: 'F2' },
  { action: 'disconnect', label: 'Disconnect',       description: 'Disconnect from server',    key: 'F3' },
  { action: 'refresh',    label: 'Refresh',          description: 'Refresh both panes',        key: 'F5' },
  { action: 'upload',     label: 'Upload',           description: 'Upload selected file',      key: 'F6' },
  { action: 'download',   label: 'Download',         description: 'Download selected file',    key: 'F7' },
  { action: 'delete',     label: 'Delete',           description: 'Delete selected',           key: 'Delete' },
  { action: 'rename',     label: 'Rename',           description: 'Rename selected',           key: 'F4' },
  { action: 'mkdir',      label: 'New Folder',       description: 'Create new directory',      key: 'F10' },
];

const STORAGE_KEY = 'piply_keyboard_shortcuts';

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  readonly bindings = signal<ShortcutBinding[]>(this.loadBindings());

  private loadBindings(): ShortcutBinding[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [...DEFAULTS];
      const saved: ShortcutBinding[] = JSON.parse(raw);
      return DEFAULTS.map(d => ({ ...d, ...(saved.find(s => s.action === d.action) ?? {}) }));
    } catch { return [...DEFAULTS]; }
  }

  saveBindings(bindings: ShortcutBinding[]) {
    this.bindings.set([...bindings]);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch {}
  }

  resetToDefaults() {
    this.bindings.set([...DEFAULTS]);
    localStorage.removeItem(STORAGE_KEY);
  }

  getKey(action: string): string | undefined {
    return this.bindings().find(b => b.action === action)?.key;
  }
}
