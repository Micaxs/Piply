import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface PermissionsDialogData {
  fileName: string;
  mode: number;
}

@Component({
  selector: 'app-permissions-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon style="vertical-align:middle;margin-right:8px">lock</mat-icon>
      Permissions — {{ data.fileName }}
    </h2>
    <mat-dialog-content>
      <div class="perms-grid">
        <div class="perms-header"></div>
        <div class="perms-header center">Owner</div>
        <div class="perms-header center">Group</div>
        <div class="perms-header center">Other</div>

        <div class="perms-label">Read</div>
        <div class="center"><mat-checkbox [(ngModel)]="ownerR" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="groupR" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="otherR" (change)="rebuild()"></mat-checkbox></div>

        <div class="perms-label">Write</div>
        <div class="center"><mat-checkbox [(ngModel)]="ownerW" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="groupW" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="otherW" (change)="rebuild()"></mat-checkbox></div>

        <div class="perms-label">Execute</div>
        <div class="center"><mat-checkbox [(ngModel)]="ownerX" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="groupX" (change)="rebuild()"></mat-checkbox></div>
        <div class="center"><mat-checkbox [(ngModel)]="otherX" (change)="rebuild()"></mat-checkbox></div>
      </div>
      <div class="octal-row">
        <span class="octal-label">Octal:</span>
        <input class="octal-input" [(ngModel)]="octalStr" (change)="onOctalChange()" maxlength="4" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="apply()">Apply</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .perms-grid { display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 8px 12px; align-items: center; margin-bottom: 16px; }
    .perms-header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ctp-subtext0); }
    .perms-label { font-size: 13px; color: var(--ctp-text); }
    .center { display: flex; justify-content: center; }
    .octal-row { display: flex; align-items: center; gap: 12px; padding-top: 8px; border-top: 1px solid var(--ctp-surface0); }
    .octal-label { font-size: 13px; color: var(--ctp-subtext0); }
    .octal-input {
      width: 72px; height: 28px; padding: 0 8px; font-size: 14px; font-family: monospace;
      background: var(--ctp-surface0); border: 1px solid var(--ctp-overlay0); border-radius: 4px;
      color: var(--ctp-text); outline: none;
    }
    .octal-input:focus { border-color: var(--ctp-blue); }
  `],
})
export class PermissionsDialogComponent {
  ownerR = false; ownerW = false; ownerX = false;
  groupR = false; groupW = false; groupX = false;
  otherR = false; otherW = false; otherX = false;
  octalStr = '0000';

  constructor(
    public dialogRef: MatDialogRef<PermissionsDialogComponent, number | null>,
    @Inject(MAT_DIALOG_DATA) public data: PermissionsDialogData,
  ) {
    this.fromMode(data.mode);
  }

  private fromMode(mode: number) {
    const m = mode & 0o7777;
    this.ownerR = !!(m & 0o400); this.ownerW = !!(m & 0o200); this.ownerX = !!(m & 0o100);
    this.groupR = !!(m & 0o040); this.groupW = !!(m & 0o020); this.groupX = !!(m & 0o010);
    this.otherR = !!(m & 0o004); this.otherW = !!(m & 0o002); this.otherX = !!(m & 0o001);
    this.octalStr = m.toString(8).padStart(4, '0');
  }

  rebuild() {
    let m = 0;
    if (this.ownerR) m |= 0o400; if (this.ownerW) m |= 0o200; if (this.ownerX) m |= 0o100;
    if (this.groupR) m |= 0o040; if (this.groupW) m |= 0o020; if (this.groupX) m |= 0o010;
    if (this.otherR) m |= 0o004; if (this.otherW) m |= 0o002; if (this.otherX) m |= 0o001;
    this.octalStr = m.toString(8).padStart(4, '0');
  }

  onOctalChange() {
    const val = parseInt(this.octalStr, 8);
    if (!isNaN(val)) this.fromMode(val);
  }

  apply() {
    const val = parseInt(this.octalStr, 8);
    this.dialogRef.close(isNaN(val) ? null : val);
  }
}
