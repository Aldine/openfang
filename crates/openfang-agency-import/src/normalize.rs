pub(crate) fn normalize_heading(heading: &str) -> String {
    heading
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || ch.is_whitespace() || *ch == '&' || *ch == '-')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_ascii_lowercase()
}

pub(crate) fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if ch == ' ' || ch == '-' || ch == '_' {
            Some('-')
        } else {
            None
        };

        if let Some(next) = next {
            if next == '-' {
                if !last_dash && !slug.is_empty() {
                    slug.push(next);
                }
                last_dash = true;
            } else {
                slug.push(next);
                last_dash = false;
            }
        }
    }
    slug.trim_matches('-').to_string()
}

pub(crate) fn clean_line(line: &str) -> String {
    line.trim().trim_start_matches('-').trim().to_string()
}
