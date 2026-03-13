use chrono::Utc;
use tracing::{error, info, warn};

use crate::request_context::RequestContext;

#[derive(Debug, Clone)]
pub struct SecurityLog {
    pub event: &'static str,
    pub category: &'static str,
    pub severity: &'static str,
    pub outcome: &'static str,
    pub actor_id: Option<String>,
    pub actor_type: Option<String>,
    pub target_id: Option<String>,
    pub target_type: Option<String>,
    pub route: String,
    pub method: String,
    pub request_id: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub reason: Option<String>,
    pub timestamp: String,
}

impl SecurityLog {
    pub fn new(
        event: &'static str,
        severity: &'static str,
        outcome: &'static str,
        ctx: &RequestContext,
    ) -> Self {
        Self {
            event,
            category: "security",
            severity,
            outcome,
            actor_id: None,
            actor_type: None,
            target_id: None,
            target_type: None,
            route: ctx.route.clone(),
            method: ctx.method.clone(),
            request_id: ctx.request_id.clone(),
            ip: ctx.ip.clone(),
            user_agent: ctx.user_agent.clone(),
            reason: None,
            timestamp: Utc::now().to_rfc3339(),
        }
    }

    pub fn actor_id(mut self, actor_id: impl Into<String>) -> Self {
        self.actor_id = Some(actor_id.into());
        self
    }

    pub fn actor_type(mut self, actor_type: impl Into<String>) -> Self {
        self.actor_type = Some(actor_type.into());
        self
    }

    pub fn target_id(mut self, target_id: impl Into<String>) -> Self {
        self.target_id = Some(target_id.into());
        self
    }

    pub fn target_type(mut self, target_type: impl Into<String>) -> Self {
        self.target_type = Some(target_type.into());
        self
    }

    pub fn reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

pub fn log_security_event(log: &SecurityLog) {
    macro_rules! emit {
        ($level:ident) => {
            $level!(
                target: "security_audit",
                event = log.event,
                category = log.category,
                severity = log.severity,
                outcome = log.outcome,
                actor_id = log.actor_id.as_deref().unwrap_or(""),
                actor_type = log.actor_type.as_deref().unwrap_or(""),
                target_id = log.target_id.as_deref().unwrap_or(""),
                target_type = log.target_type.as_deref().unwrap_or(""),
                route = log.route.as_str(),
                method = log.method.as_str(),
                request_id = log.request_id.as_deref().unwrap_or(""),
                ip = log.ip.as_deref().unwrap_or(""),
                user_agent = log.user_agent.as_deref().unwrap_or(""),
                reason = log.reason.as_deref().unwrap_or(""),
                timestamp = log.timestamp.as_str(),
                "security event"
            )
        };
    }

    match log.severity {
        "info" => emit!(info),
        "warn" => emit!(warn),
        "error" => emit!(error),
        _ => emit!(warn),
    }
}
