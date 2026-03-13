//! Cost-aware rate limiting using GCRA (Generic Cell Rate Algorithm).
//!
//! Each API operation has a token cost (e.g., health=1, spawn=50, message=30).
//! The GCRA algorithm allows 500 tokens per minute per IP address.

use axum::body::Body;
use axum::http::{Request, Response};
use axum::middleware::Next;
use axum::response::IntoResponse;
use governor::{clock::DefaultClock, state::keyed::DashMapStateStore, Quota, RateLimiter};
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;

use crate::api_response::ApiError;
use crate::request_context::RequestContext;
use crate::security::{log_security_event, SecurityLog};

pub fn operation_cost(method: &str, path: &str) -> NonZeroU32 {
    match (method, path) {
        (_, "/api/health") => NonZeroU32::new(1).unwrap(),
        ("GET", "/api/status") => NonZeroU32::new(1).unwrap(),
        ("GET", "/api/version") => NonZeroU32::new(1).unwrap(),
        ("GET", "/api/tools") => NonZeroU32::new(1).unwrap(),
        ("GET", "/api/agents") => NonZeroU32::new(2).unwrap(),
        ("GET", "/api/skills") => NonZeroU32::new(2).unwrap(),
        ("GET", "/api/peers") => NonZeroU32::new(2).unwrap(),
        ("GET", "/api/config") => NonZeroU32::new(2).unwrap(),
        ("GET", "/api/usage") => NonZeroU32::new(3).unwrap(),
        ("GET", p) if p.starts_with("/api/audit") => NonZeroU32::new(5).unwrap(),
        ("GET", p) if p.starts_with("/api/marketplace") => NonZeroU32::new(10).unwrap(),
        ("POST", "/api/agents") => NonZeroU32::new(50).unwrap(),
        ("POST", p) if p.contains("/message") => NonZeroU32::new(30).unwrap(),
        ("POST", p) if p.contains("/run") => NonZeroU32::new(100).unwrap(),
        ("POST", "/api/skills/install") => NonZeroU32::new(50).unwrap(),
        ("POST", "/api/skills/uninstall") => NonZeroU32::new(10).unwrap(),
        ("POST", "/api/migrate") => NonZeroU32::new(100).unwrap(),
        ("PUT", p) if p.contains("/update") => NonZeroU32::new(10).unwrap(),
        _ => NonZeroU32::new(5).unwrap(),
    }
}

pub type KeyedRateLimiter = RateLimiter<IpAddr, DashMapStateStore<IpAddr>, DefaultClock>;

/// Per-user rate limiter keyed on user_id (String).
/// Used for LLM-heavy endpoints to enforce per-account token budgets.
pub type UserRateLimiter = RateLimiter<String, DashMapStateStore<String>, DefaultClock>;

/// 500 tokens per minute per IP.
pub fn create_rate_limiter() -> Arc<KeyedRateLimiter> {
    Arc::new(RateLimiter::keyed(Quota::per_minute(
        NonZeroU32::new(500).unwrap(),
    )))
}

/// 100 LLM tokens per minute per user (for message/run endpoints).
///
/// M4 NOTE: Rate limit state is in-process memory — it resets on daemon restart.
/// Under a load balancer, each node has its own counter, so the effective
/// limit is `N * 100` across a cluster. Use Redis-backed state for true
/// distributed rate limiting in production.
pub fn create_user_rate_limiter() -> Arc<UserRateLimiter> {
    tracing::warn!(
        "Per-user rate limit state is ephemeral (in-memory). \
         Limits reset on daemon restart. For distributed deployments, \
         consider a shared backing store."
    );
    Arc::new(RateLimiter::keyed(Quota::per_minute(
        NonZeroU32::new(100).unwrap(),
    )))
}

/// GCRA rate limiting middleware.
///
/// Extracts the client IP from `ConnectInfo`, computes the cost for the
/// requested operation, and checks the GCRA limiter. Returns 429 if the
/// client has exhausted its token budget.
pub async fn gcra_rate_limit(
    axum::extract::State(limiter): axum::extract::State<Arc<KeyedRateLimiter>>,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let ctx = RequestContext::from_request(&request);
    let ip = request
        .extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
        .unwrap_or(IpAddr::from([127, 0, 0, 1]));

    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    let cost = operation_cost(&method, &path);

    match limiter.check_key_n(&ip, cost) {
        Ok(Ok(_)) => {}
        Ok(Err(_)) | Err(_) => {
            log_security_event(
                &SecurityLog::new("rate_limit.blocked", "warn", "denied", &ctx)
                    .actor_type("ip")
                    .reason(format!("token budget exhausted; cost={}", cost.get())),
            );

            let mut response =
                ApiError::rate_limited("Rate limit exceeded", ctx.request_id()).into_response();
            response.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("60"),
            );
            return response;
        }
    }

    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    #[test]
    fn test_costs() {
        assert_eq!(operation_cost("GET", "/api/health").get(), 1);
        assert_eq!(operation_cost("GET", "/api/tools").get(), 1);
        assert_eq!(operation_cost("POST", "/api/agents/1/message").get(), 30);
        assert_eq!(operation_cost("POST", "/api/agents").get(), 50);
        assert_eq!(operation_cost("POST", "/api/workflows/1/run").get(), 100);
        assert_eq!(operation_cost("GET", "/api/agents/1/session").get(), 5);
        assert_eq!(operation_cost("GET", "/api/skills").get(), 2);
        assert_eq!(operation_cost("GET", "/api/peers").get(), 2);
        assert_eq!(operation_cost("GET", "/api/audit/recent").get(), 5);
        assert_eq!(operation_cost("POST", "/api/skills/install").get(), 50);
        assert_eq!(operation_cost("POST", "/api/migrate").get(), 100);
    }

    #[test]
    fn test_limiter_rejects_same_ip_after_quota_exhaustion() {
        let limiter = create_rate_limiter();
        let ip = IpAddr::from([127, 0, 0, 1]);
        let cost = operation_cost("GET", "/api/agents");
        let mut rejected_at = None;

        for attempt in 1..=1024 {
            if matches!(limiter.check_key_n(&ip, cost), Ok(Err(_)) | Err(_)) {
                rejected_at = Some(attempt);
                break;
            }
        }

        assert!(
            rejected_at.is_some(),
            "expected limiter to reject repeated requests from the same IP"
        );
    }

    #[tokio::test]
    async fn test_gcra_rate_limit_middleware_returns_429() {
        let limiter = Arc::new(RateLimiter::keyed(Quota::per_minute(
            NonZeroU32::new(1).unwrap(),
        )));
        let app = axum::Router::new()
            .route("/api/health", axum::routing::get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(
                limiter,
                gcra_rate_limit,
            ));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let mut response = None;
        for _ in 0..32 {
            let candidate = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/health")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            if candidate.status() == StatusCode::TOO_MANY_REQUESTS {
                response = Some(candidate);
                break;
            }
        }

        let response = response.expect("expected rate limit middleware to return 429");
        assert_eq!(response.headers().get("retry-after").unwrap(), "60");

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["success"], false);
        assert_eq!(value["error"]["code"], "RATE_LIMITED");
        assert_eq!(value["error"]["message"], "Rate limit exceeded");
    }
}
