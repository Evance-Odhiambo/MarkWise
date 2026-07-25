# MarkWise Deployment Guide

## Current Setup: Local Development with ngrok

MarkWise is now configured for local development with **ngrok** for external network access, replacing the previous Vercel deployment.

## Quick Start

### 1. Install ngrok

**Using Chocolatey (Recommended for Windows):**
```powershell
choco install ngrok
```

**Manual Installation:**
1. Download from https://ngrok.com/download
2. Extract and add to your PATH

### 2. Configure ngrok

```powershell
# Sign up at https://ngrok.com and get your authtoken
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

### 3. Start the System

**Option A: Using the Startup Script (Easiest)**
```powershell
# Run from project root
.\start-ngrok.ps1
```

**Option B: Manual Start**

Terminal 1 - Start the web server:
```powershell
cd apps\web
npm run dev
```

Terminal 2 - Start ngrok:
```powershell
ngrok http 3000
```

### 4. Copy the Public URL

ngrok will display:
```
Forwarding    https://abc123.ngrok.io -> http://localhost:3000
```

Copy the HTTPS URL and share it with users on other networks.

## Configuration After Starting ngrok

### Update Web App Environment Variables

Edit `apps/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=https://your-ngrok-url.ngrok.io
NEXTAUTH_URL=https://your-ngrok-url.ngrok.io
```

Restart your Next.js server after updating.

### Update Mobile App API Base URL

Find your API configuration file (likely `apps/mobile/src/utils/api.js` or similar) and update:

```javascript
const baseUrl = 'https://your-ngrok-url.ngrok.io';
```

Rebuild and restart your mobile app.

## Architecture

```
┌─────────────────┐
│  Mobile Users   │
│  (Any Network)  │
└────────┬────────┘
         │
         │ HTTPS
         ▼
┌─────────────────┐
│  ngrok Cloud    │
│  (Public URL)   │
└────────┬────────┘
         │
         │ Tunnel
         ▼
┌─────────────────┐
│  Your Computer  │
│  localhost:3000 │
│  Next.js Server │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Supabase DB    │
│  (Cloud)        │
└─────────────────┘
```

## Important Notes

### ngrok Free Tier Limitations
- URL changes on each restart
- 40 connections/minute
- 8-hour session timeout
- Random subdomain

### Security Considerations
- Always use HTTPS URLs (provided by ngrok)
- Keep authentication enabled on all endpoints
- Monitor traffic via http://localhost:4040
- Don't share ngrok URLs publicly if not needed

### Database Access
Ensure your Supabase connection string is correctly configured in:
- `apps/web/.env.local`
- Database connection is cloud-based, so it works from any network

## Monitoring

While ngrok is running, access the web interface:
```
http://localhost:4040
```

This shows:
- All incoming requests
- Request/response details
- Replay capabilities for testing

## Troubleshooting

### "ngrok not found"
- Install via `choco install ngrok`
- Or add ngrok.exe to your PATH

### "Port 3000 already in use"
- Stop any running Next.js servers
- Check: `Get-Process -Name node`
- Kill if needed: `Stop-Process -Name node`

### "Tunnel not working"
- Verify authtoken: `ngrok config check`
- Check if Next.js is running on port 3000
- Visit http://localhost:3000 to confirm

### Mobile app can't connect
- Update the base URL in mobile app code
- Ensure you're using the HTTPS ngrok URL
- Rebuild the mobile app after changing the URL
- Check if the ngrok tunnel is still active

### Database connection issues
- Verify `.env.local` has correct Supabase credentials
- Check if Supabase project is accessible
- Ensure connection string allows connections from any IP

## Production Deployment Alternatives

For permanent hosting (recommended for production):

### Cloud Platforms
- **Railway:** https://railway.app (Easy, auto-deploy from GitHub)
- **Render:** https://render.com (Free tier available)
- **DigitalOcean:** App Platform or Droplet
- **AWS:** EC2 or Elastic Beanstalk
- **Azure:** App Service

### Self-Hosted Options
- VPS (Virtual Private Server) from providers like:
  - DigitalOcean
  - Linode
  - Vultr
- Docker container deployment
- Kubernetes cluster

## Migration from Vercel

The following Vercel files have been removed:
- `.vercelignore`
- `apps/web/vercel.json`
- `apps/web/public/vercel.svg`

Note: `@vercel/blob` package is still included as it's used for blob storage functionality and is not deployment-specific.

## File Structure

```
MarkWise/
├── ngrok.yml                 # ngrok configuration file
├── start-ngrok.ps1          # Windows startup script
├── NGROK_SETUP.md           # Detailed ngrok guide
├── DEPLOYMENT.md            # This file
├── apps/
│   ├── web/                 # Next.js application
│   │   ├── .env.local      # Environment variables (update with ngrok URL)
│   │   └── ...
│   └── mobile/              # React Native app
│       └── src/
│           └── utils/
│               └── api.js   # Update base URL here
└── ...
```

## Support

- ngrok Documentation: https://ngrok.com/docs
- Next.js Documentation: https://nextjs.org/docs
- Supabase Documentation: https://supabase.com/docs

---

**Last Updated:** January 2025
**Deployment Method:** Local + ngrok tunnel
