import { Component, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { ConnectionProfile } from '../../services/connection.service';

export interface FolderNode {
  name: string;
  children?: FolderNode[];
}

export interface FolderEvent {
  path: string[];
  event?: Event;
}

export interface ConnectionEvent {
  connection: ConnectionProfile;
  event?: Event;
}

@Component({
  selector: 'app-folder-tree-node',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="folder-item"
         [class.drag-over]="dragOverPath() === pathStr()"
         [class.selected]="selectedPath() === pathStr()"
         [style.margin-left.px]="level() * 12"
         draggable="true"
         (click)="onNodeClick()"
         (contextmenu)="onNodeContext($event)"
         (dragstart)="onNodeDragStart($event)"
         (dragend)="onNodeDragEnd()"
         (dragover)="onNodeDragOver($event)"
         (dragleave)="onNodeDragLeave($event)"
         (drop)="onNodeDrop($event)">
      @if (hasContents()) {
        <mat-icon class="folder-chevron" (click)="toggleExpanded($event)">
          {{ localExpanded() ? 'expand_more' : 'chevron_right' }}
        </mat-icon>
      } @else {
        <div class="folder-chevron-spacer"></div>
      }
      <mat-icon class="folder-icon">folder</mat-icon>
      <span class="folder-name">{{ folder().name }}</span>
    </div>

    @if (localExpanded() && hasContents()) {
      <div class="folder-children">
        @for (conn of connectionsForCurrent(); track conn.id) {
          <div class="server-item"
               [class.selected]="selectedConnectionId() === conn.id"
               [style.margin-left.px]="(level() + 1) * 12"
               draggable="true"
               (click)="onConnectionClick(conn)"
               (contextmenu)="onConnectionContext($event, conn)"
               (dragstart)="onConnectionDragStart($event, conn)"
               (dragend)="onConnectionDragEnd()">
            <mat-icon class="server-icon"
                      [class.sftp]="conn.protocol === 'sftp' || conn.protocol === 'ftps'">
              {{ conn.protocol === 'sftp' ? 'lock' : conn.protocol === 'ftps' ? 'lock_open' : 'cloud' }}
            </mat-icon>
            <span class="server-name">{{ conn.name }}</span>
          </div>
        }

        @for (child of folder().children; track child.name) {
          <app-folder-tree-node
            [folder]="child"
            [connections]="connections()"
            [path]="currentPath()"
            [level]="level() + 1"
            [selectedPath]="selectedPath()"
            [selectedConnectionId]="selectedConnectionId()"
            [expandedPathsSet]="expandedPathsSet()"
            [dragOverPath]="dragOverPath()"
            (folderClick)="onChildClick($event)"
            (folderContext)="onChildContext($event)"
            (folderDragStart)="onChildFolderDragStart($event)"
            (folderDragEnd)="onChildFolderDragEnd()"
            (expandedPathsChange)="onChildExpandChange($event)"
            (folderDragOver)="onChildDragOver($event)"
            (folderDragLeave)="onChildDragLeave($event)"
            (folderDrop)="onChildDrop($event)"
            (connectionClick)="onChildConnectionClick($event)"
            (connectionContext)="onChildConnectionContext($event)"
            (connectionDragStart)="onChildConnectionDragStart($event)"
            (connectionDragEnd)="onChildConnectionDragEnd()"
          />
        }
      </div>
    }
  `,
  styles: [`
    .folder-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--ctp-text);
      border-radius: 4px;
      user-select: none;
    }
    .folder-item:hover,
    .folder-item.selected {
      background: var(--ctp-surface0);
    }
    .folder-item.drag-over {
      background: rgba(137,180,250,0.2);
      outline: 1px dashed var(--ctp-blue);
      outline-offset: -2px;
    }
    .folder-chevron {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ctp-overlay1);
      flex-shrink: 0;
      cursor: pointer;
    }
    .folder-chevron:hover { color: var(--ctp-text); }
    .folder-chevron-spacer { width: 16px; height: 16px; flex-shrink: 0; }
    .folder-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ctp-yellow);
      flex-shrink: 0;
    }
    .folder-name { flex: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
    .folder-children { display: flex; flex-direction: column; gap: 0px; }
    .server-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 8px 5px 24px;
      cursor: pointer;
      font-size: 12px;
      color: var(--ctp-text);
      border-radius: 4px;
      user-select: none;
    }
    .server-item:hover,
    .server-item.selected { background: var(--ctp-surface0); }
    .server-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ctp-sapphire);
      flex-shrink: 0;
    }
    .server-icon.sftp { color: var(--ctp-green); }
    .server-name { flex: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
  `],
})
export class FolderTreeNodeComponent {
  folder = input.required<FolderNode>();
  connections = input.required<ConnectionProfile[]>();
  path = input.required<string[]>();
  level = input(0);
  selectedPath = input('');
  selectedConnectionId = input('');
  expandedPathsSet = input.required<Set<string>>();
  dragOverPath = input.required<string>();

  folderClick = output<FolderEvent>();
  folderContext = output<FolderEvent>();
  folderDragStart = output<FolderEvent>();
  folderDragEnd = output<void>();
  expandedPathsChange = output<Set<string>>();
  folderDragOver = output<FolderEvent>();
  folderDragLeave = output<DragEvent>();
  folderDrop = output<FolderEvent>();
  connectionClick = output<ConnectionProfile>();
  connectionContext = output<ConnectionEvent>();
  connectionDragStart = output<ConnectionProfile>();
  connectionDragEnd = output<void>();

  localExpanded = signal(false);

  currentPath = computed(() => [...this.path(), this.folder().name]);

  pathStr = computed(() => this.currentPath().join('/'));

  hasContents = computed(() => {
    const path = this.currentPath();
    return (this.folder().children?.length ?? 0) > 0 ||
      this.connectionsFor(path).length > 0;
  });

  connectionsForCurrent = computed(() => this.connectionsFor(this.currentPath()));

  constructor() {
    effect(() => {
      const pathStr = this.pathStr();
      this.localExpanded.set(this.expandedPathsSet().has(pathStr));
    });
  }

  private connectionsFor(path: string[]): ConnectionProfile[] {
    const folderPath = path.join('/');
    return this.connections().filter(conn => (conn.folder ?? []).join('/') === folderPath);
  }

  toggleExpanded(event: MouseEvent) {
    event.stopPropagation();
    const pathStr = this.pathStr();
    const expanded = new Set<string>(this.expandedPathsSet());
    if (expanded.has(pathStr)) {
      expanded.delete(pathStr);
    } else {
      expanded.add(pathStr);
    }
    this.expandedPathsChange.emit(expanded);
  }

  onNodeClick() {
    this.folderClick.emit({ path: this.currentPath() });
  }

  onNodeContext(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.folderContext.emit({ path: this.currentPath(), event });
  }

  onNodeDragStart(event: DragEvent) {
    event.dataTransfer?.setData('text/plain', this.pathStr());
    event.stopPropagation();
    this.folderDragStart.emit({ path: this.currentPath(), event });
  }

  onNodeDragEnd() {
    this.folderDragEnd.emit();
  }

  onNodeDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.folderDragOver.emit({ path: this.currentPath(), event });
  }

  onNodeDragLeave(event: DragEvent) {
    this.folderDragLeave.emit(event);
  }

  onNodeDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.folderDrop.emit({ path: this.currentPath(), event });
  }

  onConnectionClick(connection: ConnectionProfile) {
    this.connectionClick.emit(connection);
  }

  onConnectionContext(event: MouseEvent, connection: ConnectionProfile) {
    event.preventDefault();
    event.stopPropagation();
    this.connectionContext.emit({ connection, event });
  }

  onConnectionDragStart(event: DragEvent, connection: ConnectionProfile) {
    event.dataTransfer?.setData('text/plain', connection.id);
    event.stopPropagation();
    this.connectionDragStart.emit(connection);
  }

  onConnectionDragEnd() {
    this.connectionDragEnd.emit();
  }

  onChildClick(event: FolderEvent) { this.folderClick.emit(event); }
  onChildContext(event: FolderEvent) { this.folderContext.emit(event); }
  onChildFolderDragStart(event: FolderEvent) { this.folderDragStart.emit(event); }
  onChildFolderDragEnd() { this.folderDragEnd.emit(); }
  onChildExpandChange(expanded: Set<string>) { this.expandedPathsChange.emit(expanded); }
  onChildDragOver(event: FolderEvent) { this.folderDragOver.emit(event); }
  onChildDragLeave(event: DragEvent) { this.folderDragLeave.emit(event); }
  onChildDrop(event: FolderEvent) { this.folderDrop.emit(event); }
  onChildConnectionClick(connection: ConnectionProfile) { this.connectionClick.emit(connection); }
  onChildConnectionContext(event: ConnectionEvent) { this.connectionContext.emit(event); }
  onChildConnectionDragStart(connection: ConnectionProfile) { this.connectionDragStart.emit(connection); }
  onChildConnectionDragEnd() { this.connectionDragEnd.emit(); }
}

@Component({
  selector: 'app-folder-tree',
  standalone: true,
  imports: [CommonModule, MatIconModule, FolderTreeNodeComponent],
  template: `
    <div class="folder-tree-root">
      @if (rootFolders().length > 0) {
        <div class="folder-list">
          @for (folder of rootFolders(); track folder.name) {
            <app-folder-tree-node
              [folder]="folder"
              [connections]="connections()"
              [path]="[]"
              [selectedPath]="selectedPath()"
              [selectedConnectionId]="selectedConnectionId()"
              [expandedPathsSet]="expandedPaths()"
              [dragOverPath]="dragOverPath()"
              (folderClick)="onFolderClick($event)"
              (folderContext)="onFolderContext($event)"
              (folderDragStart)="onFolderDragStart($event)"
              (folderDragEnd)="onFolderDragEnd()"
              (expandedPathsChange)="onExpandedPathsChange($event)"
              (folderDragOver)="onDragOver($event)"
              (folderDragLeave)="onDragLeave($event)"
              (folderDrop)="onDrop($event)"
              (connectionClick)="onConnectionClick($event)"
              (connectionContext)="onConnectionContext($event)"
              (connectionDragStart)="onConnectionDragStart($event)"
              (connectionDragEnd)="onConnectionDragEnd()"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .folder-tree-root { display: flex; flex-direction: column; gap: 0px; }
    .folder-list { display: flex; flex-direction: column; gap: 0px; }
  `],
})
export class FolderTreeComponent {
  folders = input.required<FolderNode[]>();
  connections = input.required<ConnectionProfile[]>();
  selectedPath = input('');
  selectedConnectionId = input('');
  expandedPaths = signal(new Set<string>());
  dragOverPath = signal('');

  folderClick = output<FolderEvent>();
  folderContext = output<FolderEvent>();
  folderDragStart = output<FolderEvent>();
  folderDragEnd = output<void>();
  folderDragOver = output<FolderEvent>();
  folderDragLeave = output<DragEvent>();
  folderDrop = output<FolderEvent>();
  connectionClick = output<ConnectionProfile>();
  connectionContext = output<ConnectionEvent>();
  connectionDragStart = output<ConnectionProfile>();
  connectionDragEnd = output<void>();

  rootFolders = computed(() => this.folders());

  onFolderClick(event: FolderEvent) { this.folderClick.emit(event); }
  onFolderContext(event: FolderEvent) { this.folderContext.emit(event); }
  onFolderDragStart(event: FolderEvent) { this.folderDragStart.emit(event); }
  onFolderDragEnd() { this.folderDragEnd.emit(); }
  onExpandedPathsChange(newExpandedPaths: Set<string>) { this.expandedPaths.set(newExpandedPaths); }
  onDragOver(event: FolderEvent) {
    this.dragOverPath.set(event.path.join('/'));
    this.folderDragOver.emit(event);
  }
  onDragLeave(event: DragEvent) {
    this.dragOverPath.set('');
    this.folderDragLeave.emit(event);
  }
  onDrop(event: FolderEvent) {
    this.dragOverPath.set('');
    this.folderDrop.emit(event);
  }
  onConnectionClick(event: ConnectionProfile) { this.connectionClick.emit(event); }
  onConnectionContext(event: ConnectionEvent) { this.connectionContext.emit(event); }
  onConnectionDragStart(connection: ConnectionProfile) { this.connectionDragStart.emit(connection); }
  onConnectionDragEnd() { this.connectionDragEnd.emit(); }
}
