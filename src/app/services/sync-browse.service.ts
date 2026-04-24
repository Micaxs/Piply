import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SyncBrowseService {
  readonly enabled    = signal(false);
  readonly localRoot  = signal<string | null>(null);
  readonly remoteRoot = signal<string | null>(null);

  readonly syncScroll = signal(false);
  /** Scroll ratio (0–1) pushed by local pane; remote pane listens. */
  readonly localScrollRatio  = signal<number>(0);
  /** Scroll ratio (0–1) pushed by remote pane; local pane listens. */
  readonly remoteScrollRatio = signal<number>(0);

  enable(localPath: string, remotePath: string) {
    this.localRoot.set(localPath);
    this.remoteRoot.set(remotePath);
    this.enabled.set(true);
  }

  disable() {
    this.enabled.set(false);
    this.syncScroll.set(false);
    this.localRoot.set(null);
    this.remoteRoot.set(null);
  }

  /** Returns whether localPath is at or below the local sync root. */
  isLocalBelowRoot(localPath: string): boolean {
    const root = this.localRoot();
    if (!root) return true;
    return localPath === root || localPath.startsWith(root === '/' ? '/' : root + '/');
  }

  /** Given the current local path, return the corresponding remote path, or null if above root. */
  resolveRemotePath(localPath: string): string | null {
    const lr = this.localRoot();
    const rr = this.remoteRoot();
    if (!lr || !rr) return null;
    if (localPath !== lr && !localPath.startsWith(lr === '/' ? '/' : lr + '/')) return null;
    const rel = localPath.slice(lr.length).replace(/^\//, '');
    if (!rel) return rr;
    return (rr === '/' ? '' : rr) + '/' + rel;
  }

  /** Given the current remote path, return the corresponding local path, or null if above root. */
  resolveLocalPath(remotePath: string): string | null {
    const lr = this.localRoot();
    const rr = this.remoteRoot();
    if (!lr || !rr) return null;
    if (remotePath !== rr && !remotePath.startsWith(rr === '/' ? '/' : rr + '/')) return null;
    const rel = remotePath.slice(rr.length).replace(/^\//, '');
    if (!rel) return lr;
    return (lr === '/' ? '' : lr) + '/' + rel;
  }
}
