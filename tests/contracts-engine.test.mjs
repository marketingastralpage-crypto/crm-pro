import test from "node:test";
import assert from "node:assert/strict";

import {
  applySchemaDefaults,
  composeContract,
  evaluateCondition,
  validateQuestionnaire,
} from "../contracts/shared/contract-engine.mjs";

const questionnaireSchema = {
  steps: [
    {
      id: "counterparty",
      fields: [
        { name: "counterparty_company", label: "Cliente", type: "text", required: true },
        { name: "include_report_clause", label: "Report", type: "checkbox", required: false },
      ],
    },
    {
      id: "fees",
      fields: [
        { name: "monthly_fee", label: "Canone", type: "currency", required: true, min: 0 },
        { name: "term_months", label: "Durata", type: "number", required: true, min: 1 },
      ],
    },
  ],
};

const templateVersion = {
  questionnaire_schema: questionnaireSchema,
  default_values: { include_report_clause: true, term_months: 12 },
  composition_schema: {
    computed: {
      contract_value_number: { op: "multiply", values: [{ path: "monthly_fee" }, { path: "term_months" }], precision: 2 },
      contract_value: { op: "currency_format", path: "computed.contract_value_number", locale: "it-IT", currency: "EUR" },
    },
    sections: [
      { id: "fees", title: "Corrispettivo", body_html: "<p>{{counterparty_company}} · {{computed.contract_value}}</p>" },
      { id: "report", title: "Report", condition: { op: "eq", path: "include_report_clause", value: true }, body_html: "<p>Report incluso.</p>" },
    ],
  },
  render_schema: { subtitle: "Test subtitle" },
  locale: "it-IT",
  jurisdiction: "IT",
};

test("applySchemaDefaults merges field defaults with answers", () => {
  const merged = applySchemaDefaults(questionnaireSchema, { monthly_fee: 100, term_months: 12 }, { counterparty_company: "Acme" });
  assert.equal(merged.counterparty_company, "Acme");
  assert.equal(merged.include_report_clause, false);
  assert.equal(merged.monthly_fee, 100);
  assert.equal(merged.term_months, 12);
});

test("evaluateCondition handles eq and groups", () => {
  const values = { status: "published", locale: "it-IT" };
  assert.equal(evaluateCondition({ op: "eq", path: "status", value: "published" }, values), true);
  assert.equal(evaluateCondition({ any: [{ op: "eq", path: "status", value: "draft" }, { op: "eq", path: "locale", value: "it-IT" }] }, values), true);
  assert.equal(evaluateCondition({ not: { op: "eq", path: "status", value: "draft" } }, values), true);
});

test("validateQuestionnaire returns blocking errors", () => {
  const validation = validateQuestionnaire(questionnaireSchema, { include_report_clause: true, monthly_fee: null, term_months: 0 });
  assert.equal(validation.isValid, false);
  assert.equal(validation.errors.length, 3);
});

test("composeContract resolves computed values and conditional sections", () => {
  const result = composeContract({
    template: { name: "Contratto demo", contract_type: "service_agreement" },
    templateVersion,
    brandProfile: { brand_name: "AstralPage" },
    legalProfile: { registered_name: "AstralPage S.R.L.", vat_number: "IT12345678901" },
    answers: {
      counterparty_company: "Cliente S.r.l.",
      include_report_clause: true,
      monthly_fee: 2500,
      term_months: 6,
    },
    clauseVersions: [],
  });

  assert.equal(result.validation.isValid, true);
  assert.equal(result.computedValues.contract_value, "15.000,00 €");
  assert.equal(result.resolvedDocument.sections.length, 2);
  assert.match(result.resolvedHtml, /Cliente S\.r\.l\./);
  assert.match(result.resolvedHtml, /15\.000,00/);
});
