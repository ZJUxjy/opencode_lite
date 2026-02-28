---
id: builtin:git
name: Git Expert
description: Best practices for Git operations and commit message conventions
version: "1.0.0"
activation: manual
tags:
  - git
  - version-control
  - collaboration
---

# Git Operations Guidelines

## Commit Message Conventions

Follow these rules when making git commits:

1. **Use present tense imperative mood**
   - ✅ "Add feature" not "Added feature"
   - ✅ "Fix bug" not "Fixed bug"

2. **Keep the first line under 72 characters**
   - This ensures readability in git log --oneline

3. **Structure commits logically**
   - One logical change per commit
   - Split large changes into multiple commits

4. **Include Co-Authored-By for AI assistance**
   - Add "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" when appropriate

## Safety Rules

1. **Never use --force on main/master branch**
   - Warn user if they request force push to primary branch
   - Suggest force-with-lease as safer alternative

2. **Preserve history**
   - Prefer creating new commits over amending published commits
   - Only amend if explicitly requested

3. **Check before destructive operations**
   - Confirm before: reset --hard, clean -f, branch -D
   - Consider context and user intent

## Workflow Guidelines

1. **Before committing:**
   - Run git status to see changes
   - Run git diff to review modifications
   - Stage specific files rather than using git add -A

2. **Commit process:**
   - Write clear, descriptive messages
   - Follow the repository's commit message style
   - Include relevant issue numbers if applicable
