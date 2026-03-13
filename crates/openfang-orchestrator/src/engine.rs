use crate::definition::{ApprovalRejection, WorkflowDefinition, WorkflowNode};
use crate::errors::{WorkflowError, WorkflowResult};
use crate::event::WorkflowEvent;
use crate::executor::{AgentExecutionInput, WorkflowExecutor};
use crate::nodes::render_prompt;
use crate::run::{StepExecutionRecord, WorkflowRun};
use crate::store::WorkflowStore;
use crate::types::{PendingApproval, StepKind, WorkflowRunStatus};
use chrono::Utc;
use openfang_types::approval::ApprovalDecision;
use std::sync::Arc;
use uuid::Uuid;

pub struct WorkflowEngine {
    store: Arc<dyn WorkflowStore>,
    executor: Arc<dyn WorkflowExecutor>,
}

impl WorkflowEngine {
    pub fn new(store: Arc<dyn WorkflowStore>, executor: Arc<dyn WorkflowExecutor>) -> Self {
        Self { store, executor }
    }

    pub async fn register_definition(&self, definition: WorkflowDefinition) -> WorkflowResult<()> {
        if definition.steps.is_empty() {
            return Err(WorkflowError::InvalidDefinition(
                "workflow must contain at least one step".to_string(),
            ));
        }
        self.store.save_definition(definition).await
    }

    pub async fn start_workflow(&self, workflow_id: &str, input: String) -> WorkflowResult<WorkflowRun> {
        let definition = self
            .store
            .get_definition(workflow_id)
            .await?
            .ok_or_else(|| WorkflowError::WorkflowNotFound(workflow_id.to_string()))?;

        let mut run = WorkflowRun::new(definition.id.clone(), definition.name.clone(), input.clone());
        run.events.push(WorkflowEvent::RunStarted {
            at: run.created_at,
            input,
        });
        self.store.save_run(run.clone()).await?;
        self.drive_run(&definition, run).await
    }

    pub async fn resume_workflow(
        &self,
        run_id: Uuid,
        approval_id: Uuid,
        decision: ApprovalDecision,
        decided_by: Option<String>,
    ) -> WorkflowResult<WorkflowRun> {
        let mut run = self
            .store
            .get_run(run_id)
            .await?
            .ok_or_else(|| WorkflowError::RunNotFound(run_id.to_string()))?;

        if matches!(run.status, WorkflowRunStatus::Completed | WorkflowRunStatus::Failed) {
            return Err(WorkflowError::RunAlreadyFinished);
        }

        let pending = run
            .pending_approval
            .clone()
            .ok_or(WorkflowError::RunNotWaitingForApproval)?;

        if pending.approval_id != approval_id {
            return Err(WorkflowError::ApprovalMismatch);
        }

        let definition = self
            .store
            .get_definition(&run.workflow_id)
            .await?
            .ok_or_else(|| WorkflowError::WorkflowNotFound(run.workflow_id.clone()))?;

        let now = Utc::now();
        run.events.push(WorkflowEvent::ApprovalResolved {
            at: now,
            approval_id,
            decision,
            decided_by: decided_by.clone(),
        });
        run.steps.push(StepExecutionRecord {
            step_id: pending.step_id.clone(),
            title: pending.title.clone(),
            kind: StepKind::Approval,
            output: None,
            decision: Some(decision),
            completed_at: now,
        });
        run.updated_at = now;
        run.pending_approval = None;

        let step = definition
            .steps
            .get(run.current_step_index)
            .ok_or_else(|| WorkflowError::InvalidDefinition("approval step index was out of bounds".to_string()))?;

        match step {
            WorkflowNode::Approval(node) => match decision {
                ApprovalDecision::Approved => {
                    run.status = WorkflowRunStatus::Running;
                    run.current_step_index += 1;
                    self.store.save_run(run.clone()).await?;
                    self.drive_run(&definition, run).await
                }
                ApprovalDecision::Denied | ApprovalDecision::TimedOut => {
                    match &node.on_rejected {
                        ApprovalRejection::FailRun => {
                            self.fail_run(run, "Approval denied".to_string()).await
                        }
                        ApprovalRejection::CompleteRun { message } => {
                            self.complete_run(run, Some(message.clone())).await
                        }
                    }
                }
            },
            WorkflowNode::Agent(_) => Err(WorkflowError::RunNotWaitingForApproval),
        }
    }

    pub async fn get_run(&self, run_id: Uuid) -> WorkflowResult<Option<WorkflowRun>> {
        self.store.get_run(run_id).await
    }

    async fn drive_run(
        &self,
        definition: &WorkflowDefinition,
        mut run: WorkflowRun,
    ) -> WorkflowResult<WorkflowRun> {
        while let Some(step) = definition.steps.get(run.current_step_index) {
            match step {
                WorkflowNode::Agent(node) => {
                    let rendered_prompt = render_prompt(
                        &node.prompt,
                        &run.input,
                        run.last_output.as_deref(),
                        &run.outputs,
                    );
                    let result = self
                        .executor
                        .execute_agent(
                            node,
                            AgentExecutionInput {
                                run_id: run.id,
                                workflow_id: run.workflow_id.clone(),
                                workflow_name: run.workflow_name.clone(),
                                original_input: run.input.clone(),
                                rendered_prompt,
                                last_output: run.last_output.clone(),
                                outputs: run.outputs.clone(),
                            },
                        )
                        .await?;

                    if let Some(key) = &node.store_as {
                        run.outputs.insert(key.clone(), result.output.clone());
                    }
                    run.last_output = Some(result.output.clone());
                    let now = Utc::now();
                    run.steps.push(StepExecutionRecord {
                        step_id: node.id.clone(),
                        title: node.title.clone(),
                        kind: StepKind::Agent,
                        output: Some(result.output.clone()),
                        decision: None,
                        completed_at: now,
                    });
                    run.events.push(WorkflowEvent::AgentStepCompleted {
                        at: now,
                        step_id: node.id.clone(),
                        title: node.title.clone(),
                        agent_label: result.agent_label,
                        output: result.output,
                    });
                    run.current_step_index += 1;
                    run.updated_at = now;
                    self.store.save_run(run.clone()).await?;
                }
                WorkflowNode::Approval(node) => {
                    let now = Utc::now();
                    let pending = PendingApproval {
                        approval_id: Uuid::new_v4(),
                        step_id: node.id.clone(),
                        title: node.title.clone(),
                        prompt: node.prompt.clone(),
                        requested_at: now,
                    };
                    run.status = WorkflowRunStatus::WaitingApproval;
                    run.pending_approval = Some(pending.clone());
                    run.updated_at = now;
                    run.events.push(WorkflowEvent::ApprovalRequested {
                        at: now,
                        approval_id: pending.approval_id,
                        step_id: pending.step_id.clone(),
                        title: pending.title.clone(),
                        prompt: pending.prompt.clone(),
                    });
                    self.store.save_run(run.clone()).await?;
                    return Ok(run);
                }
            }
        }

        let final_output = run.last_output.clone();
        self.complete_run(run, final_output).await
    }

    async fn complete_run(&self, mut run: WorkflowRun, output: Option<String>) -> WorkflowResult<WorkflowRun> {
        let now = Utc::now();
        run.status = WorkflowRunStatus::Completed;
        run.last_output = output.clone();
        run.updated_at = now;
        run.completed_at = Some(now);
        run.events.push(WorkflowEvent::RunCompleted { at: now, output });
        self.store.save_run(run.clone()).await?;
        Ok(run)
    }

    async fn fail_run(&self, mut run: WorkflowRun, error: String) -> WorkflowResult<WorkflowRun> {
        let now = Utc::now();
        run.status = WorkflowRunStatus::Failed;
        run.error = Some(error.clone());
        run.updated_at = now;
        run.completed_at = Some(now);
        run.events.push(WorkflowEvent::RunFailed { at: now, error });
        self.store.save_run(run.clone()).await?;
        Ok(run)
    }
}
