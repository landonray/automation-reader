import type { EnrichmentCache, NodeDetail, Chunk } from "./types.js";
import { resolveEventStatement, resolveConditionStatement, buildEnrichmentNameMap } from "./rule-editor-registry.js";
import { isImplicitForever } from "./condition-utils.js";

export interface ProfileLookup {
  [key: string]: { objectName: string; objectId: string; objectType: string; status: string; profile: { summary: string; purpose: string; audience: string; key_elements: string[]; business_context: string }; parentObjectType?: string; parentObjectId?: string };
}

// ============================================================
// TRIGGER OPENING TEMPLATES
// ============================================================
//
// These produce the opening sentence of a trigger chunk's narration.
// Each maps a trigger label (or event type) to a sentence fragment.
//
// DISTINCTION RULE — Trigger Opening vs Goal Opening:
//   - Trigger Opening: Used when chunk.entry_type === "trigger".
//     The trigger IS the entry point for this automation path.
//   - Goal Opening: Used when chunk.entry_type === "goal".
//     The goal IS the entry point, and includes the "any contact
//     active anywhere in the automation is redirected" mechanic.
//   - Fork Branch with Goal: Used when chunk.entry_type === "fork_branch"
//     but a goal node is inside the branch. The goal acts as a redirect
//     gate within one of several simultaneous fork paths.

// Example: "When a contact is added to this automation, "
const TRIGGER_ADDED = "When a contact is added to this automation, ";

// Example: "When a contact submits the form 'Order Page', "
function triggerSubmitsForm(formName: string | null): string {
  if (formName) return `When a contact submits the form '${formName}', `;
  return "When a contact submits a form, ";
}

// Example: "When a new contact is created, "
const TRIGGER_CONTACT_CREATED = "When a new contact is created, ";

// Example: "When a contact's 'Membership Level' field is updated, "
// Example with condition: "When a contact's 'Cancellation Confirmed' field is updated to 'Yes', "
function triggerContactUpdated(fieldName: string | null, conditionValue?: string | null): string {
  if (fieldName && conditionValue) return `When a contact's '${fieldName}' field is updated to '${conditionValue}', `;
  if (fieldName) return `When a contact's '${fieldName}' field is updated, `;
  return "When a contact's field is updated, ";
}

// Example: "When a contact's credit card is charged or declined, "
const TRIGGER_CC_STATUS = "When a contact's credit card is charged or declined, ";

// Example: "When an open order for 'Digital Product Alpha' is successfully charged, "
function triggerOpenOrderCharged(productName: string | null): string {
  if (productName) return `When an open order for '${productName}' is successfully charged, `;
  return "When an open order is successfully charged, ";
}

// Example: "When a contact purchases 'Daily Lesson', "
function triggerProductPurchased(productName: string | null): string {
  if (productName) return `When a contact purchases '${productName}', `;
  return "When a contact makes a purchase, ";
}

// Example: "When the system date reaches March 29, 2026, "
function triggerSpecificDate(dateStr: string | null): string {
  if (dateStr) return `When the system date reaches ${dateStr}, `;
  return "When a specific date is reached, ";
}

// Example: "When a contact opens the email 'Welcome aboard!', "
function triggerOpensEmail(emailSubject: string | null): string {
  if (emailSubject) return `When a contact opens the email '${emailSubject}', `;
  return "When a contact opens an email, ";
}

// Example: "When a contact clicks a link in the email 'Newsletter', "
function triggerClicksEmail(emailSubject: string | null): string {
  if (emailSubject) return `When a contact clicks a link in the email '${emailSubject}', `;
  return "When a contact clicks a link in an email, ";
}

// Example: "When the tag 'VIP Customer' is applied to a contact, "
function triggerTagApplied(tagName: string | null): string {
  if (tagName) return `When the tag '${tagName}' is applied to a contact, `;
  return "When a tag is applied to a contact, ";
}

function triggerTagRemoved(tagName: string | null): string {
  if (tagName) return `When the tag '${tagName}' is removed from a contact, `;
  return "When a tag is removed from a contact, ";
}

// Example: "When the task 'Review Application' is completed, "
function triggerTaskCompleted(taskName: string | null): string {
  if (taskName) return `When the task '${taskName}' is completed, `;
  return "When a task is completed, ";
}

// Example: "When the contact's 'Birthday' date is reached, "
function triggerDateField(fieldName: string | null): string {
  if (fieldName) return `When the contact's '${fieldName}' date is reached, `;
  return "When a date field value is reached, ";
}

// Example: "When a contact visits the page 'Pricing', "
function triggerVisitsPage(pageName: string | null): string {
  if (pageName) return `When a contact visits the page '${pageName}', `;
  return "When a contact visits a page, ";
}

// Fallback: "When the trigger 'NEW TRIGGER' fires, "
function triggerFallback(label: string): string {
  return `When the trigger '${label}' fires, `;
}


// ============================================================
// GOAL OPENING TEMPLATES
// ============================================================
//
// Used when chunk.entry_type === "goal". The goal IS the entry point.
// Always includes the "any contact active anywhere" redirect mechanic.
//
// Example: "Any contact currently active anywhere in the automation is
//           redirected to this path when they achieve the goal 'Submits Form'
//           named 'Order Page'. "

const GOAL_PREFIX = "Any contact currently active anywhere in the automation is redirected to this path when they achieve the goal ";

function goalSubmitsForm(formName: string | null): string {
  if (formName) return `${GOAL_PREFIX}'Submits Form' named '${formName}'. `;
  return `${GOAL_PREFIX}'Submits Form'. `;
}

function goalProductPurchased(productName: string | null): string {
  if (productName) return `${GOAL_PREFIX}'Product is Purchased' for '${productName}'. `;
  return `${GOAL_PREFIX}'Product is Purchased'. `;
}

function goalTaskCompleted(taskName: string | null): string {
  if (taskName) return `${GOAL_PREFIX}'Task is Completed' for '${taskName}'. `;
  return `${GOAL_PREFIX}'Task is Completed'. `;
}

function goalOpensEmail(emailSubject: string | null): string {
  if (emailSubject) return `${GOAL_PREFIX}'Opens Email' named '${emailSubject}'. `;
  return `${GOAL_PREFIX}'Opens Email'. `;
}

function goalClicksEmail(emailSubject: string | null, linkIndex: string | null): string {
  const linkPart = linkIndex ? ` - link ${linkIndex}` : "";
  if (emailSubject) return `${GOAL_PREFIX}'Clicks Email Link${linkPart}' in '${emailSubject}'. `;
  return `${GOAL_PREFIX}'Clicks Email Link${linkPart}'. `;
}

function goalTagApplied(tagName: string | null): string {
  if (tagName) return `${GOAL_PREFIX}'Tag is Applied' for '${tagName}'. `;
  return `${GOAL_PREFIX}'Tag is Applied'. `;
}

function goalTagRemoved(tagName: string | null): string {
  if (tagName) return `${GOAL_PREFIX}'Tag is Removed' for '${tagName}'. `;
  return `${GOAL_PREFIX}'Tag is Removed'. `;
}

function goalVisitsPage(pageName: string | null): string {
  if (pageName) return `${GOAL_PREFIX}'Visits a Page' named '${pageName}'. `;
  return `${GOAL_PREFIX}'Visits a Page'. `;
}

function goalFallback(label: string): string {
  return `${GOAL_PREFIX}'${label}'. `;
}


// ============================================================
// FORK BRANCH WITH GOAL TEMPLATES
// ============================================================
//
// Used when chunk.entry_type === "fork_branch" but a goal node is
// the first meaningful node inside the branch. The goal acts as a
// redirect gate within one of several simultaneous fork paths.
//
// DISTINCTION from Goal Openings:
//   Goal entry chunks lead with "Any contact currently active anywhere..."
//   Fork branch goal chunks lead with "When the goal... is achieved,
//   any contact active anywhere..."
//
// Example: "When the goal 'Submits Form' named 'SSTG: Negative' is achieved,
//           any contact active anywhere in the automation is redirected
//           to this path. "

const FORK_GOAL_SUFFIX = ", any contact active anywhere in the automation is redirected to this path. ";

function forkBranchGoalSubmitsForm(formName: string | null): string {
  if (formName) return `When the goal 'Submits Form' named '${formName}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Submits Form' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalProductPurchased(productName: string | null): string {
  if (productName) return `When the goal 'Product is Purchased' for '${productName}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Product is Purchased' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalTaskCompleted(taskName: string | null): string {
  if (taskName) return `When the goal 'Task is Completed' for '${taskName}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Task is Completed' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalOpensEmail(emailSubject: string | null): string {
  if (emailSubject) return `When the goal 'Opens Email' named '${emailSubject}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Opens Email' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalClicksEmail(emailSubject: string | null, linkIndex: string | null): string {
  const linkPart = linkIndex ? ` - link ${linkIndex}` : "";
  if (emailSubject) return `When the goal 'Clicks Email Link${linkPart}' in '${emailSubject}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Clicks Email Link${linkPart}' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalTagApplied(tagName: string | null): string {
  if (tagName) return `When the goal 'Tag is Applied' for '${tagName}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Tag is Applied' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalVisitsPage(pageName: string | null): string {
  if (pageName) return `When the goal 'Visits a Page' named '${pageName}' is achieved${FORK_GOAL_SUFFIX}`;
  return `When the goal 'Visits a Page' is achieved${FORK_GOAL_SUFFIX}`;
}

function forkBranchGoalFallback(label: string): string {
  return `When the goal '${label}' is achieved${FORK_GOAL_SUFFIX}`;
}


// ============================================================
// ACTION SENTENCE TEMPLATES
// ============================================================
//
// Each action is its own sentence with uppercase first letter.
// These describe what happens to the contact at each step.

// Example: 'Sends the email "Welcome aboard!".'
function actionSendEmail(subject: string): string {
  return `Sends the email "${subject}".`;
}

// Example: 'Sends the email "Welcome aboard!" — confirms subscription and delivers the guide.'
function actionSendEmailWithProfile(subject: string, purpose: string): string {
  const trimmed = purpose.replace(/\.+$/, "");
  return `Sends the email "${subject}" — ${trimmed}.`;
}

// Example: 'Sends notification email "New lead alert".'
function actionEmailNotification(subject: string): string {
  return `Sends notification email "${subject}".`;
}

// Example: 'Sets "Sales Stage" to "Lead".'
function actionChangeField(fieldName: string, _action: string, value: string): string {
  if (!value && value !== "0") return `Clears the "${fieldName}" field.`;
  return `Sets "${fieldName}" to "${value}".`;
}

// Example: 'Adds tags: "VIP Customer", "Active".'
function actionAddTags(tagNames: string[]): string {
  return `Adds tags: ${tagNames.map(t => `"${t}"`).join(", ")}.`;
}

// Example: 'Removes tags: "Trial User".'
function actionRemoveTags(tagNames: string[]): string {
  return `Removes tags: ${tagNames.map(t => `"${t}"`).join(", ")}.`;
}

// Example: 'Assigns task "Review Application".'
function actionAssignTask(taskName: string): string {
  return `Assigns task "${taskName}".`;
}

// Example: 'Fires webhook to https://example.com/hook.'
function actionWebhook(url: string): string {
  return `Fires webhook to ${url}.`;
}

// Example: 'AI assistant processes prompt "Generate greeting" and stores the response in "Custom Greeting".'
function actionAiAssistant(prompt: string, storeField: string | null): string {
  const truncated = prompt.length > 80 ? prompt.substring(0, 80) + "..." : prompt;
  const storePart = storeField ? ` and stores the response in "${storeField}"` : "";
  return `AI assistant processes prompt "${truncated}"${storePart}.`;
}

// Example: 'The contact is added to "Follow-up Sequence".'
function actionAddToAutomation(automationName: string): string {
  return `The contact is added to "${automationName}".`;
}

// Example: 'The contact is removed from "Follow-up Sequence".'
function actionRemoveFromAutomation(automationName: string): string {
  return `The contact is removed from "${automationName}".`;
}


// ============================================================
// TERMINATION SENTENCE TEMPLATES
// ============================================================

// Example: "The path ends, but the contact remains on the automation map and is still eligible for goal redirects."
const TERMINATION_END_STAY = "The path ends, but the contact remains on the automation map and is still eligible for goal redirects.";

// Example: "The contact is fully removed from the automation."
const TERMINATION_EXIT = "The contact is fully removed from the automation.";

// Example: 'The contact exits this automation and is immediately enrolled in "Follow-up Sequence".'
function terminationMoveToAutomation(targetName: string): string {
  return `The contact exits this automation and is immediately enrolled in "${targetName}".`;
}


// ============================================================
// CONDITION FORK PARENT TEMPLATE
// ============================================================
//
// Used when chunk.is_fork_parent === true AND chunk.fork_type === "condition".
// Only qualifies for deterministic narration when the condition is resolved
// from the rule editor registry. Unresolved conditions fall back to LLM.
// Does NOT apply to split tests, wait+goal forks, or regular forks.
//
// Example: "When a contact is added to this automation, the automation
//           checks whether "Days Since Last Purchase" is greater than 30.
//           Contacts proceed down the matching branch."

const CONDITION_SUFFIX = " Contacts proceed down the matching branch.";

function conditionForkNarration(opening: string, conditionDesc: string, intermediateActions?: string): string {
  const trimmedOpening = opening.trimEnd().replace(/[,.\s]+$/, "");
  if (intermediateActions && intermediateActions.trim().length > 0) {
    const trimmedActions = intermediateActions.trimEnd().replace(/[.\s]+$/, "");
    return `${trimmedOpening}, ${trimmedActions}. Then, the automation checks whether ${conditionDesc}.${CONDITION_SUFFIX}`;
  }
  return `${trimmedOpening}, the automation checks whether ${conditionDesc}.${CONDITION_SUFFIX}`;
}


// ============================================================
// EVENT RESOLUTION HELPERS
// ============================================================
//
// These resolve trigger/goal events into entity names for template interpolation.

function extractTriggerConditionValue(trigNode: NodeDetail): string | null {
  const conditions = trigNode?.resource?.rule_editor?.conditions?.statement;
  if (!Array.isArray(conditions) || conditions.length !== 1) return null;
  const fc = conditions[0]?.field_condition;
  if (!fc || fc.a1 !== "e" || !fc.a2) return null;
  return fc.a2;
}

interface ResolvedEventInfo {
  eventType: string;
  entityName: string | null;
  dateStr: string | null;
  linkIndex: string | null;
}

function resolveEventInfo(events: Array<{ type: string; config: Record<string, any> }>, cache: EnrichmentCache): ResolvedEventInfo {
  if (events.length === 0) {
    return { eventType: "unknown", entityName: null, dateStr: null, linkIndex: null };
  }
  const evt = events[0];
  const evtType = evt.type || "";
  const a0 = evt.config?.a0 || "";
  const a1 = evt.config?.a1 || "";

  if (evtType.includes("form") || evtType.includes("fillout")) {
    const formId = a0?.toString().split(".")?.[0] || a0;
    const formName = cache.forms?.[formId] || cache.forms?.[a0] || null;
    return { eventType: "submits_form", entityName: formName, dateStr: null, linkIndex: null };
  }

  if (evtType === "object_create") {
    return { eventType: "contact_created", entityName: null, dateStr: null, linkIndex: null };
  }

  if (evtType === "field_update") {
    const fieldName = cache.fields?.[a0] || null;
    return { eventType: "contact_updated", entityName: fieldName, dateStr: null, linkIndex: null };
  }

  if (evtType === "cc_status") {
    return { eventType: "cc_status", entityName: null, dateStr: null, linkIndex: null };
  }

  if (evtType === "sub_product_action") {
    const productName = cache.products?.[a0]?.name || null;
    return { eventType: "open_order_charged", entityName: productName, dateStr: null, linkIndex: null };
  }

  if (evtType === "purchase_product") {
    const productName = cache.products?.[a0]?.name || null;
    return { eventType: "product_purchased", entityName: productName, dateStr: null, linkIndex: null };
  }

  if (evtType === "on_today") {
    let dateStr: string | null = null;
    const ts = parseInt(a0, 10);
    if (!isNaN(ts) && ts > 946684800 && ts < 4102444800) {
      const d = new Date(ts * 1000);
      dateStr = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    }
    return { eventType: "specific_date", entityName: null, dateStr, linkIndex: null };
  }

  if (evtType === "opens_email") {
    const emailId = a0;
    const msg = cache.messages?.[emailId];
    return { eventType: "opens_email", entityName: msg?.subject || null, dateStr: null, linkIndex: null };
  }

  if (evtType === "clicks_email") {
    const emailId = a0;
    const msg = cache.messages?.[emailId];
    const linkIdx = a1 && a1 !== "0" ? a1 : null;
    return { eventType: "clicks_email", entityName: msg?.subject || null, dateStr: null, linkIndex: linkIdx };
  }

  if (evtType === "tag_added" || evtType === "object_tag" || evtType === "sub_tag") {
    const tagName = cache.tags?.[a0] || null;
    return { eventType: "tag_applied", entityName: tagName, dateStr: null, linkIndex: null };
  }

  if (evtType === "usub_tag") {
    const tagName = cache.tags?.[a0] || null;
    return { eventType: "tag_removed", entityName: tagName, dateStr: null, linkIndex: null };
  }

  if (evtType === "object_completed_task") {
    const taskName = cache.tasks?.[a0] || null;
    return { eventType: "task_completed", entityName: taskName, dateStr: null, linkIndex: null };
  }

  if (evtType === "date_is" || evtType === "anniversary") {
    const fieldName = cache.fields?.[a0] || null;
    return { eventType: "date_field", entityName: fieldName, dateStr: null, linkIndex: null };
  }

  if (evtType === "visits_page" || evtType === "visits_url") {
    const pageName = cache.landing_pages?.[a0] || null;
    return { eventType: "visits_page", entityName: pageName, dateStr: null, linkIndex: null };
  }

  return { eventType: evtType, entityName: null, dateStr: null, linkIndex: null };
}

export function resolveSingleGoalDescription(goalChunk: Chunk, cache: EnrichmentCache): string | null {
  const goalNode = goalChunk.node_details[0];
  if (!goalNode) return null;
  const events = goalChunk.trigger_goal_semantics?.events || [];

  const goalRes = goalNode.resource || {};
  const ruleEditor = goalRes.rule_editor;
  let goalEvents: Array<{ type: string; config: Record<string, any> }> = [];

  if (ruleEditor?.events?.statement) {
    const stmts = ruleEditor.events.statement;
    if (Array.isArray(stmts)) {
      for (const stmt of stmts) {
        if (!stmt || typeof stmt !== "object") continue;
        for (const [eventKey, config] of Object.entries(stmt)) {
          if (config && typeof config === "object" && !Array.isArray(config)) {
            goalEvents.push({ type: eventKey, config: config as Record<string, any> });
          }
        }
      }
    }
  }

  if (goalEvents.length === 0 && events.length > 0) {
    goalEvents = events;
  }

  if (goalEvents.length === 0) {
    const label = (goalNode.label || "").trim();
    return label ? `'${label}'` : null;
  }

  if (goalEvents.length > 1) {
    const label = (goalNode.label || "").trim();
    return label ? `'${label}'` : null;
  }

  const info = resolveEventInfo(goalEvents, cache);
  switch (info.eventType) {
    case "submits_form":
      return info.entityName ? `'Submits Form' named '${info.entityName}'` : `'Submits Form'`;
    case "product_purchased":
      return info.entityName ? `'Product is Purchased' for '${info.entityName}'` : `'Product is Purchased'`;
    case "task_completed":
      return info.entityName ? `'Task is Completed' for '${info.entityName}'` : `'Task is Completed'`;
    case "opens_email":
      return info.entityName ? `'Opens Email' named '${info.entityName}'` : `'Opens Email'`;
    case "clicks_email": {
      const linkPart = info.linkIndex ? ` - link ${info.linkIndex}` : "";
      return info.entityName ? `'Clicks Email Link${linkPart}' in '${info.entityName}'` : `'Clicks Email Link${linkPart}'`;
    }
    case "tag_applied":
      return info.entityName ? `'Tag is Applied' for '${info.entityName}'` : `'Tag is Applied'`;
    case "tag_removed":
      return info.entityName ? `'Tag is Removed' for '${info.entityName}'` : `'Tag is Removed'`;
    case "visits_page":
      return info.entityName ? `'Visits a Page' named '${info.entityName}'` : `'Visits a Page'`;
    default: {
      const label = (goalNode.label || "").trim();
      return label ? `'${label}'` : null;
    }
  }
}


// ============================================================
// PUBLIC API — Opening Generators
// ============================================================

export function buildTriggerOpening(chunk: Chunk, cache: EnrichmentCache): string {
  const trigNode = chunk.node_details[0];
  const label = (trigNode?.label || "").toUpperCase().trim();
  const events = chunk.trigger_goal_semantics?.events || [];

  if (label === "ADDED TO AUTOMATION" || label === "ADDED TO CAMPAIGN") {
    return TRIGGER_ADDED;
  }

  if (events.length > 0) {
    const info = resolveEventInfo(events, cache);

    switch (info.eventType) {
      case "submits_form": return triggerSubmitsForm(info.entityName);
      case "contact_created": return TRIGGER_CONTACT_CREATED;
      case "contact_updated": {
        const condVal = extractTriggerConditionValue(trigNode);
        return triggerContactUpdated(info.entityName, condVal);
      }
      case "cc_status": return TRIGGER_CC_STATUS;
      case "open_order_charged": return triggerOpenOrderCharged(info.entityName);
      case "product_purchased": return triggerProductPurchased(info.entityName);
      case "specific_date": return triggerSpecificDate(info.dateStr);
      case "opens_email": return triggerOpensEmail(info.entityName);
      case "clicks_email": return triggerClicksEmail(info.entityName);
      case "tag_applied": return triggerTagApplied(info.entityName);
      case "tag_removed": return triggerTagRemoved(info.entityName);
      case "task_completed": return triggerTaskCompleted(info.entityName);
      case "date_field": return triggerDateField(info.entityName);
      case "visits_page": return triggerVisitsPage(info.entityName);
    }
  }

  if (label.includes("SUBMIT") && label.includes("FORM")) return triggerSubmitsForm(null);
  if (label.includes("CREATED")) return TRIGGER_CONTACT_CREATED;
  if (label.includes("UPDATED")) return triggerContactUpdated(null);
  if (label.includes("CHARGED") || label.includes("DECLINED")) return TRIGGER_CC_STATUS;
  if (label.includes("PURCHASED")) return triggerProductPurchased(null);
  if (label.includes("TAG")) return triggerTagApplied(null);
  if (label.includes("TASK") && label.includes("COMPLETED")) return triggerTaskCompleted(null);
  if (label.includes("DATE") || label.includes("ANNIVERSARY")) return triggerDateField(null);
  if (label.includes("VISIT") && label.includes("PAGE")) return triggerVisitsPage(null);

  return triggerFallback(trigNode?.label || "unknown");
}

export function buildGoalOpening(chunk: Chunk, cache: EnrichmentCache): string {
  const goalNode = chunk.node_details[0];
  const label = (goalNode?.label || "").trim();
  const events = chunk.trigger_goal_semantics?.events || [];

  if (events.length > 0) {
    const info = resolveEventInfo(events, cache);

    switch (info.eventType) {
      case "submits_form": return goalSubmitsForm(info.entityName);
      case "product_purchased": return goalProductPurchased(info.entityName);
      case "task_completed": return goalTaskCompleted(info.entityName);
      case "opens_email": return goalOpensEmail(info.entityName);
      case "clicks_email": return goalClicksEmail(info.entityName, info.linkIndex);
      case "tag_applied": return goalTagApplied(info.entityName);
      case "tag_removed": return goalTagRemoved(info.entityName);
      case "visits_page": return goalVisitsPage(info.entityName);
    }
  }

  return goalFallback(label || "unknown goal");
}

export function buildForkBranchGoalOpening(goalNode: NodeDetail, chunk: Chunk, cache: EnrichmentCache): string {
  const label = (goalNode.label || "").trim();
  const events = chunk.trigger_goal_semantics?.events || [];
  const goalRes = goalNode.resource || {};
  const ruleEditor = goalRes.rule_editor;
  let goalEvents: Array<{ type: string; config: Record<string, any> }> = [];

  if (ruleEditor?.events?.statement) {
    const stmts = ruleEditor.events.statement;
    if (Array.isArray(stmts)) {
      for (const stmt of stmts) {
        if (!stmt || typeof stmt !== "object") continue;
        for (const [eventKey, config] of Object.entries(stmt)) {
          if (config && typeof config === "object" && !Array.isArray(config)) {
            goalEvents.push({ type: eventKey, config: config as Record<string, any> });
          }
        }
      }
    }
  }

  if (goalEvents.length === 0 && events.length > 0) {
    goalEvents = events;
  }

  if (goalEvents.length > 0) {
    const info = resolveEventInfo(goalEvents, cache);
    switch (info.eventType) {
      case "submits_form": return forkBranchGoalSubmitsForm(info.entityName);
      case "product_purchased": return forkBranchGoalProductPurchased(info.entityName);
      case "task_completed": return forkBranchGoalTaskCompleted(info.entityName);
      case "opens_email": return forkBranchGoalOpensEmail(info.entityName);
      case "clicks_email": return forkBranchGoalClicksEmail(info.entityName, info.linkIndex);
      case "tag_applied": return forkBranchGoalTagApplied(info.entityName);
      case "visits_page": return forkBranchGoalVisitsPage(info.entityName);
    }
  }

  return forkBranchGoalFallback(label || "unknown goal");
}


// ============================================================
// PUBLIC API — Action Sentence Builder
// ============================================================

export function buildActionSentence(nd: NodeDetail, cache: EnrichmentCache, profiles?: ProfileLookup, singleGoalDescription?: string | null, hasGoals?: boolean): string | null {
  const nType = (nd.type || "").toLowerCase();
  const res = nd.resource || {};

  if (nType === "note" || nType === "trigger" || nType === "goal" || nType === "goto") return null;

  if (nType === "wait") {
    const waitDesc = buildWaitDescriptionForTemplate(res, cache, singleGoalDescription, hasGoals);
    return (waitDesc || "Waits for a configured duration") + ".";
  }

  if (nType === "end") {
    const removes = res.remove_contacts === "1";
    const moves = res.move_contacts === "1";
    const moveTarget = res.move_contacts_to;
    if (moves && moveTarget) {
      const targetName = cache.campaigns[moveTarget] || `Automation #${moveTarget}`;
      return terminationMoveToAutomation(targetName);
    } else if (removes) {
      return TERMINATION_EXIT;
    } else {
      return TERMINATION_END_STAY;
    }
  }

  if ((nType === "send_email" || nType === "email") && res.object_id) {
    const id = String(res.object_id);
    const profileKey = `message.email:${id}`;
    const profile = profiles?.[profileKey];
    if (profile && profile.status === "ready") {
      const msg = cache.messages[id];
      const subject = msg?.subject || profile.objectName;
      return actionSendEmailWithProfile(subject, profile.profile.purpose);
    }
    const msg = cache.messages[id];
    if (msg) {
      return actionSendEmail(msg.subject);
    }
  }

  if ((nType === "send_email" || nType === "email") && (!res.object_id || res.object_id === "0")) {
    return "an unconfigured 'Send An Email' step is present (no email selected).";
  }

  if (nType === "email_notify") {
    const emailId = res.email_selector || res.object_id;
    if (emailId) {
      const msg = cache.messages[String(emailId)];
      if (msg) {
        return actionEmailNotification(msg.subject);
      }
    }
  }

  if ((nType === "change_field" || nType === "update_contact") && res.update_contact_field) {
    const fieldName = cache.fields[res.update_contact_field] || res.update_contact_field || "unknown field";
    const rawVal = res.update_contact_val;
    const valueName = rawVal && cache.field_values[rawVal] ? cache.field_values[rawVal] : rawVal;
    const action = res.list_action_selector || "SET";
    return actionChangeField(fieldName, action, valueName);
  }

  if (nType === "change_tags" && res.tag_selector) {
    const tagList = res.tag_selector.list;
    const isAdd = res.tag_selector.sub_unsub === "add_list";
    if (Array.isArray(tagList) && tagList.length > 0) {
      const tagNames = tagList.map((t: any) => cache.tags[t.value] || t.label || t.value);
      return isAdd ? actionAddTags(tagNames) : actionRemoveTags(tagNames);
    }
  }

  if (nType === "add_tag" && res.add_tag) {
    const tagName = cache.tags[res.add_tag] || res.add_tag;
    return actionAddTags([tagName]);
  }

  if (nType === "remove_tag" && res.remove_tag) {
    const tagName = cache.tags[res.remove_tag] || res.remove_tag;
    return actionRemoveTags([tagName]);
  }

  if ((nType === "assign_task" || nType === "create_task") && res.object_id) {
    const taskName = cache.tasks[String(res.object_id)] || `unknown task`;
    return actionAssignTask(taskName);
  }

  if (nType === "webhook") {
    const url = res.webhook_url || res.destination_url || res.url || "";
    const cleaned = cache.webhook_urls[url] || url;
    return actionWebhook(cleaned);
  }

  if (nType === "ai_assistant" || nType === "ai assistant") {
    const prompt = res.ai_prompt || res.prompt || "";
    const storeField = res.store_response_in ? (cache.fields[res.store_response_in] || res.store_response_in) : null;
    return actionAiAssistant(prompt, storeField);
  }

  if (nType === "add_to_campaign" || nType === "move_to_campaign") {
    const targetId = res.add_to_campaign_id || res.campaign_id || res.move_contacts_to || "";
    const targetName = cache.campaigns[targetId] || `Automation #${targetId}`;
    if (nType === "move_to_campaign" || res.move_contacts === "1") {
      return terminationMoveToAutomation(targetName);
    }
    return actionAddToAutomation(targetName);
  }

  if (nType === "remove_from_campaign") {
    const targetId = res.remove_from_campaign_id || res.campaign_id || "";
    const targetName = cache.campaigns[targetId] || `Automation #${targetId}`;
    return actionRemoveFromAutomation(targetName);
  }

  if (nType === "give_wp_membership" || nType === "give wp membership access" || nType === "pilotpress_give") {
    const site = res.wordpress_site || res.site_id || "an unknown WordPress site";
    const level = res.membership_level || res.level_id || "an unknown membership level";
    return `Gives the contact access to the '${level}' membership level on ${site}.`;
  }

  if (nType === "remove_wp_membership" || nType === "remove wp membership access" || nType === "pilotpress_remove") {
    const site = res.wordpress_site || res.site_id || "an unknown WordPress site";
    const level = res.membership_level || res.level_id || "an unknown membership level";
    return `Removes the contact's access to the '${level}' membership level on ${site}.`;
  }

  if (nType === "update_membership_access") {
    const site = res.membership_site ? `membership site #${res.membership_site}` : "an unknown membership site";
    const status = res.membership_status;
    if (status === "0") return `Disables the contact's access to ${site}.`;
    if (status === "1") return `Grants the contact access to ${site}.`;
    return `Updates the contact's membership access on ${site}.`;
  }

  if (nType === "cancel_open_order") {
    return "Cancels the contact's open order.";
  }

  return null;
}


// ============================================================
// PUBLIC API — Condition Resolution
// ============================================================

export function resolveConditionForDeterministic(chunk: Chunk, cache: EnrichmentCache): string | null {
  const condNode = chunk.node_details.find(nd => (nd.type || "").toLowerCase() === "condition");
  if (!condNode) return null;

  const ruleEditor = condNode.resource?.rule_editor;
  if (!ruleEditor) return null;

  const nameMap = buildEnrichmentNameMap(cache);
  const parts: string[] = [];

  const condStmts = ruleEditor.conditions?.statement;
  if (Array.isArray(condStmts)) {
    for (const stmt of condStmts) {
      if (!stmt || typeof stmt !== "object") continue;
      for (const [condKey, config] of Object.entries(stmt)) {
        if (!config || typeof config !== "object" || Array.isArray(config)) continue;
        const resolved = resolveConditionStatement(condKey, config as Record<string, any>, nameMap);
        if (resolved) {
          parts.push(resolved.resolvedDescription);
        }
      }
    }
  }

  if (parts.length === 0) return null;
  const conjunctions = ruleEditor.conditions?.conjunction || [];
  const conjLabel = conjunctions.includes("1") ? " OR " : " AND ";
  return parts.join(conjLabel);
}

export function buildConditionForkNarration(opening: string, conditionDesc: string, intermediateActions?: string): string {
  return conditionForkNarration(opening, conditionDesc, intermediateActions);
}


// ============================================================
// PUBLIC API — Full Deterministic Narration Assemblers
// ============================================================

function findSingleGoalDescFromChunk(chunk: Chunk, cache: EnrichmentCache, allChunks?: Chunk[]): string | null {
  if (!allChunks || chunk.sub_chunks.length === 0) return null;
  const goalChunks = chunk.sub_chunks
    .map(scId => allChunks.find(c => c.id === scId))
    .filter((c): c is Chunk => c != null && c.entry_type === "goal");
  if (goalChunks.length !== 1) return null;
  return resolveSingleGoalDescription(goalChunks[0], cache);
}

function chunkHasGoalSubChunks(chunk: Chunk, allChunks: Chunk[]): boolean {
  if (chunk.sub_chunks.length === 0) return false;
  return chunk.sub_chunks.some(scId => {
    const sc = allChunks.find(c => c.id === scId);
    return sc != null && sc.entry_type === "goal";
  });
}

export function assembleTriggerNarration(
  chunk: Chunk,
  cache: EnrichmentCache,
  profiles: ProfileLookup,
  allChunks: Chunk[],
  findGotoTarget: (targetNodeId: string, allChunks: Chunk[], cache: EnrichmentCache) => string,
): string | null {
  const opening = buildTriggerOpening(chunk, cache);
  const actionNodes = chunk.node_details.slice(1);
  const sentences: string[] = [];
  const singleGoalDesc = findSingleGoalDescFromChunk(chunk, cache, allChunks);
  const hasGoals = chunkHasGoalSubChunks(chunk, allChunks);
  const terminationId = chunk.termination_node_id;

  for (const nd of actionNodes) {
    const isTerminationWait = nd.id === terminationId;
    const sentence = buildActionSentence(nd, cache, profiles, isTerminationWait ? singleGoalDesc : null, isTerminationWait ? hasGoals : undefined);
    if (sentence) sentences.push(sentence);
  }

  if (chunk.goto_target_node) {
    const targetDesc = findGotoTarget(chunk.goto_target_node, allChunks, cache);
    if (targetDesc.startsWith("VERBATIM_GOTO: ")) {
      const verbatim = targetDesc.replace("VERBATIM_GOTO: ", "");
      sentences.push(verbatim.charAt(0).toUpperCase() + verbatim.slice(1));
    } else {
      return null;
    }
  }

  const joined = sentences.join(" ").replace(/\.\./g, ".").trim();
  return (opening + joined).trim();
}

export function assembleGoalNarration(
  chunk: Chunk,
  cache: EnrichmentCache,
  profiles: ProfileLookup,
  allChunks?: Chunk[],
  findGotoTarget?: (targetNodeId: string, allChunks: Chunk[], cache: EnrichmentCache) => string,
): string | null {
  const opening = buildGoalOpening(chunk, cache);
  const actionNodes = chunk.node_details.slice(1);
  const sentences: string[] = [];
  const singleGoalDesc = findSingleGoalDescFromChunk(chunk, cache, allChunks);
  const hasGoals = allChunks ? chunkHasGoalSubChunks(chunk, allChunks) : undefined;
  const terminationId = chunk.termination_node_id;

  for (const nd of actionNodes) {
    const isTerminationWait = nd.id === terminationId;
    const sentence = buildActionSentence(nd, cache, profiles, isTerminationWait ? singleGoalDesc : null, isTerminationWait ? hasGoals : undefined);
    if (sentence) sentences.push(sentence);
  }

  if (chunk.goto_target_node && allChunks && findGotoTarget) {
    const targetDesc = findGotoTarget(chunk.goto_target_node, allChunks, cache);
    if (targetDesc.startsWith("VERBATIM_GOTO: ")) {
      const verbatim = targetDesc.replace("VERBATIM_GOTO: ", "");
      sentences.push(verbatim.charAt(0).toUpperCase() + verbatim.slice(1));
    } else {
      return null;
    }
  }

  const joined = sentences.join(" ").replace(/\.\./g, ".").trim();
  return (opening + joined).trim();
}

export function assembleForkBranchWithGoalNarration(
  chunk: Chunk,
  cache: EnrichmentCache,
  profiles: ProfileLookup,
): string {
  const goalNode = chunk.node_details.find(nd => (nd.type || "").toLowerCase() === "goal");
  if (!goalNode) return "";

  const opening = buildForkBranchGoalOpening(goalNode, chunk, cache);
  const sentences: string[] = [];

  for (const nd of chunk.node_details) {
    if ((nd.type || "").toLowerCase() === "goal") continue;
    const sentence = buildActionSentence(nd, cache, profiles);
    if (sentence) sentences.push(sentence);
  }

  const joined = sentences.join(" ").replace(/\.\./g, ".").trim();
  return (opening + joined).trim();
}


// ============================================================
// WAIT DESCRIPTION HELPER (duplicated from narrator to avoid circular deps)
// ============================================================

function formatWaitTime(timeStr: string): string {
  const match = timeStr.match(/^(\d+):(\d+):(am|pm)$/i);
  if (!match) return timeStr;
  const hour = parseInt(match[1], 10);
  const minute = match[2];
  const ampm = match[3].toLowerCase();
  return minute === "00" ? `${hour}${ampm}` : `${hour}:${minute}${ampm}`;
}

function buildWaitDescriptionForTemplate(res: Record<string, any>, cache: EnrichmentCache, singleGoalDescription?: string | null, hasGoals?: boolean): string | null {
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


// ============================================================
// PREVIEW DATA — For the copy writer preview endpoint
// ============================================================

export function getTemplatePreview(): object {
  return {
    trigger_openings: [
      { name: "ADDED TO AUTOMATION / ADDED TO CAMPAIGN", template: TRIGGER_ADDED, example: TRIGGER_ADDED + 'Sends the email "Welcome aboard!". The contact is fully removed from the automation.' },
      { name: "SUBMITS FORM (resolved)", template: "When a contact submits the form '[Form Name]', ", example: triggerSubmitsForm("Order Page") + 'Sets "Sales Stage" SET "Lead". The contact is fully removed from the automation.' },
      { name: "SUBMITS FORM (unresolved)", template: "When a contact submits a form, ", example: triggerSubmitsForm(null) + 'Sends the email "Thank you!". The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "CONTACT IS CREATED", template: TRIGGER_CONTACT_CREATED, example: TRIGGER_CONTACT_CREATED + 'Sets "Sales Stage" SET "Prospect". The contact is fully removed from the automation.' },
      { name: "CONTACT IS UPDATED (resolved)", template: "When a contact's '[Field Name]' field is updated, ", example: triggerContactUpdated("Membership Level") + 'Adds tags: "Active Member". The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "CC IS CHARGED OR DECLINED", template: TRIGGER_CC_STATUS, example: TRIGGER_CC_STATUS + 'Fires webhook to https://example.com/hook. Sets "Sales Stage" SET "Declined Credit Card". The contact is fully removed from the automation.' },
      { name: "OPEN ORDER IS CHARGED (resolved)", template: "When an open order for '[Product Name]' is successfully charged, ", example: triggerOpenOrderCharged("Digital Product Alpha") + 'Sets "Last Payment Date" SET "today". The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "PRODUCT IS PURCHASED (resolved)", template: "When a contact purchases '[Product Name]', ", example: triggerProductPurchased("Daily Lesson") + 'Sends the email "Your purchase confirmation". The contact is fully removed from the automation.' },
      { name: "TODAY IS A SPECIFIC DATE", template: "When the system date reaches [Date], ", example: triggerSpecificDate("March 29, 2026") + 'Sends the email "Spring Sale Announcement". The contact is fully removed from the automation.' },
      { name: "OPENS EMAIL (resolved)", template: "When a contact opens the email '[Email Subject]', ", example: triggerOpensEmail("Welcome aboard!") + 'Adds tags: "Engaged". The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "CLICKS EMAIL LINK (resolved)", template: "When a contact clicks a link in the email '[Email Subject]', ", example: triggerClicksEmail("Newsletter") + 'Sets "Engagement Level" SET "High". The contact is fully removed from the automation.' },
      { name: "TAG IS APPLIED (resolved)", template: "When the tag '[Tag Name]' is applied to a contact, ", example: triggerTagApplied("VIP Customer") + 'Sends the email "VIP Welcome". The contact is fully removed from the automation.' },
      { name: "TASK IS COMPLETED (resolved)", template: "When the task '[Task Name]' is completed, ", example: triggerTaskCompleted("Review Application") + 'Adds tags: "Reviewed". The contact is fully removed from the automation.' },
      { name: "DATE IS / ANNIVERSARY (resolved)", template: "When the contact's '[Field Name]' date is reached, ", example: triggerDateField("Birthday") + 'Sends the email "Happy Birthday!". The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "VISITS A PAGE (resolved)", template: "When a contact visits the page '[Page Name]', ", example: triggerVisitsPage("Pricing") + 'Adds tags: "Interested". The contact is fully removed from the automation.' },
      { name: "Fallback (unknown)", template: "When the trigger '[Trigger Label]' fires, ", example: triggerFallback("NEW TRIGGER") + 'The contact is added to "Follow-up Sequence".' },
    ],
    goal_openings: [
      { name: "Submits Form (resolved)", template: `${GOAL_PREFIX}'Submits Form' named '[Form Name]'. `, example: goalSubmitsForm("SSTG: Happy") + 'Sends notification email "You got positive feedback". The contact is fully removed from the automation.' },
      { name: "Product is Purchased (resolved)", template: `${GOAL_PREFIX}'Product is Purchased' for '[Product Name]'. `, example: goalProductPurchased("Daily Lesson") + 'The path ends, but the contact remains on the automation map and is still eligible for goal redirects.' },
      { name: "Task is Completed (resolved)", template: `${GOAL_PREFIX}'Task is Completed' for '[Task Name]'. `, example: goalTaskCompleted("Review Cancellation") + 'The contact is fully removed from the automation.' },
      { name: "Opens Email (resolved)", template: `${GOAL_PREFIX}'Opens Email' named '[Email Subject]'. `, example: goalOpensEmail("Welcome Guide") + 'Adds tags: "Engaged Reader". The contact is fully removed from the automation.' },
      { name: "Clicks Email Link (resolved)", template: `${GOAL_PREFIX}'Clicks Email Link - link N' in '[Email Subject]'. `, example: goalClicksEmail("Satisfaction Survey", "1") + 'Sets "Customer Satisfaction" SET "Happy". The contact is fully removed from the automation.' },
      { name: "Tag is Applied (resolved)", template: `${GOAL_PREFIX}'Tag is Applied' for '[Tag Name]'. `, example: goalTagApplied("Purchased") + 'The contact is fully removed from the automation.' },
      { name: "Visits a Page (resolved)", template: `${GOAL_PREFIX}'Visits a Page' named '[Page Name]'. `, example: goalVisitsPage("Checkout") + 'The contact is fully removed from the automation.' },
      { name: "Fallback", template: `${GOAL_PREFIX}'[Goal Label]'. `, example: goalFallback("Custom Goal") + 'The contact is fully removed from the automation.' },
    ],
    fork_branch_with_goal: [
      { name: "Submits Form (resolved)", template: `When the goal 'Submits Form' named '[Form Name]' is achieved${FORK_GOAL_SUFFIX}`, example: forkBranchGoalSubmitsForm("SSTG: Negative") + 'Sends notification email "You got negative feedback". The contact is fully removed from the automation.' },
      { name: "Clicks Email Link (resolved)", template: `When the goal 'Clicks Email Link - link N' in '[Email Subject]' is achieved${FORK_GOAL_SUFFIX}`, example: forkBranchGoalClicksEmail("Satisfaction Survey", "3") + 'Sets "Customer Satisfaction" SET "Unhappy". The contact is fully removed from the automation.' },
      { name: "Fallback", template: `When the goal '[Goal Label]' is achieved${FORK_GOAL_SUFFIX}`, example: forkBranchGoalFallback("Custom Goal") + 'The contact is fully removed from the automation.' },
    ],
    action_sentences: [
      { name: "Send Email", template: 'Sends the email "[Subject]".', example: actionSendEmail("Welcome aboard!") },
      { name: "Send Email (with profile)", template: 'Sends the email "[Subject]" — [purpose].', example: actionSendEmailWithProfile("Welcome aboard!", "confirms subscription and delivers the guide") },
      { name: "Email Notification", template: 'Sends notification email "[Subject]".', example: actionEmailNotification("New lead alert") },
      { name: "Change Field", template: 'Sets "[Field Name]" to "[Value]".', example: actionChangeField("Sales Stage", "SET", "Lead") },
      { name: "Add Tags", template: 'Adds tags: "[Tag1]", "[Tag2]".', example: actionAddTags(["VIP Customer", "Active"]) },
      { name: "Remove Tags", template: 'Removes tags: "[Tag1]".', example: actionRemoveTags(["Trial User"]) },
      { name: "Wait", template: "[Wait description].", example: "Wait 3 days." },
      { name: "Assign Task", template: 'Assigns task "[Task Name]".', example: actionAssignTask("Review Application") },
      { name: "Webhook", template: "Fires webhook to [URL].", example: actionWebhook("https://example.com/hook") },
      { name: "AI Assistant", template: 'AI assistant processes prompt "[prompt]" and stores the response in "[Field]".', example: actionAiAssistant("Generate a personalized greeting", "Custom Greeting") },
      { name: "Add to Automation", template: 'The contact is added to "[Automation Name]".', example: actionAddToAutomation("Follow-up Sequence") },
      { name: "Remove from Automation", template: 'The contact is removed from "[Automation Name]".', example: actionRemoveFromAutomation("Trial Sequence") },
    ],
    termination_sentences: [
      { name: "End (stay on map)", template: TERMINATION_END_STAY, example: TERMINATION_END_STAY },
      { name: "Exit (remove)", template: TERMINATION_EXIT, example: TERMINATION_EXIT },
      { name: "Move to automation", template: 'The contact exits this automation and is immediately enrolled in "[Target Automation]".', example: terminationMoveToAutomation("Follow-up Sequence") },
      { name: "GoTo (verbatim)", template: "[Verbatim GoTo sentence from Task #18]", example: "They are routed via GoTo into Trigger 2's path, entering at the Send Email step 'Welcome Email', and continue from there." },
    ],
    condition_fork_parent: [
      { name: "Condition Fork", template: '[opening], the automation checks whether [condition]. Contacts proceed down the matching branch.', example: conditionForkNarration("When a contact is added to this automation", '"Days Since Last Purchase" greater than "30"') },
    ],
    distinction_rules: {
      goal_vs_fork_branch: "Goal Opening (entry_type='goal'): The goal IS the entry point. Leads with 'Any contact currently active anywhere...'. Fork Branch with Goal (entry_type='fork_branch' with goal node inside): Goal is a redirect gate within a fork. Leads with 'When the goal... is achieved, any contact active anywhere...'.",
    },
  };
}
