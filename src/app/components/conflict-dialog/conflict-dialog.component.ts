import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConflictDialogData {
  fileName: string;
}

export type ConflictAction = 'overwrite' | 'skip' | 'rename';

export interface ConflictDialogResult {
  action: ConflictAction;
  newName?: string;
}

@Component({
  selector: 'app-conflict-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="conflict-wrap">
      <div class="conflict-title">
        <mat-icon class="warn-icon">warning</mat-icon>
        <span>File Already Exists</span>
      </div>
      <div class="conflict-body">
        <p class="conflict-msg">
          <strong class="file-name">{{ data.fileName }}</strong> already exists in the destination.
          What would you like to do?
        </p>
        @if (showRename()) {
          <input class="rename-input" [(ngModel)]="newName"
                 placeholder="New filename"
                 (keydown.enter)="confirm('rename')"
                 autofocus />
        }
      </div>
      <div class="conflict-actions">
        <button mat-stroked-button (click)="confirm('skip')">
          <mat-icon>skip_next</mat-icon> Skip
        </button>
        @if (!showRename()) {
          <button mat-stroked-button (click)="showRename.set(true)">
            <mat-icon>drive_file_rename_outline</mat-icon> Rename
          </button>
        } @else {
          <button mat-flat-button class="save-btn" (click)="confirm('rename')" [disabled]="!newName.trim()">
            <mat-icon>check</mat-icon> Save As
          </button>
        }
        <button mat-flat-button class="overwrite-btn" (click)="confirm('overwrite')">
          <mat-icon>upload_file</mat-icon> Overwrite
        </button>
      </div>
    </div>
  `,
  styles: [`
    .conflict-wrap   { background: var(--ctp-base); border-radius: 8px; min-width: 340px; max-width: 460px; overflow: hidden; }
    .conflict-title  { display: flex; align-items: center; gap: 10px; padding: 16px 20px 8px; font-size: 15px; font-weight: 600; color: var(--ctp-text); }
    .warn-icon       { color: var(--ctp-yellow); }
    .conflict-body   { padding: 4px 20px 12px; }
    .conflict-msg    { font-size: 13px; color: var(--ctp-subtext1); line-height: 1.5; margin: 0 0 10px; }
    .file-name       { color: var(--ctp-peach); }
    .rename-input    { width: 100%; height: 30px; padding: 0 8px; background: var(--ctp-surface0); border: 1px solid var(--ctp-blue); border-radius: 4px; color: var(--ctp-text); font-size: 13px; outline: none; box-sizing: border-box; }
    .conflict-actions { display: flex; gap: 8px; padding: 8px 16px 16px; justify-content: flex-end; flex-wrap: wrap; }
    .overwrite-btn   { background: var(--ctp-red) !important; color: var(--ctp-crust) !important; }
    .save-btn        { background: var(--ctp-blue) !important; color: var(--ctp-crust) !important; }
  `],
})
export class ConflictDialogComponent {
  showRename = signal(false);
  newName: string;

  constructor(
    public dialogRef: MatDialogRef<ConflictDialogComponent, ConflictDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: ConflictDialogData,
  ) {
    this.newName = data.fileName;
  }

  confirm(action: ConflictAction) {
    if (action === 'rename' && !this.newName.trim()) return;
    this.dialogRef.close({
      action,
      newName: action === 'rename' ? this.newName.trim() : undefined,
    });
  }
}
