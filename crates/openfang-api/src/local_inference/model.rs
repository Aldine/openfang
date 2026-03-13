use openfang_types::planner::{
    PlannerAgentRecommendation, PlannerRecommendationConfidence,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const CONFIDENCE_GATE: f32 = 0.80;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocalModelStatus {
    pub helper_ready: bool,
    pub model_server_reachable: bool,
    pub reachable: bool,
    pub selected_model: String,
    pub model_present: bool,
    pub model_warm: bool,
    pub warm: bool,
    pub last_model_error: String,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalStatusQuery {
    #[serde(default)]
    pub warm: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerRecommendationRequest {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub next_action: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub high_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerRecommendationResponse {
    pub recommendation: Option<PlannerAgentRecommendation>,
    pub confidence: Option<f32>,
    pub tier: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
    pub schema_pass: bool,
    pub latency_ms: u128,
    pub user_visible_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerSplitRequest {
    pub text: String,
    #[serde(default)]
    pub high_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerSplitResponse {
    pub predicted_task_count: u32,
    pub probably_project: bool,
    pub confidence: Option<f32>,
    pub tier: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
    pub schema_pass: bool,
    pub latency_ms: u128,
    pub user_visible_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerTranslationRequest {
    pub text: String,
    pub target_language: String,
    #[serde(default)]
    pub high_risk: bool,
    #[serde(default)]
    pub customer_facing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlannerTranslationResponse {
    pub translation: String,
    pub confidence: Option<f32>,
    pub tier: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
    pub schema_pass: bool,
    pub latency_ms: u128,
    pub user_visible_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalComparisonHarnessResponse {
    pub fixtures: Vec<LocalComparisonFixtureResult>,
    pub summary: LocalComparisonHarnessSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalComparisonFixtureResult {
    pub fixture_id: String,
    pub task_type: String,
    pub input: String,
    pub local_result: Value,
    pub cloud_result: Value,
    pub latency: LocalComparisonLatency,
    pub schema: LocalComparisonSchema,
    pub fallback_reason: Option<String>,
    pub user_visible_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalComparisonLatency {
    pub local_ms: u128,
    pub cloud_ms: u128,
    pub selected_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalComparisonSchema {
    pub local_pass: bool,
    pub cloud_pass: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalComparisonHarnessSummary {
    pub total_fixtures: usize,
    pub local_accepts: usize,
    pub cloud_fallbacks: usize,
    pub estimated_cloud_calls_saved: usize,
    pub average_local_latency_ms: u128,
    pub average_cloud_latency_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RecommendationSchema {
    pub(crate) agent_id: String,
    pub(crate) reason: String,
    pub(crate) confidence: f32,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SplitSchema {
    pub(crate) predicted_task_count: u32,
    pub(crate) probably_project: bool,
    pub(crate) confidence: f32,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TranslationSchema {
    pub(crate) translation: String,
    pub(crate) confidence: f32,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalOnlyOutcome<T> {
    pub(crate) result: Option<T>,
    pub(crate) confidence: Option<f32>,
    pub(crate) schema_pass: bool,
    pub(crate) latency_ms: u128,
    pub(crate) failure_reason: Option<String>,
}

fn extract_json_object(content: &str) -> Option<String> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    if end < start {
        return None;
    }
    Some(content[start..=end].trim().to_string())
}

fn parse_json_payload(content: &str) -> Result<Value, String> {
    let json_text = extract_json_object(content).unwrap_or_else(|| content.to_string());
    serde_json::from_str::<Value>(&json_text).map_err(|_| "invalid_schema".to_string())
}

fn parse_f32ish(value: Option<&Value>) -> Option<f32> {
    match value? {
        Value::Number(number) => number.as_f64().map(|value| value as f32),
        Value::String(text) => text.trim().parse::<f32>().ok(),
        _ => None,
    }
}

fn parse_u32ish(value: Option<&Value>) -> Option<u32> {
    match value? {
        Value::Number(number) => number.as_u64().and_then(|value| u32::try_from(value).ok()),
        Value::String(text) => text.trim().parse::<u32>().ok(),
        _ => None,
    }
}

fn parse_boolish(value: Option<&Value>) -> Option<bool> {
    match value? {
        Value::Bool(value) => Some(*value),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => {
            let normalized = text.trim().to_ascii_lowercase();
            match normalized.as_str() {
                "true" | "yes" | "y" | "project" | "planning" | "multiple" => Some(true),
                "false" | "no" | "n" | "single" | "one" | "task" => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

pub(crate) fn parse_recommendation_schema(content: &str) -> Result<RecommendationSchema, String> {
    let value = parse_json_payload(content)?;
    let agent_id = value
        .get("agent_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("agent").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "invalid_schema".to_string())?
        .to_string();
    let reason = value
        .get("reason")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Best available specialist fit")
        .to_string();
    let confidence =
        parse_f32ish(value.get("confidence")).ok_or_else(|| "invalid_schema".to_string())?;

    Ok(RecommendationSchema {
        agent_id,
        reason,
        confidence,
    })
}

pub(crate) fn parse_split_schema(content: &str) -> Result<SplitSchema, String> {
    let value = parse_json_payload(content)?;
    let predicted_task_count = parse_u32ish(value.get("predicted_task_count"))
        .map(|value| value.max(1))
        .ok_or_else(|| "invalid_schema".to_string())?;
    let probably_project = parse_boolish(value.get("probably_project"))
        .ok_or_else(|| "invalid_schema".to_string())?;
    let confidence =
        parse_f32ish(value.get("confidence")).ok_or_else(|| "invalid_schema".to_string())?;

    Ok(SplitSchema {
        predicted_task_count,
        probably_project,
        confidence,
    })
}

pub(crate) fn parse_translation_schema(content: &str) -> Result<TranslationSchema, String> {
    let value = parse_json_payload(content)?;
    let translation = value
        .get("translation")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "invalid_schema".to_string())?
        .to_string();
    let confidence =
        parse_f32ish(value.get("confidence")).ok_or_else(|| "invalid_schema".to_string())?;

    Ok(TranslationSchema {
        translation,
        confidence,
    })
}

pub(crate) fn build_recommendation_prompt(
    allowed: &str,
    request: &LocalPlannerRecommendationRequest,
) -> String {
    format!(
        "Choose the best specialist agent for this planner task. Allowed values: {}, none. Return compact JSON exactly matching {{\"agent_id\":\"<allowed-or-none>\",\"reason\":\"<=12 words\",\"confidence\":0.00}}. Use one allowed agent_id only.\nTask title: {}\nNext action: {}\nExtra text: {}",
        allowed,
        request.title,
        request.next_action,
        request.text,
    )
}

pub(crate) fn build_split_prompt(request: &LocalPlannerSplitRequest) -> String {
    format!(
        "Estimate whether this planner capture should stay one task or split into multiple tasks. Signals for splitting include coordination words like and/then, multiple verbs, rollout work, scope planning, or mixed outcomes. If two or more signals are present, predicted_task_count should be at least 2 and probably_project should usually be true. Return minified JSON only with predicted_task_count, probably_project, confidence. `probably_project` must be true or false only and confidence must be between 0.00 and 1.00.\nCapture: {}",
        request.text,
    )
}

pub(crate) fn build_translation_prompt(request: &LocalPlannerTranslationRequest) -> String {
    format!(
        "Translate the following short text into {}. Return JSON with translation and confidence.\nText: {}",
        request.target_language,
        request.text,
    )
}

pub(crate) fn map_recommendation_confidence(
    confidence: f32,
) -> PlannerRecommendationConfidence {
    if confidence >= 0.80 {
        PlannerRecommendationConfidence::High
    } else if confidence >= 0.50 {
        PlannerRecommendationConfidence::Medium
    } else {
        PlannerRecommendationConfidence::Low
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_recommendation_schema, parse_split_schema};

    #[test]
    fn parse_split_schema_coerces_boolish_values() {
        let parsed = parse_split_schema(
            "{\"predicted_task_count\":\"2\",\"probably_project\":\"planning\",\"confidence\":\"0.95\"}",
        )
        .expect("split schema should parse");

        assert_eq!(parsed.predicted_task_count, 2);
        assert!(parsed.probably_project);
        assert_eq!(parsed.confidence, 0.95);
    }

    #[test]
    fn parse_recommendation_schema_accepts_agent_alias() {
        let parsed = parse_recommendation_schema(
            "{\"agent\":\"test-engineer\",\"reason\":\"Best fit\",\"confidence\":\"0.91\"}",
        )
        .expect("recommendation schema should parse");

        assert_eq!(parsed.agent_id, "test-engineer");
        assert_eq!(parsed.reason, "Best fit");
        assert_eq!(parsed.confidence, 0.91);
    }
}
