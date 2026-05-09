export type AssetType = "fund" | "stock" | "crypto" | "cash" | "liability";
export type TradeKind = "asset" | "buy" | "sell" | "deposit" | "withdraw" | "balance";

export interface User {
  id: number;
  username: string;
  canEdit?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  platform: string;
  type: AssetType;
  symbol: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
  previousClose: number;
  currency: string;
  fxRate: number;
  quoteSource: string;
  quoteDate: string;
  quoteFetchedAt: string;
  notes: string;
  updatedAt: string;
}

export interface AccountBalance {
  platform: string;
  freeCash: number;
  displayCurrency: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  kind: TradeKind;
  platform: string;
  assetName: string;
  assetType: AssetType | "";
  symbol: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
  previousClose: number;
  price: number;
  fee: number;
  cashAmount: number;
  currency: string;
  fxRate: number;
  quoteSource: string;
  quoteDate: string;
  realizedProfit: number;
  notes: string;
  occurredAt: string;
  createdAt: string;
}

export interface TradePlan {
  id: string;
  kind: "asset" | "buy" | "sell";
  platform: string;
  assetName: string;
  assetType: AssetType;
  symbol: string;
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  fxRate: number;
  quoteSource: string;
  quoteDate: string;
  notes: string;
  plannedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioState {
  assets: Asset[];
  accountBalances: AccountBalance[];
  transactions: Transaction[];
  tradePlans: TradePlan[];
}
