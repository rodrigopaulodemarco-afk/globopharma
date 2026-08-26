import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { configuracoes } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const chave = url.searchParams.get("chave");
    if (chave) {
      const rows = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave)).limit(1);
      return Response.json(rows.length ? rows[0] : null);
    }
    const all = await db.select().from(configuracoes);
    return Response.json(all);
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!body.chave || body.valor === undefined) {
      return Response.json({ error: "chave and valor required" }, { status: 400 });
    }
    const existing = await db.select().from(configuracoes).where(eq(configuracoes.chave, body.chave)).limit(1);
    if (existing.length > 0) {
      await db.update(configuracoes).set({ valor: body.valor, updatedAt: new Date() }).where(eq(configuracoes.chave, body.chave));
    } else {
      await db.insert(configuracoes).values({ chave: body.chave, valor: body.valor });
    }
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/config",
};
