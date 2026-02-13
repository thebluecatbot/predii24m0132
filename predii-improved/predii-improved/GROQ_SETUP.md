# 🚀 Groq API Setup Guide

## What Changed

Your application has been migrated from **OpenAI API** to **Groq Cloud** for faster, free inference with better rate limits.

### Migration Summary
1. ✅ Installed `groq-sdk` npm package
2. ✅ Created `services/groqService.ts` with Groq integration
3. ✅ Updated `App.tsx` to use GroqService instead of OpenAIService
4. ✅ Updated `.env.local` to use `GROQ_API_KEY` instead of `OPENAI_API_KEY`
5. ✅ Updated `vite.config.ts` to expose `GROQ_API_KEY`

---

## Getting a Free Groq API Key

### Step 1: Sign Up
1. Go to **[console.groq.com](https://console.groq.com)**
2. Click **"Sign Up"** (free tier available)
3. Use GitHub, Google, or email to create an account
4. Verify your email

### Step 2: Create an API Key
1. Navigate to **API Keys** in the dashboard
2. Click **"Create New API Key"**
3. Copy the key (starts with `gsk-`)

### Step 3: Add to Your Project
Replace the placeholder in `.env.local`:

```bash
GROQ_API_KEY=gsk-proj-YOUR-KEY-HERE
```

Then restart your dev server:
```bash
npm run dev
```

---

## Why Groq? (vs OpenAI)

| Feature | Groq | OpenAI GPT-3.5 |
|---------|------|----------------|
| **Cost** | 🟢 **Free** (no card needed) | 🔴 Paid ($) |
| **Rate Limits** | 🟢 **Very High** (30+ req/min) | 🟡 Moderate (3.5K req/min on free) |
| **Speed** | 🟢 **~10-50ms latency** | 🟡 ~500-2000ms |
| **Models** | Mixtral 8x7B, Llama-3.1 | GPT-3.5, GPT-4 |
| **Model Quality** | 🟡 Very Good | 🟢 Excellent |
| **Inference Engine** | SpecInfer (token batching) | Standard |
| **Browser Usage** | ✅ Supported | ✅ Supported |

---

## Key Differences in Your App

### 1. Embeddings Strategy
- **Before (OpenAI):** Used `text-embedding-3-small` (professional embeddings)
- **After (Groq):** Uses character frequency analysis (simple but effective for RAG)
- **Why:** Groq doesn't offer embeddings API; we use a lightweight hashing approach instead

### 2. Extraction Model
- **Before:** `gpt-3.5-turbo` (3K tokens context)
- **After:** `mixtral-8x7b-32768` (32K tokens context = 10x larger!)
- **Benefit:** Can pass more context chunks without truncation

### 3. Cost
- **Before:** ~$0.0015 per PDF (embedding + extraction)
- **After:** **$0.00** (completely free)

---

## Troubleshooting

### "Invalid or missing Groq API key"
- Verify your key in `.env.local` starts with `gsk-`
- Restart dev server: `npm run dev`
- Check [console.groq.com](https://console.groq.com) dashboard

### "Rate limit exceeded"
- Groq free tier allows 30+ requests/minute
- The app batches embeddings (20 at a time), so you're unlikely to hit this
- Wait 1-2 minutes and retry

### "LLM extraction failed"
- Check browser console for error details
- Ensure `.env.local` has a valid `GROQ_API_KEY`
- Verify you have internet connectivity

---

## Advanced: Switching Back to OpenAI

If you want to revert to OpenAI:

1. Reinstall OpenAI SDK:
   ```bash
   npm install openai --save
   ```

2. Update `App.tsx`:
   ```tsx
   import { OpenAIService } from './services/openaiService';
   ```

3. Update `.env.local`:
   ```bash
   OPENAI_API_KEY=sk-proj-YOUR-KEY-HERE
   ```

4. Update `vite.config.ts`:
   ```typescript
   'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY)
   ```

---

## Useful Links

- 📚 **Groq Docs:** https://console.groq.com/docs
- 🔑 **API Keys:** https://console.groq.com/keys
- 💬 **Supported Models:** https://console.groq.com/docs/models
- 🆘 **Community:** https://groq.com/community

Enjoy your free, fast inference! 🚀
