import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivityLogService } from '../../services/activity-log.service';

@Component({
  selector: 'app-activity-log',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="log-root">
      <div class="log-hdr">
        <mat-icon class="log-hdr-ic">receipt_long</mat-icon>
        <span class="log-hdr-title">Activity Log</span>
        <button mat-icon-button class="log-clear" matTooltip="Clear log" (click)="svc.clear()">
          <mat-icon>delete_sweep</mat-icon>
        </button>
      </div>
      <div class="log-body">
        @if (svc.entries().length === 0) {
          <span class="log-empty">No activity yet.</span>
        }
        @for (e of svc.entries(); track e.timestamp + e.message) {
          <div class="log-entry" [class.log-warn]="e.level === 'warn'" [class.log-err]="e.level === 'error'">
            <span class="log-ts">{{ formatTime(e.timestamp) }}</span>
            <span class="log-msg">{{ e.message }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .log-root { display: flex; flex-direction: column; height: 100%; background: var(--ctp-surface0); }
    .log-hdr  { display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px; height: 32px; flex-shrink: 0; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); }
    .log-hdr-ic    { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue); flex-shrink: 0; }
    .log-hdr-title { font-size: 13px; font-weight: 600; color: var(--ctp-text); flex: 1; }
    .log-clear { width: 24px !important; height: 24px !important; line-height: 24px !important; padding: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; color: var(--ctp-overlay1) !important; flex-shrink: 0; }
    ::ng-deep .log-clear .mat-mdc-button-touch-target { width: 24px !important; height: 24px !important; }
    ::ng-deep .log-clear .mat-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; line-height: 16px !important; }
    .log-body  { flex: 1; overflow-y: auto; padding: 2px 0; font-size: 11px; font-family: monospace; background: var(--ctp-base); }
    .log-empty { display: block; padding: 8px 12px; color: var(--ctp-overlay0); font-style: italic; }
    .log-entry { display: flex; gap: 8px; padding: 2px 8px; border-bottom: 1px solid var(--ctp-surface0); color: var(--ctp-subtext1); }
    .log-entry:hover { background: rgba(137,180,250,0.07); }
    .log-ts  { flex-shrink: 0; color: var(--ctp-overlay0); min-width: 75px; }
    .log-msg { flex: 1; word-break: break-all; }
    .log-warn { color: var(--ctp-yellow); }
    .log-err  { color: var(--ctp-red); }
  `]
})
export class ActivityLogComponent {
  svc = inject(ActivityLogService);
  formatTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString(); } catch { return ''; }
  }
}
