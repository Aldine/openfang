use crate::definition::{AgentNode, AgentSelector, ApprovalNode, ApprovalRejection, WorkflowDefinition, WorkflowNode};
use std::collections::HashMap;

pub fn support_triage_workflow() -> WorkflowDefinition {
    WorkflowDefinition {
        id: "support-triage".to_string(),
        name: "Support triage".to_string(),
        description: "Triage a support request, pause for approval, then draft a reply.".to_string(),
        steps: vec![
            WorkflowNode::Agent(AgentNode {
                id: "triage-request".to_string(),
                title: "Triage request".to_string(),
                agent: AgentSelector::ByName {
                    agent_name: "support-triage".to_string(),
                },
                prompt: "Triage this support request and summarize the issue, urgency, and recommended next action: {{input}}".to_string(),
                store_as: Some("triage_summary".to_string()),
            }),
            WorkflowNode::Approval(ApprovalNode {
                id: "manager-approval".to_string(),
                title: "Manager approval".to_string(),
                prompt: "Approve sending the drafted support response for this request?".to_string(),
                on_rejected: ApprovalRejection::CompleteRun {
                    message: "Approval denied. Support reply was not drafted.".to_string(),
                },
            }),
            WorkflowNode::Agent(AgentNode {
                id: "draft-response".to_string(),
                title: "Draft response".to_string(),
                agent: AgentSelector::ByName {
                    agent_name: "support-writer".to_string(),
                },
                prompt: "Draft a concise customer reply using this triage summary: {{triage_summary}}".to_string(),
                store_as: Some("draft_reply".to_string()),
            }),
        ],
    }
}

pub fn render_prompt(
    template: &str,
    input: &str,
    last_output: Option<&str>,
    outputs: &HashMap<String, String>,
) -> String {
    let mut rendered = template.replace("{{input}}", input);
    let last_output = last_output.unwrap_or(input);
    rendered = rendered.replace("{{last_output}}", last_output);

    for (key, value) in outputs {
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }

    rendered
}
