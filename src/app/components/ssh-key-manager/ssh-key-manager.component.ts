import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface SshKeyEntry {
  id: string;
  name: string;
  keyType: string;
  publicKey: string;
  comment: string;
}

@Component({
  selector: 'app-ssh-key-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  template: `
    <div class="km-root">
      <div class="km-titlebar" data-tauri-drag-region>
        <mat-icon class="km-logo" style="pointer-events:none">vpn_key</mat-icon>
        <span class="km-title-text" style="pointer-events:none">SSH Key Manager</span>
        <span style="flex:1;pointer-events:none"></span>
        <button class="wctl wctl-close" (click)="closeWindow()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="km-body">
        <div class="km-list">
          @if (keys().length === 0) {
            <div class="km-empty">
              <mat-icon>vpn_key_off</mat-icon>
              <p>No SSH keys imported yet.</p>
            </div>
          }
          @for (k of keys(); track k.id) {
            <div class="km-item" [class.selected]="selected()?.id === k.id" (click)="selected.set(k)">
              <mat-icon class="km-key-icon">vpn_key</mat-icon>
              <div class="km-key-info">
                <div class="km-key-name">{{ k.name }}</div>
                <div class="km-key-type">{{ k.keyType }}</div>
              </div>
              <button mat-icon-button class="km-del-btn" matTooltip="Delete key"
                      (click)="deleteKey(k.id); $event.stopPropagation()">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
        </div>

        <div class="km-panel">
          <div class="km-section-title">Import SSH Key</div>
          <div class="km-field-row">
            <label class="km-label">Name</label>
            <input class="km-input" [(ngModel)]="importName" placeholder="My SSH Key" />
          </div>
          <div class="km-field-row km-textarea-row">
            <label class="km-label">Private Key (PEM)</label>
            <textarea class="km-textarea" [(ngModel)]="importPem"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"></textarea>
          </div>
          <div class="km-actions">
            <input #fileInput type="file" accept=".pem,.key,*" style="display:none"
                   (change)="onFileSelected($event)">
            <button mat-stroked-button (click)="fileInput.click()">
              <mat-icon>folder_open</mat-icon> Browse…
            </button>
            <button mat-flat-button color="primary"
                    [disabled]="!importName || !importPem || importing()"
                    (click)="importKey()">
              @if (importing()) { <mat-spinner diameter="16" /> } @else { Import }
            </button>
          </div>
          @if (importError) {
            <div class="km-error">{{ importError }}</div>
          }
          @if (importSuccess) {
            <div class="km-success">Key imported successfully.</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100vw; height: 100vh; overflow: hidden; }
    .km-root { display: flex; flex-direction: column; width: 100%; height: 100%; background: var(--ctp-base); color: var(--ctp-text); }
    .km-titlebar { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 36px; flex-shrink: 0; background: var(--ctp-mantle); border-bottom: 1px solid var(--ctp-surface0); user-select: none; }
    .km-logo { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue); }
    .km-title-text { font-size: 13px; font-weight: 600; }
    .wctl { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 4px; border: none; background: transparent; cursor: pointer; color: var(--ctp-subtext1); transition: background 0.15s, color 0.15s; }
    .wctl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wctl-close:hover { background: var(--ctp-red); color: var(--ctp-base); }
    .km-body { display: flex; flex: 1; overflow: hidden; }
    .km-list { width: 200px; flex-shrink: 0; border-right: 1px solid var(--ctp-surface0); overflow-y: auto; background: var(--ctp-mantle); }
    .km-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: var(--ctp-overlay0); padding: 16px; text-align: center; }
    .km-empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.5; }
    .km-empty p { font-size: 12px; }
    .km-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--ctp-surface0); }
    .km-item:hover { background: var(--ctp-surface0); }
    .km-item.selected { background: rgba(137,180,250,0.15); }
    .km-key-icon { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue); flex-shrink: 0; }
    .km-key-info { flex: 1; overflow: hidden; }
    .km-key-name { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .km-key-type { font-size: 10px; color: var(--ctp-overlay1); }
    .km-del-btn { width: 24px !important; height: 24px !important; color: var(--ctp-red) !important; flex-shrink: 0; }
    .km-panel { flex: 1; padding: 20px 24px; overflow-y: auto; }
    .km-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ctp-subtext0); margin-bottom: 16px; }
    .km-field-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .km-label { font-size: 12px; color: var(--ctp-subtext0); }
    .km-input { height: 28px; padding: 0 8px; font-size: 13px; background: var(--ctp-surface0); border: 1px solid var(--ctp-overlay0); border-radius: 4px; color: var(--ctp-text); outline: none; }
    .km-input:focus { border-color: var(--ctp-blue); }
    .km-textarea-row { flex: 1; }
    .km-textarea { min-height: 120px; padding: 6px 8px; font-size: 12px; font-family: monospace; background: var(--ctp-surface0); border: 1px solid var(--ctp-overlay0); border-radius: 4px; color: var(--ctp-text); outline: none; resize: vertical; width: 100%; box-sizing: border-box; }
    .km-textarea:focus { border-color: var(--ctp-blue); }
    .km-actions { display: flex; gap: 8px; }
    .km-error { padding: 8px; border-radius: 4px; background: rgba(243,139,168,0.12); color: var(--ctp-red); font-size: 12px; margin-top: 8px; }
    .km-success { padding: 8px; border-radius: 4px; background: rgba(166,227,161,0.12); color: var(--ctp-green); font-size: 12px; margin-top: 8px; }
  `],
})
export class SshKeyManagerComponent implements OnInit {
  keys = signal<SshKeyEntry[]>([]);
  selected = signal<SshKeyEntry | null>(null);
  importing = signal(false);
  importName = '';
  importPem = '';
  importError = '';
  importSuccess = false;

  async ngOnInit() { await this.loadKeys(); }

  async loadKeys() {
    try {
      const k = await invoke<SshKeyEntry[]>('list_ssh_keys');
      this.keys.set(k);
    } catch (e) { console.error(e); }
  }

  async deleteKey(id: string) {
    try {
      await invoke('delete_ssh_key', { id });
      await this.loadKeys();
      if (this.selected()?.id === id) this.selected.set(null);
    } catch (e) { console.error(e); }
  }

  async importKey() {
    if (!this.importName || !this.importPem) return;
    this.importing.set(true);
    this.importError = '';
    this.importSuccess = false;
    try {
      await invoke('import_ssh_key', { name: this.importName, privateKeyPem: this.importPem });
      this.importName = '';
      this.importPem = '';
      this.importSuccess = true;
      await this.loadKeys();
    } catch (e: any) {
      this.importError = e?.toString() ?? 'Import failed';
    } finally {
      this.importing.set(false);
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.importPem = await file.text();
      if (!this.importName) this.importName = file.name.replace(/\.(pem|key)$/i, '');
    } catch {}
    input.value = '';
  }

  async closeWindow() { await getCurrentWindow().close(); }
}
