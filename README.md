# PressPulse

Media Monitoring & Multilingual Sentiment (Arabic/French/English) dashboard for PR teams.

## Stack
- Next.js 14 (App Router) + Tailwind (dark-by-default + glass UI)
- Supabase (Auth magic links + Postgres + RLS)
- Vercel AI SDK (OpenAI provider wired; easy to swap later)
- Hourly RSS polling via Vercel Cron (`/api/cron/fetch-rss`)

## 1) Supabase setup
1. Create a Supabase project.
2. In **SQL Editor**, run:
   - `supabase/schema.sql`
3. In **Authentication → URL Configuration**:
   - Set **Site URL** to your app URL (local: `http://localhost:3000`)
   - Add Redirect URL: `http://localhost:3000/auth/callback`

The schema includes a signup trigger that creates a **Demo Workspace** and seeds **3 demo articles** (AR positive, FR negative, EN neutral) for each new user.

## 2) Environment variables
Copy `.env.example` to `.env.local` and set:

- **Supabase**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (required for cron RSS ingestion)
- **AI (choose one)**
  - **Free local (recommended for 100% free)**: set `OLLAMA_BASE_URL` + `OLLAMA_MODEL` and run Ollama
  - **Cloud**: set `OPENAI_API_KEY`
- **App**
  - `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:3000`)

## 3) Run locally
```bash
cd presspulse
npm install --legacy-peer-deps
npm run dev
```

### 100% free sentiment (local Ollama)
1. Install Ollama and start it.
2. Pull a model:

```bash
ollama pull llama3.1:8b
ollama serve
```

3. In `.env.local`, set:
   - `OLLAMA_BASE_URL=http://localhost:11434/v1`
   - `OLLAMA_MODEL=llama3.1:8b`

Then:
- Visit `/login` and sign in with magic link
- Go to `/feed` to paste text/URL and analyze
- Add RSS sources; cron ingestion will analyze new items

## Key endpoints
- `POST /api/sentiment/analyze` → sentiment + confidence + reasoning (native + English)
- `GET/POST /api/articles` → list + manual “Analyze now”
- `GET/POST /api/sources` → RSS sources
- `GET /api/cron/fetch-rss` → hourly RSS polling + dedupe + analysis (service role)

## Notes
- UI language toggle is **🇬🇧 / 🇫🇷 / 🇲🇦** and mirrors layout for Arabic (`dir="rtl"`).
- Sentiment is always performed in the article’s **native language**; UI language does not change analysis.

