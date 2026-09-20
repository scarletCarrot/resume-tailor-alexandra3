# Resume Tailor

Web app that scrapes job links, extracts structured JD fields via OpenRouter (DeepSeek V4 Flash by default), and generates ATS-oriented resumes + cover letters as DOCX/PDF packages.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env and add your keys:

```bash
copy .env.example .env.local
```

Set `OPENROUTER_API_KEY` from [openrouter.ai/keys](https://openrouter.ai/keys).  
Default model is `deepseek/deepseek-v4-flash` (override with `OPENROUTER_MODEL`).

### Optional: company duplicate detection (Upstash Redis)

Before generating a package, the app checks whether that **company** (any role) was already tailored in the last 14 days. On a hit, generation is skipped and the UI shows an amber duplicate alert — no override.

Create a free Redis database at [Upstash](https://console.upstash.com) (or link Upstash from the Vercel project Storage tab), then set:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If these are unset or Redis errors, detection is skipped and generation proceeds normally (fails open). Retention is Redis TTL (~14 days); no cron job.

3. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Flow

1. Profile is fixed in code (`src/lib/profile.ts`) for Karina Elizabeth Garcia Lozana
2. Paste job URLs (one per line)
3. The app scrapes each posting in parallel, extracts the JD, and writes a tailored resume + cover letter
4. Same company within 14 days → skip generate + alert (role/title does not matter)

## Output

For each job link (in order):

```
output/
  Company_Name/
    jd.txt
    extracted_jd.txt
    Resume-Karina.docx
    Resume-Karina.pdf
    Coverletter-Karina.docx
    Coverletter-Karina.txt
  Clara-Software Engineer.zip
    ...
```

Each completed job shows an ATS score (/100) in the UI.
Document files use `Resume-{FirstName}` / `Coverletter-{FirstName}`.
Zip files are named `{Company}-{Role}.zip`.
Download links appear after processing.
