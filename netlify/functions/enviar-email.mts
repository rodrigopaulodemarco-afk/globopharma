import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pedidos } from "../../db/schema.js";
import { eq } from "drizzle-orm";

async function tentarEnviarEmail(emailDestino: string, formData: Record<string, unknown>): Promise<{ ok: boolean; detail?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(
      "https://formsubmit.co/ajax/" + encodeURIComponent(emailDestino),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(formData),
        signal: controller.signal,
      }
    );

    const text = await resp.text();
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }

    if (!resp.ok) {
      return { ok: false, detail: `FormSubmit HTTP ${resp.status}: ${text}` };
    }

    if (data && data.success === "false") {
      return { ok: false, detail: `FormSubmit error: ${data.message || "unknown"}` };
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { emailDestino, subject, payload, pedidoId } = body;

  if (!emailDestino || !payload) {
    return Response.json({ error: "emailDestino and payload required" }, { status: 400 });
  }

  const formData = {
    ...payload,
    _subject: subject || "Novo Pedido",
    _template: "table",
    _captcha: "false",
  };

  const MAX_RETRIES = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Email attempt ${attempt}/${MAX_RETRIES} for pedido: ${pedidoId || "unknown"}`);
    const result = await tentarEnviarEmail(emailDestino, formData);

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
