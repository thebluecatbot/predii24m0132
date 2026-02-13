# OpenAI Integration Guide

## What Changed

Your application has been migrated from **Google Gemini API** to **OpenAI API** (GPT-3.5-Turbo).

### Changes Made:
1. ✅ Installed `openai` package (npm install openai)
2. ✅ Created `services/openaiService.ts` with OpenAI implementation
3. ✅ Updated `App.tsx` to use OpenAI instead of Gemini
4. ✅ Updated `.env.local` to use `OPENAI_API_KEY` instead of `GEMINI_API_KEY`

## Models Used

| Task | Model | Benefit |
|------|-------|---------|
| **Text Extraction** | gpt-3.5-turbo | Cost-effective, fast, excellent JSON output |
| **Embeddings** | text-embedding-3-small | Small, fast embeddings (1536-dim) |

## Setup Instructions

### 1. Get an OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Sign up or log in to your OpenAI account
3. Create a new API key
4. **Important**: Copy the key immediately (you won't see it again)

### 2. Update Your `.env.local`

Edit `.env.local` in the project root:

```bash
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

Replace `sk-proj-your-actual-key-here` with your actual OpenAI API key.

### 3. Restart the Dev Server

```bash
# If already running, the HMR should auto-reload
# If not, stop and restart:
npm run dev
```

## Cost Comparison

### OpenAI (Current)
- **gpt-3.5-turbo**: ~$0.0005 per 1K input tokens, $0.0015 per 1K output tokens
- **text-embedding-3-small**: $0.02 per 1M tokens
- **Estimated cost per full manual processing**: $0.01-0.05

### Google Gemini (Previous)
- **Free tier**: 15,000 requests/day (now exhausted)
- **Paid tier**: Significantly more expensive than gpt-3.5-turbo

## Usage Tips

1. **First time?** Run a simple query like "Torque for wheel lug nuts" on a short PDF to test
2. **Monitor costs**: Check https://platform.openai.com/account/billing/overview
3. **Set usage limits**: Set hard limits in your OpenAI account to prevent surprise bills
4. **Batch processing**: The embeddings are batched efficiently for cost optimization

## Troubleshooting

### "Invalid or missing OpenAI API key"
- Check your `.env.local` file has the correct key
- Make sure there are no extra spaces or quotes around the key
- Verify the key is active in your OpenAI account

### "Rate limit exceeded"
- OpenAI has rate limits on free accounts (~3 requests/min)
- Upgrade to a paid account for higher limits
- Add small delays between requests if needed

### Slow responses
- gpt-3.5-turbo is faster than Gemini 2.0 Flash
- If still slow, check your internet connection
- OpenAI API response times are typically <5 seconds

## Next Steps

1. ✅ Update `.env.local` with your OpenAI API key
2. ✅ Restart the dev server
3. ✅ Upload a PDF and test!
4. ✅ Monitor costs on https://platform.openai.com/account/billing/overview

---

**Questions?** See OpenAI documentation: https://platform.openai.com/docs/
