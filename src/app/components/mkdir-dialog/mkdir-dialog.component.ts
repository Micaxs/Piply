import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-mkdir-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatInputModule, MatFormFieldModule, MatIconModule],
  template: `
    <div class="mk-dialog">
      <div class="mk-header">
        <mat-icon>create_new_folder</mat-icon>
        <span>Create Directory</span>
      </div>
      <mat-form-field appearance="outline" class="mk-field">
        <mat-label>Directory name</mat-label>
        <input matInput [(ngModel)]="dirName" (keydown.enter)="confirm()" autofocus />
      </mat-form-field>
      <div class="mk-actions">
        <button mat-button (click)="dialogRef.close(null)">Cancel</button>
        <button mat-raised-button (click)="confirm()" [disabled]="!dirName.trim()">Create</button>
      </div>
    </div>
  `,
  styles: [`
    .mk-dialog  { padding: 20px; background: var(--ctp-base); color: var(--ctp-text); min-width: 300px; }
    .mk-header  { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .mk-field   { width: 100%; }
    .mk-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  `],
})
export class MkdirDialogComponent {
  dirName = '';
  constructor(public dialogRef: MatDialogRef<MkdirDialogComponent>) {}
  confirm() { if (this.dirName.trim()) this.dialogRef.close(this.dirName.trim()); }
}
