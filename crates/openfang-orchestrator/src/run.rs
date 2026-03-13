use crate::event::WorkflowEvent;
use crate::types::{PendingApproval, StepKind, WorkflowRunStatus};
use chrono::{DateTime, Utc};
use openfang_types::approval::ApprovalDecision;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: Uuid,
    pub workflow_id: String,
    pub workflow_name: String,
    pub input: String,
    pub status: WorkflowRunStatus,
    pub current_step_index: usize,
    pub outputs: HashMap<String, String>,
    pub last_output: Option<String>,
    pub pending_approval: Option<PendingApproval>,
    pub steps: Vec<StepExecutionRecord>,
    pub events: Vec<WorkflowEvent>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl WorkflowRun {
    pub fn new(workflow_id: String, workflow_name: String, input: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            workflow_id,
            workflow_name,
            input,
            status: WorkflowRunStatus::Running,
            current_step_index: 0,
            outputs: HashMap::new(),
            last_output: None,
            pending_approval: None,
            steps: Vec::new(),
            events: Vec::new(),
            error: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepExecutionRecord {
    pub step_id: String,
    pub title: String,
    pub kind: StepKind,
    pub output: Option<String>,
    pub decision: Option<ApprovalDecision>,
    pub completed_at: DateTime<Utc>,
}
