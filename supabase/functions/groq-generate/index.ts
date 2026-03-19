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
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) throw new Error("GROQ_API_KEY non configurata nei secrets della edge function");

    const { bodyPrompt, subjectPrompt } = await req.json();
    if (!bodyPrompt)    throw new Error("bodyPrompt obbligatorio");
    if (!subjectPrompt) throw new Error("subjectPrompt obbligatorio");

    const callGroq = (prompt: string, maxTokens: number) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
      });

    const [emailRes, subjectRes] = await Promise.all([
      callGroq(bodyPrompt, 900),
      callGroq(subjectPrompt, 60),
    ]);

    const emailData   = await emailRes.json();
    const subjectData = await subjectRes.json();

    if (!emailRes.ok) throw new Error(emailData.error?.message || "Errore Groq API");

    const body    = emailData.choices[0].message.content.trim();
    const subject = (subjectData.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");

    return new Response(JSON.stringify({ body, subject }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[groq-generate]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
