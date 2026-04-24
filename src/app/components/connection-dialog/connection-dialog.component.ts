import { Component, inject, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectionService, ConnectionProfile, Protocol } from '../../services/connection.service';
import { invoke } from '@tauri-apps/api/core';
interface SshKeyEntry { id: string; name: string; keyType: string; }

@Component({
  selector: 'app-connection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Edit Connection' : 'New Connection' }}</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="conn-form">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" placeholder="My Server" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Protocol</mat-label>
          <mat-select formControlName="protocol" (selectionChange)="onProtocolChange()">
            <mat-option value="ftp">FTP</mat-option>
            <mat-option value="sftp">SFTP</mat-option>
            <mat-option value="ftps">FTPS (Explicit TLS)</mat-option>
          </mat-select>
        </mat-form-field>

        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Host</mat-label>
            <input matInput formControlName="host" placeholder="ftp.example.com" (paste)="onHostPaste($event)" />
          </mat-form-field>
          <mat-form-field appearance="outline" style="width: 100px">
            <mat-label>Port</mat-label>
            <input matInput formControlName="port" type="number" />
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Username</mat-label>
          <input matInput formControlName="username" placeholder="anonymous" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Password</mat-label>
          <input matInput formControlName="password" [type]="showPass ? 'text' : 'password'" />
          <button mat-icon-button matSuffix type="button" (click)="showPass = !showPass">
            <mat-icon>{{ showPass ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Remote Path</mat-label>
          <input matInput formControlName="remotePath" placeholder="/" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Folder (optional grouping)</mat-label>
          <input matInput formControlName="folder" placeholder="e.g. Work Servers" />
        </mat-form-field>

        @if (form.get('protocol')?.value === 'sftp') {
          <mat-form-field appearance="outline">
            <mat-label>SSH Key (optional)</mat-label>
            <mat-select formControlName="keyId">
              <mat-option [value]="null">Password authentication</mat-option>
              @for (k of sshKeys; track k.id) {
                <mat-option [value]="k.id">{{ k.name }} ({{ k.keyType }})</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        @if (testResult) {
          <div class="test-result" [class.success]="testSuccess" [class.fail]="!testSuccess">
            <mat-icon>{{ testSuccess ? 'check_circle' : 'error' }}</mat-icon>
            {{ testResult }}
          </div>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="testConnection()" [disabled]="testing || form.invalid">
        @if (testing) { <mat-spinner diameter="16" /> } @else { Test }
      </button>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="form.invalid">
        Save
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .conn-form  { display: flex; flex-direction: column; gap: 4px; min-width: 380px; padding-top: 8px; }
    .row        { display: flex; gap: 12px; }
    .grow       { flex: 1; }
    mat-form-field { width: 100%; }
    .test-result { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
    .test-result.success { background: rgba(166,227,161,0.12); color: var(--ctp-green); }
    .test-result.fail    { background: rgba(243,139,168,0.12); color: var(--ctp-red); }
  `],
})
export class ConnectionDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private connSvc = inject(ConnectionService);
  private dialogRef = inject(MatDialogRef<ConnectionDialogComponent>);
  data: ConnectionProfile | null = inject(MAT_DIALOG_DATA);

  form!: FormGroup;
  isEdit = false;
  showPass = false;
  testing = false;
  testResult: string | null = null;
  testSuccess = false;
  sshKeys: SshKeyEntry[] = [];

  ngOnInit() {
    this.isEdit = !!this.data?.id;
    this.form = this.fb.group({
      name: [this.data?.name ?? '', Validators.required],
      protocol: [this.data?.protocol ?? 'ftp', Validators.required],
      host: [this.data?.host ?? '', Validators.required],
      port: [this.data?.port ?? 21, [Validators.required, Validators.min(1), Validators.max(65535)]],
      username: [this.data?.username ?? ''],
      password: [this.data?.password ?? ''],
      remotePath: [this.data?.remotePath ?? '/'],
      folder: [this.data?.folder ?? ''],
      keyId: [(this.data as any)?.keyId ?? null],
    });
    this.loadSshKeys();
  }

  onProtocolChange() {
    const proto = this.form.get('protocol')?.value as Protocol;
    this.form.get('port')?.setValue(proto === 'sftp' ? 22 : 21);
  }

  onHostPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text')?.trim();
    if (!text) return;

    const parsed = this.parseServerUrl(text);
    if (!parsed) return;

    event.preventDefault();
    this.form.patchValue(parsed, { emitEvent: true });
  }

  private async loadSshKeys() {
    try {
      this.sshKeys = await invoke<SshKeyEntry[]>('list_ssh_keys');
    } catch {}
  }

  private parseServerUrl(text: string): { protocol: Protocol; host: string; port: number } | null {
    try {
      const url = new URL(text);
      const protocol = url.protocol.replace(/:$/, '') as Protocol;
      if (protocol !== 'ftp' && protocol !== 'ftps' && protocol !== 'sftp') return null;

      const port = url.port ? Number(url.port) : (protocol === 'sftp' ? 22 : 21);
      return {
        protocol,
        host: url.hostname,
        port,
      };
    } catch {
      return null;
    }
  }

  async testConnection() {
    this.testing = true;
    this.testResult = null;
    try {
      const profile = this.buildProfile();
      await this.connSvc.connect(profile);
      await this.connSvc.disconnect();
      this.testResult = 'Connection successful!';
      this.testSuccess = true;
    } catch (e: any) {
      this.testResult = e?.toString() ?? 'Connection failed';
      this.testSuccess = false;
    } finally {
      this.testing = false;
    }
  }

  async save() {
    if (this.form.invalid) return;
    const profile = this.buildProfile();
    await this.connSvc.saveConnection(profile);
    this.dialogRef.close(profile);
  }

  private buildProfile(): ConnectionProfile {
    const v = this.form.value;
    return {
      id: this.data?.id ?? '',
      ...v,
      folder: this.parseFolderPath(v.folder),
      keyId: v.keyId ?? undefined,
    } as ConnectionProfile;
  }

  private parseFolderPath(folder: string | null | undefined): string[] {
    return folder?.trim() ? folder.split('/').filter(Boolean) : [];
  }
}
