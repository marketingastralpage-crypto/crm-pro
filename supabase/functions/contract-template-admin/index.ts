import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, jsonResponse, verifyUser } from "../_shared/contracts.ts";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `template-${Date.now()}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { supabase, user } = await verifyUser(req);
    const body = await req.json();
    const action = String(body?.action || "");

    if (!action) return jsonResponse({ error: "action obbligatoria" }, 400);

    if (action === "create_template") {
      const name = String(body?.name || "").trim();
      if (!name) return jsonResponse({ error: "name obbligatorio" }, 400);

      const { data, error } = await supabase
        .from("contract_templates")
        .insert({
          scope: "user",
          owner_user_id: user.id,
          slug: slugify(String(body?.slug || name)),
          name,
          description: String(body?.description || ""),
          contract_type: String(body?.contract_type || "service_agreement"),
          status: "draft",
        })
        .select("*")
        .maybeSingle();

      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true, template: data });
    }

    if (action === "create_version") {
      const templateId = String(body?.template_id || "");
      if (!templateId) return jsonResponse({ error: "template_id obbligatorio" }, 400);

      const { data: template, error: templateError } = await supabase
        .from("contract_templates")
        .select("*")
        .eq("id", templateId)
        .eq("owner_user_id", user.id)
        .eq("scope", "user")
        .maybeSingle();

      if (templateError || !template) return jsonResponse({ error: "Template non trovato" }, 404);

      const { data: latestVersion } = await supabase
        .from("contract_template_versions")
        .select("version_number")
        .eq("template_id", templateId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const versionNumber = Number(latestVersion?.version_number || 0) + 1;
      const { data: version, error: versionError } = await supabase
        .from("contract_template_versions")
        .insert({
          template_id: templateId,
          version_number: versionNumber,
          status: body?.status === "published" ? "published" : "draft",
          questionnaire_schema: body?.questionnaire_schema || { steps: [] },
          composition_schema: body?.composition_schema || {},
          render_schema: body?.render_schema || {},
          default_values: body?.default_values || {},
          locale: String(body?.locale || "it-IT"),
          jurisdiction: String(body?.jurisdiction || "IT"),
          published_at: body?.status === "published" ? new Date().toISOString() : null,
          created_by_user_id: user.id,
        })
        .select("*")
        .maybeSingle();

      if (versionError) return jsonResponse({ error: versionError.message }, 400);

      if (body?.make_current !== false) {
        await supabase
          .from("contract_templates")
          .update({
            current_version_id: version.id,
            status: body?.status === "published" ? "published" : template.status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", templateId);
      }

      return jsonResponse({ ok: true, version });
    }

    if (action === "publish_version") {
      const templateId = String(body?.template_id || "");
      const versionId = String(body?.version_id || "");
      if (!templateId || !versionId) return jsonResponse({ error: "template_id e version_id obbligatori" }, 400);

      const { data: template } = await supabase
        .from("contract_templates")
        .select("id")
        .eq("id", templateId)
        .eq("owner_user_id", user.id)
        .eq("scope", "user")
        .maybeSingle();

      if (!template) return jsonResponse({ error: "Template non trovato" }, 404);

      const publishedAt = new Date().toISOString();
      const { data: version, error: versionError } = await supabase
        .from("contract_template_versions")
        .update({ status: "published", published_at: publishedAt })
        .eq("id", versionId)
        .eq("template_id", templateId)
        .select("*")
        .maybeSingle();

      if (versionError || !version) return jsonResponse({ error: versionError?.message || "Versione non trovata" }, 404);

      await supabase
        .from("contract_templates")
        .update({
          current_version_id: versionId,
          status: "published",
          updated_at: publishedAt,
        })
        .eq("id", templateId);

      return jsonResponse({ ok: true, version });
    }

    if (action === "duplicate_template" || action === "clone_platform_template") {
      const sourceTemplateId = String(body?.template_id || "");
      if (!sourceTemplateId) return jsonResponse({ error: "template_id obbligatorio" }, 400);

      const { data: sourceTemplate, error: sourceTemplateError } = await supabase
        .from("contract_templates")
        .select("*")
        .eq("id", sourceTemplateId)
        .maybeSingle();

      if (sourceTemplateError || !sourceTemplate) return jsonResponse({ error: "Template origine non trovato" }, 404);
      if (sourceTemplate.scope !== "platform" && sourceTemplate.owner_user_id !== user.id) {
        return jsonResponse({ error: "Template origine non accessibile" }, 403);
      }

      const { data: sourceVersion, error: sourceVersionError } = await supabase
        .from("contract_template_versions")
        .select("*")
        .eq("id", sourceTemplate.current_version_id)
        .maybeSingle();

      if (sourceVersionError || !sourceVersion) return jsonResponse({ error: "Versione sorgente non trovata" }, 404);

      const baseName = String(body?.name || `${sourceTemplate.name} copia`).trim();
      const { data: clonedTemplate, error: cloneTemplateError } = await supabase
        .from("contract_templates")
        .insert({
          scope: "user",
          owner_user_id: user.id,
          slug: slugify(String(body?.slug || baseName)),
          name: baseName,
          description: sourceTemplate.description,
          contract_type: sourceTemplate.contract_type,
          status: "draft",
          source_template_id: sourceTemplate.id,
        })
        .select("*")
        .maybeSingle();

      if (cloneTemplateError || !clonedTemplate) {
        return jsonResponse({ error: cloneTemplateError?.message || "Errore duplicazione template" }, 400);
      }

      const { data: clonedVersion, error: cloneVersionError } = await supabase
        .from("contract_template_versions")
        .insert({
          template_id: clonedTemplate.id,
          version_number: 1,
          status: "draft",
          questionnaire_schema: sourceVersion.questionnaire_schema,
          composition_schema: sourceVersion.composition_schema,
          render_schema: sourceVersion.render_schema,
          default_values: sourceVersion.default_values,
          locale: sourceVersion.locale,
          jurisdiction: sourceVersion.jurisdiction,
          created_by_user_id: user.id,
        })
        .select("*")
        .maybeSingle();

      if (cloneVersionError || !clonedVersion) {
        return jsonResponse({ error: cloneVersionError?.message || "Errore duplicazione versione" }, 400);
      }

      await supabase
        .from("contract_templates")
        .update({ current_version_id: clonedVersion.id, updated_at: new Date().toISOString() })
        .eq("id", clonedTemplate.id);

      return jsonResponse({ ok: true, template: clonedTemplate, version: clonedVersion });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
