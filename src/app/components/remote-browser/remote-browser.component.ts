import { Component, inject, computed, signal, OnDestroy, OnInit, effect, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { FileSystemService, RemoteEntry } from '../../services/filesystem.service';
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
  selector: 'app-remote-browser',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatIconModule, MatButtonModule,
    MatTooltipModule, MatProgressSpinnerModule, MatDialogModule,
    MatMenuModule, MatDividerModule, FileTreeComponent,
  ],
  template: `
    <div class="browser-pane">
      <div class="pane-header">
        <mat-icon class="header-icon">cloud</mat-icon>
        <span class="pane-title">Remote</span>
        @if (fsSvc.remoteLoading()) { <mat-spinner diameter="16" /> }
      </div>

      <div class="path-bar">
        <button mat-icon-button (click)="goUp()" matTooltip="Go up" [disabled]="!session()">
          <mat-icon>arrow_upward</mat-icon>
        </button>
        <button mat-icon-button (click)="refresh()" matTooltip="Refresh" [disabled]="!session()">
          <mat-icon>refresh</mat-icon>
        </button>
        <input class="path-input" [value]="fsSvc.remotePath()"
               (keydown.enter)="navigateTo($event)"
               [disabled]="!session()" spellcheck="false" />
      </div>

      @if (!session()) {
        <div class="no-session">
          <mat-icon>cloud_off</mat-icon>
          <p>Not connected.<br/>Use the toolbar to connect.</p>
        </div>
      } @else if (fsSvc.remoteError()) {
        <div class="error-msg">
          <mat-icon>error</mat-icon>
          <p>{{ fsSvc.remoteError() }}</p>
          <button mat-stroked-button (click)="refresh()">Retry</button>
        </div>
      } @else {
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
            <!-- Remote file tree -->
            <div class="tree-panel"
                 [style.width.px]="treePos() !== 'top' ? treeWidth() : undefined"
                 [style.height.px]="treePos() === 'top' ? treeHeight() : undefined">
              <app-file-tree
                mode="remote"
                [rootPath]="'/'"
                [sessionId]="session()!.sessionId"
                [protocol]="session()!.profile.protocol"
                [activePath]="fsSvc.remotePath()"
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

              <ng-container matColumnDef="permissions">
                <th mat-header-cell *matHeaderCellDef>Perms</th>
                <td mat-cell *matCellDef="let e">{{ e.permissions ?? '' }}</td>
              </ng-container>

              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let e">
                  @if (!e.isDir) {
                    <button mat-icon-button matTooltip="Download"
                            (click)="downloadFile(e); $event.stopPropagation()">
                      <mat-icon>download</mat-icon>
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
      }
    </div>

    <!-- Context menu trigger (invisible anchor) -->
    <div style="position:fixed;visibility:hidden"
         [style.left.px]="ctxX" [style.top.px]="ctxY"
         [matMenuTriggerFor]="remoteCtxMenu"
         #ctxTrigger="matMenuTrigger"></div>

    <!-- Background context menu trigger -->
    <div style="position:fixed;visibility:hidden"
         [style.left.px]="ctxX" [style.top.px]="ctxY"
         [matMenuTriggerFor]="remoteBgMenu"
         #bgCtxTrigger="matMenuTrigger"></div>

    <mat-menu #remoteBgMenu="matMenu">
      <button mat-menu-item (click)="startCreate('dir')" [disabled]="!session()">
        <mat-icon>create_new_folder</mat-icon><span>New Folder</span>
      </button>
      <button mat-menu-item (click)="startCreate('file')" [disabled]="!session()">
        <mat-icon>note_add</mat-icon><span>New File</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="refresh()" [disabled]="!session()">
        <mat-icon>refresh</mat-icon><span>Refresh</span>
      </button>
    </mat-menu>

    <mat-menu #remoteCtxMenu="matMenu">
      <button mat-menu-item (click)="downloadSelected()">
        <mat-icon>download</mat-icon><span>Download</span>
      </button>
      <mat-divider />
      <button mat-menu-item disabled>
        <mat-icon>open_in_new</mat-icon><span>Open</span>
      </button>
      <button mat-menu-item disabled>
        <mat-icon>edit</mat-icon><span>Edit</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="renameSelected()" [disabled]="selectedNames().size !== 1">
        <mat-icon>drive_file_rename_outline</mat-icon><span>Rename</span>
      </button>
      <button mat-menu-item (click)="deleteSelected()">
        <mat-icon>delete</mat-icon><span>Delete</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="mkdirRemote()">
        <mat-icon>create_new_folder</mat-icon><span>Create Directory</span>
      </button>
      <mat-divider />
      <button mat-menu-item (click)="openPermissions()" [disabled]="!isPermissionsAvailable()">
        <mat-icon>lock</mat-icon><span>Permissions…</span>
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

    .tab-proto-icon { font-size: 14px; width: 14px; height: 14px; }
    .tab-close {
      width: 18px; height: 18px; border: none; cursor: pointer; border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
      background: transparent; color: var(--ctp-subtext0); padding: 0;
    }
    .tab-close mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .tab-close:hover { background: var(--ctp-red); color: var(--ctp-base); }

    .pane-header   { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }
    .header-icon   { color: var(--ctp-mauve); font-size: 18px; width: 18px; height: 18px; }
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
    .table-wrapper { flex: 1; overflow-y: auto; min-height: 0; transition: box-shadow 0.15s; outline: none; }    .table-wrapper.drag-over { box-shadow: inset 0 0 0 2px var(--ctp-mauve); background: rgba(203,166,247,0.06); }

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

    .filter-bar { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }
    .filter-icon { font-size: 14px; width: 14px; height: 14px; color: var(--ctp-overlay0); flex-shrink: 0; }
    .filter-input { flex: 1; height: 22px; padding: 0 4px; font-size: 12px; background: transparent; border: none; outline: none; color: var(--ctp-text); }
    .filter-input::placeholder { color: var(--ctp-overlay0); }
    .filter-clear { width: 20px !important; height: 20px !important; flex-shrink: 0; color: var(--ctp-overlay1) !important; }

    .no-session, .error-msg {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; flex: 1; gap: 12px;
    }
    .no-session { color: var(--ctp-overlay0); }
    .no-session mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.5; }
    .no-session p { text-align: center; font-size: 13px; color: var(--ctp-subtext0); }
    .error-msg { color: var(--ctp-red); }
    .error-msg mat-icon { font-size: 32px; width: 32px; height: 32px; }
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
export class RemoteBrowserComponent implements OnInit, OnDestroy {
  fsSvc = inject(FileSystemService);
  private connSvc = inject(ConnectionService);
  private transferSvc = inject(TransferService);
  private dialog = inject(MatDialog);
  compSvc  = inject(ComparisonService);
  syncSvc  = inject(SyncBrowseService);
  elRef = inject(ElementRef);
  settingsSvc = inject(SettingsService);
  shortcutSvc = inject(KeyboardShortcutService);

  @ViewChild('ctxTrigger') ctxTrigger?: MatMenuTrigger;
  @ViewChild('bgCtxTrigger') bgCtxTrigger?: MatMenuTrigger;
  @ViewChild('tableWrapper') tableWrapper?: ElementRef<HTMLElement>;
  @ViewChild('pendingInput') pendingInput?: ElementRef<HTMLInputElement>;

  columns = ['icon', 'name', 'size', 'modified', 'permissions', 'actions'];

  treePos = this.settingsSvc.treePosition;

  sortCol = signal<SortCol>('name');
  sortDir = signal<SortDir>('asc');
  filterQuery = signal('');
  pendingCreate = signal<{type: 'file' | 'dir'} | null>(null);
  treeWidth = signal(180);
  treeHeight = signal(180);
  selectedNames = signal<Set<string>>(new Set());
  dragOverSelf = signal(false);
  private unlistenDragDrop?: () => void;
  ctxX = 0;
  ctxY = 0;
  private lastClickedIdx = -1;

  private treeDragging = false;
  private treeDragStartX = 0;
  private treeDragStartY = 0;
  private treeDragStartW = 0;
  private treeDragStartH = 0;
  private seenDoneIds = new Set<string>();
  private _applyingScroll = false;

  sortedEntries = computed(() => {
    const remoteEntries = this.fsSvc.remoteEntries();
    const col = this.sortCol();
    const dir = this.sortDir();

    type DisplayEntry = RemoteEntry & { phantom?: boolean };
    const merged: DisplayEntry[] = [...remoteEntries];

    if (this.compSvc.enabled()) {
      const localEntries = this.fsSvc.localEntries();
      const remoteNames = new Set(remoteEntries.map(e => e.name));
      for (const l of localEntries) {
        if (!remoteNames.has(l.name)) {
          merged.push({ name: l.name, size: l.size, isDir: l.isDir, modified: l.modified, permissions: null, phantom: true });
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

    const path = this.fsSvc.remotePath();
    if (path !== '/') {
      merged.unshift({ name: '..', size: null, isDir: true, modified: null, permissions: null });
    }
    return merged;
  });

  filteredEntries = computed(() => {
    const q = this.filterQuery().toLowerCase().trim();
    if (!q) return this.sortedEntries();
    return this.sortedEntries().filter(e => e.name === '..' || e.name.toLowerCase().includes(q));
  });

  constructor() {
    effect(() => {
      const transfers = this.transferSvc.transfers();
      let needsRefresh = false;
      for (const t of transfers) {
        if (t.direction === 'Upload' && t.status === 'Done' && !this.seenDoneIds.has(t.id)) {
          this.seenDoneIds.add(t.id);
          needsRefresh = true;
        }
      }
      if (needsRefresh) {
        const session = this.session();
        if (session) {
          this.fsSvc.invalidateRemoteCache(session.sessionId);
          this.fsSvc.listRemote(session.sessionId, session.profile.protocol, this.fsSvc.remotePath());
        }
      }
    });

    // Apply scroll position driven by local pane
    effect(() => {
      const ratio = this.syncSvc.localScrollRatio();
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
    this.unlistenDragDrop?.();
  }

  async ngOnInit() {
    const webview = getCurrentWebview();
    this.unlistenDragDrop = await webview.onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        const rect = this.elRef.nativeElement.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const x = payload.position.x / scale;
        const y = payload.position.y / scale;
        const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (isOver) this.dragOverSelf.set(true);
        else this.dragOverSelf.set(false);
      } else if (payload.type === 'drop') {
        const rect = this.elRef.nativeElement.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const x = payload.position.x / scale;
        const y = payload.position.y / scale;
        this.dragOverSelf.set(false);
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const session = this.connSvc.activeSession();
          if (!session) return;
          for (const filePath of payload.paths) {
            const name = filePath.split('/').pop() || filePath;
            const remotePath = this.fsSvc.joinPath(this.fsSvc.remotePath(), name);
            await this.transferSvc.upload(session.sessionId, session.profile.protocol, filePath, remotePath);
          }
          await this.refresh();
        }
      } else if (payload.type === 'leave') {
        this.dragOverSelf.set(false);
      }
    });
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

  sessions = this.connSvc.sessions;
  activeIndex = this.connSvc.activeIndex;

  switchTab(index: number) {
    const session = this.connSvc.sessions()[index];
    if (!session) return;
    this.connSvc.setActiveIndex(index);
    this.fsSvc.restoreRemoteState(session.sessionId);
  }

  async closeTab(index: number, event: Event) {
    event.stopPropagation();
    const session = this.connSvc.sessions()[index];
    if (!session) return;
    this.fsSvc.clearSessionState(session.sessionId);
    await this.connSvc.disconnectAt(index);
    const active = this.connSvc.activeSession();
    if (active) {
      this.fsSvc.restoreRemoteState(active.sessionId);
    } else {
      this.fsSvc.remoteEntries.set([]);
      this.fsSvc.remotePath.set('/');
    }
  }

  isPermissionsAvailable(): boolean {
    const s = this.session();
    if (!s || s.profile.protocol !== 'sftp') return false;
    const names = this.selectedNames();
    return names.size === 1;
  }

  async openPermissions() {
    const s = this.session();
    if (!s || s.profile.protocol !== 'sftp') return;
    const names = Array.from(this.selectedNames());
    if (names.length !== 1) return;
    const name = names[0];
    const entry = this.fsSvc.remoteEntries().find(e => e.name === name);
    if (!entry) return;
    const permStr = entry.permissions ?? '100644';
    const mode = parseInt(permStr, 8);
    const modeVal = isNaN(mode) ? 0o644 : mode;
    const remotePath = this.fsSvc.remotePath().replace(/\/$/, '') + '/' + name;

    // Open permissions as a Tauri window
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('permissions');
    if (existing) { await existing.setFocus(); return; }
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}?window=permissions&file=${encodeURIComponent(name)}&mode=${modeVal}&path=${encodeURIComponent(remotePath)}&sessionId=${encodeURIComponent(s.sessionId)}&protocol=${encodeURIComponent(s.profile.protocol)}`;

    // Listen for the apply event before opening the window
    const unlisten = await listen<{ sessionId: string; protocol: string; path: string; mode: number }>('permissions-apply', async (event) => {
      unlisten();
      const { sessionId, protocol, path, mode: newMode } = event.payload;
      try {
        await invoke('chmod_remote', { sessionId, protocol, path, mode: newMode });
        await this.fsSvc.listRemote(s.sessionId, s.profile.protocol, this.fsSvc.remotePath());
      } catch (e) { console.error('chmod failed', e); }
    });

    new WebviewWindow('permissions', {
      url,
      title: `Permissions — ${name}`,
      width: 340,
      height: 300,
      minWidth: 300,
      minHeight: 260,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
    });
  }

  private async syncLocal(path: string) {
    if (!this.syncSvc.enabled()) return;
    const localPath = this.syncSvc.resolveLocalPath(path);
    if (localPath === null) return;
    await this.fsSvc.listLocal(localPath);
  }

  async navigateTo(event: Event) {
    const session = this.session();
    if (!session) return;
    const input = event.target as HTMLInputElement;
    this.selectedNames.set(new Set());
    const path = input.value.trim() || '/';
    await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, path);
    await this.syncLocal(path);
  }

  async onDoubleClick(entry: RemoteEntry) {
    const session = this.session();
    if (!session) return;
    if (entry.name === '..') { await this.goUp(); return; }
    if (entry.isDir) {
      this.selectedNames.set(new Set());
      const newPath = this.fsSvc.joinPath(this.fsSvc.remotePath(), entry.name);
      await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, newPath);
      await this.syncLocal(newPath);
    } else {
      await this.downloadFile(entry);
    }
  }

  async onTreeSelect(path: string) {
    const session = this.session();
    if (!session) return;
    this.selectedNames.set(new Set());
    await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, path);
    await this.syncLocal(path);
  }

  async goUp() {
    const session = this.session();
    if (!session) return;
    this.selectedNames.set(new Set());
    const parent = this.fsSvc.parentPath(this.fsSvc.remotePath());
    await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, parent);
    await this.syncLocal(parent);
  }

  async refresh() {
    const session = this.session();
    if (!session) return;
    this.fsSvc.invalidateRemoteCache(session.sessionId);
    await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, this.fsSvc.remotePath());
  }

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
    const session = this.session();
    if (!session) return;
    const fullPath = this.fsSvc.joinPath(this.fsSvc.remotePath(), name);
    if (pending.type === 'dir') {
      await invoke('mkdir_remote', { sessionId: session.sessionId, protocol: session.profile.protocol, path: fullPath }).catch(console.error);
    } else {
      await invoke('touch_remote', { sessionId: session.sessionId, protocol: session.profile.protocol, path: fullPath }).catch(console.error);
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
    this.syncSvc.remoteScrollRatio.set(ratio);
  }

  isSelected(entry: RemoteEntry & { phantom?: boolean }): boolean {
    return !entry.phantom && this.selectedNames().has(entry.name);
  }

  onRowClick(entry: RemoteEntry & { phantom?: boolean }, e: MouseEvent) {
    if (entry.phantom || entry.name === '..') return;
    // Focus wrapper so keyboard shortcuts work
    this.tableWrapper?.nativeElement.focus({ preventScroll: true });
    const entries = this.sortedEntries();
    const idx = entries.findIndex(x => x.name === entry.name);
    if (e.ctrlKey || e.metaKey) {
      const s = new Set(this.selectedNames());
      if (s.has(entry.name)) s.delete(entry.name); else s.add(entry.name);
      this.selectedNames.set(s);
      this.lastClickedIdx = idx;
    } else if (e.shiftKey && this.lastClickedIdx >= 0) {
      const s = new Set<string>();
      const [a, b] = [Math.min(idx, this.lastClickedIdx), Math.max(idx, this.lastClickedIdx)];
      for (let i = a; i <= b; i++) { const en = entries[i]; if (!en.phantom) s.add(en.name); }
      this.selectedNames.set(s);
    } else {
      this.selectedNames.set(new Set([entry.name]));
      this.lastClickedIdx = idx;
    }
  }

  onContextMenu(e: MouseEvent, entry: RemoteEntry & { phantom?: boolean }) {
    if (entry.phantom) return;
    e.preventDefault();
    if (!this.isSelected(entry)) {
      this.selectedNames.set(new Set([entry.name]));
      this.lastClickedIdx = this.sortedEntries().findIndex(x => x.name === entry.name);
    }
    this.ctxX = e.clientX;
    this.ctxY = e.clientY;
    setTimeout(() => this.ctxTrigger?.openMenu(), 0);
  }

  rowCompClass(entry: RemoteEntry & { phantom?: boolean }): string {
    if (entry.phantom) return 'cmp-yellow';
    const state = this.compSvc.getRemoteState(entry, this.fsSvc.localEntries());
    if (!state || state === 'equal') return '';
    if (state === 'only-remote') return 'cmp-yellow';
    if (state === 'newer-remote') return 'cmp-green';
    if (state === 'size-diff') return 'cmp-red';
    return '';
  }

  async downloadSelected() {
    const entries = this.sortedEntries().filter(e => this.selectedNames().has(e.name));
    for (const e of entries) await this.downloadFile(e);
  }

  async renameSelected() {
    if (this.selectedNames().size !== 1) return;
    const [name] = [...this.selectedNames()];
    const ref = this.dialog.open(RenameDialogComponent, { data: { currentName: name } });
    const newName = await ref.afterClosed().toPromise();
    if (!newName) return;
    const session = this.session();
    if (!session) return;
    const oldPath = this.fsSvc.joinPath(this.fsSvc.remotePath(), name);
    await invoke('rename_remote', {
      sessionId: session.sessionId,
      protocol: session.profile.protocol,
      oldPath,
      newName
    }).catch(console.error);
    await this.refresh();
    this.selectedNames.set(new Set());
  }

  async deleteSelected() {
    const session = this.session();
    if (!session) return;
    const entries = this.sortedEntries().filter(e => this.selectedNames().has(e.name));
    for (const e of entries) {
      const path = this.fsSvc.joinPath(this.fsSvc.remotePath(), e.name);
      await invoke('delete_remote', {
        sessionId: session.sessionId,
        protocol: session.profile.protocol,
        path,
        isDir: e.isDir
      }).catch(console.error);
    }
    await this.refresh();
    this.selectedNames.set(new Set());
  }

  async mkdirRemote() {
    const session = this.session();
    if (!session) return;
    const ref = this.dialog.open(MkdirDialogComponent);
    const name = await ref.afterClosed().toPromise();
    if (!name) return;
    const path = this.fsSvc.joinPath(this.fsSvc.remotePath(), name);
    await invoke('mkdir_remote', {
      sessionId: session.sessionId,
      protocol: session.profile.protocol,
      path
    }).catch(console.error);
    await this.refresh();
  }

  onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key;
    const get = (action: string) => this.shortcutSvc.getKey(action);
    if (key === get('delete'))   { e.preventDefault(); this.deleteSelected(); }
    if (key === get('rename'))   { e.preventDefault(); this.renameSelected(); }
    if (key === get('mkdir'))    { e.preventDefault(); this.mkdirRemote(); }
    if (key === get('download')) { e.preventDefault(); this.downloadSelected(); }
    if (key === get('refresh'))  { e.preventDefault(); this.refresh(); }
  }

  async downloadFile(entry: RemoteEntry) {
    const session = this.session();
    if (!session) return;
    const remotePath = this.fsSvc.joinPath(this.fsSvc.remotePath(), entry.name);
    const localPath = this.fsSvc.joinPath(this.fsSvc.localPath(), entry.name);
    const fileSize = entry.size ?? undefined;
    const localExists = await invoke<boolean>('file_exists', { path: localPath }).catch(() => false);
    if (localExists) {
      const ref = this.dialog.open(ConflictDialogComponent, { data: { fileName: entry.name } });
      const result = await ref.afterClosed().toPromise();
      if (!result || result.action === 'skip') return;
      const finalLocalPath = result.action === 'rename'
        ? this.fsSvc.joinPath(this.fsSvc.localPath(), result.newName!)
        : localPath;
      await this.transferSvc.download(session.sessionId, session.profile.protocol, remotePath, finalLocalPath, fileSize);
    } else {
      await this.transferSvc.download(session.sessionId, session.profile.protocol, remotePath, localPath, fileSize);
    }
  }

  onDragStart(e: DragEvent, entry: RemoteEntry & { phantom?: boolean }) {
    if (entry.phantom || entry.name === '..') { e.preventDefault(); return; }
    const names = this.selectedNames().has(entry.name)
      ? [...this.selectedNames()]
      : [entry.name];
    const entries = this.fsSvc.remoteEntries().filter(r => names.includes(r.name));
    e.dataTransfer!.effectAllowed = 'copy';
    e.dataTransfer!.setData('application/x-piply-remote', JSON.stringify(entries));
  }

  onTableDragOver(e: DragEvent) {
    if (!e.dataTransfer) return;
    const hasLocal = e.dataTransfer.types.includes('application/x-piply-local');
    const hasFiles = e.dataTransfer.types.includes('Files');
    if (hasLocal || hasFiles) {
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
    const data = e.dataTransfer?.getData('application/x-piply-local');
    if (!data) return;
    const paths: string[] = JSON.parse(data);
    const session = this.session();
    if (!session) return;
    for (const localPath of paths) {
      const name = localPath.split('/').pop() || localPath;
      const remotePath = this.fsSvc.joinPath(this.fsSvc.remotePath(), name);
      const localEntry = this.fsSvc.localEntries().find(en => en.path === localPath);
      if (localEntry) {
        const remoteExists = this.fsSvc.remoteEntries().some(r => !r.isDir && r.name === name);
        if (remoteExists) {
          const ref = this.dialog.open(ConflictDialogComponent, { data: { fileName: name } });
          const result = await ref.afterClosed().toPromise();
          if (!result || result.action === 'skip') continue;
          const finalRemotePath = result.action === 'rename'
            ? this.fsSvc.joinPath(this.fsSvc.remotePath(), result.newName!)
            : remotePath;
          await this.transferSvc.upload(session.sessionId, session.profile.protocol, localPath, finalRemotePath);
        } else {
          await this.transferSvc.upload(session.sessionId, session.profile.protocol, localPath, remotePath);
        }
      }
    }
  }

  formatSize(bytes: number | null): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }
}
