import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pedidos, clientes } from "../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

export default async (req: Request) => {
  if (req.method === "GET") {
    const all = await db.select().from(pedidos).orderBy(desc(pedidos.ts));
    return Response.json(all);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const [row] = await db.insert(pedidos).values({
      id: body.id,
      ts: body.ts,
      data: body.data,
      representante: body.representante,
      cliente: body.cliente,
      itens: body.itens,
      totais: body.totais,
      txt: body.txt || "",
      txtCompleto: body.txtCompleto || "",
      emailEnviado: body.emailEnviado || false,
      emailDestino: body.emailDestino || "",
    }).returning();

    try {
      const cli = body.cliente;
      const cnpj = cli?.cnpj;
      if (cnpj && cnpj.replace(/\D/g, "").length === 14) {
        const total = Number(body.totais?.total) || 0;
        const existing = await db.select().from(clientes).where(eq(clientes.cnpj, cnpj)).limit(1);
        if (existing.length) {
          await db.update(clientes).set({
            razao: cli.razao || existing[0].razao,
            fantasia: cli.fantasia || existing[0].fantasia,
            comprador: cli.comprador || existing[0].comprador,
            telefone: cli.telefone || existing[0].telefone,
            email: cli.email || existing[0].email,
            associativismo: cli.associativismo || existing[0].associativismo,
            totalPedidos: (existing[0].totalPedidos || 0) + 1,
            totalValor: (existing[0].totalValor || 0) + total,
            ultimoPedido: new Date(),
            updatedAt: new Date(),
          }).where(eq(clientes.cnpj, cnpj));
        } else {
          await db.insert(clientes).values({
            cnpj,
            razao: cli.razao || "",
            fantasia: cli.fantasia || "",
            comprador: cli.comprador || "",
            telefone: cli.telefone || "",
            email: cli.email || "",
            associativismo: cli.associativismo || "",
            totalPedidos: 1,
            totalValor: total,
            ultimoPedido: new Date(),
          });
        }
      }
    } catch (e) {}

    return Response.json(row, { status: 201 });
  }

  if (req.method === "PUT") {
    const body = await req.json();
    if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
    await db.update(pedidos).set({
      emailEnviado: body.emailEnviado,
    }).where(eq(pedidos.id, body.id));
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id === "__ALL__") {
      await db.delete(pedidos);
      return Response.json({ ok: true });
    }
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    await db.delete(pedidos).where(eq(pedidos.id, id));
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/pedidos",
};
