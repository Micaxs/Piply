import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  computed,
  input,
  output,
  inject,
} from '@angular/core';
import { Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal, PortalModule } from '@angular/cdk/portal';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ConnectionProfile } from '../../services/connection.service';
import type { FolderNode } from '../folder-tree/folder-tree.component';

@Component({
  selector: 'app-quick-connect-menu-node',
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule, MatIconModule, MatDividerModule, MatMenuModule],
  template: `
    <button
      #trigger
      type="button"
      class="folder-trigger"
      (mouseenter)="onHoverEnter(); openSubmenu()"
      (mouseleave)="onHoverLeave(); scheduleClose()"
      >
      <mat-icon class="folder-icon">folder</mat-icon>
      <span class="folder-name">{{ folder().name }}</span>
      <span class="spacer"></span>
      @if (hasContents()) {
        <mat-icon class="submenu-arrow">chevron_right</mat-icon>
      }
    </button>

    <ng-template #submenuTpl>
      <div
        class="submenu-panel"
        (mouseenter)="onHoverEnter(); cancelClose()"
        (mouseleave)="onHoverLeave(); scheduleClose()"
      >
        @for (conn of connectionsForCurrent(); track conn.id) {
          <button class="submenu-item" type="button" (click)="onConnectionClick(conn)">
            <mat-icon>{{ iconFor(conn) }}</mat-icon>
            <span>{{ conn.name }}</span>
          </button>
        }

        @if (connectionsForCurrent().length > 0 && (folder().children?.length ?? 0) > 0) {
          <mat-divider />
        }

        @for (child of folder().children ?? []; track child.name) {
          <app-quick-connect-menu-node
            [folder]="child"
            [path]="currentPath()"
            [connections]="connections()"
            [closeMenu]="closeMenu()"
            (connect)="onChildConnect($event)"
            (branchOpenChange)="handleBranchOpenChange($event)"
          />
        }

        @if (connectionsForCurrent().length === 0 && (folder().children?.length ?? 0) === 0) {
          <button class="submenu-item submenu-disabled" type="button" disabled>No saved connections</button>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .folder-trigger {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 32px;
      padding: 0 12px;
      gap: 8px;
      position: relative;
      line-height: 1;
      background: transparent;
      border: 0;
      color: var(--ctp-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
      border-radius: 0;
    }
    .folder-trigger:hover { background: var(--ctp-surface0); }
    .folder-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
      color: var(--ctp-subtext1);
      flex-shrink: 0;
      margin-right: 0;
    }
    .folder-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spacer { flex: 1; }
    .submenu-arrow {
      margin-left: auto;
      width: 16px;
      height: 16px;
      font-size: 16px;
      flex-shrink: 0;
      color: var(--ctp-overlay1);
    }
    .submenu-panel {
      position: relative;
      top: 0 !important;
      min-width: 220px;
      padding: 4px 0;
      background: var(--ctp-mantle);
      border: 1px solid var(--ctp-surface1);
      border-radius: 6px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.4);
      pointer-events: auto;
      transform: none;
      margin: 0;
      max-height: calc(100vh - 8px);
      overflow-y: auto;
    }
    .submenu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 14px;
      background: transparent;
      border: 0;
      color: var(--ctp-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .submenu-item:hover { background: var(--ctp-surface0); }
    .submenu-item mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
      color: var(--ctp-subtext0);
      flex-shrink: 0;
    }
    .submenu-disabled {
      opacity: 0.45;
      cursor: default;
      pointer-events: none;
    }
  `],
})
export class QuickConnectMenuNodeComponent implements AfterViewInit {
  folder = input.required<FolderNode>();
  path = input.required<string[]>();
  connections = input.required<ConnectionProfile[]>();
  closeMenu = input<(() => void) | null>(null);

  connect = output<ConnectionProfile>();
  branchOpenChange = output<boolean>();

  @ViewChild('trigger', { read: ElementRef }) triggerEl!: ElementRef<HTMLElement>;
  @ViewChild('submenuTpl') submenuTpl!: TemplateRef<unknown>;

  private overlay = inject(Overlay);
  private vcr = inject(ViewContainerRef);
  private overlayRef: OverlayRef | null = null;
  private portal: TemplatePortal<unknown> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private isHovered = false;
  private descendantOpen = false;

  currentPath = computed(() => [...this.path(), this.folder().name]);
  currentPathString = computed(() => this.currentPath().join('/'));
  connectionsForCurrent = computed(() =>
    this.connections().filter((conn) => (conn.folder ?? []).join('/') === this.currentPathString())
  );
  hasContents = computed(() =>
    (this.folder().children?.length ?? 0) > 0 || this.connectionsForCurrent().length > 0
  );

  ngAfterViewInit(): void {
    this.portal = new TemplatePortal(this.submenuTpl, this.vcr);
  }

  openSubmenu(): void {
    this.cancelClose();
    if (!this.portal || !this.triggerEl) return;

    if (!this.overlayRef) {
      const positionStrategy = this.overlay.position()
        .flexibleConnectedTo(this.triggerEl)
        .withFlexibleDimensions(false)
        .withPush(false)
        .withViewportMargin(4)
        .withPositions([
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'top',
            offsetX: 0,
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'top',
            offsetX: 0,
          },
        ]);

      this.overlayRef = this.overlay.create({
        positionStrategy,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
        hasBackdrop: false,
        disposeOnNavigation: true,
        panelClass: 'qc-submenu-overlay',
      });
      this.overlayRef.detachments().subscribe(() => {
        this.overlayRef = null;
      });
    }

    if (!this.overlayRef.hasAttached()) {
      this.overlayRef.attach(this.portal);
    }
    this.branchOpenChange.emit(true);
    this.overlayRef.updatePosition();
  }

  scheduleClose(): void {
    this.cancelClose();
    if (this.descendantOpen) return;
    this.closeTimer = setTimeout(() => this.closeSubmenu(), 120);
  }

  cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  closeSubmenu(): void {
    this.cancelClose();
    if (this.descendantOpen || this.isHovered) return;
    this.overlayRef?.detach();
    this.branchOpenChange.emit(false);
  }

  closeMenuIfNeeded(): void {
    this.closeSubmenu();
    this.closeMenu()?.();
  }

  onHoverEnter(): void {
    this.isHovered = true;
    this.cancelClose();
  }

  onHoverLeave(): void {
    this.isHovered = false;
  }

  onConnectionClick(connection: ConnectionProfile): void {
    this.connect.emit(connection);
    this.closeMenuIfNeeded();
  }

  handleBranchOpenChange(open: boolean): void {
    this.descendantOpen = open;
    if (open) {
      this.cancelClose();
    } else if (!this.isHovered) {
      this.scheduleClose();
    }
  }

  onChildConnect(connection: ConnectionProfile): void {
    this.connect.emit(connection);
    this.closeSubmenu();
  }

  iconFor(conn: ConnectionProfile): string {
    return conn.protocol === 'sftp' ? 'lock' : conn.protocol === 'ftps' ? 'lock_open' : 'cloud';
  }
}

@Component({
  selector: 'app-quick-connect-menu',
  standalone: true,
  imports: [CommonModule, MatMenuModule, MatIconModule, MatDividerModule, QuickConnectMenuNodeComponent],
  template: `
    @if (rootConnections().length === 0 && displayFolders().length === 0) {
      <button mat-menu-item disabled>No saved connections</button>
    } @else {
      @for (conn of rootConnections(); track conn.id) {
        <button mat-menu-item (click)="onConnect(conn)">
          <mat-icon>{{ iconFor(conn) }}</mat-icon>
          <span>{{ conn.name }}</span>
        </button>
      }

      @if (rootConnections().length > 0 && displayFolders().length > 0) {
        <mat-divider />
      }

      @for (folder of displayFolders(); track folder.name) {
        <app-quick-connect-menu-node
          [folder]="folder"
          [path]="[]"
          [connections]="connections()"
          [closeMenu]="closeMenu()"
          (connect)="onConnect($event)"
        />
      }
    }
  `,
})
export class QuickConnectMenuComponent {
  folders = input.required<FolderNode[]>();
  connections = input.required<ConnectionProfile[]>();
  closeMenu = input<(() => void) | null>(null);

  connect = output<ConnectionProfile>();

  rootConnections = computed(() => this.connectionsFor([]));
  displayFolders = computed(() => this.mergeFolders(this.folders(), this.connections()));

  connectionsFor(path: string[]): ConnectionProfile[] {
    const pathStr = path.join('/');
    return this.connections().filter((conn) => (conn.folder ?? []).join('/') === pathStr);
  }

  onConnect(conn: ConnectionProfile): void {
    this.connect.emit(conn);
    this.closeMenu()?.();
  }

  private mergeFolders(folders: FolderNode[], connections: ConnectionProfile[]): FolderNode[] {
    const root = this.cloneFolders(folders);

    for (const conn of connections) {
      let current = root;
      for (const part of conn.folder ?? []) {
        let node = current.find(f => f.name === part);
        if (!node) {
          node = { name: part, children: [] };
          current.push(node);
        }
        node.children ??= [];
        current = node.children;
      }
    }

    const sortTree = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of nodes) {
        if (node.children?.length) sortTree(node.children);
      }
    };
    sortTree(root);
    return root;
  }

  private cloneFolders(folders: FolderNode[]): FolderNode[] {
    return folders.map(folder => ({
      name: folder.name,
      children: this.cloneFolders(folder.children ?? []),
    }));
  }

  iconFor(conn: ConnectionProfile): string {
    return conn.protocol === 'sftp' ? 'lock' : conn.protocol === 'ftps' ? 'lock_open' : 'cloud';
  }
}
