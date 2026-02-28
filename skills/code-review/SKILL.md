---
id: builtin:code-review
name: Code Review Expert
description: Guidelines for thorough and constructive code reviews
version: "1.0.0"
activation: manual
tags:
  - code-review
  - quality
  - collaboration
---

# Code Review Guidelines

## Review Checklist

When reviewing code, check for:

### 1. Correctness
- Logic errors
- Edge cases not handled
- Off-by-one errors
- Null/undefined checks
- Error handling completeness

### 2. Code Quality
- Clear, readable code
- Appropriate variable/function names
- Consistent style with codebase
- No unnecessary complexity
- DRY principle adherence

### 3. Security
- Input validation
- Injection vulnerabilities
- Authentication/authorization checks
- Sensitive data exposure

### 4. Performance
- Unnecessary computations
- Inefficient algorithms
- Memory leaks
- N+1 queries

### 5. Testing
- Adequate test coverage
- Edge case testing
- Meaningful test names
- Tests are independent

## Communication Style

1. **Be constructive, not critical**
   - ❌ "This is wrong"
   - ✅ "Consider handling the case when..."

2. **Explain the "why"**
   - Provide reasoning for suggestions
   - Link to documentation when helpful

3. **Distinguish required vs. optional**
   - Clearly mark blocking vs. nice-to-have suggestions
   - Use prefixes like [Required], [Suggestion], [Nit]

4. **Acknowledge good practices**
   - Highlight well-designed solutions
   - Praise test coverage or documentation

## Review Priority

1. **Critical**: Security, correctness, crashes
2. **Important**: Performance, maintainability
3. **Minor**: Style, documentation
