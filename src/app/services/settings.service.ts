import { Injectable, signal } from '@angular/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface ThemeVars {
  name: string;
  isDark: boolean;
  vars: Record<string, string>;
}

export interface SavedTheme {
  id: string;
  name: string;
  vars: Record<string, string>;
}

export interface AppSettings {
  themeId: string;
  customTheme: Record<string, string>;
  savedThemes: SavedTheme[];
  fontSize: number;
  fontFamily: string;
  maxTransfers: number;
  defaultConflict: 'ask' | 'skip' | 'overwrite' | 'rename';
  showQuickConnect: boolean;
  showTransferPanel: boolean;
  treePosition: 'left' | 'right' | 'top' | 'hidden';
  persistConnections: boolean;
}

// Ordered list of CSS var keys shown in the custom theme editor
export const THEME_VAR_LABELS: { key: string; label: string; group: string }[] = [
  { key: '--ctp-base',     label: 'Background',        group: 'Surfaces' },
  { key: '--ctp-mantle',   label: 'Mantle',            group: 'Surfaces' },
  { key: '--ctp-crust',    label: 'Crust',             group: 'Surfaces' },
  { key: '--ctp-surface0', label: 'Surface 0',         group: 'Surfaces' },
  { key: '--ctp-surface1', label: 'Surface 1',         group: 'Surfaces' },
  { key: '--ctp-surface2', label: 'Surface 2',         group: 'Surfaces' },
  { key: '--ctp-overlay0', label: 'Overlay 0',         group: 'Text' },
  { key: '--ctp-overlay1', label: 'Overlay 1',         group: 'Text' },
  { key: '--ctp-overlay2', label: 'Overlay 2',         group: 'Text' },
  { key: '--ctp-subtext0', label: 'Subtext 0',         group: 'Text' },
  { key: '--ctp-subtext1', label: 'Subtext 1',         group: 'Text' },
  { key: '--ctp-text',     label: 'Text',              group: 'Text' },
  { key: '--ctp-blue',     label: 'Blue (accent)',     group: 'Accents' },
  { key: '--ctp-sapphire', label: 'Sapphire',          group: 'Accents' },
  { key: '--ctp-sky',      label: 'Sky',               group: 'Accents' },
  { key: '--ctp-teal',     label: 'Teal',              group: 'Accents' },
  { key: '--ctp-green',    label: 'Green',             group: 'Accents' },
  { key: '--ctp-yellow',   label: 'Yellow',            group: 'Accents' },
  { key: '--ctp-peach',    label: 'Peach',             group: 'Accents' },
  { key: '--ctp-red',      label: 'Red',               group: 'Accents' },
  { key: '--ctp-mauve',    label: 'Mauve',             group: 'Accents' },
  { key: '--ctp-lavender', label: 'Lavender',          group: 'Accents' },
];

export const PRESET_THEMES: Record<string, ThemeVars> = {
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    isDark: true,
    vars: {
      '--ctp-crust':    '#11111b',
      '--ctp-mantle':   '#181825',
      '--ctp-base':     '#1e1e2e',
      '--ctp-surface0': '#313244',
      '--ctp-surface1': '#45475a',
      '--ctp-surface2': '#585b70',
      '--ctp-overlay0': '#6c7086',
      '--ctp-overlay1': '#7f849c',
      '--ctp-overlay2': '#9399b2',
      '--ctp-subtext0': '#a6adc8',
      '--ctp-subtext1': '#bac2de',
      '--ctp-text':     '#cdd6f4',
      '--ctp-lavender': '#b4befe',
      '--ctp-blue':     '#89b4fa',
      '--ctp-sapphire': '#74c7ec',
      '--ctp-sky':      '#89dceb',
      '--ctp-teal':     '#94e2d5',
      '--ctp-green':    '#a6e3a1',
      '--ctp-yellow':   '#f9e2af',
      '--ctp-peach':    '#fab387',
      '--ctp-red':      '#f38ba8',
      '--ctp-mauve':    '#cba6f7',
    },
  },
  'catppuccin-latte': {
    name: 'Catppuccin Latte',
    isDark: false,
    vars: {
      '--ctp-crust':    '#dce0e8',
      '--ctp-mantle':   '#e6e9ef',
      '--ctp-base':     '#eff1f5',
      '--ctp-surface0': '#ccd0da',
      '--ctp-surface1': '#bcc0cc',
      '--ctp-surface2': '#acb0be',
      '--ctp-overlay0': '#9ca0b0',
      '--ctp-overlay1': '#8c8fa1',
      '--ctp-overlay2': '#7c7f93',
      '--ctp-subtext0': '#6c6f85',
      '--ctp-subtext1': '#5c5f77',
      '--ctp-text':     '#4c4f69',
      '--ctp-lavender': '#7287fd',
      '--ctp-blue':     '#1e66f5',
      '--ctp-sapphire': '#209fb5',
      '--ctp-sky':      '#04a5e5',
      '--ctp-teal':     '#179299',
      '--ctp-green':    '#40a02b',
      '--ctp-yellow':   '#df8e1d',
      '--ctp-peach':    '#fe640b',
      '--ctp-red':      '#d20f39',
      '--ctp-mauve':    '#8839ef',
    },
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    isDark: true,
    vars: {
      '--ctp-crust':    '#00212b',
      '--ctp-mantle':   '#002b36',
      '--ctp-base':     '#073642',
      '--ctp-surface0': '#0a4555',
      '--ctp-surface1': '#0d5a6e',
      '--ctp-surface2': '#15687e',
      '--ctp-overlay0': '#586e75',
      '--ctp-overlay1': '#657b83',
      '--ctp-overlay2': '#839496',
      '--ctp-subtext0': '#93a1a1',
      '--ctp-subtext1': '#839496',
      '--ctp-text':     '#eee8d5',
      '--ctp-lavender': '#6c71c4',
      '--ctp-blue':     '#268bd2',
      '--ctp-sapphire': '#2aa198',
      '--ctp-sky':      '#2aa198',
      '--ctp-teal':     '#2aa198',
      '--ctp-green':    '#859900',
      '--ctp-yellow':   '#b58900',
      '--ctp-peach':    '#cb4b16',
      '--ctp-red':      '#dc322f',
      '--ctp-mauve':    '#d33682',
    },
  },
  'vscode-dark': {
    name: 'VS Code Dark',
    isDark: true,
    vars: {
      '--ctp-crust':    '#1e1e1e',
      '--ctp-mantle':   '#252526',
      '--ctp-base':     '#1e1e1e',
      '--ctp-surface0': '#2d2d30',
      '--ctp-surface1': '#3e3e42',
      '--ctp-surface2': '#505057',
      '--ctp-overlay0': '#6e6e6e',
      '--ctp-overlay1': '#858585',
      '--ctp-overlay2': '#9d9d9d',
      '--ctp-subtext0': '#bbbbbb',
      '--ctp-subtext1': '#cccccc',
      '--ctp-text':     '#d4d4d4',
      '--ctp-lavender': '#c5a5c5',
      '--ctp-blue':     '#569cd6',
      '--ctp-sapphire': '#4fc1ff',
      '--ctp-sky':      '#9cdcfe',
      '--ctp-teal':     '#4ec9b0',
      '--ctp-green':    '#6a9955',
      '--ctp-yellow':   '#dcdcaa',
      '--ctp-peach':    '#ce9178',
      '--ctp-red':      '#f44747',
      '--ctp-mauve':    '#c586c0',
    },
  },
  'custom': {
    name: 'Custom',
    isDark: true,
    vars: {},
  },
};

const STORAGE_KEY = 'piply-settings';

const DEFAULTS: AppSettings = {
  themeId: 'catppuccin-mocha',
  customTheme: { ...PRESET_THEMES['catppuccin-mocha'].vars },
  savedThemes: [],
  fontSize: 12,
  fontFamily: 'Roboto, "Helvetica Neue", sans-serif',
  maxTransfers: 10,
  defaultConflict: 'ask',
  showQuickConnect: true,
  showTransferPanel: true,
  treePosition: 'left',
  persistConnections: true,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  themeId          = signal<string>(DEFAULTS.themeId);
  customTheme      = signal<Record<string, string>>({ ...DEFAULTS.customTheme });
  savedThemes      = signal<SavedTheme[]>([]);
  fontSize         = signal<number>(DEFAULTS.fontSize);
  fontFamily       = signal<string>(DEFAULTS.fontFamily);
  maxTransfers     = signal<number>(DEFAULTS.maxTransfers);
  defaultConflict  = signal<AppSettings['defaultConflict']>(DEFAULTS.defaultConflict);
  showQuickConnect = signal<boolean>(DEFAULTS.showQuickConnect);
  showTransferPanel= signal<boolean>(DEFAULTS.showTransferPanel);
  treePosition     = signal<'left' | 'right' | 'top' | 'hidden'>(DEFAULTS.treePosition);
  persistConnections = signal<boolean>(DEFAULTS.persistConnections);

  private unlisten?: UnlistenFn;

  constructor() {
    listen<Partial<AppSettings>>('piply-settings-changed', (event) => {
      this.applyPayload(event.payload);
    }).then(fn => { this.unlisten = fn; }).catch(() => {});
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s: Partial<AppSettings> = JSON.parse(raw);
      if (s.themeId)          this.themeId.set(s.themeId);
      if (s.customTheme)      this.customTheme.set(s.customTheme);
      if (s.savedThemes)      this.savedThemes.set(s.savedThemes);
      if (s.fontSize != null) this.fontSize.set(s.fontSize);
      if (s.fontFamily)       this.fontFamily.set(s.fontFamily);
      if (s.maxTransfers != null) this.maxTransfers.set(s.maxTransfers);
      if (s.defaultConflict)  this.defaultConflict.set(s.defaultConflict);
      if (s.showQuickConnect != null) this.showQuickConnect.set(s.showQuickConnect);
      if (s.showTransferPanel != null) this.showTransferPanel.set(s.showTransferPanel);
      if (s.treePosition)     this.treePosition.set(s.treePosition);
    } catch { /* corrupt storage — ignore */ }
  }

  save() {
    const s: AppSettings = {
      themeId:          this.themeId(),
      customTheme:      this.customTheme(),
      savedThemes:      this.savedThemes(),
      fontSize:         this.fontSize(),
      fontFamily:       this.fontFamily(),
      maxTransfers:     this.maxTransfers(),
      defaultConflict:  this.defaultConflict(),
      showQuickConnect: this.showQuickConnect(),
      showTransferPanel:this.showTransferPanel(),
      treePosition:     this.treePosition(),
      persistConnections: this.persistConnections(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    emit('piply-settings-changed', s).catch(() => {});
  }

  /** Apply a settings payload received from another window. */
  applyPayload(s: Partial<AppSettings>) {
    if (s.themeId          != null) this.themeId.set(s.themeId);
    if (s.customTheme      != null) this.customTheme.set(s.customTheme);
    if (s.savedThemes      != null) this.savedThemes.set(s.savedThemes);
    if (s.fontSize         != null) this.fontSize.set(s.fontSize);
    if (s.fontFamily       != null) this.fontFamily.set(s.fontFamily);
    if (s.maxTransfers     != null) this.maxTransfers.set(s.maxTransfers);
    if (s.defaultConflict  != null) this.defaultConflict.set(s.defaultConflict);
    if (s.showQuickConnect != null) this.showQuickConnect.set(s.showQuickConnect);
    if (s.showTransferPanel!= null) this.showTransferPanel.set(s.showTransferPanel);
    if (s.treePosition     != null) this.treePosition.set(s.treePosition);
    if (s.persistConnections != null) this.persistConnections.set(s.persistConnections);
    this.applyAll();
  }

  /** Save current custom theme vars under a name and select the new saved theme. */
  saveCurrentTheme(name: string) {
    const id = `saved-${Date.now()}`;
    const theme: SavedTheme = { id, name: name.trim() || 'My Theme', vars: { ...this.customTheme() } };
    this.savedThemes.update(list => [...list, theme]);
    this.themeId.set(id);
    this.save();
  }

  /** Delete a saved theme by id. Falls back to mocha if it was active. */
  deleteSavedTheme(id: string) {
    this.savedThemes.update(list => list.filter(t => t.id !== id));
    if (this.themeId() === id) {
      this.themeId.set('catppuccin-mocha');
      this.applyTheme();
    }
    this.save();
  }

  applyTheme() {
    const id = this.themeId();
    const saved = this.savedThemes().find(t => t.id === id);
    const preset = PRESET_THEMES[id];
    const vars = saved
      ? saved.vars
      : id === 'custom'
        ? this.customTheme()
        : preset?.vars ?? PRESET_THEMES['catppuccin-mocha'].vars;

    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }

    const isDark = saved ? true : id === 'custom' ? true : (preset?.isDark ?? true);
    root.classList.toggle('light-theme', !isDark);
    root.classList.toggle('dark-theme',   isDark);
  }

  applyFontSize() {
    document.documentElement.style.setProperty('--piply-font-size', `${this.fontSize()}px`);
  }

  applyFontFamily() {
    document.documentElement.style.setProperty('--piply-font-family', this.fontFamily());
  }

  applyAll() {
    this.applyTheme();
    this.applyFontSize();
    this.applyFontFamily();
  }

  // ── Key Management ───────────────────────────────────────────────────────
  async setPersistConnections(enabled: boolean) {
    if (enabled === this.persistConnections()) return;

    if (!enabled) {
      // Disabling persistence: wipe key and connections
      try {
        await invoke('wipe_encryption_key');
      } catch (e) {
        console.error('Failed to wipe encryption key:', e);
        throw e;
      }
    }

    this.persistConnections.set(enabled);
    this.save();
  }

  async wipeEncryptionKey() {
    try {
      await invoke('wipe_encryption_key');
    } catch (e) {
      console.error('Failed to wipe encryption key:', e);
      throw e;
    }
  }

  async regenerateEncryptionKey() {
    try {
      await invoke('regenerate_encryption_key');
    } catch (e) {
      console.error('Failed to regenerate encryption key:', e);
      throw e;
    }
  }

  async getKeyStatus(): Promise<boolean> {
    try {
      return await invoke<boolean>('get_encryption_key_status');
    } catch (e) {
      console.error('Failed to get key status:', e);
      return false;
    }
  }
}
