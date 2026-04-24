import { Component, HostListener, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { ViewChild } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { LocalBrowserComponent } from './components/local-browser/local-browser.component';
import { RemoteBrowserComponent } from './components/remote-browser/remote-browser.component';
import { TransferQueueComponent } from './components/transfer-queue/transfer-queue.component';
import { SiteManagerComponent } from './components/site-manager/site-manager.component';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { SshKeyManagerComponent } from './components/ssh-key-manager/ssh-key-manager.component';
import { ActivityLogComponent } from './components/activity-log/activity-log.component';
import { PermissionsWindowComponent } from './components/permissions-window/permissions-window.component';
import { TabChoiceWindowComponent } from './components/tab-choice-window/tab-choice-window.component';
import { QuickConnectMenuComponent } from './components/quick-connect-menu/quick-connect-menu.component';
import { ConnectionService, ConnectionProfile } from './services/connection.service';
import { FileSystemService } from './services/filesystem.service';
import { TransferService } from './services/transfer.service';
import { ComparisonService } from './services/comparison.service';
import { SyncBrowseService } from './services/sync-browse.service';
import { SettingsService, AppSettings } from './services/settings.service';
import { ActivityLogService } from './services/activity-log.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    LocalBrowserComponent,
    RemoteBrowserComponent,
    TransferQueueComponent,
    SiteManagerComponent,
    SettingsPanelComponent,
    SshKeyManagerComponent,
    ActivityLogComponent,
    PermissionsWindowComponent,
    TabChoiceWindowComponent,
    QuickConnectMenuComponent,
  ],
  template: `
    @if (isSiteManager) {
      <!-- ══ Connection Manager window ══ -->
      <app-site-manager />
    } @else if (isSettings) {
      <!-- ══ Settings window ══ -->
      <app-settings-panel />
    } @else if (isSshKeyManager) {
      <!-- ══ SSH Key Manager window ══ -->
      <app-ssh-key-manager />
    } @else if (isPermissions) {
      <!-- ══ Permissions window ══ -->
      <app-permissions-window />
    } @else if (isTabChoice) {
      <!-- ══ Tab Choice window ══ -->
      <app-tab-choice-window />
    } @else {
      <!-- ══ Main application shell ══ -->
      <div class="app-shell">

        <!-- Titlebar (drag region + window controls) -->
        <div class="titlebar" data-tauri-drag-region>
          <img class="title-logo" src="assets/logo.svg" alt="Piply"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex'" />
          <mat-icon class="title-logo-fallback">flight_takeoff</mat-icon>
          <span class="title-name" data-tauri-drag-region>Piply</span>
          <span class="title-spacer" data-tauri-drag-region></span>
          <button mat-icon-button class="wctl" (click)="winMinimize()" matTooltip="Minimise">
            <mat-icon>remove</mat-icon>
          </button>
          <button mat-icon-button class="wctl" (click)="winMaximize()" matTooltip="Maximise">
            <mat-icon>crop_square</mat-icon>
          </button>
          <button mat-icon-button class="wctl wctl-close" (click)="winClose()" matTooltip="Close">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Menu bar -->
        <div class="menubar">
          <button mat-button class="menu-btn" [matMenuTriggerFor]="fileMenu">File</button>
          <mat-menu #fileMenu="matMenu">
            <button mat-menu-item (click)="openConnectionManager()">
              <mat-icon>storage</mat-icon> Connection Manager…
            </button>
            <mat-divider />
            <button mat-menu-item (click)="openSettings()">
              <mat-icon>settings</mat-icon> Settings…
            </button>
            <button mat-menu-item (click)="openSshKeyManager()">
              <mat-icon>vpn_key</mat-icon> SSH Key Manager…
            </button>
            <mat-divider />
            <button mat-menu-item (click)="winClose()">
              <mat-icon>exit_to_app</mat-icon> Exit
            </button>
          </mat-menu>

          <button mat-button class="menu-btn" [matMenuTriggerFor]="serverMenu">Server</button>
          <mat-menu #serverMenu="matMenu">
            <button mat-menu-item (click)="openConnectionManager()">
              <mat-icon>add_link</mat-icon> Connect to Site…
            </button>
            <button mat-menu-item (click)="disconnect()" [disabled]="!activeSession()">
              <mat-icon>link_off</mat-icon> Disconnect
            </button>
          </mat-menu>

          <button mat-button class="menu-btn" [matMenuTriggerFor]="transferMenu">Transfer</button>
          <mat-menu #transferMenu="matMenu">
            <button mat-menu-item (click)="transferSvc.refreshTransfers()">
              <mat-icon>refresh</mat-icon> Refresh Queue
            </button>
          </mat-menu>

          <button mat-button class="menu-btn" [matMenuTriggerFor]="viewMenu">View</button>
          <mat-menu #viewMenu="matMenu">
            <button mat-menu-item (click)="settingsSvc.showQuickConnect.update(v => !v); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.showQuickConnect() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              Quick Connect Bar
            </button>
            <button mat-menu-item (click)="settingsSvc.showTransferPanel.update(v => !v); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.showTransferPanel() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              Transfer Queue Panel
            </button>
            <button mat-menu-item (click)="showActivityLog.update(v => !v)">
              <mat-icon>{{ showActivityLog() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              Activity Log
            </button>
            <mat-divider />
            <button mat-menu-item [matMenuTriggerFor]="treeMenu">
              <mat-icon>account_tree</mat-icon> Tree View
            </button>
          </mat-menu>
          <mat-menu #treeMenu="matMenu">
            <button mat-menu-item (click)="setTreePos('left'); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.treePosition() === 'left'   ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon> Left
            </button>
            <button mat-menu-item (click)="setTreePos('right'); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.treePosition() === 'right'  ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon> Right
            </button>
            <button mat-menu-item (click)="setTreePos('top'); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.treePosition() === 'top'    ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon> Top
            </button>
            <mat-divider />
            <button mat-menu-item (click)="setTreePos('hidden'); settingsSvc.save()">
              <mat-icon>{{ settingsSvc.treePosition() === 'hidden' ? 'check_box' : 'check_box_outline_blank' }}</mat-icon> Hide Tree
            </button>
          </mat-menu>

          <button mat-button class="menu-btn" [matMenuTriggerFor]="helpMenu">Help</button>
          <mat-menu #helpMenu="matMenu">
            <button mat-menu-item disabled>About Piply v0.1.0</button>
          </mat-menu>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <button mat-icon-button class="tb-btn tb-blue" (click)="openConnectionManager()" matTooltip="Connection Manager">
            <mat-icon>storage</mat-icon>
          </button>

          <button mat-icon-button class="tb-btn tb-sapphire qc-dropdown-btn" [matMenuTriggerFor]="savedMenu"
                  #savedTrigger="matMenuTrigger"
                  matTooltip="Quick connect to a saved site">
            <mat-icon>arrow_drop_down</mat-icon>
          </button>
          <mat-menu #savedMenu="matMenu">
            <app-quick-connect-menu [folders]="connSvc.folders()" [connections]="connections()"
                                    [closeMenu]="closeSavedMenu"
                                    (connect)="connectTo($event)" />
            <mat-divider />
            <button mat-menu-item (click)="openConnectionManager()">
              <mat-icon>storage</mat-icon> Open Connection Manager…
            </button>
          </mat-menu>

          @if (activeSession()) {
            <div class="connected-chip">
              <mat-icon class="chip-icon">wifi</mat-icon>
              <span class="chip-name">{{ activeSession()!.profile.host }}</span>
              <button mat-icon-button class="chip-disc" (click)="disconnect()" matTooltip="Disconnect">
                <mat-icon>power_off</mat-icon>
              </button>
            </div>
          }
          <div class="tb-sep"></div>
          <button mat-icon-button class="tb-btn tb-teal" (click)="refreshBoth()" matTooltip="Refresh both panes">
            <mat-icon>refresh</mat-icon>
          </button>
          <button mat-icon-button class="tb-btn tb-yellow" (click)="toggleComparison()" [class.tb-active]="comparisonMode()"
                  matTooltip="Compare directories (yellow=one side only, green=newer here, red=size differs)">
            <mat-icon>compare</mat-icon>
          </button>
          <button mat-icon-button class="tb-btn tb-green" (click)="toggleSyncBrowse()" [class.tb-active]="syncBrowse()"
                  matTooltip="Synchronized browsing — navigating one pane mirrors the other">
            <mat-icon>sync</mat-icon>
          </button>
          @if (syncBrowse() && comparisonMode()) {
            <button mat-icon-button class="tb-btn tb-teal" (click)="toggleSyncScroll()" [class.tb-active]="syncSvc.syncScroll()"
                    matTooltip="Synchronized scrolling — scrolling one pane mirrors the other">
              <mat-icon>swap_vert</mat-icon>
            </button>
          }
          <div class="tb-sep"></div>
          <button mat-icon-button class="tb-btn tb-mauve" (click)="openSettings()" matTooltip="Settings">
            <mat-icon>settings</mat-icon>
          </button>
        </div>

        <!-- Quick connect bar -->
        @if (showQuickConnect()) {
          <div class="qcbar">
            <div class="qcbar-inner">
              <span class="qcb-lbl">Host:</span>
              <input class="qcb-in qcb-host" [(ngModel)]="qcHost"
                     placeholder="sftp://hostname or ftp://hostname"
                     (keydown.enter)="doQuickConnect()" spellcheck="false" />
              <span class="qcb-lbl">User:</span>
              <input class="qcb-in qcb-sm" [(ngModel)]="qcUser"
                     placeholder="Username" (keydown.enter)="doQuickConnect()" />
              <span class="qcb-lbl">Pass:</span>
              <input class="qcb-in qcb-sm" type="password" [(ngModel)]="qcPass"
                     (keydown.enter)="doQuickConnect()" />
              <span class="qcb-lbl">Port:</span>
              <input class="qcb-in qcb-port" type="number" [(ngModel)]="qcPort"
                     (keydown.enter)="doQuickConnect()" />
              <button class="qcb-btn" (click)="doQuickConnect()" [disabled]="!qcHost">
                Quickconnect
              </button>
            </div>
          </div>
        }

        <!-- Activity log panel + resize handle at bottom -->
        @if (showActivityLog()) {
          <div class="activity-log-panel" [style.height.px]="logHeight()">
            <app-activity-log />
          </div>
          <div class="v-resize-handle" (mousedown)="startLogDrag($event)"></div>
        }

        <!-- Main area -->
        <div class="main-area">
          @if (connSvc.sessions().length > 1) {
            <div class="global-tab-bar">
              @for (s of connSvc.sessions(); track s.sessionId; let i = $index) {
                <div class="g-tab" [class.active]="i === connSvc.activeIndex()" (click)="switchTab(i)">
                  <mat-icon class="g-tab-icon">
                    {{ s.profile.protocol === 'sftp' ? 'lock' : s.profile.protocol === 'ftps' ? 'lock_open' : 'cloud' }}
                  </mat-icon>
                  @if (s.profile.name) {
                    <span class="g-tab-label">
                      <span class="g-tab-name">{{ s.profile.name }}</span>
                      <span class="g-tab-sep"> — </span>
                      <span class="g-tab-host">{{ s.profile.host }}:{{ s.profile.port }}</span>
                    </span>
                  } @else {
                    <span class="g-tab-label">
                      <span class="g-tab-host">{{ s.profile.host }}:{{ s.profile.port }}</span>
                    </span>
                  }
                  <button class="g-tab-close" (click)="closeTab(i, $event)" matTooltip="Disconnect">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
            </div>
          }
          <div class="dual-pane">
            <div class="pane" [style.width]="leftWidth() + '%'">
              <app-local-browser />
            </div>
            <div class="pane-divider" (mousedown)="startHDrag($event)"></div>
            <div class="pane pane-right">
              <app-remote-browser />
            </div>
          </div>

          <div class="v-resize-handle" (mousedown)="startVDrag($event)" [style.display]="showTransferPanel() ? '' : 'none'"></div>

          @if (showTransferPanel()) {
          <div class="transfer-panel" [style.height.px]="transferHeight()">
            <app-transfer-queue />
          </div>
          }
        </div>

      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* ── Site manager window root ── */
    app-site-manager { display: block; width: 100%; height: 100vh; }

    /* ── Settings window root ── */
    app-settings-panel { display: block; width: 100%; height: 100vh; }

    /* ── Main app shell ── */
    .app-shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--ctp-base); }

    /* Titlebar */
    .titlebar {
      display: flex; align-items: center; height: 36px; flex-shrink: 0;
      padding: 0 4px; gap: 2px;
      background: var(--ctp-crust);
      border-bottom: 1px solid var(--ctp-surface0);
      user-select: none;
    }
    .title-logo  { width: 18px; height: 18px; margin: 0 4px; pointer-events: none; flex-shrink: 0; }
    .title-logo-fallback { display: none; color: var(--ctp-blue); font-size: 18px; width: 18px; height: 18px; margin: 0 4px; pointer-events: none; }
    .title-name  { font-weight: 700; font-size: 13px; letter-spacing: 1px; color: var(--ctp-text); pointer-events: none; }
    .title-spacer { flex: 1; }
    .wctl        { width: 36px; height: 36px; border-radius: 0; color: var(--ctp-subtext0) !important; }
    .wctl:hover  { color: var(--ctp-text) !important; background: var(--ctp-surface0) !important; }
    .wctl-close:hover { background: var(--ctp-red) !important; color: var(--ctp-crust) !important; }

    /* Menu bar */
    .menubar {
      display: flex; align-items: center; height: 28px; flex-shrink: 0;
      padding: 0 4px;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .menu-btn { height: 26px; padding: 0 10px; font-size: 12px; color: var(--ctp-text) !important; min-width: 0; border-radius: 0 !important; }
    .menu-btn:hover { background: var(--ctp-surface0) !important; }
    ::ng-deep .menu-btn .mdc-button__ripple,
    ::ng-deep .menu-btn .mat-mdc-focus-indicator,
    ::ng-deep .menu-btn .mat-ripple { border-radius: 0 !important; }

    /* Toolbar */
    .toolbar {
      display: flex; align-items: center; height: 36px; flex-shrink: 0;
      padding: 0 4px; gap: 2px;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .qc-dropdown-btn { height: 30px; font-size: 12px; padding: 0 8px; gap: 2px; max-width: 160px; }
    .qc-dropdown-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .menu-host { font-size: 11px; color: var(--ctp-overlay0); margin-left: 8px; }
    .connected-chip { display: flex; align-items: center; gap: 4px; padding: 0 4px 0 8px; border-radius: 12px; background: rgba(166,227,161,0.12); margin-left: 4px; }
    .chip-icon  { font-size: 14px; width: 14px; height: 14px; color: var(--ctp-green); flex-shrink: 0; }
    .chip-name  { font-size: 12px; color: var(--ctp-green); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip-disc  { width: 24px !important; height: 24px !important; line-height: 24px !important; display: flex !important; align-items: center !important; justify-content: center !important; color: var(--ctp-subtext0) !important; flex-shrink: 0; padding: 0 !important; }
    ::ng-deep .chip-disc .mat-mdc-button-touch-target { width: 24px !important; height: 24px !important; }
    ::ng-deep .chip-disc .mat-icon { font-size: 15px; width: 15px; height: 15px; line-height: 15px; }
    .tb-sep { width: 1px; height: 24px; background: var(--ctp-surface1); margin: 0 4px; }

    /* Colored toolbar buttons */
    /* Suppress Material's own state-layer so only our circle shows */
    ::ng-deep .tb-btn .mat-mdc-button-persistent-ripple { display: none !important; }
    ::ng-deep .tb-btn .mdc-icon-button__ripple           { display: none !important; }
    /* Dropdown button: no hover bg at all */
    ::ng-deep .qc-dropdown-btn .mat-mdc-button-persistent-ripple { display: none !important; }

    .tb-btn { transition: background 0.15s, color 0.15s !important; }
    .tb-blue     { color: var(--ctp-blue) !important; }
    .tb-blue:hover     { color: var(--ctp-blue)     !important; background: rgba(137,180,250,0.14) !important; border-radius: 50% !important; }
    .tb-blue.tb-active { color: var(--ctp-blue)     !important; background: rgba(137,180,250,0.14) !important; border-radius: 6px !important; }
    .tb-sapphire { color: rgba(116,199,236,0.45) !important; }
    .tb-sapphire:hover  { color: var(--ctp-sapphire) !important; background: transparent !important; }
    .tb-sapphire.tb-active { color: var(--ctp-sapphire) !important; background: rgba(116,199,236,0.12) !important; border-radius: 6px !important; }
    .tb-teal     { color: rgba(148,226,213,0.45) !important; }
    .tb-teal:hover     { color: var(--ctp-teal)     !important; background: rgba(148,226,213,0.14) !important; border-radius: 50% !important; }
    .tb-teal.tb-active { color: var(--ctp-teal)     !important; background: rgba(148,226,213,0.14) !important; border-radius: 6px !important; }
    .tb-yellow   { color: rgba(249,226,175,0.45) !important; }
    .tb-yellow:hover   { color: var(--ctp-yellow)   !important; background: rgba(249,226,175,0.14) !important; border-radius: 50% !important; }
    .tb-yellow.tb-active { color: var(--ctp-yellow) !important; background: rgba(249,226,175,0.14) !important; border-radius: 6px !important; }
    .tb-green    { color: rgba(166,227,161,0.45) !important; }
    .tb-green:hover    { color: var(--ctp-green)    !important; background: rgba(166,227,161,0.14) !important; border-radius: 50% !important; }
    .tb-green.tb-active { color: var(--ctp-green)   !important; background: rgba(166,227,161,0.14) !important; border-radius: 6px !important; }

    /* Quick connect bar — left-aligned, max width */
    .qcbar {
      display: flex; justify-content: flex-start; flex-shrink: 0;
      padding: 4px 12px;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .qcbar-inner { display: flex; align-items: center; gap: 6px; max-width: 860px; width: 100%; }
    .qcb-lbl  { font-size: 13px; color: var(--ctp-subtext0); white-space: nowrap; }
    .qcb-in   { height: 24px; padding: 0 6px; font-size: 13px; background: var(--ctp-surface0); border: 1px solid var(--ctp-overlay0); border-radius: 4px; color: var(--ctp-text); outline: none; }
    .qcb-in:focus { border-color: var(--ctp-blue); }
    .qcb-host { flex: 1; min-width: 0; }
    .qcb-sm   { width: 100px; }
    .qcb-port { width: 58px; }
    .qcb-btn  {
      height: 26px; padding: 0 14px; font-size: 13px; white-space: nowrap;
      background: transparent; border: 1px solid var(--ctp-blue); border-radius: 4px;
      color: var(--ctp-blue); cursor: pointer;
    }
    .qcb-btn:hover:not(:disabled) { background: rgba(137,180,250,0.12); }
    .qcb-btn:disabled { opacity: 0.4; cursor: default; }

    /* Main area */
    .main-area   { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

    /* Global tab bar — spans full dual-pane width */
    .global-tab-bar {
      display: flex; flex-wrap: nowrap; overflow-x: auto; flex-shrink: 0;
      background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0);
      gap: 2px; padding: 3px 6px;
    }
    .g-tab {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 6px 3px 10px; max-width: 220px; min-width: 100px;
      cursor: pointer; border-radius: 6px; flex-shrink: 0;
      font-size: 12px; color: var(--ctp-subtext1); white-space: nowrap;
      transition: background 0.1s;
    }
    .g-tab:hover { background: var(--ctp-surface0); }
    .g-tab.active { background: var(--ctp-surface0); color: var(--ctp-text); outline: 1px solid var(--ctp-blue); }
    .g-tab-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }
    .g-tab-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: baseline; min-width: 0; }
    .g-tab-name { font-weight: 600; flex-shrink: 0; }
    .g-tab-sep { flex-shrink: 0; color: var(--ctp-subtext0); }
    .g-tab-host { overflow: hidden; text-overflow: ellipsis; color: var(--ctp-subtext1); }
    .g-tab-close {
      width: 18px; height: 18px; border: none; cursor: pointer; border-radius: 3px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      background: transparent; color: var(--ctp-subtext0); padding: 0; margin-left: 2px;
    }
    .g-tab-close mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .g-tab-close:hover { background: var(--ctp-red); color: var(--ctp-base); }

    .dual-pane   { display: flex; flex: 1; overflow: hidden; min-height: 0; }
    .pane        { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
    .pane-right  { flex: 1; }

    .pane-divider {
      width: 4px; flex-shrink: 0;
      background: var(--ctp-surface0);
      cursor: col-resize;
      transition: background 0.15s;
    }
    .pane-divider:hover { background: var(--ctp-blue); }

    .v-resize-handle {
      height: 4px; flex-shrink: 0;
      background: var(--ctp-surface0);
      cursor: row-resize;
      transition: background 0.15s;
    }
    .v-resize-handle:hover { background: var(--ctp-blue); }

    .transfer-panel { flex-shrink: 0; overflow: hidden; }
    .activity-log-panel { flex-shrink: 0; overflow: hidden; }
  `],
})
export class App implements OnInit, OnDestroy {
  connSvc = inject(ConnectionService);
  private fsSvc = inject(FileSystemService);
  transferSvc = inject(TransferService);
  comparisonSvc  = inject(ComparisonService);
  comparisonMode = this.comparisonSvc.enabled;
  syncSvc        = inject(SyncBrowseService);
  syncBrowse     = this.syncSvc.enabled;
  settingsSvc    = inject(SettingsService);
  private activityLogSvc = inject(ActivityLogService);
  @ViewChild('savedTrigger', { read: MatMenuTrigger }) private savedTrigger?: MatMenuTrigger;

  connections = this.connSvc.connections;
  activeSession = this.connSvc.activeSession;

  /** True when this webview window is the connection manager window. */
  readonly isSiteManager = new URLSearchParams(window.location.search).get('window') === 'connection-manager';
  readonly isSettings    = new URLSearchParams(window.location.search).get('window') === 'settings';
  readonly isSshKeyManager = new URLSearchParams(window.location.search).get('window') === 'ssh-key-manager';
  readonly isPermissions   = new URLSearchParams(window.location.search).get('window') === 'permissions';
  readonly isTabChoice     = new URLSearchParams(window.location.search).get('window') === 'tab-choice';

  // Pane sizing
  leftWidth = signal(50);
  transferHeight = signal(180);
  showActivityLog = signal(false);
  logHeight = signal(140);

  // Quick connect fields
  qcHost = '';
  qcUser = '';
  qcPass = '';
  qcPort: number | null = null;

  // Delegate UI state to settings service
  get showQuickConnect()  { return this.settingsSvc.showQuickConnect; }
  get showTransferPanel() { return this.settingsSvc.showTransferPanel; }
  closeSavedMenu = () => this.savedTrigger?.closeMenu();

  // Drag state
  private hDragging = false;
  private vDragging = false;
  private logDragging = false;
  private hContainerEl: HTMLElement | null = null;
  private vContainerEl: HTMLElement | null = null;
  private _logDragStartY = 0;
  private _logDragStartH = 140;

  private unlistenConnect?: UnlistenFn;
  private unlistenSettings?: UnlistenFn;

  async ngOnInit() {
    if (this.isSiteManager) return;
    if (this.isSettings)    return; // Settings window bootstraps itself
    if (this.isSshKeyManager) return; // SSH Key Manager bootstraps itself
    if (this.isPermissions) return;  // Permissions window bootstraps itself
    if (this.isTabChoice)   return;  // Tab choice window bootstraps itself
    // Load and apply persisted settings before anything is shown
    this.settingsSvc.load();
    this.settingsSvc.applyAll();
    // Disable browser's native right-click menu everywhere
    document.addEventListener('contextmenu', e => e.preventDefault());
    await this.connSvc.refreshState();
    await this.transferSvc.startListening();
    await this.activityLogSvc.startListening();
    // Listen for connection requests from the site manager window
    this.unlistenConnect = await listen<ConnectionProfile>('piply-connect', async (event) => {
      await this.connectTo(event.payload);
    });
    // Re-apply settings whenever the settings window saves a change
    this.unlistenSettings = await listen<AppSettings>('piply-settings-changed', (event) => {
      this.settingsSvc.applyPayload(event.payload);
    });
  }

  ngOnDestroy() {
    this.transferSvc.stopListening();
    this.activityLogSvc.stopListening();
    this.unlistenConnect?.();
    this.unlistenSettings?.();
  }

  // ── Horizontal drag ──────────────────────────────────────────────────────
  startHDrag(e: MouseEvent) {
    e.preventDefault();
    this.hContainerEl = document.querySelector('.dual-pane');
    this.hDragging = true;
  }

  // ── Vertical drag ────────────────────────────────────────────────────────
  startVDrag(e: MouseEvent) {
    e.preventDefault();
    this.vContainerEl = document.querySelector('.main-area');
    this.vDragging = true;
  }

  startLogDrag(e: MouseEvent) {
    e.preventDefault();
    this._logDragStartY = e.clientY;
    this._logDragStartH = this.logHeight();
    this.logDragging = true;
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e: MouseEvent) {
    if (this.hDragging && this.hContainerEl) {
      const rect = this.hContainerEl.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      this.leftWidth.set(Math.max(15, Math.min(85, pct)));
    }
    if (this.vDragging && this.vContainerEl) {
      const rect = this.vContainerEl.getBoundingClientRect();
      const h = rect.bottom - e.clientY;
      this.transferHeight.set(Math.max(80, Math.min(500, h)));
    }
    if (this.logDragging) {
      const delta = e.clientY - this._logDragStartY;
      this.logHeight.set(Math.max(60, Math.min(400, this._logDragStartH + delta)));
    }
  }

  @HostListener('document:mouseup')
  stopDrag() {
    this.hDragging = false;
    this.vDragging = false;
    this.logDragging = false;
  }

  // ── Quick connect bar ────────────────────────────────────────────────────
  async doQuickConnect() {
    if (!this.qcHost) return;
    let host = this.qcHost.trim();
    let protocol: 'ftp' | 'sftp' = 'ftp';
    let port = this.qcPort;

    if (host.startsWith('sftp://')) { protocol = 'sftp'; host = host.slice(7); }
    else if (host.startsWith('ftp://')) { host = host.slice(6); }

    if (!port) port = protocol === 'sftp' ? 22 : 21;

    const profile: ConnectionProfile = {
      id: '', name: host, host, port, protocol,
      username: this.qcUser, password: this.qcPass,
      remotePath: '/', folder: [],
    };
    await this.connectTo(profile);
  }

  async connectTo(profile: ConnectionProfile, tabAction?: 'new' | 'current') {
    try {
      if (this.connSvc.sessions().length === 0 || tabAction === 'current') {
        const activeIdx = this.connSvc.activeIndex();
        const oldSession = this.connSvc.sessions()[activeIdx];
        if (oldSession) this.fsSvc.clearSessionState(oldSession.sessionId);
        const sessionId = await this.connSvc.connectInTab(profile, activeIdx);
        this.connSvc.tabLocalPaths[activeIdx] = '/';
        await this.fsSvc.listRemote(sessionId, profile.protocol, profile.remotePath || '/');
      } else if (tabAction === 'new') {
        const currentIdx = this.connSvc.activeIndex();
        this.connSvc.tabLocalPaths[currentIdx] = this.fsSvc.localPath();
        const sessionId = await this.connSvc.connect(profile);
        this.connSvc.tabLocalPaths[this.connSvc.activeIndex()] = '/';
        await this.fsSvc.listRemote(sessionId, profile.protocol, profile.remotePath || '/');
      } else {
        await this.openTabChoicePopup(profile);
      }
    } catch (e) { console.error('Connect failed', e); }
  }

  private async openTabChoicePopup(profile: ConnectionProfile) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('tab-choice');
    if (existing) { await existing.setFocus(); return; }
    const base = `${window.location.origin}${window.location.pathname}`;

    const { listen: listenEvent } = await import('@tauri-apps/api/event');
    let unlistenFn: (() => void) | null = null;
    unlistenFn = await listenEvent<{ action: 'new' | 'current' }>('tab-choice-result', async (event) => {
      unlistenFn?.();
      await this.connectTo(profile, event.payload.action);
    });

    new WebviewWindow('tab-choice', {
      url: `${base}?window=tab-choice&host=${encodeURIComponent(profile.host)}`,
      title: 'Connect — Piply',
      width: 360,
      height: 220,
      minWidth: 320,
      minHeight: 200,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
    });
  }

  async disconnect() {
    const activeSession = this.connSvc.activeSession();
    if (activeSession) this.fsSvc.clearSessionState(activeSession.sessionId);
    await this.connSvc.disconnect();
    const newActive = this.connSvc.activeSession();
    if (!newActive) {
      this.fsSvc.remoteEntries.set([]);
      this.fsSvc.remotePath.set('/');
    } else {
      this.fsSvc.restoreRemoteState(newActive.sessionId);
    }
  }

  /** Save current local path, switch tab, restore remote and local state. */
  async switchTab(index: number) {
    const currentIdx = this.connSvc.activeIndex();
    const currentSession = this.connSvc.activeSession();

    // Save current tab's local path before switching
    if (currentSession) {
      this.connSvc.tabLocalPaths[currentIdx] = this.fsSvc.localPath();
    }

    // Switch to the new tab
    const session = this.connSvc.sessions()[index];
    if (!session) return;
    this.connSvc.setActiveIndex(index);

    // Restore remote state for the new session
    this.fsSvc.restoreRemoteState(session.sessionId);

    // Restore saved local path, or default to '/'
    const savedPath = this.connSvc.tabLocalPaths[index] || '/';
    await this.fsSvc.listLocal(savedPath);
  }

  /** Close the tab at the given index. */
  async closeTab(index: number, event: Event) {
    event.stopPropagation();
    const session = this.connSvc.sessions()[index];
    if (!session) return;
    this.fsSvc.clearSessionState(session.sessionId);
    await this.connSvc.disconnectAt(index);
    const active = this.connSvc.activeSession();
    if (active) {
      this.fsSvc.restoreRemoteState(active.sessionId);
      const savedPath = this.connSvc.tabLocalPaths[this.connSvc.activeIndex()] || '/';
      await this.fsSvc.listLocal(savedPath);
    } else {
      this.fsSvc.remoteEntries.set([]);
      this.fsSvc.remotePath.set('/');
      this.fsSvc.localEntries.set([]);
      this.fsSvc.localPath.set('/');
    }
  }

  // ── Connection Manager window ─────────────────────────────────────────────
  async openConnectionManager() {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const existing = await WebviewWindow.getByLabel('connection-manager');
    if (existing) { await existing.setFocus(); return; }

    const base = `${window.location.origin}${window.location.pathname}`;
    new WebviewWindow('connection-manager', {
      url: `${base}?window=connection-manager`,
      title: 'Connection Manager — Piply',
      width: 780,
      height: 540,
      minWidth: 640,
      minHeight: 420,
      resizable: true,
      decorations: false,
      fullscreen: false,
      maximized: false,
      alwaysOnTop: true,
      parent: getCurrentWindow(),
    });
  }

  toggleComparison() {
    this.comparisonSvc.toggle();
    if (!this.comparisonSvc.enabled()) this.syncSvc.syncScroll.set(false);
  }
  toggleSyncBrowse() {
    if (this.syncSvc.enabled()) {
      this.syncSvc.disable();
    } else {
      this.syncSvc.enable(this.fsSvc.localPath(), this.fsSvc.remotePath());
    }
  }

  toggleSyncScroll() {
    this.syncSvc.syncScroll.update(v => !v);
  }

  openSettings() {
    import('@tauri-apps/api/webviewWindow').then(async ({ WebviewWindow }) => {
      const existing = await WebviewWindow.getByLabel('settings');
      if (existing) { await existing.setFocus(); return; }
      const base = `${window.location.origin}${window.location.pathname}`;
      new WebviewWindow('settings', {
        url: `${base}?window=settings`,
        title: 'Settings — Piply',
        width: 640,
        height: 540,
        minWidth: 480,
        minHeight: 400,
        resizable: true,
        decorations: false,
        fullscreen: false,
        maximized: false,
        alwaysOnTop: true,
        parent: getCurrentWindow(),
      });
    });
  }

  async openSshKeyManager() {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('ssh-key-manager');
    if (existing) { await existing.setFocus(); return; }
    const base = `${window.location.origin}${window.location.pathname}`;
    new WebviewWindow('ssh-key-manager', {
      url: `${base}?window=ssh-key-manager`,
      title: 'SSH Key Manager — Piply',
      width: 640,
      height: 480,
      minWidth: 520,
      minHeight: 360,
      resizable: true,
      decorations: false,
      fullscreen: false,
      maximized: false,
      alwaysOnTop: true,
      parent: getCurrentWindow(),
    });
  }

  setTreePos(pos: 'left' | 'right' | 'top' | 'hidden') {
    this.settingsSvc.treePosition.set(pos);
    this.settingsSvc.applyAll();
  }

  async refreshBoth() {
    await this.fsSvc.listLocal(this.fsSvc.localPath());
    const session = this.connSvc.activeSession();
    if (session) await this.fsSvc.listRemote(session.sessionId, session.profile.protocol, this.fsSvc.remotePath());
  }

  // ── Window controls ──────────────────────────────────────────────────────
  async winMinimize() { await getCurrentWindow().minimize(); }
  async winMaximize() { await getCurrentWindow().toggleMaximize(); }
  async winClose()    { await getCurrentWindow().close(); }
}
