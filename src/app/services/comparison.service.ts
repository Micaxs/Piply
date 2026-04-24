import { Injectable, signal } from '@angular/core';
import { LocalEntry, RemoteEntry } from './filesystem.service';

export type ComparisonState = 'only-local' | 'only-remote' | 'newer-local' | 'newer-remote' | 'size-diff' | 'equal' | null;

@Injectable({ providedIn: 'root' })
export class ComparisonService {
  readonly enabled = signal(false);

  toggle() { this.enabled.update(v => !v); }

  getLocalState(entry: LocalEntry, remoteEntries: RemoteEntry[]): ComparisonState {
    if (!this.enabled()) return null;
    const remote = remoteEntries.find(r => r.name === entry.name && !r.isDir === !entry.isDir);
    if (!remote) return 'only-local';
    if (entry.size != null && remote.size != null && entry.size !== remote.size) return 'size-diff';
    if (entry.modified && remote.modified) {
      if (entry.modified > remote.modified) return 'newer-local';
      if (entry.modified < remote.modified) return 'newer-remote';
    }
    return 'equal';
  }

  getRemoteState(entry: RemoteEntry, localEntries: LocalEntry[]): ComparisonState {
    if (!this.enabled()) return null;
    const local = localEntries.find(l => l.name === entry.name && !l.isDir === !entry.isDir);
    if (!local) return 'only-remote';
    if (entry.size != null && local.size != null && entry.size !== local.size) return 'size-diff';
    if (entry.modified && local.modified) {
      if (entry.modified > local.modified) return 'newer-remote';
      if (entry.modified < local.modified) return 'newer-local';
    }
    return 'equal';
  }
}
