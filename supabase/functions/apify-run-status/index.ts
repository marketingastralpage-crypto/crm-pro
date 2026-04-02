/**
 * Supabase Edge Function: apify-run-status
 * Polls Apify run status and fetches results when complete.
 *
 * Expected JSON body:
 *   { jobId: string }
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

// Schema output dell'actor Apify (Apollo-style contact finder)
interface ApifyItem {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  mobile_number?: string | null;
  company_name?: string;
  company_website?: string | null;
  company_phone?: string | null;
  company_street_address?: string | null;
  company_city?: string;
  company_state?: string;
  company_country?: string;
  linkedin?: string;
  job_title?: string;
  industry?: string;
}

interface MappedContact {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  linkedin: string | null;
  job_title: string | null;
  industry: string | null;
  via: string | null;
  citta: string | null;
  stato: string | null;
}

const mapApifyStatus = (apifyStatus: string): "running" | "succeeded" | "failed" => {
  if (apifyStatus === "SUCCEEDED") return "succeeded";
  if (apifyStatus === "FAILED" || apifyStatus === "ABORTED" || apifyStatus === "TIMED-OUT") return "failed";
  // READY, RUNNING, or any unknown state
  return "running";
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

    const uid = user.id;

    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) throw new Error("APIFY_TOKEN non configurato nei secrets della edge function");

    const body = await req.json();
    const { jobId } = body;

    if (!jobId || typeof jobId !== "string") {
      throw new Error("jobId obbligatorio");
    }

    // Load job — enforce ownership via user_id filter
    const { data: job, error: jobErr } = await supa
      .from("contact_gen_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", uid)
      .maybeSingle();

    if (jobErr) throw new Error(`Errore lettura job: ${jobErr.message}`);
    if (!job) {
      return new Response(JSON.stringify({ error: "Job non trovato" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return cached result if already succeeded and snapshot is populated
    if (job.status === "succeeded" && job.result_snapshot) {
      return new Response(
        JSON.stringify({
          status: "succeeded",
          contacts: job.result_snapshot,
          message: "Risultati disponibili",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Poll Apify for current run state
    const runRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${job.apify_run_id}?token=${apifyToken}`
    );
    const runData = await runRes.json();

    if (!runRes.ok) {
      throw new Error(runData?.error?.message || `Apify API error: ${runRes.status}`);
    }

    const apifyStatus: string = runData?.data?.status ?? "RUNNING";
    const ourStatus = mapApifyStatus(apifyStatus);

    if (ourStatus === "running") {
      return new Response(
        JSON.stringify({ status: "running", contacts: null, message: "Run in corso..." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ourStatus === "failed") {
      // Update job status
      await supa
        .from("contact_gen_jobs")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", jobId);

      // Refund credits
      const { error: refundErr } = await supa.rpc("increment_credits", {
        p_user_id: uid,
        p_amount: job.count_requested,
      });

      // Fallback if RPC not available: direct update
      if (refundErr) {
        const { data: creditRow } = await supa
          .from("user_credits")
          .select("credits")
          .eq("user_id", uid)
          .maybeSingle();

        if (creditRow) {
          await supa
            .from("user_credits")
            .update({
              credits: creditRow.credits + job.count_requested,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", uid);
        }
      }

      return new Response(
        JSON.stringify({
          status: "failed",
          contacts: null,
          message: "Il run Apify è fallito. I crediti sono stati riaccreditati.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Status is succeeded — fetch dataset items
    const datasetRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${job.apify_run_id}/dataset/items?token=${apifyToken}&clean=true&limit=500`
    );
    const datasetData = await datasetRes.json();

    if (!datasetRes.ok) {
      throw new Error(
        datasetData?.error?.message || `Apify dataset API error: ${datasetRes.status}`
      );
    }

    const items: ApifyItem[] = Array.isArray(datasetData) ? datasetData : [];

    const mappedContacts: MappedContact[] = items.map((item) => ({
      first_name: item.first_name ?? null,
      last_name:  item.last_name  ?? null,
      email:      item.email      ?? null,
      phone:      item.mobile_number ?? item.company_phone ?? null,
      company:    item.company_name  ?? null,
      website:    item.company_website ?? null,
      linkedin:   item.linkedin       ?? null,
      job_title:  item.job_title      ?? null,
      industry:   item.industry       ?? null,
      via:        item.company_street_address ?? null,
      citta:      item.company_city   ?? null,
      stato:      item.company_country ?? null,
    }));

    // Persist result in DB
    await supa
      .from("contact_gen_jobs")
      .update({
        status: "succeeded",
        result_snapshot: mappedContacts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({
        status: "succeeded",
        contacts: mappedContacts,
        message: `Trovati ${mappedContacts.length} contatti`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apify-run-status]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
