use crate::mapper::{map_profile, ProfileImportError};
use crate::markdown_sections::{parse_markdown_sections, ParsedMarkdownProfile};
use openfang_types::agent_profile::AgentProfile;
use std::fs;
use std::path::Path;

pub fn parse_profile_markdown(markdown: &str) -> ParsedMarkdownProfile {
    parse_markdown_sections(markdown)
}

pub fn import_profile_from_path(path: &Path) -> Result<AgentProfile, ProfileImportError> {
    let markdown = fs::read_to_string(path).map_err(|error| ProfileImportError {
        source_path: path.display().to_string(),
        errors: vec![crate::mapper::ProfileImportValidationError {
            section: "io".to_string(),
            message: error.to_string(),
        }],
    })?;
    let parsed = parse_profile_markdown(&markdown);
    map_profile(path, &parsed)
}
