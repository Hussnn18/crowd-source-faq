# FAQ Portal

Full-stack FAQ portal with semantic vector search, Redis caching, and community expert layer.

## Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Express, TypeScript, MongoDB Atlas (vector search)
- **Embeddings**: @xenova/transformers (768-dim, Xenova/multi-qa-mpnet-base-dot-v1)
- **Cache**: Upstash Redis (semantic cache across serverless instances)
- **Error tracking**: Sentry

## Setup

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start locally
./run.sh
```

## Backend Scripts

```bash
cd backend

npm run seed          # seed FAQs from faqs.json
npm run seed:posts    # seed community posts
npm run migrate       # create MongoDB indexes
npm run backfill:embeddings  # regenerate all embeddings
npm test             # run tests
```

## Environment Variables

Copy `.env.example` to `.env` in `backend/` and fill in:

```
MONGODB_URI       # MongoDB Atlas connection string
JWT_SECRET         # random string
CLIENT_URL        # frontend URL (for CORS)
PORT              # default 6767
REDIS_URL         # Upstash Redis URL (optional)
REDIS_TOKEN       # Upstash Redis token (optional)
SENTRY_DSN         # Sentry DSN (optional)
```

## Deploy

```bash
# Backend
cd backend && npx vercel --prod

# Frontend
cd frontend && VITE_API_URL=https://your-backend-url/api npx vercel --prod
```

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/health | health check |
| GET | /api/faq | list FAQs |
| POST | /api/faq/search | semantic search |
| GET | /api/search/suggest?q= | search suggestions |
| GET | /api/search/trending | top trending queries |
| POST | /api/warm | preload embedding model |
| GET | /api/community | community posts |
| POST | /api/community | create post |
| POST | /api/community/:id/resolve | resolve a post |
| POST | /api/community/:id/request-expert | request expert help |
| PATCH | /api/faq/:id/feedback | thumbs up/down |
| GET | /api/notifications | get notifications |
| PATCH | /api/notifications/settings | update notification prefs |

## Architecture

- Vector search via MongoDB Atlas $vectorSearch (768-dim cosine)
- RRF fusion combines vector + text search results
- Redis cache: results cached by normalized query hash, 1hr TTL
- Expert layer: moderators/admins can mark answers as expert-verified
- Notification system for expert help requests
- Search analytics: failed-query tracking, trending queries
- Structured logging with request IDs
