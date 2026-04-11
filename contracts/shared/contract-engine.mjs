const DEFAULT_CURRENCY = "EUR";
const RAW_HTML = Symbol.for("contract.rawHtml");

function deepClone(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asSegments(path) {
  if (!path || path === ".") return [];
  return String(path)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getValueByPath(source, path, fallback) {
  if (!path || path === ".") return source;
  let cursor = source;
  for (const segment of asSegments(path)) {
    if (cursor === null || cursor === undefined) return fallback;
    cursor = cursor[segment];
  }
  return cursor === undefined ? fallback : cursor;
}

function setValueByPath(source, path, value) {
  const segments = asSegments(path);
  if (!segments.length) return value;
  const root = Array.isArray(source) ? [...source] : { ...(source || {}) };
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    cursor[segment] = Array.isArray(next) ? [...next] : { ...(next || {}) };
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
  return root;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.filter((item) => !isEmptyValue(item)).length === 0;
  return false;
}

function sanitizeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function rawHtml(html) {
  return { [RAW_HTML]: true, html: String(html || "") };
}

function isRawHtml(value) {
  return !!(value && typeof value === "object" && value[RAW_HTML]);
}

function resolveOperand(operand, context) {
  if (operand && typeof operand === "object") {
    if ("path" in operand) return getValueByPath(context, operand.path);
    if ("value" in operand) return operand.value;
  }
  return operand;
}

function coerceNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCurrency(value, locale = "it-IT", currency = DEFAULT_CURRENCY) {
  const number = coerceNumber(value);
  if (number === null) return "";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function formatDate(value, locale = "it-IT") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function listSchemaFields(questionnaireSchema) {
  return (questionnaireSchema?.steps || []).flatMap((step) =>
    (step?.fields || []).map((field) => ({ ...field, stepId: step.id || null, stepTitle: step.title || "" }))
  );
}

function defaultFieldValue(field) {
  if (field?.default !== undefined) return deepClone(field.default);
  if (field?.type === "checkbox") return false;
  if (field?.type === "repeatable") return [];
  return "";
}

function normalizeFieldValue(field, value) {
  if (field?.type === "checkbox") return value === true;
  if (field?.type === "number" || field?.type === "currency") {
    return value === "" || value === null || value === undefined ? null : coerceNumber(value);
  }
  if (field?.type === "repeatable") {
    return Array.isArray(value) ? value.filter((item) => !isEmptyValue(item)) : [];
  }
  return value ?? "";
}

function evaluateCondition(condition, context) {
  if (!condition) return true;
  if (Array.isArray(condition.all)) return condition.all.every((entry) => evaluateCondition(entry, context));
  if (Array.isArray(condition.any)) return condition.any.some((entry) => evaluateCondition(entry, context));
  if (condition.not) return !evaluateCondition(condition.not, context);

  const op = condition.op || "eq";
  const left = getValueByPath(context, condition.path);
  const right = condition.value;

  if (op === "exists") return !isEmptyValue(left);
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  if (op === "in") return Array.isArray(right) && right.includes(left);
  if (op === "gt") return (coerceNumber(left) ?? Number.NEGATIVE_INFINITY) > (coerceNumber(right) ?? Number.POSITIVE_INFINITY);
  if (op === "gte") return (coerceNumber(left) ?? Number.NEGATIVE_INFINITY) >= (coerceNumber(right) ?? Number.POSITIVE_INFINITY);
  return true;
}

function applySchemaDefaults(questionnaireSchema, defaultValues = {}, answers = {}) {
  let merged = deepClone(defaultValues) || {};
  for (const field of listSchemaFields(questionnaireSchema)) {
    const current = getValueByPath(merged, field.name, undefined);
    if (current === undefined) {
      merged = setValueByPath(merged, field.name, defaultFieldValue(field));
    }
  }

  for (const field of listSchemaFields(questionnaireSchema)) {
    const answerValue = getValueByPath(answers, field.name, undefined);
    if (answerValue !== undefined) {
      merged = setValueByPath(merged, field.name, normalizeFieldValue(field, answerValue));
    }
  }

  return merged;
}

function validateField(field, values) {
  if (!evaluateCondition(field.visibility, values)) return null;

  const value = getValueByPath(values, field.name);
  if (field.required && isEmptyValue(value)) {
    return { field: field.name, stepId: field.stepId, message: `${field.label || field.name} è obbligatorio.` };
  }

  if ((field.type === "number" || field.type === "currency") && !isEmptyValue(value)) {
    const number = coerceNumber(value);
    if (number === null) {
      return { field: field.name, stepId: field.stepId, message: `${field.label || field.name} deve essere numerico.` };
    }
    if (field.min !== undefined && number < Number(field.min)) {
      return { field: field.name, stepId: field.stepId, message: `${field.label || field.name} deve essere almeno ${field.min}.` };
    }
    if (field.max !== undefined && number > Number(field.max)) {
      return { field: field.name, stepId: field.stepId, message: `${field.label || field.name} deve essere al massimo ${field.max}.` };
    }
  }

  if (field.pattern && typeof value === "string" && value.trim() && !new RegExp(field.pattern).test(value)) {
    return { field: field.name, stepId: field.stepId, message: `${field.label || field.name} non è valido.` };
  }

  return null;
}

function validateQuestionnaire(questionnaireSchema, values) {
  const errors = listSchemaFields(questionnaireSchema)
    .map((field) => validateField(field, values))
    .filter(Boolean);

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function computeFormula(formula, context) {
  if (!formula || typeof formula !== "object") return null;
  const op = formula.op || formula.formula || "copy";

  if (op === "copy") return resolveOperand(formula.source || formula.value || { path: formula.path }, context);

  if (op === "concat") {
    const parts = Array.isArray(formula.parts) ? formula.parts : [];
    return parts
      .map((part) => resolveOperand(part, context))
      .filter((part) => !isEmptyValue(part))
      .join(formula.separator ?? "");
  }

  if (op === "sum" || op === "multiply") {
    const values = Array.isArray(formula.values) ? formula.values : [];
    const numbers = values.map((item) => coerceNumber(resolveOperand(item, context)));
    if (numbers.some((entry) => entry === null)) return null;
    const raw = op === "sum"
      ? numbers.reduce((total, entry) => total + entry, 0)
      : numbers.reduce((total, entry) => total * entry, 1);
    if (formula.precision === undefined) return raw;
    return Number(raw.toFixed(Number(formula.precision)));
  }

  if (op === "join") {
    const items = resolveOperand(formula.source || { path: formula.path }, context);
    if (!Array.isArray(items)) return "";
    return items.filter((item) => !isEmptyValue(item)).join(formula.separator ?? ", ");
  }

  if (op === "html_list") {
    const items = resolveOperand(formula.source || { path: formula.path }, context);
    if (!Array.isArray(items)) return rawHtml("");
    return rawHtml(
      items
        .filter((item) => !isEmptyValue(item))
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")
    );
  }

  if (op === "currency_format") {
    const value = resolveOperand(formula.source || { path: formula.path }, context);
    return formatCurrency(value, formula.locale || context.locale || "it-IT", formula.currency || DEFAULT_CURRENCY);
  }

  if (op === "date_format") {
    const value = resolveOperand(formula.source || { path: formula.path }, context);
    return formatDate(value, formula.locale || context.locale || "it-IT");
  }

  return null;
}

function computeValues(computedSchema, context) {
  const computed = {};
  for (const [key, formula] of Object.entries(computedSchema || {})) {
    const value = computeFormula(formula, { ...context, computed });
    computed[key] = value;
  }
  return computed;
}

function resolveTemplateString(template, context) {
  return String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawPath) => {
    const value = getValueByPath(context, rawPath.trim(), "");
    if (isRawHtml(value)) return value.html;
    if (Array.isArray(value)) return escapeHtml(value.join(", "));
    return escapeHtml(value ?? "");
  });
}

function summarizeAnswers(questionnaireSchema, values) {
  return listSchemaFields(questionnaireSchema)
    .filter((field) => evaluateCondition(field.visibility, values))
    .map((field) => {
      const raw = getValueByPath(values, field.name);
      let display = raw;
      if (Array.isArray(raw)) display = raw.filter((entry) => !isEmptyValue(entry)).join(", ");
      if (typeof raw === "boolean") display = raw ? "Sì" : "No";
      if (field.type === "currency" && !isEmptyValue(raw)) display = formatCurrency(raw);
      if (field.type === "date" && !isEmptyValue(raw)) display = formatDate(raw);
      return { label: field.label || field.name, value: display || "—" };
    })
    .filter((entry) => !isEmptyValue(entry.value) && entry.value !== "—");
}

function buildPreviewHtml(documentData, brandProfile = {}, legalProfile = {}, renderSchema = {}) {
  const accentColor = sanitizeColor(brandProfile.accent_color, "#2448ff");
  const secondaryColor = sanitizeColor(brandProfile.secondary_color, "#0f172a");
  const brandName = escapeHtml(brandProfile.brand_name || legalProfile.registered_name || "Profilo aziendale");
  const subtitle = escapeHtml(renderSchema.subtitle || legalProfile.registered_name || "");
  const logoUrl = brandProfile.logo_public_url
    ? `<img src="${escapeHtml(brandProfile.logo_public_url)}" alt="${brandName}" class="contract-logo">`
    : `<div class="contract-brand-mark">${brandName.slice(0, 2).toUpperCase()}</div>`;

  const sectionsHtml = (documentData.sections || [])
    .map((section) => `
      <section class="contract-section">
        <div class="contract-section-header">
          <span class="contract-section-index">${escapeHtml(section.index || "")}</span>
          <h2>${escapeHtml(section.title || "Sezione")}</h2>
        </div>
        <div class="contract-section-body">${section.html || ""}</div>
      </section>
    `)
    .join("");

  return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentData.title || "Contratto")}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --contract-accent: ${accentColor};
      --contract-ink: ${secondaryColor};
      --contract-paper: #ffffff;
      --contract-muted: #586174;
      --contract-line: rgba(15,23,42,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, #f3f6fb 0%, #edf1f7 100%);
      font-family: "Inter", Arial, sans-serif;
      color: var(--contract-ink);
      padding: 32px;
    }
    .contract-shell {
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
      background: var(--contract-paper);
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 28px 80px rgba(15,23,42,0.12);
    }
    .contract-cover {
      padding: 34px 40px 28px;
      background:
        radial-gradient(circle at top right, rgba(36,72,255,0.18), transparent 36%),
        linear-gradient(135deg, rgba(36,72,255,0.08), rgba(15,23,42,0.04));
      border-bottom: 1px solid var(--contract-line);
    }
    .contract-cover-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 28px;
    }
    .contract-logo {
      max-width: 132px;
      max-height: 56px;
      display: block;
    }
    .contract-brand-mark {
      width: 56px;
      height: 56px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--contract-accent);
      color: #fff;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .contract-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      background: rgba(36,72,255,0.08);
      color: var(--contract-accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .contract-title {
      font-size: 34px;
      line-height: 1.05;
      margin: 0 0 8px;
      letter-spacing: -0.05em;
    }
    .contract-subtitle {
      margin: 0;
      color: var(--contract-muted);
      font-size: 14px;
      line-height: 1.6;
      max-width: 560px;
    }
    .contract-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .contract-meta-card {
      border: 1px solid var(--contract-line);
      border-radius: 18px;
      padding: 14px 16px;
      background: rgba(255,255,255,0.78);
    }
    .contract-meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--contract-muted);
      margin-bottom: 6px;
    }
    .contract-meta-value {
      font-size: 14px;
      font-weight: 600;
    }
    .contract-body {
      padding: 34px 40px 20px;
    }
    .contract-section {
      margin-bottom: 28px;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--contract-line);
    }
    .contract-section:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .contract-section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .contract-section-header h2 {
      font-size: 20px;
      letter-spacing: -0.04em;
      margin: 0;
    }
    .contract-section-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: rgba(36,72,255,0.1);
      color: var(--contract-accent);
      font-size: 12px;
      font-weight: 700;
    }
    .contract-section-body {
      font-size: 15px;
      line-height: 1.75;
      color: var(--contract-ink);
    }
    .contract-section-body p { margin: 0 0 14px; }
    .contract-section-body ul { margin: 0 0 14px 22px; padding: 0; }
    .contract-section-body li { margin-bottom: 6px; }
    .contract-footer {
      padding: 20px 40px 32px;
      color: var(--contract-muted);
      font-size: 12px;
      line-height: 1.6;
      border-top: 1px solid var(--contract-line);
      background: #fbfcfe;
    }
    @media print {
      body {
        padding: 0;
        background: #fff;
      }
      .contract-shell {
        max-width: none;
        border-radius: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="contract-shell">
    <header class="contract-cover">
      <div class="contract-cover-top">
        <div>
          <div class="contract-badge">${escapeHtml(documentData.contractTypeLabel || "Contratto")}</div>
        </div>
        ${logoUrl}
      </div>
      <h1 class="contract-title">${escapeHtml(documentData.title || "Contratto")}</h1>
      <p class="contract-subtitle">${subtitle}</p>
      <div class="contract-meta">
        <div class="contract-meta-card">
          <div class="contract-meta-label">Fornitore</div>
          <div class="contract-meta-value">${escapeHtml(legalProfile.registered_name || brandProfile.brand_name || "Da configurare")}</div>
        </div>
        <div class="contract-meta-card">
          <div class="contract-meta-label">Giurisdizione</div>
          <div class="contract-meta-value">${escapeHtml(documentData.jurisdiction || "IT")}</div>
        </div>
        <div class="contract-meta-card">
          <div class="contract-meta-label">Locale</div>
          <div class="contract-meta-value">${escapeHtml(documentData.locale || "it-IT")}</div>
        </div>
      </div>
    </header>
    <main class="contract-body">${sectionsHtml}</main>
    <footer class="contract-footer">
      ${escapeHtml(renderSchema.footer_note || "Documento generato dal motore contratti. Verificare il contenuto con il proprio consulente legale prima dell'uso.")}
    </footer>
  </div>
</body>
</html>`.trim();
}

function composeContract({ template, templateVersion, brandProfile = {}, legalProfile = {}, answers = {}, clauseVersions = [] }) {
  const normalizedAnswers = applySchemaDefaults(templateVersion.questionnaire_schema, templateVersion.default_values, answers);
  const validation = validateQuestionnaire(templateVersion.questionnaire_schema, normalizedAnswers);

  const computed = computeValues(templateVersion.composition_schema?.computed, {
    ...normalizedAnswers,
    answers: normalizedAnswers,
    brand: brandProfile,
    legal: legalProfile,
    locale: templateVersion.locale,
  });

  const context = {
    ...normalizedAnswers,
    answers: normalizedAnswers,
    brand: brandProfile,
    legal: legalProfile,
    computed,
    locale: templateVersion.locale,
    jurisdiction: templateVersion.jurisdiction,
  };

  const sections = [];
  for (const [index, section] of (templateVersion.composition_schema?.sections || []).entries()) {
    if (!evaluateCondition(section.condition, context)) continue;
    sections.push({
      id: section.id || `section-${index + 1}`,
      index: String(index + 1),
      title: section.title || `Sezione ${index + 1}`,
      html: resolveTemplateString(section.body_html || "", context),
    });
  }

  for (const clauseVersion of clauseVersions) {
    if (!evaluateCondition(clauseVersion.metadata?.condition, context)) continue;
    sections.push({
      id: `clause-${clauseVersion.id}`,
      index: String(sections.length + 1),
      title: clauseVersion.metadata?.title || "Clausola",
      html: resolveTemplateString(clauseVersion.body_html || "", context),
    });
  }

  const documentData = {
    title: template?.name || templateVersion.render_schema?.title || "Contratto",
    contractTypeLabel: template?.contract_type || "service_agreement",
    locale: templateVersion.locale || "it-IT",
    jurisdiction: templateVersion.jurisdiction || "IT",
    sections,
  };

  const html = buildPreviewHtml(documentData, brandProfile, legalProfile, templateVersion.render_schema || {});

  return {
    answers: normalizedAnswers,
    computedValues: computed,
    validation,
    resolvedDocument: documentData,
    resolvedHtml: html,
    summary: summarizeAnswers(templateVersion.questionnaire_schema, normalizedAnswers),
    selectedClauseVersionIds: clauseVersions.map((item) => item.id),
    rendererVersion: "contract-engine@phase0",
  };
}

export {
  applySchemaDefaults,
  composeContract,
  computeFormula,
  computeValues,
  deepClone,
  escapeHtml,
  evaluateCondition,
  formatCurrency,
  formatDate,
  getValueByPath,
  rawHtml,
  resolveTemplateString,
  summarizeAnswers,
  validateQuestionnaire,
};
