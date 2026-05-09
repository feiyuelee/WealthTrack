import type { Asset, AssetType, TradePlan } from "./types";

const BEIJING_TIME_ZONE = "Asia/Shanghai";
const NEW_YORK_TIME_ZONE = "America/New_York";

export const platformLabels: Record<string, string> = {
  alipay: "支付宝",
  southfund: "南方基金",
  tonghuashun: "同花顺",
  okx: "欧意 OKX",
  ibkr: "IBKR",
  schwab: "嘉信理财",
  bank: "现金 / 银行",
  other: "其他"
};

export const typeLabels: Record<AssetType, string> = {
  fund: "基金",
  stock: "股票 / ETF",
  crypto: "加密货币",
  cash: "现金",
  liability: "负债"
};

export function formatCurrency(value: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function getCurrentValue(asset: Asset) {
  const sign = asset.type === "liability" ? -1 : 1;
  return sign * (Number(asset.quantity) || 0) * (Number(asset.currentPrice) || 0) * (Number(asset.fxRate) || 1);
}

export function getCostValue(asset: Asset) {
  const sign = asset.type === "liability" ? -1 : 1;
  return sign * (Number(asset.quantity) || 0) * (Number(asset.costPrice) || 0) * (Number(asset.fxRate) || 1);
}

export function getDailyProfit(asset: Asset) {
  if (asset.type === "cash" || asset.type === "liability") return 0;
  if (!shouldCountAssetForDailyProfit(asset)) return 0;
  return getQuoteProfitValue(asset);
}

export function getQuoteProfitValue(asset: Asset) {
  if (asset.type === "cash" || asset.type === "liability") return 0;
  if (!asset.previousClose || !asset.currentPrice) return 0;
  return (asset.currentPrice - asset.previousClose) * asset.quantity * asset.fxRate;
}

export function getTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function getPlanLabel(plan: TradePlan) {
  if (plan.kind === "asset") return "计划建仓";
  if (plan.kind === "buy") return "计划加仓";
  return plan.notes === "close" ? "计划清仓" : "计划减仓";
}

export function getPlanTone(plan: TradePlan) {
  if (plan.kind === "buy" || plan.kind === "asset") return "positive";
  return "negative";
}

export function createClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface PlatformProfitRow {
  platform: string;
  displayDailyProfit: number;
  displayDailyRate: number;
  freshnessLabel: string;
  dateText: string;
  isDisplayStale: boolean;
}

export interface AssetProfitRow {
  id: string;
  name: string;
  symbol: string;
  platform: string;
  dailyProfit: number;
  dailyRate: number;
  freshnessLabel: string;
  dateText: string;
  isDisplayStale: boolean;
}

export function buildPlatformProfitRows(assets: Asset[]): PlatformProfitRow[] {
  const groups = new Map<string, {
    platform: string;
    dailyProfit: number;
    costValue: number;
    displayDailyProfit: number;
    displayCostValue: number;
    latestQuoteDate: string;
    hasTodayData: boolean;
    hasCurrentData: boolean;
    hasNonTodayData: boolean;
  }>();

  for (const asset of assets) {
    const platform = asset.platform || "other";
    const group = groups.get(platform) || {
      platform,
      dailyProfit: 0,
      costValue: 0,
      displayDailyProfit: 0,
      displayCostValue: 0,
      latestQuoteDate: "",
      hasTodayData: false,
      hasCurrentData: false,
      hasNonTodayData: false
    };

    const quoteDate = getEffectiveQuoteDate(asset);
    if (quoteDate) {
      if (!group.latestQuoteDate || quoteDate > group.latestQuoteDate) {
        group.latestQuoteDate = quoteDate;
      }
      if (quoteDate === getTodayDateString()) {
        group.hasTodayData = true;
      }
      if (isAssetQuoteCurrent(asset)) {
        group.hasCurrentData = true;
      } else {
        group.hasNonTodayData = true;
      }
    } else {
      group.hasNonTodayData = true;
    }

    group.displayDailyProfit += getQuoteProfitValue(asset);
    group.displayCostValue += Math.max(0, getCostValue(asset));
    if (shouldCountAssetForDailyProfit(asset)) {
      group.dailyProfit += getDailyProfit(asset);
      group.costValue += Math.max(0, getCostValue(asset));
    }
    groups.set(platform, group);
  }

  return Array.from(groups.values())
    .map((row) => {
      const isStaleOnly = !row.hasCurrentData;
      const isUsPlatform = isUsEquityPlatform(row.platform);
      const usSession = isUsPlatform ? getUsMarketSessionInfo() : null;
      const shouldForceZero = Boolean(usSession?.zeroProfit);
      const displayDailyProfit = shouldForceZero || isStaleOnly ? row.displayDailyProfit : row.dailyProfit;
      const displayCostValue = shouldForceZero || isStaleOnly ? row.displayCostValue : row.costValue;
      const freshnessLabel = isUsPlatform
        ? usSession?.label || "最新"
        : row.hasTodayData
          ? row.hasNonTodayData ? "部分更新" : "今日"
          : row.hasCurrentData ? "最新" : "昨日";

      return {
        platform: row.platform,
        displayDailyProfit,
        displayDailyRate: displayCostValue > 0 ? (displayDailyProfit / displayCostValue) * 100 : 0,
        freshnessLabel,
        dateText: row.latestQuoteDate || "未知日期",
        isDisplayStale: isStaleOnly || shouldForceZero
      };
    })
    .filter((row) => row.dateText !== "未知日期" || Math.abs(row.displayDailyProfit) > 0)
    .sort((left, right) => Math.abs(right.displayDailyProfit) - Math.abs(left.displayDailyProfit));
}

export function buildAssetProfitRows(assets: Asset[]): AssetProfitRow[] {
  return assets
    .filter((asset) => asset.type !== "cash" && asset.type !== "liability")
    .map((asset) => {
      const quoteDate = getEffectiveQuoteDate(asset);
      const isCurrent = isAssetQuoteCurrent(asset);
      const isUsPlatform = isUsEquityPlatform(asset.platform);
      const usSession = isUsPlatform ? getUsMarketSessionInfo() : null;
      const shouldForceZero = Boolean(usSession?.zeroProfit);
      const isDisplayStale = !isCurrent || shouldForceZero;
      const rawProfit = getQuoteProfitValue(asset);
      const dailyProfit = shouldCountAssetForDailyProfit(asset) ? getDailyProfit(asset) : rawProfit;
      const costValue = Math.max(0, getCostValue(asset));
      const freshnessLabel = isUsPlatform
        ? usSession?.label || "最新"
        : quoteDate === getTodayDateString()
          ? "今日"
          : isCurrent ? "最新" : "昨日";

      return {
        id: asset.id,
        name: asset.name,
        symbol: asset.symbol,
        platform: asset.platform,
        dailyProfit,
        dailyRate: costValue > 0 ? (dailyProfit / costValue) * 100 : 0,
        freshnessLabel,
        dateText: quoteDate || "未知日期",
        isDisplayStale
      };
    })
    .filter((row) => row.dateText !== "未知日期" || Math.abs(row.dailyProfit) > 0)
    .sort((left, right) => Math.abs(right.dailyProfit) - Math.abs(left.dailyProfit))
    .slice(0, 10);
}

function shouldCountAssetForDailyProfit(asset: Asset) {
  if (!isAssetQuoteCurrent(asset)) return false;
  if (!isUsEquityPlatform(asset.platform)) return true;
  const session = getUsMarketSessionInfo();
  return session.label === "盘中" || session.label === "盘后";
}

function isUsEquityPlatform(platform: string) {
  return ["ibkr", "schwab"].includes(String(platform || "").toLowerCase());
}

function getUsMarketSessionInfo(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(value);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const totalMinutes = hour * 60 + minute;
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if (isWeekend) return { label: "休市", zeroProfit: true };
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) return { label: "盘前", zeroProfit: true };
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) return { label: "盘中", zeroProfit: false };
  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) return { label: "盘后", zeroProfit: false };
  return { label: "夜盘", zeroProfit: true };
}

function getTodayDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function normalizeQuoteDate(value: string) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addDaysToDateString(dateText: string, days: number) {
  const normalized = normalizeQuoteDate(dateText);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getBeijingDateString(value: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function getEffectiveQuoteDate(asset: Asset) {
  const normalized = normalizeQuoteDate(asset.quoteDate);
  if (!normalized) return "";
  const platform = String(asset.platform || "").toLowerCase();
  const quoteSource = String(asset.quoteSource || "").toLowerCase();
  if (!["ibkr", "schwab"].includes(platform) || quoteSource !== "finnhub") {
    return normalized;
  }
  const updatedDate = getBeijingDateString(asset.updatedAt);
  if (updatedDate && addDaysToDateString(normalized, 1) === updatedDate) {
    return updatedDate;
  }
  return normalized;
}

function getAssetQuoteLagToleranceDays(asset: Asset) {
  return asset.type === "fund" ? 1 : 0;
}

function isAssetQuoteCurrent(asset: Asset) {
  const quoteDate = getEffectiveQuoteDate(asset);
  if (!quoteDate) return false;
  const earliestValidDate = addDaysToDateString(getTodayDateString(), -getAssetQuoteLagToleranceDays(asset));
  return Boolean(earliestValidDate) && quoteDate >= earliestValidDate;
}
