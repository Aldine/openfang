use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{request::Parts, Request},
};
use std::net::SocketAddr;

use crate::middleware::REQUEST_ID_HEADER;

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

#[derive(Clone, Debug, Default)]
pub struct RequestContext {
    pub route: String,
    pub method: String,
    pub request_id: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

impl RequestContext {
    pub fn from_request<B>(request: &Request<B>) -> Self {
        Self {
            route: request.uri().path().to_string(),
            method: request.method().as_str().to_string(),
            request_id: request
                .extensions()
                .get::<RequestId>()
                .map(|id| id.0.clone())
                .or_else(|| {
                    request
                        .headers()
                        .get(REQUEST_ID_HEADER)
                        .and_then(|value| value.to_str().ok())
                        .map(ToOwned::to_owned)
                }),
            ip: request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ci| ci.0.ip().to_string()),
            user_agent: request
                .headers()
                .get(axum::http::header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned),
        }
    }

    pub fn request_id(&self) -> Option<String> {
        self.request_id.clone()
    }
}

impl<S> FromRequestParts<S> for RequestContext
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            route: parts.uri.path().to_string(),
            method: parts.method.as_str().to_string(),
            request_id: parts.extensions.get::<RequestId>().map(|id| id.0.clone()).or_else(|| {
                parts
                    .headers
                    .get(REQUEST_ID_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .map(ToOwned::to_owned)
            }),
            ip: parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ci| ci.0.ip().to_string()),
            user_agent: parts
                .headers
                .get(axum::http::header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned),
        })
    }
}
