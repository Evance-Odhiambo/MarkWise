This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Room Management & Live Availability

MarkWise now includes Prisma + PostgreSQL-backed room management and booking APIs under `/api` for both web admin and React Native lecturer clients.

### Setup (Prisma + DB)

1. Copy environment values and set your Postgres connection:

```bash
# Edit .env.local with your configuration
```

2. Run Prisma migration + client generation:

```bash
npm run prisma:migrate -- --name room_management
npm run prisma:generate
```

3. Seed sample rooms/buildings:

```bash
npm run prisma:seed
```

### Auth and roles

- Admin routes (`POST/PATCH /api/rooms`) require `x-admin-id` header.
- Lecturer routes (`POST /api/bookings/holds`, `POST /api/bookings/confirm`) require `Authorization: Bearer <lecturer-jwt>`.
- Read routes support admin or lecturer identity.

### Endpoints

- `GET /api/rooms?institutionId=&buildingCode=&date=&startAt=&endAt=&capacity=&type=&status=`
- `POST /api/rooms` (admin)
- `PATCH /api/rooms/:id` (admin)
- `POST /api/bookings/holds` (lecturer)
- `POST /api/bookings/confirm` (lecturer + idempotency)
- `DELETE /api/bookings/:id` (lecturer/admin)
- `GET /api/bookings/:id`
- `GET /api/rooms/events/stream` (SSE)

### React Native integration

#### 1) List rooms

```ts
const res = await fetch(
	`${BASE_URL}/api/rooms?institutionId=markwise-main&buildingCode=SCI&date=2026-02-15`,
	{
		headers: {
			Authorization: `Bearer ${lecturerToken}`,
		},
	},
);

const payload = await res.json();
// payload.data.rooms -> [{ id, name, status, hasConflict, ... }]
```

#### 2) Create hold

```ts
const holdRes = await fetch(`${BASE_URL}/api/bookings/holds`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		Authorization: `Bearer ${lecturerToken}`,
	},
	body: JSON.stringify({
		roomId,
		startAt: "2026-02-15T08:00:00.000Z",
		endAt: "2026-02-15T10:00:00.000Z",
	}),
});

const holdPayload = await holdRes.json();
// holdPayload.data.holdId
// holdPayload.data.expiresAt
```

#### 3) Confirm booking (idempotent)

```ts
const confirmRes = await fetch(`${BASE_URL}/api/bookings/confirm`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		Authorization: `Bearer ${lecturerToken}`,
		"x-idempotency-key": uniqueKey,
	},
	body: JSON.stringify({
		holdId,
		unitCode: "BOT402",
		idempotencyKey: uniqueKey,
	}),
});

const confirmPayload = await confirmRes.json();
// confirmPayload.data.booking
// confirmPayload.data.idempotentReplay
```

#### 4) Subscribe to live status (SSE)

```ts
const es = new EventSource(`${BASE_URL}/api/rooms/events/stream`, {
	withCredentials: false,
});

es.addEventListener("room.status.changed", (event) => {
	const payload = JSON.parse((event as MessageEvent).data);
	// payload.toStatus -> free|reserved|occupied|unavailable
});
```

For RN environments that cannot set headers with native `EventSource`, call this endpoint through a proxy/BFF that injects auth headers, or use an EventSource polyfill supporting custom headers.

### Response format

Success responses:

```json
{
	"apiVersion": "v1",
	"data": {}
}
```

Error responses:

```json
{
	"apiVersion": "v1",
	"error": {
		"code": "VALIDATION_ERROR",
		"message": "Invalid hold payload.",
		"details": {}
	}
}
```

### Business rule notes

- Overlap prevention uses transactional checks on holds/bookings.
- Hold TTL defaults to 5 minutes (`BOOKING_HOLD_TTL_MINUTES`).
- Expired holds are auto-invalidated before read/write operations.
- Room status transitions are server-authoritative and tracked in `StatusHistory`.
