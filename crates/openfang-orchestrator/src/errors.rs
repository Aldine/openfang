use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkflowError {
    #[error("workflow '{0}' was not found")]
    WorkflowNotFound(String),
    #[error("workflow run '{0}' was not found")]
    RunNotFound(String),
    #[error("workflow run is not waiting for approval")]
    RunNotWaitingForApproval,
    #[error("approval id did not match the pending approval")]
    ApprovalMismatch,
    #[error("workflow run is already completed")]
    RunAlreadyFinished,
    #[error("workflow definition is invalid: {0}")]
    InvalidDefinition(String),
    #[error("agent '{0}' was not found")]
    AgentNotFound(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
    #[error("store error: {0}")]
    Store(String),
}

pub type WorkflowResult<T> = Result<T, WorkflowError>;
