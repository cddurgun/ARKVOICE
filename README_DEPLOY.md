# Deploy to Railway

## 1. Create Railway Account
- Go to https://railway.app
- Sign up with GitHub

## 2. Deploy from GitHub

### Option A: Deploy via Railway Dashboard
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose this repository
4. Railway will auto-detect Python and deploy

### Option B: Deploy via Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## 3. Set Environment Variables

In Railway dashboard, go to your project → Variables → Add:

```
GROQ_API_KEY=your_groq_api_key_here
PERPLEXITY_API_KEY=your_perplexity_api_key_here
```

**Get your API keys from:**
- Groq: https://console.groq.com/keys
- Perplexity: https://www.perplexity.ai/settings/api

## 4. Deploy Settings

Railway will automatically:
- ✅ Install dependencies from `requirements.txt`
- ✅ Run the app using `Procfile`
- ✅ Assign a public URL
- ✅ Enable HTTPS

## 5. Access Your App

After deployment, Railway will give you a URL like:
```
https://your-app-name.up.railway.app
```

## Troubleshooting

If deployment fails:
1. Check build logs in Railway dashboard
2. Verify environment variables are set
3. Ensure all files are committed to git

## Cost

Railway Free Tier:
- $5 free credit per month
- ~500 hours of runtime
- Perfect for this app!
