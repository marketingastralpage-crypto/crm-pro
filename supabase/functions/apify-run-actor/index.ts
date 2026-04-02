/**
 * Supabase Edge Function: apify-run-actor
 * Verifies credits, deducts credits, starts an Apify run, creates a job record in DB.
 *
 * Expected JSON body:
 *   { location_en: string, industry_en: string, count: number }
 *
 * Required secrets:
 *   APIFY_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFY_TASK_ID = "1YuI0IKFlas6ofSSL";

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

    const uid = user.id;

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) throw new Error("APIFY_TOKEN non configurato nei secrets della edge function");

    const body = await req.json();
    const { location_en, industry_en, count } = body;

    if (!location_en || typeof location_en !== "string" || location_en.trim() === "") {
      throw new Error("location_en obbligatorio");
    }
    if (!industry_en || typeof industry_en !== "string" || industry_en.trim() === "") {
      throw new Error("industry_en obbligatorio");
    }
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new Error("count deve essere un intero tra 1 e 500");
    }

    // Read current credits
    const { data: creditRow, error: creditErr } = await supa
      .from("user_credits")
      .select("credits")
      .eq("user_id", uid)
      .maybeSingle();

    if (creditErr) throw new Error(`Errore lettura crediti: ${creditErr.message}`);

    const currentCredits: number = creditRow?.credits ?? 0;

    if (currentCredits < count) {
      return new Response(
        JSON.stringify({
          error: `Crediti insufficienti. Hai ${currentCredits} crediti, ne servono ${count}.`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Start Apify task run
    const apifyRes = await fetch(
      `https://api.apify.com/v2/actor-tasks/${APIFY_TASK_ID}/runs?token=${apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_industry: [industry_en.toLowerCase()],
          contact_location: [location_en.toLowerCase()],
          email_status: ["validated"],
          fetch_count: count,
        }),
      }
    );

    const apifyData = await apifyRes.json();
    if (!apifyRes.ok) {
      throw new Error(
        apifyData?.error?.message || `Apify API error: ${apifyRes.status}`
      );
    }

    const apifyRunId: string = apifyData?.data?.id;
    if (!apifyRunId) throw new Error("Apify non ha restituito un run ID valido");

    // Deduct credits — only after successful Apify call
    if (!creditRow) {
      // No row exists: cannot deduct from non-existent balance
      return new Response(
        JSON.stringify({ error: "Nessun credito configurato per questo utente" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: updateErr } = await supa
      .from("user_credits")
      .update({ credits: currentCredits - count, updated_at: new Date().toISOString() })
      .eq("user_id", uid);

    if (updateErr) throw new Error(`Errore aggiornamento crediti: ${updateErr.message}`);

    // Create job record
    const { data: jobRow, error: jobErr } = await supa
      .from("contact_gen_jobs")
      .insert({
        user_id: uid,
        apify_run_id: apifyRunId,
        location_en: location_en.trim(),
        industry_en: industry_en.trim(),
        count_requested: count,
        credits_used: count,
        status: "running",
      })
      .select("id")
      .single();

    if (jobErr) throw new Error(`Errore creazione job: ${jobErr.message}`);

    return new Response(
      JSON.stringify({
        jobId: jobRow.id,
        apifyRunId,
        creditsRemaining: currentCredits - count,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apify-run-actor]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
