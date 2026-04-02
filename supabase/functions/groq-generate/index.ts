/**
 * Supabase Edge Function: groq-generate
 * Calls the Groq API server-side to generate cold email body and subject.
 *
 * Expected JSON body:
 *   { bodyPrompt: string, subjectPrompt: string }
 *
 * Required secret (set via: supabase secrets set GROQ_API_KEY=xxx):
 *   GROQ_API_KEY
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_MODEL = "qwen/qwen3-32b";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey);

    // Verify JWT via Supabase Auth API — immune to "legacy secret" toggle
    const { data: { user }, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) throw new Error("GROQ_API_KEY non configurata nei secrets della edge function");

    const { bodyPrompt, subjectPrompt } = await req.json();
    if (!bodyPrompt)    throw new Error("bodyPrompt obbligatorio");
    if (!subjectPrompt) throw new Error("subjectPrompt obbligatorio");

    // Strip <think>...</think> blocks produced by reasoning models (e.g. qwen3).
    // Also handles unclosed <think> blocks (truncated by max_tokens).
    const stripThinking = (text: string) =>
      text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();

    // Fallback mock when Groq quota/token limits are exceeded.
    // Extracts context from the structured bodyPrompt to produce a credible template.
    const generateMockEmail = (bp: string, sp: string): { body: string; subject: string } => {
      const extract = (label: string) => {
        const m = bp.match(new RegExp(`- ${label}:\\s*(.+?)(?:\\n|$)`));
        return m ? m[1].trim() : "";
      };
      const obiettivo  = extract("Obiettivo");
      const mittente   = extract("Mittente");
      const prodotto   = extract("Prodotto\\/servizio");
      const forza      = extract("Punto di forza unico");
      const garanzia   = extract("Garanzia offerta");

      const body =
`Gentile {{nome}},

so quanto il ruolo di {{ruolo}} in {{azienda}} richieda soluzioni concrete che portino risultati reali, non promesse.

${mittente ? mittente + "." : "Lavoro con aziende come la tua"} Il mio obiettivo: ${obiettivo || "aiutarti a crescere"}.

${prodotto ? `Con ${prodotto}` : "Con la nostra soluzione"} puoi ${obiettivo || "migliorare le tue performance"}. ${forza ? forza + "." : ""}

${garanzia ? garanzia : "Offriamo una garanzia di soddisfazione: se non ottieni risultati entro 30 giorni, rimborsiamo tutto."}

Potremmo fissare una call di 15 minuti per capire se possiamo essere utili a {{azienda}}?

Cordiali saluti,
{{mittente_nome}} {{mittente_cognome}}
{{mittente_ruolo}}`;

      const ruoloM = sp.match(/per un ([^.]+)\./);
      const subject = ruoloM
        ? `Una proposta per ${ruoloM[1]}`
        : `Opportunità per il tuo team`;

      return { body, subject };
    };

    const isQuotaError = (msg: string) =>
      msg.includes("Request too large") ||
      msg.includes("rate_limit") ||
      msg.includes("TPM") ||
      msg.includes("tokens per minute") ||
      msg.includes("Limit") ||
      msg.includes("quota");

    const callGroq = (systemPrompt: string, userPrompt: string, maxTokens: number) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        } as Record<string, unknown>),
      });

    const emailSystem = "/nothink\nSei un esperto copywriter italiano madrelingua. Rispondi SOLO con il testo richiesto, senza commenti, intestazioni o spiegazioni. Usa italiano corretto e naturale.";
    const subjectSystem = "/nothink\nSei un esperto di email marketing B2B. Rispondi ESCLUSIVAMENTE con il testo dell'oggetto email, senza nessuna introduzione, spiegazione, punteggiatura iniziale o finale, virgolette, asterischi o frasi come 'Ecco l'oggetto' o simili. Solo il testo puro dell'oggetto.";

    const [emailRes, subjectRes] = await Promise.all([
      callGroq(emailSystem, bodyPrompt, 900),
      callGroq(subjectSystem, subjectPrompt, 60),
    ]);

    const emailData   = await emailRes.json();
    const subjectData = await subjectRes.json();

    if (!emailRes.ok) {
      const errMsg = emailData.error?.message || "Errore Groq API";
      if (isQuotaError(errMsg)) {
        const mock = generateMockEmail(bodyPrompt, subjectPrompt);
        return new Response(JSON.stringify(mock), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(errMsg);
    }

    const body    = stripThinking(emailData.choices[0].message.content);
    const rawSubject = stripThinking(subjectData.choices?.[0]?.message?.content || "");
    // Strip AI preamble like "Grazie per il chiarimento, ecco l'oggetto richiesto: ..."
    const subject = rawSubject
      .replace(/^[^:]+(?:ecco|oggetto|richiesto|risposta|chiarimento|certamente|certo|perfetto)[^:]*:\s*/i, "")
      .replace(/^[*_"'`\s]+|[*_"'`\s]+$/g, "")
      .trim();

    return new Response(JSON.stringify({ body, subject }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[groq-generate]", msg);
    // Return 200 so the Supabase client passes the body through (non-2xx swallows the message)
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
