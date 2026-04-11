import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { composeContract } from "../../../contracts/shared/contract-engine.mjs";
import {
  buildPublicStorageUrl,
  corsHeaders,
  getEnv,
  jsonResponse,
  sha256Hex,
  verifyUser,
} from "../_shared/contracts.ts";

function bytesFromBase64(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function callPdfRenderer(html: string, title: string) {
  const rendererUrl = Deno.env.get("CONTRACT_RENDERER_URL");
  const rendererSecret = Deno.env.get("CONTRACT_RENDERER_SECRET");
  if (!rendererUrl || !rendererSecret) {
    return { ok: false, error: "PDF renderer non configurato" };
  }

  const response = await fetch(rendererUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-renderer-secret": rendererSecret,
    },
    body: JSON.stringify({ html, title }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.pdf_base64) {
    return { ok: false, error: payload?.error || `Renderer HTTP ${response.status}` };
  }

  return {
    ok: true,
    pdfBytes: bytesFromBase64(payload.pdf_base64),
    rendererVersion: payload.renderer_version || "external-renderer",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { supabase, user } = await verifyUser(req);
    const body = await req.json();
    const draftId = String(body?.draft_id || "");
    const templateVersionId = String(body?.template_version_id || "");
    const format = String(body?.format || "html").toLowerCase();
    let answers = body?.answers || {};

    let draft = null;
    if (draftId) {
      const { data } = await supabase
        .from("contract_drafts")
        .select("*")
        .eq("id", draftId)
        .eq("user_id", user.id)
        .maybeSingle();
      draft = data;
      if (draft?.answers) answers = draft.answers;
    }

    const resolvedTemplateVersionId = draft?.template_version_id || templateVersionId;
    if (!resolvedTemplateVersionId) {
      return jsonResponse({ error: "template_version_id obbligatorio" }, 400);
    }

    const { data: templateVersion } = await supabase
      .from("contract_template_versions")
      .select("*")
      .eq("id", resolvedTemplateVersionId)
      .maybeSingle();
    if (!templateVersion) return jsonResponse({ error: "Versione template non trovata" }, 404);

    const { data: template } = await supabase
      .from("contract_templates")
      .select("*")
      .eq("id", templateVersion.template_id)
      .maybeSingle();
    if (!template) return jsonResponse({ error: "Template non trovato" }, 404);
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

    const result = composeContract({
      template,
      templateVersion,
      brandProfile: normalizedBrand,
      legalProfile: legalProfile || {},
      answers,
      clauseVersions: [],
    });

    const { data: instance, error: instanceError } = await supabase
      .from("contract_instances")
      .insert({
        user_id: user.id,
        draft_id: draft?.id || null,
        template_id: template.id,
        template_version_id: templateVersion.id,
        template_name: template.name,
        contract_type: template.contract_type,
        title: draft?.title || template.name,
        selected_clause_version_ids: result.selectedClauseVersionIds,
        answers: result.answers,
        computed_values: result.computedValues,
        resolved_document: result.resolvedDocument,
        resolved_html: result.resolvedHtml,
        brand_snapshot: normalizedBrand,
        legal_snapshot: legalProfile || {},
        status: "generated",
        renderer_version: result.rendererVersion,
        generated_by_user_id: user.id,
      })
      .select("*")
      .maybeSingle();

    if (instanceError || !instance) {
      return jsonResponse({ error: instanceError?.message || "Impossibile creare l'istanza contratto" }, 500);
    }

    const htmlPath = `${user.id}/${instance.id}/contract.html`;
    const htmlBytes = new TextEncoder().encode(result.resolvedHtml);
    const htmlChecksum = await sha256Hex(htmlBytes);
    const { error: htmlUploadError } = await supabase
      .storage
      .from("contract-exports")
      .upload(htmlPath, htmlBytes, {
        upsert: true,
        contentType: "text/html; charset=utf-8",
        cacheControl: "3600",
      });

    if (htmlUploadError) return jsonResponse({ error: htmlUploadError.message }, 500);

    await supabase
      .from("contract_exports")
      .insert({
        user_id: user.id,
        instance_id: instance.id,
        export_type: "html",
        storage_bucket: "contract-exports",
        storage_path: htmlPath,
        renderer_version: result.rendererVersion,
        checksum: htmlChecksum,
      });

    let warning = "";
    let downloadPath = htmlPath;

    if (format === "pdf") {
      const pdfResponse = await callPdfRenderer(result.resolvedHtml, instance.title || template.name);
      if (!pdfResponse.ok) {
        warning = pdfResponse.error;
      } else {
        const pdfPath = `${user.id}/${instance.id}/contract.pdf`;
        const pdfChecksum = await sha256Hex(pdfResponse.pdfBytes);
        const { error: pdfUploadError } = await supabase
          .storage
          .from("contract-exports")
          .upload(pdfPath, pdfResponse.pdfBytes, {
            upsert: true,
            contentType: "application/pdf",
            cacheControl: "3600",
          });

        if (!pdfUploadError) {
          await supabase
            .from("contract_exports")
            .insert({
              user_id: user.id,
              instance_id: instance.id,
              export_type: "pdf",
              storage_bucket: "contract-exports",
              storage_path: pdfPath,
              renderer_version: pdfResponse.rendererVersion,
              checksum: pdfChecksum,
            });

          await supabase
            .from("contract_instances")
            .update({ status: "exported" })
            .eq("id", instance.id);

          downloadPath = pdfPath;
        } else {
          warning = pdfUploadError.message;
        }
      }
    }

    if (draft?.id) {
      await supabase
        .from("contract_drafts")
        .update({
          status: "ready",
          preview_cache: {
            resolved_html: result.resolvedHtml,
            resolved_document: result.resolvedDocument,
            computed_values: result.computedValues,
            summary: result.summary,
            validation: result.validation,
            renderer_version: result.rendererVersion,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft.id)
        .eq("user_id", user.id);
    }

    const signed = await supabase.storage.from("contract-exports").createSignedUrl(downloadPath, 3600);
    return jsonResponse({
      ok: true,
      instance_id: instance.id,
      download_url: signed.data?.signedUrl || null,
      storage_path: downloadPath,
      warning,
      renderer_version: format === "pdf" && !warning ? "pdf" : result.rendererVersion,
      supabase_url: getEnv("SUPABASE_URL"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
