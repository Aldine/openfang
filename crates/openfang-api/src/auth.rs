use crate::routes::AppState;
use axum::http::{HeaderMap, Uri};
use jsonwebtoken::{
    decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use openfang_memory::auth::{AuthSessionRecord, AuthStore, AuthUserRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionClaims {
    pub sub: String,
    pub provider: String,
    pub provider_user_id: String,
    pub role: String,
    pub login: Option<String>,
    pub name: Option<String>,
    pub jti: String,
    pub iss: String,
    pub aud: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPrincipal {
    pub user_id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub role: String,
    pub login: Option<String>,
    pub name: Option<String>,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthPrincipal {
    ApiKey,
    User(UserPrincipal),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubProfile {
    pub provider_user_id: String,
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    id: u64,
    login: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
}

pub fn auth_mode(state: &AppState) -> &'static str {
    let api_key_enabled = !state.kernel.config.api_key.trim().is_empty();
    let jwt_enabled = signing_secret(state).is_some();

    match (api_key_enabled, jwt_enabled) {
        (false, false) => "open",
        (false, true) => "jwt",
        (true, true) => "hybrid",
        (true, false) => "api_key",
    }
}

pub fn jwt_enabled(state: &AppState) -> bool {
    signing_secret(state).is_some()
}

pub fn auth_required(state: &AppState) -> bool {
    auth_mode(state) != "open"
}

pub fn jwt_ttl_seconds(state: &AppState) -> i64 {
    // M1: Cap at 24 hours to limit stolen-token blast radius.
    let hours = state.kernel.config.oauth.jwt_ttl_hours.clamp(1, 24) as i64;
    hours * 60 * 60
}

pub fn jwt_issuer(state: &AppState) -> &str {
    state.kernel.config.oauth.jwt_issuer.as_str()
}

pub fn jwt_audience(state: &AppState) -> &str {
    state.kernel.config.oauth.jwt_audience.as_str()
}

pub fn signing_secret(state: &AppState) -> Option<String> {
    let dedicated_secret = state
        .kernel
        .config
        .oauth
        .jwt_secret
        .clone()
        .filter(|secret| !secret.trim().is_empty());

    if let Some(ref s) = dedicated_secret {
        // C4: Warn if JWT secret is shorter than 32 bytes (256 bits minimum).
        if s.len() < 32 {
            tracing::warn!(
                secret_len = s.len(),
                "SECURITY: oauth.jwt_secret is shorter than 32 bytes minimum — \
                 use a long random secret (e.g. `openssl rand -hex 32`)"
            );
        }
        return Some(s.clone());
    }

    // C3: Fallback to api_key as signing secret.
    // SECURITY WARNING: If OAuth is enabled, set oauth.jwt_secret independently.
    // Using api_key as JWT secret means anyone with the api_key can forge
    // OAuth session tokens with arbitrary roles.
    let api_key = state.kernel.config.api_key.trim();
    if api_key.is_empty() {
        return None;
    }
    // Only warn when OAuth (GitHub) is configured — that's when JWT forgery is a real risk.
    let github_client_id = state.kernel.config.oauth.github_client_id.as_deref().unwrap_or("");
    if !github_client_id.is_empty() {
        tracing::warn!(
            "SECURITY: oauth.jwt_secret is not set. Falling back to api_key as JWT \
             signing secret. Set oauth.jwt_secret to a separate 32+ byte random value."
        );
    }
    if api_key.len() < 32 {
        tracing::warn!(
            key_len = api_key.len(),
            "SECURITY: api_key is shorter than 32 bytes — short secrets are brute-forceable"
        );
    }
    Some(api_key.to_string())
}

pub fn extract_token(headers: &HeaderMap, uri: &Uri) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(ToString::to_string)
        .or_else(|| {
            headers
                .get("x-api-key")
                .and_then(|v| v.to_str().ok())
                .map(ToString::to_string)
        })
        .or_else(|| {
            // C2: Restrict ?token= query parameter to WebSocket and SSE streaming
            // endpoints only. Tokens in URLs appear in server logs, browser history,
            // and Referer headers — dangerous for regular REST endpoints.
            let path = uri.path();
            let is_ws_or_stream = path.ends_with("/ws")
                || path.contains("/stream")
                || path.contains("/logs/stream");
            if !is_ws_or_stream {
                return None;
            }
            uri.query()
                .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("token=")))
                .map(ToString::to_string)
        })
}

pub fn resolve_principal(
    headers: &HeaderMap,
    uri: &Uri,
    state: &AppState,
) -> Result<Option<AuthPrincipal>, String> {
    let Some(token) = extract_token(headers, uri) else {
        return Ok(None);
    };

    let api_key = state.kernel.config.api_key.trim();
    if !api_key.is_empty() && constant_time_eq(&token, api_key) {
        return Ok(Some(AuthPrincipal::ApiKey));
    }

    let claims = decode_token(&token, state)?;
    let store = AuthStore::new(state.kernel.memory.usage_conn());
    if !store
        .is_session_active(&claims.jti)
        .map_err(|error| error.to_string())?
    {
        return Err("Session expired or revoked".to_string());
    }

    let user = store
        .get_user_by_id(&claims.sub)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "User account not found".to_string())?;

    Ok(Some(AuthPrincipal::User(UserPrincipal {
        user_id: user.id,
        provider: user.provider,
        provider_user_id: user.provider_user_id,
        role: user.role,
        login: user.login,
        name: user.name,
        session_id: claims.jti,
    })))
}

pub fn issue_token(
    state: &AppState,
    user: &AuthUserRecord,
    session: &AuthSessionRecord,
) -> Result<String, String> {
    let secret = signing_secret(state)
        .ok_or_else(|| "JWT signing secret is not configured".to_string())?;
    let issued_at = chrono::Utc::now();
    let expires_at = issued_at + chrono::Duration::seconds(jwt_ttl_seconds(state));
    let claims = SessionClaims {
        sub: user.id.clone(),
        provider: user.provider.clone(),
        provider_user_id: user.provider_user_id.clone(),
        role: user.role.clone(),
        login: user.login.clone(),
        name: user.name.clone(),
        jti: session.id.clone(),
        iss: jwt_issuer(state).to_string(),
        aud: jwt_audience(state).to_string(),
        iat: issued_at.timestamp().max(0) as usize,
        exp: expires_at.timestamp().max(0) as usize,
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|error| format!("Failed to sign session token: {error}"))
}

pub async fn fetch_github_profile(access_token: &str) -> Result<GitHubProfile, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))?;

    let response = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "openfang")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("GitHub profile request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("GitHub profile request returned {status}: {body}"));
    }

    let profile = response
        .json::<GitHubUserResponse>()
        .await
        .map_err(|error| format!("Failed to decode GitHub profile: {error}"))?;

    Ok(GitHubProfile {
        provider_user_id: profile.id.to_string(),
        login: profile.login,
        name: profile.name,
        email: profile.email,
        avatar_url: profile.avatar_url,
    })
}

fn decode_token(token: &str, state: &AppState) -> Result<SessionClaims, String> {
    let secret = signing_secret(state)
        .ok_or_else(|| "JWT signing secret is not configured".to_string())?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[jwt_issuer(state)]);
    validation.set_audience(&[jwt_audience(state)]);

    let claims = decode::<SessionClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|token_data| token_data.claims)
    .map_err(|error| format!("Invalid bearer token: {error}"))?;

    // H5: Reject tokens with an iat timestamp in the future — indicates clock
    // manipulation or token pre-generation attacks.
    let now = chrono::Utc::now().timestamp() as usize;
    if claims.iat > now.saturating_add(30) {
        return Err(
            "Token issued in the future — possible clock manipulation or replay attack"
                .to_string(),
        );
    }

    Ok(claims)
}

fn constant_time_eq(lhs: &str, rhs: &str) -> bool {
    use subtle::ConstantTimeEq;

    if lhs.len() != rhs.len() {
        return false;
    }

    lhs.as_bytes().ct_eq(rhs.as_bytes()).into()
}
