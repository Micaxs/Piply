import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { SettingsService } from '../../services/settings.service';

const params = new URLSearchParams(window.location.search);

@Component({
  selector: 'app-permissions-window',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <div class="pw-root">
      <div class="pw-titlebar" data-tauri-drag-region>
        <mat-icon class="pw-logo" style="pointer-events:none">lock</mat-icon>
        <span class="pw-title" style="pointer-events:none">Permissions — {{ fileName }}</span>
        <span style="flex:1;pointer-events:none"></span>
        <button class="wctl wctl-close" (click)="cancel()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="pw-body">
        <div class="perms-grid">
          <div></div>
          <div class="col-hdr">Owner</div>
          <div class="col-hdr">Group</div>
          <div class="col-hdr">Other</div>

          <div class="row-lbl">Read</div>
          <div class="cell"><mat-checkbox [(ngModel)]="ownerR" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="groupR" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="otherR" (change)="rebuild()"></mat-checkbox></div>

          <div class="row-lbl">Write</div>
          <div class="cell"><mat-checkbox [(ngModel)]="ownerW" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="groupW" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="otherW" (change)="rebuild()"></mat-checkbox></div>

          <div class="row-lbl">Execute</div>
          <div class="cell"><mat-checkbox [(ngModel)]="ownerX" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="groupX" (change)="rebuild()"></mat-checkbox></div>
          <div class="cell"><mat-checkbox [(ngModel)]="otherX" (change)="rebuild()"></mat-checkbox></div>
        </div>

        <div class="octal-row">
          <span class="octal-lbl">Octal value:</span>
          <input class="octal-inp" [(ngModel)]="octalStr" (change)="onOctalChange()" maxlength="4" />
          <span class="octal-preview">{{ octalPreview }}</span>
        </div>
      </div>

      <div class="pw-footer">
        <button mat-button (click)="cancel()">Cancel</button>
        <button mat-flat-button color="primary" (click)="apply()">Apply</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .pw-root {
      display: flex; flex-direction: column; height: 100vh;
      background: var(--ctp-base); color: var(--ctp-text);
      font-family: inherit; user-select: none;
    }

    .pw-titlebar {
      display: flex; align-items: center; gap: 8px;
      height: 38px; padding: 0 8px 0 12px; flex-shrink: 0;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .pw-logo { font-size: 18px; color: var(--ctp-blue); }
    .pw-title { font-size: 13px; font-weight: 600; color: var(--ctp-text); }

    .wctl {
      width: 28px; height: 28px; border: none; cursor: pointer;
      border-radius: 6px; display: flex; align-items: center; justify-content: center;
      background: transparent; color: var(--ctp-subtext0);
    }
    .wctl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wctl-close:hover { background: var(--ctp-red); color: var(--ctp-base); }

    .pw-body {
      flex: 1; padding: 24px 28px 16px; display: flex; flex-direction: column; gap: 20px;
    }

    .perms-grid {
      display: grid; grid-template-columns: 72px 1fr 1fr 1fr;
      gap: 10px 16px; align-items: center;
    }
    .col-hdr {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--ctp-subtext0); text-align: center;
    }
    .row-lbl { font-size: 13px; color: var(--ctp-text); }
    .cell { display: flex; justify-content: center; }

    .octal-row {
      display: flex; align-items: center; gap: 12px;
      padding-top: 16px; border-top: 1px solid var(--ctp-surface0);
    }
    .octal-lbl { font-size: 13px; color: var(--ctp-subtext0); }
    .octal-inp {
      width: 72px; height: 30px; padding: 0 10px; font-size: 14px;
      font-family: monospace; border-radius: 5px; outline: none;
      background: var(--ctp-surface0); border: 1px solid var(--ctp-overlay0);
      color: var(--ctp-text);
    }
    .octal-inp:focus { border-color: var(--ctp-blue); }
    .octal-preview { font-size: 12px; color: var(--ctp-subtext1); font-family: monospace; }

    .pw-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 12px 20px; border-top: 1px solid var(--ctp-surface0);
      background: var(--ctp-mantle); flex-shrink: 0;
    }
  `],
})
export class PermissionsWindowComponent implements OnInit {
  private settingsSvc = inject(SettingsService);

  fileName = params.get('file') ?? '';
  remotePath = params.get('path') ?? '';
  sessionId = params.get('sessionId') ?? '';
  protocol = params.get('protocol') ?? 'sftp';

  ownerR = false; ownerW = false; ownerX = false;
  groupR = false; groupW = false; groupX = false;
  otherR = false; otherW = false; otherX = false;
  octalStr = '0644';
  octalPreview = '';

  ngOnInit() {
    this.settingsSvc.load();
    this.settingsSvc.applyAll();
    const raw = params.get('mode');
    const mode = raw ? parseInt(raw, 10) : 0o644;
    this.fromMode(mode);
  }

  private fromMode(mode: number) {
    const m = mode & 0o7777;
    this.ownerR = !!(m & 0o400); this.ownerW = !!(m & 0o200); this.ownerX = !!(m & 0o100);
    this.groupR = !!(m & 0o040); this.groupW = !!(m & 0o020); this.groupX = !!(m & 0o010);
    this.otherR = !!(m & 0o004); this.otherW = !!(m & 0o002); this.otherX = !!(m & 0o001);
    this.octalStr = m.toString(8).padStart(4, '0');
    this.updatePreview(m);
  }

  rebuild() {
    let m = 0;
    if (this.ownerR) m |= 0o400; if (this.ownerW) m |= 0o200; if (this.ownerX) m |= 0o100;
    if (this.groupR) m |= 0o040; if (this.groupW) m |= 0o020; if (this.groupX) m |= 0o010;
    if (this.otherR) m |= 0o004; if (this.otherW) m |= 0o002; if (this.otherX) m |= 0o001;
    this.octalStr = m.toString(8).padStart(4, '0');
    this.updatePreview(m);
  }

  onOctalChange() {
    const val = parseInt(this.octalStr, 8);
    if (!isNaN(val)) this.fromMode(val);
  }

  private updatePreview(m: number) {
    const b = (v: number, c: string) => (m & v) ? c : '-';
    this.octalPreview =
      b(0o400,'r') + b(0o200,'w') + b(0o100,'x') + ' ' +
      b(0o040,'r') + b(0o020,'w') + b(0o010,'x') + ' ' +
      b(0o004,'r') + b(0o002,'w') + b(0o001,'x');
  }

  async apply() {
    const mode = parseInt(this.octalStr, 8);
    if (isNaN(mode)) return;
    await emit('permissions-apply', {
      sessionId: this.sessionId,
      protocol: this.protocol,
      path: this.remotePath,
      mode,
    });
    await getCurrentWindow().close();
  }

  async cancel() {
    await getCurrentWindow().close();
  }
}
