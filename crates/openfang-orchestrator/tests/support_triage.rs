use openfang_orchestrator::{
    support_triage_workflow, InMemoryWorkflowStore, MockWorkflowExecutor, WorkflowEngine,
    WorkflowRunStatus,
};
use openfang_types::approval::ApprovalDecision;
use std::sync::Arc;

#[tokio::test]
async fn support_triage_waits_for_approval_then_completes() {
    let store = Arc::new(InMemoryWorkflowStore::new());
    let engine = WorkflowEngine::new(store, Arc::new(MockWorkflowExecutor));
    engine
        .register_definition(support_triage_workflow())
        .await
        .unwrap();

    let run = engine
        .start_workflow(
            "support-triage",
            "Customer cannot reset their password".to_string(),
        )
        .await
        .unwrap();

    assert_eq!(run.status, WorkflowRunStatus::WaitingApproval);
    assert_eq!(run.steps.len(), 1);
    assert!(run
        .outputs
        .get("triage_summary")
        .unwrap()
        .contains("Customer cannot reset their password"));

    let pending = run.pending_approval.clone().unwrap();
    let completed = engine
        .resume_workflow(
            run.id,
            pending.approval_id,
            ApprovalDecision::Approved,
            Some("support-manager".to_string()),
        )
        .await
        .unwrap();

    assert_eq!(completed.status, WorkflowRunStatus::Completed);
    assert!(completed
        .outputs
        .get("draft_reply")
        .unwrap()
        .contains("Draft reply:"));
}

#[tokio::test]
async fn support_triage_can_complete_on_rejection() {
    let store = Arc::new(InMemoryWorkflowStore::new());
    let engine = WorkflowEngine::new(store, Arc::new(MockWorkflowExecutor));
    engine
        .register_definition(support_triage_workflow())
        .await
        .unwrap();

    let run = engine
        .start_workflow(
            "support-triage",
            "Customer cannot reset their password".to_string(),
        )
        .await
        .unwrap();

    let pending = run.pending_approval.clone().unwrap();
    let completed = engine
        .resume_workflow(run.id, pending.approval_id, ApprovalDecision::Denied, None)
        .await
        .unwrap();

    assert_eq!(completed.status, WorkflowRunStatus::Completed);
    assert_eq!(
        completed.last_output.as_deref(),
        Some("Approval denied. Support reply was not drafted.")
    );
}
