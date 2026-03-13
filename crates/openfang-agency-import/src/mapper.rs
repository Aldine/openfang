use crate::markdown_sections::{ParsedMarkdownProfile, ParsedSection};
use crate::normalize::{clean_line, normalize_heading, slugify};
use openfang_types::agent_profile::{
    AgentDivision, AgentProfile, AgentProfileSource, ApprovalPolicy, RiskLevel,
};
use openfang_types::deliverable::{ArtifactKind, DeliverableContract, DeliverableTemplate};
use openfang_types::escalation::{
    EscalationAction, EscalationRule, EscalationTrigger, SuccessMetric, WorkflowStepSpec,
};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ProfileImportError {
    pub source_path: String,
    pub errors: Vec<ProfileImportValidationError>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ProfileImportValidationError {
    pub section: String,
    pub message: String,
}

pub fn map_profile(
    source_path: &Path,
    parsed: &ParsedMarkdownProfile,
) -> Result<AgentProfile, ProfileImportError> {
    let display_name = infer_display_name(source_path, parsed);
    let id = infer_profile_id(source_path, &display_name);
    let division = infer_division(source_path);
    let identity = find_section(parsed, &["your identity & memory", "your identity and memory", "identity & memory", "identity and memory"]);
    let core_mission = find_section(parsed, &["your core mission", "core mission"]);
    let critical_rules = find_section(parsed, &["critical rules you must follow", "critical rules"]);
    let technical_deliverables = find_section(parsed, &["your technical deliverables", "technical deliverables"]);
    let workflow = find_section(parsed, &["your workflow process", "your workflow"]);
    let deliverable_template = find_section(parsed, &["your deliverable template", "your customer interaction template", "deliverable template"]);
    let communication_style = find_section(parsed, &["your communication style", "communication style"]);
    let success_metrics_section = find_section(parsed, &["your success metrics", "success metrics"]);
    let learning_section = find_section(parsed, &["learning & memory", "learning and memory"]);

    let role = field_value(identity, "role").unwrap_or_default();
    let personality_traits = split_csv(field_value(identity, "personality"));
    let memory_notes = field_value(identity, "memory")
        .into_iter()
        .chain(bullets(learning_section))
        .collect::<Vec<_>>();
    let core_missions = mission_items(core_mission);
    let critical_rules = bullets(critical_rules);
    let workflow_steps = workflow_steps(workflow);
    let deliverable_templates = templates(deliverable_template);
    let deliverables = deliverables(technical_deliverables, &deliverable_templates);
    let success_metrics = metrics(success_metrics_section);
    let communication_style = bullets(communication_style);
    let best_for = infer_best_for(&core_missions, &deliverables, &division);
    let avoid_for = infer_avoid_for(&critical_rules, &division);
    let risk_level = infer_risk_level(&division, &display_name, &critical_rules);
    let escalation_rules = infer_escalations(&division, &risk_level, learning_section, &critical_rules);
    let approval_policy = infer_approval_policy(&division, &risk_level);
    let summary = first_non_empty(&[
        first_sentence(parsed),
        Some(role.clone()),
        Some(display_name.clone()),
    ])
    .unwrap_or_else(|| display_name.clone());

    let mut errors = Vec::new();
    if id.is_empty() {
        errors.push(error("id", "Profile id could not be inferred"));
    }
    if display_name.trim().is_empty() {
        errors.push(error("display_name", "Display name could not be inferred"));
    }
    if role.trim().is_empty() {
        errors.push(error("role", "Role section is required"));
    }
    if core_missions.is_empty() {
        errors.push(error("core_missions", "At least one core mission is required"));
    }
    if workflow_steps.is_empty() && deliverables.is_empty() {
        errors.push(error("workflow_or_deliverable", "At least one workflow step or deliverable is required"));
    }

    if !errors.is_empty() {
        return Err(ProfileImportError {
            source_path: source_path.display().to_string(),
            errors,
        });
    }

    Ok(AgentProfile {
        id,
        source: AgentProfileSource::ImportedAgencyMarkdown,
        display_name,
        division,
        role,
        summary,
        personality_traits,
        memory_notes,
        core_missions,
        critical_rules,
        workflow_steps,
        deliverables,
        deliverable_templates,
        success_metrics,
        escalation_rules,
        communication_style,
        best_for,
        avoid_for,
        tags: infer_tags(source_path, parsed),
        risk_level,
        approval_policy,
        enabled: true,
    })
}

fn error(section: &str, message: &str) -> ProfileImportValidationError {
    ProfileImportValidationError {
        section: section.to_string(),
        message: message.to_string(),
    }
}

fn infer_display_name(source_path: &Path, parsed: &ParsedMarkdownProfile) -> String {
    if !parsed.title.trim().is_empty() {
        return parsed
            .title
            .replace("Agent Personality", "")
            .replace("Agent", "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
    }

    source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| {
            value
                .split('-')
                .skip(2)
                .map(title_case)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

fn infer_profile_id(source_path: &Path, display_name: &str) -> String {
    let stem = source_path.file_stem().and_then(|value| value.to_str());
    let parent_slug = source_path
        .parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        .map(slugify);

    stem.and_then(|value| {
        if let Some(parent_slug) = &parent_slug {
            let prefix = format!("{}-", parent_slug);
            if let Some(stripped) = value.strip_prefix(&prefix) {
                let stripped = stripped.trim_matches('-').to_string();
                if !stripped.is_empty() {
                    return Some(stripped);
                }
            }
        }
        None
    })
    .or_else(|| {
        stem.map(|value| {
            let parts = value.split('-').collect::<Vec<_>>();
            if parts.len() > 2 {
                parts[parts.len().saturating_sub(2)..].join("-")
            } else {
                value.to_string()
            }
        })
    })
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| slugify(display_name))
}

fn infer_division(source_path: &Path) -> AgentDivision {
    let path = source_path.to_string_lossy().to_ascii_lowercase();
    if path.contains("engineering/") || path.contains("engineering\\") {
        AgentDivision::Engineering
    } else if path.contains("support/") || path.contains("support\\") {
        AgentDivision::Support
    } else if path.contains("project-management/") || path.contains("project-management\\") {
        AgentDivision::ProjectManagement
    } else if path.contains("testing/") || path.contains("testing\\") {
        AgentDivision::Testing
    } else if path.contains("design/") || path.contains("design\\") {
        AgentDivision::Design
    } else if path.contains("marketing/") || path.contains("marketing\\") {
        AgentDivision::Marketing
    } else if path.contains("product/") || path.contains("product\\") {
        AgentDivision::Product
    } else {
        AgentDivision::Other("imported".to_string())
    }
}

fn find_section<'a>(parsed: &'a ParsedMarkdownProfile, names: &[&str]) -> Option<&'a ParsedSection> {
    parsed.top_level_sections.iter().find(|section| {
        let heading = normalize_heading(&section.heading);
        names.iter().any(|candidate| heading.contains(candidate))
    })
}

fn field_value(section: Option<&ParsedSection>, key: &str) -> Option<String> {
    let prefix = format!("**{}**:", title_case(key));
    section?
        .body_lines
        .iter()
        .map(|line| clean_line(line))
        .find_map(|line| line.strip_prefix(&prefix).map(|value| value.trim().to_string()))
}

fn bullets(section: Option<&ParsedSection>) -> Vec<String> {
    section
        .map(|section| {
            section
                .body_lines
                .iter()
                .filter_map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with("- ") {
                        Some(clean_line(trimmed))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mission_items(section: Option<&ParsedSection>) -> Vec<String> {
    if let Some(section) = section {
        let from_children = section
            .children
            .iter()
            .flat_map(|child| {
                let mut items = vec![child.heading.trim().to_string()];
                items.extend(bullets(Some(child)));
                items
            })
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>();
        if !from_children.is_empty() {
            return from_children;
        }
    }
    bullets(section)
}

fn workflow_steps(section: Option<&ParsedSection>) -> Vec<WorkflowStepSpec> {
    section
        .map(|section| {
            section
                .children
                .iter()
                .enumerate()
                .map(|(index, child)| WorkflowStepSpec {
                    order: index as u32 + 1,
                    label: child.heading.trim().to_string(),
                    description: first_non_empty_line(child)
                        .unwrap_or_else(|| child.heading.trim().to_string()),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn deliverables(section: Option<&ParsedSection>, templates: &[DeliverableTemplate]) -> Vec<DeliverableContract> {
    let mut results = section
        .map(|section| {
            section
                .children
                .iter()
                .map(|child| DeliverableContract {
                    id: slugify(&child.heading),
                    name: child.heading.trim().to_string(),
                    description: first_non_empty_line(child)
                        .unwrap_or_else(|| child.heading.trim().to_string()),
                    artifact_kind: infer_artifact_kind(child),
                    required_sections: inferred_required_sections(&code_block(child)),
                    output_schema: None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if results.is_empty() && !templates.is_empty() {
        for template in templates {
            results.push(DeliverableContract {
                id: slugify(&template.title),
                name: template.title.clone(),
                description: format!("Inferred contract for {}", template.title),
                artifact_kind: ArtifactKind::Markdown,
                required_sections: inferred_required_sections(&template.body_markdown),
                output_schema: None,
            });
        }
    }

    results
}

fn templates(section: Option<&ParsedSection>) -> Vec<DeliverableTemplate> {
    match section {
        Some(section) if !code_block(section).is_empty() => vec![DeliverableTemplate {
            title: section.heading.trim().to_string(),
            body_markdown: code_block(section),
        }],
        Some(section) => section
            .children
            .iter()
            .filter_map(|child| {
                let code = code_block(child);
                if code.is_empty() {
                    None
                } else {
                    Some(DeliverableTemplate {
                        title: child.heading.trim().to_string(),
                        body_markdown: code,
                    })
                }
            })
            .collect(),
        None => Vec::new(),
    }
}

fn metrics(section: Option<&ParsedSection>) -> Vec<SuccessMetric> {
    bullets(section)
        .into_iter()
        .map(|metric| SuccessMetric {
            label: metric.clone(),
            target: metric,
        })
        .collect()
}

fn infer_best_for(
    missions: &[String],
    deliverables: &[DeliverableContract],
    division: &AgentDivision,
) -> Vec<String> {
    let mut values = missions.iter().take(3).cloned().collect::<Vec<_>>();
    values.extend(deliverables.iter().take(2).map(|deliverable| deliverable.name.clone()));
    if values.is_empty() {
        values.push(match division {
            AgentDivision::Support => "Customer issue triage".to_string(),
            AgentDivision::ProjectManagement => "Cross-team coordination".to_string(),
            AgentDivision::Engineering => "Technical implementation".to_string(),
            _ => "Specialized delivery".to_string(),
        });
    }
    values
}

fn infer_avoid_for(rules: &[String], division: &AgentDivision) -> Vec<String> {
    let mut values = rules
        .iter()
        .filter(|rule| rule.to_ascii_lowercase().contains("avoid") || rule.to_ascii_lowercase().contains("never"))
        .cloned()
        .collect::<Vec<_>>();
    if values.is_empty() {
        values.push(match division {
            AgentDivision::Support => "Unapproved external commitments".to_string(),
            AgentDivision::ProjectManagement => "Unrealistic delivery promises".to_string(),
            AgentDivision::Engineering => "High-risk legal or policy language".to_string(),
            _ => "Work outside the specialist brief".to_string(),
        });
    }
    values
}

fn infer_risk_level(
    division: &AgentDivision,
    display_name: &str,
    rules: &[String],
) -> RiskLevel {
    let text = format!("{} {}", display_name, rules.join(" ")).to_ascii_lowercase();
    if matches!(division, AgentDivision::Support) || text.contains("security") || text.contains("legal") {
        RiskLevel::High
    } else if matches!(division, AgentDivision::ProjectManagement) {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    }
}

fn infer_escalations(
    division: &AgentDivision,
    risk_level: &RiskLevel,
    learning_section: Option<&ParsedSection>,
    rules: &[String],
) -> Vec<EscalationRule> {
    let mut rules_out = Vec::new();
    if bullets(learning_section)
        .iter()
        .any(|line| line.to_ascii_lowercase().contains("escalation"))
        || rules.iter().any(|line| line.to_ascii_lowercase().contains("escalate"))
    {
        rules_out.push(EscalationRule {
            id: "missing-input-review".to_string(),
            trigger: EscalationTrigger::MissingRequiredInput,
            action: EscalationAction::EmitReviewFlag,
            reason_template: "Missing required context before specialist execution".to_string(),
        });
    }

    match division {
        AgentDivision::Support => {
            rules_out.push(EscalationRule {
                id: "support-external-approval".to_string(),
                trigger: EscalationTrigger::RiskLevelAtLeast(risk_level.clone()),
                action: EscalationAction::RequireApproval {
                    approval_key: "support_external_reply".to_string(),
                },
                reason_template: "Support reply requires approval before external send".to_string(),
            });
        }
        AgentDivision::ProjectManagement => {
            rules_out.push(EscalationRule {
                id: "stakeholder-approval".to_string(),
                trigger: EscalationTrigger::KeywordMatch {
                    keywords: vec!["budget".to_string(), "timeline".to_string(), "scope".to_string()],
                },
                action: EscalationAction::RequireApproval {
                    approval_key: "project_commitment".to_string(),
                },
                reason_template: "Stakeholder-facing commitment requires approval".to_string(),
            });
        }
        _ => {}
    }

    rules_out
}

fn infer_approval_policy(division: &AgentDivision, risk_level: &RiskLevel) -> ApprovalPolicy {
    ApprovalPolicy {
        required_for_external_send: matches!(division, AgentDivision::Support | AgentDivision::ProjectManagement),
        required_for_sensitive_actions: matches!(risk_level, RiskLevel::High),
        required_for_policy_or_legal_language: matches!(division, AgentDivision::Support) || matches!(risk_level, RiskLevel::High),
    }
}

fn infer_tags(source_path: &Path, parsed: &ParsedMarkdownProfile) -> Vec<String> {
    let mut tags = Vec::new();
    tags.push(slugify(&parsed.title));
    if let Some(parent) = source_path.parent().and_then(|value| value.file_name()).and_then(|value| value.to_str()) {
        tags.push(slugify(parent));
    }
    tags.retain(|value| !value.is_empty());
    tags.sort();
    tags.dedup();
    tags
}

fn code_block(section: &ParsedSection) -> String {
    let mut in_code = false;
    let mut lines = Vec::new();
    for line in &section.body_lines {
        if line.trim_start().starts_with("```") {
            if in_code {
                break;
            }
            in_code = true;
            continue;
        }
        if in_code {
            lines.push(line.to_string());
        }
    }
    lines.join("\n").trim().to_string()
}

fn inferred_required_sections(body_markdown: &str) -> Vec<String> {
    body_markdown
        .lines()
        .filter_map(|line| line.trim().strip_prefix("## ").or_else(|| line.trim().strip_prefix("### ")))
        .map(|line| line.trim().to_string())
        .collect()
}

fn infer_artifact_kind(section: &ParsedSection) -> ArtifactKind {
    let heading = normalize_heading(&section.heading);
    if heading.contains("report") {
        ArtifactKind::Report
    } else if heading.contains("plan") || heading.contains("charter") {
        ArtifactKind::Plan
    } else if heading.contains("response") {
        ArtifactKind::ResponseDraft
    } else if code_block(section).contains('{') {
        ArtifactKind::Json
    } else {
        ArtifactKind::Markdown
    }
}

fn first_non_empty_line(section: &ParsedSection) -> Option<String> {
    section
        .body_lines
        .iter()
        .map(|line| clean_line(line))
        .find(|line| !line.is_empty() && !line.starts_with("```") && !line.starts_with('#'))
}

fn split_csv(value: Option<String>) -> Vec<String> {
    value
        .map(|value| {
            value
                .split(',')
                .map(|part| part.trim().to_string())
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn title_case(value: &str) -> String {
    value
        .split([' ', '-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => {
                    let mut out = String::new();
                    out.push(first.to_ascii_uppercase());
                    out.push_str(chars.as_str().to_ascii_lowercase().as_str());
                    out
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_sentence(parsed: &ParsedMarkdownProfile) -> Option<String> {
    parsed
        .top_level_sections
        .iter()
        .flat_map(|section| section.body_lines.iter())
        .map(|line| clean_line(line))
        .find(|line| !line.is_empty() && !line.starts_with("**Role**:"))
}

fn first_non_empty(values: &[Option<String>]) -> Option<String> {
    values
        .iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::map_profile;
    use crate::markdown_sections::parse_markdown_sections;
    use std::path::Path;

    #[test]
    fn support_profile_maps_to_support_division() {
        let parsed = parse_markdown_sections(
            "# Support Responder Agent Personality\n\n## 🧠 Your Identity & Memory\n- **Role**: Customer support specialist\n- **Personality**: Empathetic, precise\n- **Memory**: Successful support patterns\n\n## 🎯 Your Core Mission\n### Resolve customer issues\n- Keep response quality high\n\n## 🔄 Your Workflow Process\n### Step 1: Intake\n- Review context\n\n## 📋 Your Deliverable Template\n```markdown\n# Support Report\n## Summary\n```\n",
        );

        let profile = map_profile(Path::new("support/support-support-responder.md"), &parsed).unwrap();
        assert_eq!(profile.id, "support-responder");
        assert_eq!(profile.display_name, "Support Responder");
        assert!(matches!(profile.division, openfang_types::agent_profile::AgentDivision::Support));
        assert_eq!(profile.deliverables.len(), 1);
    }
}
