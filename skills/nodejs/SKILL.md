---
id: builtin:nodejs
name: Node.js Expert
description: Best practices for Node.js backend development including Express, Fastify, API design, middleware, error handling, security, and testing. Auto-activates when working on server-side code, APIs, or backend services.
version: "1.0.0"
activation: auto
tags:
  - nodejs
  - backend
  - api
  - server
---

# Node.js Backend Development Guidelines

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Request handlers
├── middleware/      # Express/Fastify middleware
├── models/          # Data models
├── routes/          # Route definitions
├── services/        # Business logic
├── utils/           # Utilities
└── app.ts           # Application entry
```

## Error Handling

### Async Error Handling
```typescript
// ✅ Good: Use express-async-errors or wrap in try-catch
app.get('/users', async (req, res, next) => {
  try {
    const users = await UserService.findAll();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

// ✅ Better: Use wrapper function
const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/users', asyncHandler(async (req, res) => {
  const users = await UserService.findAll();
  res.json(users);
}));
```

### Error Classes
```typescript
// Custom error classes for different scenarios
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`);
  }
}
```

## API Design

### RESTful Principles
- Use HTTP methods correctly: GET, POST, PUT, PATCH, DELETE
- Use plural nouns for resources: `/users`, `/orders`
- Nest sub-resources: `/users/:id/orders`
- Use query params for filtering: `/users?active=true`

### Response Format
```typescript
// ✅ Consistent response structure
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

// Success response
{
  "success": true,
  "data": { "id": 1, "name": "John" }
}

// Error response
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required"
  }
}
```

## Security

### Input Validation
```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional()
});

app.post('/users', (req, res, next) => {
  const result = createUserSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: result.error.errors[0].message
      }
    });
  }

  // Use result.data (typed!)
});
```

### Security Headers
```typescript
import helmet from 'helmet';

app.use(helmet());
```

## Environment Configuration

```typescript
// config/index.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string()
});

const env = envSchema.parse(process.env);

export default env;
```

## Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Usage
logger.info('User created', { userId: 123 });
logger.error('Database connection failed', { error });
```

## Testing

```typescript
// ✅ Test business logic separately from HTTP layer
import request from 'supertest';

describe('User API', () => {
  it('should create a user', async () => {
    const response = await request(app)
      .post('/users')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe('test@example.com');
  });
});
```
