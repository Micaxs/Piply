import { Component, inject, OnInit, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ConnectionService, ConnectionProfile, Protocol } from '../../services/connection.service';
import { SettingsService } from '../../services/settings.service';
import { FolderTreeComponent, FolderNode } from '../folder-tree/folder-tree.component';

type PanelMode = 'idle' | 'new' | 'edit';
type CtxMenu =
  | { kind: 'folder'; folder: string; x: number; y: number }
  | { kind: 'server'; conn: ConnectionProfile; x: number; y: number }
  | null;

@Component({
  selector: 'app-site-manager',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule,
    FolderTreeComponent,
  ],
  template: `
    <div class="sm-root" (click)="closeCtx()">

      <!-- Title bar -->
      <div class="sm-titlebar" data-tauri-drag-region>
        <mat-icon class="sm-logo" style="pointer-events:none">storage</mat-icon>
        <span class="sm-title-text" style="pointer-events:none">Connection Manager</span>
        <span class="sm-spacer" style="pointer-events:none"></span>
        <button class="wctl wctl-close" (click)="closeWindow()" title="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Body -->
      <div class="sm-body">

        <!-- Left: tree -->
        <div class="sm-list">

          <!-- Root "Servers" -->
          <div class="sm-folder-header"
               [class.selected]="selectedFolder() === ''"
               [class.drag-over]="dragOverFolder() === ''"
               (click)="selectFolder('')"
               (contextmenu)="onFolderCtx($event, '')"
               (dragover)="onDragOver($event, '')"
               (dragleave)="onDragLeave($event)"
               (drop)="onDrop($event, '')">
            <mat-icon class="folder-chevron">{{ openFolders().has('') ? 'expand_more' : 'chevron_right' }}</mat-icon>
            <mat-icon class="folder-icon root-icon">dns</mat-icon>
            <span>Servers</span>
          </div>
          @if (openFolders().has('')) {
            @for (conn of byFolder(''); track conn.id) {
              <div class="sm-item"
                   [class.selected]="selected()?.id === conn.id"
                   [class.dragging]="draggingConn()?.id === conn.id"
                   draggable="true"
                   (dragstart)="onDragStart($event, conn)"
                   (dragend)="onDragEnd()"
                   (click)="selectConn(conn)"
                   (dblclick)="connect()"
                   (contextmenu)="onServerCtx($event, conn)">
                <mat-icon class="sm-item-icon" [class.sftp]="conn.protocol === 'sftp' || conn.protocol === 'ftps'">
                  {{ conn.protocol === 'sftp' ? 'lock' : conn.protocol === 'ftps' ? 'lock_open' : 'cloud' }}
                </mat-icon>
                <div class="sm-item-text">
                  <div class="sm-item-name">{{ conn.name }}</div>
                </div>
              </div>
            }
          }

          <!-- Nested folder tree (Phase E) -->
          @if (folderTree().length > 0) {
            <app-folder-tree
              [folders]="folderTree()"
              [connections]="connectionSvc.connections()"
              [selectedPath]="selectedFolder()"
              [selectedConnectionId]="selected()?.id ?? ''"
              (folderClick)="onTreeFolderClick($event)"
              (folderContext)="onTreeFolderContext($event)"
              (folderDragStart)="onTreeFolderDragStart($event)"
              (folderDragEnd)="onTreeFolderDragEnd()"
              (folderDragOver)="onTreeFolderDragOver($event)"
              (folderDragLeave)="onTreeFolderDragLeave($event)"
              (folderDrop)="onTreeFolderDrop($event)"
              (connectionClick)="onTreeConnectionClick($event)"
              (connectionContext)="onTreeConnectionContext($event)"
              (connectionDragStart)="onTreeConnectionDragStart($event)"
              (connectionDragEnd)="onTreeConnectionDragEnd()"
            />
          }

          @if (connectionSvc.connections().length === 0 && folders().length === 0) {
            <div class="sm-empty">No saved servers.<br/>Click <b>New Site</b> to add one.</div>
          }

          <!-- New folder input -->
          @if (addingFolder()) {
            <div class="sm-new-folder-row">
              <input class="sm-folder-input" [(ngModel)]="newFolderName"
                     placeholder="Folder name"
                     (keydown.enter)="confirmNewFolder()"
                     (keydown.escape)="addingFolder.set(false)" autofocus />
              <button class="icon-btn" (click)="confirmNewFolder()" title="Create">
                <mat-icon>check</mat-icon>
              </button>
              <button class="icon-btn" (click)="addingFolder.set(false)" title="Cancel">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }
        </div>

        <div class="sm-list-divider"></div>

        <!-- Right: form or detail -->
        <div class="sm-detail">
          @if (mode() === 'new' || mode() === 'edit') {
            <!-- Inline form -->
            <div class="sm-form-wrap">
              <div class="sm-form-hdr">{{ mode() === 'new' ? 'New Server' : 'Edit Server' }}</div>
              <form [formGroup]="form" class="sm-form" autocomplete="off">
                <div class="sm-row">
                  <label class="sm-lbl">Name</label>
                  <input class="sm-inp" formControlName="name" placeholder="My Server" />
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Protocol</label>
                  <select class="sm-sel" formControlName="protocol" (change)="onProtocolChange()">
                    <option value="ftp">FTP</option>
                    <option value="sftp">SFTP</option>
                    <option value="ftps">FTPS (Explicit TLS)</option>
                  </select>
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Host</label>
                  <input class="sm-inp" formControlName="host" placeholder="ftp.example.com" />
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Port</label>
                  <input class="sm-inp sm-inp-sm" formControlName="port" type="number" />
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Username</label>
                  <input class="sm-inp" formControlName="username" placeholder="anonymous" />
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Password</label>
                  <div class="sm-pw-wrap">
                    <input class="sm-inp" formControlName="password"
                           [type]="showPass ? 'text' : 'password'" />
                    <button type="button" class="icon-btn" (click)="showPass = !showPass">
                      <mat-icon>{{ showPass ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                  </div>
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Remote Path</label>
                  <input class="sm-inp" formControlName="remotePath" placeholder="/" />
                </div>
                <div class="sm-row">
                  <label class="sm-lbl">Folder</label>
                  <input class="sm-inp" formControlName="folder"
                         placeholder="e.g. Work Servers" list="sm-folder-list" />
                  <datalist id="sm-folder-list">
                    @for (f of folders(); track f) { <option [value]="f">{{ f }}</option> }
                  </datalist>
                </div>

                @if (testResult()) {
                  <div class="sm-test-result" [class.ok]="testSuccess()" [class.fail]="!testSuccess()">
                    <mat-icon>{{ testSuccess() ? 'check_circle' : 'error' }}</mat-icon>
                    {{ testResult() }}
                  </div>
                }
              </form>

              <div class="sm-form-foot">
                <button class="sm-btn" (click)="testConn()" [disabled]="form.invalid || testing()">
                  @if (testing()) { <mat-spinner diameter="13" /> }
                  @else { <mat-icon>wifi_tethering</mat-icon> }
                  Test Connection
                </button>
                <span class="sm-spacer"></span>
                <button class="sm-btn" (click)="cancelForm()">Cancel</button>
                <button class="sm-btn sm-btn-primary" (click)="saveForm()" [disabled]="form.invalid || saving()">
                  @if (saving()) { <mat-spinner diameter="13" /> }
                  @else { <mat-icon>save</mat-icon> }
                  Save
                </button>
              </div>
            </div>

          } @else if (selected(); as s) {
            <div class="sm-view-wrap">
              <div class="sm-detail-grid">
                <span class="sm-label">Protocol</span>   <span class="sm-value">{{ s.protocol.toUpperCase() }}</span>
                <span class="sm-label">Host</span>       <span class="sm-value">{{ s.host }}</span>
                <span class="sm-label">Port</span>       <span class="sm-value">{{ s.port }}</span>
                <span class="sm-label">Username</span>   <span class="sm-value">{{ s.username || '(anonymous)' }}</span>
                <span class="sm-label">Remote path</span><span class="sm-value">{{ s.remotePath || '/' }}</span>
                <span class="sm-label">Folder</span>     <span class="sm-value">{{ s.folder || 'Servers' }}</span>
              </div>
              @if (testSelectedResult()) {
                <div class="sm-test-result" style="margin: 12px 0 0"
                     [class.ok]="testSelectedResult()!.ok" [class.fail]="!testSelectedResult()!.ok">
                  <mat-icon>{{ testSelectedResult()!.ok ? 'check_circle' : 'error' }}</mat-icon>
                  {{ testSelectedResult()!.msg }}
                </div>
              }
            </div>

          } @else {
            <div class="sm-no-sel">
              <mat-icon>dns</mat-icon>
              <p>Select a server from the list<br/>or click <b>New Site</b> to add one.</p>
            </div>
          }
        </div>
      </div>

      <!-- Actions bar -->
      <div class="sm-actions">
        <button class="sm-btn" (click)="newSite()">
          <mat-icon>add</mat-icon> New Site
        </button>
        <button class="sm-btn" (click)="addingFolder.set(true)" title="New Folder">
          <mat-icon>create_new_folder</mat-icon> New Folder
        </button>
        <button class="sm-btn" (click)="editSite()" [disabled]="!selected()">
          <mat-icon>edit</mat-icon> Edit
        </button>
        <button class="sm-btn sm-btn-danger" (click)="deleteSite()" [disabled]="!selected()">
          <mat-icon>delete</mat-icon> Delete
        </button>
        <span class="sm-spacer"></span>
        <button class="sm-btn" (click)="testSelectedConn()"
                [disabled]="!selected() || testingSelected()">
          @if (testingSelected()) { <mat-spinner diameter="13" /> }
          @else { <mat-icon>wifi_tethering</mat-icon> }
          Test
        </button>
        <button class="sm-btn sm-btn-green" (click)="connect()"
                [disabled]="!selected() || connecting()">
          @if (connecting()) { <mat-spinner diameter="13" /> }
          @else { <mat-icon>power</mat-icon> }
          Connect
        </button>
      </div>

      <!-- ── Context menu ──────────────────────────────────────── -->
      @if (ctxMenu(); as ctx) {
        <div class="ctx-backdrop" (click)="closeCtx()"></div>
        <div class="ctx-menu" [style.left.px]="ctx.x" [style.top.px]="ctx.y"
             (click)="$event.stopPropagation()">

          @if (ctx.kind === 'folder' && ctx.folder !== '') {
            <!-- Named folder options -->
            <div class="ctx-item" (click)="startRenameFolder(ctx.folder)">
              <mat-icon>drive_file_rename_outline</mat-icon> Rename Folder
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item ctx-danger" (click)="askDeleteFolder(ctx.folder)">
              <mat-icon>delete_outline</mat-icon> Delete Folder
            </div>

          } @else if (ctx.kind === 'server') {
            <!-- Server options -->
            <div class="ctx-item" (click)="ctxEditServer(ctx.conn)">
              <mat-icon>edit</mat-icon> Rename / Edit
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item ctx-has-sub" (mouseenter)="ctxShowMove.set(true)"
                 (mouseleave)="ctxShowMove.set(false)">
              <mat-icon>drive_file_move</mat-icon> Move to Folder
              <mat-icon class="ctx-arrow">chevron_right</mat-icon>
              @if (ctxShowMove()) {
                <div class="ctx-submenu">
                  @if (folderPathToString(ctx.conn.folder) !== '') {
                    <div class="ctx-item" (click)="ctxMoveServer(ctx.conn, '')">
                      <mat-icon class="root-icon">dns</mat-icon> Servers (root)
                    </div>
                  }
                  @for (f of folders(); track f) {
                    @if (f !== folderPathToString(ctx.conn.folder)) {
                      <div class="ctx-item" (click)="ctxMoveServer(ctx.conn, f)">
                        <mat-icon style="color:var(--ctp-yellow)">folder</mat-icon> {{ f }}
                      </div>
                    }
                  }
                  @if (folders().length === 0 || (folders().length === 1 && folders()[0] === folderPathToString(ctx.conn.folder))) {
                    <div class="ctx-item ctx-disabled">No other folders</div>
                  }
                </div>
              }
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item ctx-danger" (click)="ctxDeleteServer(ctx.conn)">
              <mat-icon>delete_outline</mat-icon> Delete
            </div>
          }
        </div>
      }

      <!-- ── Delete folder confirmation dialog ─────────────────── -->
      @if (deleteFolderConfirm(); as dlg) {
        <div class="dlg-overlay" (click)="deleteFolderConfirm.set(null)">
          <div class="dlg-box" (click)="$event.stopPropagation()">
            <div class="dlg-title">
              <mat-icon style="color:var(--ctp-red)">warning</mat-icon>
              Delete folder "{{ dlg.folder }}"
            </div>
            @if (connectionsUnderFolder(dlg.folder).length > 0) {
              <p class="dlg-msg">
                This folder contains <b>{{ connectionsUnderFolder(dlg.folder).length }}</b>
                server{{ connectionsUnderFolder(dlg.folder).length > 1 ? 's' : '' }}.
                What should happen to them?
              </p>
              <div class="dlg-actions">
                <button class="sm-btn" (click)="deleteFolderConfirm.set(null)">Cancel</button>
                <button class="sm-btn" (click)="doDeleteFolder('move')">
                  <mat-icon>drive_file_move</mat-icon> Move to root
                </button>
                <button class="sm-btn sm-btn-danger" (click)="doDeleteFolder('delete')">
                  <mat-icon>delete_forever</mat-icon> Delete All
                </button>
              </div>
            } @else {
              <p class="dlg-msg">Are you sure you want to delete the empty folder "{{ dlg.folder }}"?</p>
              <div class="dlg-actions">
                <button class="sm-btn" (click)="deleteFolderConfirm.set(null)">Cancel</button>
                <button class="sm-btn sm-btn-danger" (click)="doDeleteFolder('delete')">
                  <mat-icon>delete</mat-icon> Delete
                </button>
              </div>
            }
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100vh; }
    .sm-root    { display: flex; flex-direction: column; width: 100%; height: 100%; background: var(--ctp-base); color: var(--ctp-text); position: relative; overflow: hidden; }

    /* ── Titlebar ─────────────────────────────────────────────── */
    .sm-titlebar  { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 12px; background: var(--ctp-crust); border-bottom: 1px solid var(--ctp-surface0); user-select: none; flex-shrink: 0; }
    .sm-logo      { color: var(--ctp-blue); font-size: 16px; width: 16px; height: 16px; }
    .sm-title-text{ font-weight: 700; font-size: 13px; color: var(--ctp-text); letter-spacing: 0.5px; flex: 1; }
    .sm-spacer    { flex: 1; }
    .wctl         { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: none; background: transparent; cursor: pointer; color: var(--ctp-subtext0); border-radius: 0; }
    .wctl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wctl-close:hover { color: var(--ctp-crust); background: var(--ctp-red); }

    /* ── Body ─────────────────────────────────────────────────── */
    .sm-body      { display: flex; flex: 1; overflow: hidden; min-height: 0; }
    .sm-list      { width: 240px; flex-shrink: 0; overflow-y: auto; overflow-x: hidden; background: var(--ctp-mantle); }
    .sm-list-divider { width: 1px; background: var(--ctp-surface0); flex-shrink: 0; }

    /* Tree */
    .sm-folder-header { display: flex; align-items: center; gap: 4px; padding: 5px 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--ctp-text); }
    .sm-folder-header:hover { background: var(--ctp-surface0); }
    .folder-chevron   { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-overlay1); flex-shrink: 0; }
    .folder-icon      { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-yellow); flex-shrink: 0; }
    .root-icon        { color: var(--ctp-blue); }

    .sm-folder-rename-inp {
      flex: 1; height: 20px; padding: 0 4px;
      background: var(--ctp-surface0);
      border: 1px solid var(--ctp-blue);
      border-radius: 3px; color: var(--ctp-text);
      font-size: 12px; font-weight: 600; outline: none;
      min-width: 0;
    }

    .sm-item          { display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 28px; cursor: grab; }
    .sm-item:hover    { background: var(--ctp-surface0); }
    .sm-item.selected { background: rgba(137,180,250,0.18); }
    .sm-item.dragging { opacity: 0.4; }
    .sm-folder-header.drag-over { background: rgba(137,180,250,0.2); outline: 1px dashed var(--ctp-blue); outline-offset: -2px; }
    .sm-item-icon     { font-size: 15px; width: 15px; height: 15px; color: var(--ctp-blue); flex-shrink: 0; }
    .sm-item-icon.sftp{ color: var(--ctp-mauve); }
    .sm-item-text     { display: flex; flex-direction: column; min-width: 0; }
    .sm-item-name     { font-size: 12px; color: var(--ctp-text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm-item-host     { font-size: 10px; color: var(--ctp-subtext0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm-empty         { padding: 16px 12px; font-size: 12px; color: var(--ctp-overlay0); text-align: center; line-height: 1.6; }

    .sm-new-folder-row { display: flex; align-items: center; padding: 4px 8px; gap: 4px; }
    .sm-folder-input   { flex: 1; height: 24px; padding: 0 6px; background: var(--ctp-surface0); border: 1px solid var(--ctp-blue); border-radius: 4px; color: var(--ctp-text); font-size: 12px; outline: none; }

    /* ── Detail / Form ────────────────────────────────────────── */
    .sm-detail    { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }

    /* Read-only view */
    .sm-view-wrap   { padding: 20px 24px; overflow-y: auto; height: 100%; box-sizing: border-box; }
    .sm-detail-grid { display: grid; grid-template-columns: 110px 1fr; gap: 10px 16px; align-items: baseline; }
    .sm-label       { font-size: 11px; color: var(--ctp-subtext0); font-weight: 500; text-align: right; }
    .sm-value       { font-size: 12px; color: var(--ctp-text); font-family: monospace; word-break: break-all; }

    /* Empty state */
    .sm-no-sel      { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--ctp-overlay0); }
    .sm-no-sel mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.4; }
    .sm-no-sel p    { text-align: center; font-size: 13px; line-height: 1.6; }
    .sm-no-sel b    { color: var(--ctp-subtext1); }

    /* Inline form */
    .sm-form-wrap { display: flex; flex-direction: column; height: 100%; }
    .sm-form-hdr  { font-size: 12px; font-weight: 700; color: var(--ctp-subtext0); text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 16px 6px; border-bottom: 1px solid var(--ctp-surface0); flex-shrink: 0; }
    .sm-form      { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .sm-row       { display: flex; align-items: center; gap: 10px; }
    .sm-lbl       { font-size: 11px; color: var(--ctp-subtext0); font-weight: 500; width: 90px; flex-shrink: 0; text-align: right; }
    .sm-inp       { flex: 1; height: 28px; padding: 0 8px; background: var(--ctp-surface0); border: 1px solid var(--ctp-surface1); border-radius: 4px; color: var(--ctp-text); font-size: 12px; outline: none; min-width: 0; }
    .sm-inp:focus { border-color: var(--ctp-blue); }
    .sm-inp-sm    { flex: none; width: 70px; }
    .sm-sel       { height: 28px; padding: 0 6px; background: var(--ctp-surface0); border: 1px solid var(--ctp-surface1); border-radius: 4px; color: var(--ctp-text); font-size: 12px; outline: none; }
    .sm-sel:focus { border-color: var(--ctp-blue); }
    .sm-pw-wrap   { flex: 1; display: flex; align-items: center; min-width: 0; }
    .sm-pw-wrap .sm-inp { border-radius: 4px 0 0 4px; border-right: none; }
    .sm-pw-wrap .icon-btn { height: 28px; width: 28px; border-radius: 0 4px 4px 0; border: 1px solid var(--ctp-surface1); background: var(--ctp-surface0); flex-shrink: 0; }
    .sm-pw-wrap .icon-btn:hover { background: var(--ctp-surface1); }

    .sm-form-foot { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--ctp-surface0); flex-shrink: 0; background: var(--ctp-mantle); }

    .sm-test-result       { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 4px; font-size: 12px; margin-top: 4px; }
    .sm-test-result mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    .sm-test-result.ok    { background: rgba(166,227,161,0.12); color: var(--ctp-green); border: 1px solid rgba(166,227,161,0.3); }
    .sm-test-result.fail  { background: rgba(243,139,168,0.12); color: var(--ctp-red);   border: 1px solid rgba(243,139,168,0.3); }

    /* ── Actions bar ──────────────────────────────────────────── */
    .sm-actions   { display: flex; align-items: center; gap: 4px; padding: 8px 10px; background: var(--ctp-mantle); border-top: 1px solid var(--ctp-surface0); flex-shrink: 0; }

    /* Generic button */
    .sm-btn {
      display: inline-flex; align-items: center; gap: 4px;
      height: 28px; padding: 0 10px;
      background: var(--ctp-surface0);
      border: 1px solid var(--ctp-surface1);
      border-radius: 5px;
      color: var(--ctp-text);
      font-size: 12px; font-family: inherit; cursor: pointer;
      transition: background 0.1s;
      white-space: nowrap;
    }
    .sm-btn mat-icon { font-size: 14px; width: 14px; height: 14px; line-height: 14px; }
    .sm-btn mat-spinner { opacity: 0.6; }
    .sm-btn:hover:not(:disabled) { background: var(--ctp-surface1); }
    .sm-btn:disabled { opacity: 0.4; cursor: default; }

    .sm-btn-primary { background: var(--ctp-blue); border-color: var(--ctp-blue); color: var(--ctp-crust); }
    .sm-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

    .sm-btn-green { background: var(--ctp-green); border-color: var(--ctp-green); color: var(--ctp-crust); }
    .sm-btn-green:hover:not(:disabled) { filter: brightness(1.08); }

    .sm-btn-danger:hover:not(:disabled) { background: rgba(243,139,168,0.15); border-color: var(--ctp-red); color: var(--ctp-red); }
    .sm-btn-danger:hover:not(:disabled) mat-icon { color: var(--ctp-red); }

    .icon-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; background: transparent; border: none; border-radius: 4px; color: var(--ctp-subtext0); cursor: pointer; flex-shrink: 0; }
    .icon-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .icon-btn:hover { background: var(--ctp-surface1); color: var(--ctp-text); }

    /* ── Context menu ─────────────────────────────────────────── */
    .ctx-backdrop {
      position: fixed; inset: 0; z-index: 900;
    }
    .ctx-menu {
      position: fixed; z-index: 901;
      background: var(--ctp-mantle);
      border: 1px solid var(--ctp-surface1);
      border-radius: 6px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.4);
      padding: 4px 0;
      min-width: 160px;
      font-size: 12px;
    }
    .ctx-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 14px;
      cursor: pointer; color: var(--ctp-text);
      position: relative;
    }
    .ctx-item mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--ctp-subtext0); flex-shrink: 0; }
    .ctx-item:hover { background: var(--ctp-surface0); }
    .ctx-item.ctx-danger { color: var(--ctp-red); }
    .ctx-item.ctx-danger mat-icon { color: var(--ctp-red); }
    .ctx-item.ctx-disabled { opacity: 0.4; cursor: default; pointer-events: none; }
    .ctx-sep { height: 1px; background: var(--ctp-surface0); margin: 3px 0; }
    .ctx-arrow { margin-left: auto; color: var(--ctp-overlay1) !important; }
    .ctx-has-sub { padding-right: 8px; }

    .ctx-submenu {
      position: absolute; left: 100%; top: -4px;
      background: var(--ctp-mantle);
      border: 1px solid var(--ctp-surface1);
      border-radius: 6px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.4);
      padding: 4px 0;
      min-width: 160px;
      z-index: 902;
    }

    /* ── Delete folder dialog ─────────────────────────────────── */
    .dlg-overlay {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    }
    .dlg-box {
      background: var(--ctp-base);
      border: 1px solid var(--ctp-surface1);
      border-radius: 8px;
      padding: 20px 24px;
      min-width: 340px; max-width: 420px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .dlg-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 700; color: var(--ctp-text);
      margin-bottom: 12px;
    }
    .dlg-title mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .dlg-msg { font-size: 13px; color: var(--ctp-subtext1); line-height: 1.6; margin: 0 0 18px; }
    .dlg-msg b { color: var(--ctp-text); }
    .dlg-actions { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
  `],
})
export class SiteManagerComponent implements OnInit {
  connectionSvc    = inject(ConnectionService);
  settingsSvc      = inject(SettingsService);
  private fb       = inject(FormBuilder);

  selected           = signal<ConnectionProfile | null>(null);
  selectedFolder     = signal<string>('');
  connecting         = signal(false);
  openFolders        = signal<Set<string>>(new Set(['']));
  addingFolder       = signal(false);
  mode               = signal<PanelMode>('idle');
  storedFolders      = signal<string[]>([]);  // Will be loaded from encrypted storage
  draggingConn       = signal<ConnectionProfile | null>(null);
  draggingFolder     = signal<string[] | null>(null);
  dragOverFolder     = signal<string | null>(null);
  testingSelected    = signal(false);
  testing            = signal(false);
  testResult         = signal<string | null>(null);
  testSuccess        = signal(false);
  testSelectedResult = signal<{ msg: string; ok: boolean } | null>(null);
  saving             = signal(false);
  ctxMenu            = signal<CtxMenu>(null);
  ctxShowMove        = signal(false);
  deleteFolderConfirm = signal<{ folder: string } | null>(null);
  renamingFolder     = signal<string | null>(null);
  renameFolderVal    = '';
  showPass           = false;
  newFolderName      = '';
  form!: FormGroup;

  folders = computed(() => {
    const names = new Set<string>([...this.storedFolders()]);
    for (const c of this.connectionSvc.connections()) {
      if (c.folder && c.folder.length > 0) {
        names.add(this.folderPathToString(c.folder));
      }
    }
    return [...names].sort();
  });

  folderTree = computed(() => {
    return this.buildFolderTree();
  });

  @HostListener('document:keydown.escape')
  onEsc() { this.closeCtx(); this.deleteFolderConfirm.set(null); }

  async ngOnInit() {
    this.settingsSvc.load();
    this.settingsSvc.applyAll();
    await this.connectionSvc.loadConnections();
    // Load folders from encrypted storage instead of localStorage
    const folders = await this.connectionSvc.loadFoldersLegacy();
    this.storedFolders.set(folders);
    this.buildForm();
  }

  private buildForm(data?: Partial<ConnectionProfile>) {
    this.form = this.fb.group({
      name:       [data?.name       ?? '',    Validators.required],
      protocol:   [data?.protocol   ?? 'ftp', Validators.required],
      host:       [data?.host       ?? '',    Validators.required],
      port:       [data?.port       ?? 21,    [Validators.required, Validators.min(1), Validators.max(65535)]],
      username:   [data?.username   ?? ''],
      password:   [data?.password   ?? ''],
      remotePath: [data?.remotePath ?? '/'],
      folder:     [this.folderPathToString(data?.folder ?? [])],
    });
    this.testResult.set(null);
  }

  onProtocolChange() {
    const proto = this.form.get('protocol')?.value as Protocol;
    this.form.get('port')?.setValue(proto === 'sftp' ? 22 : 21);
  }

  byFolder(folder: string): ConnectionProfile[] {
    return this.connectionSvc.connections().filter(c => {
      // Convert folder array to string path for comparison
      const connFolderPath = this.folderPathToString(c.folder ?? []);
      return connFolderPath === folder;
    });
  }

  folderPathToString(path: string[]): string {
    return path.join('/') || '';
  }

  folderStringToPath(folderStr: string): string[] {
    return folderStr ? folderStr.split('/') : [];
  }

  private connectionFolderPath(conn: ConnectionProfile): string {
    return this.folderPathToString(conn.folder ?? []);
  }

  connectionsUnderFolder(folder: string): ConnectionProfile[] {
    return this.connectionSvc.connections().filter(conn => {
      const connFolder = this.connectionFolderPath(conn);
      return connFolder === folder || connFolder.startsWith(folder + '/');
    });
  }

  private async remapConnectionsUnderFolder(oldPrefix: string, newPrefix: string | null) {
    const oldParts = this.folderStringToPath(oldPrefix);
    const newParts = newPrefix === null ? null : this.folderStringToPath(newPrefix);
    const affected = this.connectionsUnderFolder(oldPrefix);

    for (const conn of affected) {
      const currentParts = conn.folder ?? [];
      const suffix = currentParts.slice(oldParts.length);
      if (newParts === null) {
        await this.connectionSvc.deleteConnection(conn.id);
      } else {
        await this.connectionSvc.saveConnection({ ...conn, folder: [...newParts, ...suffix] });
      }
    }
  }

  private openFolderPath(folder: string) {
    const parts = this.folderStringToPath(folder);
    this.openFolders.update(set => {
      const next = new Set(set);
      if (parts.length === 0) {
        next.add('');
        return next;
      }
      for (let i = 1; i <= parts.length; i++) {
        next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }

  private remapOpenFolderPaths(oldPrefix: string, newPrefix: string | null) {
    this.openFolders.update(set => {
      const next = new Set<string>();
      for (const path of set) {
        if (path === oldPrefix || path.startsWith(oldPrefix + '/')) {
          if (newPrefix === null) continue;
          const suffix = path.slice(oldPrefix.length);
          next.add(`${newPrefix}${suffix}`);
        } else {
          next.add(path);
        }
      }
      return next;
    });
  }

  private buildFolderTree(): FolderNode[] {
    const root: FolderNode[] = [];
    
    // Helper to find or create node in tree
    const getOrCreateNode = (tree: FolderNode[], pathParts: string[], upToIndex: number): FolderNode => {
      let current = tree;
      let parent: FolderNode | undefined;
      
      for (let i = 0; i < upToIndex; i++) {
        const part = pathParts[i];
        let node = current.find(n => n.name === part);
        
        if (!node) {
          node = { name: part, children: [] };
          current.push(node);
        }
        
        if (i < upToIndex - 1) {
          if (!node.children) node.children = [];
          current = node.children;
        } else {
          parent = node;
        }
      }
      
      return parent || (current[0] || { name: '', children: [] });
    };
    
    // Collect all unique folder paths
    const allPaths = new Set<string>();
    
    // From connections
    for (const c of this.connectionSvc.connections()) {
      if (c.folder && c.folder.length > 0) {
        for (let i = 1; i <= c.folder.length; i++) {
          allPaths.add(c.folder.slice(0, i).join('/'));
        }
      }
    }
    
    // From stored folders
    for (const f of this.storedFolders()) {
      if (f) allPaths.add(f);
    }
    
    // Build tree
    for (const pathStr of allPaths) {
      const parts = pathStr.split('/').filter(p => p);
      
      if (parts.length === 0) continue;
      
      // Ensure all parent folders exist
      for (let i = 1; i <= parts.length; i++) {
        const currentPath = parts.slice(0, i).join('/');
        let current = root;
        
        for (let j = 0; j < i; j++) {
          const part = parts[j];
          let found = current.find(n => n.name === part);
          
          if (!found) {
            found = { name: part, children: [] };
            current.push(found);
          }
          
          if (j < i - 1) {
            if (!found.children) found.children = [];
            current = found.children;
          }
        }
      }
    }
    
    // Sort all levels
    const sortTree = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of nodes) {
        if (node.children) sortTree(node.children);
      }
    };
    sortTree(root);
    
    return root;
  }

  toggleFolder(folder: string) {
    this.openFolders.update(set => {
      const next = new Set(set);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  }

  selectFolder(folder: string) {
    this.selectedFolder.set(folder);
    this.toggleFolder(folder);
  }

  selectConn(conn: ConnectionProfile) {
    this.selected.set(conn);
    this.testSelectedResult.set(null);
    if (this.mode() !== 'idle') this.mode.set('idle');
  }

  newSite() {
    this.selected.set(null);
    this.selectedFolder.set('');
    this.buildForm();
    this.mode.set('new');
  }

  editSite() {
    const s = this.selected();
    if (!s) return;
    this.buildForm(s);
    this.mode.set('edit');
  }

  cancelForm() { this.mode.set('idle'); }

  async saveForm() {
    if (this.form.invalid) return;
    this.saving.set(true);
    try {
      const v = this.form.value;
      const current = this.selected();
      const profile: ConnectionProfile = {
        id: this.mode() === 'edit' ? (this.selected()?.id ?? '') : '',
        name: v.name, protocol: v.protocol, host: v.host, port: +v.port,
        username: v.username, password: v.password, remotePath: v.remotePath,
        folder: this.folderStringToPath(v.folder ?? ''),
        keyId: v.protocol === 'sftp' ? current?.keyId : undefined,
      };
      const saved = await this.connectionSvc.saveConnection(profile);
      this.selected.set(saved);
      this.mode.set('idle');
    } catch (e) {
      console.error('Failed to save connection:', e);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteSite() {
    const conn = this.selected();
    if (!conn) return;
    await this.connectionSvc.deleteConnection(conn.id);
    this.selected.set(null);
  }

  async confirmNewFolder() {
    const name = this.newFolderName.trim();
    if (name) {
      try {
        const parentPath = this.folderStringToPath(this.selectedFolder());
        await this.connectionSvc.addFolderNested(parentPath, name);
        this.storedFolders.set(await this.connectionSvc.loadFoldersLegacy());
        const target = this.selectedFolder();
        if (target) this.openFolderPath(target);
        else this.openFolders.update(s => new Set([...s, '']));
      } catch (e) {
        console.error('Failed to add folder:', e);
      }
    }
    this.newFolderName = '';
    this.addingFolder.set(false);
  }

  // ── Context menu ──────────────────────────────────────────────
  onFolderCtx(e: MouseEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    if (folder === '') return; // root "Servers" has no context actions
    this.ctxMenu.set({ kind: 'folder', folder, x: e.clientX, y: e.clientY });
    this.ctxShowMove.set(false);
  }

  onServerCtx(e: MouseEvent, conn: ConnectionProfile) {
    e.preventDefault();
    e.stopPropagation();
    this.ctxMenu.set({ kind: 'server', conn, x: e.clientX, y: e.clientY });
    this.ctxShowMove.set(false);
  }

  closeCtx() {
    this.ctxMenu.set(null);
    this.ctxShowMove.set(false);
  }

  // Folder rename
  async startRenameFolder(folder: string) {
    this.closeCtx();
    const currentName = folder.split('/').pop() ?? folder;
    const newName = window.prompt(`Rename folder "${currentName}"`, currentName)?.trim();
    if (!newName || newName === currentName) return;

    try {
      const parent = folder.split('/').slice(0, -1).join('/');
      const nextPath = parent ? `${parent}/${newName}` : newName;
      await this.remapConnectionsUnderFolder(folder, nextPath);
      await this.connectionSvc.renameFolderNested(this.folderStringToPath(folder), newName);
      this.storedFolders.set(await this.connectionSvc.loadFoldersLegacy());
      this.remapOpenFolderPaths(folder, nextPath);
      if (this.selectedFolder() === folder || this.selectedFolder().startsWith(folder + '/')) {
        const suffix = this.selectedFolder().slice(folder.length).replace(/^\//, '');
        this.selectedFolder.set(suffix ? `${nextPath}/${suffix}` : nextPath);
      }
      const sel = this.selected();
      if (sel) {
        const selFolderPath = this.folderPathToString(sel.folder ?? []);
        if (selFolderPath === folder || selFolderPath.startsWith(folder + '/')) {
          const suffix = selFolderPath.slice(folder.length).replace(/^\//, '');
          const nextSelPath = suffix ? `${nextPath}/${suffix}` : nextPath;
          this.selected.set({ ...sel, folder: this.folderStringToPath(nextSelPath) });
        }
      }
    } catch (e) {
      console.error('Failed to rename folder:', e);
    }
  }

  async confirmRenameFolder() {
    const oldName = this.renamingFolder();
    const newName = this.renameFolderVal.trim();
    this.renamingFolder.set(null);
    if (!oldName || !newName || newName === oldName) return;

    try {
      const parent = oldName.split('/').slice(0, -1).join('/');
      const nextPath = parent ? `${parent}/${newName}` : newName;
      await this.remapConnectionsUnderFolder(oldName, nextPath);
      // Update stored folder names in encrypted storage
      await this.connectionSvc.renameFolderNested(this.folderStringToPath(oldName), newName);
      this.storedFolders.set(await this.connectionSvc.loadFoldersLegacy());
      // Keep the folder open under the new name
      this.remapOpenFolderPaths(oldName, nextPath);
      if (this.selectedFolder() === oldName || this.selectedFolder().startsWith(oldName + '/')) {
        const selSuffix = this.selectedFolder().slice(oldName.length).replace(/^\//, '');
        this.selectedFolder.set(selSuffix ? `${nextPath}/${selSuffix}` : nextPath);
      }
      // Update selected if it was in the renamed folder
      const sel = this.selected();
      if (sel) {
        const selFolderPath = this.folderPathToString(sel?.folder ?? []);
        if (selFolderPath === oldName || selFolderPath.startsWith(oldName + '/')) {
          const suffix = selFolderPath.slice(oldName.length).replace(/^\//, '');
          const nextSelPath = suffix ? `${nextPath}/${suffix}` : nextPath;
          this.selected.set({ ...sel, folder: this.folderStringToPath(nextSelPath) });
        }
      }
    } catch (e) {
      console.error('Failed to rename folder:', e);
    }
  }

  // Folder delete
  askDeleteFolder(folder: string) {
    this.closeCtx();
    this.deleteFolderConfirm.set({ folder });
  }

  async doDeleteFolder(action: 'delete' | 'move') {
    const dlg = this.deleteFolderConfirm();
    if (!dlg) return;
    const { folder } = dlg;
    const conns = this.connectionsUnderFolder(folder);

    try {
      if (action === 'delete') {
        await this.remapConnectionsUnderFolder(folder, null);
      } else {
        // Move all to root
        for (const c of conns) {
          await this.connectionSvc.saveConnection({ ...c, folder: [] });
        }
      }

      // Remove from stored folder list in encrypted storage
      await this.connectionSvc.removeFolderNested(this.folderStringToPath(folder));
      this.storedFolders.set(await this.connectionSvc.loadFoldersLegacy());
      this.remapOpenFolderPaths(folder, null);

      const selFolderPath = this.folderPathToString(this.selected()?.folder ?? []);
      if (selFolderPath === folder) this.selected.set(null);
      if (this.selectedFolder() === folder) this.selectedFolder.set('');
      this.deleteFolderConfirm.set(null);
    } catch (e) {
      console.error('Failed to delete folder:', e);
    }
  }

  // Server context actions
  ctxEditServer(conn: ConnectionProfile) {
    this.closeCtx();
    this.selectConn(conn);
    this.editSite();
  }

  async ctxMoveServer(conn: ConnectionProfile, folder: string) {
    this.closeCtx();
    try {
      const saved = await this.connectionSvc.saveConnection({ ...conn, folder: this.folderStringToPath(folder) });
      if (this.selected()?.id === conn.id) this.selected.set(saved);
      if (folder) this.openFolderPath(folder);
    } catch (e) {
      console.error('Failed to move server:', e);
    }
  }

  async ctxDeleteServer(conn: ConnectionProfile) {
    this.closeCtx();
    try {
      await this.connectionSvc.deleteConnection(conn.id);
      if (this.selected()?.id === conn.id) this.selected.set(null);
    } catch (e) {
      console.error('Failed to delete server:', e);
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────
  onDragStart(e: DragEvent, conn: ConnectionProfile) {
    this.draggingConn.set(conn);
    this.draggingFolder.set(null);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', conn.id);
  }

  onDragEnd() {
    this.draggingConn.set(null);
    this.draggingFolder.set(null);
    this.dragOverFolder.set(null);
  }

  onDragOver(e: DragEvent, folder: string) {
    const conn = this.draggingConn();
    const draggedFolder = this.draggingFolder();
    const connFolderPath = this.folderPathToString(conn?.folder ?? []);
    const draggedFolderPath = this.folderPathToString(draggedFolder ?? []);
    if (!conn && !draggedFolder) return;
    if (conn && connFolderPath === folder) return;
    if (draggedFolder && draggedFolderPath === folder) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    this.dragOverFolder.set(folder);
  }

  onDragLeave(e: DragEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      this.dragOverFolder.set(null);
    }
  }

  async onDrop(e: DragEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    const conn = this.draggingConn();
    const draggedFolder = this.draggingFolder();
    this.draggingConn.set(null);
    this.draggingFolder.set(null);
    this.dragOverFolder.set(null);

    const targetPath = this.folderStringToPath(folder);
    if (draggedFolder) {
      const sourcePath = draggedFolder;
      const sourcePrefix = this.folderPathToString(sourcePath);
      if (sourcePrefix !== folder) {
        try {
          await this.connectionSvc.moveFolderNested(sourcePath, targetPath);
          const leaf = sourcePath[sourcePath.length - 1];
          const nextPrefix = [...targetPath, leaf].join('/');
          await this.remapConnectionsUnderFolder(sourcePrefix, nextPrefix);
          this.storedFolders.set(await this.connectionSvc.loadFoldersLegacy());
          this.remapOpenFolderPaths(sourcePrefix, nextPrefix);
          if (folder) this.openFolderPath(folder);
        } catch (e) {
          console.error('Failed to move folder:', e);
        }
      }
      return;
    }

    const connFolderPath = this.folderPathToString(conn?.folder ?? []);
    if (!conn || connFolderPath === folder) return;

    const saved = await this.connectionSvc.saveConnection({ ...conn, folder: targetPath });
    if (this.selected()?.id === conn.id) this.selected.set(saved);
    if (folder) this.openFolderPath(folder);
  }

  // ── Test connection ───────────────────────────────────────────
  async testConn() {
    if (this.form.invalid) return;
    this.testing.set(true);
    this.testResult.set(null);
    const v = this.form.value;
    try {
      const current = this.selected();
      const sid = await invoke<{ sessionId: string }>('connect', {
        request: {
          profile: {
            id: '',
            name: v.name,
            protocol: v.protocol,
            host: v.host,
            port: +v.port,
            username: v.username,
            password: v.password,
            remotePath: v.remotePath,
            folder: this.folderStringToPath(v.folder ?? ''),
            keyId: v.protocol === 'sftp' ? current?.keyId : undefined,
          },
        },
      });
      await invoke('disconnect', { sessionId: sid.sessionId, protocol: v.protocol });
      this.testResult.set('Connection successful!');
      this.testSuccess.set(true);
    } catch (e: any) {
      this.testResult.set(e?.toString() ?? 'Connection failed');
      this.testSuccess.set(false);
    } finally {
      this.testing.set(false);
    }
  }

  async testSelectedConn() {
    const conn = this.selected();
    if (!conn) return;
    this.testingSelected.set(true);
    this.testSelectedResult.set(null);
    try {
      const sid = await invoke<{ sessionId: string }>('connect', { request: { profile: conn } });
      await invoke('disconnect', { sessionId: sid.sessionId, protocol: conn.protocol });
      this.testSelectedResult.set({ msg: 'Connection successful!', ok: true });
    } catch (e: any) {
      this.testSelectedResult.set({ msg: e?.toString() ?? 'Connection failed', ok: false });
    } finally {
      this.testingSelected.set(false);
    }
  }

  async connect() {
    const conn = this.selected();
    if (!conn) return;
    this.connecting.set(true);
    try {
      await emit('piply-connect', conn);
      await getCurrentWindow().close();
    } catch (e) {
      console.error('Failed to emit connect event:', e);
      this.connecting.set(false);
    }
  }

  async closeWindow() {
    await getCurrentWindow().close();
  }

  // ── Folder Tree Event Handlers (Phase E) ────────────────────────
  onTreeFolderClick(event: { path: string[] }) {
    const folderPath = event.path.join('/');
    this.selectedFolder.set(folderPath);
    this.toggleFolder(folderPath);
  }

  onTreeFolderContext(event: { path: string[]; event?: Event }) {
    const folderPath = event.path.join('/');
    if (event.event instanceof MouseEvent) {
      this.onFolderCtx(event.event, folderPath);
    }
  }

  onTreeFolderDragStart(event: { path: string[]; event?: Event }) {
    this.draggingFolder.set(event.path);
    this.draggingConn.set(null);
  }

  onTreeFolderDragEnd() {
    this.draggingFolder.set(null);
    this.dragOverFolder.set(null);
  }

  onTreeFolderDragOver(event: { path: string[]; event?: Event }) {
    const folderPath = event.path.join('/');
    this.dragOverFolder.set(folderPath);
  }

  onTreeFolderDragLeave(event: DragEvent) {
    this.dragOverFolder.set('');
  }

  onTreeFolderDrop(event: { path: string[]; event?: Event }) {
    const targetPath = event.path.join('/');
    if (event.event instanceof DragEvent) {
      this.onDrop(event.event, targetPath);
    }
  }

  onTreeConnectionClick(conn: ConnectionProfile) {
    this.selectConn(conn);
  }

  onTreeConnectionContext(event: { connection: ConnectionProfile; event?: Event }) {
    if (event.event instanceof MouseEvent) {
      this.onServerCtx(event.event, event.connection);
    }
  }

  onTreeConnectionDragStart(conn: ConnectionProfile) {
    this.draggingConn.set(conn);
    this.draggingFolder.set(null);
  }

  onTreeConnectionDragEnd() {
    this.draggingConn.set(null);
    this.dragOverFolder.set(null);
  }
}
