# ngrok Setup Guide for MarkWise

This guide will help you set up ngrok to allow users on different networks to access your MarkWise system.

## What is ngrok?

ngrok is a secure tunneling service that creates a public URL for your local development server, allowing external users to access your application over the internet.

## Prerequisites

- Your MarkWise web application should be running locally
- An ngrok account (free tier available at https://ngrok.com)

## Installation Steps

### 1. Install ngrok (Windows)

Since you have Chocolatey installed, run:

```powershell
choco install ngrok
```

Alternatively, you can download ngrok directly:
1. Visit https://ngrok.com/download
2. Download the Windows version
3. Extract the ZIP file
4. Move `ngrok.exe` to a folder in your PATH (e.g., `C:\Windows\System32`)

### 2. Sign up for ngrok Account

1. Go to https://dashboard.ngrok.com/signup
2. Create a free account
3. After signing in, copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken

### 3. Configure ngrok Authentication

Run this command with your authtoken:

```powershell
ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
```

Or update the `ngrok.yml` file in this project root and replace `YOUR_NGROK_AUTH_TOKEN` with your actual token.

## Running MarkWise with ngrok

### Option 1: Using ngrok Command Directly (Recommended)

1. **Start your Next.js web application:**
   ```powershell
   cd apps/web
   npm run dev
   ```
   The app will run on http://localhost:3000

2. **In a new terminal, start ngrok:**
   ```powershell
   ngrok http 3000
   ```

3. **Copy the public URL:**
   ngrok will display something like:
   ```
   Forwarding    https://abc123.ngrok.io -> http://localhost:3000
   ```
   
4. **Share the HTTPS URL** (`https://abc123.ngrok.io`) with users on other networks

### Option 2: Using Configuration File

1. **Start your web application** (in one terminal):
   ```powershell
   cd apps/web
   npm run dev
   ```

2. **Start ngrok with config** (in another terminal):
   ```powershell
   ngrok start --config ngrok.yml web
   ```

## Important Configuration Updates

After starting ngrok, you'll need to update your application configuration:

### 1. Update Environment Variables

Update your `apps/web/.env.local` file with the ngrok URL:

```env
NEXT_PUBLIC_API_URL=https://your-ngrok-url.ngrok.io
NEXTAUTH_URL=https://your-ngrok-url.ngrok.io
```

### 2. Update Mobile App Base URL

Update the base URL in your mobile app to point to the ngrok URL:

**File:** `apps/mobile/src/utils/api.js` (or wherever your API base URL is configured)

```javascript
const baseUrl = 'https://your-ngrok-url.ngrok.io';
```

### 3. Database Configuration

Ensure your database (Supabase) connection string is accessible from the server.

## ngrok Free Tier Limitations

- URLs change every time you restart ngrok (unless you have a paid plan)
- 40 connections/minute limit
- Session timeout after 8 hours
- Random subdomain (e.g., abc123.ngrok.io)

## Paid Plans (Optional)

For production use, consider ngrok paid plans that offer:
- Custom domains (e.g., markwise.ngrok.io)
- Reserved domains that don't change
- Higher connection limits
- No session timeouts

Visit: https://ngrok.com/pricing

## Security Considerations

1. **Authentication:** Ensure your application has proper authentication enabled
2. **HTTPS Only:** ngrok provides HTTPS by default - always use the https:// URL
3. **Firewall:** ngrok bypasses local firewalls, so ensure your app is secure
4. **Session Management:** Use secure session management and JWT tokens
5. **Rate Limiting:** Implement rate limiting on your API endpoints

## Monitoring ngrok Traffic

ngrok provides a web interface to inspect HTTP requests:

- Open http://localhost:4040 in your browser while ngrok is running
- View all requests, responses, and replay them for testing

## Alternative: Using Custom Domain (Paid)

If you have a paid ngrok plan and custom domain:

```powershell
ngrok http 3000 --domain=markwise.ngrok.io
```

## Troubleshooting

### ngrok Not Found
- Reinstall using `choco install ngrok`
- Or add ngrok.exe to your PATH manually

### Connection Refused
- Ensure your Next.js app is running on port 3000
- Check if another process is using port 3000

### Tunnel Not Working
- Verify your authtoken is configured correctly
- Check ngrok dashboard: https://dashboard.ngrok.com

### CORS Errors
- Update your Next.js configuration to allow the ngrok domain
- Add the ngrok URL to allowed origins

## Production Deployment Alternatives

For long-term production use, consider:
- **Railway:** https://railway.app
- **Render:** https://render.com
- **DigitalOcean App Platform:** https://www.digitalocean.com/products/app-platform
- **AWS EC2/Lightsail:** For full control
- **Azure App Service:** Enterprise-grade hosting

## Quick Reference Commands

```powershell
# Install ngrok
choco install ngrok

# Add authtoken
ngrok config add-authtoken YOUR_TOKEN

# Start tunnel
ngrok http 3000

# Start with custom subdomain (paid)
ngrok http 3000 --subdomain=markwise

# Start with config file
ngrok start --config ngrok.yml web

# Check ngrok version
ngrok version

# View help
ngrok help
```

## Support

- ngrok Documentation: https://ngrok.com/docs
- ngrok Community: https://github.com/inconshreveable/ngrok/issues
- MarkWise Issues: Check your project repository

---

**Note:** Remember to update your mobile app's API base URL whenever the ngrok URL changes (which happens on free tier restarts).
