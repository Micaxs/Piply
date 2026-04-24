# Copilot instructions for Filie

## Build, test, and run

- `npm run start` — Angular dev server only.
- `npm run tauri:dev` — desktop app dev mode (`WEBKIT_DISABLE_DMABUF_RENDERER=1` is already included for Linux/Wayland).
- `npm run build` — Angular production build.
- `npm run watch` — Angular dev build in watch mode.
- `npm run tauri:build` — release desktop bundle.
- `npm run test` — run the unit test suite with Angular's `unit-test` builder (Vitest by default).
- `npm run test -- --include src/app/app.spec.ts` — run a single spec file.
- `npm run test -- --filter '^App'` — run tests matching a suite/test name.
- `npm run test -- --runner vitest --ui` — Vitest UI when needed.
- No dedicated lint npm script is defined.

## High-level architecture

- This is a Tauri 2 desktop app with an Angular 21 frontend and Rust backend.
- `src/main.ts` bootstraps a standalone Angular app; `src/app/app.ts` is the main shell and also switches between multiple webview windows based on `?window=...`.
- The main UI is a dual-pane FTP/SFTP file manager: local browser, remote browser, transfer queue, optional activity log, quick connect bar, and a tab bar for multiple active sessions.
- Frontend state lives mostly in Angular singleton services using signals (`ConnectionService`, `FileSystemService`, `TransferService`, `SettingsService`, `ComparisonService`, `SyncBrowseService`, `ActivityLogService`).
- Those services call Rust via Tauri `invoke` and `listen`, and several of them keep per-session caches/state so tab switching is fast and remote views can be restored.
- Rust code under `src-tauri/src/` owns the backend commands for connections, filesystem operations, transfers, SSH key handling, folder trees, and encryption/persistence.
- `src-tauri/src/lib.rs` wires the command handlers, starts the app, creates the splashscreen window, and hides the main window until startup is ready.
- Global theming and layout are CSS-variable driven in `src/styles.scss`, with Catppuccin-based defaults overridden at runtime by settings.

## Key conventions

- Prefer standalone Angular components and signal-based state; this codebase does not use NgModules for feature wiring.
- Keep Tauri command names aligned with Rust handlers (`snake_case` on the IPC side).
- Multi-window flows rely on stable webview labels and query-string routing (`connection-manager`, `settings`, `ssh-key-manager`, `permissions`, `tab-choice`).
- When a settings change should be shared, update the `SettingsService` signal and call `settingsSvc.save()` so the change is persisted and broadcast to other windows.
- `FileSystemService` is the source of truth for local/remote directory listings and remote-cache invalidation; transfer completion should invalidate remote cache for the affected session.
- `ConnectionService` manages saved profiles plus active sessions/tabs; keep tab-local path state in sync when switching, opening, or closing sessions.
- The UI deliberately uses custom Material styling and CSS variables to preserve the desktop-app look; avoid reintroducing browser-default chrome or styling.
