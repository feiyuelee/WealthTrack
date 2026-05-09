import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { api } from "./api";
import type { Asset, PortfolioState, TradePlan, Transaction, User } from "./types";
import {
  buildAssetProfitRows,
  buildPlatformProfitRows,
  createClientId,
  formatCurrency,
  formatDateTime,
  formatNumber,
  getCostValue,
  getCurrentValue,
  getDailyProfit,
  getPlanLabel,
  getPlanTone,
  getTone,
  platformLabels,
  typeLabels
} from "./utils";

const emptyPortfolio: PortfolioState = {
  assets: [],
  accountBalances: [],
  transactions: [],
  tradePlans: []
};

type ViewKey = "overview" | "positions" | "plans" | "records";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [portfolio, setPortfolio] = useState(emptyPortfolio);
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [query, setQuery] = useState("");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadSession() {
    try {
      const response = await api.me();
      setUser(response.user);
      await loadPortfolio();
    } catch {
      setPortfolio(emptyPortfolio);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPortfolio() {
    const [assets, accountBalances, transactions, tradePlans] = await Promise.all([
      api.assets(),
      api.accountBalances(),
      api.transactions(),
      api.tradePlans()
    ]);
    setPortfolio({
      assets: assets.assets || [],
      accountBalances: accountBalances.accountBalances || [],
      transactions: transactions.transactions || [],
      tradePlans: tradePlans.tradePlans || []
    });
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await api.login(loginName, password);
      setUser(response.user);
      setPassword("");
      await loadPortfolio();
      setMessage("登录成功");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    }
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setPortfolio(emptyPortfolio);
  }

  async function refresh() {
    setIsRefreshing(true);
    try {
      await loadPortfolio();
      setMessage("数据已刷新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  }

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return portfolio.assets;
    return portfolio.assets.filter((asset) =>
      [asset.name, asset.symbol, platformLabels[asset.platform], typeLabels[asset.type]]
        .filter(Boolean)
        .some((item) => item.toLowerCase().includes(needle))
    );
  }, [portfolio.assets, query]);

  const totals = useMemo(() => {
    const positionValue = portfolio.assets.reduce((sum, asset) => sum + getCurrentValue(asset), 0);
    const costValue = portfolio.assets.reduce((sum, asset) => sum + getCostValue(asset), 0);
    const dailyProfit = portfolio.assets.reduce((sum, asset) => sum + getDailyProfit(asset), 0);
    const cashValue = portfolio.accountBalances.reduce((sum, item) => sum + (item.freeCash || 0), 0);
    return {
      totalAssets: positionValue + cashValue,
      positionValue,
      profit: positionValue - costValue,
      dailyProfit,
      cashValue
    };
  }, [portfolio]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <strong>WealthTrack</strong>
            <span>Portfolio command center</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          <NavButton icon={<LayoutDashboard size={18} />} label="总览" active={activeView === "overview"} onClick={() => setActiveView("overview")} />
          <NavButton icon={<WalletCards size={18} />} label="持仓" active={activeView === "positions"} onClick={() => setActiveView("positions")} />
          <NavButton icon={<CalendarClock size={18} />} label="交易计划" active={activeView === "plans"} onClick={() => setActiveView("plans")} />
          <NavButton icon={<BarChart3 size={18} />} label="操作记录" active={activeView === "records"} onClick={() => setActiveView("records")} />
        </nav>

        <div className="sidebar-card">
          <ShieldCheck size={18} />
          <span>{user ? `${user.username} 已登录` : "连接旧版 API"}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p>前端重构预览</p>
            <h1>{viewTitles[activeView]}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、代码或平台" />
            </label>
            <button className="icon-button" type="button" onClick={refresh} disabled={!user || isRefreshing} title="刷新">
              <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
            </button>
            {user ? (
              <button className="secondary-button" type="button" onClick={handleLogout}>
                <LogOut size={16} />
                退出
              </button>
            ) : null}
          </div>
        </header>

        {!user ? (
          <LoginPanel
            isLoading={isLoading}
            loginName={loginName}
            password={password}
            message={message}
            onNameChange={setLoginName}
            onPasswordChange={setPassword}
            onSubmit={handleLogin}
          />
        ) : (
          <>
            {message ? <div className="message">{message}</div> : null}
            {activeView === "overview" ? <Overview totals={totals} assets={filteredAssets} plans={portfolio.tradePlans} /> : null}
            {activeView === "positions" ? <Positions assets={filteredAssets} /> : null}
            {activeView === "plans" ? <Plans plans={portfolio.tradePlans} assets={portfolio.assets} onChanged={loadPortfolio} /> : null}
            {activeView === "records" ? <Records transactions={portfolio.transactions} /> : null}
          </>
        )}
      </main>
    </div>
  );
}

const viewTitles: Record<ViewKey, string> = {
  overview: "资产总览",
  positions: "持仓工作台",
  plans: "交易计划",
  records: "操作记录"
};

function NavButton(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-button ${props.active ? "is-active" : ""}`} type="button" onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function LoginPanel(props: {
  isLoading: boolean;
  loginName: string;
  password: string;
  message: string;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section className="login-panel">
      <div>
        <p>需要登录</p>
        <h2>{props.isLoading ? "正在连接当前账户" : "登录后查看真实资产数据"}</h2>
      </div>
      <form className="login-form" onSubmit={props.onSubmit}>
        <input value={props.loginName} onChange={(event) => props.onNameChange(event.target.value)} placeholder="用户名" autoComplete="username" />
        <input value={props.password} onChange={(event) => props.onPasswordChange(event.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
        <button className="primary-button" type="submit">登录</button>
      </form>
      {props.message ? <span className="form-note">{props.message}</span> : null}
    </section>
  );
}

function Overview(props: { totals: { totalAssets: number; positionValue: number; profit: number; dailyProfit: number; cashValue: number }; assets: Asset[]; plans: TradePlan[] }) {
  const platformProfitRows = buildPlatformProfitRows(props.assets);
  const assetProfitRows = buildAssetProfitRows(props.assets);
  return (
    <div className="overview-grid">
      <section className="metric-strip">
        <Metric label="净资产" value={formatCurrency(props.totals.totalAssets)} tone={getTone(props.totals.totalAssets)} icon={<CircleDollarSign size={20} />} />
        <Metric label="持仓市值" value={formatCurrency(props.totals.positionValue)} tone="neutral" icon={<WalletCards size={20} />} />
        <Metric label="累计收益" value={formatCurrency(props.totals.profit)} tone={getTone(props.totals.profit)} icon={<ArrowUpRight size={20} />} />
        <Metric label="今日收益" value={formatCurrency(props.totals.dailyProfit)} tone={getTone(props.totals.dailyProfit)} icon={<BarChart3 size={20} />} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>当日平台盈亏</h2>
          <span>{platformProfitRows.length} 个平台</span>
        </div>
        <div className="platform-profit-list">
          {platformProfitRows.slice(0, 6).map((row, index) => (
            <article className="platform-profit-card" key={row.platform}>
              <span className="platform-rank">{index + 1}</span>
              <div>
                <strong>{platformLabels[row.platform] || row.platform}</strong>
                <span>{row.freshnessLabel} · {row.dateText}</span>
              </div>
              <div className={row.isDisplayStale ? "platform-profit-value is-stale" : "platform-profit-value"}>
                <strong className={row.isDisplayStale ? "neutral" : getTone(row.displayDailyProfit)}>{formatCurrency(row.displayDailyProfit)}</strong>
                <span>{row.displayDailyRate >= 0 ? "+" : ""}{row.displayDailyRate.toFixed(2)}%</span>
              </div>
            </article>
          ))}
          {!platformProfitRows.length ? <EmptyState text="暂无平台盈亏数据" /> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>当日个股盈亏</h2>
          <span>前 {assetProfitRows.length} 项</span>
        </div>
        <div className="asset-profit-list">
          {assetProfitRows.map((row, index) => (
            <article className="asset-profit-card" key={row.id}>
              <span className="platform-rank">{index + 1}</span>
              <div>
                <strong>{row.name}</strong>
                <span>{row.symbol} · {platformLabels[row.platform] || row.platform} · {row.freshnessLabel} · {row.dateText}</span>
              </div>
              <div className={row.isDisplayStale ? "platform-profit-value is-stale" : "platform-profit-value"}>
                <strong className={row.isDisplayStale ? "neutral" : getTone(row.dailyProfit)}>{formatCurrency(row.dailyProfit)}</strong>
                <span>{row.dailyRate >= 0 ? "+" : ""}{row.dailyRate.toFixed(2)}%</span>
              </div>
            </article>
          ))}
          {!assetProfitRows.length ? <EmptyState text="暂无个股盈亏数据" /> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>待执行计划</h2>
          <span>{props.plans.length} 条</span>
        </div>
        <div className="plan-stack">
          {props.plans.slice(0, 4).map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
          {!props.plans.length ? <EmptyState text="还没有交易计划" /> : null}
        </div>
      </section>
    </div>
  );
}

function Metric(props: { label: string; value: string; tone: string; icon: React.ReactNode }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{props.icon}</div>
      <span>{props.label}</span>
      <strong className={props.tone}>{props.value}</strong>
    </article>
  );
}

function Positions({ assets }: { assets: Asset[] }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>持仓列表</h2>
        <span>{assets.length} 条</span>
      </div>
      <div className="asset-table">
        {assets.map((asset) => (
          <AssetRow key={asset.id} asset={asset} />
        ))}
        {!assets.length ? <EmptyState text="当前筛选下没有资产" /> : null}
      </div>
    </section>
  );
}

function Plans({ plans, assets, onChanged }: { plans: TradePlan[]; assets: Asset[]; onChanged: () => Promise<void> }) {
  return (
    <div className="plans-layout">
      <PlanComposer assets={assets} onChanged={onChanged} />
      <section className="panel">
        <div className="panel-title">
          <h2>计划队列</h2>
          <span>{plans.length} 条</span>
        </div>
        <div className="plan-stack">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onDelete={onChanged} />
          ))}
          {!plans.length ? <EmptyState text="还没有计划，先在左侧创建一个" /> : null}
        </div>
      </section>
    </div>
  );
}

function PlanComposer({ assets, onChanged }: { assets: Asset[]; onChanged: () => Promise<void> }) {
  const [assetId, setAssetId] = useState("");
  const [kind, setKind] = useState<"buy" | "sell">("sell");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const selected = assets.find((asset) => asset.id === assetId) || assets.find((asset) => !["cash", "liability"].includes(asset.type));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const payload: TradePlan = {
      id: createClientId(),
      kind,
      platform: selected.platform,
      assetName: selected.name,
      assetType: selected.type,
      symbol: selected.symbol,
      quantity: Number(quantity),
      price: Number(price) || 0,
      fee: 0,
      currency: selected.currency,
      fxRate: selected.fxRate,
      quoteSource: selected.quoteSource,
      quoteDate: selected.quoteDate,
      notes: note,
      plannedAt: new Date().toISOString(),
      createdAt: "",
      updatedAt: ""
    };
    await api.saveTradePlan(payload);
    setQuantity("");
    setPrice("");
    setNote("");
    await onChanged();
  }

  return (
    <section className="panel composer">
      <div className="panel-title">
        <h2>快速计划</h2>
        <span>不影响统计</span>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>资产</span>
          <select value={assetId || selected?.id || ""} onChange={(event) => setAssetId(event.target.value)}>
            {assets.filter((asset) => !["cash", "liability"].includes(asset.type)).map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name} · {asset.symbol}</option>
            ))}
          </select>
        </label>
        <div className="segmented">
          <button type="button" className={kind === "buy" ? "is-active" : ""} onClick={() => setKind("buy")}>
            <Plus size={16} /> 加仓
          </button>
          <button type="button" className={kind === "sell" ? "is-active" : ""} onClick={() => setKind("sell")}>
            <ArrowDownRight size={16} /> 减仓
          </button>
        </div>
        <label>
          <span>数量</span>
          <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0" step="0.000001" required />
        </label>
        <label>
          <span>计划价</span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="0.000001" />
        </label>
        <label>
          <span>备注</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="触发条件、目标价或理由" />
        </label>
        <button className="primary-button" type="submit">保存计划</button>
      </form>
    </section>
  );
}

function Records({ transactions }: { transactions: Transaction[] }) {
  const records = transactions.filter((item) => item.kind !== "balance").slice(0, 80);
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>操作记录</h2>
        <span>{records.length} 条</span>
      </div>
      <div className="record-list">
        {records.map((record) => (
          <article className="record-item" key={record.id}>
            <div className={`record-icon ${record.kind === "sell" || record.kind === "withdraw" ? "negative-bg" : "positive-bg"}`}>
              {record.kind === "sell" || record.kind === "withdraw" ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
            </div>
            <div>
              <strong>{recordTitle(record)}</strong>
              <span>{platformLabels[record.platform] || record.platform} · {formatDateTime(record.occurredAt)}</span>
            </div>
            <strong className={getTone(record.cashAmount * record.fxRate)}>{formatCurrency(record.cashAmount * record.fxRate)}</strong>
          </article>
        ))}
        {!records.length ? <EmptyState text="还没有操作记录" /> : null}
      </div>
    </section>
  );
}

function AssetRow({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const value = getCurrentValue(asset);
  const profit = value - getCostValue(asset);
  return (
    <article className={`asset-row ${compact ? "is-compact" : ""}`}>
      <div>
        <strong>{asset.name}</strong>
        <span>{platformLabels[asset.platform] || asset.platform} · {typeLabels[asset.type]} · {asset.symbol}</span>
      </div>
      <div>
        <span>数量</span>
        <strong>{formatNumber(asset.quantity, asset.type === "stock" ? 0 : 6)}</strong>
      </div>
      <div>
        <span>市值</span>
        <strong>{formatCurrency(value)}</strong>
      </div>
      <div>
        <span>收益</span>
        <strong className={getTone(profit)}>{formatCurrency(profit)}</strong>
      </div>
    </article>
  );
}

function PlanCard({ plan, onDelete }: { plan: TradePlan; onDelete?: () => Promise<void> }) {
  async function remove() {
    if (!onDelete) return;
    await api.deleteTradePlan(plan.id);
    await onDelete();
  }

  return (
    <article className="plan-card">
      <div className={`plan-badge ${getPlanTone(plan)}`}>{getPlanLabel(plan)}</div>
      <div>
        <strong>{plan.assetName || plan.symbol}</strong>
        <span>{platformLabels[plan.platform] || plan.platform} · {plan.symbol} · {formatDateTime(plan.plannedAt)}</span>
      </div>
      <div className="plan-values">
        <strong>{formatNumber(plan.quantity, plan.assetType === "stock" ? 0 : 6)}</strong>
        <span>{plan.price ? `计划价 ${formatNumber(plan.price, 4)}` : "待填成交价"}</span>
      </div>
      {onDelete ? <button className="text-button" type="button" onClick={remove}>删除</button> : null}
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function recordTitle(record: Transaction) {
  if (record.kind === "asset") return `建仓 ${record.assetName || record.symbol}`;
  if (record.kind === "buy") return `加仓 ${record.assetName || record.symbol}`;
  if (record.kind === "sell") return `${record.notes === "close" ? "清仓" : "减仓"} ${record.assetName || record.symbol}`;
  if (record.kind === "deposit") return "平台入金";
  if (record.kind === "withdraw") return "平台出金";
  return record.assetName || record.symbol || record.kind;
}
