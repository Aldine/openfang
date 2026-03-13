use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<WorkflowNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowNode {
    Agent(AgentNode),
    Approval(ApprovalNode),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentNode {
    pub id: String,
    pub title: String,
    pub agent: AgentSelector,
    pub prompt: String,
    #[serde(default)]
    pub store_as: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum AgentSelector {
    ById { agent_id: String },
    ByName { agent_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalNode {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub on_rejected: ApprovalRejection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApprovalRejection {
    FailRun,
    CompleteRun { message: String },
}
