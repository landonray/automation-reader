import React from "react";
import { Link } from "react-router-dom";

interface Props {
  suite: {
    id: string;
    name: string;
    createdAt: string;
    automationCount?: number;
    lastRunDate?: string | null;
    lastRunStatus?: string | null;
  };
}

const statusIndicator: Record<string, { color: string; label: string }> = {
  completed: { color: "bg-green-500", label: "Passed" },
  running: { color: "bg-yellow-500", label: "Running" },
  failed: { color: "bg-red-500", label: "Failed" },
};

export function SuiteCard({ suite }: Props) {
  const indicator = suite.lastRunStatus ? statusIndicator[suite.lastRunStatus] : null;

  return (
    <Link
      to={`/suites/${suite.id}`}
      className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-gray-900">{suite.name}</div>
        {indicator && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${indicator.color}`} />
            {indicator.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
        <span>{suite.automationCount ?? 0} automations</span>
        {suite.lastRunDate && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span>Last run {new Date(suite.lastRunDate).toLocaleDateString()}</span>
          </>
        )}
      </div>
    </Link>
  );
}
