import type { Chunk, EnrichmentCache, NodeDetail } from "./types.js";
import { resolveEventStatement, resolveConditionStatement, buildEnrichmentNameMap } from "./rule-editor-registry.js";
import { buildWaitDescription, resolveNodeDescription, formatDuration, findGotoTargetDescription } from "./narrator-goto.js";
import type { ProfileLookup } from "./narrator-templates.js";

export const SYSTEM_PROMPT = `You are describing what a specific section of an Ontraport automation does to contacts who pass through it. Write a practical, specific description focused on the business actions and their effects.

Guidelines:
- Lead with the concrete action: what field gets set, what email gets sent, what tag gets applied, what webhook fires.
- Use resolved names (field names, value labels, email subjects, tag names, landing page names) — never raw IDs.
- For wait steps, the resolved data includes an EXACT wait description (e.g., "Wait until 30 days after Last Payment Date at 11:30pm in Contact's timezone" or "Waits here until one or more of the attached goals are achieved"). You MUST copy this exact text into your narration — do NOT summarize it as "waits for a duration" or "waits for an unspecified duration". The wait description is pre-computed and precise; your job is to include it verbatim.
- For wait steps with wait_type "forever": the pre-computed wait description is authoritative. It will say either "Waits here indefinitely" (when no goals are attached) or "Waits here until one or more of the attached goals are achieved" (when goals exist), or name a specific goal. Copy the wait description verbatim — do NOT rephrase, summarize, or override it.
- For trigger entry points, briefly state what event starts this path.
- For goals that reference a form or other entity, say the goal is "named" that entity — e.g. "achieve the goal 'Submits Form' named 'Order Page'" — do NOT say "by submitting the 'Order Page' form" or "for submitting". The word "named" connects the goal label to the resolved entity name.
- For triggers that reference an entity, use the same pattern: "visits the landing page 'Page Name'" — do NOT say "visits an unknown landing page" when the resolved data provides the landing page name.
- For goal nodes: ANY contact currently active ANYWHERE in the automation is redirected to the goal path the moment the goal condition is met — not only contacts sitting at a linked wait node. This is Ontraport's jump-back mechanic. Include this in the narration when the goal has downstream steps.
- For end nodes, the resolved data includes an END MODE label. Narrate each mode distinctly:
  - "end" — the path ends but the contact remains on the automation map and is still eligible for goal redirects.
  - "exit" — the contact is fully removed from the automation and is no longer eligible for goal redirects or any automation mechanics.
  - "move_to_automation" — the contact exits this automation and is immediately enrolled in the named target automation.
  Never say just "the automation ends" generically — always specify the end mode's consequences.
- For goto nodes: describe WHERE the contact is sent (the target), not just that they "go to" something. If the goto target is described, reference it by its meaningful description. When a goto points to an upstream node, explicitly call it a LOOP — never describe it as a simple forward jump.
- CRITICAL — GoTo-merge into another trigger: When the chunk data contains a "GOTO REDIRECT (USE THIS SENTENCE VERBATIM)" instruction, you MUST copy that sentence exactly into your narration — word for word, no rephrasing, no additions, no omissions. This sentence is pre-computed and deterministic. Your only job is to place it at the correct point in the narration (typically at the end, after describing any actions that precede the GoTo).
- For Wait + Goal patterns: The wait step has an attached goal with two possible outcomes. If the contact achieves the goal BEFORE the wait duration expires, they immediately exit the wait and follow the "goal_achieved" path. If the wait duration expires without the goal being met, the contact continues down the "proceed_if_not_achieved" fallback path. Describe both outcomes clearly — name the goal and specify the wait duration. This is NOT a fork where contacts go down both paths.
- For split tests (A/B tests): contacts are randomly assigned to EXACTLY ONE path based on the given weights — they do NOT go down all paths. Always include exact percentages (e.g., "50% go to Path A, 50% go to Path B"). The paths reconverge after the split.
- For forks: ALL contacts go down ALL paths simultaneously/concurrently. The contact is NOT duplicated or split — the same contact moves forward on both paths at the same time. Name both the main path and the secondary path explicitly.
- For AI Assistant nodes: describe what the AI does — the prompt/instruction, what field the response is stored in (use resolved field name), and any credit limits. Example: "The AI generates hyper-specific content using the prompt '...' and stores the response in the '...' field."
- For webhook nodes: describe the webhook action — the destination URL and any relevant context. Example: "Sends contact data to a webhook at https://example.com/hook."
- For Give WP Membership Access nodes: describe which WordPress site and membership level access is granted to. Example: "Gives the contact access to the 'Gold' membership level on the WordPress site."
- For Remove WP Membership Access nodes: describe which WordPress site and membership level access is revoked from. Example: "Removes the contact's access to the 'Gold' membership level on the WordPress site."
- For Update Membership Access nodes: describe whether membership access is being granted or disabled for the referenced membership site. Use "membership site" (not "WordPress site"). Example: "Disables the contact's access to membership site #1." or "Grants the contact access to membership site #2."
- If there are unconfigured/draft elements, note them briefly.
- Keep it to 1-3 sentences. Be specific and direct — describe THIS automation's actions, not how automations work in general.
- Do NOT explain platform mechanics (what "scope" means, how "collision" works, what "convergence" is). Just describe what happens to the contact.
- Do NOT use markdown formatting. Write plain text.

CRITICAL — accuracy over completeness:
- NEVER invent, infer, or guess entity names (form names, tag names, field names, email subjects, product names, automation names, or any other metadata).
- If a name is not explicitly provided in the resolved data above, write "unknown form", "unknown tag", "unknown field", "unknown email", etc. — do NOT substitute a plausible-sounding name.
- If the data says "Unknown form #123", write "an unknown form (ID 123)" — do NOT replace it with a guessed name like "Website Opt-in Form" or "Contact Form".
- Accuracy is more important than readability. A description with "unknown" placeholders is correct; a description with fabricated names is wrong.`;

export function collectChunkProfileKeys(chunk: Chunk): Array<{ type: string; id: string }> {
  const keys: Array<{ type: string; id: string }> = [];
  for (const nd of chunk.node_details) {
    const res = nd.resource || {};
    const nType = (nd.type || "").toLowerCase();

    if ((nType === "send_email" || nType === "email") && res.object_id) {
      keys.push({ type: "message.email", id: String(res.object_id) });
    }
    if (nType === "email_notify" && res.email_selector) {
      keys.push({ type: "message.email", id: String(res.email_selector) });
    }
    if (res.message_id) keys.push({ type: "message.email", id: String(res.message_id) });
    if (res.move_contacts_to) keys.push({ type: "automation", id: String(res.move_contacts_to) });
    if (res.add_to_campaign_id) keys.push({ type: "automation", id: String(res.add_to_campaign_id) });
    if (res.campaign_id) keys.push({ type: "automation", id: String(res.campaign_id) });
    if (res.form_id) keys.push({ type: "page.order_form", id: String(res.form_id) });
    if (res.landing_page_id) keys.push({ type: "page.landing", id: String(res.landing_page_id) });

    if (nType === "trigger" || nType === "goal") {
      keys.push({ type: nType, id: nd.id });
      const ruleEditor = res.rule_editor;
      const eventStmts = ruleEditor?.events?.statement;
      if (Array.isArray(eventStmts) && eventStmts.length > 1) {
        for (const stmt of eventStmts) {
          if (!stmt || typeof stmt !== "object") continue;
          for (const eventKey of Object.keys(stmt)) {
            keys.push({ type: nType, id: `${nd.id}:evt:${eventKey}` });
          }
        }
      }
    }

    if (nType === "condition") {
      keys.push({ type: "condition", id: nd.id });
    }
  }
  return keys;
}

export function buildProfileContext(chunk: Chunk, profiles: ProfileLookup, cache: EnrichmentCache): string | null {
  const keys = collectChunkProfileKeys(chunk);
  if (keys.length === 0) return null;

  const sections: string[] = [];
  const seen = new Set<string>();

  for (const { type, id } of keys) {
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profiles[key];
    if (!profile || profile.status !== "ready") continue;
    const p = profile.profile;

    if (type === "trigger" || type === "goal") {
      let triggerSection =
        `[${type.toUpperCase()}] "${profile.objectName}" (node ${profile.objectId}):\n` +
        `  Summary: ${p.summary}\n` +
        `  Purpose: ${p.purpose}\n` +
        `  Business Context: ${p.business_context}`;

      const childKeys = Object.keys(profiles).filter(k => {
        const cp = profiles[k];
        return cp && cp.status === "ready" &&
          cp.parentObjectType === type &&
          cp.parentObjectId === id;
      });
      for (const ck of childKeys) {
        const child = profiles[ck];
        if (!child || seen.has(ck)) continue;
        seen.add(ck);
        const cp = child.profile;
        triggerSection += `\n  [Referenced ${child.objectType}] "${child.objectName}" (ID ${child.objectId}):\n` +
          `    Summary: ${cp.summary}\n` +
          `    Purpose: ${cp.purpose}\n` +
          `    Business Context: ${cp.business_context}`;
      }

      sections.push(triggerSection);
    } else {
      sections.push(
        `[${profile.objectType}] "${profile.objectName}" (ID ${profile.objectId}):\n` +
        `  Summary: ${p.summary}\n` +
        `  Purpose: ${p.purpose}\n` +
        `  Audience: ${p.audience}\n` +
        `  Business Context: ${p.business_context}`
      );
    }
  }
  if (sections.length === 0) return null;
  return sections.join("\n\n");
}

export function buildRegistryContext(chunk: Chunk, cache: EnrichmentCache, precomputedNameMap?: Record<string, string>): string | null {
  const sections: string[] = [];
  const nameMap = precomputedNameMap || buildEnrichmentNameMap(cache);

  for (const nd of chunk.node_details) {
    const nType = (nd.type || "").toLowerCase();
    if (nType !== "trigger" && nType !== "goal" && nType !== "condition") continue;

    const ruleEditor = nd.resource?.rule_editor;
    if (!ruleEditor) continue;

    const eventStmts = ruleEditor.events?.statement;
    if (Array.isArray(eventStmts)) {
      for (const stmt of eventStmts) {
        if (!stmt || typeof stmt !== "object") continue;
        for (const [eventKey, config] of Object.entries(stmt)) {
          if (!config || typeof config !== "object" || Array.isArray(config)) continue;
          const resolved = resolveEventStatement(eventKey, config as Record<string, any>, nameMap);
          if (resolved) {
            sections.push(`  Event: ${resolved.resolvedDescription}`);
          }
        }
      }
    }

    const condStmts = ruleEditor.conditions?.statement;
    if (Array.isArray(condStmts)) {
      for (const stmt of condStmts) {
        if (!stmt || typeof stmt !== "object") continue;
        for (const [condKey, config] of Object.entries(stmt)) {
          if (!config || typeof config !== "object" || Array.isArray(config)) continue;
          const resolved = resolveConditionStatement(condKey, config as Record<string, any>, nameMap);
          if (resolved) {
            sections.push(`  Condition: ${resolved.resolvedDescription}`);
          }
        }
      }
    }
  }

  if (sections.length === 0) return null;
  return `RULE EDITOR RESOLUTION (from Ontraport event/condition registry):\n${sections.join("\n")}`;
}

export function buildChunkPrompt(chunk: Chunk, cache: EnrichmentCache, allChunks?: Chunk[]): string {
  const lines: string[] = [];

  lines.push(`Chunk ID: ${chunk.id}`);
  lines.push(`Entry Type: ${chunk.entry_type}`);
  lines.push(`Termination: ${chunk.termination_type}`);

  if (chunk.entry_type === "continuation") {
    lines.push(`CONTEXT: This is a continuation of the preceding segment in the same trigger path. The actions below follow directly from the previous chunk's actions. Do NOT introduce a new trigger or goal opening — simply continue describing the actions in sequence.`);
  }

  if (chunk.branch_label) {
    lines.push(`Branch Label: ${chunk.branch_label}`);
  }

  if (chunk.trigger_goal_semantics) {
    const tgs = chunk.trigger_goal_semantics;
    lines.push(`Trigger/Goal Settings: scope=${tgs.scope}, collision=${tgs.collision}`);
    if (tgs.is_convergence_point) lines.push(`  (convergence point)`);
    if (tgs.is_clone_point) lines.push(`  (clones contact on re-entry)`);
    if (tgs.events.length > 0) {
      lines.push(`  Events: ${JSON.stringify(tgs.events)}`);
    }
  }

  if (chunk.is_fork_parent) {
    if (chunk.fork_type === "wait_goal") {
      const waitNode = chunk.node_details.find(nd => nd.type === "wait");
      const waitRes = waitNode?.resource || {};
      const waitDesc = waitNode ? buildWaitDescription(waitRes, cache, null, true) : null;
      let goalName: string | null = null;
      if (allChunks) {
        const goalSubChunk = allChunks.find(c => c.parent_chunk_id === chunk.id && c.entry_type === "goal");
        if (goalSubChunk && goalSubChunk.node_details.length > 0) {
          goalName = goalSubChunk.node_details[0].label || null;
        }
      }
      const goalRef = goalName ? ` '${goalName}'` : "";
      lines.push(`Wait + Goal pattern: This wait step has an attached goal${goalRef}. Two paths:`);
      lines.push(`  - "goal_achieved": If the contact meets the goal${goalRef} condition, they are redirected to the goal path immediately (even before the wait expires).`);
      lines.push(`  - "proceed_if_not_achieved": If the wait duration expires WITHOUT the goal being met, the contact continues down this fallback path.`);
      if (waitDesc) {
        lines.push(`  Wait duration: ${waitDesc}`);
      }
    } else if (chunk.fork_type === "split") {
      lines.push(`Split Test (A/B test): contacts are randomly distributed across paths based on weights, then reconverge at the end`);
      if (chunk.split_test_weights) {
        const weightDesc = chunk.split_test_weights.map(w => `Path ${w.id}: ${w.weight}%`).join(", ");
        lines.push(`Split weights: ${weightDesc}`);
      }
    } else if (chunk.fork_type === "fork") {
      lines.push(`Fork: ALL contacts are sent down ALL paths concurrently`);
    } else {
      lines.push(`Condition: contacts go down one path based on whether the condition is true or false`);
    }
    lines.push(`Sub-chunks (branches): ${chunk.sub_chunks.join(", ")}`);

    if (chunk.entry_type === "goal" && chunk.fork_type === "wait_goal") {
      lines.push(`\nIMPORTANT: This chunk has TWO distinct concepts:`);
      lines.push(`  1. ENTRY: This branch is entered when the goal condition (above) is achieved — describe what triggered entry into this path.`);
      lines.push(`  2. ACTIONS: After the goal entry, the chunk performs actions (see nodes below) and then reaches a Wait + Goal fork.`);
      lines.push(`  Describe BOTH clearly: first explain the goal entry, then describe ALL intermediate actions, then explain the wait+goal fork at the end.`);
      lines.push(`  You MUST describe every node listed below — do not skip any.`);
    }
  }

  if (chunk.goto_target_node) {
    const targetDesc = allChunks
      ? findGotoTargetDescription(chunk.goto_target_node, allChunks, cache)
      : `node ${chunk.goto_target_node}`;
    if (targetDesc.startsWith("VERBATIM_GOTO:")) {
      const verbatimSentence = targetDesc.replace("VERBATIM_GOTO: ", "");
      lines.push(`GOTO REDIRECT (USE THIS SENTENCE VERBATIM — do not rephrase): "${verbatimSentence}"`);
    } else {
      lines.push(`GO TO target: ${targetDesc}`);
    }
  }
  if (chunk.cross_ref_campaign_id) {
    const automationName = cache.campaigns[chunk.cross_ref_campaign_id] || `Automation #${chunk.cross_ref_campaign_id}`;
    lines.push(`Cross-references automation: ${automationName}`);
  }

  const promptHasGoals = allChunks
    ? chunk.sub_chunks.some(scId => {
        const sc = allChunks.find(ch => ch.id === scId);
        return sc != null && sc.entry_type === "goal";
      })
    : undefined;

  const promptTerminationId = chunk.termination_node_id;

  lines.push("");
  lines.push("Nodes in order:");
  for (const nd of chunk.node_details) {
    const isTerminationNode = nd.id === promptTerminationId;
    const desc = resolveNodeDescription(nd, cache, isTerminationNode ? promptHasGoals : undefined);
    lines.push(`  - ${desc}`);
  }

  const totalDur = formatDuration(chunk.total_duration);
  if (totalDur !== "immediate") {
    lines.push(`\nTotal chunk duration: ${totalDur}`);
  }

  return lines.join("\n");
}
