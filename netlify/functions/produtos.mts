import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { produtos } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";

export default async (req: Request) => {
  if (req.method === "GET") {
    const rows = await db.select().from(produtos).orderBy(desc(produtos.updatedAt)).limit(1);
    if (rows.length === 0) return Response.json(null);
    return Response.json(rows[0].data);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = await db.select().from(produtos).limit(1);
    if (existing.length > 0) {
      await db.update(produtos).set({ data: body, updatedAt: new Date() }).where(eq(produtos.pk, existing[0].pk));
    } else {
      await db.insert(produtos).values({ data: body });
    }
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/produtos",
};
