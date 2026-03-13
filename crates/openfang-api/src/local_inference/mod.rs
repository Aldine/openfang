mod model;
mod service;

pub use model::{
    LocalComparisonFixtureResult, LocalComparisonHarnessResponse,
    LocalComparisonHarnessSummary, LocalComparisonLatency, LocalComparisonSchema,
    LocalModelStatus, LocalPlannerRecommendationRequest,
    LocalPlannerRecommendationResponse, LocalPlannerSplitRequest,
    LocalPlannerSplitResponse, LocalPlannerTranslationRequest,
    LocalPlannerTranslationResponse, LocalStatusQuery,
};
pub(crate) use model::{
    build_recommendation_prompt, build_split_prompt, build_translation_prompt,
    map_recommendation_confidence, parse_recommendation_schema, parse_split_schema,
    parse_translation_schema, LocalOnlyOutcome, RecommendationSchema, SplitSchema,
    TranslationSchema, CONFIDENCE_GATE,
};
pub use service::{
    get_or_refresh_local_status, recommend_local_first, run_comparison_harness,
    split_local_first, translate_local_first,
};
pub(crate) use service::preferred_ollama_base_url;
