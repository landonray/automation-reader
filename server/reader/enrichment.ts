import type { EnrichmentCache, CampaignData, OntraportNode } from "./types.js";

const ONTRAPORT_BASE = "https://api.ontraport.com/1";

export interface OntraportHeaders {
  "Api-Appid": string;
  "Api-Key": string;
  [key: string]: string;
}

class MudCounter {
  private counts = new Map<string, number>();
  next(type: string): string {
    const n = (this.counts.get(type) || 0) + 1;
    this.counts.set(type, n);
    return `MUD-${type}-${n}`;
  }
}

export function emptyCacheEntry(): EnrichmentCache {
  return {
    fields: {},
    field_values: {},
    messages: {},
    campaigns: {},
    products: {},
    forms: {},
    tags: {},
    landing_pages: {},
    webhook_urls: {},
    tasks: {},
  };
}

function isMudOrUnknown(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.startsWith("unknown ") || s.startsWith("MUD-") || /^(task|tag|message) #\d+$/i.test(lower);
}

function isUnknownValue(val: unknown): boolean {
  if (typeof val === "string") return isMudOrUnknown(val);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.subject === "string") return isMudOrUnknown(obj.subject);
    if (typeof obj.name === "string") return isMudOrUnknown(obj.name);
  }
  return false;
}

export interface CollectedIds {
  fieldIds: Set<string>;
  fieldValueIds: Set<string>;
  messageIds: Set<string>;
  campaignIds: Set<string>;
  productIds: Set<string>;
  formIds: Set<string>;
  tagIds: Set<string>;
  landingPageIds: Set<string>;
  webhookUrls: Set<string>;
  taskIds: Set<string>;
  taskDescriptions: Map<string, string>;
}

const EVENT_TYPE_A0_ENTITY: Record<string, keyof CollectedIds> = {
  object_submits_form: "formIds",
  object_fills_out_form: "formIds",
  fillout_form: "formIds",

  object_visits_landing_page: "landingPageIds",
  visits_landing_page: "landingPageIds",
  visits_landingpage: "landingPageIds",
  object_visits_landingpage: "landingPageIds",
  visited_landingpage: "landingPageIds",

  sub_product_action: "productIds",
  object_purchases_product: "productIds",
  purchases_product: "productIds",
  purchase_product: "productIds",
  ordered_product: "productIds",
  sub_product: "productIds",
  subbed_sub_product: "productIds",
  subbed_sub_product_timeframe: "productIds",
  refunds_product: "productIds",
  spent_product: "productIds",
  transaction_has_product: "productIds",

  object_opens_email: "messageIds",
  object_clicks_email: "messageIds",
  opens_email: "messageIds",
  clicks_email: "messageIds",
  opened_email: "messageIds",
  clicked_email: "messageIds",
  sends_email: "messageIds",

  object_is_tagged: "tagIds",
  is_tagged: "tagIds",
  object_tag_added: "tagIds",
  tag_added: "tagIds",
  sub_tag: "tagIds",
  usub_tag: "tagIds",

  object_added_to_campaign: "campaignIds",
  added_to_campaign: "campaignIds",
  pause_campaign: "campaignIds",
  unpause_campaign: "campaignIds",
  paused_or_active_on_camp: "campaignIds",

  task_complete: "taskIds",
  object_completed_task: "taskIds",
  object_completes_task: "taskIds",
  completes_task: "taskIds",
  task_canceled: "taskIds",
  object_canceled_task: "taskIds",
  task_overdue: "taskIds",
  object_task_overdue: "taskIds",
};

const EVENT_TYPE_A0_ENUM: Set<string> = new Set([
  "cc_status",
  "contact_visits_url",
  "visits_url",
  "clicks_tracked_link",
  "on_today",
]);

const EVENT_TYPE_A1_ENTITY: Record<string, keyof CollectedIds> = {
  sub_product_action: "productIds",
  object_purchases_product: "productIds",
  purchases_product: "productIds",
  purchase_product: "productIds",
  ordered_product: "productIds",
};

function scanRuleEditorStatements(ruleEditor: any, collected: CollectedIds): void {
  if (!ruleEditor || typeof ruleEditor !== "object") return;

  const condStatements = ruleEditor.conditions?.statement || [];
  const eventStatements = ruleEditor.events?.statement || [];
  const allStatements = [...(Array.isArray(condStatements) ? condStatements : []), ...(Array.isArray(eventStatements) ? eventStatements : [])];

  for (const stmt of allStatements) {
    if (!stmt || typeof stmt !== "object") continue;
    for (const [eventType, val] of Object.entries(stmt)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const stmtData = val as Record<string, any>;
        const a0Str = stmtData.a0 != null ? String(stmtData.a0).trim() : "";
        const a1Str = stmtData.a1 != null ? String(stmtData.a1).trim() : "";
        const a0Target = EVENT_TYPE_A0_ENTITY[eventType];
        if (a0Target && a0Str) {
          (collected[a0Target] as Set<string>).add(a0Str);
        } else if (a0Str && !EVENT_TYPE_A0_ENUM.has(eventType)) {
          collected.fieldIds.add(a0Str);
        }
        const a1Target = EVENT_TYPE_A1_ENTITY[eventType];
        if (a1Target && a1Str && a1Str !== "0") {
          (collected[a1Target] as Set<string>).add(a1Str);
        }
        if (stmtData.a2 && typeof stmtData.a2 === "string" && stmtData.a2.trim()) {
          collected.fieldValueIds.add(stmtData.a2);
        }
      }
    }
  }
}

function scanNodeForIds(node: OntraportNode, collected: CollectedIds): void {
  const resource = node.resource || node.data || {};
  const nodeType = (node.type || "").toLowerCase();

  if (nodeType === "note") return;

  if (resource.object_id) {
    const objId = String(resource.object_id).trim();
    if (objId && objId !== "0") {
      if (nodeType === "send_email" || nodeType === "email") {
        collected.messageIds.add(objId);
      } else if (nodeType === "assign_task" || nodeType === "create_task") {
        collected.taskIds.add(objId);
        const desc = node.description || node.label;
        if (desc && typeof desc === "string" && desc.toLowerCase() !== "assign task" && desc.toLowerCase() !== "create task") {
          collected.taskDescriptions.set(objId, desc);
        }
      }
    }
  }
  if (nodeType === "email_notify" && resource.email_selector) {
    const emailId = String(resource.email_selector).trim();
    if (emailId && emailId !== "0") {
      collected.messageIds.add(emailId);
    }
  }

  scanObjectForIds(resource, collected, nodeType);

  if (resource.rule_editor) {
    scanRuleEditorStatements(resource.rule_editor, collected);
  }

  if (node.events && Array.isArray(node.events)) {
    for (const event of node.events) {
      scanObjectForIds(event, collected, nodeType);
    }
  }

  if (node.conditions && Array.isArray(node.conditions)) {
    for (const cond of node.conditions) {
      scanObjectForIds(cond, collected, nodeType);
    }
  }

  if (node.filter_conditions && Array.isArray(node.filter_conditions)) {
    for (const cond of node.filter_conditions) {
      scanObjectForIds(cond, collected, nodeType);
    }
  }
}

function scanObjectForIds(obj: Record<string, any>, collected: CollectedIds, nodeType: string): void {
  if (!obj || typeof obj !== "object") return;

  const fieldKeys = [
    "field", "field_id", "contact_field", "update_field",
    "condition_field", "rule_field", "dla", "field_name",
    "update_contact_field", "before_after_field",
  ];
  for (const key of fieldKeys) {
    if (obj[key] && typeof obj[key] === "string" && obj[key].trim()) {
      collected.fieldIds.add(obj[key]);
    }
  }

  const valueKeys = [
    "update_contact_val", "value", "field_value", "condition_value",
  ];
  for (const key of valueKeys) {
    if (obj[key] && typeof obj[key] === "string" && obj[key].trim()) {
      collected.fieldValueIds.add(obj[key]);
    }
  }

  if (obj.message_id) {
    collected.messageIds.add(String(obj.message_id));
  }
  if (obj.message) {
    collected.messageIds.add(String(obj.message));
  }

  if (obj.campaign_id) {
    collected.campaignIds.add(String(obj.campaign_id));
  }
  if (obj.add_to_campaign_id) {
    collected.campaignIds.add(String(obj.add_to_campaign_id));
  }
  if (obj.move_contacts_to) {
    collected.campaignIds.add(String(obj.move_contacts_to));
  }

  if (obj.product_id) {
    collected.productIds.add(String(obj.product_id));
  }

  if (obj.form_id) {
    collected.formIds.add(String(obj.form_id));
  }

  if (obj.tag_id) {
    collected.tagIds.add(String(obj.tag_id));
  }
  if (obj.add_tag) {
    collected.tagIds.add(String(obj.add_tag));
  }
  if (obj.remove_tag) {
    collected.tagIds.add(String(obj.remove_tag));
  }
  if (obj.tag_selector?.list && Array.isArray(obj.tag_selector.list)) {
    for (const item of obj.tag_selector.list) {
      if (item.value) collected.tagIds.add(String(item.value));
    }
  }
  if (obj.add_names) {
    const names = String(obj.add_names);
    for (const id of names.split(",").map(s => s.trim()).filter(Boolean)) {
      collected.tagIds.add(id);
    }
  }
  if (obj.remove_names) {
    const names = String(obj.remove_names);
    for (const id of names.split(",").map(s => s.trim()).filter(Boolean)) {
      collected.tagIds.add(id);
    }
  }

  if (obj.task_id) {
    collected.taskIds.add(String(obj.task_id));
  }

  if (obj.landing_page_id) {
    collected.landingPageIds.add(String(obj.landing_page_id));
  }

  if (obj.webhook_url || obj.url) {
    const url = obj.webhook_url || obj.url;
    if (typeof url === "string" && url.startsWith("http")) {
      collected.webhookUrls.add(url);
    }
  }

  if (obj.conditions && Array.isArray(obj.conditions)) {
    for (const cond of obj.conditions) {
      scanObjectForIds(cond, collected, nodeType);
    }
  }

  if (obj.filter && Array.isArray(obj.filter)) {
    for (const f of obj.filter) {
      scanObjectForIds(f, collected, nodeType);
    }
  }
}

export function collectAllIds(campaignData: CampaignData): CollectedIds {
  const collected: CollectedIds = {
    fieldIds: new Set(),
    fieldValueIds: new Set(),
    messageIds: new Set(),
    campaignIds: new Set(),
    productIds: new Set(),
    formIds: new Set(),
    tagIds: new Set(),
    landingPageIds: new Set(),
    webhookUrls: new Set(),
    taskIds: new Set(),
    taskDescriptions: new Map(),
  };

  for (const node of campaignData.nodes) {
    scanNodeForIds(node, collected);
  }

  return collected;
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchOntraport(
  endpoint: string,
  headers: OntraportHeaders,
  params?: Record<string, string>,
): Promise<any> {
  const url = new URL(`${ONTRAPORT_BASE}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseFieldOptions(optionsRaw: any, cache: EnrichmentCache): void {
  if (!optionsRaw) return;

  let options = optionsRaw;
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch {
      return;
    }
  }

  if (Array.isArray(options)) {
    for (const opt of options) {
      if (opt && typeof opt === "object" && opt.value !== undefined && opt.label) {
        cache.field_values[String(opt.value)] = String(opt.label);
      }
    }
  } else if (typeof options === "object") {
    for (const [val, label] of Object.entries(options)) {
      cache.field_values[val] = String(label);
    }
  }
}

export function isHumanReadableAlias(id: string): boolean {
  if (/^\d+$/.test(id)) return false;
  if (/^f\d+$/.test(id)) return false;
  if (id.length <= 1) return false;
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(id);
}

export function formatFieldAlias(alias: string): string {
  return alias
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function resolveFields(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.fields) || isUnknownValue(cache.fields[id]));
  if (unresolvedIds.length === 0) return;

  const data = await fetchOntraport("/objects/fieldeditor", headers, {
    objectID: "0",
  });

  if (data?.data) {
    const sections = typeof data.data === "object" && !Array.isArray(data.data)
      ? Object.values(data.data)
      : [data.data];

    for (const section of sections as any[]) {
      const fieldGroups = section?.fields || section;
      if (!Array.isArray(fieldGroups)) continue;

      for (const group of fieldGroups) {
        const fields = Array.isArray(group) ? group : [group];
        for (const field of fields) {
          if (!field || typeof field !== "object") continue;
          const fieldAlias = field.field || field.alias;
          const fieldName = field.alias || field.field_name || field.label || fieldAlias;
          if (fieldAlias && unresolvedIds.includes(fieldAlias)) {
            cache.fields[fieldAlias] = fieldName;
            parseFieldOptions(field.options, cache);
          }
        }
      }
    }
  }

  for (const id of unresolvedIds) {
    if (!(id in cache.fields)) {
      if (isHumanReadableAlias(id)) {
        cache.fields[id] = formatFieldAlias(id);
      } else {
        cache.fields[id] = mud.next("Field");
      }
    }
  }
}

async function resolveMessages(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.messages) || isUnknownValue(cache.messages[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const data = await fetchOntraport("/objects", headers, {
      objectID: "7",
      id,
    });

    if (data?.data) {
      const msg = Array.isArray(data.data) ? data.data[0] : data.data;
      if (msg) {
        const subject = msg.subject || msg.name || mud.next("Email");
        const body = msg.body_text || msg.html_content || msg.content || "";
        const bodySummary = body.length > 200 ? body.substring(0, 200) + "..." : body;
        cache.messages[id] = { subject, body_summary: bodySummary };
        return;
      }
    }

    cache.messages[id] = { subject: mud.next("Email"), body_summary: "" };
  });

  await Promise.all(fetchPromises);
}

async function resolveTags(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.tags) || isUnknownValue(cache.tags[id]));
  if (unresolvedIds.length === 0) return;

  const data = await fetchOntraport("/objects", headers, {
    objectID: "14",
    ids: unresolvedIds.join(","),
    listFields: "tag_name",
  });

  if (data?.data) {
    const tags = Array.isArray(data.data) ? data.data : Object.values(data.data);
    for (const tag of tags as any[]) {
      const tagId = String(tag.id || tag.tag_id);
      const tagName = tag.tag_name || tag.name || mud.next("Tag");
      cache.tags[tagId] = tagName;
    }
  }

  for (const id of unresolvedIds) {
    if (!(id in cache.tags)) {
      cache.tags[id] = mud.next("Tag");
    }
  }
}

async function resolveTasks(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
  nodeDescriptions?: Map<string, string>,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.tasks) || isUnknownValue(cache.tasks[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const data = await fetchOntraport("/objects", headers, {
      objectID: "12",
      id,
    });

    if (data?.data) {
      const rawTask = data.data;
      const task = Array.isArray(rawTask) ? rawTask[0] : rawTask;
      if (task && typeof task === "object" && Object.keys(task).length > 0) {
        cache.tasks[id] = task.subject || task.name || task.title || mud.next("Task");
        return;
      }
    }

    const nodeDesc = nodeDescriptions?.get(id);
    if (nodeDesc) {
      cache.tasks[id] = nodeDesc;
      return;
    }

    cache.tasks[id] = mud.next("Task");
  });

  await Promise.all(fetchPromises);
}

async function resolveCampaigns(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.campaigns) || isUnknownValue(cache.campaigns[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const data = await fetchOntraport("/CampaignBuilderItem", headers, { id });

    if (data?.data) {
      const item = data.data;
      if (item && item.name) {
        cache.campaigns[id] = item.name;
        return;
      }
    }

    cache.campaigns[id] = mud.next("Automation");
  });

  await Promise.all(fetchPromises);
}

async function resolveProducts(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.products) || isUnknownValue(cache.products[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const data = await fetchOntraport("/objects", headers, {
      objectID: "16",
      id,
    });

    if (data?.data) {
      const product = Array.isArray(data.data) ? data.data[0] : data.data;
      if (product) {
        cache.products[id] = {
          name: product.name || product.product_name || mud.next("Product"),
          price: product.price || product.amount || "0",
        };
        return;
      }
    }

    cache.products[id] = { name: mud.next("Product"), price: "0" };
  });

  await Promise.all(fetchPromises);
}

function extractBaseFormId(id: string): string {
  const match = id.match(/^(\d+)/);
  return match ? match[1] : id;
}

async function resolveForms(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.forms) || isUnknownValue(cache.forms[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const baseId = extractBaseFormId(id);
    const idsToTry = baseId !== id ? [baseId, id] : [id];

    for (const tryId of idsToTry) {
      const formData = await fetchOntraport("/Form", headers, { id: tryId });
      if (formData?.data) {
        const form = Array.isArray(formData.data) ? formData.data[0] : formData.data;
        const name = form?.formname || form?.name || form?.form_name;
        if (name) {
          cache.forms[id] = name;
          if (baseId !== id) cache.forms[baseId] = name;
          return;
        }
      }

      for (const objectType of ["122", "57"]) {
        const data = await fetchOntraport("/objects", headers, {
          objectID: objectType,
          id: tryId,
        });

        if (data?.data) {
          const form = Array.isArray(data.data) ? data.data[0] : data.data;
          const name = form?.name || form?.formname || form?.form_name;
          if (name) {
            cache.forms[id] = name;
            if (baseId !== id) cache.forms[baseId] = name;
            return;
          }
        }
      }
    }

    if (baseId !== id) {
      const lpiData = await fetchOntraport("/LandingPageItem", headers, { id: baseId });
      if (lpiData?.data) {
        const page = Array.isArray(lpiData.data) ? lpiData.data[0] : lpiData.data;
        const pageName = page?.name || page?.page_name;
        if (pageName) {
          cache.forms[id] = pageName;
          cache.forms[baseId] = pageName;
          if (!cache.landing_pages[baseId] || cache.landing_pages[baseId].startsWith("Unknown")) {
            cache.landing_pages[baseId] = pageName;
          }
          return;
        }
      }
    }

    cache.forms[id] = mud.next("Form");
  });

  await Promise.all(fetchPromises);
}

async function resolveLandingPages(
  ids: Set<string>,
  headers: OntraportHeaders,
  cache: EnrichmentCache,
  mud: MudCounter,
): Promise<void> {
  if (ids.size === 0) return;

  const unresolvedIds = Array.from(ids).filter(id => !(id in cache.landing_pages) || isUnknownValue(cache.landing_pages[id]));
  if (unresolvedIds.length === 0) return;

  const fetchPromises = unresolvedIds.map(async (id) => {
    const lpiData = await fetchOntraport("/LandingPageItem", headers, { id });
    if (lpiData?.data) {
      const page = Array.isArray(lpiData.data) ? lpiData.data[0] : lpiData.data;
      const name = page?.name || page?.page_name;
      if (name) {
        cache.landing_pages[id] = name;
        return;
      }
    }

    const data = await fetchOntraport("/objects", headers, {
      objectID: "20",
      id,
    });
    if (data?.data) {
      const page = Array.isArray(data.data) ? data.data[0] : data.data;
      if (page) {
        cache.landing_pages[id] = page.name || page.page_name || mud.next("LandingPage");
        return;
      }
    }

    cache.landing_pages[id] = mud.next("LandingPage");
  });

  await Promise.all(fetchPromises);
}

function resolveWebhookUrls(urls: Set<string>, cache: EnrichmentCache): void {
  for (const url of Array.from(urls)) {
    if (!(url in cache.webhook_urls)) {
      try {
        const parsed = new URL(url);
        cache.webhook_urls[url] = parsed.hostname + parsed.pathname;
      } catch {
        cache.webhook_urls[url] = url;
      }
    }
  }
}

export async function enrichCampaign(
  campaignJson: CampaignData,
  ontraportHeaders: OntraportHeaders,
): Promise<EnrichmentCache> {
  const cache = emptyCacheEntry();

  const collected = collectAllIds(campaignJson);

  resolveWebhookUrls(collected.webhookUrls, cache);

  const mud = new MudCounter();

  await Promise.all([
    resolveFields(collected.fieldIds, ontraportHeaders, cache, mud),
    resolveMessages(collected.messageIds, ontraportHeaders, cache, mud),
    resolveTags(collected.tagIds, ontraportHeaders, cache, mud),
    resolveTasks(collected.taskIds, ontraportHeaders, cache, mud, collected.taskDescriptions),
    resolveCampaigns(collected.campaignIds, ontraportHeaders, cache, mud),
    resolveProducts(collected.productIds, ontraportHeaders, cache, mud),
    resolveForms(collected.formIds, ontraportHeaders, cache, mud),
    resolveLandingPages(collected.landingPageIds, ontraportHeaders, cache, mud),
  ]);

  return cache;
}
