# Lite OpenCode Skills

This directory contains built-in skills for Lite OpenCode.

## What are Skills?

Skills are specialized knowledge modules that enhance the AI's capabilities for specific tasks. They use a simple Markdown + YAML format that's easy to read and maintain.

## Built-in Skills

| Skill | ID | Description | Activation |
|-------|-----|-------------|------------|
| **Git Expert** | `builtin:git` | Git operations and commit conventions | Manual |
| **Code Review** | `builtin:code-review` | Code review guidelines | Manual |
| **TDD** | `builtin:tdd` | Test-driven development practices | Manual |
| **React Expert** | `builtin:react` | React development best practices | Auto (`.tsx`, `.jsx`) |
| **Node.js Expert** | `builtin:nodejs` | Node.js backend development | Auto (`server/`, `api/`) |
| **Documentation** | `builtin:documentation` | Writing docs and comments | Manual |

## Using Skills

### List Available Skills

```bash
/skills
```

### Activate a Skill

```bash
activate_skill id="builtin:git"
```

Or use the slash command:

```bash
/skill builtin:git
```

### View Skill Details

```bash
show_skill id="builtin:react"
```

To see resource files:

```bash
show_skill id="builtin:react" include_resources=true
```

### Deactivate a Skill

```bash
deactivate_skill id="builtin:git"
```

## Auto-Activation

Some skills automatically activate based on context:

- **React Expert**: Activates when editing `.tsx` or `.jsx` files
- **Node.js Expert**: Activates when working in `server/`, `api/`, or `backend/` directories

You can also trigger auto-activation with keywords in your message.

## Creating Custom Skills

### Quick Start

1. Create a directory for your skill:
   ```bash
   mkdir -p ~/.lite-opencode/skills/my-skill
   # or ./skills/my-skill for project-specific
   ```

2. Create `SKILL.md`:
   ```markdown
   ---
   id: my-skill
   name: My Skill
   description: What this skill does
   version: "1.0.0"
   activation: manual
   tags:
     - custom
   ---

   # My Skill

   Your guidance content here...
   ```

3. Restart Lite OpenCode - your skill will be auto-discovered!

### Full Template

See [`_template/SKILL.md`](./_template/SKILL.md) for a complete template with all options.

### Skill Format

```markdown
---
# YAML Frontmatter (Required)
id: unique-id
name: Display Name
description: Short description
version: "1.0.0"
activation: manual | auto | always
tags:
  - tag1
  - tag2

# Auto-activation triggers (only for activation: auto)
triggers:
  filePatterns:
    - "**/*.ext"
  keywords:
    - "keyword"

# Dependencies (optional)
dependencies:
  - other-skill-id

# Conflicts (optional)
conflicts:
  - conflicting-skill-id
---

# Markdown Content

Your skill content here...
```

## Skill Locations

Skills are discovered from (in order):

1. `./skills/` - Project-specific skills
2. `~/.lite-opencode/skills/` - User's global skills

## Tips

1. **Keep it focused**: Each skill should address one specific area
2. **Use examples**: Include code examples in your skill content
3. **Test activation**: If using `auto` activation, test the triggers work
4. **Version your skills**: Update the version when making changes
5. **Share skills**: Skills are just Markdown files - easy to share!

## Examples

### Project-Specific Skill

Create `./skills/my-project/SKILL.md`:

```markdown
---
id: my-project
name: My Project Guidelines
description: Project-specific coding standards
version: "1.0.0"
activation: auto
triggers:
  filePatterns:
    - "src/**/*.ts"
tags:
  - project-specific
---

# My Project Guidelines

## Architecture

We follow Clean Architecture with these layers:
- Domain
- Application
- Infrastructure

## Naming Conventions

- Use `PascalCase` for classes
- Use `camelCase` for functions
- Use `SCREAMING_SNAKE_CASE` for constants
```

### Framework-Specific Skill

```markdown
---
id: my-framework
name: MyFramework Expert
description: Best practices for MyFramework
description: "1.0.0"
activation: auto
triggers:
  filePatterns:
    - "**/*.myframework"
  keywords:
    - "myframework"
    - "mf"
tags:
  - framework
---

# MyFramework Development

## Component Structure

...
```

## Troubleshooting

### Skill not showing up

- Check the file is named `SKILL.md` (case-sensitive)
- Verify YAML frontmatter is valid
- Check the file is in a `skills/` directory
- Ensure the skill has all required fields: `id`, `name`, `description`, `version`, `activation`

### Auto-activation not working

- Verify `activation: auto` is set
- Check `triggers` section exists with valid `filePatterns` or `keywords`
- Test with `show_skill` to verify configuration

### Dependencies not loading

- Ensure dependency skill ID is correct
- Check dependency skill is registered before dependent skill
- Verify no circular dependencies

## More Information

- [Skills System Design](../docs/skills-system-design.md) - Technical documentation
- Development Guide - See `_template/` for examples
