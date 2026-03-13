use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct ApiErrorBody<T: Serialize> {
    pub success: bool,
    pub error: ApiErrorPayload<T>,
}

#[derive(Serialize)]
pub struct ApiErrorPayload<T: Serialize> {
    pub code: &'static str,
    pub message: String,
    pub details: Option<T>,
    pub request_id: Option<String>,
}

#[derive(Serialize)]
pub struct ApiSuccessBody<T: Serialize> {
    pub success: bool,
    pub data: T,
}

pub struct ApiError<T: Serialize = serde_json::Value> {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub details: Option<T>,
    pub request_id: Option<String>,
}

impl<T: Serialize> IntoResponse for ApiError<T> {
    fn into_response(self) -> Response {
        let body = ApiErrorBody {
            success: false,
            error: ApiErrorPayload {
                code: self.code,
                message: self.message,
                details: self.details,
                request_id: self.request_id,
            },
        };

        (self.status, Json(body)).into_response()
    }
}

impl<T: Serialize> ApiError<T> {
    pub fn with_details(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        details: Option<T>,
        request_id: Option<String>,
    ) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details,
            request_id,
        }
    }
}

impl ApiError<serde_json::Value> {
    pub fn unauthorized(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            message,
            None,
            request_id,
        )
    }

    pub fn forbidden(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            message,
            None,
            request_id,
        )
    }

    pub fn rate_limited(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            message,
            None,
            request_id,
        )
    }

    pub fn invalid_request(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::BAD_REQUEST,
            "INVALID_REQUEST",
            message,
            None,
            request_id,
        )
    }

    pub fn not_found(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            message,
            None,
            request_id,
        )
    }

    pub fn conflict(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::CONFLICT,
            "CONFLICT",
            message,
            None,
            request_id,
        )
    }

    pub fn internal(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            message,
            None,
            request_id,
        )
    }

    pub fn method_not_allowed(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::with_details(
            StatusCode::METHOD_NOT_ALLOWED,
            "METHOD_NOT_ALLOWED",
            message,
            None,
            request_id,
        )
    }

    pub fn webhook_signature_invalid(
        message: impl Into<String>,
        request_id: Option<String>,
    ) -> Self {
        Self::with_details(
            StatusCode::UNAUTHORIZED,
            "WEBHOOK_SIGNATURE_INVALID",
            message,
            None,
            request_id,
        )
    }

    pub fn schema_validation_failed(
        message: impl Into<String>,
        details: serde_json::Value,
        request_id: Option<String>,
    ) -> Self {
        Self::with_details(
            StatusCode::BAD_REQUEST,
            "SCHEMA_VALIDATION_FAILED",
            message,
            Some(details),
            request_id,
        )
    }
}

pub fn api_success<T: Serialize>(data: T) -> Json<ApiSuccessBody<T>> {
    Json(ApiSuccessBody {
        success: true,
        data,
    })
}

pub fn api_success_status<T: Serialize>(status: StatusCode, data: T) -> Response {
    (status, api_success(data)).into_response()
}
