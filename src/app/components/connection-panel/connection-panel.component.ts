import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { ConnectionService, ConnectionProfile } from '../../services/connection.service';
import { FileSystemService } from '../../services/filesystem.service';
import { TransferService } from '../../services/transfer.service';
import { ConnectionDialogComponent } from '../connection-dialog/connection-dialog.component';

@Component({
  selector: 'app-connection-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatDialogModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  template: `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Site Manager</span>
        <button mat-icon-button (click)="openAddDialog()" matTooltip="Add connection">
          <mat-icon>add</mat-icon>
        </button>
      </div>
      <mat-divider />

      @if (connectionSvc.connections().length === 0) {
        <p class="empty-hint">No saved connections.<br/>Click + to add one.</p>
      }

      <mat-nav-list dense>
        @for (conn of connectionSvc.connections(); track conn.id) {
          <mat-list-item
            [class.active]="isActive(conn)"
            (click)="connectTo(conn)"
            [matMenuTriggerFor]="ctxMenu"
            [matMenuTriggerData]="{ conn: conn }"
          >
            <mat-icon matListItemIcon>
              {{ conn.protocol === 'sftp' ? 'lock' : 'cloud' }}
            </mat-icon>
            <span matListItemTitle>{{ conn.name }}</span>
            <span matListItemLine class="conn-host">{{ conn.host }}:{{ conn.port }}</span>
          </mat-list-item>
        }
      </mat-nav-list>

      <mat-menu #ctxMenu="matMenu">
        <ng-template matMenuContent let-conn="conn">
          <button mat-menu-item (click)="connectTo(conn)">
            <mat-icon>power</mat-icon> Connect
          </button>
          <button mat-menu-item (click)="openEditDialog(conn)">
            <mat-icon>edit</mat-icon> Edit
          </button>
          <button mat-menu-item (click)="deleteConn(conn)">
            <mat-icon>delete</mat-icon> Delete
          </button>
        </ng-template>
      </mat-menu>

      @if (connectionSvc.activeSession()) {
        <mat-divider />
        <div class="disconnect-bar">
          <mat-icon class="connected-icon">wifi</mat-icon>
          <span>{{ connectionSvc.activeSession()!.profile.name }}</span>
          <button mat-icon-button (click)="disconnect()" matTooltip="Disconnect">
            <mat-icon>power_off</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .panel          { display: flex; flex-direction: column; height: 100%; background: var(--ctp-mantle); }
    .panel-header   { display: flex; align-items: center; padding: 8px 12px; gap: 8px; }
    .panel-title    { flex: 1; font-weight: 600; font-size: 11px; color: var(--ctp-subtext0); text-transform: uppercase; letter-spacing: 0.8px; }
    .empty-hint     { padding: 16px; color: var(--ctp-overlay0); font-size: 12px; text-align: center; }
    .conn-host      { font-size: 11px; color: var(--ctp-overlay1) !important; }
    mat-list-item.active { background: rgba(137,180,250,0.12); }
    .connected-icon { color: var(--ctp-green); font-size: 18px; }
    .disconnect-bar { display: flex; align-items: center; padding: 6px 12px; gap: 8px; font-size: 12px; color: var(--ctp-green); }
    .disconnect-bar span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class ConnectionPanelComponent implements OnInit {
  connectionSvc = inject(ConnectionService);
  private fsSvc = inject(FileSystemService);
  private transferSvc = inject(TransferService);
  private dialog = inject(MatDialog);

  async ngOnInit() {
    await this.connectionSvc.loadConnections();
  }

  isActive(conn: ConnectionProfile): boolean {
    return this.connectionSvc.activeSession()?.profile.id === conn.id;
  }

  async connectTo(conn: ConnectionProfile) {
    try {
      const sessionId = await this.connectionSvc.connect(conn);
      const remotePath = conn.remotePath || '/';
      await this.fsSvc.listRemote(sessionId, conn.protocol, remotePath);
      await this.transferSvc.startListening();
    } catch (e) {
      console.error('Connection failed', e);
    }
  }

  async disconnect() {
    await this.connectionSvc.disconnect();
    this.fsSvc.remoteEntries.set([]);
    this.fsSvc.remotePath.set('/');
  }

  openAddDialog() {
    this.dialog.open(ConnectionDialogComponent, { width: '480px', data: null });
  }

  openEditDialog(conn: ConnectionProfile) {
    this.dialog.open(ConnectionDialogComponent, { width: '480px', data: conn });
  }

  async deleteConn(conn: ConnectionProfile) {
    await this.connectionSvc.deleteConnection(conn.id);
  }
}
