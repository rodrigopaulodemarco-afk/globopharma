import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pedidos } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { enviarEmail } from "../lib/email.js";

const MAX_RETRIES = 3;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { emailDestino, subject, payload, pedidoId } = body;

  if (!emailDestino || !payload) {
    return Response.json({ error: "emailDestino and payload required" }, { status: 400 });
  }

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Email attempt ${attempt}/${MAX_RETRIES} for pedido: ${pedidoId || "unknown"}`);
    const result = await enviarEmail(emailDestino, subject || "Novo Pedido", payload);

    if (result.ok) {
      console.log(`Email sent successfully on attempt ${attempt} for pedido: ${pedidoId || "unknown"}`);

      if (pedidoId) {
        try {
          await db
            .update(pedidos)
            .set({ emailEnviado: true })
            .where(eq(pedidos.id, pedidoId));
        } catch (e) {
          console.error("Failed to update emailEnviado flag:", e);
        }
      }

      return Response.json({ ok: true });
    }

    lastError = result.detail || "unknown error";
    console.error(`Email attempt ${attempt} failed:`, lastError);

    // Erro definitivo (chave inválida, remetente não validado): repetir não adianta.
    if (result.retriable === false) {
      console.error("Erro definitivo, abortando novas tentativas:", lastError);
      return Response.json({ ok: false, error: `Email não enviado: ${lastError}` }, { status: 502 });
    }

    if (attempt < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.error(`All ${MAX_RETRIES} email attempts FAILED for pedido: ${pedidoId || "unknown"}`);
  return Response.json(
    { ok: false, error: `Email falhou após ${MAX_RETRIES} tentativas: ${lastError}` },
    { status: 502 }
  );
};

export const config: Config = {
  path: "/api/enviar-email",
};
