---
# Skill Metadata (YAML Frontmatter)
# This section is required and must be valid YAML

# Unique identifier (required)
# Format: lowercase with hyphens, no spaces
id: my-skill

# Display name (required)
name: My Skill

# Short description (required)
# Include relevant keywords to help the LLM understand when to activate this skill
# Example: "Best practices for React development including hooks, components, and JSX patterns"
description: A clear description that helps LLM understand when to activate this skill. Include relevant keywords and use cases.

# Version (required)
# Follow semantic versioning
version: "1.0.0"

# Author (optional)
author: Your Name <email@example.com>

# Activation strategy (required)
# Options: auto | manual | always
# - auto: LLM can activate based on description relevance
# - manual: Only activated via activate_skill tool or /skill command
# - always: Always active when loaded
activation: manual

# Tags (optional)
# Used for categorization in the skills list
tags:
  - example
  - template

# Dependencies (optional)
# List of skill IDs that must be activated before this one
dependencies:
  - other-skill

# Conflicts (optional)
# List of skill IDs that cannot be active at the same time
conflicts:
  - conflicting-skill
---

# Skill Content (Markdown)
# This section contains the actual guidance that will be injected into the prompt

# My Skill

## Overview

Explain what this skill provides and when to use it.

## Guidelines

### Section 1

- Guideline 1
- Guideline 2
- Guideline 3

### Section 2

```typescript
// Example code
const example = () => {
  return "This is an example";
};
```

## Best Practices

1. **Do this**: Explanation
2. **Don't do that**: Explanation

## Resources

See the `resources/` directory for:
- Additional templates
- Example code
- Configuration schemas
