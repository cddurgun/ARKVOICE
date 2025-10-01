# Deploy to Render.com

## Why Render.com?
- ✅ Edge TTS works (not blocked like Railway)
- ✅ Free tier available
- ✅ Easy deployment from GitHub
- ✅ Better voice quality

## Step 1: Create Render Account
1. Go to https://render.com
2. Click "Get Started for Free"
3. Sign up with GitHub

## Step 2: Deploy from GitHub
1. Click "New +" → "Web Service"
2. Connect your GitHub account
3. Select repository: **cddurgun/ARKVOICE**
4. Render will auto-detect Python

## Step 3: Configure Service
- **Name**: arkvoice
- **Environment**: Python 3
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- **Plan**: Free

## Step 4: Add Environment Variables
Click "Environment" → Add your API keys:
- `GROQ_API_KEY` - Get from https://console.groq.com/keys
- `PERPLEXITY_API_KEY` - Get from https://www.perplexity.ai/settings/api

## Step 5: Deploy
1. Click "Create Web Service"
2. Wait 3-5 minutes for build
3. Your app will be live at: `https://arkvoice.onrender.com`

## Features on Render
- ✅ Edge TTS (best free voice quality)
- ✅ Perplexity web search
- ✅ Groq Whisper + LLaMA
- ✅ Voice Activity Detection
- ✅ Search sound effects

## Free Tier Limits
- 750 hours/month
- Spins down after 15 min of inactivity
- First request after spin-down takes ~30 seconds
