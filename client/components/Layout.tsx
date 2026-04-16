import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppContext } from "../context/AppContext";

export function Layout({ children }: { children: React.ReactNode }) {
  const { accounts, selectedAccountId, setSelectedAccountId, currentSuite } = useAppContext();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isPromptsPage = location.pathname.startsWith("/prompts");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-lg font-semibold text-gray-900 shrink-0">
          Reader Workbench
        </Link>

        {accounts.length > 0 && !isPromptsPage && (
          <>
            <span className="text-gray-300">|</span>
            <select
              value={selectedAccountId || ""}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </>
        )}

        {currentSuite && !isHome && !isPromptsPage && (
          <>
            <span className="text-gray-300">/</span>
            <Link
              to={`/suites/${currentSuite.id}`}
              className="text-sm text-gray-600 hover:text-blue-600 truncate max-w-[200px]"
            >
              {currentSuite.name}
            </Link>
          </>
        )}

        <div className="ml-auto">
          <Link
            to="/prompts"
            className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
              isPromptsPage
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:text-blue-700 hover:bg-gray-100"
            }`}
          >
            Prompts
          </Link>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
