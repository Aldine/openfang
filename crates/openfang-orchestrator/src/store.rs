use crate::definition::WorkflowDefinition;
use crate::errors::{WorkflowError, WorkflowResult};
use crate::run::WorkflowRun;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[async_trait]
pub trait WorkflowStore: Send + Sync {
    async fn save_definition(&self, definition: WorkflowDefinition) -> WorkflowResult<()>;
    async fn get_definition(&self, workflow_id: &str) -> WorkflowResult<Option<WorkflowDefinition>>;
    async fn list_definitions(&self) -> WorkflowResult<Vec<WorkflowDefinition>>;
    async fn save_run(&self, run: WorkflowRun) -> WorkflowResult<()>;
    async fn get_run(&self, run_id: Uuid) -> WorkflowResult<Option<WorkflowRun>>;
}

#[derive(Debug, Default)]
pub struct InMemoryWorkflowStore {
    definitions: Arc<RwLock<HashMap<String, WorkflowDefinition>>>,
    runs: Arc<RwLock<HashMap<Uuid, WorkflowRun>>>,
}

impl InMemoryWorkflowStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WorkflowStore for InMemoryWorkflowStore {
    async fn save_definition(&self, definition: WorkflowDefinition) -> WorkflowResult<()> {
        self.definitions
            .write()
            .await
            .insert(definition.id.clone(), definition);
        Ok(())
    }

    async fn get_definition(&self, workflow_id: &str) -> WorkflowResult<Option<WorkflowDefinition>> {
        Ok(self.definitions.read().await.get(workflow_id).cloned())
    }

    async fn list_definitions(&self) -> WorkflowResult<Vec<WorkflowDefinition>> {
        Ok(self.definitions.read().await.values().cloned().collect())
    }

    async fn save_run(&self, run: WorkflowRun) -> WorkflowResult<()> {
        self.runs.write().await.insert(run.id, run);
        Ok(())
    }

    async fn get_run(&self, run_id: Uuid) -> WorkflowResult<Option<WorkflowRun>> {
        Ok(self.runs.read().await.get(&run_id).cloned())
    }
}

impl From<tokio::sync::TryLockError> for WorkflowError {
    fn from(err: tokio::sync::TryLockError) -> Self {
        WorkflowError::Store(err.to_string())
    }
}
