//! Discover and load agent templates from the agents directory.

use openfang_kernel::config::{agent_search_paths, load_agent_config};
use std::path::PathBuf;

/// A discovered agent template.
pub struct AgentTemplate {
    /// Template name (directory name).
    pub name: String,
    /// Description from the manifest.
    pub description: String,
    /// Raw TOML content.
    pub content: String,
}

/// Discover template directories in shared precedence order.
pub fn discover_template_dirs() -> Vec<PathBuf> {
    agent_search_paths()
}

/// Load all templates from discovered directories, falling back to bundled templates.
pub fn load_all_templates() -> Vec<AgentTemplate> {
    let mut templates = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    // First: load from filesystem (user-installed or dev repo)
    for dir in discover_template_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "custom" || !seen_names.insert(name.clone()) {
                    continue;
                }
                if let Ok(loaded) = load_agent_config(&path) {
                    templates.push(AgentTemplate {
                        name,
                        description: loaded.manifest.description,
                        content: loaded.manifest_toml,
                    });
                }
            }
        }
    }

    // Fallback: load bundled templates for any not found on disk
    for (name, content) in crate::bundled_agents::bundled_agents() {
        if seen_names.insert(name.to_string()) {
            let description = extract_description(content);
            templates.push(AgentTemplate {
                name: name.to_string(),
                description,
                content: content.to_string(),
            });
        }
    }

    templates.sort_by(|a, b| a.name.cmp(&b.name));
    templates
}

fn extract_description(toml_str: &str) -> String {
    toml::from_str::<openfang_types::agent::AgentManifest>(toml_str)
        .map(|manifest| manifest.description)
        .unwrap_or_default()
}

/// Format a template description as a hint for cliclack select items.
pub fn template_display_hint(t: &AgentTemplate) -> String {
    if t.description.is_empty() {
        String::new()
    } else if t.description.chars().count() > 60 {
        let truncated: String = t.description.chars().take(57).collect();
        format!("{truncated}...")
    } else {
        t.description.clone()
    }
}
