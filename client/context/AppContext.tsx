import React, { createContext, useContext, useState, useEffect } from "react";
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

interface AppContextType {
  accounts: Account[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  currentSuite: Suite | null;
  setCurrentSuite: (suite: Suite | null) => void;
  refreshAccounts: () => Promise<void>;
  addAccount: (account: Account) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentSuite, setCurrentSuite] = useState<Suite | null>(null);

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

  useEffect(() => {
    refreshAccounts();
  }, []);

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
