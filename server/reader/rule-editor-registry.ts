import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { CONDITION_OPERATOR_LABELS, decodeOntraportDateCode } from "./condition-utils.js";

function resolveDir(): string {
  try {
    const { fileURLToPath } = require("url");
    if (typeof import.meta !== "undefined" && (import.meta as any).url) {
      return dirname(fileURLToPath((import.meta as any).url));
    }
  } catch {}
  return join(process.cwd(), "server", "reader");
}

const __dirname = resolveDir();

interface DataOption {
  value: string | number;
  label: string;
}

interface Component {
  name: string;
  description: string;
  key: string;
  type: string;
  dataOptions?: DataOption[];
}

interface RuleEditorEntry {
  key: string;
  description: string;
  related_objects?: string[];
  type: "trigger" | "condition" | "label";
  visibility?: Record<string, any>;
  components?: Component[];
  json_example?: Record<string, any>;
}

interface RuleEditorRegistry {
  events: RuleEditorEntry[];
  conditions: RuleEditorEntry[];
}

let cachedRegistry: RuleEditorRegistry | null = null;

function loadRegistry(): RuleEditorRegistry {
  if (cachedRegistry) return cachedRegistry;
  const yamlPath = join(__dirname, "rule-editor-statements.yaml");
  if (!existsSync(yamlPath)) {
    cachedRegistry = { events: [], conditions: [] };
    return cachedRegistry;
  }
  const raw = readFileSync(yamlPath, "utf-8");
  cachedRegistry = parseYaml(raw) as RuleEditorRegistry;
  return cachedRegistry;
}

const eventLookupCache = new Map<string, RuleEditorEntry>();
const conditionLookupCache = new Map<string, RuleEditorEntry>();

function ensureLookups(): void {
  if (eventLookupCache.size > 0 || conditionLookupCache.size > 0) return;
  const reg = loadRegistry();
  for (const e of reg.events) eventLookupCache.set(e.key, e);
  for (const c of reg.conditions) conditionLookupCache.set(c.key, c);
}

export function getEventEntry(key: string): RuleEditorEntry | undefined {
  ensureLookups();
  return eventLookupCache.get(key);
}

export function getConditionEntry(key: string): RuleEditorEntry | undefined {
  ensureLookups();
  return conditionLookupCache.get(key);
}

function inferNamespace(comp: Component): string | null {
  const key = comp.key?.toLowerCase() || "";
  const type = comp.type?.toLowerCase() || "";
  const name = comp.name?.toLowerCase() || "";
  if (key.includes("tag") || type.includes("tag") || name === "tag") return "tag";
  if (key.includes("campaign") || type.includes("campaign") || name === "campaign") return "campaign";
  if (key.includes("message") || key.includes("email") || type.includes("message") || name === "message") return "message";
  if (key.includes("form") || type.includes("form") || name === "form") return "form";
  if (key.includes("product") || type.includes("product") || name === "product") return "product";
  if (key.includes("page") || key.includes("landing") || type.includes("page") || name === "page") return "page";
  if (key.includes("field") || type.includes("field") || name === "field") return "field";
  return null;
}

function resolveComponentValue(comp: Component, rawValue: string, enrichmentNames?: Record<string, string>): string {
  if (comp.dataOptions) {
    const match = comp.dataOptions.find(o => String(o.value) === String(rawValue));
    if (match) return match.label;
  }

  if (enrichmentNames) {
    const ns = inferNamespace(comp);
    if (ns) {
      const namespacedKey = `${ns}:${rawValue}`;
      if (enrichmentNames[namespacedKey]) return enrichmentNames[namespacedKey];
    }
    if (enrichmentNames[`field:${rawValue}`]) return enrichmentNames[`field:${rawValue}`];
  }

  if (rawValue === "0" && comp.type.includes("object_selector")) {
    return "Any";
  }

  if (comp.type === "form_control_input_date_time" || comp.type === "form_control_input_date") {
    const ts = parseInt(rawValue, 10);
    if (!isNaN(ts) && ts > 946684800 && ts < 4102444800) {
      const d = new Date(ts * 1000);
      const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
      return d.toLocaleDateString("en-US", options);
    }
  }

  const decoded = decodeOntraportDateCode(rawValue);
  if (decoded) return decoded;

  return rawValue;
}

export interface ResolvedEventDescription {
  eventKey: string;
  baseDescription: string;
  resolvedDescription: string;
  relatedObjects: string[];
  componentDetails: Array<{ name: string; value: string; rawValue: string }>;
}

export function resolveEventStatement(
  eventKey: string,
  config: Record<string, any>,
  enrichmentNames?: Record<string, string>,
): ResolvedEventDescription | null {
  ensureLookups();
  const entry = eventLookupCache.get(eventKey);
  if (!entry) {
    return {
      eventKey,
      baseDescription: eventKey.replace(/_/g, " "),
      resolvedDescription: eventKey.replace(/_/g, " "),
      relatedObjects: [],
      componentDetails: [],
    };
  }

  const componentDetails: Array<{ name: string; value: string; rawValue: string }> = [];
  if (entry.components) {
    for (const comp of entry.components) {
      const rawValue = config[comp.key];
      if (rawValue != null && rawValue !== "") {
        const resolved = resolveComponentValue(comp, String(rawValue), enrichmentNames);
        componentDetails.push({ name: comp.name, value: resolved, rawValue: String(rawValue) });
      }
    }
  }

  let resolvedDesc = entry.description.replace(/%s/g, "Contact");
  for (const cd of componentDetails) {
    if (cd.value !== "Any" && cd.value !== cd.rawValue) {
      resolvedDesc += ` (${cd.name}: "${cd.value}")`;
    }
  }

  return {
    eventKey,
    baseDescription: entry.description.replace(/%s/g, "Contact"),
    resolvedDescription: resolvedDesc,
    relatedObjects: entry.related_objects || [],
    componentDetails,
  };
}

export interface ResolvedConditionDescription {
  conditionKey: string;
  baseDescription: string;
  resolvedDescription: string;
  relatedObjects: string[];
  componentDetails: Array<{ name: string; value: string; rawValue: string }>;
}

function resolveFieldCondition(
  config: Record<string, any>,
  enrichmentNames?: Record<string, string>,
): ResolvedConditionDescription {
  const rawField = config.a0 || "";
  const rawOp = config.a1 || "";
  const rawValue = config.a2 || "";

  const fieldName = enrichmentNames?.[`field:${rawField}`] || rawField;
  const opLabel = CONDITION_OPERATOR_LABELS[rawOp] || rawOp;
  const valueName = enrichmentNames?.[`field_value:${rawValue}`] || decodeOntraportDateCode(rawValue) || rawValue;

  const resolvedDesc = opLabel === "is filled" || opLabel === "is not filled"
    ? `Contact field "${fieldName}" ${opLabel}`
    : `Contact field "${fieldName}" ${opLabel} "${valueName}"`;

  return {
    conditionKey: "field_condition",
    baseDescription: "Contact field matches a specified value",
    resolvedDescription: resolvedDesc,
    relatedObjects: [],
    componentDetails: [
      { name: "field", value: fieldName, rawValue: rawField },
      { name: "operator", value: opLabel, rawValue: rawOp },
      { name: "value", value: valueName, rawValue: rawValue },
    ],
  };
}

export function resolveConditionStatement(
  conditionKey: string,
  config: Record<string, any>,
  enrichmentNames?: Record<string, string>,
): ResolvedConditionDescription | null {
  ensureLookups();

  if (conditionKey === "field_condition") {
    return resolveFieldCondition(config, enrichmentNames);
  }

  const entry = conditionLookupCache.get(conditionKey);
  if (!entry) {
    return {
      conditionKey,
      baseDescription: conditionKey.replace(/_/g, " "),
      resolvedDescription: conditionKey.replace(/_/g, " "),
      relatedObjects: [],
      componentDetails: [],
    };
  }

  const componentDetails: Array<{ name: string; value: string; rawValue: string }> = [];
  if (entry.components) {
    for (const comp of entry.components) {
      const rawValue = config[comp.key];
      if (rawValue != null && rawValue !== "") {
        const resolved = resolveComponentValue(comp, String(rawValue), enrichmentNames);
        componentDetails.push({ name: comp.name, value: resolved, rawValue: String(rawValue) });
      }
    }
  }

  let resolvedDesc = entry.description.replace(/%s/g, "Contact");
  for (const cd of componentDetails) {
    if (cd.value !== "Any" && cd.value !== cd.rawValue) {
      resolvedDesc += ` (${cd.name}: "${cd.value}")`;
    }
  }

  return {
    conditionKey,
    baseDescription: entry.description.replace(/%s/g, "Contact"),
    resolvedDescription: resolvedDesc,
    relatedObjects: entry.related_objects || [],
    componentDetails,
  };
}

export function buildEnrichmentNameMap(cache: {
  fields?: Record<string, string>;
  field_values?: Record<string, string>;
  messages?: Record<string, { subject: string; body_summary?: string } | string>;
  campaigns?: Record<string, string>;
  products?: Record<string, { name: string; price?: string } | string>;
  forms?: Record<string, string>;
  tags?: Record<string, string>;
  landing_pages?: Record<string, string>;
}): Record<string, string> {
  const names: Record<string, string> = {};

  if (cache.fields) {
    for (const [id, name] of Object.entries(cache.fields)) {
      names[`field:${id}`] = name;
    }
  }
  if (cache.field_values) {
    for (const [id, name] of Object.entries(cache.field_values)) {
      names[`field_value:${id}`] = name;
    }
  }
  if (cache.messages) {
    for (const [id, val] of Object.entries(cache.messages)) {
      names[`message:${id}`] = typeof val === "string" ? val : val.subject;
    }
  }
  if (cache.campaigns) {
    for (const [id, name] of Object.entries(cache.campaigns)) names[`campaign:${id}`] = name;
  }
  if (cache.products) {
    for (const [id, val] of Object.entries(cache.products)) {
      names[`product:${id}`] = typeof val === "string" ? val : val.name;
    }
  }
  if (cache.forms) {
    for (const [id, name] of Object.entries(cache.forms)) names[`form:${id}`] = name;
  }
  if (cache.tags) {
    for (const [id, name] of Object.entries(cache.tags)) names[`tag:${id}`] = name;
  }
  if (cache.landing_pages) {
    for (const [id, name] of Object.entries(cache.landing_pages)) names[`page:${id}`] = name;
  }

  return names;
}
