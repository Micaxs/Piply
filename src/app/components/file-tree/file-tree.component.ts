import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { invoke } from '@tauri-apps/api/core';
import { Protocol } from '../../services/connection.service';

export interface TreeFlatNode {
  name: string;
  path: string;
  level: number;
  expanded: boolean;
  loading: boolean;
  hasChildren: boolean | null; // null = unknown (not yet fetched)
}

@Component({
  selector: 'app-file-tree',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="tree-scroll">
      @for (node of nodes(); track node.path + ':' + node.level) {
        <div class="tree-node" [class.selected]="selectedPath() === node.path"
             [style.padding-left]="(node.level * 16 + 2) + 'px'">
          <button class="toggle-btn" (click)="toggle(node)" [style.visibility]="node.hasChildren === false ? 'hidden' : 'visible'">
            @if (node.loading) {
              <mat-spinner diameter="12" />
            } @else {
              <mat-icon class="chevron">{{ node.expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
            }
          </button>
          <mat-icon class="folder-ic">{{ node.expanded ? 'folder_open' : 'folder' }}</mat-icon>
          <button class="node-label" (click)="select(node)">{{ node.name }}</button>
        </div>
      }
      @if (nodes().length === 0 && !rootLoading()) {
        <div class="tree-empty">No folders</div>
      }
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
    .tree-scroll  { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; background: var(--ctp-mantle); }
    .tree-node    { display: flex; align-items: center; min-height: 26px; cursor: default; user-select: none; }
    .tree-node:hover { background: var(--ctp-surface0); }
    .tree-node.selected { background: rgba(137,180,250,0.16); }
    .toggle-btn   { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; cursor: pointer; color: var(--ctp-overlay1); }
    .chevron      { font-size: 16px; width: 16px; height: 16px; }
    .folder-ic    { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-yellow); flex-shrink: 0; }
    .node-label   { flex: 1; background: none; border: none; text-align: left; color: var(--ctp-text); font-size: 12px; cursor: pointer; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .node-label:hover { color: var(--ctp-blue); }
    .tree-empty   { font-size: 11px; color: var(--ctp-overlay0); padding: 8px 12px; }
  `],
})
export class FileTreeComponent implements OnChanges {
  @Input() mode: 'local' | 'remote' = 'local';
  @Input() rootPath = '/';
  @Input() activePath = '';
  @Input() sessionId?: string;
  @Input() protocol?: Protocol;
  @Output() pathSelected = new EventEmitter<string>();

  nodes = signal<TreeFlatNode[]>([]);
  selectedPath = signal<string>('/');
  rootLoading = signal(false);

  async ngOnChanges(changes: SimpleChanges) {
    const pathChanged = changes['rootPath'];
    const sessionChanged = changes['sessionId'];
    if (pathChanged || sessionChanged) {
      await this.loadRoot();
    }
    if (changes['activePath'] && this.activePath) {
      this.revealPath(this.activePath);
    }
  }

  async loadRoot() {
    this.rootLoading.set(true);
    const dirs = await this.fetchDirs(this.rootPath);
    this.nodes.set(dirs.map(d => ({ ...d, level: 0, expanded: false, loading: false, hasChildren: null })));
    this.rootLoading.set(false);
  }

  async toggle(node: TreeFlatNode) {
    if (node.loading) return;
    if (node.expanded) {
      this.collapse(node);
    } else {
      await this.expand(node);
    }
  }

  async revealPath(targetPath: string) {
    const target = targetPath.replace(/\/$/, '') || '/';
    this.selectedPath.set(target);

    const rootPath = this.rootPath.replace(/\/$/, '') || '/';
    if (target === '/' || target === rootPath) return;

    // Build ancestor paths between rootPath and target (exclude rootPath and target itself)
    const rootNorm = rootPath === '/' ? '' : rootPath;
    const suffix = target.slice(rootNorm.length); // e.g. '/home/mica/docs'
    const parts = suffix.split('/').filter(p => p.length > 0);

    // ancestors: all prefixes of target except target itself
    const ancestors: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      ancestors.push(rootNorm + '/' + parts.slice(0, i + 1).join('/'));
    }

    for (let i = 0; i < ancestors.length; i++) {
      const anc = ancestors[i];
      const level = i;
      const node = this.nodes().find(n => n.path === anc && n.level === level);
      if (!node) break;
      if (!node.expanded) await this.expand(node);
    }
  }

  protected async expand(node: TreeFlatNode) {
    // Mark as loading
    this.nodes.update(arr =>
      arr.map(n => n === node ? { ...n, loading: true } : n)
    );

    const dirs = await this.fetchDirs(node.path);
    const children: TreeFlatNode[] = dirs.map(d => ({
      ...d, level: node.level + 1, expanded: false, loading: false, hasChildren: null
    }));

    this.nodes.update(arr => {
      const idx = arr.indexOf(arr.find(n => n.path === node.path && n.level === node.level)!);
      if (idx === -1) return arr;
      const updated = [...arr];
      updated[idx] = { ...updated[idx], loading: false, expanded: true, hasChildren: children.length > 0 };
      updated.splice(idx + 1, 0, ...children);
      return updated;
    });
  }

  private collapse(node: TreeFlatNode) {
    this.nodes.update(arr => {
      const idx = arr.findIndex(n => n.path === node.path && n.level === node.level);
      if (idx === -1) return arr;
      let end = idx + 1;
      while (end < arr.length && arr[end].level > node.level) end++;
      return [
        ...arr.slice(0, idx),
        { ...arr[idx], expanded: false },
        ...arr.slice(end),
      ];
    });
  }

  async select(node: TreeFlatNode) {
    this.selectedPath.set(node.path);
    this.pathSelected.emit(node.path);
    await this.toggle(node);
  }

  private async fetchDirs(path: string): Promise<{ name: string; path: string }[]> {
    try {
      let entries: any[];
      if (this.mode === 'local') {
        entries = await invoke<any[]>('list_local', { path });
      } else if (this.sessionId && this.protocol) {
        entries = await invoke<any[]>('list_remote', {
          sessionId: this.sessionId, protocol: this.protocol, path
        });
      } else {
        return [];
      }
      return entries
        .filter(e => e.isDir && e.name !== '.' && e.name !== '..')
        .map(e => ({
          name: e.name,
          path: this.mode === 'local'
            ? e.path
            : (path === '/' ? '/' + e.name : path.replace(/\/$/, '') + '/' + e.name),
        }));
    } catch {
      return [];
    }
  }
}
