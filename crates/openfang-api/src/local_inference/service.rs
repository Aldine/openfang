use super::{
    build_recommendation_prompt, build_split_prompt, build_translation_prompt,
    map_recommendation_confidence, parse_recommendation_schema, parse_split_schema,
    parse_translation_schema, LocalComparisonFixtureResult,
    LocalComparisonHarnessResponse, LocalComparisonHarnessSummary,
    LocalComparisonLatency, LocalComparisonSchema, LocalModelStatus,
    LocalOnlyOutcome, LocalPlannerRecommendationRequest,
    LocalPlannerRecommendationResponse, LocalPlannerSplitRequest,
    LocalPlannerSplitResponse, LocalPlannerTranslationRequest,
    LocalPlannerTranslationResponse, RecommendationSchema, SplitSchema,
    TranslationSchema, CONFIDENCE_GATE,
};
use crate::routes::AppState;
use openfang_types::model_catalog::OPENROUTER_BASE_URL;
use openfang_types::planner::PlannerAgentRecommendation;
use openfang_types::truncate_str;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tracing::{info, warn};

const LOCAL_RECOMMENDATION_TIMEOUT_MS: u64 = 30_000;
const LOCAL_SPLIT_TIMEOUT_MS: u64 = 30_000;
const LOCAL_TRANSLATION_TIMEOUT_MS: u64 = 5_000;
const LOCAL_TAGS_TIMEOUT_MS: u64 = 1_500;
const LOCAL_WARM_TIMEOUT_MS: u64 = 8_000;
const CLOUD_TIMEOUT_MS: u64 = 8_000;
const LOCAL_KEEP_ALIVE: &str = "20m";
const MAX_RECOMMENDATION_TITLE_CHARS: usize = 96;
const MAX_RECOMMENDATION_ACTION_CHARS: usize = 120;
const MAX_RECOMMENDATION_TEXT_CHARS: usize = 160;
const MAX_SPLIT_TEXT_CHARS: usize = 220;
const MAX_TRANSLATION_TEXT_CHARS: usize = 240;
const STRONG_HEURISTIC_CONFIDENCE: f32 = 0.96;

#[derive(Default)]
struct LocalInferenceMetrics {
    local_accepts: AtomicU64,
    cloud_fallbacks: AtomicU64,
    schema_failures: AtomicU64,
    timeout_count: AtomicU64,
}

static LOCAL_INFERENCE_METRICS: LazyLock<LocalInferenceMetrics> =
    LazyLock::new(LocalInferenceMetrics::default);

#[derive(Debug, Clone, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModelTag>,
}

#[derive(Debug, Clone, Deserialize)]
struct OllamaModelTag {
    #[serde(default)]
    name: String,
    #[serde(default)]
    model: String,
}

fn normalized_ollama_base_url(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_trailing = trimmed.trim_end_matches('/');
    let normalized = without_trailing
        .strip_suffix("/v1")
        .unwrap_or(without_trailing)
        .trim_end_matches('/');

    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn ollama_base_urls(state: &AppState) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(configured) = std::env::var("OLLAMA_BASE_URL") {
        candidates.push(configured);
    }

    if state.kernel.config.default_model.provider == "ollama"
        && state.kernel.config.default_model.base_url.is_some()
    {
        candidates.push(
            state
                .kernel
                .config
                .default_model
                .base_url
                .clone()
                .unwrap_or_default(),
        );
    }

    if let Some(configured) = state.kernel.config.provider_urls.get("ollama") {
        candidates.push(configured.clone());
    }

    candidates.extend([
        "http://host.docker.internal:11434".to_string(),
        "http://127.0.0.1:11434".to_string(),
        "http://localhost:11434".to_string(),
    ]);

    let mut normalized = Vec::new();
    for candidate in candidates {
        if let Some(base_url) = normalized_ollama_base_url(&candidate) {
            if !normalized.iter().any(|existing| existing == &base_url) {
                normalized.push(base_url);
            }
        }
    }

    normalized
}

pub(crate) fn preferred_ollama_base_url(state: &AppState) -> String {
    ollama_base_urls(state)
        .into_iter()
        .next()
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
}

fn openrouter_base_url(state: &AppState) -> String {
    state
        .kernel
        .config
        .provider_urls
        .get("openrouter")
        .cloned()
        .unwrap_or_else(|| OPENROUTER_BASE_URL.to_string())
}

fn openrouter_model(state: &AppState) -> String {
    if let Ok(model) = std::env::var("OPENROUTER_MODEL") {
        if !model.trim().is_empty() {
            return model;
        }
    }

    let configured = state.kernel.config.default_model.model.trim();
    if !configured.is_empty() {
        return configured
            .strip_prefix("openrouter/")
            .unwrap_or(configured)
            .to_string();
    }

    "openai/gpt-4.1-mini".to_string()
}

fn planner_model(_state: &AppState) -> String {
    "qwen3.5:9b".to_string()
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_str(&collapsed, max_chars).trim().to_string()
}

fn recommendation_signal_text(request: &LocalPlannerRecommendationRequest) -> String {
    format!(
        "{} {} {}",
        request.title, request.next_action, request.text
    )
    .to_ascii_lowercase()
}

fn contains_any(text: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| text.contains(pattern))
}

fn make_recommendation(
    catalog: &[(String, String)],
    agent_id: &str,
    reason: &str,
    confidence: f32,
) -> Option<PlannerAgentRecommendation> {
    catalog.iter().find(|(id, _)| id == agent_id).map(|(id, name)| {
        PlannerAgentRecommendation {
            agent_id: id.clone(),
            name: name.clone(),
            reason: reason.to_string(),
            confidence: map_recommendation_confidence(confidence),
        }
    })
}

fn deterministic_recommendation(
    catalog: &[(String, String)],
    request: &LocalPlannerRecommendationRequest,
) -> Option<(Option<PlannerAgentRecommendation>, f32)> {
    let text = recommendation_signal_text(request);
    let has_security = contains_any(
        &text,
        &[
            "security review",
            "auth flow",
            "authentication",
            "authorization",
            "security",
            "audit",
            "vulnerability",
            "threat",
            "secret",
            "token",
        ],
    );
    let has_translation = contains_any(
        &text,
        &[
            "translate",
            "translation",
            "localize",
            "localization",
            "spanish",
            "french",
            "german",
            "japanese",
        ],
    );
    let has_writer = contains_any(
        &text,
        &[
            "write",
            "draft",
            "launch notes",
            "release notes",
            "announcement",
            "docs",
            "documentation",
            "blog post",
            "email",
        ],
    );
    let has_testing = contains_any(
        &text,
        &["test", "qa", "regression", "coverage", "validate"],
    );
    let scope_only = contains_any(
        &text,
        &["think through", "project scope", "scope", "roadmap", "milestone"],
    ) && !(has_security || has_translation || has_writer || has_testing);

    if scope_only {
        return Some((None, 0.91));
    }

    if has_security {
        return make_recommendation(
            catalog,
            "security-auditor",
            "Strong security review match.",
            STRONG_HEURISTIC_CONFIDENCE,
        )
        .map(|recommendation| (Some(recommendation), STRONG_HEURISTIC_CONFIDENCE));
    }
    if has_translation {
        return make_recommendation(
            catalog,
            "translator",
            "Strong translation task match.",
            STRONG_HEURISTIC_CONFIDENCE,
        )
        .map(|recommendation| (Some(recommendation), STRONG_HEURISTIC_CONFIDENCE));
    }
    if has_writer {
        return make_recommendation(
            catalog,
            "writer",
            "Strong writing deliverable match.",
            0.92,
        )
        .map(|recommendation| (Some(recommendation), 0.92));
    }
    if has_testing {
        return make_recommendation(
            catalog,
            "test-engineer",
            "Strong validation task match.",
            0.90,
        )
        .map(|recommendation| (Some(recommendation), 0.90));
    }

    None
}

fn optimized_recommendation_request(
    request: &LocalPlannerRecommendationRequest,
) -> LocalPlannerRecommendationRequest {
    LocalPlannerRecommendationRequest {
        title: compact_text(&request.title, MAX_RECOMMENDATION_TITLE_CHARS),
        next_action: compact_text(&request.next_action, MAX_RECOMMENDATION_ACTION_CHARS),
        text: compact_text(&request.text, MAX_RECOMMENDATION_TEXT_CHARS),
        high_risk: request.high_risk,
    }
}

fn optimized_split_request(request: &LocalPlannerSplitRequest) -> LocalPlannerSplitRequest {
    LocalPlannerSplitRequest {
        text: compact_text(&request.text, MAX_SPLIT_TEXT_CHARS),
        high_risk: request.high_risk,
    }
}

fn optimized_translation_request(
    request: &LocalPlannerTranslationRequest,
) -> LocalPlannerTranslationRequest {
    LocalPlannerTranslationRequest {
        text: compact_text(&request.text, MAX_TRANSLATION_TEXT_CHARS),
        target_language: request.target_language.clone(),
        high_risk: request.high_risk,
        customer_facing: request.customer_facing,
    }
}

fn specialist_signal_count(text: &str) -> usize {
    [
        contains_any(text, &["security review", "auth flow", "security", "audit"]),
        contains_any(text, &["write", "draft", "launch notes", "release notes"]),
        contains_any(text, &["translate", "translation", "localize", "spanish"]),
        contains_any(text, &["test", "qa", "regression", "coverage"]),
    ]
    .into_iter()
    .filter(|value| *value)
    .count()
}

fn heuristic_split(request: &LocalPlannerSplitRequest) -> Option<SplitSchema> {
    let text = request.text.to_ascii_lowercase();
    let connector_count = [" and then ", " then ", " and ", " also ", " plus "]
        .into_iter()
        .filter(|connector| text.contains(connector))
        .count();
    let specialist_signals = specialist_signal_count(&text);
    let scope_only = contains_any(&text, &["think through", "project scope", "scope"])
        && specialist_signals == 0
        && connector_count == 0;
    let translation_only = contains_any(
        &text,
        &["translate", "translation", "localize", "spanish"],
    ) && connector_count == 0;

    if translation_only {
        return Some(SplitSchema {
            predicted_task_count: 1,
            probably_project: false,
            confidence: STRONG_HEURISTIC_CONFIDENCE,
        });
    }

    if scope_only {
        return Some(SplitSchema {
            predicted_task_count: 1,
            probably_project: false,
            confidence: 0.92,
        });
    }

    if connector_count > 0 && specialist_signals >= 2 {
        return Some(SplitSchema {
            predicted_task_count: specialist_signals.min(3) as u32,
            probably_project: true,
            confidence: STRONG_HEURISTIC_CONFIDENCE,
        });
    }

    None
}

fn validate_split_schema(
    parsed: SplitSchema,
    request: &LocalPlannerSplitRequest,
) -> Result<SplitSchema, &'static str> {
    if parsed.predicted_task_count == 0 || parsed.predicted_task_count > 6 {
        return Err("invalid_schema");
    }

    if let Some(heuristic) = heuristic_split(request) {
        let strong_heuristic = heuristic.confidence >= STRONG_HEURISTIC_CONFIDENCE;
        let shape_mismatch = heuristic.predicted_task_count != parsed.predicted_task_count
            || heuristic.probably_project != parsed.probably_project;
        if strong_heuristic && shape_mismatch && parsed.confidence < STRONG_HEURISTIC_CONFIDENCE {
            return Err("heuristic_mismatch");
        }
    }

    Ok(parsed)
}

fn record_failure_reason(reason: &str) {
    match reason {
        "invalid_schema" | "heuristic_mismatch" => {
            LOCAL_INFERENCE_METRICS
                .schema_failures
                .fetch_add(1, Ordering::Relaxed);
        }
        "timeout" => {
            LOCAL_INFERENCE_METRICS
                .timeout_count
                .fetch_add(1, Ordering::Relaxed);
        }
        _ => {}
    }
}

fn log_schema_parse(task_type: &str, tier: &str, parse_ms: u128, schema_pass: bool) {
    info!(
        target: "openfang.local_inference",
        task_type,
        tier,
        parse_ms,
        schema_pass,
        "planner schema parse"
    );
}

fn record_final_selection(
    task_type: &str,
    tier: &str,
    latency_ms: u128,
    confidence: Option<f32>,
    fallback_reason: Option<&str>,
) {
    if tier == "localhost_model" {
        LOCAL_INFERENCE_METRICS
            .local_accepts
            .fetch_add(1, Ordering::Relaxed);
    } else {
        LOCAL_INFERENCE_METRICS
            .cloud_fallbacks
            .fetch_add(1, Ordering::Relaxed);
    }

    info!(
        target: "openfang.local_inference",
        task_type,
        tier,
        latency_ms,
        confidence,
        fallback_reason,
        local_accepts = LOCAL_INFERENCE_METRICS.local_accepts.load(Ordering::Relaxed),
        cloud_fallbacks = LOCAL_INFERENCE_METRICS.cloud_fallbacks.load(Ordering::Relaxed),
        schema_failures = LOCAL_INFERENCE_METRICS.schema_failures.load(Ordering::Relaxed),
        timeout_count = LOCAL_INFERENCE_METRICS.timeout_count.load(Ordering::Relaxed),
        "planner local inference decision"
    );
}

fn cloud_api_key() -> Option<String> {
    std::env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn build_client(timeout_ms: u64) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
}

fn fallback_reason_code(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() {
        "timeout"
    } else {
        "local_unreachable"
    }
}

fn log_fallback(task_type: &str, reason: &str) {
    info!(target: "openfang.local_inference", task_type, fallback_reason = reason, "planner local inference fell back");
}

fn local_failure<T>(started: Instant, reason: &str, schema_pass: bool) -> LocalOnlyOutcome<T> {
    record_failure_reason(reason);
    LocalOnlyOutcome {
        result: None,
        confidence: None,
        schema_pass,
        latency_ms: started.elapsed().as_millis(),
        failure_reason: Some(reason.to_string()),
    }
}

fn local_gate_failure<T>(started: Instant, reason: &str, confidence: f32) -> LocalOnlyOutcome<T> {
    LocalOnlyOutcome {
        result: None,
        confidence: Some(confidence),
        schema_pass: true,
        latency_ms: started.elapsed().as_millis(),
        failure_reason: Some(reason.to_string()),
    }
}

fn cloud_outcome_text(has_result: bool) -> String {
    if has_result {
        "Fell back to cloud".to_string()
    } else {
        "Local helper unavailable".to_string()
    }
}

async fn ollama_tags(state: &AppState) -> Result<OllamaTagsResponse, String> {
    let client = build_client(LOCAL_TAGS_TIMEOUT_MS).map_err(|error| error.to_string())?;
    for base_url in ollama_base_urls(state) {
        let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
        let response = match client.get(url).send().await {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        if let Ok(tags) = response.json::<OllamaTagsResponse>().await {
            return Ok(tags);
        }
    }

    Err("local_unreachable".to_string())
}

pub async fn get_or_refresh_local_status(state: &AppState, warm: bool) -> LocalModelStatus {
    let selected_model = planner_model(state);
    let cached = state.local_status.read().await.clone();
    if !warm
        && cached.helper_ready
        && cached.model_present
        && cached.selected_model == selected_model
    {
        return cached;
    }
    if warm
        && cached.helper_ready
        && cached.model_present
        && cached.model_warm
        && cached.selected_model == selected_model
    {
        return cached;
    }

    let mut status = LocalModelStatus {
        helper_ready: false,
        model_server_reachable: false,
        reachable: false,
        selected_model,
        model_present: false,
        model_warm: false,
        warm: false,
        last_model_error: String::new(),
        last_error: String::new(),
    };

    match ollama_tags(state).await {
        Ok(tags) => {
            status.model_server_reachable = true;
            status.model_present = tags.models.iter().any(|model| {
                model.name == status.selected_model || model.model == status.selected_model
            });
            status.helper_ready = status.model_present;
            if !status.model_present {
                status.last_model_error = "model_missing".to_string();
            }
        }
        Err(reason) => {
            status.last_model_error = reason;
            sync_legacy_status_fields(&mut status);
            *state.local_status.write().await = status.clone();
            return status;
        }
    }

    if warm && status.model_present {
        match warm_model_once(state, &status.selected_model).await {
            Ok(_) => {
                status.model_warm = true;
                status.last_model_error.clear();
            }
            Err(reason) => {
                status.model_warm = false;
                status.last_model_error = reason;
            }
        }
    } else if cached.model_warm && cached.selected_model == status.selected_model {
        status.model_warm = true;
    }

    sync_legacy_status_fields(&mut status);
    *state.local_status.write().await = status.clone();
    status
}

fn sync_legacy_status_fields(status: &mut LocalModelStatus) {
    status.reachable = status.model_server_reachable;
    status.warm = status.model_warm;
    status.last_error = status.last_model_error.clone();
}

async fn warm_model_once(state: &AppState, model: &str) -> Result<(), String> {
    let client = build_client(LOCAL_WARM_TIMEOUT_MS).map_err(|error| error.to_string())?;
    for base_url in ollama_base_urls(state) {
        let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
        let response = match client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .json(&json!({
                "model": model,
                "prompt": "",
                "stream": false,
                "keep_alive": LOCAL_KEEP_ALIVE
            }))
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };

        if response.status().is_success() {
            return Ok(());
        }
    }

    Err("local_unreachable".to_string())
}

async fn ollama_prompt(
    state: &AppState,
    prompt: &str,
    timeout_ms: u64,
    num_predict: u32,
) -> Result<String, String> {
    let client = build_client(timeout_ms).map_err(|error| error.to_string())?;
    let mut last_reason = "local_unreachable".to_string();
    for base_url in ollama_base_urls(state) {
        let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
        let response = match client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .json(&json!({
                "model": planner_model(state),
                "format": "json",
                "stream": false,
                "think": false,
                "keep_alive": LOCAL_KEEP_ALIVE,
                "messages": [
                    { "role": "system", "content": "You are a narrow planner helper. Reply with minified JSON only. No markdown." },
                    { "role": "user", "content": prompt }
                ],
                "options": {
                    "temperature": 0.1,
                    "num_predict": num_predict
                }
            }))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_reason = fallback_reason_code(&error).to_string();
                continue;
            }
        };

        if !response.status().is_success() {
            last_reason = "local_unreachable".to_string();
            continue;
        }

        let body = response
            .json::<Value>()
            .await
            .map_err(|_| "invalid_schema".to_string())?;
        return body
            .get("message")
            .and_then(|value| value.get("content"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "invalid_schema".to_string());
    }

    Err(last_reason)
}

async fn openrouter_prompt(state: &AppState, prompt: &str) -> Result<String, String> {
    let api_key = cloud_api_key().ok_or_else(|| "cloud_unavailable".to_string())?;
    let client = build_client(CLOUD_TIMEOUT_MS).map_err(|error| error.to_string())?;
    let url = format!(
        "{}/chat/completions",
        openrouter_base_url(state).trim_end_matches('/')
    );
    let response = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": openrouter_model(state),
            "messages": [
                { "role": "system", "content": "You are a narrow planner helper. Reply with minified JSON only. No markdown." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.1,
            "max_tokens": 400
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "timeout".to_string()
            } else {
                "cloud_unavailable".to_string()
            }
        })?;

    if !response.status().is_success() {
        warn!(target: "openfang.local_inference", status = %response.status(), "OpenRouter fallback request failed");
        return Err("cloud_unavailable".to_string());
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|_| "invalid_schema".to_string())?;
    body.get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "invalid_schema".to_string())
}

fn enabled_catalog(state: &AppState) -> Vec<(String, String)> {
    state
        .kernel
        .memory
        .planner_list_agent_catalog()
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.enabled)
        .map(|entry| (entry.agent_id, entry.name))
        .collect()
}

async fn run_local_recommendation(
    state: &AppState,
    request: &LocalPlannerRecommendationRequest,
) -> LocalOnlyOutcome<PlannerAgentRecommendation> {
    let started = Instant::now();
    let status = get_or_refresh_local_status(state, false).await;
    if !status.reachable {
        return local_failure(started, "local_unreachable", false);
    }
    if !status.model_present {
        return local_failure(started, "model_missing", false);
    }

    let catalog = enabled_catalog(state);
    if let Some((recommendation, confidence)) = deterministic_recommendation(&catalog, request) {
        return LocalOnlyOutcome {
            result: recommendation,
            confidence: Some(confidence),
            schema_pass: true,
            latency_ms: started.elapsed().as_millis(),
            failure_reason: None,
        };
    }

    let optimized_request = optimized_recommendation_request(request);
    let allowed = catalog
        .iter()
        .map(|(id, _)| id.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let prompt = build_recommendation_prompt(&allowed, &optimized_request);

    match ollama_prompt(state, &prompt, LOCAL_RECOMMENDATION_TIMEOUT_MS, 48).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_recommendation_schema(&content) {
                Ok(parsed) => {
                    log_schema_parse(
                        "recommendation",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    recommendation_outcome(&catalog, parsed, started)
                }
                Err(_) => {
                    log_schema_parse(
                        "recommendation",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, "invalid_schema", false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

async fn run_cloud_recommendation(
    state: &AppState,
    request: &LocalPlannerRecommendationRequest,
) -> LocalOnlyOutcome<PlannerAgentRecommendation> {
    let started = Instant::now();
    let catalog = enabled_catalog(state);
    if let Some((recommendation, confidence)) = deterministic_recommendation(&catalog, request) {
        return LocalOnlyOutcome {
            result: recommendation,
            confidence: Some(confidence),
            schema_pass: true,
            latency_ms: started.elapsed().as_millis(),
            failure_reason: None,
        };
    }

    let optimized_request = optimized_recommendation_request(request);
    let allowed = catalog
        .iter()
        .map(|(id, _)| id.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let prompt = build_recommendation_prompt(&allowed, &optimized_request);

    match openrouter_prompt(state, &prompt).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_recommendation_schema(&content) {
                Ok(parsed) => {
                    log_schema_parse(
                        "recommendation",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    recommendation_outcome(&catalog, parsed, started)
                }
                Err(_) => {
                    log_schema_parse(
                        "recommendation",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, "invalid_schema", false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

fn recommendation_outcome(
    catalog: &[(String, String)],
    parsed: RecommendationSchema,
    started: Instant,
) -> LocalOnlyOutcome<PlannerAgentRecommendation> {
    if parsed.agent_id == "none" || parsed.confidence < CONFIDENCE_GATE {
        return local_gate_failure(started, "low_confidence", parsed.confidence);
    }

    if let Some((_, name)) = catalog.iter().find(|(id, _)| *id == parsed.agent_id) {
        return LocalOnlyOutcome {
            result: Some(PlannerAgentRecommendation {
                agent_id: parsed.agent_id,
                name: name.clone(),
                reason: parsed.reason,
                confidence: map_recommendation_confidence(parsed.confidence),
            }),
            confidence: Some(parsed.confidence),
            schema_pass: true,
            latency_ms: started.elapsed().as_millis(),
            failure_reason: None,
        };
    }

    LocalOnlyOutcome {
        result: None,
        confidence: Some(parsed.confidence),
        schema_pass: false,
        latency_ms: started.elapsed().as_millis(),
        failure_reason: Some("invalid_schema".to_string()),
    }
}

async fn run_local_split(
    state: &AppState,
    request: &LocalPlannerSplitRequest,
) -> LocalOnlyOutcome<SplitSchema> {
    let started = Instant::now();
    let status = get_or_refresh_local_status(state, false).await;
    if !status.reachable {
        return local_failure(started, "local_unreachable", false);
    }
    if !status.model_present {
        return local_failure(started, "model_missing", false);
    }

    if let Some(split) = heuristic_split(request) {
        return LocalOnlyOutcome {
            result: Some(split.clone()),
            confidence: Some(split.confidence),
            schema_pass: true,
            latency_ms: started.elapsed().as_millis(),
            failure_reason: None,
        };
    }

    let optimized_request = optimized_split_request(request);
    let prompt = build_split_prompt(&optimized_request);
    match ollama_prompt(state, &prompt, LOCAL_SPLIT_TIMEOUT_MS, 40).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_split_schema(&content)
                .and_then(|parsed| validate_split_schema(parsed, &optimized_request).map_err(str::to_string))
            {
                Ok(parsed) => {
                    log_schema_parse(
                        "split",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    split_outcome(parsed, started)
                }
                Err(reason) => {
                    log_schema_parse(
                        "split",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, &reason, false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

async fn run_cloud_split(
    state: &AppState,
    request: &LocalPlannerSplitRequest,
) -> LocalOnlyOutcome<SplitSchema> {
    let started = Instant::now();
    if let Some(split) = heuristic_split(request) {
        return LocalOnlyOutcome {
            result: Some(split.clone()),
            confidence: Some(split.confidence),
            schema_pass: true,
            latency_ms: started.elapsed().as_millis(),
            failure_reason: None,
        };
    }

    let optimized_request = optimized_split_request(request);
    let prompt = build_split_prompt(&optimized_request);
    match openrouter_prompt(state, &prompt).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_split_schema(&content)
                .and_then(|parsed| validate_split_schema(parsed, &optimized_request).map_err(str::to_string))
            {
                Ok(parsed) => {
                    log_schema_parse(
                        "split",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    split_outcome(parsed, started)
                }
                Err(reason) => {
                    log_schema_parse(
                        "split",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, &reason, false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

fn split_outcome(parsed: SplitSchema, started: Instant) -> LocalOnlyOutcome<SplitSchema> {
    if parsed.confidence < CONFIDENCE_GATE {
        return local_gate_failure(started, "low_confidence", parsed.confidence);
    }

    LocalOnlyOutcome {
        result: Some(parsed.clone()),
        confidence: Some(parsed.confidence),
        schema_pass: true,
        latency_ms: started.elapsed().as_millis(),
        failure_reason: None,
    }
}

async fn run_local_translation(
    state: &AppState,
    request: &LocalPlannerTranslationRequest,
) -> LocalOnlyOutcome<TranslationSchema> {
    let started = Instant::now();
    let status = get_or_refresh_local_status(state, false).await;
    if !status.reachable {
        return local_failure(started, "local_unreachable", false);
    }
    if !status.model_present {
        return local_failure(started, "model_missing", false);
    }

    let optimized_request = optimized_translation_request(request);
    let prompt = build_translation_prompt(&optimized_request);
    match ollama_prompt(state, &prompt, LOCAL_TRANSLATION_TIMEOUT_MS, 80).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_translation_schema(&content) {
                Ok(parsed) => {
                    log_schema_parse(
                        "translate_short",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    translation_outcome(parsed, started)
                }
                Err(_) => {
                    log_schema_parse(
                        "translate_short",
                        "localhost_model",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, "invalid_schema", false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

async fn run_cloud_translation(
    state: &AppState,
    request: &LocalPlannerTranslationRequest,
) -> LocalOnlyOutcome<TranslationSchema> {
    let started = Instant::now();
    let optimized_request = optimized_translation_request(request);
    let prompt = build_translation_prompt(&optimized_request);
    match openrouter_prompt(state, &prompt).await {
        Ok(content) => {
            let parse_started = Instant::now();
            match parse_translation_schema(&content) {
                Ok(parsed) => {
                    log_schema_parse(
                        "translate_short",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        true,
                    );
                    translation_outcome(parsed, started)
                }
                Err(_) => {
                    log_schema_parse(
                        "translate_short",
                        "cloud_fallback",
                        parse_started.elapsed().as_millis(),
                        false,
                    );
                    local_failure(started, "invalid_schema", false)
                }
            }
        }
        Err(reason) => local_failure(started, &reason, false),
    }
}

fn translation_outcome(
    parsed: TranslationSchema,
    started: Instant,
) -> LocalOnlyOutcome<TranslationSchema> {
    LocalOnlyOutcome {
        result: Some(parsed.clone()),
        confidence: Some(parsed.confidence),
        schema_pass: true,
        latency_ms: started.elapsed().as_millis(),
        failure_reason: if parsed.confidence < CONFIDENCE_GATE {
            Some("low_confidence".to_string())
        } else {
            None
        },
    }
}

pub async fn recommend_local_first(
    state: &AppState,
    request: LocalPlannerRecommendationRequest,
) -> LocalPlannerRecommendationResponse {
    if request.high_risk {
        log_fallback("recommendation", "high_risk_task");
        let cloud = run_cloud_recommendation(state, &request).await;
        let cloud_has_result = cloud.result.is_some();
        let response = LocalPlannerRecommendationResponse {
            recommendation: cloud.result,
            confidence: cloud.confidence,
            tier: "cloud_fallback".to_string(),
            fallback_used: true,
            fallback_reason: Some("high_risk_task".to_string()),
            schema_pass: cloud.schema_pass,
            latency_ms: cloud.latency_ms,
            user_visible_outcome: cloud_outcome_text(cloud_has_result),
        };
        record_final_selection(
            "recommendation",
            &response.tier,
            response.latency_ms,
            response.confidence,
            response.fallback_reason.as_deref(),
        );
        return response;
    }

    let local = run_local_recommendation(state, &request).await;
    if local.failure_reason.is_none() {
        let response = LocalPlannerRecommendationResponse {
            recommendation: local.result,
            confidence: local.confidence,
            tier: "localhost_model".to_string(),
            fallback_used: false,
            fallback_reason: None,
            schema_pass: local.schema_pass,
            latency_ms: local.latency_ms,
            user_visible_outcome: "Using local model".to_string(),
        };
        record_final_selection(
            "recommendation",
            &response.tier,
            response.latency_ms,
            response.confidence,
            None,
        );
        return response;
    }

    let reason = local
        .failure_reason
        .clone()
        .unwrap_or_else(|| "local_unreachable".to_string());
    log_fallback("recommendation", &reason);
    let cloud = run_cloud_recommendation(state, &request).await;
    let cloud_has_result = cloud.result.is_some();
    let response = LocalPlannerRecommendationResponse {
        recommendation: cloud.result,
        confidence: cloud.confidence,
        tier: "cloud_fallback".to_string(),
        fallback_used: true,
        fallback_reason: Some(reason),
        schema_pass: cloud.schema_pass,
        latency_ms: local.latency_ms + cloud.latency_ms,
        user_visible_outcome: cloud_outcome_text(cloud_has_result),
    };
    record_final_selection(
        "recommendation",
        &response.tier,
        response.latency_ms,
        response.confidence,
        response.fallback_reason.as_deref(),
    );
    response
}

pub async fn split_local_first(
    state: &AppState,
    request: LocalPlannerSplitRequest,
) -> LocalPlannerSplitResponse {
    if request.high_risk {
        log_fallback("split", "high_risk_task");
        let cloud = run_cloud_split(state, &request).await;
        if let Some(result) = cloud.result {
            let response = LocalPlannerSplitResponse {
                predicted_task_count: result.predicted_task_count,
                probably_project: result.probably_project,
                confidence: cloud.confidence,
                tier: "cloud_fallback".to_string(),
                fallback_used: true,
                fallback_reason: Some("high_risk_task".to_string()),
                schema_pass: cloud.schema_pass,
                latency_ms: cloud.latency_ms,
                user_visible_outcome: "Fell back to cloud".to_string(),
            };
            record_final_selection(
                "split",
                &response.tier,
                response.latency_ms,
                response.confidence,
                response.fallback_reason.as_deref(),
            );
            return response;
        }
    }

    let local = run_local_split(state, &request).await;
    if let Some(result) = local.result {
        let response = LocalPlannerSplitResponse {
            predicted_task_count: result.predicted_task_count,
            probably_project: result.probably_project,
            confidence: local.confidence,
            tier: "localhost_model".to_string(),
            fallback_used: false,
            fallback_reason: None,
            schema_pass: local.schema_pass,
            latency_ms: local.latency_ms,
            user_visible_outcome: "Using local model".to_string(),
        };
        record_final_selection("split", &response.tier, response.latency_ms, response.confidence, None);
        return response;
    }

    let reason = local
        .failure_reason
        .clone()
        .unwrap_or_else(|| "local_unreachable".to_string());
    log_fallback("split", &reason);
    let cloud = run_cloud_split(state, &request).await;
    if let Some(result) = cloud.result {
        let response = LocalPlannerSplitResponse {
            predicted_task_count: result.predicted_task_count,
            probably_project: result.probably_project,
            confidence: cloud.confidence,
            tier: "cloud_fallback".to_string(),
            fallback_used: true,
            fallback_reason: Some(reason),
            schema_pass: cloud.schema_pass,
            latency_ms: local.latency_ms + cloud.latency_ms,
            user_visible_outcome: "Fell back to cloud".to_string(),
        };
        record_final_selection(
            "split",
            &response.tier,
            response.latency_ms,
            response.confidence,
            response.fallback_reason.as_deref(),
        );
        return response;
    }

    let response = LocalPlannerSplitResponse {
        predicted_task_count: 1,
        probably_project: false,
        confidence: cloud.confidence,
        tier: "cloud_fallback".to_string(),
        fallback_used: true,
        fallback_reason: Some(reason),
        schema_pass: cloud.schema_pass,
        latency_ms: local.latency_ms + cloud.latency_ms,
        user_visible_outcome: "Local helper unavailable".to_string(),
    };
    record_final_selection(
        "split",
        &response.tier,
        response.latency_ms,
        response.confidence,
        response.fallback_reason.as_deref(),
    );
    response
}

pub async fn translate_local_first(
    state: &AppState,
    request: LocalPlannerTranslationRequest,
) -> LocalPlannerTranslationResponse {
    if request.high_risk || request.customer_facing {
        log_fallback("translate_short", "high_risk_task");
        let cloud = run_cloud_translation(state, &request).await;
        if let Some(result) = cloud.result {
            let response = LocalPlannerTranslationResponse {
                translation: result.translation,
                confidence: cloud.confidence,
                tier: "cloud_fallback".to_string(),
                fallback_used: true,
                fallback_reason: Some("high_risk_task".to_string()),
                schema_pass: cloud.schema_pass,
                latency_ms: cloud.latency_ms,
                user_visible_outcome: "Fell back to cloud".to_string(),
            };
            record_final_selection(
                "translate_short",
                &response.tier,
                response.latency_ms,
                response.confidence,
                response.fallback_reason.as_deref(),
            );
            return response;
        }
    }

    let local = run_local_translation(state, &request).await;
    if let Some(result) = local.result.clone() {
        if result.confidence >= CONFIDENCE_GATE {
            let response = LocalPlannerTranslationResponse {
                translation: result.translation,
                confidence: local.confidence,
                tier: "localhost_model".to_string(),
                fallback_used: false,
                fallback_reason: None,
                schema_pass: local.schema_pass,
                latency_ms: local.latency_ms,
                user_visible_outcome: "Using local model".to_string(),
            };
            record_final_selection(
                "translate_short",
                &response.tier,
                response.latency_ms,
                response.confidence,
                None,
            );
            return response;
        }
    }

    let reason = local
        .failure_reason
        .clone()
        .unwrap_or_else(|| "low_confidence".to_string());
    log_fallback("translate_short", &reason);
    let cloud = run_cloud_translation(state, &request).await;
    if let Some(result) = cloud.result {
        let response = LocalPlannerTranslationResponse {
            translation: result.translation,
            confidence: cloud.confidence,
            tier: "cloud_fallback".to_string(),
            fallback_used: true,
            fallback_reason: Some(reason),
            schema_pass: cloud.schema_pass,
            latency_ms: local.latency_ms + cloud.latency_ms,
            user_visible_outcome: "Fell back to cloud".to_string(),
        };
        record_final_selection(
            "translate_short",
            &response.tier,
            response.latency_ms,
            response.confidence,
            response.fallback_reason.as_deref(),
        );
        return response;
    }

    let response = LocalPlannerTranslationResponse {
        translation: request.text,
        confidence: cloud.confidence,
        tier: "cloud_fallback".to_string(),
        fallback_used: true,
        fallback_reason: Some(reason),
        schema_pass: cloud.schema_pass,
        latency_ms: local.latency_ms + cloud.latency_ms,
        user_visible_outcome: "Local helper unavailable".to_string(),
    };
    record_final_selection(
        "translate_short",
        &response.tier,
        response.latency_ms,
        response.confidence,
        response.fallback_reason.as_deref(),
    );
    response
}

pub async fn run_comparison_harness(state: &AppState) -> LocalComparisonHarnessResponse {
    let fixtures = vec![
        (
            "fixture-1",
            "recommendation",
            "security review of auth flow and then write launch notes",
        ),
        (
            "fixture-2",
            "translate_short",
            "translate onboarding email into Spanish",
        ),
        ("fixture-3", "split", "need to think through project scope"),
        (
            "fixture-4",
            "recommendation",
            "test failing login regression",
        ),
        ("fixture-5", "recommendation", "write launch email draft"),
        ("fixture-6", "recommendation", "review permissions model"),
    ];

    let mut results = Vec::new();
    let mut local_accepts = 0usize;
    let mut cloud_fallbacks = 0usize;
    let mut total_local_latency = 0u128;
    let mut total_cloud_latency = 0u128;

    for (fixture_id, task_type, input) in fixtures {
        match task_type {
            "translate_short" => {
                let request = LocalPlannerTranslationRequest {
                    text: input.to_string(),
                    target_language: "Spanish".to_string(),
                    high_risk: false,
                    customer_facing: false,
                };
                let local = run_local_translation(state, &request).await;
                let cloud = run_cloud_translation(state, &request).await;
                let selected = translate_local_first(state, request).await;
                if selected.tier == "localhost_model" {
                    local_accepts += 1;
                } else {
                    cloud_fallbacks += 1;
                }
                total_local_latency += local.latency_ms;
                total_cloud_latency += cloud.latency_ms;
                results.push(LocalComparisonFixtureResult {
                    fixture_id: fixture_id.to_string(),
                    task_type: task_type.to_string(),
                    input: input.to_string(),
                    local_result: json!({ "translation": local.result.as_ref().map(|value| value.translation.clone()), "confidence": local.confidence }),
                    cloud_result: json!({ "translation": cloud.result.as_ref().map(|value| value.translation.clone()), "confidence": cloud.confidence }),
                    latency: LocalComparisonLatency {
                        local_ms: local.latency_ms,
                        cloud_ms: cloud.latency_ms,
                        selected_ms: selected.latency_ms,
                    },
                    schema: LocalComparisonSchema {
                        local_pass: local.schema_pass,
                        cloud_pass: cloud.schema_pass,
                    },
                    fallback_reason: selected.fallback_reason.clone(),
                    user_visible_outcome: selected.user_visible_outcome,
                });
            }
            "split" => {
                let request = LocalPlannerSplitRequest {
                    text: input.to_string(),
                    high_risk: false,
                };
                let local = run_local_split(state, &request).await;
                let cloud = run_cloud_split(state, &request).await;
                let selected = split_local_first(state, request).await;
                if selected.tier == "localhost_model" {
                    local_accepts += 1;
                } else {
                    cloud_fallbacks += 1;
                }
                total_local_latency += local.latency_ms;
                total_cloud_latency += cloud.latency_ms;
                results.push(LocalComparisonFixtureResult {
                    fixture_id: fixture_id.to_string(),
                    task_type: task_type.to_string(),
                    input: input.to_string(),
                    local_result: json!({ "predicted_task_count": local.result.as_ref().map(|value| value.predicted_task_count), "probably_project": local.result.as_ref().map(|value| value.probably_project), "confidence": local.confidence }),
                    cloud_result: json!({ "predicted_task_count": cloud.result.as_ref().map(|value| value.predicted_task_count), "probably_project": cloud.result.as_ref().map(|value| value.probably_project), "confidence": cloud.confidence }),
                    latency: LocalComparisonLatency {
                        local_ms: local.latency_ms,
                        cloud_ms: cloud.latency_ms,
                        selected_ms: selected.latency_ms,
                    },
                    schema: LocalComparisonSchema {
                        local_pass: local.schema_pass,
                        cloud_pass: cloud.schema_pass,
                    },
                    fallback_reason: selected.fallback_reason.clone(),
                    user_visible_outcome: selected.user_visible_outcome,
                });
            }
            _ => {
                let request = LocalPlannerRecommendationRequest {
                    title: input.to_string(),
                    next_action: String::new(),
                    text: String::new(),
                    high_risk: false,
                };
                let local = run_local_recommendation(state, &request).await;
                let cloud = run_cloud_recommendation(state, &request).await;
                let selected = recommend_local_first(state, request).await;
                if selected.tier == "localhost_model" {
                    local_accepts += 1;
                } else {
                    cloud_fallbacks += 1;
                }
                total_local_latency += local.latency_ms;
                total_cloud_latency += cloud.latency_ms;
                results.push(LocalComparisonFixtureResult {
                    fixture_id: fixture_id.to_string(),
                    task_type: task_type.to_string(),
                    input: input.to_string(),
                    local_result: json!({ "agent_id": local.result.as_ref().map(|value| value.agent_id.clone()), "confidence": local.confidence }),
                    cloud_result: json!({ "agent_id": cloud.result.as_ref().map(|value| value.agent_id.clone()), "confidence": cloud.confidence }),
                    latency: LocalComparisonLatency {
                        local_ms: local.latency_ms,
                        cloud_ms: cloud.latency_ms,
                        selected_ms: selected.latency_ms,
                    },
                    schema: LocalComparisonSchema {
                        local_pass: local.schema_pass,
                        cloud_pass: cloud.schema_pass,
                    },
                    fallback_reason: selected.fallback_reason.clone(),
                    user_visible_outcome: selected.user_visible_outcome,
                });
            }
        }
    }

    let total_fixtures = results.len();
    LocalComparisonHarnessResponse {
        fixtures: results,
        summary: LocalComparisonHarnessSummary {
            total_fixtures,
            local_accepts,
            cloud_fallbacks,
            estimated_cloud_calls_saved: local_accepts,
            average_local_latency_ms: if total_fixtures == 0 {
                0
            } else {
                total_local_latency / total_fixtures as u128
            },
            average_cloud_latency_ms: if total_fixtures == 0 {
                0
            } else {
                total_cloud_latency / total_fixtures as u128
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{deterministic_recommendation, heuristic_split, optimized_recommendation_request};
    use crate::local_inference::LocalPlannerRecommendationRequest;
    use crate::local_inference::LocalPlannerSplitRequest;

    fn catalog() -> Vec<(String, String)> {
        vec![
            ("security-auditor".to_string(), "Security Auditor".to_string()),
            ("writer".to_string(), "Writer".to_string()),
            ("translator".to_string(), "Translator".to_string()),
            ("test-engineer".to_string(), "Test Engineer".to_string()),
        ]
    }

    #[test]
    fn deterministic_recommendation_matches_locked_cases() {
        let catalog = catalog();
        let cases = [
            (
                LocalPlannerRecommendationRequest {
                    title: "Need a security review of auth flow".to_string(),
                    next_action: String::new(),
                    text: String::new(),
                    high_risk: false,
                },
                Some("security-auditor"),
            ),
            (
                LocalPlannerRecommendationRequest {
                    title: "Write launch notes".to_string(),
                    next_action: String::new(),
                    text: String::new(),
                    high_risk: false,
                },
                Some("writer"),
            ),
            (
                LocalPlannerRecommendationRequest {
                    title: "Translate onboarding email into Spanish".to_string(),
                    next_action: String::new(),
                    text: String::new(),
                    high_risk: false,
                },
                Some("translator"),
            ),
            (
                LocalPlannerRecommendationRequest {
                    title: "Need to think through project scope".to_string(),
                    next_action: String::new(),
                    text: String::new(),
                    high_risk: false,
                },
                None,
            ),
        ];

        for (request, expected) in cases {
            let recommendation = deterministic_recommendation(&catalog, &request);
            let actual = recommendation
                .as_ref()
                .and_then(|(recommendation, _)| recommendation.as_ref())
                .map(|recommendation| recommendation.agent_id.as_str());
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn heuristic_split_matches_locked_cases() {
        let cases = [
            (
                "Need a security review of auth flow and then write launch notes",
                2,
                true,
            ),
            ("Translate onboarding email into Spanish", 1, false),
            ("Need to think through project scope", 1, false),
        ];

        for (text, expected_count, expected_project) in cases {
            let split = heuristic_split(&LocalPlannerSplitRequest {
                text: text.to_string(),
                high_risk: false,
            })
            .expect("heuristic split should classify proof cases");

            assert_eq!(split.predicted_task_count, expected_count, "{text}");
            assert_eq!(split.probably_project, expected_project, "{text}");
        }
    }

    #[test]
    fn optimized_recommendation_request_compacts_prompt_inputs() {
        let request = optimized_recommendation_request(&LocalPlannerRecommendationRequest {
            title: "  Security   review   ".repeat(20),
            next_action: " draft  launch notes ".repeat(20),
            text: " extra context ".repeat(40),
            high_risk: false,
        });

        assert!(!request.title.contains("  "));
        assert!(!request.next_action.contains("  "));
        assert!(request.title.len() <= 96);
        assert!(request.next_action.len() <= 120);
        assert!(request.text.len() <= 160);
    }
}
