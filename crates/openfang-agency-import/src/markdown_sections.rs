#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMarkdownProfile {
    pub title: String,
    pub top_level_sections: Vec<ParsedSection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSection {
    pub heading: String,
    pub body_lines: Vec<String>,
    pub children: Vec<ParsedSection>,
}

pub fn parse_markdown_sections(markdown: &str) -> ParsedMarkdownProfile {
    let mut title = String::new();
    let mut stack: Vec<(usize, ParsedSection)> = Vec::new();
    let mut top_level_sections: Vec<ParsedSection> = Vec::new();
    let mut in_frontmatter = false;
    let mut frontmatter_seen = false;
    let mut in_code_fence = false;

    for (index, raw_line) in markdown.lines().enumerate() {
        let line = raw_line.trim_end();
        if index == 0 && line.trim() == "---" {
            in_frontmatter = true;
            frontmatter_seen = true;
            continue;
        }
        if in_frontmatter {
            if line.trim() == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        if line.trim_start().starts_with("```") {
            in_code_fence = !in_code_fence;
            if let Some((_, current)) = stack.last_mut() {
                current.body_lines.push(line.to_string());
            }
            continue;
        }
        if !in_code_fence {
            if line.starts_with("# ") && title.is_empty() {
                title = line[2..].trim().to_string();
                continue;
            }
            if let Some((level, heading)) = parse_heading(line) {
                while stack.last().is_some_and(|(current_level, _)| *current_level >= level) {
                    attach_section(stack.pop().unwrap().1, &mut stack, &mut top_level_sections);
                }
                stack.push((level, ParsedSection {
                    heading,
                    body_lines: Vec::new(),
                    children: Vec::new(),
                }));
                continue;
            }
        }
        if let Some((_, current)) = stack.last_mut() {
            current.body_lines.push(line.to_string());
        }
    }

    let mut remaining_top_level_sections = Vec::new();
    while let Some((_, section)) = stack.pop() {
        if let Some((_, parent)) = stack.last_mut() {
            parent.children.push(section);
        } else {
            remaining_top_level_sections.push(section);
        }
    }
    remaining_top_level_sections.reverse();
    top_level_sections.extend(remaining_top_level_sections);

    if title.is_empty() && frontmatter_seen {
        if let Some(name) = markdown.lines().find_map(|line| line.trim().strip_prefix("name:")) {
            title = name.trim().to_string();
        }
    }

    ParsedMarkdownProfile {
        title,
        top_level_sections,
    }
}

fn attach_section(
    section: ParsedSection,
    stack: &mut [(usize, ParsedSection)],
    top_level_sections: &mut Vec<ParsedSection>,
) {
    if let Some((_, parent)) = stack.last_mut() {
        parent.children.push(section);
    } else {
        top_level_sections.push(section);
    }
}

fn parse_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(2..=3).contains(&hashes) {
        return None;
    }
    let heading = trimmed[hashes..].trim();
    if heading.is_empty() {
        return None;
    }
    Some((hashes, heading.to_string()))
}

#[cfg(test)]
mod tests {
    use super::parse_markdown_sections;

    #[test]
    fn parses_title_sections_and_code_blocks() {
        let parsed = parse_markdown_sections(
            "# Example Agent\n\n## Identity\n- **Role**: Builder\n\n## Deliverables\n### Template\n```markdown\n# Hello\n```\n",
        );

        assert_eq!(parsed.title, "Example Agent");
        assert_eq!(parsed.top_level_sections.len(), 2);
        assert_eq!(parsed.top_level_sections[1].children.len(), 1);
        assert!(parsed.top_level_sections[1].children[0]
            .body_lines
            .iter()
            .any(|line| line.contains("```markdown")));
    }
}
