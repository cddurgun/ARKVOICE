# Push to GitHub - Step by Step

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `groq-voice-ai`
3. Description: `Free Voice AI with Groq, Perplexity Search, and Edge TTS`
4. Make it **Public** (required for Railway free tier)
5. **DO NOT** initialize with README (we already have one)
6. Click **"Create repository"**

## Step 2: Push Your Code

GitHub will show you commands. Run these in your terminal:

```bash
cd /Users/turkischleopard/CascadeProjects/groq-voice-ai

# Add GitHub as remote
git remote add origin https://github.com/YOUR_USERNAME/groq-voice-ai.git

# Push to GitHub
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Step 3: Verify

Go to https://github.com/YOUR_USERNAME/groq-voice-ai
You should see all your files!

## Step 4: Deploy to Railway

Now follow the Railway deployment steps from README_DEPLOY.md

---

## Alternative: Use GitHub Desktop

If you prefer a GUI:
1. Download GitHub Desktop: https://desktop.github.com
2. File → Add Local Repository
3. Choose: /Users/turkischleopard/CascadeProjects/groq-voice-ai
4. Publish repository to GitHub
