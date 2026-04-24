import { Component, inject, OnInit, OnDestroy, effect, computed, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { invoke } from '@tauri-apps/api/core';
import { FileSystemService, LocalEntry, RemoteEntry } from '../../services/filesystem.service';
import { ConnectionService } from '../../services/connection.service';
import { TransferService } from '../../services/transfer.service';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { ConflictDialogComponent } from '../conflict-dialog/conflict-dialog.component';
import { RenameDialogComponent } from '../rename-dialog/rename-dialog.component';
import { MkdirDialogComponent } from '../mkdir-dialog/mkdir-dialog.component';
import { ComparisonService } from '../../services/comparison.service';
import { SyncBrowseService } from '../../services/sync-browse.service';
import { SettingsService } from '../../services/settings.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';

type SortCol = 'name' | 'size' | 'modified';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-local-browser',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatIconModule, MatButtonModule,
    MatTooltipModule, MatProgressSpinnerModule, MatDialogModule,
    MatMenuModule, MatDividerModule, FileTreeComponent,
  ],
  template: `
    <div class="browser-pane">
      <div class="pane-header">
        <mat-icon class="header-icon">computer</mat-icon>
        <span class="pane-title">Local</span>
        @if (fsSvc.localLoading()) { <mat-spinner diameter="16" /> }
      </div>

      <div class="path-bar">
        <button mat-icon-button (click)="goUp()" matTooltip="Go up">
          <mat-icon>arrow_upward</mat-icon>
        </button>
        <button mat-icon-button (click)="refresh()" matTooltip="Refresh">
          <mat-icon>refresh</mat-icon>
        </button>
        <input class="path-input" [value]="fsSvc.localPath()"
               (keydown.enter)="navigateTo($event)" spellcheck="false" />
      </div>

      <!-- Sync-browse out-of-root warning -->
      @if (syncWarnVisible()) {
        <div class="sync-warn-bar">
          <mat-icon class="sync-warn-icon">warning</mat-icon>
          <span>Navigating here will break synced browsing.</span>
          <button mat-button (click)="syncWarnCancel()">Cancel</button>
          <button mat-button class="warn-btn" (click)="syncWarnDisableAndNavigate()">Disable Sync &amp; Navigate</button>
        </div>
      }

      <div class="filter-bar">
        <mat-icon class="filter-icon">search</mat-icon>
        <input class="filter-input"
               [ngModel]="filterQuery()"
               (ngModelChange)="filterQuery.set($event)"
               placeholder="Filter files…" spellcheck="false" />
        @if (filterQuery()) {
          <button mat-icon-button class="filter-clear" (click)="filterQuery.set('')">
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>

      <div class="split-area" [class]="'tree-' + treePos()">
        @if (treePos() !== 'hidden') {
          <!-- File Tree -->
          <div class="tree-panel"
               [style.width.px]="treePos() !== 'top' ? treeWidth() : undefined"
               [style.height.px]="treePos() === 'top' ? treeHeight() : undefined">
            <app-file-tree
              mode="local"
              [rootPath]="treeRoot"
              [activePath]="fsSvc.localPath()"
              (pathSelected)="onTreeSelect($event)"
            />
          </div>
          <div class="inner-divider" (mousedown)="startTreeDrag($event)"></div>
        }

        <!-- File list -->
        <div class="table-wrapper" #tableWrapper [class.drag-over]="dragOverSelf()"
             tabindex="0"
             (keydown)="onKeyDown($event)"
             (scroll)="onTableScroll($event)"
             (dragover)="onTableDragOver($event)"
             (dragleave)="onTableDragLeave($event)"
             (drop)="onTableDrop($event)"
             (contextmenu)="onBgContextMenu($event)">
          <table mat-table [dataSource]="filteredEntries()" class="file-table">

            <ng-container matColumnDef="icon">
              <th mat-header-cell *matHeaderCellDef class="col-icon"></th>
              <td mat-cell *matCellDef="let e">
                <mat-icon class="file-icon" [class.dir-icon]="e.isDir">
                  {{ e.isDir ? 'folder' : 'insert_drive_file' }}
                </mat-icon>
              </td>
            </ng-container>

            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef class="sortable-header"
                  (click)="setSort('name')">
                Name
                <mat-icon class="sort-icon" *ngIf="sortCol() === 'name'">
                  {{ sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
                </mat-icon>
              </th>
              <td mat-cell *matCellDef="let e">{{ e.name }}</td>
            </ng-container>

            <ng-container matColumnDef="size">
              <th mat-header-cell *matHeaderCellDef class="sortable-header"
                  (click)="setSort('size')">
                Size
                <mat-icon class="sort-icon" *ngIf="sortCol() === 'size'">
                  {{ sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
                </mat-icon>
              </th>
              <td mat-cell *matCellDef="let e">{{ e.isDir ? '' : formatSize(e.size) }}</td>
            </ng-container>

            <ng-container matColumnDef="modified">
              <th mat-header-cell *matHeaderCellDef class="sortable-header"
                  (click)="setSort('modified')">
                Modified
                <mat-icon class="sort-icon" *ngIf="sortCol() === 'modified'">
                  {{ sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
                </mat-icon>
              </th>
              <td mat-cell *matCellDef="let e">{{ e.modified ?? '' }}</td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let e">
                @if (!e.isDir && session()) {
                  <button mat-icon-button matTooltip="Upload"
                          (click)="uploadFile(e); $event.stopPropagation()">
                    <mat-icon>upload</mat-icon>
                  </button>
                }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns; sticky: true"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"
                [class.clickable]="!row.phantom"
                [class.phantom-row]="row.phantom"
                [class.selected]="isSelected(row)"
                [class.cmp-yellow]="rowCompClass(row) === 'cmp-yellow'"
                [class.cmp-green]="rowCompClass(row) === 'cmp-green'"
                [class.cmp-red]="rowCompClass(row) === 'cmp-red'"
                [attr.draggable]="!row.phantom && row.name !== '..'"
                (dragstart)="onDragStart($event, row)"
                (click)="onRowClick(row, $event)"
                (dblclick)="onDoubleClick(row)"
                (contextmenu)="onContextMenu($event, row); $event.stopPropagation()"></tr>
          </table>
          @if (pendingCreate()) {
            <div class="pending-create-row">
              <mat-icon class="file-icon" [class.dir-icon]="pendingCreate()!.type === 'dir'">
                {{ pendingCreate()!.type === 'dir' ? 'folder' : 'insert_drive_file' }}
              </mat-icon>
              <input #pendingInput
                     class="pending-name-input"
                     [defaultValue]="pendingCreate()!.type === 'dir' ? 'New Folder' : 'new-file.txt'"
                     (keydown.enter)="commitCreate($event)"
                     (keydown.escape)="cancelCreate()"
                     (blur)="cancelCreate()" />
            </div>
          }
        </div>
      </div>
    </div>

    <!-- Context menu trigger (invisible anchor) -->
    <div style="position:fixed;visibility:hidden"
         [style.left.px]="ctxX" [style.top.px]="ctxY"
         [matMenuTriggerFor]="localCtxMenu"
         #ctxTrigger="matMenuTrigger"></div>

    <!-- Background context menu trigger -->
    <div style="position:fixed;visibility:hidden"
         [style.left.px]="ctxX" [style.top.px]="ctxY"
         [matMenuTriggerFor]="localBgMenu"
         #bgCtxTrigger="matMenuTrigger"></div>

    <mat-menu #localBgMenu="matMenu">
      <button mat-menu-item (click)="startCreate('dir')">
        <mat-icon>create_new_folder</mat-icon><span>New Folder</span>
      </button>
      <button mat-menu-item (click)="startCreate('file')">
        <mat-icon>note_add</mat-icon><span>New File</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="refresh()">
        <mat-icon>refresh</mat-icon><span>Refresh</span>
      </button>
    </mat-menu>

    <mat-menu #localCtxMenu="matMenu">
      <button mat-menu-item (click)="uploadSelected()" [disabled]="!session()">
        <mat-icon>upload</mat-icon><span>Upload</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="openSelected()">
        <mat-icon>open_in_new</mat-icon><span>Open</span>
      </button>
      <button mat-menu-item (click)="editSelected()">
        <mat-icon>edit</mat-icon><span>Edit</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="renameSelected()" [disabled]="selectedPaths().size !== 1">
        <mat-icon>drive_file_rename_outline</mat-icon><span>Rename</span>
      </button>
      <button mat-menu-item (click)="deleteSelected()">
        <mat-icon>delete</mat-icon><span>Delete</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="mkdirLocal()">
        <mat-icon>create_new_folder</mat-icon><span>Create Directory</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="refresh()">
        <mat-icon>refresh</mat-icon><span>Refresh</span>
      </button>
    </mat-menu>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
    .browser-pane  { display: flex; flex-direction: column; flex: 1; overflow: hidden; background: var(--ctp-base); }
    .pane-header   { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }
    .header-icon   { color: var(--ctp-blue); font-size: 18px; width: 18px; height: 18px; }
    .pane-title    { font-weight: 600; font-size: 13px; color: var(--ctp-text); flex: 1; }
    .path-bar      { display: flex; align-items: center; gap: 4px; padding: 3px 8px; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }

    .split-area    { display: flex; flex: 1; overflow: hidden; min-height: 0; }
    .split-area.tree-left, .split-area.tree-right { flex-direction: row; }
    .split-area.tree-top { flex-direction: column; }
    .split-area.tree-hidden { flex-direction: row; }

    .tree-left .tree-panel { order: 1; border-right: 1px solid var(--ctp-surface0); border-left: none; border-bottom: none; }
    .tree-left .inner-divider { order: 2; }
    .tree-left .table-wrapper { order: 3; }

    .tree-right .tree-panel { order: 3; border-left: 1px solid var(--ctp-surface0); border-right: none; border-bottom: none; }
    .tree-right .inner-divider { order: 2; }
    .tree-right .table-wrapper { order: 1; }

    .tree-top .tree-panel { width: 100% !important; border-bottom: 1px solid var(--ctp-surface0); border-right: none; order: 1; }
    .tree-top .inner-divider { order: 2; width: 100%; height: 4px; cursor: row-resize; }
    .tree-top .table-wrapper { order: 3; }

    .tree-panel    { flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; }
    .inner-divider { flex-shrink: 0; background: var(--ctp-surface0); cursor: col-resize; }
    .inner-divider:hover { background: var(--ctp-blue); }
    .tree-left .inner-divider, .tree-right .inner-divider { width: 3px; height: auto; }
    .tree-top .inner-divider { height: 4px; width: auto; }
    .table-wrapper { flex: 1; overflow-y: auto; min-height: 0; transition: box-shadow 0.15s; outline: none; }    .table-wrapper.drag-over { box-shadow: inset 0 0 0 2px var(--ctp-blue); background: rgba(137,180,250,0.06); }

    .file-table    { background: transparent; width: 100%; }
    .col-icon      { width: 32px; }
    .dir-icon      { color: var(--ctp-yellow) !important; }
    .file-icon     { color: var(--ctp-subtext0); font-size: 18px; width: 18px; height: 18px; }

    th.mat-mdc-header-cell {
      font-size: 11px; color: var(--ctp-subtext0);
      border-bottom-color: var(--ctp-surface0) !important;
      background: var(--ctp-mantle);
    }
    td.mat-mdc-cell {
      font-size: 12px; color: var(--ctp-text);
      border-bottom-color: var(--ctp-surface0) !important;
    }
    .sortable-header { cursor: pointer; user-select: none; }
    .sortable-header:hover { color: var(--ctp-text); }
    .sort-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; }
    tr.clickable:hover td { background: rgba(137,180,250,0.07); }
    tr.selected td { background: rgba(137,180,250,0.18) !important; }

    .cmp-yellow td { background: rgba(249,226,175,0.12) !important; }
    .cmp-green td  { background: rgba(166,227,161,0.12) !important; }
    .cmp-red td    { background: rgba(243,139,168,0.12) !important; }

    tr.phantom-row td { opacity: 0.38; pointer-events: none; cursor: default; font-style: italic; }
    tr.phantom-row:hover td { background: rgba(108,112,134,0.06) !important; }

    .sync-warn-bar {
      display: flex; align-items: center; gap: 8px; padding: 4px 12px;
      background: rgba(249,226,175,0.15); border-bottom: 1px solid rgba(249,226,175,0.4);
      flex-shrink: 0; font-size: 12px; color: var(--ctp-yellow);
    }
    .sync-warn-icon { font-size: 16px; width: 16px; height: 16px; }
    .sync-warn-bar span { flex: 1; }
    .warn-btn { color: var(--ctp-red) !important; }
    .filter-bar { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }
    .filter-icon { font-size: 14px; width: 14px; height: 14px; color: var(--ctp-overlay0); flex-shrink: 0; }
    .filter-input { flex: 1; height: 22px; padding: 0 4px; font-size: 12px; background: transparent; border: none; outline: none; color: var(--ctp-text); }
    .filter-input::placeholder { color: var(--ctp-overlay0); }
    .filter-clear { width: 20px !important; height: 20px !important; flex-shrink: 0; color: var(--ctp-overlay1) !important; }
    .pending-create-row {
      display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 16px;
      background: var(--ctp-surface0);
    }
    .pending-name-input {
      flex: 1; background: var(--ctp-base); border: 1px solid var(--ctp-blue);
      border-radius: 4px; color: var(--ctp-text); font-size: 13px; padding: 2px 6px; outline: none;
    }
  `],
})
export class LocalBrowserComponent implements OnInit, OnDestroy {
  fsSvc  = inject(FileSystemService);
  private connSvc = inject(ConnectionService);
  private transferSvc = inject(TransferService);
  private dialog = inject(MatDialog);
  compSvc  = inject(ComparisonService);
  syncSvc  = inject(SyncBrowseService);
  settingsSvc = inject(SettingsService);
  shortcutSvc = inject(KeyboardShortcutService);

  @ViewChild('ctxTrigger') ctxTrigger?: MatMenuTrigger;
  @ViewChild('bgCtxTrigger') bgCtxTrigger?: MatMenuTrigger;
  @ViewChild('tableWrapper') tableWrapper?: ElementRef<HTMLElement>;
  @ViewChild('pendingInput') pendingInput?: ElementRef<HTMLInputElement>;

  columns = ['icon', 'name', 'size', 'modified', 'actions'];
  treeRoot = '/';

  treePos = this.settingsSvc.treePosition;

  sortCol = signal<SortCol>('name');
  sortDir = signal<SortDir>('asc');
  filterQuery = signal('');
  pendingCreate = signal<{type: 'file' | 'dir'} | null>(null);
  treeWidth = signal(180);
  treeHeight = signal(180);
  selectedPaths = signal<Set<string>>(new Set());
  syncWarnVisible = signal(false);
  dragOverSelf = signal(false);
  private syncWarnTargetPath = '';
  ctxX = 0;
  ctxY = 0;
  private lastClickedIdx = -1;

  private treeDragging = false;
  private treeDragStartX = 0;
  private treeDragStartY = 0;
  private treeDragStartW = 0;
  private treeDragStartH = 0;

  sortedEntries = computed(() => {
    const localEntries = this.fsSvc.localEntries();
    const col = this.sortCol();
    const dir = this.sortDir();

    type DisplayEntry = LocalEntry & { phantom?: boolean };
    const merged: DisplayEntry[] = [...localEntries];

    if (this.compSvc.enabled()) {
      const remoteEntries = this.fsSvc.remoteEntries();
      const localNames = new Set(localEntries.map(e => e.name));
      for (const r of remoteEntries) {
        if (!localNames.has(r.name)) {
          merged.push({ name: r.name, path: '', size: r.size, isDir: r.isDir, modified: r.modified, phantom: true });
        }
      }
    }

    merged.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let cmp = 0;
      if (col === 'name')          cmp = a.name.localeCompare(b.name);
      else if (col === 'size')     cmp = (a.size ?? 0) - (b.size ?? 0);
      else if (col === 'modified') cmp = (a.modified ?? '').localeCompare(b.modified ?? '');
      return dir === 'asc' ? cmp : -cmp;
    });

    const path = this.fsSvc.localPath();
    if (path !== '/') {
      const parentPath = this.fsSvc.parentPath(path);
      merged.unshift({ name: '..', path: parentPath, size: null, isDir: true, modified: null });
    }
    return merged;
  });

  filteredEntries = computed(() => {
    const q = this.filterQuery().toLowerCase().trim();
    if (!q) return this.sortedEntries();
    return this.sortedEntries().filter(e => e.name === '..' || e.name.toLowerCase().includes(q));
  });

  private seenDoneIds = new Set<string>();
  private _applyingScroll = false;

  constructor() {
    effect(() => {
      const transfers = this.transferSvc.transfers();
      let needsRefresh = false;
      for (const t of transfers) {
        if (t.direction === 'Download' && t.status === 'Done' && !this.seenDoneIds.has(t.id)) {
          this.seenDoneIds.add(t.id);
          needsRefresh = true;
        }
      }
      if (needsRefresh) this.fsSvc.listLocal(this.fsSvc.localPath());
    });

    // Apply scroll position driven by remote pane
    effect(() => {
      const ratio = this.syncSvc.remoteScrollRatio();
      if (!this.syncSvc.syncScroll() || !this.syncSvc.enabled()) return;
      const el = this.tableWrapper?.nativeElement;
      if (!el) return;
      this._applyingScroll = true;
      el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight);
      requestAnimationFrame(() => { this._applyingScroll = false; });
    });

    document.addEventListener('mousemove', this.onTreeMouseMove);
    document.addEventListener('mouseup', this.onTreeMouseUp);
  }

  ngOnDestroy() {
    document.removeEventListener('mousemove', this.onTreeMouseMove);
    document.removeEventListener('mouseup', this.onTreeMouseUp);
  }

  private onTreeMouseMove = (e: MouseEvent) => {
    if (!this.treeDragging) return;
    const pos = this.treePos();
    if (pos === 'top') {
      const dy = e.clientY - this.treeDragStartY;
      this.treeHeight.set(Math.max(80, Math.min(400, this.treeDragStartH + dy)));
    } else if (pos === 'right') {
      const dx = e.clientX - this.treeDragStartX;
      this.treeWidth.set(Math.max(80, Math.min(400, this.treeDragStartW - dx)));
    } else {
      const dx = e.clientX - this.treeDragStartX;
      this.treeWidth.set(Math.max(80, Math.min(400, this.treeDragStartW + dx)));
    }
  };

  private onTreeMouseUp = () => { this.treeDragging = false; };

  startTreeDrag(e: MouseEvent) {
    e.preventDefault();
    this.treeDragging = true;
    this.treeDragStartX = e.clientX;
    this.treeDragStartY = e.clientY;
    this.treeDragStartW = this.treeWidth();
    this.treeDragStartH = this.treeHeight();
  }

  setSort(col: SortCol) {
    if (this.sortCol() === col) this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    else { this.sortCol.set(col); this.sortDir.set('asc'); }
  }

  session() { return this.connSvc.activeSession(); }

  async ngOnInit() { await this.fsSvc.listLocal('/'); }

  private async syncRemote(path: string) {
    const session = this.connSvc.activeSession();
    if (!session || !this.syncSvc.enabled()) return;
    const remotePath = this.syncSvc.resolveRemotePath(path);
    if (remotePath === null) return;
    await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, remotePath);
  }

  async navigateTo(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedPaths.set(new Set());
    const path = input.value.trim() || '/';
    if (this.syncSvc.enabled() && !this.syncSvc.isLocalBelowRoot(path)) {
      this.syncWarnTargetPath = path;
      this.syncWarnVisible.set(true);
      return;
    }
    await this.fsSvc.listLocal(path);
    await this.syncRemote(path);
  }

  async onDoubleClick(entry: LocalEntry) {
    if (entry.name === '..') { await this.goUp(); return; }
    if (entry.isDir) {
      this.selectedPaths.set(new Set());
      await this.fsSvc.listLocal(entry.path);
      await this.syncRemote(entry.path);
    } else {
      await this.uploadFile(entry);
    }
  }

  async onTreeSelect(path: string) {
    this.selectedPaths.set(new Set());
    if (this.syncSvc.enabled() && !this.syncSvc.isLocalBelowRoot(path)) {
      this.syncWarnTargetPath = path;
      this.syncWarnVisible.set(true);
      return;
    }
    await this.fsSvc.listLocal(path);
    await this.syncRemote(path);
  }

  async goUp() {
    this.selectedPaths.set(new Set());
    const path = this.fsSvc.parentPath(this.fsSvc.localPath());
    if (this.syncSvc.enabled() && !this.syncSvc.isLocalBelowRoot(path)) {
      this.syncWarnTargetPath = path;
      this.syncWarnVisible.set(true);
      return;
    }
    await this.fsSvc.listLocal(path);
    await this.syncRemote(path);
  }

  syncWarnCancel() { this.syncWarnVisible.set(false); }

  async syncWarnDisableAndNavigate() {
    this.syncSvc.disable();
    this.syncWarnVisible.set(false);
    await this.fsSvc.listLocal(this.syncWarnTargetPath);
  }

  async refresh() { await this.fsSvc.listLocal(this.fsSvc.localPath()); }

  onBgContextMenu(e: MouseEvent) {
    e.preventDefault();
    this.ctxX = e.clientX;
    this.ctxY = e.clientY;
    setTimeout(() => this.bgCtxTrigger?.openMenu(), 0);
  }

  startCreate(type: 'file' | 'dir') {
    this.pendingCreate.set({ type });
    setTimeout(() => {
      const input = this.pendingInput?.nativeElement;
      if (input) { input.focus(); input.select(); }
    }, 0);
  }

  async commitCreate(e: Event) {
    const input = e.target as HTMLInputElement;
    const name = input.value.trim();
    const pending = this.pendingCreate();
    this.pendingCreate.set(null);
    if (!name || !pending) return;
    const fullPath = this.fsSvc.joinPath(this.fsSvc.localPath(), name);
    if (pending.type === 'dir') {
      await invoke('mkdir_local', { path: fullPath }).catch(console.error);
    } else {
      await invoke('touch_local', { path: fullPath }).catch(console.error);
    }
    await this.refresh();
  }

  cancelCreate() {
    if (!this.pendingCreate()) return;
    this.pendingCreate.set(null);
  }

  onTableScroll(e: Event) {
    if (this._applyingScroll || !this.syncSvc.syncScroll() || !this.syncSvc.enabled()) return;
    const el = e.target as HTMLElement;
    const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    this.syncSvc.localScrollRatio.set(ratio);
  }

  isSelected(entry: LocalEntry & { phantom?: boolean }): boolean {
    return !entry.phantom && this.selectedPaths().has(entry.path);
  }

  onRowClick(entry: LocalEntry & { phantom?: boolean }, e: MouseEvent) {
    if (entry.phantom || entry.name === '..') return;
    // Focus the wrapper so keyboard shortcuts work
    this.tableWrapper?.nativeElement.focus({ preventScroll: true });
    const entries = this.sortedEntries();
    const idx = entries.findIndex(x => x.path === entry.path);
    if (e.ctrlKey || e.metaKey) {
      const s = new Set(this.selectedPaths());
      if (s.has(entry.path)) s.delete(entry.path); else s.add(entry.path);
      this.selectedPaths.set(s);
      this.lastClickedIdx = idx;
    } else if (e.shiftKey && this.lastClickedIdx >= 0) {
      const s = new Set<string>();
      const [a, b] = [Math.min(idx, this.lastClickedIdx), Math.max(idx, this.lastClickedIdx)];
      for (let i = a; i <= b; i++) { const en = entries[i]; if (!en.phantom) s.add(en.path); }
      this.selectedPaths.set(s);
    } else {
      this.selectedPaths.set(new Set([entry.path]));
      this.lastClickedIdx = idx;
    }
  }

  onContextMenu(e: MouseEvent, entry: LocalEntry & { phantom?: boolean }) {
    if (entry.phantom) return;
    e.preventDefault();
    if (!this.isSelected(entry)) {
      this.selectedPaths.set(new Set([entry.path]));
      this.lastClickedIdx = this.sortedEntries().findIndex(x => x.path === entry.path);
    }
    this.ctxX = e.clientX;
    this.ctxY = e.clientY;
    setTimeout(() => this.ctxTrigger?.openMenu(), 0);
  }

  rowCompClass(entry: LocalEntry & { phantom?: boolean }): string {
    if (entry.phantom) return 'cmp-yellow';
    const state = this.compSvc.getLocalState(entry, this.fsSvc.remoteEntries());
    if (!state || state === 'equal') return '';
    if (state === 'only-local') return 'cmp-yellow';
    if (state === 'newer-local') return 'cmp-green';
    if (state === 'size-diff') return 'cmp-red';
    return '';
  }

  async uploadSelected() {
    const entries = this.sortedEntries().filter(e => this.selectedPaths().has(e.path));
    for (const e of entries) await this.uploadFile(e);
  }

  async openSelected() {
    const paths = [...this.selectedPaths()];
    for (const p of paths) await invoke('open_local', { path: p }).catch(console.error);
  }

  async editSelected() {
    const paths = [...this.selectedPaths()];
    for (const p of paths) await invoke('open_local', { path: p }).catch(console.error);
  }

  async renameSelected() {
    if (this.selectedPaths().size !== 1) return;
    const [path] = [...this.selectedPaths()];
    const entry = this.sortedEntries().find(e => e.path === path);
    if (!entry) return;
    const ref = this.dialog.open(RenameDialogComponent, { data: { currentName: entry.name } });
    const newName = await ref.afterClosed().toPromise();
    if (!newName) return;
    await invoke('rename_local', { oldPath: path, newName }).catch(console.error);
    await this.refresh();
    this.selectedPaths.set(new Set());
  }

  async deleteSelected() {
    const paths = [...this.selectedPaths()];
    if (!paths.length) return;
    for (const p of paths) await invoke('delete_local', { path: p }).catch(console.error);
    await this.refresh();
    this.selectedPaths.set(new Set());
  }

  onKeyDown(e: KeyboardEvent) {
    // Don't fire when typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key;
    const get = (action: string) => this.shortcutSvc.getKey(action);
    if (key === get('delete'))  { e.preventDefault(); this.deleteSelected(); }
    if (key === get('rename'))  { e.preventDefault(); this.renameSelected(); }
    if (key === get('mkdir'))   { e.preventDefault(); this.mkdirLocal(); }
    if (key === get('upload'))  { e.preventDefault(); this.uploadSelected(); }
    if (key === get('refresh')) { e.preventDefault(); this.refresh(); }
  }

  async mkdirLocal() {
    const ref = this.dialog.open(MkdirDialogComponent);
    const name = await ref.afterClosed().toPromise();
    if (!name) return;
    const fullPath = this.fsSvc.joinPath(this.fsSvc.localPath(), name);
    await invoke('mkdir_local', { path: fullPath }).catch(console.error);
    await this.refresh();
  }

  async uploadFile(entry: LocalEntry) {
    const session = this.session();
    if (!session) return;
    const remotePath = this.fsSvc.joinPath(this.fsSvc.remotePath(), entry.name);
    const remoteExists = this.fsSvc.remoteEntries().some(e => !e.isDir && e.name === entry.name);
    if (remoteExists) {
      const ref = this.dialog.open(ConflictDialogComponent, { data: { fileName: entry.name } });
      const result = await ref.afterClosed().toPromise();
      if (!result || result.action === 'skip') return;
      const finalRemotePath = result.action === 'rename'
        ? this.fsSvc.joinPath(this.fsSvc.remotePath(), result.newName!)
        : remotePath;
      await this.transferSvc.upload(session.sessionId, session.profile.protocol, entry.path, finalRemotePath);
    } else {
      await this.transferSvc.upload(session.sessionId, session.profile.protocol, entry.path, remotePath);
    }
  }

  formatSize(bytes: number | null): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  onDragStart(e: DragEvent, entry: LocalEntry & { phantom?: boolean }) {
    if (entry.phantom || entry.name === '..') { e.preventDefault(); return; }
    const paths = this.selectedPaths().has(entry.path)
      ? [...this.selectedPaths()]
      : [entry.path];
    e.dataTransfer!.effectAllowed = 'copy';
    e.dataTransfer!.setData('application/x-piply-local', JSON.stringify(paths));
  }

  onTableDragOver(e: DragEvent) {
    if (!e.dataTransfer) return;
    if (e.dataTransfer.types.includes('application/x-piply-remote')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.dragOverSelf.set(true);
    }
  }

  onTableDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) this.dragOverSelf.set(false);
  }

  async onTableDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOverSelf.set(false);
    const data = e.dataTransfer?.getData('application/x-piply-remote');
    if (!data) return;
    const entries: RemoteEntry[] = JSON.parse(data);
    for (const entry of entries) await this.downloadFileFromRemote(entry);
    await this.refresh();
  }

  async downloadFileFromRemote(entry: RemoteEntry) {
    const session = this.session();
    if (!session) return;
    const remotePath = this.fsSvc.joinPath(this.fsSvc.remotePath(), entry.name);
    const localPath = this.fsSvc.joinPath(this.fsSvc.localPath(), entry.name);
    const localExists = await invoke<boolean>('file_exists', { path: localPath }).catch(() => false);
    if (localExists) {
      const ref = this.dialog.open(ConflictDialogComponent, { data: { fileName: entry.name } });
      const result = await ref.afterClosed().toPromise();
      if (!result || result.action === 'skip') return;
      const finalLocalPath = result.action === 'rename'
        ? this.fsSvc.joinPath(this.fsSvc.localPath(), result.newName!)
        : localPath;
      await this.transferSvc.download(session.sessionId, session.profile.protocol, remotePath, finalLocalPath, entry.size ?? undefined);
    } else {
      await this.transferSvc.download(session.sessionId, session.profile.protocol, remotePath, localPath, entry.size ?? undefined);
    }
  }
}
