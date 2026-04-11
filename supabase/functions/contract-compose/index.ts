import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { composeContract } from "../../../contracts/shared/contract-engine.mjs";
import {
  buildPublicStorageUrl,
  corsHeaders,
  jsonResponse,
  verifyUser,
} from "../_shared/contracts.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { supabase, user } = await verifyUser(req);
    const body = await req.json();
    const templateVersionId = String(body?.template_version_id || "");
    const draftId = String(body?.draft_id || "");
    const answers = body?.answers || {};
    const clauseVersionIds = Array.isArray(body?.clause_version_ids) ? body.clause_version_ids : [];

    if (!templateVersionId) {
      return jsonResponse({ error: "template_version_id obbligatorio" }, 400);
    }

    const { data: templateVersion, error: versionError } = await supabase
      .from("contract_template_versions")
      .select("*")
      .eq("id", templateVersionId)
      .maybeSingle();

    if (versionError || !templateVersion) {
      return jsonResponse({ error: "Versione template non trovata" }, 404);
    }

    const { data: template, error: templateError } = await supabase
      .from("contract_templates")
      .select("id, scope, owner_user_id, name, description, contract_type, status")
      .eq("id", templateVersion.template_id)
      .maybeSingle();

    if (templateError || !template) {
      return jsonResponse({ error: "Template non trovato" }, 404);
    }

    if (template.scope !== "platform" && template.owner_user_id !== user.id) {
      return jsonResponse({ error: "Template non accessibile" }, 403);
    }

    const [{ data: brandProfile }, { data: legalProfile }] = await Promise.all([
      supabase.from("contract_brand_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("organization_legal_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    const normalizedBrand = brandProfile || {};
    if (normalizedBrand.logo_asset_path) {
      normalizedBrand.logo_public_url = buildPublicStorageUrl("contract-assets", normalizedBrand.logo_asset_path);
    }

    const clauseVersions = clauseVersionIds.length
      ? (await supabase
        .from("contract_clause_block_versions")
        .select("id, body_html, metadata, status")
        .in("id", clauseVersionIds)).data || []
      : [];

    const result = composeContract({
      template,
      templateVersion,
      brandProfile: normalizedBrand,
      legalProfile: legalProfile || {},
      answers,
      clauseVersions,
    });

    const profileWarnings = [];
    if (!legalProfile?.registered_name) profileWarnings.push("Profilo legale incompleto: ragione sociale mancante.");
    if (!legalProfile?.vat_number) profileWarnings.push("Profilo legale incompleto: partita IVA mancante.");

    if (draftId) {
      await supabase
        .from("contract_drafts")
        .update({
          preview_cache: {
            resolved_html: result.resolvedHtml,
            resolved_document: result.resolvedDocument,
            computed_values: result.computedValues,
            summary: result.summary,
            validation: result.validation,
            renderer_version: result.rendererVersion,
          },
          validation_state: {
            stepErrors: result.validation.errors,
            isValid: result.validation.isValid,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", draftId)
        .eq("user_id", user.id);
    }

    return jsonResponse({
      ok: true,
      resolved_document: result.resolvedDocument,
      resolved_html: result.resolvedHtml,
      computed_values: result.computedValues,
      validation: result.validation,
      summary: result.summary,
      selected_clause_version_ids: result.selectedClauseVersionIds,
      renderer_version: result.rendererVersion,
      profile_warnings: profileWarnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
