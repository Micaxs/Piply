import { Component, ElementRef, inject, OnInit, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
  SettingsService,
  PRESET_THEMES,
  THEME_VAR_LABELS,
  SavedTheme,
} from '../../services/settings.service';
import { ConnectionService } from '../../services/connection.service';
import { KeyboardShortcutService, ShortcutBinding } from '../../services/keyboard-shortcut.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule,
    MatIconModule, MatDividerModule, MatSelectModule, MatSliderModule,
    MatTabsModule, MatTooltipModule, MatMenuModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="settings-root">
      <!-- Titlebar -->
      <div class="settings-titlebar" data-tauri-drag-region>
        <mat-icon class="title-icon" style="pointer-events:none">settings</mat-icon>
        <span class="title-text" style="pointer-events:none">Settings — Piply</span>
        <span style="flex:1; pointer-events:none"></span>
        <button class="wctl wctl-close" (click)="close()" title="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Tabs -->
      <mat-tab-group class="settings-tabs" animationDuration="150ms">

        <!-- ── Appearance ── -->
        <mat-tab label="Appearance">
          <div class="tab-content">

            <div class="section-title">
              Theme
              <button mat-button class="copy-btn" (click)="importThemeFile()">
                <mat-icon>upload_file</mat-icon> Import theme
              </button>
              <!-- hidden file input for import -->
              <input #importInput type="file" accept=".json" style="display:none"
                     (change)="onImportFile($event)" />
            </div>
            <div class="theme-grid">
              @for (theme of themeEntries; track theme.id) {
                <div class="theme-card"
                     [class.active]="svc.themeId() === theme.id"
                     (click)="selectTheme(theme.id)">
                  @if (theme.id === 'custom') {
                    <!-- Custom card: live preview + edit icon -->
                    <div class="theme-preview custom-preview"
                         [style.background]="customTheme()['--ctp-base'] || '#1e1e2e'"
                         [style.border-color]="svc.themeId() === 'custom' ? (customTheme()['--ctp-blue'] || '#89b4fa') : 'transparent'">
                      <div class="tp-bar"  [style.background]="customTheme()['--ctp-mantle'] || '#181825'"></div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="customTheme()['--ctp-yellow'] || '#f9e2af'"></div>
                        <div class="tp-line" [style.background]="customTheme()['--ctp-text'] || '#cdd6f4'"     style="width:55%"></div>
                      </div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="customTheme()['--ctp-blue'] || '#89b4fa'"></div>
                        <div class="tp-line" [style.background]="customTheme()['--ctp-subtext0'] || '#a6adc8'" style="width:70%"></div>
                      </div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="customTheme()['--ctp-green'] || '#a6e3a1'"></div>
                        <div class="tp-line" [style.background]="customTheme()['--ctp-subtext0'] || '#a6adc8'" style="width:40%"></div>
                      </div>
                      <div class="custom-edit-overlay">
                        <mat-icon>palette</mat-icon>
                      </div>
                    </div>
                  } @else {
                    <div class="theme-preview"
                         [style.background]="theme.vars['--ctp-base']"
                         [style.border-color]="svc.themeId() === theme.id ? theme.vars['--ctp-blue'] : 'transparent'">
                      <div class="tp-bar"  [style.background]="theme.vars['--ctp-mantle']"></div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="theme.vars['--ctp-yellow']"></div>
                        <div class="tp-line" [style.background]="theme.vars['--ctp-text']"    style="width:55%"></div>
                      </div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="theme.vars['--ctp-blue']"></div>
                        <div class="tp-line" [style.background]="theme.vars['--ctp-subtext0']" style="width:70%"></div>
                      </div>
                      <div class="tp-row">
                        <div class="tp-icon" [style.background]="theme.vars['--ctp-green']"></div>
                        <div class="tp-line" [style.background]="theme.vars['--ctp-subtext0']" style="width:40%"></div>
                      </div>
                    </div>
                  }
                  <span class="theme-name">{{ theme.name }}</span>
                  @if (svc.themeId() === theme.id) {
                    <mat-icon class="theme-check">check_circle</mat-icon>
                  }
                </div>
              }
              <!-- Saved themes -->
              @for (saved of svc.savedThemes(); track saved.id) {
                <div class="theme-card saved-theme-card"
                     [class.active]="svc.themeId() === saved.id"
                     (click)="selectSavedTheme(saved.id)">
                  <div class="theme-preview"
                       [style.background]="saved.vars['--ctp-base']"
                       [style.border-color]="svc.themeId() === saved.id ? saved.vars['--ctp-blue'] : 'transparent'">
                    <div class="tp-bar"  [style.background]="saved.vars['--ctp-mantle']"></div>
                    <div class="tp-row">
                      <div class="tp-icon" [style.background]="saved.vars['--ctp-yellow']"></div>
                      <div class="tp-line" [style.background]="saved.vars['--ctp-text']"     style="width:55%"></div>
                    </div>
                    <div class="tp-row">
                      <div class="tp-icon" [style.background]="saved.vars['--ctp-blue']"></div>
                      <div class="tp-line" [style.background]="saved.vars['--ctp-subtext0']" style="width:70%"></div>
                    </div>
                    <div class="tp-row">
                      <div class="tp-icon" [style.background]="saved.vars['--ctp-green']"></div>
                      <div class="tp-line" [style.background]="saved.vars['--ctp-subtext0']" style="width:40%"></div>
                    </div>
                  </div>
                  <span class="theme-name">{{ saved.name }}</span>
                  @if (svc.themeId() === saved.id) {
                    <mat-icon class="theme-check">check_circle</mat-icon>
                  }
                  <button class="theme-action-btn theme-export" matTooltip="Export theme"
                          (click)="exportTheme($event, saved)">
                    <mat-icon>download</mat-icon>
                  </button>
                  <button class="theme-action-btn theme-delete" matTooltip="Delete theme"
                          (click)="deleteSavedTheme($event, saved.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
            </div>

            <!-- Custom theme editor -->
            @if (svc.themeId() === 'custom') {
              <div class="settings-divider"></div>
              <div class="section-title">
                Custom Theme Colors
                <button mat-button class="copy-btn" [matMenuTriggerFor]="copyMenu">
                  <mat-icon>content_copy</mat-icon> Copy from preset
                </button>
                <mat-menu #copyMenu="matMenu">
                  @for (p of presetEntries; track p.id) {
                    <button mat-menu-item (click)="copyFromPreset(p.id)">{{ p.name }}</button>
                  }
                </mat-menu>
              </div>

              @for (group of varGroups; track group.label) {
                <div class="var-group-label">{{ group.label }}</div>
                <div class="var-grid">
                  @for (v of group.vars; track v.key) {
                    <div class="var-row">
                      <div class="color-swatch" [style.background]="customTheme()[v.key]"></div>
                      <label class="var-label">{{ v.label }}</label>
                      <input type="color"
                             [value]="customTheme()[v.key] || '#000000'"
                             (input)="onColorChange(v.key, $event)"
                             class="color-input" />
                      <span class="var-hex">{{ customTheme()[v.key] || '' }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Save as named theme -->
              <div class="settings-divider"></div>
              <div class="section-title">
                <mat-icon style="font-size:13px;width:13px;height:13px;color:var(--ctp-blue)">bookmark_add</mat-icon>
                Save as Named Theme
              </div>
              <div class="save-theme-row">
                <input class="save-theme-input" type="text"
                       placeholder="Enter a name for this theme…"
                       [(ngModel)]="saveThemeName"
                       (keydown.enter)="saveCurrentTheme()"
                       maxlength="40" />
                <button mat-flat-button class="save-theme-btn"
                        [disabled]="!saveThemeName.trim()"
                        (click)="saveCurrentTheme()">
                  <mat-icon style="font-size:14px;width:14px;height:14px;margin-right:4px">save</mat-icon>
                  Save
                </button>
              </div>
            }

            <div class="settings-divider"></div>
            <div class="section-title">Font Size</div>
            <div class="font-size-row">
              <span class="fs-preview" [style.font-size.px]="svc.fontSize()">Aa</span>
              <div class="fs-controls">
                @for (size of fontSizes; track size) {
                  <button class="fs-btn"
                          [class.active]="svc.fontSize() === size"
                          (click)="setFontSize(size)">{{ size }}px</button>
                }
              </div>
            </div>

            <div class="settings-divider"></div>
            <div class="section-title">Font Family</div>
            <div class="font-family-grid">
              @for (font of fontFamilies; track font.value) {
                <button class="font-btn"
                        [class.active]="svc.fontFamily() === font.value"
                        [style.font-family]="font.value"
                        (click)="setFontFamily(font.value)">
                  <span class="font-preview-text">Aa</span>
                  <span class="font-name">{{ font.label }}</span>
                </button>
              }
            </div>
          </div>
        </mat-tab>

        <!-- ── Transfers ── -->
        <mat-tab label="Transfers">
          <div class="tab-content">
            <div class="section-title">Concurrent Transfers</div>
            <div class="setting-row">
              <span class="setting-label">Max simultaneous transfers</span>
              <div class="slider-group">
                <input type="range" min="1" max="10"
                       [value]="svc.maxTransfers()"
                       (input)="setMaxTransfers($event)"
                       class="range-input" />
                <span class="range-val">{{ svc.maxTransfers() }}</span>
              </div>
            </div>

            <div class="settings-divider"></div>
            <div class="section-title">Conflict Resolution</div>
            <p class="setting-desc">Default action when a file already exists at the destination.</p>
            <div class="conflict-options">
              @for (opt of conflictOptions; track opt.value) {
                <div class="conflict-card"
                     [class.active]="svc.defaultConflict() === opt.value"
                     (click)="svc.defaultConflict.set(opt.value); save()">
                  <mat-icon class="conflict-icon" [style.color]="opt.color">{{ opt.icon }}</mat-icon>
                  <div>
                    <div class="conflict-name">{{ opt.label }}</div>
                    <div class="conflict-desc">{{ opt.desc }}</div>
                  </div>
                </div>
              }
            </div>
          </div>
        </mat-tab>

        <!-- ── Interface ── -->
        <mat-tab label="Interface">
          <div class="tab-content">
            <div class="section-title">Panels</div>

            <div class="toggle-row" (click)="toggleQuickConnect()">
              <div class="toggle-info">
                <div class="toggle-label">Quick Connect Bar</div>
                <div class="toggle-desc">Show the quick connect bar below the menu</div>
              </div>
              <div class="toggle-switch" [class.on]="svc.showQuickConnect()">
                <div class="toggle-thumb"></div>
              </div>
            </div>

            <div class="toggle-row" (click)="toggleTransferPanel()">
              <div class="toggle-info">
                <div class="toggle-label">Transfer Queue Panel</div>
                <div class="toggle-desc">Show the transfer progress panel at the bottom</div>
              </div>
              <div class="toggle-switch" [class.on]="svc.showTransferPanel()">
                <div class="toggle-thumb"></div>
              </div>
            </div>

            <div class="settings-divider"></div>
            <div class="section-title">Tree View</div>
            <div class="tree-pos-grid">
              @for (opt of treePosOptions; track opt.value) {
                <div class="tree-pos-card"
                     [class.active]="svc.treePosition() === opt.value"
                     (click)="svc.treePosition.set(opt.value); save()">
                  <mat-icon class="tp-icon">{{ opt.icon }}</mat-icon>
                  <span class="tp-label">{{ opt.label }}</span>
                </div>
              }
            </div>
          </div>
        </mat-tab>

        <!-- ── Shortcuts ── -->
        <mat-tab label="Shortcuts">
          <div class="tab-content">
            <div class="section-title">
              Keyboard Shortcuts
              <button mat-button class="copy-btn" (click)="shortcutSvc.resetToDefaults()">
                <mat-icon>restart_alt</mat-icon> Reset to defaults
              </button>
            </div>
            <p class="setting-desc">Click a key to change the binding.</p>
            <div class="shortcuts-list">
              @for (b of shortcutSvc.bindings(); track b.action) {
                <div class="shortcut-row">
                  <div class="shortcut-info">
                    <div class="shortcut-label">{{ b.label }}</div>
                    <div class="shortcut-desc">{{ b.description }}</div>
                  </div>
                  <button class="key-badge"
                          [class.capturing]="capturingAction === b.action"
                          (click)="startCapture(b.action)"
                          (keydown)="onKeyCapture($event, b.action)">
                    {{ capturingAction === b.action ? 'Press a key…' : b.key }}
                  </button>
                </div>
              }
            </div>
          </div>
        </mat-tab>

        <!-- ── Security ── -->
        <mat-tab label="Security">
          <div class="tab-content">
            <div class="section-title">Encryption Key Management</div>
            <p class="setting-desc">Manage your connection encryption key and security settings.</p>

            <div class="sec-group">
              <div class="sec-label">Key Status</div>
              <div class="sec-value">{{ keyExists() ? '✓ Active' : '✗ Not Set' }}</div>
            </div>

            <div class="sec-actions">
              <button class="sec-btn" (click)="regenerateKey()" [disabled]="regeneratingKey()">
                @if (regeneratingKey()) { <mat-spinner diameter="13" /> }
                @else { <mat-icon>autorenew</mat-icon> }
                Regenerate Key
              </button>
              <button class="sec-btn sec-btn-danger" (click)="wipeKey()" [disabled]="wipingKey()">
                @if (wipingKey()) { <mat-spinner diameter="13" /> }
                @else { <mat-icon>delete_outline</mat-icon> }
                Wipe Key
              </button>
            </div>

            <div class="settings-divider"></div>

            <div class="section-title">Connection Persistence</div>
            <p class="setting-desc">Control whether connections are saved and encrypted between app launches.</p>

            <div class="sec-toggle">
              <input type="checkbox" [checked]="svc.persistConnections()" 
                     (change)="togglePersistence($event)" class="sec-toggle-input" />
              <label class="sec-toggle-label">
                {{ svc.persistConnections() ? 'Persist Connections (Encrypted)' : 'Do Not Save Connections' }}
              </label>
            </div>
          </div>
        </mat-tab>

      </mat-tab-group>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100vw; height: 100vh; overflow: hidden; }

    .settings-root {
      display: flex; flex-direction: column;
      width: 100%; height: 100%;
      background: var(--ctp-base); color: var(--ctp-text);
    }

    /* Titlebar */
    .settings-titlebar {
      display: flex; align-items: center; gap: 8px;
      padding: 0 12px; height: 36px; flex-shrink: 0;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .title-icon { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue); }
    .title-text { font-size: 13px; font-weight: 600; color: var(--ctp-text); }
    .wctl {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 4px; border: none;
      background: transparent; cursor: pointer; color: var(--ctp-subtext1);
      transition: background 0.15s, color 0.15s;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .wctl-close:hover { background: var(--ctp-red); color: var(--ctp-base); }

    .settings-tabs { flex: 1; overflow: hidden; min-height: 0; }
    ::ng-deep .settings-tabs .mat-mdc-tab-body-wrapper { flex: 1; overflow: hidden; height: 100%; }
    ::ng-deep .settings-tabs .mat-mdc-tab-body-content { overflow-y: auto; height: 100%; }
    ::ng-deep .settings-tabs .mdc-tab__text-label { color: var(--ctp-subtext1) !important; font-size: 13px; }
    ::ng-deep .settings-tabs .mdc-tab--active .mdc-tab__text-label { color: var(--ctp-text) !important; }
    ::ng-deep .settings-tabs .mdc-tab-indicator__content--underline { border-color: var(--ctp-blue) !important; }
    ::ng-deep .settings-tabs .mat-mdc-tab-header { border-bottom: 1px solid var(--ctp-surface0); background: var(--ctp-mantle); }

    .tab-content { padding: 28px 28px 24px; }

    .settings-divider {
      height: 1px;
      background: var(--ctp-surface0);
      margin: 28px 0 7px;
    }

    .section-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--ctp-subtext0); margin-bottom: 28px; display: flex; align-items: center; gap: 8px;
    }
    .copy-btn { font-size: 11px; height: 24px; line-height: 24px; color: var(--ctp-blue) !important; }
    .copy-btn mat-icon { font-size: 13px; width: 13px; height: 13px; margin-right: 4px; }

    /* Theme grid */
    .theme-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 12px; margin-bottom: 4px;
    }
    .theme-card {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      cursor: pointer; padding: 6px; border-radius: 8px; position: relative;
      transition: background 0.15s;
      &:hover { background: rgba(137,180,250,0.08); }
      &.active { background: rgba(137,180,250,0.12); }
    }
    .theme-preview {
      width: 100%; aspect-ratio: 4/3; border-radius: 6px;
      border: 2px solid transparent; transition: border-color 0.15s;
      padding: 6px; display: flex; flex-direction: column; gap: 4px; overflow: hidden;
    }
    .tp-bar { height: 6px; border-radius: 2px; width: 100%; }
    .tp-row { display: flex; align-items: center; gap: 4px; }
    .tp-icon { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .tp-line { height: 4px; border-radius: 2px; }
    .theme-name { font-size: 11px; color: var(--ctp-subtext1); text-align: center; }
    .theme-check {
      position: absolute; top: 4px; right: 4px;
      font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue);
    }
    /* Custom card edit overlay */
    .custom-preview { position: relative; overflow: hidden; }
    .custom-edit-overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.28); opacity: 0; transition: opacity 0.15s;
      mat-icon { font-size: 22px; width: 22px; height: 22px; color: #fff; }
    }
    .theme-card:hover .custom-edit-overlay { opacity: 1; }
    .theme-card.active .custom-edit-overlay { opacity: 0.6; }
    .saved-theme-card { }
    .theme-action-btn {
      position: absolute; top: 2px;
      display: none; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
      mat-icon { font-size: 11px; width: 11px; height: 11px; line-height: 11px; }
    }
    .theme-export { right: 24px; background: rgba(137,180,250,0.85); color: var(--ctp-base); }
    .theme-delete { right: 4px;  background: rgba(243,139,168,0.85); color: var(--ctp-base); }
    .saved-theme-card:hover .theme-action-btn { display: flex; }

    /* Save-as named theme row */
    .save-theme-row {
      display: flex; align-items: center; gap: 8px;
    }
    .save-theme-input {
      flex: 1; height: 30px; padding: 0 10px; border-radius: 4px;
      background: var(--ctp-surface0); border: 1px solid var(--ctp-surface1);
      color: var(--ctp-text); font-size: 13px; outline: none;
      font-family: inherit;
      &:focus { border-color: var(--ctp-blue); }
      &::placeholder { color: var(--ctp-overlay0); }
    }
    .save-theme-btn {
      height: 30px; font-size: 12px; display: flex; align-items: center;
      background: var(--ctp-blue) !important; color: var(--ctp-base) !important;
      white-space: nowrap; flex-shrink: 0;
    }
    .save-theme-btn:disabled { opacity: 0.4; }

    /* Custom theme editor */
    .var-group-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--ctp-overlay0); margin: 12px 0 6px;
    }
    .var-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .var-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .color-swatch { width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }
    .var-label { flex: 1; font-size: 12px; color: var(--ctp-subtext1); }
    .color-input { width: 28px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; border-radius: 3px; }
    .var-hex { font-size: 11px; font-family: monospace; color: var(--ctp-overlay1); width: 54px; }

    /* Font size */
    .font-size-row { display: flex; align-items: center; gap: 16px; }
    .fs-preview { color: var(--ctp-text); transition: font-size 0.15s; min-width: 32px; }
    .fs-controls { display: flex; gap: 6px; }
    .fs-btn {
      padding: 3px 10px; border-radius: 4px; border: 1px solid var(--ctp-surface1);
      background: var(--ctp-surface0); color: var(--ctp-subtext1); font-size: 12px; cursor: pointer;
      transition: all 0.15s;
      &:hover { border-color: var(--ctp-blue); color: var(--ctp-text); }
      &.active { background: rgba(137,180,250,0.2); border-color: var(--ctp-blue); color: var(--ctp-blue); }
    }

    /* Font family */
    .font-family-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
    .font-btn {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 10px 8px; border-radius: 6px; border: 1px solid var(--ctp-surface1);
      background: var(--ctp-surface0); cursor: pointer; transition: all 0.15s;
      &:hover { border-color: var(--ctp-surface2); background: rgba(137,180,250,0.06); }
      &.active { border-color: var(--ctp-blue); background: rgba(137,180,250,0.12); }
    }
    .font-preview-text { font-size: 20px; color: var(--ctp-text); line-height: 1; }
    .font-name { font-size: 11px; color: var(--ctp-subtext0); font-family: inherit !important; }

    /* Transfers */
    .setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
    .setting-label { font-size: 13px; color: var(--ctp-text); }
    .setting-desc { font-size: 12px; color: var(--ctp-subtext0); margin: 0 0 12px; }
    .slider-group { display: flex; align-items: center; gap: 8px; }
    .range-input {
      width: 140px; accent-color: var(--ctp-blue);
      cursor: pointer;
    }
    .range-val { font-size: 13px; font-weight: 600; color: var(--ctp-blue); min-width: 20px; text-align: right; }

    .conflict-options { display: flex; flex-direction: column; gap: 8px; }
    .conflict-card {
      display: flex; align-items: center; gap: 12px; padding: 10px 14px;
      border-radius: 6px; border: 1px solid var(--ctp-surface1);
      background: var(--ctp-mantle); cursor: pointer; transition: all 0.15s;
      &:hover { border-color: var(--ctp-surface2); background: var(--ctp-surface0); }
      &.active { border-color: var(--ctp-blue); background: rgba(137,180,250,0.08); }
    }
    .conflict-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .conflict-name { font-size: 13px; font-weight: 500; color: var(--ctp-text); }
    .conflict-desc { font-size: 11px; color: var(--ctp-subtext0); margin-top: 2px; }

    /* Interface toggles */
    .toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 0; cursor: pointer; border-bottom: 1px solid var(--ctp-surface0);
      &:last-child { border-bottom: none; }
      &:hover .toggle-label { color: var(--ctp-text); }
    }
    .toggle-info { flex: 1; }
    .toggle-label { font-size: 13px; color: var(--ctp-subtext1); transition: color 0.15s; }
    .toggle-desc { font-size: 11px; color: var(--ctp-overlay1); margin-top: 2px; }
    .toggle-switch {
      width: 36px; height: 20px; border-radius: 10px; background: var(--ctp-surface1);
      position: relative; transition: background 0.2s; flex-shrink: 0;
      &.on { background: var(--ctp-blue); }
    }
    .toggle-thumb {
      position: absolute; top: 2px; left: 2px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--ctp-crust); transition: transform 0.2s;
      .on & { transform: translateX(16px); background: var(--ctp-mantle); }
    }

    .tree-pos-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 4px; }
    .tree-pos-card {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 10px 6px; border-radius: 6px; border: 1px solid var(--ctp-surface1);
      background: var(--ctp-mantle); cursor: pointer; transition: all 0.15s;
      &:hover { border-color: var(--ctp-surface2); background: var(--ctp-surface0); }
      &.active { border-color: var(--ctp-blue); background: rgba(137,180,250,0.1); }
    }
    .tp-icon { font-size: 20px; width: 20px; height: 20px; color: var(--ctp-subtext1); }
    .tree-pos-card.active .tp-icon { color: var(--ctp-blue); }
    .tp-label { font-size: 11px; color: var(--ctp-subtext1); }
    .tree-pos-card.active .tp-label { color: var(--ctp-blue); }
    .tree-pos-grid .tree-pos-card:nth-child(2) .tp-icon { transform: scaleX(-1); }

    .shortcuts-list { display: flex; flex-direction: column; gap: 2px; }
    .shortcut-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--ctp-surface0); }
    .shortcut-info { flex: 1; }
    .shortcut-label { font-size: 13px; color: var(--ctp-text); }
    .shortcut-desc { font-size: 11px; color: var(--ctp-overlay1); margin-top: 2px; }
    .key-badge {
      padding: 3px 10px; border-radius: 4px; border: 1px solid var(--ctp-surface1);
      background: var(--ctp-surface0); color: var(--ctp-subtext1); font-size: 12px;
      font-family: monospace; cursor: pointer; min-width: 72px; text-align: center;
      transition: all 0.15s;
    }
    .key-badge:hover { border-color: var(--ctp-blue); color: var(--ctp-text); }
    .key-badge.capturing { border-color: var(--ctp-blue); background: rgba(137,180,250,0.15); color: var(--ctp-blue); animation: pulse 1s infinite; }

    /* Security tab */
    .sec-group {
      display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--ctp-surface0);
    }
    .sec-label { font-size: 12px; color: var(--ctp-subtext1); text-transform: uppercase; letter-spacing: 0.5px; }
    .sec-value { font-size: 14px; color: var(--ctp-text); font-weight: 500; }
    
    .sec-actions {
      display: flex; gap: 10px; margin: 16px 0; flex-wrap: wrap;
    }
    .sec-btn {
      display: flex; align-items: center; gap: 6px; padding: 8px 14px;
      border: 1px solid var(--ctp-surface1); border-radius: 6px; background: var(--ctp-mantle);
      color: var(--ctp-text); font-size: 13px; cursor: pointer; transition: all 0.15s;
      &:hover:not(:disabled) { border-color: var(--ctp-blue); background: rgba(137,180,250,0.1); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .sec-btn-danger {
      &:hover:not(:disabled) { border-color: var(--ctp-red); background: rgba(243,139,168,0.1); color: var(--ctp-red); }
    }

    .sec-toggle {
      display: flex; align-items: center; gap: 10px; padding: 12px 0;
    }
    .sec-toggle-input {
      width: 18px; height: 18px; cursor: pointer; accent-color: var(--ctp-green);
    }
    .sec-toggle-label {
      font-size: 13px; color: var(--ctp-text); cursor: pointer;
    }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  `],
})
export class SettingsPanelComponent implements OnInit {
  svc = inject(SettingsService);
  connectionSvc = inject(ConnectionService);
  shortcutSvc = inject(KeyboardShortcutService);
  capturingAction: string | null = null;

  keyExists = signal(false);
  regeneratingKey = signal(false);
  wipingKey = signal(false);

  @ViewChild('importInput') importInputRef!: ElementRef<HTMLInputElement>;

  ngOnInit() {
    this.svc.load();
    this.svc.applyAll();
    this.checkKeyStatus();
  }

  fontSizes = [11, 12, 13, 14];

  fontFamilies: { label: string; value: string }[] = [
    { label: 'Roboto',        value: 'Roboto, "Helvetica Neue", sans-serif' },
    { label: 'Inter',         value: 'Inter, sans-serif' },
    { label: 'Ubuntu',        value: 'Ubuntu, sans-serif' },
    { label: 'Noto Sans',     value: '"Noto Sans", sans-serif' },
    { label: 'JetBrains Mono',value: '"JetBrains Mono", monospace' },
    { label: 'Fira Code',     value: '"Fira Code", monospace' },
  ];

  conflictOptions: { value: 'ask' | 'skip' | 'overwrite' | 'rename'; label: string; desc: string; icon: string; color: string }[] = [
    { value: 'ask',       label: 'Ask me',    desc: 'Show a dialog to choose what to do', icon: 'help_outline',   color: 'var(--ctp-blue)' },
    { value: 'skip',      label: 'Skip',      desc: 'Leave the existing file untouched',  icon: 'do_not_disturb', color: 'var(--ctp-overlay1)' },
    { value: 'overwrite', label: 'Overwrite', desc: 'Replace the existing file',          icon: 'file_copy',      color: 'var(--ctp-yellow)' },
    { value: 'rename',    label: 'Rename',    desc: 'Keep both by renaming the new one',  icon: 'drive_file_rename_outline', color: 'var(--ctp-green)' },
  ];

  treePosOptions: { value: 'left' | 'right' | 'top' | 'hidden'; label: string; icon: string }[] = [
    { value: 'left',   label: 'Left',   icon: 'dock'              },
    { value: 'right',  label: 'Right',  icon: 'dock'              },
    { value: 'top',    label: 'Top',    icon: 'horizontal_split'  },
    { value: 'hidden', label: 'Hidden', icon: 'visibility_off'    },
  ];

  // Entries for the theme grid (all presets + custom at the end)
  themeEntries = Object.entries(PRESET_THEMES).map(([id, t]) => ({ id, ...t }));
  presetEntries = Object.entries(PRESET_THEMES).filter(([id]) => id !== 'custom').map(([id, t]) => ({ id, name: t.name }));

  varGroups = [
    { label: 'Surfaces', vars: THEME_VAR_LABELS.filter(v => v.group === 'Surfaces') },
    { label: 'Text',     vars: THEME_VAR_LABELS.filter(v => v.group === 'Text') },
    { label: 'Accents',  vars: THEME_VAR_LABELS.filter(v => v.group === 'Accents') },
  ];

  customTheme = this.svc.customTheme;
  saveThemeName = '';

  selectTheme(id: string) {
    if (id === 'custom' && Object.keys(this.svc.customTheme()).length === 0) {
      const current = PRESET_THEMES[this.svc.themeId()];
      this.svc.customTheme.set({ ...(current?.vars ?? PRESET_THEMES['catppuccin-mocha'].vars) });
    }
    this.svc.themeId.set(id);
    this.svc.applyTheme();
    this.save();
  }

  selectSavedTheme(id: string) {
    this.svc.themeId.set(id);
    this.svc.applyTheme();
    this.save();
  }

  deleteSavedTheme(event: MouseEvent, id: string) {
    event.stopPropagation();
    this.svc.deleteSavedTheme(id);
  }

  exportTheme(event: MouseEvent, theme: SavedTheme) {
    event.stopPropagation();
    const payload = JSON.stringify({ name: theme.name, vars: theme.vars }, null, 2);
    const filename = `${theme.name.replace(/[^a-z0-9_-]/gi, '_')}.piply-theme.json`;
    invoke('save_text_file', { filename, content: payload }).catch(console.error);
  }

  importThemeFile() {
    invoke<string | null>('open_text_file').then(content => {
      if (!content) return;
      try {
        const data = JSON.parse(content);
        if (!data.vars || typeof data.vars !== 'object') return;
        const name = (data.name as string)?.trim() || 'Imported Theme';
        const id = `saved-${Date.now()}`;
        this.svc.savedThemes.update(list => [...list, { id, name, vars: data.vars }]);
        this.svc.save();
      } catch { /* invalid JSON */ }
    }).catch(console.error);
  }

  onImportFile(_event: Event) { /* unused — handled via invoke */ }

  saveCurrentTheme() {
    if (!this.saveThemeName.trim()) return;
    this.svc.saveCurrentTheme(this.saveThemeName.trim());
    this.saveThemeName = '';
  }

  copyFromPreset(presetId: string) {
    const preset = PRESET_THEMES[presetId];
    if (!preset) return;
    this.svc.customTheme.set({ ...preset.vars });
    this.svc.applyTheme();
    this.save();
  }

  onColorChange(key: string, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.svc.customTheme.update(t => ({ ...t, [key]: value }));
    this.svc.applyTheme();
    this.save();
  }

  setFontSize(size: number) {
    this.svc.fontSize.set(size);
    this.svc.applyFontSize();
    this.save();
  }

  setFontFamily(family: string) {
    this.svc.fontFamily.set(family);
    this.svc.applyFontFamily();
    this.save();
  }

  setMaxTransfers(event: Event) {
    const val = +(event.target as HTMLInputElement).value;
    this.svc.maxTransfers.set(val);
    this.save();
  }

  toggleQuickConnect() {
    this.svc.showQuickConnect.update(v => !v);
    this.save();
  }

  toggleTransferPanel() {
    this.svc.showTransferPanel.update(v => !v);
    this.save();
  }

  save() { this.svc.save(); }

  startCapture(action: string) {
    this.capturingAction = action;
  }

  onKeyCapture(event: KeyboardEvent, action: string) {
    if (this.capturingAction !== action) return;
    event.preventDefault();
    event.stopPropagation();
    const key = event.key;
    if (key === 'Escape') { this.capturingAction = null; return; }
    const bindings = this.shortcutSvc.bindings().map(b =>
      b.action === action ? { ...b, key } : b
    );
    this.shortcutSvc.saveBindings(bindings);
    this.capturingAction = null;
  }

  async close() { await getCurrentWindow().close(); }

  checkKeyStatus() {
    this.svc.getKeyStatus().then(exists => {
      this.keyExists.set(exists);
    }).catch(console.error);
  }

  regenerateKey() {
    const count = this.connectionSvc.connections().length;
    const msg = count > 0
      ? `This will regenerate your encryption key and re-encrypt ${count} connection(s). Continue?`
      : 'This will regenerate your encryption key. Continue?';
    
    if (!window.confirm(msg)) return;

    this.regeneratingKey.set(true);
    this.svc.regenerateEncryptionKey().then(() => {
      this.checkKeyStatus();
      this.regeneratingKey.set(false);
    }).catch(err => {
      console.error('Regenerate key failed:', err);
      this.regeneratingKey.set(false);
    });
  }

  wipeKey() {
    const count = this.connectionSvc.connections().length;
    const msg = count > 0
      ? `This will delete your encryption key and ${count} saved connection(s). This cannot be undone. Continue?`
      : 'This will delete your encryption key. This cannot be undone. Continue?';
    
    if (!window.confirm(msg)) return;

    this.wipingKey.set(true);
    this.svc.wipeEncryptionKey().then(() => {
      this.checkKeyStatus();
      this.wipingKey.set(false);
    }).catch(err => {
      console.error('Wipe key failed:', err);
      this.wipingKey.set(false);
    });
  }

  togglePersistence(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    if (!enabled) {
      const count = this.connectionSvc.connections().length;
      const msg = count > 0
        ? `Disabling connection persistence will delete your encryption key and ${count} saved connection(s). Continue?`
        : 'Disabling connection persistence will delete your encryption key. Continue?';
      
      if (!window.confirm(msg)) return;
    }
    this.svc.setPersistConnections(enabled);
  }
}
