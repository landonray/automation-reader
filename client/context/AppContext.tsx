import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api";

interface Account {
  id: string;
  name: string;
  appId: string;
  createdAt: string;
}

interface Suite {
  id: string;
  accountId: string;
  name: string;
  createdAt: string;
}

interface AutomationItem {
  id: string;
  name: string;
  status: string;
  nodeCount: number;
}

interface AppContextType {
  accounts: Account[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  currentSuite: Suite | null;
  setCurrentSuite: (suite: Suite | null) => void;
  refreshAccounts: () => Promise<void>;
  addAccount: (account: Account) => void;
  automations: AutomationItem[];
  automationsLoading: boolean;
  refreshAutomations: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentSuite, setCurrentSuite] = useState<Suite | null>(null);
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);

  const refreshAccounts = async () => {
    const data = await api.accounts.list();
    setAccounts(data);
    if (data.length > 0 && !selectedAccountId) {
      setSelectedAccountId(data[0].id);
    }
  };

  const addAccount = (account: Account) => {
    setAccounts(prev => [...prev, account]);
    setSelectedAccountId(account.id);
  };

  const refreshAutomations = useCallback(async () => {
    if (!selectedAccountId) return;
    setAutomationsLoading(true);
    try {
      const data = await api.accounts.automations(selectedAccountId);
      setAutomations(data);
    } catch {
      setAutomations([]);
    }
    setAutomationsLoading(false);
  }, [selectedAccountId]);

  useEffect(() => {
    refreshAccounts();
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      refreshAutomations();
    } else {
      setAutomations([]);
    }
  }, [selectedAccountId]);

  return (
    <AppContext.Provider
      value={{
        accounts,
        selectedAccountId,
        setSelectedAccountId,
        currentSuite,
        setCurrentSuite,
        refreshAccounts,
        addAccount,
        automations,
        automationsLoading,
        refreshAutomations,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
