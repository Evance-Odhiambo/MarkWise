import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options",  value: "nosniff" },
  { key: "X-Frame-Options",         value: "DENY" },
  { key: "X-XSS-Protection",        value: "1; mode=block" },
  { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",      value: "camera=(), microphone=(), geolocation=()" },
];

const isProd = process.env.NODE_ENV === "production";

// Use Windows temp directory for faster dev builds
const getDistDir = () => {
  // In production, always use default .next directory
  if (isProd) return ".next";
  
  // In development, keep using default .next in project directory
  // The warning is informational and doesn't affect functionality
  return ".next";
};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  typescript: { ignoreBuildErrors: true },

  // Allow LAN/mobile devices to connect to dev resources
  allowedDevOrigins: ["192.168.0.100"],

  outputFileTracingIncludes: {
    "/api/reports/generate": ["./node_modules/pdfkit/js/data/**/*"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
  },

  async headers() {
    const headers = [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];

    if (isProd) {
      headers.push({
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      });
    }

    return headers;
  },

  async rewrites() {
    return [
      { source: "/units/:path*",         destination: "/api/units/:path*" },
      { source: "/groups",               destination: "/api/groups" },
      { source: "/groups/:path*",        destination: "/api/groups/:path*" },
      { source: "/timetable/:path*",     destination: "/api/timetable/:path*" },
      { source: "/student/:path*",       destination: "/api/student/:path*" },
      { source: "/students/:path*",      destination: "/api/students/:path*" },
      { source: "/lecturers/:path*",     destination: "/api/lecturers/:path*" },
      { source: "/lecturer/:path*",      destination: "/api/lecturer/:path*" },
      { source: "/notifications",        destination: "/api/notifications" },
      { source: "/notifications/:path*", destination: "/api/notifications/:path*" },
      { source: "/materials/:path*",     destination: "/api/materials/:path*" },
      { source: "/auth/:path*",          destination: "/api/auth/:path*" },
      { source: "/assignments",          destination: "/api/assignments" },
      { source: "/assignments/:path*",   destination: "/api/assignments/:path*" },
      { source: "/files/:path*",         destination: "/api/files/:path*" },
      { source: "/attendance/:path*",    destination: "/api/attendance/:path*" },
      { source: "/meeting-invites",      destination: "/api/meeting-invites" },
      { source: "/meeting-invites/:path*", destination: "/api/meeting-invites/:path*" },
    ];
  },
};

export default nextConfig;
