import React from "react";
import { Link } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-lg font-semibold text-gray-900">Reader Workbench</Link>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
