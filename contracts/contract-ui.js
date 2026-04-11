(function () {
  const state = {
    initialized: false,
    loading: false,
    error: "",
    view: "library",
    templates: [],
    drafts: [],
    instances: [],
    exportsByInstance: {},
    brandProfile: null,
    legalProfile: null,
    activeDraft: null,
    activeTemplate: null,
    activeVersion: null,
    answers: {},
    stepIndex: 0,
    stepErrors: {},
    composeResult: null,
    busyMessage: "",
    autosaveTimer: null,
  };

  const DEFAULT_BRAND = {
    brand_name: "",
    accent_color: "#2448ff",
    secondary_color: "#0f172a",
    font_key: "inter",
    header_variant: "split",
    footer_variant: "minimal",
    signature_layout: "signatory-right",
    logo_asset_path: "",
    theme_tokens: {},
  };

  const DEFAULT_LEGAL = {
    registered_name: "",
    vat_number: "",
    tax_code: "",
    address_line1: "",
    city: "",
    province: "",
    postal_code: "",
    country: "Italia",
    representative_name: "",
    representative_role: "",
    contact_email: "",
    contact_phone: "",
    privacy_controller_text: "",
    forum_text: "",
  };

  function getDb() {
    return window.db;
  }

  function getCurrentUserSafe() {
    return typeof window.getCurrentUser === "function" ? window.getCurrentUser() : null;
  }

  function notify(message, type) {
    if (typeof window.toast === "function") window.toast(message, type || "ok");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function getValueByPath(source, path, fallback) {
    if (!path) return source;
    const segments = String(path).split(".").filter(Boolean);
    let cursor = source;
    for (const segment of segments) {
      if (cursor === null || cursor === undefined) return fallback;
      cursor = cursor[segment];
    }
    return cursor === undefined ? fallback : cursor;
  }

  function setValueByPath(source, path, value) {
    const segments = String(path).split(".").filter(Boolean);
    if (!segments.length) return value;
    const root = Array.isArray(source) ? [...source] : { ...(source || {}) };
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = segments[i];
      const next = cursor[key];
      cursor[key] = Array.isArray(next) ? [...next] : { ...(next || {}) };
      cursor = cursor[key];
    }
    cursor[segments[segments.length - 1]] = value;
    return root;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function getContractAssetPublicUrl(path) {
    const cleanPath = String(path || "").trim();
    if (!cleanPath || !getDb()) return "";
    const { data } = getDb().storage.from("contract-assets").getPublicUrl(cleanPath);
    return data?.publicUrl || "";
  }

  function mergeBrandProfile(row) {
    const profile = { ...DEFAULT_BRAND, ...(row || {}) };
    if (profile.logo_asset_path) {
      profile.logo_public_url = getContractAssetPublicUrl(profile.logo_asset_path);
    }
    return profile;
  }

  function mergeLegalProfile(row) {
    return { ...DEFAULT_LEGAL, ...(row || {}) };
  }

  function getHeaderTabs() {
    const tabs = [
      { id: "library", label: "Libreria" },
      { id: "brand", label: "Brand & Legale" },
      { id: "history", label: "Storico" },
    ];
    return `
      <div class="ct-tabs">
        ${tabs.map((tab) => `
          <button class="ct-tab ${state.view === tab.id ? "active" : ""}" onclick="contractsUI.go('${tab.id}')">${escapeHtml(tab.label)}</button>
        `).join("")}
      </div>`;
  }

  function getSchema() {
    return state.activeVersion?.questionnaire_schema || { steps: [] };
  }

  function getSteps() {
    return getSchema().steps || [];
  }

  async function loadTemplates() {
    const db = getDb();
    const user = getCurrentUserSafe();
    if (!db || !user) return [];

    const { data, error } = await db
      .from("contract_templates")
      .select("id, scope, owner_user_id, slug, name, description, contract_type, status, current_version_id, updated_at, created_at")
      .or(`owner_user_id.eq.${user.id},scope.eq.platform`)
      .order("scope", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function loadDrafts() {
    const db = getDb();
    const user = getCurrentUserSafe();
    if (!db || !user) return [];

    const { data, error } = await db
      .from("contract_drafts")
      .select("id, template_id, template_version_id, title, answers, preview_cache, validation_state, status, last_autosave_at, updated_at, created_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(12);

    if (error) throw error;
    return data || [];
  }

  async function loadInstances() {
    const db = getDb();
    const user = getCurrentUserSafe();
    if (!db || !user) return { instances: [], exportsByInstance: {} };

    const { data: instances, error: instancesError } = await db
      .from("contract_instances")
      .select("id, title, template_name, contract_type, status, created_at, generated_at, renderer_version")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(18);

    if (instancesError) throw instancesError;

    const ids = (instances || []).map((item) => item.id);
    if (!ids.length) return { instances: instances || [], exportsByInstance: {} };

    const { data: exportsRows, error: exportsError } = await db
      .from("contract_exports")
      .select("id, instance_id, export_type, storage_bucket, storage_path, created_at, renderer_version")
      .eq("user_id", user.id)
      .in("instance_id", ids)
      .order("created_at", { ascending: false });

    if (exportsError) throw exportsError;

    const exportsByInstance = {};
    for (const exportRow of exportsRows || []) {
      const list = exportsByInstance[exportRow.instance_id] || [];
      list.push(exportRow);
      exportsByInstance[exportRow.instance_id] = list;
    }

    return { instances: instances || [], exportsByInstance };
  }

  async function loadProfiles() {
    const db = getDb();
    const user = getCurrentUserSafe();
    if (!db || !user) return { brandProfile: mergeBrandProfile(), legalProfile: mergeLegalProfile() };

    const [brandResult, legalResult] = await Promise.all([
      db.from("contract_brand_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      db.from("organization_legal_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (brandResult.error) throw brandResult.error;
    if (legalResult.error) throw legalResult.error;

    return {
      brandProfile: mergeBrandProfile(brandResult.data),
      legalProfile: mergeLegalProfile(legalResult.data),
    };
  }

  async function fetchTemplateVersion(versionId) {
    const db = getDb();
    const { data, error } = await db
      .from("contract_template_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function fetchTemplate(templateId) {
    const db = getDb();
    const { data, error } = await db
      .from("contract_templates")
      .select("id, scope, owner_user_id, slug, name, description, contract_type, status, current_version_id, updated_at, created_at")
      .eq("id", templateId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function ensureData(force) {
    if (state.loading) return;
    if (state.initialized && !force) return;

    state.loading = true;
    state.error = "";
    renderContracts();

    try {
      const [templates, drafts, history, profiles] = await Promise.all([
        loadTemplates(),
        loadDrafts(),
        loadInstances(),
        loadProfiles(),
      ]);

      state.templates = templates;
      state.drafts = drafts;
      state.instances = history.instances;
      state.exportsByInstance = history.exportsByInstance;
      state.brandProfile = profiles.brandProfile;
      state.legalProfile = profiles.legalProfile;
      state.initialized = true;
    } catch (error) {
      state.error = error?.message || String(error);
    } finally {
      state.loading = false;
      renderContracts();
    }
  }

  function setBusy(message) {
    state.busyMessage = message || "";
    renderContracts();
  }

  function renderLoading(message) {
    return `
      <div class="ct-shell">
        ${getHeaderTabs()}
        <div class="ct-empty">
          <div class="ct-empty-icon">⌛</div>
          <div class="ct-empty-title">${escapeHtml(message || "Caricamento contratti...")}</div>
          <div class="ct-empty-sub">Sto caricando template, bozze, profili e storico.</div>
        </div>
      </div>`;
  }

  function renderError(message) {
    return `
      <div class="ct-shell">
        ${getHeaderTabs()}
        <div class="ct-empty">
          <div class="ct-empty-icon">⚠️</div>
          <div class="ct-empty-title">Contratti non disponibile</div>
          <div class="ct-empty-sub">${escapeHtml(message || "Errore sconosciuto")}</div>
          <div class="ct-inline-actions">
            <button class="btn btn-secondary" onclick="contractsUI.retry()">Riprova</button>
          </div>
        </div>
      </div>`;
  }

  function getActiveDraftTemplateName() {
    return state.activeTemplate?.name || state.activeDraft?.title || "Contratto";
  }

  function renderLibrary() {
    const platformTemplates = state.templates.filter((item) => item.scope === "platform");
    const userTemplates = state.templates.filter((item) => item.scope !== "platform");
    const draftsHtml = state.drafts.length
      ? state.drafts.slice(0, 5).map((draft) => `
          <button class="ct-mini-card" onclick="contractsUI.resumeDraft('${escapeHtml(draft.id)}')">
            <div class="ct-mini-card-title">${escapeHtml(draft.title || "Bozza contratto")}</div>
            <div class="ct-mini-card-sub">${escapeHtml(draft.status || "draft")} · ${escapeHtml(formatDate(draft.updated_at || draft.created_at))}</div>
          </button>
        `).join("")
      : `<div class="ct-empty-inline">Nessuna bozza salvata.</div>`;

    const templatesHtml = (group, label) => `
      <section class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-eyebrow">${escapeHtml(label)}</div>
            <h2>${escapeHtml(label === "Template piattaforma" ? "Template approvati" : "Template utente")}</h2>
          </div>
        </div>
        <div class="ct-grid">
          ${group.length ? group.map((template) => `
            <article class="ct-template-card">
              <div class="ct-template-top">
                <span class="ct-badge ${template.scope === "platform" ? "platform" : "user"}">${template.scope === "platform" ? "Piattaforma" : "Utente"}</span>
                <span class="ct-badge muted">${escapeHtml(template.status || "draft")}</span>
              </div>
              <h3>${escapeHtml(template.name)}</h3>
              <p>${escapeHtml(template.description || "Template strutturato per una composizione deterministica.")}</p>
              <div class="ct-template-meta">
                <span>${escapeHtml(template.contract_type || "service_agreement")}</span>
                <span>${escapeHtml(template.current_version_id ? "Versione pronta" : "Nessuna versione")}</span>
              </div>
              <div class="ct-inline-actions">
                <button class="btn btn-primary btn-sm" ${template.current_version_id ? "" : "disabled"} onclick="contractsUI.startTemplate('${escapeHtml(template.id)}')">Nuova bozza</button>
              </div>
            </article>
          `).join("") : `<div class="ct-empty-inline">Nessun template disponibile.</div>`}
        </div>
      </section>`;

    return `
      <div class="ct-shell">
        ${getHeaderTabs()}
        <section class="ct-hero">
          <div>
            <div class="ct-eyebrow">Phase 0</div>
            <h1>Contratti strutturati dentro la SPA esistente</h1>
            <p>Template versionati, brand e profilo legale separati, composizione server-side e storico export nello stesso spazio utente.</p>
          </div>
          <div class="ct-hero-actions">
            <button class="btn btn-primary" onclick="contractsUI.go('brand')">Configura profili</button>
            <button class="btn btn-secondary" onclick="contractsUI.go('history')">Apri storico</button>
          </div>
        </section>
        <div class="ct-layout">
          <div class="ct-main-stack">
            ${templatesHtml(platformTemplates, "Template piattaforma")}
            ${templatesHtml(userTemplates, "Template utente")}
          </div>
          <aside class="ct-side-stack">
            <section class="ct-card">
              <div class="ct-card-head">
                <div>
                  <div class="ct-eyebrow">Bozze</div>
                  <h2>Riprendi lavoro</h2>
                </div>
              </div>
              <div class="ct-mini-stack">${draftsHtml}</div>
            </section>
            <section class="ct-card">
              <div class="ct-card-head">
                <div>
                  <div class="ct-eyebrow">Profili</div>
                  <h2>Stato configurazione</h2>
                </div>
              </div>
              <div class="ct-checklist">
                <div class="ct-check ${state.brandProfile?.brand_name || state.brandProfile?.logo_asset_path ? "ok" : ""}">
                  <span class="ct-check-dot"></span><span>Brand profile</span>
                </div>
                <div class="ct-check ${state.legalProfile?.registered_name ? "ok" : ""}">
                  <span class="ct-check-dot"></span><span>Profilo legale</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>`;
  }

  function renderBrand() {
    const brand = state.brandProfile || mergeBrandProfile();
    const legal = state.legalProfile || mergeLegalProfile();
    const logoPreview = brand.logo_public_url
      ? `
        <div class="ct-logo-preview">
          <img src="${escapeHtml(brand.logo_public_url)}" alt="Logo brand">
          <button class="btn btn-secondary btn-sm" onclick="contractsUI.removeBrandLogo()">Rimuovi logo</button>
        </div>`
      : `<div class="ct-empty-inline">Nessun logo caricato.</div>`;

    return `
      <div class="ct-shell">
        ${getHeaderTabs()}
        <div class="ct-double-grid">
          <section class="ct-card">
            <div class="ct-card-head">
              <div>
                <div class="ct-eyebrow">Brand</div>
                <h2>Profilo visivo contratto</h2>
              </div>
            </div>
            <div class="ct-form-grid">
              <div class="form-group full">
                <label>Nome brand</label>
                <input id="ct_brand_name" type="text" value="${escapeHtml(brand.brand_name || "")}" placeholder="AstralPage Studio">
              </div>
              <div class="form-group">
                <label>Colore accento</label>
                <input id="ct_brand_accent" type="text" value="${escapeHtml(brand.accent_color || "#2448ff")}" placeholder="#2448ff">
              </div>
              <div class="form-group">
                <label>Colore testo</label>
                <input id="ct_brand_secondary" type="text" value="${escapeHtml(brand.secondary_color || "#0f172a")}" placeholder="#0f172a">
              </div>
              <div class="form-group">
                <label>Header</label>
                <select id="ct_brand_header">
                  <option value="split" ${brand.header_variant === "split" ? "selected" : ""}>Split</option>
                  <option value="minimal" ${brand.header_variant === "minimal" ? "selected" : ""}>Minimal</option>
                </select>
              </div>
              <div class="form-group">
                <label>Footer</label>
                <select id="ct_brand_footer">
                  <option value="minimal" ${brand.footer_variant === "minimal" ? "selected" : ""}>Minimal</option>
                  <option value="dense" ${brand.footer_variant === "dense" ? "selected" : ""}>Dense</option>
                </select>
              </div>
              <div class="form-group full">
                <label>Logo contratto</label>
                ${logoPreview}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onchange="contractsUI.uploadBrandLogo(this)">
              </div>
            </div>
          </section>
          <section class="ct-card">
            <div class="ct-card-head">
              <div>
                <div class="ct-eyebrow">Legale</div>
                <h2>Profilo giuridico azienda</h2>
              </div>
            </div>
            <div class="ct-form-grid">
              <div class="form-group full">
                <label>Ragione sociale</label>
                <input id="ct_legal_registered_name" type="text" value="${escapeHtml(legal.registered_name || "")}" placeholder="AstralPage S.R.L.">
              </div>
              <div class="form-group">
                <label>Partita IVA</label>
                <input id="ct_legal_vat" type="text" value="${escapeHtml(legal.vat_number || "")}" placeholder="IT01234567890">
              </div>
              <div class="form-group">
                <label>Codice fiscale</label>
                <input id="ct_legal_tax_code" type="text" value="${escapeHtml(legal.tax_code || "")}" placeholder="01234567890">
              </div>
              <div class="form-group full">
                <label>Indirizzo sede</label>
                <input id="ct_legal_address" type="text" value="${escapeHtml(legal.address_line1 || "")}" placeholder="Via Roma 1">
              </div>
              <div class="form-group">
                <label>Città</label>
                <input id="ct_legal_city" type="text" value="${escapeHtml(legal.city || "")}" placeholder="Bologna">
              </div>
              <div class="form-group">
                <label>Provincia</label>
                <input id="ct_legal_province" type="text" value="${escapeHtml(legal.province || "")}" placeholder="BO">
              </div>
              <div class="form-group">
                <label>CAP</label>
                <input id="ct_legal_postal" type="text" value="${escapeHtml(legal.postal_code || "")}" placeholder="40100">
              </div>
              <div class="form-group">
                <label>Paese</label>
                <input id="ct_legal_country" type="text" value="${escapeHtml(legal.country || "Italia")}" placeholder="Italia">
              </div>
              <div class="form-group">
                <label>Rappresentante</label>
                <input id="ct_legal_rep_name" type="text" value="${escapeHtml(legal.representative_name || "")}" placeholder="Mario Rossi">
              </div>
              <div class="form-group">
                <label>Ruolo</label>
                <input id="ct_legal_rep_role" type="text" value="${escapeHtml(legal.representative_role || "")}" placeholder="Amministratore Unico">
              </div>
              <div class="form-group">
                <label>Email legale</label>
                <input id="ct_legal_email" type="email" value="${escapeHtml(legal.contact_email || "")}" placeholder="legal@example.com">
              </div>
              <div class="form-group">
                <label>Telefono</label>
                <input id="ct_legal_phone" type="text" value="${escapeHtml(legal.contact_phone || "")}" placeholder="+39 051 1234567">
              </div>
              <div class="form-group full">
                <label>Testo privacy/controller</label>
                <textarea id="ct_legal_privacy">${escapeHtml(legal.privacy_controller_text || "")}</textarea>
              </div>
              <div class="form-group full">
                <label>Foro / giurisdizione di default</label>
                <textarea id="ct_legal_forum">${escapeHtml(legal.forum_text || "")}</textarea>
              </div>
            </div>
            <div class="ct-inline-actions">
              <button class="btn btn-primary" onclick="contractsUI.saveProfiles()">Salva profili</button>
            </div>
          </section>
        </div>
      </div>`;
  }

  function renderQuestionnaire() {
    const steps = getSteps();
    const currentStep = steps[state.stepIndex];
    const progress = steps.length ? Math.round(((state.stepIndex + 1) / steps.length) * 100) : 0;
    const stepLabel = steps.length ? `Step ${state.stepIndex + 1} / ${steps.length}` : "Questionario";
    const body = currentStep
      ? window.ContractQuestionnaireEngine.renderStep(
          { ...currentStep, stepLabel },
          state.answers,
          state.stepErrors
        )
      : `<div class="ct-empty-inline">Questo template non contiene ancora uno schema questionario.</div>`;

    return `
      <div class="ct-shell">
        <div class="ct-editor-head">
          <div>
            <div class="ct-eyebrow">Bozza</div>
            <h1>${escapeHtml(getActiveDraftTemplateName())}</h1>
            <p>${escapeHtml(state.activeTemplate?.description || "Compila i campi richiesti. La composizione finale resta server-side.")}</p>
          </div>
          <div class="ct-editor-actions">
            <button class="btn btn-secondary" onclick="contractsUI.go('library')">Libreria</button>
            <button class="btn btn-secondary" onclick="contractsUI.go('brand')">Brand</button>
          </div>
        </div>
        <div class="ct-progress-card">
          <div class="ct-progress-label">${escapeHtml(stepLabel)}</div>
          <div class="ct-progress-bar"><div class="ct-progress-fill" style="width:${progress}%"></div></div>
        </div>
        ${body}
        <div class="ct-footer-bar">
          <button class="btn btn-secondary" onclick="contractsUI.prevStep()" ${state.stepIndex === 0 ? "disabled" : ""}>Indietro</button>
          <div class="ct-footer-meta">Autosave ${state.activeDraft?.last_autosave_at ? `· ${escapeHtml(formatDate(state.activeDraft.last_autosave_at))}` : "attivo"}</div>
          <button class="btn btn-primary" onclick="contractsUI.nextStep()">${state.stepIndex >= steps.length - 1 ? "Genera anteprima" : "Continua"}</button>
        </div>
      </div>`;
  }

  function renderPreview() {
    const preview = state.composeResult;
    const summary = preview?.summary || window.ContractQuestionnaireEngine.summarizeAnswers(getSchema(), state.answers);
    const validationErrors = preview?.validation?.errors || [];
    const currentHtml = preview?.resolved_html || preview?.resolvedHtml || "";

    return `
      <div class="ct-shell">
        <div class="ct-editor-head">
          <div>
            <div class="ct-eyebrow">Anteprima</div>
            <h1>${escapeHtml(getActiveDraftTemplateName())}</h1>
            <p>Stesso snapshot HTML per preview e pipeline export. Renderer version: ${escapeHtml(preview?.renderer_version || preview?.rendererVersion || "n/d")}.</p>
          </div>
          <div class="ct-editor-actions">
            <button class="btn btn-secondary" onclick="contractsUI.goToQuestionnaire()">Modifica risposte</button>
            <button class="btn btn-secondary" onclick="contractsUI.go('history')">Storico</button>
          </div>
        </div>
        <div class="ct-preview-layout">
          <aside class="ct-preview-sidebar">
            <section class="ct-card">
              <div class="ct-card-head">
                <div>
                  <div class="ct-eyebrow">Riepilogo</div>
                  <h2>Risposte congelate</h2>
                </div>
              </div>
              <div class="ct-summary-list">
                ${summary.length ? summary.map((item) => `
                  <div class="ct-summary-item">
                    <span>${escapeHtml(item.label)}</span>
                    <strong>${escapeHtml(item.value)}</strong>
                  </div>`).join("") : `<div class="ct-empty-inline">Nessuna risposta da mostrare.</div>`}
              </div>
            </section>
            <section class="ct-card">
              <div class="ct-card-head">
                <div>
                  <div class="ct-eyebrow">Validazione</div>
                  <h2>Esito</h2>
                </div>
              </div>
              ${validationErrors.length
                ? `<div class="ct-alert warn">${validationErrors.map((error) => `<div>${escapeHtml(error.message || String(error))}</div>`).join("")}</div>`
                : `<div class="ct-alert ok">Nessun errore bloccante sul questionario.</div>`}
              <div class="ct-inline-actions">
                <button class="btn btn-secondary btn-sm" onclick="contractsUI.composePreview()">Aggiorna anteprima</button>
                <button class="btn btn-primary btn-sm" onclick="contractsUI.exportContract('html')">Esporta HTML</button>
                <button class="btn btn-primary btn-sm" onclick="contractsUI.exportContract('pdf')">Esporta PDF</button>
              </div>
            </section>
          </aside>
          <section class="ct-card ct-preview-card">
            <div class="ct-card-head">
              <div>
                <div class="ct-eyebrow">Snapshot</div>
                <h2>Documento renderizzato</h2>
              </div>
            </div>
            ${currentHtml
              ? `<iframe class="ct-preview-frame" srcdoc="${escapeHtml(currentHtml)}"></iframe>`
              : `<div class="ct-empty-inline">Genera l'anteprima per visualizzare il documento.</div>`}
          </section>
        </div>
      </div>`;
  }

  function renderHistory() {
    const items = state.instances.length
      ? state.instances.map((instance) => {
          const exportsRows = state.exportsByInstance[instance.id] || [];
          return `
            <article class="ct-history-card">
              <div class="ct-history-head">
                <div>
                  <h3>${escapeHtml(instance.title || instance.template_name || "Contratto")}</h3>
                  <p>${escapeHtml(instance.template_name || instance.contract_type || "contract")} · ${escapeHtml(formatDate(instance.generated_at || instance.created_at))}</p>
                </div>
                <span class="ct-badge muted">${escapeHtml(instance.status || "generated")}</span>
              </div>
              <div class="ct-inline-actions">
                ${exportsRows.length ? exportsRows.map((entry) => `
                  <button class="btn btn-secondary btn-sm" onclick="contractsUI.openExport('${escapeHtml(entry.storage_bucket)}','${escapeHtml(entry.storage_path)}')">
                    ${escapeHtml(entry.export_type.toUpperCase())}
                  </button>
                `).join("") : `<span class="ct-empty-inline">Nessun export associato.</span>`}
              </div>
            </article>`;
        }).join("")
      : `<div class="ct-empty">
          <div class="ct-empty-icon">🗂️</div>
          <div class="ct-empty-title">Nessun contratto esportato</div>
          <div class="ct-empty-sub">L'export HTML/PDF comparirà qui dopo la prima generazione.</div>
        </div>`;

    return `
      <div class="ct-shell">
        ${getHeaderTabs()}
        <section class="ct-card">
          <div class="ct-card-head">
            <div>
              <div class="ct-eyebrow">Storico</div>
              <h2>Contratti generati</h2>
            </div>
          </div>
          <div class="ct-history-list">${items}</div>
        </section>
      </div>`;
  }

  function renderBusyOverlay() {
    if (!state.busyMessage) return "";
    return `
      <div class="ct-busy-overlay">
        <div class="ct-busy-card">
          <div class="spinner"></div>
          <div>${escapeHtml(state.busyMessage)}</div>
        </div>
      </div>`;
  }

  function updateTopbar() {
    const container = document.getElementById("topbarActions");
    if (!container) return;

    if (state.view === "questionnaire" || state.view === "preview") {
      container.innerHTML = `
        <button class="btn btn-secondary" onclick="contractsUI.composePreview()">Aggiorna Anteprima</button>
        <button class="btn btn-primary" onclick="contractsUI.exportContract('html')">Esporta HTML</button>`;
      return;
    }

    container.innerHTML = `
      <button class="btn btn-secondary" onclick="contractsUI.go('brand')">Brand & Legale</button>
      <button class="btn btn-primary" onclick="contractsUI.go('library')">Libreria Contratti</button>`;
  }

  function renderContracts() {
    const content = document.getElementById("content");
    if (!content) return;

    updateTopbar();
    content.style.padding = "24px 28px";
    content.style.display = "";
    content.style.flexDirection = "";
    content.style.overflow = "";

    let html = "";
    if (state.error) html = renderError(state.error);
    else if (state.loading && !state.initialized) html = renderLoading();
    else if (state.view === "brand") html = renderBrand();
    else if (state.view === "history") html = renderHistory();
    else if (state.view === "questionnaire") html = renderQuestionnaire();
    else if (state.view === "preview") html = renderPreview();
    else html = renderLibrary();

    content.innerHTML = `${html}${renderBusyOverlay()}`;
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => {
      persistDraft(true).catch((error) => console.error("[contracts autosave]", error));
    }, 700);
  }

  async function persistDraft(silent) {
    if (!state.activeDraft?.id) return;
    const payload = {
      answers: clone(state.answers || {}),
      validation_state: { stepIndex: state.stepIndex, stepErrors: state.stepErrors || {} },
      last_autosave_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await getDb()
      .from("contract_drafts")
      .update(payload)
      .eq("id", state.activeDraft.id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (!silent) notify(`Errore salvataggio bozza: ${error.message}`, "err");
      throw error;
    }

    if (data) {
      state.activeDraft = data;
      state.drafts = [data, ...state.drafts.filter((item) => item.id !== data.id)].slice(0, 12);
      if (!silent) renderContracts();
    }
  }

  async function startTemplate(templateId) {
    try {
      const template = state.templates.find((item) => item.id === templateId) || await fetchTemplate(templateId);
      if (!template?.current_version_id) {
        notify("Il template non ha una versione pubblicata.", "err");
        return;
      }

      setBusy("Creo una nuova bozza contratto...");
      const version = await fetchTemplateVersion(template.current_version_id);
      const answers = window.ContractQuestionnaireEngine.mergeDefaults(version.questionnaire_schema, version.default_values, {});
      const title = `${template.name} · ${new Date().toLocaleDateString("it-IT")}`;

      const { data, error } = await getDb()
        .from("contract_drafts")
        .insert({
          user_id: getCurrentUserSafe().id,
          template_id: template.id,
          template_version_id: version.id,
          title,
          answers,
          validation_state: {},
          preview_cache: {},
          status: "draft",
        })
        .select("*")
        .maybeSingle();

      if (error) throw error;

      state.activeTemplate = template;
      state.activeVersion = version;
      state.activeDraft = data;
      state.answers = answers;
      state.stepIndex = 0;
      state.stepErrors = {};
      state.composeResult = null;
      state.view = "questionnaire";
      state.drafts = [data, ...state.drafts.filter((item) => item.id !== data.id)].slice(0, 12);
    } catch (error) {
      notify(`Errore creazione bozza: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  async function resumeDraft(draftId) {
    try {
      setBusy("Carico la bozza selezionata...");
      const draft = state.drafts.find((item) => item.id === draftId);
      if (!draft) throw new Error("Bozza non trovata");

      const [template, version] = await Promise.all([
        fetchTemplate(draft.template_id),
        fetchTemplateVersion(draft.template_version_id),
      ]);

      state.activeDraft = draft;
      state.activeTemplate = template;
      state.activeVersion = version;
      state.answers = window.ContractQuestionnaireEngine.mergeDefaults(version.questionnaire_schema, version.default_values, draft.answers || {});
      state.composeResult = draft.preview_cache?.resolved_html || draft.preview_cache?.resolvedHtml ? draft.preview_cache : null;
      state.stepIndex = draft.validation_state?.stepIndex || 0;
      state.stepErrors = draft.validation_state?.stepErrors || {};
      state.view = state.composeResult ? "preview" : "questionnaire";
    } catch (error) {
      notify(`Errore apertura bozza: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  async function nextStep() {
    const steps = getSteps();
    const step = steps[state.stepIndex];
    if (!step) {
      notify("Questo template non contiene step da compilare.", "warn");
      return;
    }

    const errors = window.ContractQuestionnaireEngine.validateStep(step, state.answers);
    state.stepErrors = errors;
    if (Object.keys(errors).length) {
      notify("Compila i campi obbligatori prima di continuare.", "err");
      renderContracts();
      return;
    }

    if (state.stepIndex >= steps.length - 1) {
      await composePreview();
      return;
    }

    state.stepIndex += 1;
    await persistDraft(true).catch(() => {});
    renderContracts();
  }

  function prevStep() {
    if (state.stepIndex <= 0) return;
    state.stepIndex -= 1;
    renderContracts();
  }

  async function composePreview() {
    try {
      await persistDraft(true).catch(() => {});
      setBusy("Genero l'anteprima dal motore contratti...");
      const { data, error } = await getDb().functions.invoke("contract-compose", {
        body: {
          template_version_id: state.activeVersion.id,
          draft_id: state.activeDraft?.id,
          answers: state.answers,
        },
      });

      if (error || data?.error) throw new Error(data?.error || error.message);

      state.composeResult = data;
      state.view = "preview";
      if (state.activeDraft) state.activeDraft.preview_cache = data;
    } catch (error) {
      notify(`Errore composizione contratto: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  async function exportContract(format) {
    if (!state.activeDraft?.id && !state.activeVersion?.id) {
      notify("Apri prima una bozza contratto.", "err");
      return;
    }

    try {
      setBusy(`Esporto il contratto in formato ${format.toUpperCase()}...`);
      const { data, error } = await getDb().functions.invoke("contract-export", {
        body: {
          draft_id: state.activeDraft?.id,
          template_version_id: state.activeVersion?.id,
          answers: state.answers,
          format,
        },
      });

      if (error || data?.error) throw new Error(data?.error || error.message);
      if (data?.warning) notify(data.warning, "warn");
      if (data?.download_url) window.open(data.download_url, "_blank", "noopener");
      await ensureData(true);
      state.view = "history";
    } catch (error) {
      notify(`Errore export contratto: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  function handleFieldInput(element) {
    const field = element.dataset.ctField;
    const type = element.dataset.ctType || element.type || "text";
    let value;

    if (type === "checkbox") value = !!element.checked;
    else if (type === "number" || type === "currency") value = element.value === "" ? null : Number(element.value);
    else value = element.value;

    state.answers = setValueByPath(state.answers, field, value);
    delete state.stepErrors[field];
    state.composeResult = null;
    scheduleAutosave();

    if (type === "checkbox" || type === "select" || type === "radio") renderContracts();
  }

  function handleRepeatableInput(element) {
    const field = element.dataset.ctRepeatField;
    const index = Number(element.dataset.ctRepeatIndex || "0");
    const items = Array.isArray(getValueByPath(state.answers, field, [])) ? [...getValueByPath(state.answers, field, [])] : [];
    while (items.length <= index) items.push("");
    items[index] = element.value;
    state.answers = setValueByPath(state.answers, field, items);
    delete state.stepErrors[field];
    state.composeResult = null;
    scheduleAutosave();
  }

  function addRepeatableItem(field) {
    const items = Array.isArray(getValueByPath(state.answers, field, [])) ? [...getValueByPath(state.answers, field, [])] : [];
    items.push("");
    state.answers = setValueByPath(state.answers, field, items);
    renderContracts();
    scheduleAutosave();
  }

  function removeRepeatableItem(field, index) {
    const items = Array.isArray(getValueByPath(state.answers, field, [])) ? [...getValueByPath(state.answers, field, [])] : [];
    items.splice(index, 1);
    state.answers = setValueByPath(state.answers, field, items);
    renderContracts();
    scheduleAutosave();
  }

  async function saveProfiles() {
    try {
      const user = getCurrentUserSafe();
      if (!user) throw new Error("Utente non autenticato");
      const now = new Date().toISOString();

      // Read the form before showing the busy overlay, otherwise the rerender
      // would recreate the inputs from stale state and discard the typed values.
      const brandPayload = {
        user_id: user.id,
        brand_name: document.getElementById("ct_brand_name")?.value.trim() || "",
        accent_color: document.getElementById("ct_brand_accent")?.value.trim() || "#2448ff",
        secondary_color: document.getElementById("ct_brand_secondary")?.value.trim() || "#0f172a",
        header_variant: document.getElementById("ct_brand_header")?.value || "split",
        footer_variant: document.getElementById("ct_brand_footer")?.value || "minimal",
        signature_layout: state.brandProfile?.signature_layout || "signatory-right",
        font_key: state.brandProfile?.font_key || "inter",
        logo_asset_path: state.brandProfile?.logo_asset_path || null,
        theme_tokens: state.brandProfile?.theme_tokens || {},
        updated_at: now,
      };

      const legalPayload = {
        user_id: user.id,
        registered_name: document.getElementById("ct_legal_registered_name")?.value.trim() || "",
        vat_number: document.getElementById("ct_legal_vat")?.value.trim() || "",
        tax_code: document.getElementById("ct_legal_tax_code")?.value.trim() || "",
        address_line1: document.getElementById("ct_legal_address")?.value.trim() || "",
        city: document.getElementById("ct_legal_city")?.value.trim() || "",
        province: document.getElementById("ct_legal_province")?.value.trim() || "",
        postal_code: document.getElementById("ct_legal_postal")?.value.trim() || "",
        country: document.getElementById("ct_legal_country")?.value.trim() || "Italia",
        representative_name: document.getElementById("ct_legal_rep_name")?.value.trim() || "",
        representative_role: document.getElementById("ct_legal_rep_role")?.value.trim() || "",
        contact_email: document.getElementById("ct_legal_email")?.value.trim() || "",
        contact_phone: document.getElementById("ct_legal_phone")?.value.trim() || "",
        privacy_controller_text: document.getElementById("ct_legal_privacy")?.value.trim() || "",
        forum_text: document.getElementById("ct_legal_forum")?.value.trim() || "",
        updated_at: now,
      };

      setBusy("Salvo profilo brand e legale...");

      const [brandResult, legalResult] = await Promise.all([
        getDb().from("contract_brand_profiles").upsert(brandPayload, { onConflict: "user_id" }).select("*").maybeSingle(),
        getDb().from("organization_legal_profiles").upsert(legalPayload, { onConflict: "user_id" }).select("*").maybeSingle(),
      ]);

      if (brandResult.error) throw brandResult.error;
      if (legalResult.error) throw legalResult.error;

      state.brandProfile = mergeBrandProfile(brandResult.data);
      state.legalProfile = mergeLegalProfile(legalResult.data);
      notify("Profili contratto salvati.", "ok");
    } catch (error) {
      notify(`Errore salvataggio profili: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  async function uploadBrandLogo(input) {
    const file = input?.files?.[0];
    const user = getCurrentUserSafe();
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      notify("Il logo contratto non può superare 2MB.", "err");
      input.value = "";
      return;
    }

    try {
      setBusy("Carico il logo contratto...");
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const nextPath = `${user.id}/brand-logo.${ext}`;
      const previousPath = state.brandProfile?.logo_asset_path || "";
      const storage = getDb().storage.from("contract-assets");

      const { error: uploadError } = await storage.upload(nextPath, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data, error } = await getDb()
        .from("contract_brand_profiles")
        .upsert({
          user_id: user.id,
          brand_name: state.brandProfile?.brand_name || "",
          accent_color: state.brandProfile?.accent_color || "#2448ff",
          secondary_color: state.brandProfile?.secondary_color || "#0f172a",
          header_variant: state.brandProfile?.header_variant || "split",
          footer_variant: state.brandProfile?.footer_variant || "minimal",
          signature_layout: state.brandProfile?.signature_layout || "signatory-right",
          font_key: state.brandProfile?.font_key || "inter",
          logo_asset_path: nextPath,
          theme_tokens: state.brandProfile?.theme_tokens || {},
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })
        .select("*")
        .maybeSingle();

      if (error) throw error;
      if (previousPath && previousPath !== nextPath) await storage.remove([previousPath]).catch(() => {});
      state.brandProfile = mergeBrandProfile(data);
      notify("Logo contratto caricato.", "ok");
    } catch (error) {
      notify(`Errore upload logo: ${error?.message || error}`, "err");
    } finally {
      input.value = "";
      setBusy("");
      renderContracts();
    }
  }

  async function removeBrandLogo() {
    const previousPath = state.brandProfile?.logo_asset_path || "";
    if (!previousPath) return;
    try {
      setBusy("Rimuovo il logo contratto...");
      await getDb().storage.from("contract-assets").remove([previousPath]).catch(() => {});
      const { data, error } = await getDb()
        .from("contract_brand_profiles")
        .upsert({
          user_id: getCurrentUserSafe().id,
          brand_name: state.brandProfile?.brand_name || "",
          accent_color: state.brandProfile?.accent_color || "#2448ff",
          secondary_color: state.brandProfile?.secondary_color || "#0f172a",
          header_variant: state.brandProfile?.header_variant || "split",
          footer_variant: state.brandProfile?.footer_variant || "minimal",
          signature_layout: state.brandProfile?.signature_layout || "signatory-right",
          font_key: state.brandProfile?.font_key || "inter",
          logo_asset_path: null,
          theme_tokens: state.brandProfile?.theme_tokens || {},
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })
        .select("*")
        .maybeSingle();

      if (error) throw error;
      state.brandProfile = mergeBrandProfile(data);
      notify("Logo contratto rimosso.", "ok");
    } catch (error) {
      notify(`Errore rimozione logo: ${error?.message || error}`, "err");
    } finally {
      setBusy("");
      renderContracts();
    }
  }

  async function openExport(bucket, path) {
    try {
      const { data, error } = await getDb().storage.from(bucket).createSignedUrl(path, 3600);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    } catch (error) {
      notify(`Errore apertura export: ${error?.message || error}`, "err");
    }
  }

  function go(view) {
    state.view = view;
    state.busyMessage = "";
    renderContracts();
  }

  function goToQuestionnaire() {
    state.view = "questionnaire";
    renderContracts();
  }

  async function retry() {
    state.error = "";
    await ensureData(true);
  }

  window.renderContracts = function () {
    if (!state.initialized && !state.loading && !state.error) {
      ensureData(false).catch((error) => {
        state.error = error?.message || String(error);
        renderContracts();
      });
    }
    renderContracts();
  };

  window.contractsUI = {
    addRepeatableItem,
    composePreview,
    exportContract,
    go,
    goToQuestionnaire,
    handleFieldInput,
    handleRepeatableInput,
    nextStep,
    openExport,
    prevStep,
    removeBrandLogo,
    removeRepeatableItem,
    resumeDraft,
    retry,
    saveProfiles,
    startTemplate,
    uploadBrandLogo,
  };
})();
