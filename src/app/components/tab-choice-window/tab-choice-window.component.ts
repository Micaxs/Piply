import { Component, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { SettingsService } from '../../services/settings.service';

const params = new URLSearchParams(window.location.search);

@Component({
  selector: 'app-tab-choice-window',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="tc-root">
      <div class="tc-titlebar" data-tauri-drag-region>
        <mat-icon class="tc-logo" style="pointer-events:none">tab</mat-icon>
        <span class="tc-title" style="pointer-events:none">Connect to {{ host }}</span>
        <span style="flex:1;pointer-events:none"></span>
        <button class="wctl wctl-close" (click)="choose('cancel')"><mat-icon>close</mat-icon></button>
      </div>
      <div class="tc-body">
        <p class="tc-desc">You are already connected. How would you like to connect to <strong>{{ host }}</strong>?</p>
        <div class="tc-actions">
          <button mat-flat-button color="primary" (click)="choose('new')">
            <mat-icon>add</mat-icon> Open in new tab
          </button>
          <button mat-stroked-button (click)="choose('current')">
            <mat-icon>swap_horiz</mat-icon> Replace current tab
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .tc-root {
      display: flex; flex-direction: column; height: 100vh;
      background: var(--ctp-base); color: var(--ctp-text); font-family: inherit;
    }
    .tc-titlebar {
      display: flex; align-items: center; gap: 8px; height: 38px;
      padding: 0 8px 0 12px; background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .tc-logo { font-size: 18px; color: var(--ctp-blue); }
    .tc-title { font-size: 13px; font-weight: 600; }
    .wctl {
      width: 28px; height: 28px; border: none; cursor: pointer; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      background: transparent; color: var(--ctp-subtext0);
    }
    .wctl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wctl-close:hover { background: var(--ctp-red); color: var(--ctp-base); }
    .tc-body {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 24px; padding: 24px;
    }
    .tc-desc { text-align: center; font-size: 14px; color: var(--ctp-subtext1); margin: 0; }
    .tc-desc strong { color: var(--ctp-text); }
    .tc-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  `],
})
export class TabChoiceWindowComponent implements OnInit {
  private settingsSvc = inject(SettingsService);
  host = params.get('host') ?? 'server';

  ngOnInit() {
    this.settingsSvc.load();
    this.settingsSvc.applyAll();
  }

  async choose(action: 'new' | 'current' | 'cancel') {
    if (action !== 'cancel') {
      await emit('tab-choice-result', { action });
    }
    await getCurrentWindow().close();
  }
}
