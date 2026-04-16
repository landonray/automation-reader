const ONTRAPORT_BASE = "https://api.ontraport.com/1";

interface OntraportCredentials {
  appId: string;
  apiKey: string;
}

function headers(creds: OntraportCredentials): Record<string, string> {
  return {
    "Api-Appid": creds.appId,
    "Api-Key": creds.apiKey,
    "Content-Type": "application/json",
  };
}

export async function validateCredentials(creds: OntraportCredentials): Promise<boolean> {
  try {
    const response = await fetch(`${ONTRAPORT_BASE}/CampaignBuilderItems?range=1`, {
      headers: headers(creds),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface AutomationListItem {
  id: string;
  name: string;
  status: string;
  nodeCount: number;
}

export async function listAutomations(creds: OntraportCredentials): Promise<AutomationListItem[]> {
  const allItems: AutomationListItem[] = [];
  const PAGE_SIZE = 250;
  let start = 0;

  while (true) {
    const response = await fetch(
      `${ONTRAPORT_BASE}/CampaignBuilderItems?listFields=id,name,pause&sort=name&sortDir=asc&start=${start}&range=${PAGE_SIZE}`,
      { headers: headers(creds) },
    );
    if (!response.ok) throw new Error(`Ontraport API error: ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data.data) ? data.data : [];

    for (const item of items) {
      allItems.push({
        id: String(item.id),
        name: item.name || `Automation #${item.id}`,
        status: item.pause === "0" ? "published" : "paused",
        nodeCount: 0,
      });
    }

    if (items.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  return allItems;
}

export async function fetchAutomationJson(creds: OntraportCredentials, automationId: string): Promise<any> {
  const response = await fetch(
    `${ONTRAPORT_BASE}/CampaignBuilderItem?id=${automationId}`,
    { headers: headers(creds) },
  );
  if (!response.ok) throw new Error(`Ontraport API error: ${response.status}`);
  const data = await response.json();
  return data;
}

export function ontraportHeaders(creds: OntraportCredentials): { "Api-Appid": string; "Api-Key": string } {
  return { "Api-Appid": creds.appId, "Api-Key": creds.apiKey };
}
