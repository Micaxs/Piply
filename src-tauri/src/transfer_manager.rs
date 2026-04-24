use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TransferStatus {
    Queued,
    InProgress,
    Paused,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferItem {
    pub id: String,
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: TransferDirection,
    pub status: TransferStatus,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

pub struct TransferManager {
    semaphore: Arc<Semaphore>,
    pub transfers: Arc<DashMap<String, TransferItem>>,
}

const MAX_CONCURRENT: usize = 10;

impl TransferManager {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT)),
            transfers: Arc::new(DashMap::new()),
        }
    }

    pub fn enqueue(&self, item: TransferItem) {
        self.transfers.insert(item.id.clone(), item);
    }

    pub fn new_transfer(
        &self,
        session_id: String,
        local_path: String,
        remote_path: String,
        direction: TransferDirection,
        total_bytes: u64,
    ) -> TransferItem {
        TransferItem {
            id: Uuid::new_v4().to_string(),
            session_id,
            local_path,
            remote_path,
            direction,
            status: TransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes,
            error: None,
        }
    }

    pub fn update_status(&self, transfer_id: &str, status: TransferStatus) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            item.status = status;
        }
    }

    /// Update bytes transferred and optionally total, for real-time streaming progress.
    /// Does NOT overwrite terminal/paused states — cancel/pause signals are preserved.
    pub fn update_bytes(&self, transfer_id: &str, bytes_done: u64, total_bytes: u64) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            match item.status {
                TransferStatus::Cancelled | TransferStatus::Failed | TransferStatus::Done | TransferStatus::Paused => return,
                _ => {}
            }
            if total_bytes > 0 {
                item.total_bytes = total_bytes;
            }
            item.bytes_transferred = bytes_done;
            item.status = if item.total_bytes > 0 && bytes_done >= item.total_bytes {
                TransferStatus::Done
            } else {
                TransferStatus::InProgress
            };
        }
    }

    /// Mark a transfer as fully complete, setting both total_bytes and bytes_transferred.
    /// Use this instead of update_progress when the full size is only known at completion.
    pub fn complete(&self, transfer_id: &str, total_bytes: u64) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            item.total_bytes = total_bytes;
            item.bytes_transferred = total_bytes;
            item.status = TransferStatus::Done;
        }
    }

    pub fn cancel(&self, transfer_id: &str) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            match item.status {
                TransferStatus::Queued | TransferStatus::InProgress | TransferStatus::Paused => {
                    item.status = TransferStatus::Cancelled;
                }
                _ => {}
            }
        }
    }

    pub fn pause(&self, transfer_id: &str) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            if item.status == TransferStatus::InProgress {
                item.status = TransferStatus::Paused;
            }
        }
    }

    pub fn resume(&self, transfer_id: &str) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            if item.status == TransferStatus::Paused {
                item.status = TransferStatus::InProgress;
            }
        }
    }

    pub fn is_paused(&self, transfer_id: &str) -> bool {
        self.transfers
            .get(transfer_id)
            .map(|t| t.status == TransferStatus::Paused)
            .unwrap_or(false)
    }

    pub fn set_error(&self, transfer_id: &str, error: String) {
        if let Some(mut item) = self.transfers.get_mut(transfer_id) {
            item.status = TransferStatus::Failed;
            item.error = Some(error);
        }
    }

    pub fn get_all(&self) -> Vec<TransferItem> {
        self.transfers.iter().map(|r| r.value().clone()).collect()
    }

    pub fn get_semaphore(&self) -> Arc<Semaphore> {
        self.semaphore.clone()
    }

    pub fn is_cancelled(&self, transfer_id: &str) -> bool {
        self.transfers
            .get(transfer_id)
            .map(|t| t.status == TransferStatus::Cancelled)
            .unwrap_or(false)
    }
}
