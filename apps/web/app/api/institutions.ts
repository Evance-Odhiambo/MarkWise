import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const institutions = await prisma.institution.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return new Response(JSON.stringify({ data: institutions }), { status: 200 });
  } catch {
    return new Response("Failed to fetch institutions", { status: 500 });
  }
}
