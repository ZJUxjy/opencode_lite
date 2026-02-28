---
id: builtin:react
name: React Expert
description: Best practices for React development including hooks, performance, and patterns
version: "1.0.0"
activation: auto
triggers:
  filePatterns:
    - "**/*.jsx"
    - "**/*.tsx"
    - "**/components/**"
  keywords:
    - "react"
    - "component"
    - "hook"
    - "jsx"
    - "tsx"
tags:
  - react
  - frontend
  - javascript
  - typescript
---

# React Development Guidelines

## Component Design

### Function Components (Preferred)
```typescript
// ✅ Good: Function component with hooks
interface Props {
  title: string;
  onClick?: () => void;
}

export function Button({ title, onClick }: Props) {
  const [count, setCount] = useState(0);

  return (
    <button onClick={onClick}>
      {title} ({count})
    </button>
  );
}
```

### Props Naming
- Use descriptive names
- Use `onEvent` pattern for callbacks: `onClick`, `onSubmit`
- Use boolean props with `is`/`has` prefix: `isLoading`, `hasError`

## Hooks Best Practices

### useEffect Dependencies
```typescript
// ✅ Good: All dependencies included
useEffect(() => {
  fetchData(userId);
}, [userId]);

// ❌ Bad: Missing dependency
useEffect(() => {
  fetchData(userId);
}, []); // userId missing!
```

### Custom Hooks
- Prefix with `use`: `useAuth`, `useLocalStorage`
- Keep focused on single concern
- Return array or object for destructuring

```typescript
// ✅ Good: Clear interface
function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initial;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}
```

## Performance Optimization

### Memoization
```typescript
// ✅ Memoize expensive computations
const filteredList = useMemo(() => {
  return items.filter(item => item.active);
}, [items]);

// ✅ Memoize callbacks passed to children
const handleClick = useCallback(() => {
  onItemSelect(id);
}, [id, onItemSelect]);

// ✅ Memoize components
const MemoizedList = memo(List);
```

### When NOT to Memoize
- Simple computations
- Components that re-render frequently anyway
- Premature optimization - measure first!

## State Management

### Lifting State Up
Lift state to the closest common ancestor when multiple components need the same data.

### useReducer for Complex State
```typescript
// ✅ Good: useReducer for complex state logic
type Action =
  | { type: 'increment' }
  | { type: 'decrement' }
  | { type: 'reset' };

function reducer(state: number, action: Action): number {
  switch (action.type) {
    case 'increment': return state + 1;
    case 'decrement': return state - 1;
    case 'reset': return 0;
    default: return state;
  }
}
```

## Error Handling

### Error Boundaries
```typescript
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <FallbackUI />;
    }
    return this.props.children;
  }
}
```

## Accessibility

- Use semantic HTML: `<button>`, `<nav>`, `<main>`
- Include `aria-label` for icon-only buttons
- Ensure keyboard navigation works
- Use `useId` for unique IDs (React 18+)
