import type { Chunk, EnrichmentCache, Duration, NodeDetail } from "./types.js";
import { CONDITION_OPERATOR_LABELS, decodeOntraportDateCode } from "./condition-utils.js";
import { isImplicitForever } from "./condition-utils.js";
import { resolveEventStatement, buildEnrichmentNameMap } from "./rule-editor-registry.js";

export const HUMAN_STEP_TYPES: Record<string, string> = {
  "send_email": "Send Email",
  "email": "Send Email",
  "email_notify": "Email Notification",
  "change_tags": "Change Tags",
  "condition": "Condition",
  "wait": "Wait",
  "update_contact": "Update Contact",
  "goto": "Go To",
  "end": "End",
  "trigger": "Trigger",
  "goal": "Goal",
  "assign_task": "Assign Task",
  "create_task": "Create Task",
  "ai_assistant": "AI Assistant",
  "ai assistant": "AI Assistant",
  "webhook": "Webhook",
  "give_wp_membership": "Give WP Membership",
  "pilotpress_give": "Give WP Membership",
  "remove_wp_membership": "Remove WP Membership",
  "pilotpress_remove": "Remove WP Membership",
  "split_test": "Split Test",
  "fork": "Fork",
  "add_to_campaign": "Add to Automation",
  "move_to_campaign": "Move to Automation",
  "landing_page": "Landing Page",
};

export function getHumanStepType(nodeType: string): string {
  const key = nodeType.toLowerCase();
  return HUMAN_STEP_TYPES[key] || nodeType.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export function formatDuration(d: Duration): string {
  const parts: string[] = [];
  if (d.days > 0) parts.push(`${d.days}d`);
  if (d.hours > 0) parts.push(`${d.hours}h`);
  if (d.minutes > 0) parts.push(`${d.minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "immediate";
}

export function formatWaitTime(timeStr: string): string {
  const match = timeStr.match(/^(\d+):(\d+):(am|pm)$/i);
  if (!match) return timeStr;
  const hour = parseInt(match[1], 10);
  const minute = match[2];
  const ampm = match[3].toLowerCase();
  return minute === "00" ? `${hour}${ampm}` : `${hour}:${minute}${ampm}`;
}

export function resolveRuleEditorConditions(ruleEditor: any, cache: EnrichmentCache): string | null {
  if (!ruleEditor || typeof ruleEditor !== "object") return null;
  const statements = ruleEditor.conditions?.statement || [];
  if (!Array.isArray(statements) || statements.length === 0) return null;

  const conjunctions = ruleEditor.conditions?.conjunction || [];
  const conjLabel = conjunctions.includes("1") ? "OR" : "AND";

  const condParts: string[] = [];
  for (const stmt of statements) {
    if (!stmt || typeof stmt !== "object") continue;
    for (const [condType, val] of Object.entries(stmt)) {
      if (!val || typeof val !== "object" || Array.isArray(val)) continue;
      const d = val as Record<string, any>;
      const fieldRef = d.a0 || "";
      const operator = d.a1 || "";
      const valueRef = d.a2 || "";

      const fieldName = cache.fields[fieldRef] || fieldRef;
      const opLabel = CONDITION_OPERATOR_LABELS[operator] || operator;
      const valueName = cache.field_values[valueRef] || decodeOntraportDateCode(valueRef) || valueRef;

      condParts.push(`"${fieldName}" ${opLabel} "${valueName}"`);
    }
  }

  if (condParts.length === 0) return null;
  return condParts.join(` ${conjLabel} `);
}

export function buildWaitDescription(res: Record<string, any>, cache: EnrichmentCache, singleGoalDescription?: string | null, hasGoals?: boolean): string | null {
  const waitType = res.wait_type || (isImplicitForever(res) ? "forever" : "");

  if (waitType === "forever") {
    if (singleGoalDescription) {
      return `Waits here until the goal ${singleGoalDescription} is achieved`;
    }
    if (hasGoals === true) {
      return "Waits here until one or more of the attached goals are achieved";
    }
    return "Waits here indefinitely";
  }

  if (waitType === "time") {
    const days = parseInt(res.time_days || "0", 10) || 0;
    const hours = parseInt(res.time_hours || "0", 10) || 0;
    const minutes = parseInt(res.time_minutes || "0", 10) || 0;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
    const hasDuration = parts.length > 0;
    const hasTod = res.wait_till_tod === "1" || res.wait_till_tod === 1;

    if (!hasDuration && hasTod) {
      const time = formatWaitTime(res.wait_tod_time || "");
      const tz = res.wait_tod_timezone === "contact" || res.timezone === "contact" ? "Contact's timezone" : res.wait_tod_timezone === "account" || res.timezone === "account" ? "Account timezone" : (res.wait_tod_timezone || res.timezone || "Account timezone");
      return `Wait until ${time} (${tz})`;
    }

    const durationStr = hasDuration ? parts.join(", ") : "an unspecified duration";
    let todSuffix = "";
    if (hasTod) {
      const time = formatWaitTime(res.wait_tod_time || "");
      const tz = res.wait_tod_timezone === "contact" || res.timezone === "contact" ? "Contact's timezone" : res.wait_tod_timezone === "account" || res.timezone === "account" ? "Account timezone" : (res.wait_tod_timezone || res.timezone || "Account timezone");
      todSuffix = `, then until ${time} (${tz})`;
    }
    const base = `Wait ${durationStr}${todSuffix}`;
    if (singleGoalDescription) {
      return `${base}, or until the goal ${singleGoalDescription} is achieved`;
    }
    return base;
  }

  if (waitType === "before_after_date") {
    const daysVal = parseInt(res.before_after_days || "0", 10) || 0;
    const baType = res.before_after_type || "after";
    const fieldId = res.before_after_field || "";
    const fieldName = cache.fields[fieldId] || `unknown field (${fieldId})`;

    let desc = `Wait until ${daysVal} day${daysVal !== 1 ? "s" : ""} ${baType} ${fieldName}`;

    if (res.wait_till_tod === "1" || res.wait_till_tod === 1) {
      const time = formatWaitTime(res.wait_tod_time || "");
      const tz = res.timezone === "contact" ? "Contact's timezone" : res.timezone === "account" ? "Account timezone" : (res.timezone || "Account timezone");
      desc += ` at ${time} in ${tz}`;
    }
    return desc;
  }

  if (waitType === "arrive_date") {
    const arriveDate = res.arrive_date || "an unspecified date";
    let desc = `Wait until ${arriveDate}`;
    if (res.ignore_year === "1" || res.ignore_year === 1) {
      desc += " (recurring annually)";
    }
    if (res.wait_till_tod === "1" || res.wait_till_tod === 1) {
      const time = formatWaitTime(res.wait_tod_time || "");
      const tz = res.timezone === "contact" ? "Contact's timezone" : res.timezone === "account" ? "Account timezone" : (res.timezone || "Account timezone");
      desc += ` at ${time} in ${tz}`;
    }
    return desc;
  }

  if (waitType === "day_of_week") {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const activeDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (res[`custom_dow_${i}`] === "1" || res[`custom_dow_${i}`] === 1) {
        activeDays.push(dayNames[i]);
      }
    }
    const daysStr = activeDays.length > 0 ? activeDays.join(", ") : "an unspecified day";
    let desc = `Wait until ${daysStr}`;
    if (res.wait_till_tod === "1" || res.wait_till_tod === 1) {
      const time = formatWaitTime(res.wait_tod_time || "");
      const tz = res.timezone === "contact" ? "Contact's timezone" : res.timezone === "account" ? "Account timezone" : (res.timezone || "Account timezone");
      desc += ` at ${time} in ${tz}`;
    }
    return desc;
  }

  if (!waitType) {
    const days = parseInt(res.time_days || "0", 10) || 0;
    const hours = parseInt(res.time_hours || "0", 10) || 0;
    const minutes = parseInt(res.time_minutes || "0", 10) || 0;
    if (days === 0 && hours === 0 && minutes === 0) {
      if (singleGoalDescription) {
        return `Waits here until the goal ${singleGoalDescription} is achieved`;
      }
      return "Waits here until one or more of the attached goals are achieved";
    }
  }

  return null;
}

export function resolveNodeDescription(node: NodeDetail, cache: EnrichmentCache, hasGoals?: boolean): string {
  const res = node.resource || {};
  const parts: string[] = [`[${node.type}] ${node.label}`];

  if (res.update_contact_field) {
    const fieldName = cache.fields[res.update_contact_field] || res.update_contact_field;
    const rawVal = res.update_contact_val;
    const valueName = rawVal && cache.field_values[rawVal] ? cache.field_values[rawVal] : rawVal;
    const action = res.list_action_selector || "SET";
    parts.push(`Sets "${fieldName}" ${action} "${valueName}"`);
  } else if (res.field_id && cache.fields[res.field_id]) {
    parts.push(`Field: "${cache.fields[res.field_id]}"`);
    if (res.field_value_id && cache.field_values[res.field_value_id]) {
      parts.push(`Value: "${cache.field_values[res.field_value_id]}"`);
    } else if (res.value !== undefined) {
      parts.push(`Value: "${res.value}"`);
    }
  } else if (res.value !== undefined) {
    parts.push(`Value: "${res.value}"`);
  }

  const nType = (node.type || "").toLowerCase();
  const objId = res.object_id ? String(res.object_id).trim() : "";
  let emailResolved = false;
  if (objId && objId !== "0" && (nType === "send_email" || nType === "email") && cache.messages[objId]) {
    const msg = cache.messages[objId];
    parts.push(`Email: "${msg.subject}"`);
    emailResolved = true;
  }
  if (!emailResolved && nType === "email_notify") {
    const notifyEmailId = res.email_selector ? String(res.email_selector).trim() : "";
    if (notifyEmailId && notifyEmailId !== "0" && cache.messages[notifyEmailId]) {
      const msg = cache.messages[notifyEmailId];
      parts.push(`Notification Email: "${msg.subject}"`);
      emailResolved = true;
    }
  }
  if (!emailResolved && res.message_id && cache.messages[res.message_id]) {
    const msg = cache.messages[res.message_id];
    parts.push(`Message: "${msg.subject}" (${msg.body_summary})`);
  }
  if (!emailResolved && (nType === "send_email" || nType === "email") && (!objId || objId === "0")) {
    parts.push(`Email: [unconfigured — no email selected]`);
  }
  if (objId && objId !== "0") {
    if ((nType === "assign_task" || nType === "create_task") && cache.tasks[objId]) {
      parts.push(`Task: "${cache.tasks[objId]}"`);
    } else if ((nType === "assign_task" || nType === "create_task")) {
      parts.push(`Task: "unknown task"`);
    }
  }
  if (res.tag_id && cache.tags[res.tag_id]) {
    parts.push(`Tag: "${cache.tags[res.tag_id]}"`);
  }
  if (res.add_tag && cache.tags[res.add_tag]) {
    parts.push(`Add Tag: "${cache.tags[res.add_tag]}"`);
  }
  if (res.remove_tag && cache.tags[res.remove_tag]) {
    parts.push(`Remove Tag: "${cache.tags[res.remove_tag]}"`);
  }
  if (res.campaign_id && cache.campaigns[res.campaign_id]) {
    parts.push(`Automation: "${cache.campaigns[res.campaign_id]}"`);
  }
  if (res.product_id === "0" || res.product_id === 0) {
    parts.push(`Product: Any Product`);
  } else if (res.product_id && cache.products[res.product_id]) {
    const prod = cache.products[res.product_id];
    parts.push(`Product: "${prod.name}" ($${prod.price})`);
  }
  if (res.form_id && cache.forms[res.form_id]) {
    parts.push(`Form: "${cache.forms[res.form_id]}"`);
  }
  if (res.landing_page_id && cache.landing_pages[res.landing_page_id]) {
    parts.push(`Landing Page: "${cache.landing_pages[res.landing_page_id]}"`);
  }
  if (res.webhook_url && cache.webhook_urls[res.webhook_url]) {
    parts.push(`Webhook: ${cache.webhook_urls[res.webhook_url]}`);
  }
  if (res.destination_url) {
    parts.push(`Webhook URL: ${res.destination_url}`);
  }
  if (nType === "ai_assistant" || nType === "ai assistant") {
    if (res.ai_prompt || res.prompt) parts.push(`AI Prompt: "${res.ai_prompt || res.prompt}"`);
    if (res.system_role) parts.push(`System Role: "${res.system_role}"`);
    if (res.store_response_in) {
      const fieldName = cache.fields[res.store_response_in] || res.store_response_in;
      parts.push(`Stores response in: "${fieldName}"`);
    }
    if (res.model) parts.push(`Model: ${res.model}`);
    if (res.max_credits) parts.push(`Max credits: ${res.max_credits}`);
  }
  if (nType === "give_wp_membership" || nType === "give wp membership access" || nType === "pilotpress_give") {
    if (res.wordpress_site || res.site_id) parts.push(`WordPress Site: ${res.wordpress_site || res.site_id}`);
    if (res.membership_level || res.level_id) parts.push(`Membership Level: ${res.membership_level || res.level_id}`);
    parts.push(`Action: GIVE membership access`);
  }
  if (nType === "remove_wp_membership" || nType === "remove wp membership access" || nType === "pilotpress_remove") {
    if (res.wordpress_site || res.site_id) parts.push(`WordPress Site: ${res.wordpress_site || res.site_id}`);
    if (res.membership_level || res.level_id) parts.push(`Membership Level: ${res.membership_level || res.level_id}`);
    parts.push(`Action: REMOVE membership access`);
  }
  if (nType === "update_membership_access") {
    if (res.membership_site) parts.push(`Membership Site: #${res.membership_site}`);
    const status = res.membership_status;
    const action = status === "0" ? "DISABLE" : status === "1" ? "ENABLE" : "UPDATE";
    parts.push(`Action: ${action} membership access`);
  }
  if (res.tag_selector) {
    const tagList = res.tag_selector.list;
    const action = res.tag_selector.sub_unsub === "add_list" ? "Adds" : "Removes";
    if (Array.isArray(tagList) && tagList.length > 0) {
      const tagNames = tagList.map((t: any) => {
        const name = cache.tags[t.value] || t.label || t.value;
        return `"${name}"`;
      });
      parts.push(`${action} tags: ${tagNames.join(", ")}`);
    }
  }

  if (node.type === "wait") {
    const waitDesc = buildWaitDescription(res, cache, null, hasGoals);
    if (waitDesc) {
      parts.push(`WAIT DESCRIPTION (use verbatim): "${waitDesc}"`);
    }
  }

  if (node.type === "end") {
    const removes = res.remove_contacts === "1";
    const moves = res.move_contacts === "1";
    const moveTarget = res.move_contacts_to;

    if (moves && moveTarget) {
      const targetName = cache.campaigns[moveTarget] || `Automation #${moveTarget}`;
      parts.push(`END MODE: move_to_automation — Contact exits this automation and is immediately enrolled in "${targetName}". No longer eligible for goal redirects in this automation.`);
    } else if (removes) {
      parts.push(`END MODE: exit — Contact is fully removed from the automation and is no longer eligible for goal redirects or any other automation mechanics.`);
    } else {
      parts.push(`END MODE: end — This path ends. The contact remains on the automation map and is still eligible for goal redirects from any active goal node.`);
    }
  } else if (res.remove_contacts === "1") {
    parts.push(`Removes contact from automation`);
  }

  if (res.rule_editor && node.type === "condition") {
    const condDesc = resolveRuleEditorConditions(res.rule_editor, cache);
    if (condDesc) {
      parts.push(`Checks: ${condDesc}`);
    }
  }

  if (res.rule_editor && (node.type === "trigger" || node.type === "goal")) {
    const eventStmts = res.rule_editor.events?.statement;
    if (Array.isArray(eventStmts)) {
      for (const stmt of eventStmts) {
        if (!stmt || typeof stmt !== "object") continue;
        for (const [eventType, val] of Object.entries(stmt)) {
          if (!val || typeof val !== "object" || Array.isArray(val)) continue;
          const cfg = val as Record<string, any>;
          const a0 = cfg.a0 != null ? String(cfg.a0).trim() : "";
          const a1 = cfg.a1 != null ? String(cfg.a1).trim() : "";
          let a0Resolved = false;
          if (a0 && eventType.includes("form") && cache.forms[a0]) {
            parts.push(`Form: "${cache.forms[a0]}"`);
            a0Resolved = true;
          } else if (a0 && eventType.includes("product") && cache.products[a0]) {
            const prod = cache.products[a0];
            parts.push(`Product: "${prod.name}" ($${prod.price})`);
            a0Resolved = true;
          } else if (a0 && eventType.includes("email") && cache.messages[a0]) {
            parts.push(`Email: "${cache.messages[a0].subject}"`);
            a0Resolved = true;
          } else if (a0 && eventType.includes("tag") && cache.tags[a0]) {
            parts.push(`Tag: "${cache.tags[a0]}"`);
            a0Resolved = true;
          } else if (a0 && eventType.includes("campaign") && cache.campaigns[a0]) {
            parts.push(`Automation: "${cache.campaigns[a0]}"`);
            a0Resolved = true;
          } else if (a0 && (eventType.includes("landing_page") || eventType.includes("landingpage")) && cache.landing_pages[a0]) {
            parts.push(`Landing Page: "${cache.landing_pages[a0]}"`);
            a0Resolved = true;
          } else if (a0 && eventType.includes("task") && cache.tasks[a0]) {
            parts.push(`Task: "${cache.tasks[a0]}"`);
            a0Resolved = true;
          }
          if (!a0Resolved && a0) {
            const nameMap = buildEnrichmentNameMap(cache);
            const resolved = resolveEventStatement(eventType, cfg, nameMap);
            if (resolved) {
              for (const cd of resolved.componentDetails) {
                if (cd.value !== cd.rawValue && cd.value !== "Any") {
                  parts.push(`${cd.name}: "${cd.value}"`);
                }
              }
            }
          }
          if (a1 && a1 !== "0") {
            if (eventType.includes("product") && cache.products[a1]) {
              const prod = cache.products[a1];
              parts.push(`Product: "${prod.name}" ($${prod.price})`);
            } else if (eventType.includes("email") && cache.messages[a1]) {
              parts.push(`Email: "${cache.messages[a1].subject}"`);
            }
          }
        }
      }
    }
  }

  if (node.cumulative_elapsed) {
    const elapsed = formatDuration(node.cumulative_elapsed);
    if (elapsed !== "immediate") {
      parts.push(`(cumulative elapsed: ${elapsed})`);
    }
  }

  return parts.join(" | ");
}

export function getStepName(nd: NodeDetail, cache: EnrichmentCache, hasGoals?: boolean): string {
  const nType = (nd.type || "").toLowerCase();
  const res = nd.resource || {};

  if ((nType === "send_email" || nType === "email") && res.object_id && cache.messages[String(res.object_id)]) {
    return cache.messages[String(res.object_id)].subject;
  }
  if (nType === "email_notify") {
    const emailId = res.email_selector || res.object_id;
    if (emailId && cache.messages[String(emailId)]) {
      return cache.messages[String(emailId)].subject;
    }
  }
  if (nType === "change_tags" && res.tag_selector?.list?.length > 0) {
    const tagNames = res.tag_selector.list.map((t: any) => cache.tags[t.value] || t.label || t.value);
    return tagNames.join(", ");
  }
  if (res.add_tag && cache.tags[res.add_tag]) {
    return cache.tags[res.add_tag];
  }
  if (res.remove_tag && cache.tags[res.remove_tag]) {
    return cache.tags[res.remove_tag];
  }
  if (nType === "condition" && res.rule_editor) {
    const condDesc = resolveRuleEditorConditions(res.rule_editor, cache);
    if (condDesc) return condDesc;
  }
  if (res.update_contact_field) {
    const fieldName = cache.fields[res.update_contact_field] || res.update_contact_field;
    return fieldName;
  }
  if (nType === "wait") {
    const waitDesc = buildWaitDescription(res, cache, null, hasGoals);
    if (waitDesc) return waitDesc;
  }
  if ((nType === "assign_task" || nType === "create_task") && res.object_id && cache.tasks[String(res.object_id)]) {
    return cache.tasks[String(res.object_id)];
  }
  if (res.form_id && cache.forms[res.form_id]) {
    return cache.forms[res.form_id];
  }
  if (res.campaign_id && cache.campaigns[res.campaign_id]) {
    return cache.campaigns[res.campaign_id];
  }
  if (res.product_id && cache.products[res.product_id]) {
    return cache.products[res.product_id].name;
  }

  return nd.label || nd.type;
}

export function computeTriggerOrdinal(triggerChunkId: string, allChunks: Chunk[]): number {
  const triggers = allChunks
    .filter(c => c.entry_type === "trigger")
    .sort((a, b) => {
      const orderA = parseInt(a.node_details[0]?.resource?.order ?? "999", 10);
      const orderB = parseInt(b.node_details[0]?.resource?.order ?? "999", 10);
      return orderA - orderB;
    });
  const idx = triggers.findIndex(t => t.id === triggerChunkId);
  return idx >= 0 ? idx + 1 : 0;
}

function findOwningTriggerChunk(chunk: Chunk, allChunks: Chunk[]): Chunk | null {
  let current = chunk;
  const visited = new Set<string>();
  while (current.parent_chunk_id) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = allChunks.find(c => c.id === current.parent_chunk_id);
    if (!parent) return null;
    if (parent.entry_type === "trigger") return parent;
    current = parent;
  }
  return null;
}

export function findGotoTargetDescription(targetNodeId: string, allChunks: Chunk[], cache: EnrichmentCache): string {
  for (const c of allChunks) {
    for (const nd of c.node_details) {
      if (nd.id === targetNodeId) {
        const chunkHasGoals = c.sub_chunks.some(scId => {
          const sc = allChunks.find(ch => ch.id === scId);
          return sc != null && sc.entry_type === "goal";
        });

        if (c.entry_type === "trigger") {
          const triggerNum = computeTriggerOrdinal(c.id, allChunks) || c.id;
          const stepType = getHumanStepType(nd.type);
          const stepName = getStepName(nd, cache, chunkHasGoals);
          return `VERBATIM_GOTO: they are routed via GoTo into Trigger ${triggerNum}'s path, entering at the ${stepType} step '${stepName}', and continue from there.`;
        }

        if (nd.type === "end") {
          const res = nd.resource || {};
          const removes = res.remove_contacts === "1";
          const moves = res.move_contacts === "1";
          const moveTarget = res.move_contacts_to;
          const branchRef = `through ${c.id}`;

          if (moves && moveTarget) {
            const targetName = cache.campaigns[moveTarget] || `Automation #${moveTarget}`;
            return `VERBATIM_GOTO: they are moved to "${targetName}" via GoTo (${branchRef}).`;
          } else if (removes) {
            return `VERBATIM_GOTO: they exit the automation via GoTo (${branchRef}).`;
          } else {
            return `VERBATIM_GOTO: they reach the end of ${c.id} via GoTo and remain on the automation map.`;
          }
        }

        const owningTrigger = findOwningTriggerChunk(c, allChunks);
        if (owningTrigger) {
          const triggerNum = computeTriggerOrdinal(owningTrigger.id, allChunks) || owningTrigger.id;
          const stepType = getHumanStepType(nd.type);
          const stepName = getStepName(nd, cache, chunkHasGoals);
          return `VERBATIM_GOTO: they are routed via GoTo into Trigger ${triggerNum}'s path, entering at the ${stepType} step '${stepName}', and continue from there.`;
        }

        const desc = resolveNodeDescription(nd, cache, chunkHasGoals);
        const chunkLabel = `branch ${c.id}`;
        return `${desc} (in ${chunkLabel}). This means contacts from THIS trigger path merge into the ${chunkLabel} and follow its steps from that point onward.`;
      }
    }
  }
  return `node ${targetNodeId}`;
}
