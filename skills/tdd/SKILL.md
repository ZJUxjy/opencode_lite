---
id: builtin:tdd
name: Test-Driven Development
description: TDD workflow and testing best practices
version: "1.0.0"
activation: manual
tags:
  - testing
  - tdd
  - quality
---

# Test-Driven Development

## TDD Cycle (Red-Green-Refactor)

### 1. Red: Write a failing test
- Write the test first
- Run it and confirm it fails
- The test should fail for the right reason

### 2. Green: Make it pass
- Write the minimum code to pass the test
- Don't worry about elegance yet
- All tests should pass

### 3. Refactor: Clean up
- Improve the code structure
- Keep all tests passing
- No functional changes

## Test Design Principles

### AAA Pattern
```typescript
// Arrange: Set up the test
const input = { name: "test" };

// Act: Execute the code
const result = process(input);

// Assert: Verify the outcome
expect(result.valid).toBe(true);
```

### Test Independence
- Each test should run independently
- No shared state between tests
- Clean up after each test

### Descriptive Names
- Test names should describe behavior
- Format: `should [expected behavior] when [condition]`
- Example: `should return error when user not found`

## Testing Guidelines

1. **Test behavior, not implementation**
   - Focus on what the code does, not how
   - Refactoring shouldn't break tests

2. **One concept per test**
   - Don't test multiple things in one test
   - Makes failures easier to diagnose

3. **Edge cases matter**
   - Empty inputs
   - Null/undefined values
   - Boundary conditions
   - Maximum values

4. **Use appropriate test types**
   - Unit tests: Individual functions
   - Integration tests: Component interactions
   - E2E tests: Full workflows
