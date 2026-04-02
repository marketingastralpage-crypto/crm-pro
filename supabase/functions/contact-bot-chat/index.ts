/**
 * Supabase Edge Function: contact-bot-chat
 * LLM chat via Groq to extract location + industry from natural language user input.
 *
 * Expected JSON body:
 *   { messages: [{ role: "user"|"assistant", content: string }] }
 *
 * Required secret:
 *   GROQ_API_KEY
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_MODEL = "qwen/qwen3-32b";

const SYSTEM_PROMPT = `/nothink
Sei un assistente per la generazione di lead B2B. Il tuo compito è aiutare l'utente a identificare il target di contatti che vuole ottenere.

Devi SEMPRE rispondere con un JSON valido (e solo JSON, nessun testo fuori dal JSON) con questa struttura:
{
  "type": "extract" | "confirm_fields" | "ask_count" | "confirm_count" | "ready",
  "location_en": "...",
  "industry_en": "...",
  "message_it": "messaggio in italiano da mostrare all'utente"
}

Regole:
1. Quando l'utente descrive il target, estrai location e industry e rispondi con type="extract", chiedendo conferma.
2. Se l'utente conferma, rispondi con type="confirm_fields".
3. Dopo la conferma dei campi, chiedi quanti contatti vuole con type="ask_count". Specifica che ogni contatto consuma 1 credito.
4. Quando l'utente indica un numero valido (intero > 0), rispondi con type="confirm_count" ripetendo il riepilogo e chiedendo di scrivere CONFERMA.
5. Se l'utente scrive CONFERMA (case-insensitive), rispondi con type="ready".

Per location_en: usa formato "region, country" o "city, country" tutto MINUSCOLO (es: "lombardy, italy", "sicily, italy", "lazio, italy", "milan, italy", "rome, italy", "naples, italy"). Traduci SEMPRE in inglese.

Per industry_en: usa SEMPRE uno di questi valori esatti, tutto minuscolo (scegli il più vicino alla richiesta):
"marketing & advertising", "accounting", "legal services", "medical & health", "dental", "real estate", "hospitality", "fitness & wellness", "pharmaceutical", "architecture & planning", "civil engineering", "management consulting", "financial services", "insurance", "information technology & services", "construction", "retail", "education", "food & beverages", "automotive"

Esempi di mapping:
- commercialisti, dottori commercialisti → "accounting"
- avvocati, studi legali → "legal services"
- dentisti → "dental"
- medici, cliniche → "medical & health"
- agenzie marketing, web agency → "marketing & advertising"
- agenti immobiliari → "real estate"
- hotel, b&b → "hospitality"
- palestre, centri fitness → "fitness & wellness"
- architetti → "architecture & planning"
- ingegneri, imprese edili → "civil engineering"
- consulenti aziendali → "management consulting"
- banche, finanza → "financial services"
- assicurazioni → "insurance"
- software, IT → "information technology & services"

Campi location_en e industry_en devono essere presenti anche nelle risposte intermedie (null se non ancora estratti).`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Strip <think>...</think> blocks produced by reasoning models (e.g. qwen3).
// Also handles unclosed <think> blocks (truncated by max_tokens).
const stripThinking = (text: string): string =>
  text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();

// Extract first JSON object from a string that may contain extra text.
const extractJson = (text: string): unknown => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Nessun JSON valido trovato nella risposta del modello");
  return JSON.parse(match[0]);
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) throw new Error("GROQ_API_KEY non configurata nei secrets della edge function");

    const body = await req.json();
    const messages: ChatMessage[] = body?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages deve essere un array non vuoto");
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || typeof msg.content !== "string") {
        throw new Error("Ogni messaggio deve avere role e content stringa");
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        throw new Error(`Role non valido: ${msg.role}`);
      }
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        temperature: 0.3,
        max_tokens: 400,
      } as Record<string, unknown>),
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error(groqData.error?.message || "Errore Groq API");

    const rawContent: string = groqData.choices[0].message.content;
    const stripped = stripThinking(rawContent);
    const parsed = extractJson(stripped);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[contact-bot-chat]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
