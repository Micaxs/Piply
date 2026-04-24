import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-rename-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatInputModule, MatFormFieldModule, MatIconModule],
  template: `
    <div class="ren-dialog">
      <div class="ren-header">
        <mat-icon>drive_file_rename_outline</mat-icon>
        <span>Rename</span>
      </div>
      <mat-form-field appearance="outline" class="ren-field">
        <mat-label>New name</mat-label>
        <input matInput [(ngModel)]="newName" (keydown.enter)="confirm()" autofocus />
      </mat-form-field>
      <div class="ren-actions">
        <button mat-button (click)="dialogRef.close(null)">Cancel</button>
        <button mat-raised-button (click)="confirm()" [disabled]="!newName.trim()">Rename</button>
      </div>
    </div>
  `,
  styles: [`
    .ren-dialog { padding: 20px; background: var(--ctp-base); color: var(--ctp-text); min-width: 320px; }
    .ren-header { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .ren-field  { width: 100%; }
    .ren-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  `],
})
export class RenameDialogComponent {
  newName: string;
  constructor(public dialogRef: MatDialogRef<RenameDialogComponent>, @Inject(MAT_DIALOG_DATA) public data: { currentName: string }) {
    this.newName = data.currentName;
  }
  confirm() {
    if (this.newName.trim()) this.dialogRef.close(this.newName.trim());
  }
}
