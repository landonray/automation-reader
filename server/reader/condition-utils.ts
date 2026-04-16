export const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  "e": "equals",
  "n": "not equal to",
  "g": "greater than",
  "l": "less than",
  "gt": "greater than",
  "lt": "less than",
  "ge": "greater than or equal to",
  "le": "less than or equal to",
  "h": "on or after",
  "b": "before",
  "m": "less than or equal to",
  "c": "contains",
  "nc": "does not contain",
  "k": "does not contain",
  "sw": "starts with",
  "s": "starts with",
  "ew": "ends with",
  "z": "ends with",
  "f": "is filled",
  "nf": "is not filled",
};

export function decodeOntraportDateCode(value: string): string | null {
  const match = value.match(/^S(\d+)(DAYS|HOURS|WEEKS|MONTHS|YEARS|MINUTES)$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitLabel = unit === "days" ? "day" : unit === "hours" ? "hour" : unit === "weeks" ? "week" : unit === "months" ? "month" : unit === "years" ? "year" : unit === "minutes" ? "minute" : unit;
  return `${num} ${unitLabel}${num !== 1 ? "s" : ""} ago`;
}

export function isImplicitForever(res: Record<string, any>): boolean {
  const waitType = res.wait_type || "";
  if (waitType) return false;
  const days = parseInt(res.time_days || "0", 10) || 0;
  const hours = parseInt(res.time_hours || "0", 10) || 0;
  const minutes = parseInt(res.time_minutes || "0", 10) || 0;
  return days === 0 && hours === 0 && minutes === 0;
}
