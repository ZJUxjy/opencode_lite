---
name: nodejs-backend-patterns
description: "Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handling, authentication, database integration, and API design best practices."
license: MIT
metadata:
  author: community
  version: "1.0.0"
  source: sickn33/antigravity-awesome-skills
---

# Node.js Backend Patterns

Comprehensive guidance for building scalable, maintainable, and production-ready Node.js backend applications with modern frameworks, architectural patterns, and best practices.

## When to Use

- Building REST APIs or GraphQL servers
- Creating microservices with Node.js
- Implementing authentication and authorization
- Designing scalable backend architectures
- Setting up middleware and error handling
- Integrating databases (SQL and NoSQL)
- Building real-time applications with WebSockets
- Implementing background job processing

## Core Patterns

### 1. Project Structure

```
src/
├── controllers/     # Request handlers
├── services/        # Business logic
├── repositories/    # Data access layer
├── models/          # Domain models
├── middleware/      # Custom middleware
├── utils/           # Helper functions
├── config/          # Configuration
└── types/           # TypeScript types
```

### 2. Middleware Patterns

```typescript
// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Authentication middleware
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
```

### 3. Error Handling

```typescript
// Custom error class
class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
  }
}

// Async handler wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
```

### 4. Dependency Injection

```typescript
// Service with dependencies
class UserService {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService
  ) {}

  async createUser(data: CreateUserDTO): Promise<User> {
    const user = await this.userRepo.create(data)
    await this.emailService.sendWelcome(user.email)
    return user
  }
}
```

### 5. Repository Pattern

```typescript
interface UserRepository {
  findById(id: string): Promise<User | null>
  findAll(): Promise<User[]>
  create(data: CreateUserDTO): Promise<User>
  update(id: string, data: UpdateUserDTO): Promise<User>
  delete(id: string): Promise<void>
}

class SupabaseUserRepository implements UserRepository {
  constructor(private supabase: SupabaseClient) {}

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return null
    return data
  }
}
```

### 6. Input Validation

```typescript
import { z } from 'zod'

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100)
})

// Validation middleware
const validate = (schema: z.Schema) => (req: Request, res: Response, next: NextFunction) => {
  try {
    req.body = schema.parse(req.body)
    next()
  } catch (error) {
    res.status(400).json({ error: 'Validation failed', details: error })
  }
}
```

### 7. API Response Format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    page: number
    limit: number
    total: number
  }
}

// Success response
res.json({ success: true, data: users })

// Error response
res.status(400).json({ success: false, error: 'Invalid input' })
```

### 8. Environment Configuration

```typescript
// config/index.ts
import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().transform(Number).default('3000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32)
})

export const config = ConfigSchema.parse(process.env)
```

## Best Practices

1. **Separation of Concerns**: Keep controllers thin, business logic in services
2. **Dependency Injection**: Use DI for testability and flexibility
3. **Error Handling**: Centralize error handling, use custom error classes
4. **Validation**: Validate all input at API boundaries
5. **Logging**: Use structured logging (pino, winston)
6. **Rate Limiting**: Protect endpoints from abuse
7. **CORS**: Configure CORS properly for security
8. **Helmet**: Use helmet middleware for security headers
9. **Compression**: Enable gzip compression for responses
10. **Health Checks**: Implement `/health` endpoint for monitoring

## Performance Tips

- Use connection pooling for databases
- Implement caching (Redis) for frequently accessed data
- Use streaming for large file uploads/downloads
- Implement request pagination for list endpoints
- Use worker threads for CPU-intensive tasks
- Enable keep-alive for HTTP connections
