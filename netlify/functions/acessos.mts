import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { acessos } from "../../db/schema.js";
import { desc, sql } from "drizzle-orm";

export default async (req: Request) => {
  if (req.method === "GET") {
    const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const all = await db.select().from(acessos).where(sql`${acessos.ts} >= ${limite}`).orderBy(desc(acessos.ts));
    return Response.json(all);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const [row] = await db.insert(acessos).values({
      ts: body.ts,
      data: body.data,
      distribuidora: body.distribuidora,
      distId: body.distId || "",
      nome: body.nome,
      regiao: body.regiao || "",
      telefone: body.telefone || "",
      cnpj: body.cnpj || "",
      razao: body.razao || "",
      fantasia: body.fantasia || "",
      comprador: body.comprador || "",
      email: body.email || "",
      associativismo: body.associativismo || "",
    }).returning();
    return Response.json(row, { status: 201 });
  }

  if (req.method === "DELETE") {
    await db.delete(acessos);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/acessos",
};
