(function () {
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

  function isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return !value.trim();
    if (Array.isArray(value)) return value.filter((entry) => !isEmptyValue(entry)).length === 0;
    return false;
  }

  function evaluateCondition(condition, values) {
    if (!condition) return true;
    if (Array.isArray(condition.all)) return condition.all.every((entry) => evaluateCondition(entry, values));
    if (Array.isArray(condition.any)) return condition.any.some((entry) => evaluateCondition(entry, values));
    if (condition.not) return !evaluateCondition(condition.not, values);

    const op = condition.op || "eq";
    const left = getValueByPath(values, condition.path);
    const right = condition.value;

    if (op === "exists") return !isEmptyValue(left);
    if (op === "eq") return left === right;
    if (op === "neq") return left !== right;
    if (op === "in") return Array.isArray(right) && right.includes(left);
    if (op === "gt") return Number(left) > Number(right);
    if (op === "gte") return Number(left) >= Number(right);
    return true;
  }

  function listFields(schema) {
    return (schema?.steps || []).flatMap((step) => step.fields || []);
  }

  function mergeDefaults(schema, defaultValues, answers) {
    let merged = clone(defaultValues || {}) || {};
    for (const field of listFields(schema)) {
      const current = getValueByPath(merged, field.name, undefined);
      if (current === undefined) {
        let value = field.default;
        if (value === undefined) {
          value = field.type === "checkbox" ? false : field.type === "repeatable" ? [] : "";
        }
        merged = setValueByPath(merged, field.name, clone(value));
      }
    }
    for (const field of listFields(schema)) {
      const answerValue = getValueByPath(answers, field.name, undefined);
      if (answerValue !== undefined) {
        merged = setValueByPath(merged, field.name, clone(answerValue));
      }
    }
    return merged;
  }

  function getVisibleFields(step, values) {
    return (step?.fields || []).filter((field) => evaluateCondition(field.visibility, values));
  }

  function validateField(field, values) {
    if (!evaluateCondition(field.visibility, values)) return null;
    const value = getValueByPath(values, field.name);
    if (field.required && isEmptyValue(value)) return `${field.label || field.name} è obbligatorio.`;
    if ((field.type === "number" || field.type === "currency") && !isEmptyValue(value)) {
      if (!Number.isFinite(Number(value))) return `${field.label || field.name} deve essere numerico.`;
      if (field.min !== undefined && Number(value) < Number(field.min)) return `${field.label || field.name} deve essere almeno ${field.min}.`;
      if (field.max !== undefined && Number(value) > Number(field.max)) return `${field.label || field.name} deve essere al massimo ${field.max}.`;
    }
    return null;
  }

  function validateStep(step, values) {
    const errors = {};
    for (const field of getVisibleFields(step, values)) {
      const message = validateField(field, values);
      if (message) errors[field.name] = message;
    }
    return errors;
  }

  function renderSelect(field, value) {
    const options = (field.options || [])
      .map((option) => {
        const item = typeof option === "string" ? { value: option, label: option } : option;
        return `<option value="${escapeHtml(item.value)}" ${String(value ?? "") === String(item.value) ? "selected" : ""}>${escapeHtml(item.label)}</option>`;
      })
      .join("");

    return `<select class="ctq-input" data-ct-field="${escapeHtml(field.name)}" data-ct-type="${escapeHtml(field.type || "select")}" onchange="contractsUI.handleFieldInput(this)">${options}</select>`;
  }

  function renderRadio(field, value) {
    return `<div class="ctq-radio-grid">${
      (field.options || []).map((option, index) => {
        const item = typeof option === "string" ? { value: option, label: option } : option;
        const id = `${field.name}_${index}`;
        return `
          <label class="ctq-radio ${String(value ?? "") === String(item.value) ? "selected" : ""}" for="${escapeHtml(id)}">
            <input id="${escapeHtml(id)}" type="radio" name="${escapeHtml(field.name)}" value="${escapeHtml(item.value)}" ${String(value ?? "") === String(item.value) ? "checked" : ""} data-ct-field="${escapeHtml(field.name)}" data-ct-type="radio" onchange="contractsUI.handleFieldInput(this)">
            <span>${escapeHtml(item.label)}</span>
          </label>`;
      }).join("")
    }</div>`;
  }

  function renderRepeatable(field, value) {
    const items = Array.isArray(value) && value.length ? value : [""];
    return `
      <div class="ctq-repeatable">
        ${items.map((item, index) => `
          <div class="ctq-repeat-row">
            <input
              type="text"
              class="ctq-input"
              value="${escapeHtml(item || "")}"
              placeholder="${escapeHtml(field.placeholder || "Voce")}"
              data-ct-repeat-field="${escapeHtml(field.name)}"
              data-ct-repeat-index="${index}"
              oninput="contractsUI.handleRepeatableInput(this)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="contractsUI.removeRepeatableItem('${escapeHtml(field.name)}', ${index})">Rimuovi</button>
          </div>`).join("")}
        <button type="button" class="btn btn-secondary btn-sm" onclick="contractsUI.addRepeatableItem('${escapeHtml(field.name)}')">＋ Aggiungi voce</button>
      </div>`;
  }

  function renderField(field, values, errors) {
    const value = getValueByPath(values, field.name, field.type === "checkbox" ? false : field.type === "repeatable" ? [] : "");
    const error = errors?.[field.name];
    let control = "";

    if (field.type === "textarea") {
      control = `<textarea class="ctq-input ctq-textarea" placeholder="${escapeHtml(field.placeholder || "")}" data-ct-field="${escapeHtml(field.name)}" data-ct-type="textarea" oninput="contractsUI.handleFieldInput(this)">${escapeHtml(value || "")}</textarea>`;
    } else if (field.type === "select") {
      control = renderSelect(field, value);
    } else if (field.type === "radio") {
      control = renderRadio(field, value);
    } else if (field.type === "checkbox") {
      control = `
        <label class="ctq-checkbox">
          <input type="checkbox" data-ct-field="${escapeHtml(field.name)}" data-ct-type="checkbox" ${value ? "checked" : ""} onchange="contractsUI.handleFieldInput(this)">
          <span>${escapeHtml(field.checkboxLabel || field.label || field.name)}</span>
        </label>`;
    } else if (field.type === "repeatable") {
      control = renderRepeatable(field, value);
    } else {
      const inputType = field.type === "currency" || field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
      const step = field.type === "currency" ? "0.01" : field.step || (field.type === "number" ? "1" : "");
      control = `
        <input
          type="${inputType}"
          class="ctq-input"
          value="${escapeHtml(value ?? "")}"
          placeholder="${escapeHtml(field.placeholder || "")}"
          data-ct-field="${escapeHtml(field.name)}"
          data-ct-type="${escapeHtml(field.type || "text")}"
          ${field.min !== undefined ? `min="${escapeHtml(field.min)}"` : ""}
          ${field.max !== undefined ? `max="${escapeHtml(field.max)}"` : ""}
          ${step ? `step="${escapeHtml(step)}"` : ""}
          oninput="contractsUI.handleFieldInput(this)">`;
    }

    return `
      <div class="ctq-field ${field.type === "textarea" ? "full" : ""}">
        <label class="ctq-label">${escapeHtml(field.label || field.name)}${field.required ? " *" : ""}</label>
        ${field.helpText ? `<div class="ctq-help">${escapeHtml(field.helpText)}</div>` : ""}
        ${control}
        ${error ? `<div class="ctq-error">${escapeHtml(error)}</div>` : ""}
      </div>`;
  }

  function renderStep(step, values, errors) {
    const fields = getVisibleFields(step, values);
    const fieldsHtml = fields.map((field) => renderField(field, values, errors)).join("");
    return `
      <section class="ctq-card">
        <div class="ctq-step-header">
          <div>
            <div class="ctq-eyebrow">${escapeHtml(step.stepLabel || "Questionario")}</div>
            <h2>${escapeHtml(step.title || "Sezione")}</h2>
            ${step.description ? `<p>${escapeHtml(step.description)}</p>` : ""}
          </div>
        </div>
        <div class="ctq-grid">${fieldsHtml || `<div class="ctq-empty">Nessun campo da compilare in questo step.</div>`}</div>
      </section>`;
  }

  function summarizeAnswers(schema, values) {
    return listFields(schema)
      .filter((field) => evaluateCondition(field.visibility, values))
      .map((field) => {
        const raw = getValueByPath(values, field.name);
        if (isEmptyValue(raw)) return null;
        let display = raw;
        if (Array.isArray(raw)) display = raw.join(", ");
        if (typeof raw === "boolean") display = raw ? "Sì" : "No";
        return { label: field.label || field.name, value: String(display) };
      })
      .filter(Boolean);
  }

  window.ContractQuestionnaireEngine = {
    evaluateCondition,
    getVisibleFields,
    mergeDefaults,
    renderStep,
    summarizeAnswers,
    validateStep,
  };
})();
