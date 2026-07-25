import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /attend?session=<sessionId>
// Serves a beautiful popup-style redirect page for the MarkWise mobile app.
// No authentication — security is enforced at the submit endpoint.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("session") ?? "";

  // Reject anything that isn't a safe identifier character
  if (!raw || !/^[a-zA-Z0-9_-]+$/.test(raw)) {
    return new NextResponse("Bad Request: invalid session parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // raw is now safe to embed in HTML — only alphanumeric, hyphen, underscore
  const session = raw;

  // Look up the session to get the unit code for display
  const attendanceSession = await prisma.onlineAttendanceSession.findUnique({
    where: { id: session },
    select: { unitCode: true },
  });
  const unitCode = attendanceSession?.unitCode ?? session.substring(0, 8);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MarkWise — Mark Attendance</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: rgba(15, 15, 26, 0.95);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      margin: 0;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Popup/Modal Container */
    .popup {
      max-width: 400px;
      width: 100%;
      background: linear-gradient(145deg, #1E1E2F 0%, #2A2A3C 100%);
      border-radius: 32px;
      box-shadow: 
        0 25px 50px -12px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(99, 102, 241, 0.2) inset,
        0 8px 32px rgba(99, 102, 241, 0.2);
      padding: 32px 24px;
      position: relative;
      overflow: hidden;
      animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Decorative gradient orbs */
    .popup::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200px;
      height: 200px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .popup::after {
      content: '';
      position: absolute;
      bottom: -50%;
      left: -50%;
      width: 200px;
      height: 200px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    /* Close button (subtle, for future expansion) */
    .close-hint {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }

    .close-hint span {
      color: rgba(255, 255, 255, 0.3);
      font-size: 20px;
      line-height: 1;
    }

    /* Icon Container */
    .icon-container {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #6366F1, #8B5CF6);
      border-radius: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 
        0 12px 24px -8px rgba(99, 102, 241, 0.4),
        0 4px 12px rgba(0, 0, 0, 0.3);
      position: relative;
      z-index: 1;
    }

    .icon-container svg {
      width: 44px;
      height: 44px;
      fill: none;
      stroke: white;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Content */
    h1 {
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #FFFFFF 0%, #E0E0FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
      text-align: center;
    }

    .unit-badge {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 40px;
      padding: 8px 16px;
      display: inline-block;
      margin-bottom: 20px;
      font-size: 15px;
      color: #A5B4FC;
      font-weight: 500;
      backdrop-filter: blur(4px);
      text-align: center;
    }

    .unit-badge span {
      color: #FFFFFF;
      font-weight: 600;
      margin-left: 4px;
    }

    p {
      color: #9CA3AF;
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 28px;
      text-align: center;
      max-width: 300px;
      margin-left: auto;
      margin-right: auto;
    }

    /* Button */
    .btn-container {
      position: relative;
      z-index: 2;
      margin-bottom: 20px;
    }

    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      background: linear-gradient(135deg, #6366F1, #8B5CF6);
      color: white;
      text-decoration: none;
      padding: 18px 24px;
      border-radius: 60px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.3px;
      border: none;
      box-shadow: 
        0 12px 24px -8px rgba(99, 102, 241, 0.6),
        0 4px 8px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 
        0 20px 32px -8px rgba(99, 102, 241, 0.7),
        0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .btn:active {
      transform: translateY(1px);
      box-shadow: 
        0 8px 16px -4px rgba(99, 102, 241, 0.5),
        0 2px 4px rgba(0, 0, 0, 0.2);
    }

    /* Shine effect on button */
    .btn::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -60%;
      width: 200%;
      height: 200%;
      background: linear-gradient(
        to right,
        transparent,
        rgba(255, 255, 255, 0.1),
        transparent
      );
      transform: rotate(30deg);
      transition: transform 0.5s ease;
    }

    .btn:hover::after {
      transform: rotate(30deg) translate(50%, 0);
    }

    .btn svg {
      width: 24px;
      height: 24px;
      stroke: white;
      stroke-width: 2;
      fill: none;
    }

    /* Install instructions */
    .install-note {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 16px;
      padding: 16px;
      margin-top: 20px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .install-note p {
      font-size: 13px;
      color: #6B7280;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .install-note p:last-child {
      margin-bottom: 0;
    }

    .install-note strong {
      color: #A5B4FC;
      font-weight: 600;
    }

    .badge-container {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .badge {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 30px;
      padding: 6px 12px;
      font-size: 12px;
      color: #9CA3AF;
    }

    .badge.primary {
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.3);
      color: #A5B4FC;
    }

    /* Loading/Session info */
    .session-info {
      font-size: 12px;
      color: #4B5563;
      margin-top: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .session-info span {
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 8px;
      border-radius: 12px;
      font-family: monospace;
      color: #6B7280;
    }

    /* Divider */
    .divider {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 20px 0;
      color: #4B5563;
      font-size: 12px;
    }

    .divider-line {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    }
  </style>
</head>
<body>
  <div class="popup">
    <!-- Subtle close hint (non-functional, just design) -->
    <div class="close-hint">
      <span>✕</span>
    </div>

    <!-- Icon -->
    <div class="icon-container">
      <svg viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.85" />
      </svg>
    </div>

    <!-- Title -->
    <h1>Mark Attendance</h1>

    <!-- Unit/Session Badge (dynamic) -->
    <div class="unit-badge">
      Unit <span>${unitCode}</span>
    </div>

    <!-- Description -->
    <p>
      Tap the button below to open MarkWise<br />
      and automatically record your attendance.
    </p>

    <!-- Main Button -->
    <div class="btn-container">
      <a class="btn" id="btn" href="#">
        <svg viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          <path d="M12 4V2" />
          <path d="M15 2v2" />
          <path d="M9 2v2" />
        </svg>
        Open MarkWise
        <svg viewBox="0 0 24 24" style="width: 20px; height: 20px;">
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
      </a>
    </div>

    <!-- Quick Install Help (shown if needed, but always visible as info) -->
    <div class="install-note">
      <p>
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span><strong>Don't have MarkWise?</strong> Install from:</span>
      </p>
      <div class="badge-container">
        <span class="badge primary">📱 App Store</span>
        <span class="badge primary">📲 Google Play</span>
      </div>
    </div>

    <!-- Divider with session info -->
    <div class="divider">
      <span class="divider-line"></span>
      <span>session details</span>
      <span class="divider-line"></span>
    </div>

    <!-- Session Info -->
    <div class="session-info">
      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span>${unitCode}</span>
      <span>⚡ active</span>
    </div>

    <script>
      (function() {
        var session = new URLSearchParams(location.search).get('session') || '';
        session = session.replace(/[^a-zA-Z0-9_\\-]/g, '');

        var isAndroid = /android/i.test(navigator.userAgent);
        var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

        // Android Chrome requires intent:// — it blocks window.location custom schemes
        // iOS Safari handles markwise:// fine on user tap
        var deepLink;
        var fallbackUrl;

        if (isAndroid) {
          fallbackUrl = 'https://play.google.com/store/apps/details?id=com.markwise';
          deepLink = 'intent://attend?session=' + encodeURIComponent(session)
            + '#Intent;scheme=markwise;package=com.markwise;'
            + 'S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) + ';end';
        } else if (isIOS) {
          fallbackUrl = 'https://apps.apple.com/app/markwise/id123456789';
          deepLink = 'markwise://attend?session=' + encodeURIComponent(session);
        } else {
          // Desktop or other — just link to the appropriate store
          deepLink = 'https://www.markwise.com/download';
        }

        var btn = document.getElementById('btn');
        btn.href = deepLink;

        // Add click tracking (optional)
        btn.addEventListener('click', function(e) {
          console.log('Deep link clicked:', deepLink);
          
          // For iOS, we might need to handle fallback differently
          if (isIOS) {
            // Set a timeout to detect if app opened
            setTimeout(function() {
              var hidden = document.createElement('iframe');
              hidden.style.display = 'none';
              document.body.appendChild(hidden);
              hidden.src = fallbackUrl;
            }, 500);
          }
        });
      })();
    </script>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Prevent the redirect page itself from being cached so session links stay fresh
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}