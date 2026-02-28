---
id: builtin:documentation
name: Documentation Writer
description: Guidelines for writing clear and maintainable documentation
version: "1.0.0"
activation: manual
tags:
  - documentation
  - writing
  - communication
---

# Documentation Writing Guidelines

## Code Comments

### When to Comment
- **Why**, not **what** - Code should be self-explanatory for what it does
- Complex business logic or algorithms
- Workarounds or temporary fixes
- Non-obvious side effects

```typescript
// ✅ Good: Explains WHY
// Retry with exponential backoff to handle transient network errors
// See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
async function fetchWithRetry(url: string, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url);
    } catch (error) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await sleep(delay);
    }
  }
}

// ❌ Bad: States the obvious
// Increment counter by 1
counter++;
```

### JSDoc / TSDoc
```typescript
/**
 * Calculates the discounted price for a product.
 *
 * @param price - Original price in cents
 * @param discountPercent - Discount percentage (0-100)
 * @returns Discounted price in cents
 * @throws {Error} When discountPercent is not between 0 and 100
 *
 * @example
 * ```typescript
 * const price = calculateDiscount(1000, 20); // 800
 * ```
 */
function calculateDiscount(price: number, discountPercent: number): number {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100');
  }
  return Math.round(price * (1 - discountPercent / 100));
}
```

## README Files

### Structure
```markdown
# Project Name

> One-line description of what this project does.

## Features

- Key feature 1
- Key feature 2
- Key feature 3

## Installation

```bash
npm install
```

## Usage

```typescript
import { myLibrary } from 'my-library';

const result = myLibrary.doSomething();
```

## API Reference

See [API.md](./docs/API.md) for detailed documentation.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
```

## Commit Messages

### Format
```
type(scope): subject

body (optional)

footer (optional)
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Code style (formatting, semicolons)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **test**: Adding or updating tests
- **chore**: Build process or auxiliary tool changes

### Examples
```
feat(auth): add JWT token refresh

Implement automatic token refresh when access token expires.
Includes tests for token rotation.

Closes #123
```

```
fix(api): handle null response from database

Add null check before accessing user properties.
Prevents 500 error when user record is missing.
```

## Architecture Decision Records (ADRs)

Create ADRs for significant technical decisions:

```markdown
# ADR 001: Use PostgreSQL over MongoDB

## Status
Accepted

## Context
We need to choose a database for our user management system.

## Decision
We will use PostgreSQL.

## Consequences

### Positive
- ACID transactions for data consistency
- Rich querying capabilities
- Team has existing expertise

### Negative
- More complex setup than document stores
- Schema migrations required
```

## Inline Documentation Tips

1. **Keep it DRY** - Don't repeat code in comments
2. **Stay current** - Update comments when code changes
3. **Be concise** - Short, clear sentences
4. **Use examples** - Show, don't just tell
5. **Document exceptions** - What can go wrong?

## Documentation Review Checklist

- [ ] Accurate and up-to-date
- [ ] Covers all public APIs
- [ ] Includes examples
- [ ] Explains error cases
- [ ] Links to related docs
- [ ] No typos or grammar issues
