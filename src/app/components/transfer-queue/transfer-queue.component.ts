import { Component, inject, signal, ElementRef, ViewChild, computed } from '@angular/core';
import { NgTemplateOutlet, TitleCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TransferService, TransferItem, TransferPriority } from '../../services/transfer.service';
import { TransferHistoryService, HistoryEntry } from '../../services/transfer-history.service';

@Component({
  selector: 'app-transfer-queue',
  standalone: true,
  imports: [
    NgTemplateOutlet, TitleCasePipe,
    MatIconModule, MatButtonModule,
    MatProgressBarModule, MatTooltipModule, MatTabsModule, MatMenuModule,
  ],
  template: `
    <div class="queue-panel">

      <!-- ── Panel heading ── -->
      <div class="panel-hdr">
        <mat-icon class="ph-icon">swap_horiz</mat-icon>
        <span class="ph-title">Transfer Queue</span>
      </div>

      <mat-tab-group class="transfer-tabs" [animationDuration]="'0ms'">

        <!-- ── Queued / In Progress ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">swap_vert</mat-icon>
            <span>Queued</span>
            @if (queued().length > 0) { <span class="badge">{{ queued().length }}</span> }
          </ng-template>
          <ng-template [ngTemplateOutlet]="tableView"
            [ngTemplateOutletContext]="{ rows: queued(), kind: 'queued' }" />
        </mat-tab>

        <!-- ── Successful ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon ok">check_circle</mat-icon>
            <span>Successful</span>
            @if (successful().length > 0) { <span class="badge ok">{{ successful().length }}</span> }
          </ng-template>
          <ng-template [ngTemplateOutlet]="tableView"
            [ngTemplateOutletContext]="{ rows: successful(), kind: 'done' }" />
        </mat-tab>

        <!-- ── Failed / Cancelled ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon err">error</mat-icon>
            <span>Failed</span>
            @if (failed().length > 0) { <span class="badge err">{{ failed().length }}</span> }
          </ng-template>
          <ng-template [ngTemplateOutlet]="tableView"
            [ngTemplateOutletContext]="{ rows: failed(), kind: 'failed' }" />
        </mat-tab>

        <!-- ── Transfer History ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">history</mat-icon>
            <span>History</span>
            @if (historySvc.entries().length > 0) { <span class="badge">{{ historySvc.entries().length }}</span> }
          </ng-template>
          <div class="tbl-wrap">
            <div class="tbl-head">
              <span class="col col-name hd-left">Filename</span>
              <span class="col col-dir hd-center">Direction</span>
              <span class="col col-size hd-center">Size</span>
              <span class="col col-prog hd-center">Status</span>
              <span class="col col-act hd-center">
                <button mat-icon-button matTooltip="Clear history" style="width:24px;height:24px"
                        (click)="historySvc.clearHistory()">
                  <mat-icon style="font-size:14px;width:14px;height:14px">delete_sweep</mat-icon>
                </button>
              </span>
            </div>
            <div class="tbl-body">
              @if (historySvc.entries().length === 0) {
                <p class="empty-hint">No transfer history yet.</p>
              }
              @for (h of historySvc.entries(); track h.id) {
                <div class="tbl-row">
                  <span class="col col-name" [matTooltip]="h.direction === 'Upload' ? h.localPath : h.remotePath">
                    {{ h.fileName }}
                  </span>
                  <span class="col col-dir">
                    <mat-icon class="dir-ic" [class.up]="h.direction === 'Upload'" [class.ok]="h.status === 'Done'" [class.err]="h.status !== 'Done'">
                      {{ h.direction === 'Upload' ? 'upload' : 'download' }}
                    </mat-icon>
                    {{ h.direction }}
                  </span>
                  <span class="col col-size">{{ fmt(h.size) }}</span>
                  <span class="col col-prog">
                    <span [class.hist-ok]="h.status === 'Done'" [class.hist-err]="h.status !== 'Done'">{{ h.status }}</span>
                  </span>
                  <span class="col col-act"></span>
                </div>
              }
            </div>
          </div>
        </mat-tab>

      </mat-tab-group>
    </div>

    <!-- Priority context menu trigger (invisible anchor) -->
    <div style="position:fixed;visibility:hidden"
         [style.left.px]="ctxX()" [style.top.px]="ctxY()"
         [matMenuTriggerFor]="priorityMenu"
         #ctxMenuTrigger="matMenuTrigger"></div>

    <mat-menu #priorityMenu="matMenu">
      <button mat-menu-item (click)="setPriority(ctxTransferId()!, 'high')">
        <mat-icon style="color:var(--ctp-red)">arrow_upward</mat-icon> High Priority
      </button>
      <button mat-menu-item (click)="setPriority(ctxTransferId()!, 'medium')">
        <mat-icon style="color:var(--ctp-yellow)">remove</mat-icon> Medium Priority
      </button>
      <button mat-menu-item (click)="setPriority(ctxTransferId()!, 'low')">
        <mat-icon style="color:var(--ctp-blue)">arrow_downward</mat-icon> Low Priority
      </button>
    </mat-menu>

    <!-- ── Shared table template ── -->
    <ng-template #tableView let-rows="rows" let-kind="kind">
      <div class="tbl-wrap">
        <!-- Resizable header -->
        <div class="tbl-head">
          <span class="col col-name hd-left">Filename</span>
          <div class="col-resize hd-divider" (mousedown)="startResize($event, 0)"></div>
          <span class="col col-dir hd-center">Direction</span>
          <div class="col-resize hd-divider" (mousedown)="startResize($event, 1)"></div>
          <span class="col col-size hd-center">Size</span>
          <div class="col-resize hd-divider" (mousedown)="startResize($event, 2)"></div>
          <span class="col col-prog hd-center">Progress</span>
          <div class="col-resize hd-divider" (mousedown)="startResize($event, 3)"></div>
          <span class="col col-prio hd-center">Priority</span>
          <div class="col-resize hd-divider" (mousedown)="startResize($event, 4)"></div>
          <span class="col col-act hd-center">Actions</span>
        </div>
        <div class="tbl-body">
          @if (rows.length === 0) {
            <p class="empty-hint">
              @if (kind === 'queued') { No active transfers. }
              @else if (kind === 'done') { No successful transfers yet. }
              @else { No failed transfers. }
            </p>
          }
          @for (t of rows; track t.id) {
            <div class="tbl-row"
              [class.inprogress]="t.status === 'InProgress'"
              [class.paused]="t.status === 'Paused'"
              (contextmenu)="onRowCtx($event, t.id)">

              <!-- Filename -->
              <span class="col col-name"
                [matTooltip]="t.direction === 'Upload' ? t.localPath : t.remotePath">
                {{ fileName(t) }}
              </span>

              <!-- Direction -->
              <span class="col col-dir">
                <mat-icon class="dir-ic"
                  [class.up]="t.direction === 'Upload'"
                  [class.ok]="t.status === 'Done'"
                  [class.err]="t.status === 'Failed' || t.status === 'Cancelled'">
                  {{ t.direction === 'Upload' ? 'upload' : 'download' }}
                </mat-icon>
                {{ t.direction }}
              </span>

              <!-- Size -->
              <span class="col col-size">
                {{ fmt(t.totalBytes || t.bytesTransferred) }}
              </span>

              <!-- Progress -->
              <span class="col col-prog">
                <div class="prog-cell">
                  @if (t.status === 'Done') {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="green-bar" mode="determinate" [value]="100" />
                      <span class="prog-txt prog-txt-dark" [style.clip-path]="'inset(0 0 0 0)'">Completed</span>
                      <span class="prog-txt prog-txt-light" style="clip-path: inset(0 0 0 100%)">Completed</span>
                    </div>
                  } @else if (t.status === 'Cancelled') {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="red-bar" mode="determinate" [value]="svc.progressPercent(t)" />
                      <span class="prog-txt prog-txt-dark"
                        [style.clip-path]="'inset(0 calc(100% - ' + svc.progressPercent(t) + '%) 0 0)'">Cancelled</span>
                      <span class="prog-txt prog-txt-light"
                        [style.clip-path]="'inset(0 0 0 ' + svc.progressPercent(t) + '%)'">Cancelled</span>
                    </div>
                  } @else if (t.status === 'Failed') {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="red-bar" mode="determinate" [value]="svc.progressPercent(t)" />
                      <span class="prog-txt prog-txt-dark"
                        [style.clip-path]="'inset(0 calc(100% - ' + svc.progressPercent(t) + '%) 0 0)'">Failed</span>
                      <span class="prog-txt prog-txt-light"
                        [style.clip-path]="'inset(0 0 0 ' + svc.progressPercent(t) + '%)'">Failed</span>
                    </div>
                  } @else if (t.status === 'InProgress' && !t.totalBytes) {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="green-bar" mode="indeterminate" />
                      <span class="prog-txt prog-txt-light" style="clip-path: inset(0 0 0 0)">Transferring…</span>
                    </div>
                  } @else if (t.status === 'Paused') {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="yellow-bar" mode="determinate"
                        [value]="svc.progressPercent(t)" />
                      <span class="prog-txt prog-txt-dark"
                        [style.clip-path]="'inset(0 calc(100% - ' + svc.progressPercent(t) + '%) 0 0)'">
                        Paused · {{ svc.progressPercent(t) }}% · {{ fmt(t.bytesTransferred) }} / {{ fmt(t.totalBytes) }}
                      </span>
                      <span class="prog-txt prog-txt-light"
                        [style.clip-path]="'inset(0 0 0 ' + svc.progressPercent(t) + '%)'">
                        Paused · {{ svc.progressPercent(t) }}% · {{ fmt(t.bytesTransferred) }} / {{ fmt(t.totalBytes) }}
                      </span>
                    </div>
                  } @else {
                    <div class="prog-bar-wrap">
                      <mat-progress-bar class="green-bar" mode="determinate"
                        [value]="svc.progressPercent(t)" />
                      <span class="prog-txt prog-txt-dark"
                        [style.clip-path]="'inset(0 calc(100% - ' + svc.progressPercent(t) + '%) 0 0)'">
                        {{ svc.progressPercent(t) }}% · {{ fmt(t.bytesTransferred) }} / {{ fmt(t.totalBytes) }}
                      </span>
                      <span class="prog-txt prog-txt-light"
                        [style.clip-path]="'inset(0 0 0 ' + svc.progressPercent(t) + '%)'">
                        {{ svc.progressPercent(t) }}% · {{ fmt(t.bytesTransferred) }} / {{ fmt(t.totalBytes) }}
                      </span>
                    </div>
                  }
                </div>
              </span>

              <!-- Priority -->
              <span class="col col-prio">
                <span class="prio-chip prio-{{ svc.getPriority(t.id) }}">
                  <span class="prio-dot"></span>
                  {{ svc.getPriority(t.id) | titlecase }}
                </span>
              </span>

              <!-- Actions -->
              <span class="col col-act">
                @if (t.status === 'InProgress') {
                  <button mat-icon-button matTooltip="Pause" (click)="pause(t.id)">
                    <mat-icon>pause</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Cancel" (click)="cancel(t.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (t.status === 'Paused') {
                  <button mat-icon-button matTooltip="Resume" (click)="resume(t.id)">
                    <mat-icon>play_arrow</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Cancel" (click)="cancel(t.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (t.status === 'Queued') {
                  <button mat-icon-button matTooltip="Cancel" (click)="cancel(t.id)">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (t.status === 'Failed' && t.error) {
                  <mat-icon class="err-icon" [matTooltip]="t.error">error_outline</mat-icon>
                }
              </span>
            </div>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .queue-panel { display: flex; flex-direction: column; height: 100%; background: var(--ctp-surface0); }

    /* Panel heading — matches .pane-header in file browsers */
    .panel-hdr {
      display: flex; align-items: center; gap: 8px;
      height: 32px; padding: 0 12px; flex-shrink: 0;
      background: var(--ctp-mantle);
      border-bottom: 1px solid var(--ctp-surface0);
    }
    .ph-icon  { font-size: 16px; width: 16px; height: 16px; color: var(--ctp-blue); }
    .ph-title { font-size: 13px; font-weight: 600; color: var(--ctp-text); }

    /* Tabs */
    .transfer-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    ::ng-deep .transfer-tabs { display: flex !important; flex-direction: column !important; flex: 1; min-height: 0; }
    ::ng-deep .transfer-tabs .mat-mdc-tab-header { order: 10; background: var(--ctp-base); border-top: 1px solid var(--ctp-surface0); border-bottom: none; flex-shrink: 0; }
    ::ng-deep .transfer-tabs .mat-mdc-tab-body-wrapper { flex: 1 !important; overflow: hidden; min-height: 0; order: 1; }
    ::ng-deep .transfer-tabs .mat-mdc-tab-body-content { height: 100%; overflow: hidden; display: flex; flex-direction: column; }
    ::ng-deep .transfer-tabs .mdc-tab { min-width: 0; padding: 0 12px; height: 30px; }
    ::ng-deep .transfer-tabs .mdc-tab__text-label { color: var(--ctp-subtext0); font-size: 12px; }
    ::ng-deep .transfer-tabs .mdc-tab--active .mdc-tab__text-label { color: var(--ctp-text); }
    /* Per-tab indicator colors */
    ::ng-deep .transfer-tabs .mdc-tab-indicator__content--underline { border-color: var(--ctp-blue); }
    ::ng-deep .transfer-tabs .mat-mdc-tab:nth-child(2).mdc-tab--active .mdc-tab-indicator__content--underline { border-color: var(--ctp-green); }
    ::ng-deep .transfer-tabs .mat-mdc-tab:nth-child(3).mdc-tab--active .mdc-tab-indicator__content--underline { border-color: var(--ctp-red); }
    /* Indicator at top of tab (closest to content, since tabs are at bottom) */
    ::ng-deep .transfer-tabs .mdc-tab-indicator { align-items: flex-start; }
    ::ng-deep .transfer-tabs .mdc-tab-indicator__content--underline { align-self: flex-start; }

    .tab-icon     { font-size: 15px; width: 15px; height: 15px; margin-right: 4px; vertical-align: middle; color: var(--ctp-subtext0); }
    .tab-icon.ok  { color: var(--ctp-green); }
    .tab-icon.err { color: var(--ctp-red); }
    .badge     { background: var(--ctp-blue);  color: var(--ctp-base); border-radius: 8px; padding: 0 5px; font-size: 10px; font-weight: 700; margin-left: 4px; }
    .badge.ok  { background: var(--ctp-green); }
    .badge.err { background: var(--ctp-red);   }

    /* Table */
    .tbl-wrap  { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-x: hidden; }
    .tbl-head  {
      display: flex; align-items: stretch; flex-shrink: 0;
      height: 28px;
      background: var(--ctp-base);
      border-bottom: 1px solid var(--ctp-surface0);
      font-size: 11px; font-weight: 600;
      color: var(--ctp-subtext0);
      text-transform: uppercase; letter-spacing: 0.04em;
      user-select: none;
    }
    .tbl-head .col { display: flex; align-items: center; }
    .hd-left   { justify-content: flex-start; }
    .hd-center { justify-content: center; }
    .tbl-body  { flex: 1; overflow-y: auto; overflow-x: hidden; }

    /* Columns */
    .col-name { width: var(--col-name, 220px); min-width: 80px;  flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; }
    .col-dir  { width: var(--col-dir,  110px); min-width: 70px;  flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px; }
    .col-size { width: var(--col-size,  80px); min-width: 50px;  flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 0 8px; }
    .col-prog { flex: 1; min-width: 120px; padding: 0 8px; display: flex; align-items: center; }
    .col-prio { width: var(--col-prio, 90px); min-width: 70px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 0 6px; }
    .col-act  { width: var(--col-act, 68px); min-width: 50px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .col-act button { width: 28px !important; height: 28px !important; line-height: 28px !important; padding: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; }
    ::ng-deep .col-act .mat-mdc-button-touch-target { width: 28px !important; height: 28px !important; }
    ::ng-deep .col-act .mat-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; line-height: 16px !important; }

    /* Resize handle */
    .col-resize { width: 5px; flex-shrink: 0; cursor: col-resize; background: transparent; background-image: linear-gradient(var(--ctp-surface1), var(--ctp-surface1)); background-size: 1px 100%; background-repeat: no-repeat; background-position: center; }
    .hd-divider:hover { background-image: linear-gradient(var(--ctp-blue), var(--ctp-blue)); }

    /* Rows */
    .tbl-row {
      display: flex; align-items: center;
      height: 30px;
      border-bottom: 1px solid var(--ctp-surface0);
      font-size: 12px; color: var(--ctp-text);
    }
    .tbl-row:hover      { background: rgba(137,180,250,0.07); }
    .tbl-row.inprogress { background: rgba(166,227,161,0.05); }
    .tbl-row.paused     { background: rgba(249,226,175,0.05); }

    .dir-ic      { font-size: 14px; width: 14px; height: 14px; color: var(--ctp-blue); flex-shrink: 0; }
    .dir-ic.up   { color: var(--ctp-green); }
    .dir-ic.ok   { color: var(--ctp-green); }
    .dir-ic.err  { color: var(--ctp-red); }

    /* Progress cell */
    .prog-cell  { display: flex; flex-direction: column; width: 100%; }

    .prog-bar-wrap { position: relative; width: 100%; height: 18px; overflow: hidden; border-radius: 3px; }
    ::ng-deep .prog-bar-wrap mat-progress-bar { height: 18px; border-radius: 3px; display: block; }
    ::ng-deep .prog-bar-wrap .mdc-linear-progress         { height: 18px !important; }
    ::ng-deep .prog-bar-wrap .mdc-linear-progress__buffer { height: 18px !important; }
    ::ng-deep .prog-bar-wrap .mdc-linear-progress__buffer-bar { height: 18px !important; }
    ::ng-deep .prog-bar-wrap .mdc-linear-progress__bar    { height: 18px !important; }
    ::ng-deep .prog-bar-wrap .mdc-linear-progress__bar-inner { border-top-width: 18px !important; }

    .prog-txt {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 600;
      white-space: nowrap; overflow: hidden;
      pointer-events: none; padding: 0 6px;
    }
    .prog-txt-dark  { color: var(--ctp-crust); }
    .prog-txt-light { color: var(--ctp-subtext0); }

    /* Green bar */
    ::ng-deep .green-bar.mat-mdc-progress-bar {
      --mdc-linear-progress-active-indicator-color: var(--ctp-green);
      --mdc-linear-progress-track-color: var(--ctp-surface0);
      border-radius: 3px;
    }
    ::ng-deep .green-bar .mdc-linear-progress__bar-inner { border-color: var(--ctp-green) !important; }
    /* Yellow bar (paused) */
    ::ng-deep .yellow-bar.mat-mdc-progress-bar {
      --mdc-linear-progress-active-indicator-color: var(--ctp-yellow);
      --mdc-linear-progress-track-color: var(--ctp-surface0);
      border-radius: 3px;
    }
    ::ng-deep .yellow-bar .mdc-linear-progress__bar-inner { border-color: var(--ctp-yellow) !important; }
    /* Red bar */
    ::ng-deep .red-bar.mat-mdc-progress-bar {
      --mdc-linear-progress-active-indicator-color: var(--ctp-red);
      --mdc-linear-progress-track-color: var(--ctp-surface0);
      border-radius: 3px;
    }
    ::ng-deep .red-bar .mdc-linear-progress__bar-inner { border-color: var(--ctp-red) !important; }

    .err-icon { font-size: 15px; width: 15px; height: 15px; color: var(--ctp-red); }
    .empty-hint { color: var(--ctp-overlay0); font-size: 12px; padding: 12px 16px; }
    .hist-ok  { color: var(--ctp-green); font-size: 11px; font-weight: 600; }
    .hist-err { color: var(--ctp-red);   font-size: 11px; font-weight: 600; }

    /* Priority chip */
    .prio-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; }
    .prio-dot  { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .prio-high   .prio-dot { background: var(--ctp-green); }
    .prio-medium .prio-dot { background: var(--ctp-yellow); }
    .prio-low    .prio-dot { background: var(--ctp-red); }
    .prio-high   { color: var(--ctp-green); }
    .prio-medium { color: var(--ctp-yellow); }
    .prio-low    { color: var(--ctp-red); }
  `],
})
export class TransferQueueComponent {
  svc = inject(TransferService);
  historySvc = inject(TransferHistoryService);
  private host = inject(ElementRef<HTMLElement>);

  @ViewChild('ctxMenuTrigger') ctxMenuTrigger?: MatMenuTrigger;

  ctxTransferId = signal<string | null>(null);
  ctxX = signal(0);
  ctxY = signal(0);

  // Column widths (px) in order: name, dir, size, prio, act
  private colWidths = [220, 110, 80, 90, 68];
  private colVars = ['--col-name', '--col-dir', '--col-size', '--col-prio', '--col-act'];

  // Drag state
  private resizingCol = -1;
  private resizeStartX = 0;
  private resizeStartW = 0;
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundMouseUp   = this.onMouseUp.bind(this);

  queued = computed(() =>
    this.svc.transfers()
      .filter(t => t.status === 'Queued' || t.status === 'InProgress' || t.status === 'Paused')
      .sort((a, b) => this.svc.comparePriority(a.id, b.id))
  );
  successful() { return this.svc.transfers().filter(t => t.status === 'Done'); }
  failed()     { return this.svc.transfers().filter(t => t.status === 'Failed' || t.status === 'Cancelled'); }

  onRowCtx(event: MouseEvent, transferId: string) {
    event.preventDefault();
    this.ctxTransferId.set(transferId);
    this.ctxX.set(event.clientX);
    this.ctxY.set(event.clientY);
    setTimeout(() => this.ctxMenuTrigger?.openMenu(), 0);
  }

  setPriority(transferId: string, priority: TransferPriority) {
    this.svc.setPriority(transferId, priority);
  }

  priorityLabel(id: string): string {
    const p = this.svc.getPriority(id);
    return p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Low';
  }

  fileName(t: TransferItem): string {
    const p = t.direction === 'Upload' ? t.localPath : t.remotePath;
    return p.split('/').pop() ?? p;
  }

  async cancel(id: string)  { await this.svc.cancelTransfer(id); }
  async pause(id: string)   { await this.svc.pauseTransfer(id); }
  async resume(id: string)  { await this.svc.resumeTransfer(id); }

  fmt(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  // ── Column resize ────────────────────────────────────────────────────────
  startResize(e: MouseEvent, colIdx: number) {
    e.preventDefault();
    this.resizingCol  = colIdx;
    this.resizeStartX = e.clientX;
    this.resizeStartW = this.colWidths[colIdx];
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup',   this.boundMouseUp);
  }

  private onMouseMove(e: MouseEvent) {
    if (this.resizingCol < 0) return;
    const delta = e.clientX - this.resizeStartX;
    // Columns after the flex progress column use inverted delta (drag-right = column shrinks)
    const sign  = this.resizingCol >= 3 ? -1 : 1;
    const newW  = Math.max(50, this.resizeStartW + sign * delta);
    this.colWidths[this.resizingCol] = newW;
    this.host.nativeElement.style.setProperty(this.colVars[this.resizingCol], `${newW}px`);
  }

  private onMouseUp() {
    this.resizingCol = -1;
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup',   this.boundMouseUp);
  }
}
