---
name: typescript-expert
description: "Advanced TypeScript expert with deep knowledge of type-level programming, performance optimization, and real-world problem solving based on current best practices."
license: MIT
metadata:
  author: community
  version: "1.0.0"
  source: sickn33/antigravity-awesome-skills
---

# TypeScript Expert

Advanced TypeScript expert with deep, practical knowledge of type-level programming, performance optimization, and real-world problem solving based on current best practices.

## When to Use

- TypeScript type errors and debugging
- Type-level programming challenges
- Performance optimization for TypeScript builds
- Migration from JavaScript to TypeScript
- Setting up TypeScript projects
- Monorepo TypeScript configuration
- Complex generic patterns

## Advanced Type System Expertise

### Type-Level Programming Patterns

**Branded Types for Domain Modeling**
```typescript
// Create nominal types to prevent primitive obsession
type Brand<K, T> = K & { __brand: T };
type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

// Prevents accidental mixing of domain primitives
function processOrder(orderId: OrderId, userId: UserId) { }
```

**Advanced Conditional Types**
```typescript
// Recursive type manipulation
type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

// Template literal type magic
type PropEventSource<Type> = {
  on<Key extends string & keyof Type>
    (eventName: `${Key}Changed`, callback: (newValue: Type[Key]) => void): void;
};
```

**Type Inference Techniques**
```typescript
// Use 'satisfies' for constraint validation (TS 5.0+)
const config = {
  api: "https://api.example.com",
  timeout: 5000
} satisfies Record<string, string | number>;

// Const assertions for maximum inference
const routes = ['/home', '/about', '/contact'] as const;
type Route = typeof routes[number]; // '/home' | '/about' | '/contact'
```

### Performance Optimization Strategies

**Type Checking Performance**
```bash
# Diagnose slow type checking
npx tsc --extendedDiagnostics --incremental false | grep -E "Check time|Files:|Lines:|Nodes:"

# Common fixes for "Type instantiation is excessively deep"
# 1. Replace type intersections with interfaces
# 2. Split large union types (>100 members)
# 3. Avoid circular generic constraints
# 4. Use type aliases to break recursion
```

**Build Performance Patterns**
- Enable `skipLibCheck: true` for library type checking only
- Use `incremental: true` with `.tsbuildinfo` cache
- Configure `include`/`exclude` precisely
- For monorepos: Use project references with `composite: true`

## Real-World Problem Resolution

### Complex Error Patterns

**"The inferred type of X cannot be named"**
- Cause: Missing type export or circular dependency
- Fix priority:
  1. Export the required type explicitly
  2. Use `ReturnType<typeof function>` helper
  3. Break circular dependencies with type-only imports

**Missing type declarations**
```typescript
// types/ambient.d.ts
declare module 'some-untyped-package' {
  const value: unknown;
  export default value;
}
```

**"Excessive stack depth comparing types"**
```typescript
// Bad: Infinite recursion
type InfiniteArray<T> = T | InfiniteArray<T>[];

// Good: Limited recursion
type NestedArray<T, D extends number = 5> =
  D extends 0 ? T : T | NestedArray<T, [-1, 0, 1, 2, 3, 4][D]>[];
```

**Module Resolution Mysteries**
- "Cannot find module" despite file existing:
  1. Check `moduleResolution` matches your bundler
  2. Verify `baseUrl` and `paths` alignment
  3. For monorepos: Ensure workspace protocol
  4. Try clearing cache: `rm -rf node_modules/.cache .tsbuildinfo`

## Migration Expertise

**JavaScript to TypeScript Migration**
```bash
# Incremental migration strategy
# 1. Enable allowJs and checkJs
# 2. Rename files gradually (.js → .ts)
# 3. Add types file by file
# 4. Enable strict mode features one by one
```

**Tool Migration Decisions**

| From | To | When | Migration Effort |
|------|-----|------|-----------------|
| ESLint + Prettier | Biome | Need speed, fewer rules | Low (1 day) |
| TSC for linting | Type-check only | 100+ files, faster feedback | Medium (2-3 days) |
| Lerna | Nx/Turborepo | Need caching, parallel builds | High (1 week) |
| CJS | ESM | Node 18+, modern tooling | High (varies) |

## Monorepo Management

**Nx vs Turborepo Decision**
- Choose **Turborepo** if: Simple structure, need speed, <20 packages
- Choose **Nx** if: Complex dependencies, need visualization, plugins required

**TypeScript Monorepo Configuration**
```json
// Root tsconfig.json
{
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/ui" },
    { "path": "./apps/web" }
  ],
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

## Current Best Practices

### Strict by Default
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### ESM-First Approach
- Set `"type": "module"` in package.json
- Use `.mts` for TypeScript ESM files if needed
- Configure `"moduleResolution": "bundler"` for modern tools
- Use dynamic imports for CJS: `const pkg = await import('cjs-package')`

## Code Review Checklist

### Type Safety
- [ ] No implicit `any` types (use `unknown` or proper types)
- [ ] Strict null checks enabled and properly handled
- [ ] Type assertions (`as`) justified and minimal
- [ ] Generic constraints properly defined
- [ ] Discriminated unions for error handling
- [ ] Return types explicitly declared for public APIs

### TypeScript Best Practices
- [ ] Prefer `interface` over `type` for object shapes
- [ ] Use const assertions for literal types
- [ ] Leverage type guards and predicates
- [ ] Avoid type gymnastics when simpler solution exists
- [ ] Template literal types used appropriately
- [ ] Branded types for domain primitives

### Performance Considerations
- [ ] Type complexity doesn't cause slow compilation
- [ ] No excessive type instantiation depth
- [ ] Avoid complex mapped types in hot paths
- [ ] Use `skipLibCheck: true` in tsconfig
- [ ] Project references configured for monorepos

## Quick Decision Trees

### "Which tool should I use?"
```
Type checking only? → tsc
Type checking + linting speed critical? → Biome
Type checking + comprehensive linting? → ESLint + typescript-eslint
Type testing? → Vitest expectTypeOf
Build tool? → <10 packages? Turborepo. Else? Nx
```

### "How do I fix this performance issue?"
```
Slow type checking? → skipLibCheck, incremental, project references
Slow builds? → Check bundler config, enable caching
Slow tests? → Vitest with threads, avoid type checking in tests
Slow language server? → Exclude node_modules, limit files in tsconfig
```
