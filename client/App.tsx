import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AccountHome } from "./pages/AccountHome";
import { SuiteDashboard } from "./pages/SuiteDashboard";
import { RunDashboard } from "./pages/RunDashboard";

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<AccountHome />} />
          <Route path="/suites/:suiteId" element={<SuiteDashboard />} />
          <Route path="/runs/:runId" element={<RunDashboard />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
