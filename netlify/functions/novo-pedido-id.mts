import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { configuracoes } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const existing = await db.select().from(configuracoes).where(eq(configuracoes.chave, "ped_seq")).limit(1);
  let seq: number;

  if (existing.length > 0) {
    seq = parseInt(existing[0].valor, 10) + 1;
    await db.update(configuracoes).set({ valor: String(seq), updatedAt: new Date() }).where(eq(configuracoes.chave, "ped_seq"));
  } else {
    seq = 1;
    await db.insert(configuracoes).values({ chave: "ped_seq", valor: "1" });
  }

  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const id = `PED-${ymd}-${String(seq).padStart(4, "0")}`;

  return Response.json({ id, seq });
};

export const config: Config = {
  path: "/api/novo-pedido-id",
};
