use chrono::{DateTime, Utc};
use openfang_types::approval::ApprovalDecision;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowEvent {
    RunStarted {
        at: DateTime<Utc>,
        input: String,
    },
    AgentStepCompleted {
        at: DateTime<Utc>,
        step_id: String,
        title: String,
        agent_label: String,
        output: String,
    },
    ApprovalRequested {
        at: DateTime<Utc>,
        approval_id: Uuid,
        step_id: String,
        title: String,
        prompt: String,
    },
    ApprovalResolved {
        at: DateTime<Utc>,
        approval_id: Uuid,
        decision: ApprovalDecision,
        decided_by: Option<String>,
    },
    RunCompleted {
        at: DateTime<Utc>,
        output: Option<String>,
    },
    RunFailed {
        at: DateTime<Utc>,
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResumeRequest {
    pub run_id: Uuid,
    pub approval_id: Uuid,
    pub decision: ApprovalDecision,
    pub decided_by: Option<String>,
}
