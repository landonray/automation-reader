import type { CampaignData, Chunk, Relationship, SemanticLayers, EnrichmentCache } from "./types.js";
import { enrichCampaign, type OntraportHeaders } from "./enrichment.js";
import { resolveGraph } from "./chunker.js";
import { narrateChunks, type LlmCallRecord, type NarrateResult } from "./narrator.js";
import { synthesize, type SynthesizeResult } from "./synthesizer.js";
import { validateReaderOutput, type ReaderValidationReport } from "./reader-validation.js";
import { runAllDetectors, type AuditFinding } from "./audit-detectors.js";
import { extractPublicationStatus } from "./structural-warnings.js";

export interface PipelineInput {
  automationJson: any;
  ontraportHeaders: OntraportHeaders;
}

export interface PipelineResult {
  chunks: Chunk[];
  relationships: Relationship[];
  layers: SemanticLayers;
  enrichmentCache: EnrichmentCache;
  validation: ReaderValidationReport;
  auditFindings: AuditFinding[];
  timing: {
    enrichment: number;
    chunking: number;
    narration: number;
    synthesis: number;
    total: number;
  };
  stats: {
    chunkCount: number;
    narratorLlmCalls: number;
    narratorDeterministicCalls: number;
    synthesizerLlmCalls: number;
  };
  llmCallRecords: LlmCallRecord[];
  isPublished: boolean;
}

function normalizeEdges(rawEdges: any[]): any[] {
  if (!Array.isArray(rawEdges)) return [];
  return rawEdges.map((e, i) => {
    const source = e.source ?? e.from;
    const target = e.target ?? e.to;
    return {
      ...e,
      id: e.id ?? `e_${source}_${target}_${i}`,
      source: source != null ? String(source) : source,
      target: target != null ? String(target) : target,
    };
  });
}

function normalizeNodes(rawNodes: any[]): any[] {
  if (!Array.isArray(rawNodes)) return [];
  return rawNodes.map((n) => ({
    ...n,
    id: n.id != null ? String(n.id) : n.id,
  }));
}

function parseCampaignData(rawData: any): { campaignData: CampaignData; rawForPublicationStatus: any } {
  // Shape 1: Ontraport API response format — rawData.data contains automation objects with a campaign field
  if (rawData.data) {
    const inner = rawData.data;
    const automationObj = Array.isArray(inner) && inner.length > 0 ? inner[0] : inner;

    let campaign: any = null;
    if (automationObj.campaign) {
      try {
        campaign = typeof automationObj.campaign === "string"
          ? JSON.parse(automationObj.campaign)
          : automationObj.campaign;
      } catch {
        campaign = null;
      }
    }

    const nodes =
      automationObj.nodes ||
      campaign?.nodes ||
      campaign?.elements?.nodes ||
      [];
    const edges =
      automationObj.edges ||
      campaign?.edges ||
      campaign?.elements?.edges ||
      [];

    return {
      campaignData: {
        nodes: normalizeNodes(nodes),
        edges: normalizeEdges(edges),
        rawAutomationData: rawData,
      },
      rawForPublicationStatus: rawData,
    };
  }

  // Shape 2: simple format with nodes and edges directly
  if (rawData.nodes && rawData.edges) {
    return {
      campaignData: {
        nodes: normalizeNodes(rawData.nodes),
        edges: normalizeEdges(rawData.edges),
        rawAutomationData: rawData,
      },
      rawForPublicationStatus: rawData,
    };
  }

  // Fallback: treat as empty campaign
  return {
    campaignData: {
      nodes: [],
      edges: [],
      rawAutomationData: rawData,
    },
    rawForPublicationStatus: rawData,
  };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const pipelineStart = Date.now();

  // 1. Parse automation JSON into CampaignData
  const { campaignData, rawForPublicationStatus } = parseCampaignData(input.automationJson);

  // 2. Extract publication status and merge into campaignData
  const publicationStatus = extractPublicationStatus(rawForPublicationStatus);
  campaignData.isPublished = publicationStatus.isPublished;
  campaignData.unconfiguredNodeIds = publicationStatus.unconfiguredNodeIds;
  const isPublished = publicationStatus.isPublished;

  // 3. Enrichment
  const enrichmentStart = Date.now();
  const enrichmentCache = await enrichCampaign(campaignData, input.ontraportHeaders);
  const enrichment_ms = Date.now() - enrichmentStart;

  // 4. Chunking
  const chunkingStart = Date.now();
  const { chunks: rawChunks, relationships } = resolveGraph(campaignData, enrichmentCache);
  const chunking_ms = Date.now() - chunkingStart;

  // 5. Narration
  const narrationStart = Date.now();
  const narrateResult: NarrateResult = await narrateChunks(
    rawChunks,
    enrichmentCache,
    undefined,
    undefined,
    isPublished,
  );
  const narration_ms = Date.now() - narrationStart;
  const narratedChunks = narrateResult.chunks;

  // 6. Synthesis
  const synthesisStart = Date.now();
  const synthesizeResult: SynthesizeResult = await synthesize(
    narratedChunks,
    relationships,
    enrichmentCache,
    isPublished,
  );
  const synthesis_ms = Date.now() - synthesisStart;

  // 7. Validation
  const validation = validateReaderOutput(synthesizeResult.layers, narratedChunks);

  // 8. Audit
  const auditFindings = runAllDetectors(narratedChunks, relationships, { isPublished });

  const total_ms = Date.now() - pipelineStart;

  // Combine LLM call records from narrator and synthesizer
  const llmCallRecords: LlmCallRecord[] = [
    ...narrateResult.llmCallRecords,
    ...synthesizeResult.llmCallRecords,
  ];

  return {
    chunks: narratedChunks,
    relationships,
    layers: synthesizeResult.layers,
    enrichmentCache,
    validation,
    auditFindings,
    timing: {
      enrichment: enrichment_ms,
      chunking: chunking_ms,
      narration: narration_ms,
      synthesis: synthesis_ms,
      total: total_ms,
    },
    stats: {
      chunkCount: narratedChunks.length,
      narratorLlmCalls: narrateResult.stats.llmCalls,
      narratorDeterministicCalls: narrateResult.stats.deterministicCalls,
      synthesizerLlmCalls: synthesizeResult.llmCalls,
    },
    llmCallRecords,
    isPublished,
  };
}
