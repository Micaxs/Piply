# Filie — FTP/SFTP Desktop Client

A FileZilla-like desktop FTP/SFTP client built with **Tauri 2** (Rust) + **Angular 21**.

## Features

- 📁 **Dual-pane file browser** — local (left) and remote (right)
- 🔌 **Site Manager** — save/edit/delete FTP and SFTP connection profiles
- ⬆️⬇️ **Upload & Download** — double-click dirs to navigate, click transfer buttons
- 🔄 **10 simultaneous transfers** — enforced via tokio Semaphore
- 📊 **Transfer queue** — live progress bars, cancel support
- 🌓 **Dark theme** — Angular Material dark palette

## Linux Prerequisites

```bash
sudo pacman -S webkit2gtk-4.1 openssl pkg-config base-devel
# or on Ubuntu/Debian:
# sudo apt install libwebkit2gtk-4.1-dev libssl-dev pkg-config build-essential
```

## Development

```bash
npm install
npm run tauri:dev     # starts Angular dev server + Tauri window
```

## Build (release AppImage / .deb)

```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/
```

## Project Structure

```
src/                          Angular frontend
  app/
    services/                 connection, filesystem, transfer services
    components/
      connection-panel/       Site Manager sidebar
      local-browser/          Local file pane
      remote-browser/         Remote file pane
      transfer-queue/         Active transfers panel
      connection-dialog/      Add/edit connection modal

src-tauri/src/                Rust backend
  connection_store.rs         Persistent connection profiles (JSON)
  ftp_client.rs               FTP/FTPS support (suppaftp)
  sftp_client.rs              SFTP support (ssh2)
  transfer_manager.rs         Transfer queue (tokio Semaphore, max 10)
  commands.rs                 All Tauri IPC commands
  lib.rs                      App entry + command registration
```

## Connections saved at

`~/.config/filie/connections.json`
