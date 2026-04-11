const form = document.querySelector("#asset-form");
const tableBody = document.querySelector("#asset-table-body");
const assetCardList = document.querySelector("#asset-card-list");
const toast = document.querySelector("#toast");
const authForm = document.querySelector("#auth-form");
const BEIJING_TIME_ZONE = "Asia/Shanghai";
const NEW_YORK_TIME_ZONE = "America/New_York";

const state = {
  user: null,
  assets: [],
  accountBalances: [],
  transactions: [],
  entryMode: "asset",
  transactionMode: "trade",
  editingTransactionId: "",
  editingTransactionAsset: null,
  weeklySummary: createEmptyWeeklySummary(),
  settings: {
    finnhubKey: "",
    tushareToken: "",
    autoRefreshInterval: 300,
    lastSyncAt: "",
    canEdit: false
  },
  accountOverviewCurrency: "CNY",
  providerStatuses: null,
  selectedProvider: "finnhub",
  displayCurrency: "CNY",
  displayFxRates: { USD: 0 },
  timerId: null,
  filters: {
    type: "all"
  },
  authMode: "login",
  regionTouched: false,
  isRefreshingPrices: false,
  accountValuesVisible: false
};

function createEmptyWeeklySummary() {
  return {
    weekStartDate: "",
    currentDate: "",
    baselineDate: "",
    baselineTotalAssets: 0,
    currentTotalAssets: 0,
    netExternalFlow: 0,
    profit: 0,
    profitRate: 0,
    isPartial: false
  };
}

init();

async function init() {
  mountGlobalToolbar();
  bindEvents();
  syncSettingsAccess();
  resetForm();
  syncTransactionFormByKind();
  render();
  await bootstrapSession();
}

function mountCompactCurrencyControl() {
  const heroCard = document.querySelector(".hero-card");
  const top = document.querySelector(".hero-card .hero-card__top");
  const container = document.querySelector(".hero-card .inline-meta");
  const badge = document.querySelector("#display-currency-badge");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");
  const sidebarSelect = document.querySelector("#display-currency");
  if (!heroCard || !top || !container || !badge || !lastSyncLabel || !note || !sidebarSelect || document.querySelector("#display-currency-compact")) {
    return;
  }

  let headline = top.querySelector(".hero-card__headline");
  if (!headline) {
    headline = document.createElement("div");
    headline.className = "hero-card__headline";
    top.prepend(headline);
  }
  headline.append(note);
  headline.append(container);

  let statusGroup = top.querySelector(".hero-card__status");
  if (!statusGroup) {
    statusGroup = document.createElement("div");
    statusGroup.className = "hero-card__status";
    const titleNode = top.firstElementChild;
    if (titleNode && titleNode !== container) {
      statusGroup.append(titleNode);
    } else {
      const fallbackTitle = document.createElement("span");
      fallbackTitle.textContent = "最近刷新";
      statusGroup.append(fallbackTitle);
    }
    top.append(statusGroup);
  }
  statusGroup.append(lastSyncLabel);

  let statusLabel = statusGroup.querySelector(".hero-card__status-label");
  if (!statusLabel) {
    statusLabel = document.createElement("span");
    statusLabel.className = "hero-card__status-label";
  }
  statusLabel.textContent = "最近刷新";
  statusGroup.replaceChildren(statusLabel, lastSyncLabel);
  top.replaceChildren(headline, statusGroup);

  const wrapper = document.createElement("div");
  wrapper.className = "currency-switch currency-switch--pill";
  wrapper.innerHTML = `
    <label for="display-currency-compact">
      <span>显示币种</span>
      <select id="display-currency-compact">
        <option value="CNY">CNY</option>
        <option value="USD">USD</option>
      </select>
    </label>
  `;
  badge.replaceWith(wrapper);
  wrapper.innerHTML = `
    <button id="display-currency-compact-toggle" type="button" class="currency-switch__toggle" aria-label="切换显示币种">
      <span class="currency-switch__icon" aria-hidden="true">¥</span>
      <span class="currency-switch__label">CNY</span>
    </button>
  `;

  const compactSelect = wrapper.querySelector("#display-currency-compact-toggle");
  compactSelect.addEventListener("click", () => {
    sidebarSelect.value = sidebarSelect.value === "USD" ? "CNY" : "USD";
    sidebarSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  wrapper.innerHTML = `
    <div id="display-currency-compact-toggle" class="currency-switch__segmented" role="group" aria-label="切换显示币种">
      <button type="button" class="currency-switch__option" data-currency="CNY" aria-pressed="true" aria-label="切换为人民币显示">
        <span class="currency-switch__icon" aria-hidden="true">¥</span>
      </button>
      <button type="button" class="currency-switch__option" data-currency="USD" aria-pressed="false" aria-label="切换为美元显示">
        <span class="currency-switch__icon" aria-hidden="true">$</span>
      </button>
    </div>
  `;
  wrapper.querySelectorAll(".currency-switch__option").forEach((button) => {
    button.addEventListener("click", () => {
      const nextCurrency = button.dataset.currency;
      if (!nextCurrency || nextCurrency === sidebarSelect.value) {
        return;
      }
      sidebarSelect.value = nextCurrency;
      sidebarSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  const controls = document.createElement("div");
  controls.className = "hero-card__controls";
  controls.append(wrapper);

  const autoRefreshControl = document.createElement("label");
  autoRefreshControl.className = "hero-quick-select";
  autoRefreshControl.innerHTML = `
    <select id="auto-refresh-compact" aria-label="自动刷新间隔">
      <option value="60">1分钟</option>
      <option value="180">3分钟</option>
      <option value="300">5分钟</option>
      <option value="600">10分钟</option>
    </select>
  `;
  controls.append(autoRefreshControl);

  headline.replaceChildren(note, controls, statusGroup);
  top.replaceChildren(headline);

}

function mountCompactCurrencyControl() {
  const heroTop = document.querySelector(".hero-card .hero-card__top");
  const heroMeta = document.querySelector(".hero-card .inline-meta");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");
  const sidebarSelect = document.querySelector("#display-currency");
  const toolbar = document.querySelector("#account-view-toolbar");

  if (heroTop && heroMeta && lastSyncLabel && note && !document.querySelector("#auto-refresh-compact")) {
    let headline = heroTop.querySelector(".hero-card__headline");
    if (!headline) {
      headline = document.createElement("div");
      headline.className = "hero-card__headline";
      heroTop.prepend(headline);
    }

    let statusGroup = heroTop.querySelector(".hero-card__status");
    if (!statusGroup) {
      statusGroup = document.createElement("div");
      statusGroup.className = "hero-card__status";
    }

    let statusLabel = statusGroup.querySelector(".hero-card__status-label");
    if (!statusLabel) {
      statusLabel = document.createElement("span");
      statusLabel.className = "hero-card__status-label";
    }
    statusLabel.textContent = "最近刷新";

    const controls = document.createElement("div");
    controls.className = "hero-card__controls";
    const autoRefreshControl = document.createElement("label");
    autoRefreshControl.className = "hero-quick-select";
    autoRefreshControl.innerHTML = `
      <select id="auto-refresh-compact" aria-label="自动刷新间隔">
        <option value="60">1分钟</option>
        <option value="180">3分钟</option>
        <option value="300">5分钟</option>
        <option value="600">10分钟</option>
      </select>
    `;
    controls.append(autoRefreshControl);

    statusGroup.replaceChildren(statusLabel, lastSyncLabel);
    headline.replaceChildren(note, controls, statusGroup);
    heroTop.replaceChildren(headline);
  }

  if (toolbar && sidebarSelect && !document.querySelector("#display-currency-compact-toggle")) {
    const wrapper = document.createElement("div");
    wrapper.className = "currency-switch currency-switch--pill";
    wrapper.innerHTML = `
      <div id="display-currency-compact-toggle" class="currency-switch__segmented" role="group" aria-label="切换显示币种">
        <button type="button" class="currency-switch__option" data-currency="CNY" aria-pressed="true" aria-label="切换为人民币显示">
          <span class="currency-switch__icon" aria-hidden="true">¥</span>
        </button>
        <button type="button" class="currency-switch__option" data-currency="USD" aria-pressed="false" aria-label="切换为美元显示">
          <span class="currency-switch__icon" aria-hidden="true">$</span>
        </button>
      </div>
    `;
    wrapper.querySelectorAll(".currency-switch__option").forEach((button) => {
      button.addEventListener("click", () => {
        const nextCurrency = button.dataset.currency;
        if (!nextCurrency || nextCurrency === sidebarSelect.value) {
          return;
        }
        sidebarSelect.value = nextCurrency;
        sidebarSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    toolbar.append(wrapper);
  }
}

function mountGlobalToolbar() {
  const heroTop = document.querySelector(".hero-card .hero-card__top");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");

  if (heroTop && lastSyncLabel && note && !document.querySelector("#auto-refresh-compact")) {
    let headline = heroTop.querySelector(".hero-card__headline");
    if (!headline) {
      headline = document.createElement("div");
      headline.className = "hero-card__headline";
      heroTop.prepend(headline);
    }

    let statusGroup = heroTop.querySelector(".hero-card__status");
    if (!statusGroup) {
      statusGroup = document.createElement("div");
      statusGroup.className = "hero-card__status";
    }

    let statusLabel = statusGroup.querySelector(".hero-card__status-label");
    if (!statusLabel) {
      statusLabel = document.createElement("span");
      statusLabel.className = "hero-card__status-label";
    }
    statusLabel.textContent = "鏈€杩戝埛鏂?";

    const controls = document.createElement("div");
    controls.className = "hero-card__controls";
    const autoRefreshControl = document.createElement("label");
    autoRefreshControl.className = "hero-quick-select";
    autoRefreshControl.innerHTML = `
      <select id="auto-refresh-compact" aria-label="鑷姩鍒锋柊闂撮殧">
        <option value="60">1鍒嗛挓</option>
        <option value="180">3鍒嗛挓</option>
        <option value="300">5鍒嗛挓</option>
        <option value="600">10鍒嗛挓</option>
      </select>
    `;
    controls.append(autoRefreshControl);
    statusLabel.textContent = "最近刷新";
    const refreshSelect = autoRefreshControl.querySelector("#auto-refresh-compact");
    if (refreshSelect) {
      refreshSelect.setAttribute("aria-label", "自动刷新间隔");
      refreshSelect.innerHTML = `
        <option value="60">1分钟</option>
        <option value="180">3分钟</option>
        <option value="300">5分钟</option>
        <option value="600">10分钟</option>
      `;
    }

    statusGroup.replaceChildren(statusLabel, lastSyncLabel);
    headline.replaceChildren(note, controls, statusGroup);
    heroTop.replaceChildren(headline);
  }
}

function mountGlobalToolbar() {
  const heroTop = document.querySelector(".hero-card .hero-card__top");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");
  const sidebarRefresh = document.querySelector("#auto-refresh-sidebar");

  if (!heroTop || !lastSyncLabel || !note) {
    if (sidebarRefresh) {
      sidebarRefresh.setAttribute("aria-label", "自动刷新间隔");
      sidebarRefresh.innerHTML = `
        <option value="60">1分钟</option>
        <option value="180">3分钟</option>
        <option value="300">5分钟</option>
        <option value="600">10分钟</option>
      `;
    }
    return;
  }

  if (sidebarRefresh) {
    sidebarRefresh.setAttribute("aria-label", "自动刷新间隔");
    sidebarRefresh.innerHTML = `
      <option value="60">1m</option>
      <option value="180">3m</option>
      <option value="300">5m</option>
      <option value="600">10m</option>
    `;
  }

  let headline = heroTop.querySelector(".hero-card__headline");
  if (!headline) {
    headline = document.createElement("div");
    headline.className = "hero-card__headline";
    heroTop.prepend(headline);
  }

  let statusGroup = heroTop.querySelector(".hero-card__status");
  if (!statusGroup) {
    statusGroup = document.createElement("div");
    statusGroup.className = "hero-card__status";
  }

  let statusLabel = statusGroup.querySelector(".hero-card__status-label");
  if (!statusLabel) {
    statusLabel = document.createElement("span");
    statusLabel.className = "hero-card__status-label";
  }

  statusLabel.textContent = "最近刷新";
  statusGroup.replaceChildren(statusLabel, lastSyncLabel);
  headline.replaceChildren(note, statusGroup);
  heroTop.replaceChildren(headline);
}

function mountGlobalToolbar() {
  const heroTop = document.querySelector(".hero-card .hero-card__top");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");
  const sidebarRefresh = document.querySelector("#auto-refresh-sidebar");

  if (sidebarRefresh) {
    sidebarRefresh.setAttribute("aria-label", "自动刷新间隔");
    sidebarRefresh.innerHTML = `
      <option value="60">1分钟</option>
      <option value="180">3分钟</option>
      <option value="300">5分钟</option>
      <option value="600">10分钟</option>
    `;
  }

  if (!heroTop || !lastSyncLabel || !note) {
    return;
  }

  let headline = heroTop.querySelector(".hero-card__headline");
  if (!headline) {
    headline = document.createElement("div");
    headline.className = "hero-card__headline";
    heroTop.prepend(headline);
  }

  let statusGroup = heroTop.querySelector(".hero-card__status");
  if (!statusGroup) {
    statusGroup = document.createElement("div");
    statusGroup.className = "hero-card__status";
  }

  let statusLabel = statusGroup.querySelector(".hero-card__status-label");
  if (!statusLabel) {
    statusLabel = document.createElement("span");
    statusLabel.className = "hero-card__status-label";
  }

  statusLabel.textContent = "最近刷新";
  statusGroup.replaceChildren(statusLabel, lastSyncLabel);
  headline.replaceChildren(note, statusGroup);
  heroTop.replaceChildren(headline);
}

function mountGlobalToolbar() {
  const heroTop = document.querySelector(".hero-card .hero-card__top");
  const lastSyncLabel = document.querySelector("#last-sync-label");
  const note = document.querySelector(".hero-card .hero-card__note");
  const sidebarRefresh = document.querySelector("#auto-refresh-sidebar");

  if (sidebarRefresh) {
    sidebarRefresh.setAttribute("aria-label", "自动刷新间隔");
    sidebarRefresh.innerHTML = `
      <option value="60">1m</option>
      <option value="180">3m</option>
      <option value="300">5m</option>
      <option value="600">10m</option>
    `;
  }

  if (!heroTop || !lastSyncLabel || !note) {
    return;
  }

  let headline = heroTop.querySelector(".hero-card__headline");
  if (!headline) {
    headline = document.createElement("div");
    headline.className = "hero-card__headline";
    heroTop.prepend(headline);
  }

  let statusGroup = heroTop.querySelector(".hero-card__status");
  if (!statusGroup) {
    statusGroup = document.createElement("div");
    statusGroup.className = "hero-card__status";
  }

  let statusLabel = statusGroup.querySelector(".hero-card__status-label");
  if (!statusLabel) {
    statusLabel = document.createElement("span");
    statusLabel.className = "hero-card__status-label";
  }

  statusLabel.textContent = "最近刷新";
  statusGroup.replaceChildren(statusLabel, lastSyncLabel);
  headline.replaceChildren(note, statusGroup);
  heroTop.replaceChildren(headline);
}

function bindEvents() {
  form.addEventListener("submit", handleSubmit);
  const transactionForm = document.querySelector("#transaction-form");
  if (transactionForm) {
    transactionForm.addEventListener("submit", handleTransactionSubmit);
  }
  const resetTransactionButton = document.querySelector("#reset-transaction-form-btn");
  if (resetTransactionButton) {
    resetTransactionButton.addEventListener("click", resetTransactionForm);
  }
  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.addEventListener("click", handleEntryModeChange);
  });
  authForm.addEventListener("submit", handleAuthSubmit);
  document.querySelector("#reset-form-btn").addEventListener("click", resetForm);
  document.querySelector("#clear-assets-btn").addEventListener("click", clearAssets);
  document.querySelector("#export-assets-btn").addEventListener("click", exportAssets);
  document.querySelector("#import-assets-btn").addEventListener("click", () => {
    document.querySelector("#import-assets-file").click();
  });
  document.querySelector("#import-assets-file").addEventListener("change", handleImportAssets);
  const saveSettingsButton = document.querySelector("#save-settings-button");
  if (saveSettingsButton) {
    saveSettingsButton.addEventListener("click", saveSettings);
  }
  document.querySelector("#refresh-provider-status-button").addEventListener("click", () => {
    refreshProviderStatuses({ force: true });
  });
  document.querySelector("#logout-button").addEventListener("click", logout);
  const accountLogoutButton = document.querySelector("#account-logout-button");
  if (accountLogoutButton) {
    accountLogoutButton.addEventListener("click", logout);
  }
  document.querySelector("#close-auth-modal-button").addEventListener("click", closeAuthModal);
  document.querySelector("#asset-type").addEventListener("change", syncFormByContext);
  document.querySelector("#asset-platform").addEventListener("change", syncFormByContext);
  document.querySelector("#asset-source-select").addEventListener("change", syncFormByContext);
  document.querySelector("#asset-region").addEventListener("change", handleRegionFieldChange);
  document.querySelector("#asset-symbol").addEventListener("input", updateSymbolHint);
  document.querySelector("#asset-symbol").addEventListener("input", validateAssetSymbolCompatibility);
  document.querySelector("#asset-symbol").addEventListener("blur", autoFillLatestPrice);
  document.querySelector("#display-currency").addEventListener("change", handleDisplayCurrencyChange);
  const transactionKind = document.querySelector("#transaction-kind");
  if (transactionKind) {
    transactionKind.addEventListener("change", syncTransactionFormByKind);
  }
  const transactionPlatform = document.querySelector("#transaction-platform");
  if (transactionPlatform) {
    transactionPlatform.addEventListener("change", syncTransactionFormByKind);
  }
  const transactionAssetSelect = document.querySelector("#transaction-asset-id");
  if (transactionAssetSelect) {
    transactionAssetSelect.addEventListener("change", syncTransactionAssetSelection);
  }
  const accountPrivacyToggle = document.querySelector("#account-privacy-toggle");
  if (accountPrivacyToggle) {
    accountPrivacyToggle.addEventListener("click", toggleAccountValuesVisibility);
  }
  const compactCurrencyToggle = document.querySelector("#display-currency-compact-toggle");
  if (compactCurrencyToggle) {
    compactCurrencyToggle.addEventListener("click", () => {
      const currencySelect = document.querySelector("#display-currency");
      if (!currencySelect) {
        return;
      }
      currencySelect.value = currencySelect.value === "USD" ? "CNY" : "USD";
      currencySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  const autoRefreshCycle = document.querySelector("#auto-refresh-cycle");
  if (autoRefreshCycle) {
    autoRefreshCycle.addEventListener("click", cycleAutoRefreshInterval);
  }
  const autoRefreshCyclePrimary = document.querySelector("#auto-refresh-cycle-primary");
  if (autoRefreshCyclePrimary) {
    autoRefreshCyclePrimary.addEventListener("click", cycleAutoRefreshInterval);
  }
  const autoRefreshSidebar = document.querySelector("#auto-refresh-sidebar");
  if (autoRefreshSidebar) {
    autoRefreshSidebar.addEventListener("change", handleAutoRefreshIntervalChange);
  }
  const autoRefreshCompact = document.querySelector("#auto-refresh-compact");
  if (autoRefreshCompact) {
    autoRefreshCompact.addEventListener("change", handleAutoRefreshIntervalChange);
  }
  document.querySelector("#asset-type-filter").addEventListener("change", handleFilterChange);
  document.querySelector("#clear-filter-btn").addEventListener("click", clearFilters);

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", handleViewChange);
  });
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", handleAuthModeChange);
  });
  document.querySelectorAll("[data-open-auth-modal]").forEach((button) => {
    button.addEventListener("click", handleOpenAuthModal);
  });
  document.querySelectorAll("[data-close-auth-modal]").forEach((button) => {
    button.addEventListener("click", closeAuthModal);
  });
}

async function bootstrapSession() {
  try {
    const me = await apiFetch("/api/auth/me");
    state.user = me.user;
    await loadServerData();
  } catch {
    updateAuthUI();
    lockAppForGuest();
  }
}

async function loadServerData() {
  const [assetsResponse, settingsResponse, accountBalancesResponse, transactionsResponse] = await Promise.all([
    apiFetch("/api/assets"),
    apiFetch("/api/settings"),
    apiFetch("/api/account-balances"),
    apiFetch("/api/transactions")
  ]);

  state.assets = assetsResponse.assets;
  state.settings = settingsResponse.settings;
  state.accountBalances = accountBalancesResponse.accountBalances || [];
  state.transactions = transactionsResponse.transactions || [];
  state.weeklySummary = createEmptyWeeklySummary();
  state.accountOverviewCurrency = inferAccountOverviewCurrency();
  hydrateSettings();
  updateAuthUI();
  unlockAppForUser();
  render();
  await refreshWeeklySummary({ renderAfter: true });
  await refreshProviderStatuses({ silent: true });
  setupAutoRefresh();

  try {
    await refreshExchangeRates({ silent: true, persist: false });
  } catch {
    // ignore FX bootstrap failures
  }

  try {
    await ensureDisplayCurrencyRate();
  } catch {
    // ignore display rate bootstrap failures
  }

  try {
    await refreshAllPrices({ bypassCooldown: true, silent: true, suppressEmptyToast: true });
  } catch (error) {
    console.error("Initial quote refresh failed", error);
  }

  render();
}

async function refreshPortfolioState(options = {}) {
  const { renderAfter = true } = options;
  if (!state.user) {
    state.assets = [];
    state.accountBalances = [];
    state.transactions = [];
    state.weeklySummary = createEmptyWeeklySummary();
    if (renderAfter) {
      render();
    }
    return;
  }

  const [assetsResponse, accountBalancesResponse, transactionsResponse] = await Promise.all([
    apiFetch("/api/assets"),
    apiFetch("/api/account-balances"),
    apiFetch("/api/transactions")
  ]);

  state.assets = assetsResponse.assets || [];
  state.accountBalances = accountBalancesResponse.accountBalances || [];
  state.transactions = transactionsResponse.transactions || [];
  state.accountOverviewCurrency = inferAccountOverviewCurrency();
  await refreshWeeklySummary({ renderAfter: false });
  if (renderAfter) {
    render();
  }
}

function syncEntryWorkspace() {
  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    const isActive = button.dataset.entryMode === state.entryMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  document.querySelectorAll("[data-entry-workspace]").forEach((panel) => {
    const workspace = panel.dataset.entryWorkspace;
    const shouldShow = state.entryMode === "asset" ? workspace === "asset" : workspace === "transaction";
    panel.classList.toggle("hidden", !shouldShow);
  });
}

function handleEntryModeChange(event) {
  const nextMode = event.currentTarget.dataset.entryMode;
  if (!nextMode) {
    return;
  }
  state.entryMode = nextMode;
  if (nextMode === "trade" || nextMode === "cash") {
    state.transactionMode = nextMode;
  }
  syncEntryWorkspace();
  syncTransactionFormByKind();
}

function render() {
  const filteredAssets = getFilteredAssets();
  renderAccountPrivacyToggle();
  renderDisplayCurrencyBadges();
  syncEntryWorkspace();
  syncTransactionFormByKind();
  renderRecordPanelTitle();
  renderSummary(filteredAssets);
  renderWeeklySummary();
  renderTransactionHistory();
  renderHomepageAssetDistribution(filteredAssets);
  renderHomepagePlatformProfit(filteredAssets);
  renderPlatformSummary(filteredAssets);
  renderTable(filteredAssets);
  renderAssetCards(filteredAssets);
  renderDashboardRiskBanner();
}

function renderRecordPanelTitle() {
  const title = document.querySelector("#record-panel-title");
  if (!title) {
    return;
  }
  title.textContent = state.entryMode === "asset"
    ? "新增资产记录"
    : state.entryMode === "trade"
      ? "买卖记录"
      : "出入金记录";
}

function renderDisplayCurrencyBadges() {
  const label = state.displayCurrency || "CNY";
  const compactToggle = document.querySelector("#display-currency-compact-toggle");
  if (compactToggle) {
    compactToggle.dataset.currency = label;
    compactToggle.setAttribute("aria-label", label === "USD" ? "当前美元，点击切换为人民币显示" : "当前人民币，点击切换为美元显示");
    compactToggle.title = label === "USD" ? "当前 USD，点击切换到 CNY" : "当前 CNY，点击切换到 USD";
    compactToggle.innerHTML = `
      <span class="sidebar-tool-button__icon" aria-hidden="true">${label === "USD" ? "$" : "¥"}</span>
    `;
  }
}

function renderSummary(assets) {
  const summary = assets.reduce(
    (accumulator, asset) => {
      const currentValue = getCurrentValue(asset);
      const costValue = getCostValue(asset);
      const profit = currentValue - costValue;
      const dailyProfit = getDailyProfit(asset);

      accumulator.totalAssets += currentValue;
      accumulator.totalCost += costValue;
      accumulator.totalProfit += profit;
      accumulator.dailyProfit += dailyProfit;
      return accumulator;
    },
      { totalAssets: 0, totalCost: 0, totalProfit: 0, dailyProfit: 0 }
    );

  let totalMargin = 0;
  let totalCashBalance = 0;

  const accountFreeCashCny = state.accountBalances.reduce((total, item) => {
    const platform = item.platform || "other";
    const freeCashCny = (Number(item.freeCash) || 0) * getPlatformFxRateToCny(platform);
    if (freeCashCny < 0) {
      totalMargin += Math.abs(freeCashCny);
    } else {
      totalCashBalance += freeCashCny;
    }
    return total + freeCashCny;
  }, 0);

  summary.totalAssets += accountFreeCashCny;

  const base = Math.abs(summary.totalCost);
  const dailyProfitRate = base > 0 ? (summary.dailyProfit / base) * 100 : 0;

  setText("#total-assets", getMaskedSensitiveText(formatCurrency(summary.totalAssets)));
  setText("#daily-profit", getMaskedSensitiveText(formatCurrency(summary.dailyProfit)));
  setText("#total-margin", getMaskedSensitiveText(formatCurrency(totalMargin)));
  setText("#total-cash-balance", getMaskedSensitiveText(formatCurrency(totalCashBalance)));
  setText("#hero-daily-profit-main", formatCurrency(summary.dailyProfit));
  setText("#hero-daily-profit-rate", `${formatSignedNumber(dailyProfitRate)}%`);

  applyNumberTone(document.querySelector("#daily-profit"), summary.dailyProfit);
  applyNumberTone(document.querySelector("#total-margin"), -totalMargin);
  applyNumberTone(document.querySelector("#total-cash-balance"), totalCashBalance);
  applyNumberTone(document.querySelector("#hero-daily-profit-main"), summary.dailyProfit);
  applyNumberTone(document.querySelector("#hero-daily-profit-rate"), dailyProfitRate);
  updateLastSyncLabel(state.settings.lastSyncAt);
}

function renderWeeklySummary() {
  const summary = {
    ...createEmptyWeeklySummary(),
    ...(state.weeklySummary || {})
  };
  const note = summary.isPartial && summary.baselineDate
    ? `本周从 ${summary.baselineDate} 开始 · ${formatSignedNumber(summary.profitRate)}%`
    : `${summary.weekStartDate || "周一"} 至今 · ${formatSignedNumber(summary.profitRate)}%`;

  setText("#weekly-profit", getMaskedSensitiveText(formatCurrency(summary.profit)));
  setText("#weekly-profit-note", note);
  setText("#hero-total-profit-rate", `${formatSignedNumber(summary.profitRate)}%`);
  applyNumberTone(document.querySelector("#weekly-profit"), summary.profit);
  applyNumberTone(document.querySelector("#hero-total-profit-rate"), summary.profitRate);
}

async function refreshWeeklySummary(options = {}) {
  const { renderAfter = true } = options;
  if (!state.user) {
    state.weeklySummary = createEmptyWeeklySummary();
    if (renderAfter) {
      renderWeeklySummary();
    }
    return;
  }

  try {
    const response = await apiFetch("/api/summary/weekly");
    state.weeklySummary = {
      ...createEmptyWeeklySummary(),
      ...(response.summary || {})
    };
  } catch (error) {
    console.error("Failed to refresh weekly summary", error);
    state.weeklySummary = createEmptyWeeklySummary();
  }

  if (renderAfter) {
    renderWeeklySummary();
  }
}

function syncTransactionFormByKind() {
  const form = document.querySelector("#transaction-form");
  const kindField = document.querySelector("#transaction-kind");
  const platformField = document.querySelector("#transaction-platform");
  const assetFields = document.querySelectorAll("[data-transaction-asset-field]");
  const cashField = document.querySelector("[data-transaction-cash-field]");
  const cashMetaFields = document.querySelectorAll("[data-transaction-cash-meta-field]");
  const amountLabel = document.querySelector("#transaction-cash-label");
  const assetSelect = document.querySelector("#transaction-asset-id");
  if (!kindField || !platformField) {
    return;
  }

  const isTrade = state.transactionMode !== "cash";
  const kindOptions = isTrade
    ? [
        ["buy", "买入"],
        ["sell", "卖出"]
      ]
    : [
        ["deposit", "入金"],
        ["withdraw", "出金"]
      ];
  const previousKind = kindField.value;
  kindField.innerHTML = kindOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  kindField.value = kindOptions.some(([value]) => value === previousKind) ? previousKind : kindOptions[0][0];
  const kind = kindField.value;
  const previousAssetId = assetSelect ? assetSelect.value : "";
  if (form) {
    form.classList.toggle("transaction-form--trade", isTrade);
    form.classList.toggle("transaction-form--cash", !isTrade);
  }
  assetFields.forEach((element) => {
    element.classList.toggle("hidden", !isTrade);
  });
  cashMetaFields.forEach((element) => {
    element.classList.toggle("hidden", isTrade);
  });
  if (cashField) {
    cashField.classList.toggle("hidden", isTrade);
  }
  if (amountLabel) {
    amountLabel.textContent = kind === "deposit" ? "入金金额" : "出金金额";
  }
  if (assetSelect) {
    const assets = state.assets
      .filter((asset) => !["cash", "liability"].includes(asset.type))
      .sort((left, right) => String(left.name || left.symbol).localeCompare(String(right.name || right.symbol), "zh-CN"));
    if (state.editingTransactionAsset && !assets.some((asset) => asset.id === state.editingTransactionAsset.id || (asset.platform === state.editingTransactionAsset.platform && asset.type === state.editingTransactionAsset.type && asset.symbol === state.editingTransactionAsset.symbol))) {
      assets.unshift(state.editingTransactionAsset);
    }
    assetSelect.innerHTML = assets.length
      ? assets.map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)} · ${escapeHtml(asset.symbol)} · ${escapeHtml(String(asset.platform || "").toUpperCase())}</option>`).join("")
      : '<option value="">暂无可交易资产</option>';
    if (previousAssetId && assets.some((asset) => asset.id === previousAssetId)) {
      assetSelect.value = previousAssetId;
    }
  }
  syncTransactionAssetSelection();
}

function syncTransactionAssetSelection() {
  const assetSelect = document.querySelector("#transaction-asset-id");
  const platformField = document.querySelector("#transaction-platform");
  if (!assetSelect) {
    return;
  }
  const asset = state.assets.find((item) => item.id === assetSelect.value);
  if (state.transactionMode !== "cash" && platformField && asset?.platform) {
    platformField.value = asset.platform;
  }
}

function fillTransactionFormFromRecord(record) {
  state.editingTransactionId = record.id;
  state.editingTransactionAsset = record.kind === "buy" || record.kind === "sell"
    ? {
        id: `record:${record.id}`,
        name: record.assetName || record.symbol,
        platform: record.platform,
        type: record.assetType,
        symbol: record.symbol,
        currency: record.currency,
        quoteSource: record.quoteSource,
        quoteDate: record.quoteDate
      }
    : null;
  state.entryMode = record.kind === "deposit" || record.kind === "withdraw" ? "cash" : "trade";
  state.transactionMode = state.entryMode;
  syncEntryWorkspace();
  syncTransactionFormByKind();

  const kindField = document.querySelector("#transaction-kind");
  const platformField = document.querySelector("#transaction-platform");
  const assetField = document.querySelector("#transaction-asset-id");
  const quantityField = document.querySelector("#transaction-quantity");
  const priceField = document.querySelector("#transaction-price");
  const feeField = document.querySelector("#transaction-fee");
  const cashAmountField = document.querySelector("#transaction-cash-amount");

  if (kindField) {
    kindField.value = record.kind;
  }
  if (platformField) {
    platformField.value = record.platform || "ibkr";
  }
  if (assetField && (record.kind === "buy" || record.kind === "sell")) {
    const matchedAsset = state.assets.find((item) => item.id === record.id)
      || state.assets.find((item) => item.platform === record.platform && item.type === record.assetType && item.symbol === record.symbol);
    if (matchedAsset) {
      assetField.value = matchedAsset.id;
    }
  }
  if (quantityField) {
    quantityField.value = record.quantity || "";
  }
  if (priceField) {
    priceField.value = record.price || "";
  }
  if (feeField) {
    feeField.value = record.fee || 0;
  }
  if (cashAmountField) {
    cashAmountField.value = Math.abs(Number(record.cashAmount) || 0) || "";
  }
}

function resetTransactionForm() {
  const form = document.querySelector("#transaction-form");
  if (!form) {
    return;
  }
  form.reset();
  state.editingTransactionId = "";
  state.editingTransactionAsset = null;
  state.transactionMode = state.entryMode === "cash" ? "cash" : "trade";
  const platformField = document.querySelector("#transaction-platform");
  if (platformField && !platformField.value) {
    platformField.value = "ibkr";
  }
  syncTransactionFormByKind();
}

async function handleRecordAction(event) {
  const action = event.currentTarget.dataset.recordAction;
  const id = event.currentTarget.dataset.id;
  const record = state.transactions.find((item) => item.id === id);
  if (!record) {
    return;
  }

  if (action === "edit") {
    if (record.kind === "asset") {
      state.entryMode = "asset";
      fillForm({
        id: record.id,
        name: record.assetName,
        platform: record.platform,
        type: record.assetType,
        symbol: record.symbol,
        quantity: record.quantity,
        costPrice: record.costPrice,
        currentPrice: record.currentPrice,
        previousClose: record.previousClose,
        currency: record.currency,
        fxRate: record.fxRate,
        quoteSource: record.quoteSource,
        quoteDate: record.quoteDate,
        quoteFetchedAt: record.createdAt || record.occurredAt,
        notes: record.notes || ""
      });
      syncEntryWorkspace();
      switchView("entry");
      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast(`正在编辑 ${record.assetName || record.symbol}`);
      return;
    }

    fillTransactionFormFromRecord(record);
    switchView("entry");
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("已载入记录，可直接修改");
    return;
  }

  const label = record.kind === "asset" ? (record.assetName || record.symbol) : (record.assetName || record.symbol || getPlatformLabel(record.platform));
  if (!window.confirm(`确定删除这条记录吗？\n${label}`)) {
    return;
  }
  await apiFetch(`/api/transactions/${encodeURIComponent(record.id)}`, { method: "DELETE" });
  await refreshPortfolioState({ renderAfter: false });
  resetForm();
  resetTransactionForm();
  render();
  showToast("记录已删除");
}

function renderTransactionHistory() {
  const container = document.querySelector("#transaction-history");
  if (!container) {
    return;
  }
  const records = state.transactions
    .filter((item) => item.kind !== "balance")
    .filter((item) => {
      if (state.entryMode === "asset") {
        return item.kind === "asset";
      }
      if (state.entryMode === "trade") {
        return item.kind === "buy" || item.kind === "sell";
      }
      if (state.entryMode === "cash") {
        return item.kind === "deposit" || item.kind === "withdraw";
      }
      return true;
    });
  if (!records.length) {
    const emptyText = state.entryMode === "asset"
      ? "还没有新增资产记录。"
      : state.entryMode === "trade"
        ? "还没有买卖记录。"
        : "还没有出入金记录。";
    container.innerHTML = `<p class="transaction-history__empty">${emptyText}</p>`;
    return;
  }

  container.innerHTML = records
    .slice(0, 20)
    .map((item) => {
      const cashValueCny = (Number(item.cashAmount) || 0) * (Number(item.fxRate) || 1);
      const realizedProfitCny = (Number(item.realizedProfit) || 0) * (Number(item.fxRate) || 1);
      const title = item.kind === "asset"
        ? `新增资产 ${item.assetName || item.symbol}`
        : item.kind === "buy"
          ? `买入 ${item.assetName || item.symbol}`
          : item.kind === "sell"
            ? `卖出 ${item.assetName || item.symbol}`
            : item.kind === "deposit"
              ? "平台入金"
              : "平台出金";
      const meta = [getPlatformLabel(item.platform), item.symbol || item.currency, item.occurredAt ? new Date(item.occurredAt).toLocaleString("zh-CN") : ""]
        .filter(Boolean)
        .join(" · ");
      const valueMarkup = item.kind === "asset"
        ? `<strong>${formatCurrency(getCurrentValue({
            quantity: Number(item.quantity) || 0,
            currentPrice: Number(item.currentPrice) || 0,
            fxRate: Number(item.fxRate) || 1,
            type: item.assetType || "fund"
          }))}</strong>`
        : `<strong class="${getToneClass(cashValueCny)}">${formatCurrency(cashValueCny)}</strong>
           ${item.kind === "sell" ? `<small class="${getToneClass(realizedProfitCny)}">已实现 ${formatCurrency(realizedProfitCny)}</small>` : ""}`;
      return `
        <article class="transaction-item">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(meta)}</small>
          </div>
          <div class="transaction-item__values">
            ${valueMarkup}
          </div>
          <div class="transaction-item__actions">
            <button type="button" class="ghost-button" data-record-action="edit" data-id="${escapeHtml(item.id)}">编辑</button>
            <button type="button" class="ghost-button danger-ghost-button" data-record-action="delete" data-id="${escapeHtml(item.id)}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-record-action]").forEach((button) => {
    button.addEventListener("click", handleRecordAction);
  });
}

async function handleTransactionSubmit(event) {
  event.preventDefault();
  if (!ensureLoggedIn()) {
    return;
  }

  const kind = String(document.querySelector("#transaction-kind")?.value || "").trim();
  const platform = String(document.querySelector("#transaction-platform")?.value || "").trim();
  const selectedAssetId = String(document.querySelector("#transaction-asset-id")?.value || "").trim();
  const selectedAsset = state.assets.find((item) => item.id === selectedAssetId)
    || (state.editingTransactionAsset && state.editingTransactionAsset.id === selectedAssetId ? state.editingTransactionAsset : null);
  const currency = String(selectedAsset?.currency || getPlatformCurrency(platform)).trim().toUpperCase();
  if (currency !== "CNY") {
    try {
      await ensureFxRateCached(currency);
    } catch (error) {
      showToast(error.message || "获取汇率失败");
      return;
    }
  }
  const payload = {
    id: state.editingTransactionId || crypto.randomUUID(),
    kind,
    platform,
    assetName: selectedAsset?.name || "",
    assetType: selectedAsset?.type || "",
    symbol: selectedAsset?.symbol || "",
    quantity: Number(document.querySelector("#transaction-quantity")?.value) || 0,
    price: Number(document.querySelector("#transaction-price")?.value) || 0,
    fee: Number(document.querySelector("#transaction-fee")?.value) || 0,
    cashAmount: Number(document.querySelector("#transaction-cash-amount")?.value) || 0,
    currency,
    fxRate: getCurrencyFxRateToCny(currency),
    quoteSource: selectedAsset?.quoteSource || "manual",
    quoteDate: selectedAsset?.quoteDate || "",
    notes: "",
    occurredAt: new Date().toISOString()
  };

  if (!payload.kind || !payload.platform) {
    showToast("请先选择交易类型和平台");
    return;
  }
  if ((payload.kind === "buy" || payload.kind === "sell") && (!selectedAsset || payload.quantity <= 0 || payload.price <= 0)) {
    showToast("买卖交易请先从已有资产中选择一项，并填写数量和价格");
    return;
  }
  if ((payload.kind === "deposit" || payload.kind === "withdraw") && payload.cashAmount <= 0) {
    showToast("入金或出金金额必须大于 0");
    return;
  }

  const isEditingTransaction = Boolean(state.editingTransactionId);
  await apiFetch(isEditingTransaction ? `/api/transactions/${encodeURIComponent(state.editingTransactionId)}` : "/api/transactions", {
    method: isEditingTransaction ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  await refreshPortfolioState({ renderAfter: false });
  resetTransactionForm();
  render();
  showToast(isEditingTransaction ? "记录已更新" : (payload.kind === "buy" || payload.kind === "sell" ? "交易已记录并同步持仓" : "资金流水已记录"));
}

function renderPlatformSummary(assets) {
  const container = document.querySelector("#platform-summary-grid");
  if (!assets.length) {
    container.innerHTML = `
      <article class="stat-card">
        <span>暂无平台数据</span>
        <strong>¥0.00</strong>
        <small>录入资产后会自动汇总</small>
      </article>
    `;
    return;
  }

  const groups = assets.reduce((accumulator, asset) => {
    const key = asset.platform || "other";
    if (!accumulator[key]) {
      accumulator[key] = { platform: key, totalAssets: 0, totalProfit: 0 };
    }

    const currentValue = getCurrentValue(asset);
    const costValue = getCostValue(asset);
    accumulator[key].totalAssets += currentValue;
    accumulator[key].totalProfit += currentValue - costValue;
    return accumulator;
  }, {});

  container.innerHTML = Object.values(groups)
    .sort((left, right) => Math.abs(right.totalAssets) - Math.abs(left.totalAssets))
    .map((group) => `
      <article class="stat-card">
        <span>${escapeHtml(getPlatformLabel(group.platform))}</span>
        <strong class="${getToneClass(group.totalAssets)}">${formatCurrency(group.totalAssets)}</strong>
        <small>累计收益 ${formatCurrency(group.totalProfit)}</small>
      </article>
    `)
    .join("");
}

function renderTable(assets) {
  if (!assets.length) {
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">当前筛选结果下没有资产。</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = assets
    .map((asset) => {
      const currentValue = getCurrentValue(asset);
      const costValue = getCostValue(asset);
      const profit = currentValue - costValue;
      const dailyProfit = getDailyProfit(asset);
      const updatedAt = asset.updatedAt ? new Date(asset.updatedAt).toLocaleString("zh-CN") : "未更新";

      return `
        <tr>
          <td>
            <div class="asset-cell">
              <strong>${escapeHtml(asset.name)}</strong>
              <span class="asset-meta">${escapeHtml(getPlatformLabel(asset.platform))} · ${escapeHtml(getTypeLabel(asset.type))} · ${escapeHtml(asset.symbol)}</span>
              <span class="asset-meta">${asset.notes ? `${escapeHtml(asset.notes)} · ${updatedAt}` : updatedAt}</span>
            </div>
          </td>
          <td>${formatNumber(asset.quantity)}</td>
          <td>${formatCurrency(asset.costPrice * asset.fxRate)} / 份</td>
          <td>${formatCurrency((asset.currentPrice || 0) * asset.fxRate)} / 份</td>
          <td>${formatCurrency(currentValue)}</td>
          <td class="${getToneClass(profit)}">${formatCurrency(profit)}</td>
          <td class="${getToneClass(dailyProfit)}">${formatCurrency(dailyProfit)}</td>
          <td>${renderSourceBadge(asset)}</td>
          <td>
            <div class="table-actions">
              <button type="button" data-action="edit" data-id="${asset.id}">编辑</button>
              <button type="button" data-action="delete" data-id="${asset.id}">删除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tableBody.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleAssetAction);
  });
}

function renderAssetCards(assets) {
  if (!assets.length) {
    assetCardList.innerHTML = `
      <article class="mobile-asset-card empty-mobile-card">
        <p>当前筛选结果下没有资产。</p>
      </article>
    `;
    return;
  }

  assetCardList.innerHTML = assets
    .map((asset) => {
      const currentValue = getCurrentValue(asset);
      const costValue = getCostValue(asset);
      const profit = currentValue - costValue;
      const dailyProfit = getDailyProfit(asset);

      return `
        <article class="mobile-asset-card">
          <div class="mobile-asset-card__head">
            <div>
              <h3 class="mobile-asset-card__title">${escapeHtml(asset.name)}</h3>
              <div class="asset-meta">${escapeHtml(getPlatformLabel(asset.platform))} · ${escapeHtml(getTypeLabel(asset.type))}</div>
            </div>
            <div class="${getToneClass(profit)}">${formatCurrency(currentValue)}</div>
          </div>
          <div class="mobile-asset-card__grid">
            <div class="mobile-asset-card__item"><span>代码</span><strong>${escapeHtml(asset.symbol)}</strong></div>
            <div class="mobile-asset-card__item"><span>数量</span><strong>${formatNumber(asset.quantity)}</strong></div>
            <div class="mobile-asset-card__item"><span>累计收益</span><strong class="${getToneClass(profit)}">${formatCurrency(profit)}</strong></div>
            <div class="mobile-asset-card__item"><span>今日收益</span><strong class="${getToneClass(dailyProfit)}">${formatCurrency(dailyProfit)}</strong></div>
            <div class="mobile-asset-card__item"><span>成本</span><strong>${formatCurrency(costValue)}</strong></div>
            <div class="mobile-asset-card__item"><span>来源状态</span><strong>${renderSourceBadge(asset)}</strong></div>
          </div>
          <div class="mobile-asset-card__actions">
            <button type="button" data-action="edit" data-id="${asset.id}">编辑</button>
            <button type="button" data-action="delete" data-id="${asset.id}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  assetCardList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleAssetAction);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!ensureLoggedIn()) {
    return;
  }

  await applyRegionSelection(document.querySelector("#asset-region").value);

  const formData = new FormData(form);
  const rawSymbol = String(formData.get("symbol")).trim().toUpperCase();
  const existingAsset = state.assets.find((item) => item.id === formData.get("id"));
  const latestPriceField = document.querySelector("#asset-price");
  const asset = {
    id: formData.get("id") || crypto.randomUUID(),
    name: String(formData.get("name")).trim(),
    platform: String(formData.get("platform")),
    type: String(formData.get("type")),
    symbol: normalizeAssetSymbol(rawSymbol, String(formData.get("type")), String(formData.get("platform"))),
    quantity: Number(formData.get("quantity")),
    costPrice: Number(formData.get("costPrice")),
    currentPrice: Number(formData.get("currentPrice")) || 0,
    previousClose: Number(formData.get("previousClose")) || 0,
    currency: String(formData.get("currency")),
    fxRate: Number(formData.get("fxRate")) || 1,
    quoteSource: String(formData.get("quoteSource")),
    quoteDate: latestPriceField?.dataset.quoteDate || existingAsset?.quoteDate || "",
    quoteFetchedAt: latestPriceField?.dataset.quoteFetchedAt || existingAsset?.quoteFetchedAt || "",
    notes: String(formData.get("notes")).trim(),
    updatedAt: new Date().toISOString()
  };

  if (!asset.name || !asset.symbol || asset.quantity <= 0 || asset.costPrice < 0 || asset.fxRate <= 0) {
    showToast("请把名称、代码、数量、成本和汇率填写完整");
    return;
  }

  const compatibilityError = getSymbolCompatibilityError(asset.symbol, asset.quoteSource, asset.type, asset.platform);
  if (compatibilityError) {
    showToast(compatibilityError);
    validateAssetSymbolCompatibility();
    return;
  }

  const saved = await apiFetch("/api/assets", {
    method: "POST",
    body: JSON.stringify(asset)
  });
  await refreshPortfolioState({ renderAfter: false });
  resetForm();
  render();
  showToast(saved.asset ? "资产记录已保存" : "资产已保存");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = document.querySelector("#auth-username").value.trim();
  const password = document.querySelector("#auth-password").value;
  if (!username || !password) {
    showToast("请输入用户名和密码");
    return;
  }

  if (state.authMode === "register" && password.length < 8) {
    showToast("注册密码至少需要 8 位");
    return;
  }

  const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  const submitButton = document.querySelector("#auth-submit-button");
  submitButton.disabled = true;

  try {
    const response = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    state.user = response.user;
    authForm.reset();
    closeAuthModal();
    await loadServerData();
    showToast(state.authMode === "login" ? "登录成功" : "注册成功");
  } catch (error) {
    showToast(error.message || "登录失败");
  } finally {
    submitButton.disabled = false;
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  state.user = null;
  state.assets = [];
  state.accountBalances = [];
  state.transactions = [];
  state.weeklySummary = createEmptyWeeklySummary();
  state.accountOverviewCurrency = "CNY";
    state.settings = {
      finnhubKey: "",
      tushareToken: "",
      autoRefreshInterval: 0,
      lastSyncAt: "",
      canEdit: false
    };
  state.providerStatuses = null;
  updateAuthUI();
  lockAppForGuest();
  resetForm();
  resetTransactionForm();
  render();
  showToast("已退出登录");
}

async function handleAssetAction(event) {
  const { action, id } = event.currentTarget.dataset;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) {
    return;
  }

  if (action === "edit") {
    state.entryMode = "asset";
    fillForm(asset);
    switchView("entry");
    syncEntryWorkspace();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`正在编辑 ${asset.name}`);
    return;
  }

  if (!window.confirm(`确定删除 ${asset.name} 吗？`)) {
    return;
  }

  await apiFetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
  state.assets = state.assets.filter((item) => item.id !== id);
  await refreshWeeklySummary({ renderAfter: false });
  render();
  showToast(`已删除 ${asset.name}`);
}

async function clearAssets() {
  if (!ensureLoggedIn()) {
    return;
  }
  if (!state.assets.length && !state.transactions.length && !state.accountBalances.length) {
    showToast("当前没有可清理的数据");
    return;
  }
  if (!window.confirm("确定要清空全部记录、资产和账户资金吗？")) {
    return;
  }
  await apiFetch("/api/records", { method: "DELETE" });
  state.assets = [];
  state.transactions = [];
  state.accountBalances = [];
  state.weeklySummary = createEmptyWeeklySummary();
  render();
  showToast("全部记录已清空");
}

function exportAssets() {
  if (!ensureLoggedIn()) {
    return;
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    assets: state.assets,
    accountBalances: state.accountBalances
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  anchor.href = url;
  anchor.download = `wealthtrack-assets-${timestamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("资产明细已导出");
}

async function handleImportAssets(event) {
  if (!ensureLoggedIn()) {
    event.target.value = "";
    return;
  }

  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const content = await file.text();
    const payload = JSON.parse(content);
    const assets = Array.isArray(payload) ? payload : payload.assets;
    const accountBalances = Array.isArray(payload?.accountBalances) ? payload.accountBalances : [];
    if (!Array.isArray(assets) || !assets.length) {
      throw new Error("导入文件里没有可用的资产数据");
    }
    const normalizedAssets = assets.map((rawAsset) => normalizeImportedAsset(rawAsset));
    const normalizedAccountBalances = accountBalances.map((item) => normalizeImportedAccountBalance(item));

    const shouldReplace = window.confirm("是否先清空当前资产，再导入文件中的资产？点击“取消”则直接合并导入。");
    if (shouldReplace) {
      await apiFetch("/api/records", { method: "DELETE" });
      state.assets = [];
      state.transactions = [];
      state.accountBalances = [];
    }

    let importedCount = 0;
    for (const asset of normalizedAssets) {
      await apiFetch("/api/assets", {
        method: "POST",
        body: JSON.stringify(asset)
      });
      const existingIndex = state.assets.findIndex((item) => item.id === asset.id);
      if (existingIndex >= 0) {
        state.assets[existingIndex] = asset;
      } else {
        state.assets.unshift(asset);
      }
      importedCount += 1;
    }

    for (const accountBalance of normalizedAccountBalances) {
      const response = await apiFetch("/api/account-balances", {
        method: "PUT",
        body: JSON.stringify(accountBalance)
      });
      const nextItem = response.accountBalance;
      const existingIndex = state.accountBalances.findIndex((item) => item.platform === nextItem.platform);
      if (existingIndex >= 0) {
        state.accountBalances[existingIndex] = nextItem;
      } else {
        state.accountBalances.push(nextItem);
      }
    }

    await refreshPortfolioState({ renderAfter: false });
    render();
    showToast(`已导入 ${importedCount} 条资产`);
  } catch (error) {
    showToast(error.message || "导入资产失败");
  } finally {
    event.target.value = "";
  }
}

function normalizeImportedAsset(rawAsset) {
  if (!rawAsset || typeof rawAsset !== "object") {
    throw new Error("导入文件格式不正确");
  }

  const platform = String(rawAsset.platform || "other");
  const type = String(rawAsset.type || "fund");
  const quoteSource = String(rawAsset.quoteSource || getPreferredQuoteSource(type, platform));
  const symbol = normalizeAssetSymbol(String(rawAsset.symbol || ""), type, platform);

  if (!rawAsset.name || !symbol) {
    throw new Error("导入文件中存在缺少名称或代码的资产");
  }

  return {
    id: String(rawAsset.id || crypto.randomUUID()),
    name: String(rawAsset.name).trim(),
    platform,
    type,
    symbol,
    quantity: Number(rawAsset.quantity) || 0,
    costPrice: Number(rawAsset.costPrice) || 0,
    currentPrice: Number(rawAsset.currentPrice) || 0,
    previousClose: Number(rawAsset.previousClose) || 0,
    currency: String(rawAsset.currency || "CNY"),
    fxRate: Number(rawAsset.fxRate) || 1,
    quoteSource,
    quoteDate: String(rawAsset.quoteDate || "").trim(),
    quoteFetchedAt: String(rawAsset.quoteFetchedAt || "").trim(),
    notes: String(rawAsset.notes || "").trim(),
    updatedAt: rawAsset.updatedAt || new Date().toISOString()
  };
}

function normalizeImportedAccountBalance(rawBalance) {
  if (!rawBalance || typeof rawBalance !== "object") {
    throw new Error("导入文件中的账户自由资金格式不正确");
  }
  return {
    platform: String(rawBalance.platform || "other"),
    freeCash: Number(rawBalance.freeCash) || 0,
    displayCurrency: String(rawBalance.displayCurrency || getDefaultAccountDisplayCurrency(String(rawBalance.platform || "other"))),
    updatedAt: rawBalance.updatedAt || new Date().toISOString()
  };
}

async function saveSettings() {
  if (!ensureLoggedIn()) {
    return;
  }
  if (!state.settings.canEdit) {
    showToast("只有管理员可以修改行情设置");
    return;
  }

  state.settings.finnhubKey = document.querySelector("#alpha-vantage-key").value.trim();
  state.settings.tushareToken = document.querySelector("#tushare-token").value.trim();

  await apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify(state.settings)
  });

  await refreshProviderStatuses({ silent: true });
  setupAutoRefresh();
  showToast("设置已保存");
}

function handleAutoRefreshIntervalChange(event) {
  const nextInterval = Number(event.target.value) || 300;
  state.settings.autoRefreshInterval = nextInterval;
  setupAutoRefresh();
  syncAutoRefreshControl();
  showToast(`自动刷新已切换为 ${getAutoRefreshLabel(nextInterval)}`);
}

function cycleAutoRefreshInterval() {
  const intervals = [60, 180, 300, 600];
  const current = Number(state.settings.autoRefreshInterval) || 300;
  const currentIndex = intervals.indexOf(current);
  const nextInterval = intervals[(currentIndex + 1 + intervals.length) % intervals.length];
  state.settings.autoRefreshInterval = nextInterval;
  setupAutoRefresh();
  syncAutoRefreshControl();
  showToast(`自动刷新已切换为 ${getAutoRefreshLabel(nextInterval)}`);
}

async function refreshAllPrices(options = {}) {
  const { silent = false, suppressEmptyToast = false } = options;
  if (!ensureLoggedIn()) {
    return;
  }
  if (state.isRefreshingPrices) {
    return;
  }
  if (!state.assets.length) {
    if (suppressEmptyToast) {
      return;
    }
    showToast("请先录入资产");
    return;
  }

  state.isRefreshingPrices = true;

  let successCount = 0;
  let failureCount = 0;

  try {
    await refreshExchangeRates({ silent: true, persist: false });
  } catch (error) {
    console.error("FX refresh failed", error);
  }

  try {
    const response = await apiFetch("/api/quotes/refresh", {
      method: "POST",
      body: JSON.stringify({ assets: state.assets })
    });
    state.assets = response.assets || state.assets;
    successCount = Number(response.successCount) || 0;
    failureCount = Number(response.failureCount) || 0;
  } catch (error) {
    console.error("Failed to refresh assets in batch", error);
    failureCount = state.assets.length;
  }

  await refreshWeeklySummary({ renderAfter: false });
  updateLastSyncLabel(state.settings.lastSyncAt);
  render();

  if (silent) {
    return;
  }

  if (successCount && !failureCount) {
    showToast(`已刷新 ${successCount} 项价格`);
  } else if (successCount) {
    showToast(`刷新完成：成功 ${successCount} 项，失败 ${failureCount} 项`);
  } else {
    showToast("没有成功获取到价格，请检查代码格式、API Key 或 Tushare Token");
  }
}

async function refreshExchangeRates(options = {}) {
  const { silent = false, persist = true } = options;
  const currencies = [...new Set(state.assets.map((asset) => asset.currency).filter((currency) => currency && currency !== "CNY"))];
  if (!currencies.length) {
    return;
  }

  const rates = await fetchCnyRates(currencies);
  Object.entries(rates).forEach(([currency, rate]) => {
    state.displayFxRates[currency] = rate;
  });
  let changed = false;
  for (const asset of state.assets) {
    if (!asset.currency || asset.currency === "CNY") {
      asset.fxRate = 1;
      continue;
    }
    if (rates[asset.currency]) {
      asset.fxRate = rates[asset.currency];
      changed = true;
    }
  }

  if (persist && changed && state.user) {
    for (const asset of state.assets) {
      await apiFetch("/api/assets", {
        method: "POST",
        body: JSON.stringify(asset)
      });
    }
  }

  if (!silent) {
    showToast("实时汇率已更新");
  }
}

async function fetchCnyRates(currencies) {
  if (!ensureLoggedIn()) {
    return {};
  }
  const response = await apiFetch(`/api/fx/rates?currencies=${encodeURIComponent(currencies.join(","))}`);
  return response.rates || {};
}

async function ensureFxRateCached(currency) {
  const code = String(currency || "").toUpperCase();
  if (!code || code === "CNY") {
    return;
  }
  if (state.displayFxRates[code]) {
    return;
  }
  const rates = await fetchCnyRates([code]);
  if (rates[code]) {
    state.displayFxRates[code] = rates[code];
  }
}

async function ensureDisplayCurrencyRate() {
  if (state.displayCurrency !== "USD") {
    return;
  }
  await ensureFxRateCached("USD");
}

async function handleDisplayCurrencyChange(event) {
  state.displayCurrency = event.target.value;
  const compactSelect = document.querySelector("#display-currency-compact-toggle");
  if (state.displayCurrency === "USD") {
    try {
      await ensureDisplayCurrencyRate();
    } catch (error) {
      showToast(error.message || "获取美元汇率失败");
      state.displayCurrency = "CNY";
      event.target.value = "CNY";
      if (compactSelect) {
        compactSelect.dataset.currency = "CNY";
      }
    }
  }
  render();
}

async function autoFillLatestPrice() {
  const hintElement = document.querySelector("#asset-price-autofill-hint");
  const source = document.querySelector("#asset-source").value;
  const type = document.querySelector("#asset-type").value;
  const platform = document.querySelector("#asset-platform").value;
  const currency = document.querySelector("#asset-currency").value;
  const rawSymbol = document.querySelector("#asset-symbol").value.trim().toUpperCase();
  const priceField = document.querySelector("#asset-price");
  const prevCloseField = document.querySelector("#asset-prev-close");

  if (!hintElement) {
    return;
  }

  if (!state.user || !rawSymbol || source === "manual" || type === "cash" || type === "liability") {
    hintElement.classList.add("hidden");
    hintElement.textContent = "";
    return;
  }

  const compatibilityError = getSymbolCompatibilityError(rawSymbol, source, type, platform);
  if (compatibilityError) {
    hintElement.classList.add("hidden");
    hintElement.textContent = "";
    return;
  }

  const payload = {
    id: document.querySelector("#asset-id").value || crypto.randomUUID(),
    name: document.querySelector("#asset-name").value.trim() || rawSymbol,
    platform,
    type,
    symbol: normalizeAssetSymbol(rawSymbol, type, platform),
    quantity: Number(document.querySelector("#asset-quantity").value) || 1,
    costPrice: Number(document.querySelector("#asset-cost").value) || 0,
    currentPrice: Number(priceField.value) || 0,
    previousClose: Number(prevCloseField.value) || 0,
    currency: document.querySelector("#asset-currency").value,
    fxRate: Number(document.querySelector("#asset-fx-rate").value) || 1,
    quoteSource: source,
    quoteDate: priceField.dataset.quoteDate || "",
    quoteFetchedAt: priceField.dataset.quoteFetchedAt || "",
    notes: document.querySelector("#asset-notes").value.trim(),
    updatedAt: new Date().toISOString()
  };

  hintElement.classList.remove("hidden", "field-hint-error");
  hintElement.textContent = "正在自动获取最新单价...";

  try {
    const response = await apiFetch("/api/quotes/resolve", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const quote = response.quote || {};
    if (Number.isFinite(quote.currentPrice)) {
      priceField.value = String(quote.currentPrice);
    }
    if (Number.isFinite(quote.previousClose)) {
      prevCloseField.value = String(quote.previousClose);
    }
    priceField.dataset.quoteDate = quote.quoteDate || "";
    priceField.dataset.quoteFetchedAt = quote.quoteFetchedAt || "";
    hintElement.textContent = `已自动获取最新单价：${formatUnitPrice(quote.currentPrice, source, currency)}`;
  } catch (error) {
    hintElement.classList.add("field-hint-error");
    hintElement.textContent = error.message || "自动获取单价失败";
  }
}

function fillForm(asset) {
  document.querySelector("#asset-id").value = asset.id;
  document.querySelector("#asset-name").value = asset.name;
  document.querySelector("#asset-platform").value = asset.platform || "other";
  document.querySelector("#asset-source-select").value = asset.quoteSource || getPreferredQuoteSource(asset.type, asset.platform);
  document.querySelector("#asset-type").value = asset.type;
  document.querySelector("#asset-region").value = inferAssetRegion(asset.platform, asset.type, asset.currency);
  document.querySelector("#asset-symbol").value = asset.symbol;
  document.querySelector("#asset-quantity").value = asset.quantity;
  document.querySelector("#asset-cost").value = asset.costPrice;
  document.querySelector("#asset-price").value = asset.currentPrice || "";
  document.querySelector("#asset-price").dataset.quoteDate = asset.quoteDate || "";
  document.querySelector("#asset-price").dataset.quoteFetchedAt = asset.quoteFetchedAt || "";
  document.querySelector("#asset-prev-close").value = asset.previousClose || "";
  document.querySelector("#asset-currency").value = asset.currency;
  document.querySelector("#asset-fx-rate").value = asset.fxRate;
  document.querySelector("#asset-notes").value = asset.notes || "";
  state.regionTouched = true;
  syncFormByContext();
  updateSymbolHint();
  validateAssetSymbolCompatibility();
}

function resetForm() {
  form.reset();
  document.querySelector("#asset-id").value = "";
  document.querySelector("#asset-price").dataset.quoteDate = "";
  document.querySelector("#asset-price").dataset.quoteFetchedAt = "";
  document.querySelector("#asset-platform").value = "alipay";
  document.querySelector("#asset-source-select").value = "fund_eastmoney";
  document.querySelector("#asset-type").value = "fund";
  document.querySelector("#asset-region").value = "domestic";
  state.regionTouched = false;
  syncFormByContext();
  updateSymbolHint();
  validateAssetSymbolCompatibility();
}

function getPreferredQuoteSource(type, platform) {
  if (type === "cash" || type === "liability") {
    return "manual";
  }
  if (type === "fund" && (platform === "alipay" || platform === "southfund")) {
    return "fund_eastmoney";
  }
  if (type === "crypto" || platform === "okx") {
    return "binance";
  }
  if (platform === "ibkr" || platform === "schwab") {
    return "finnhub";
  }
  if (platform === "alipay" || platform === "southfund" || platform === "tonghuashun") {
    return "tushare";
  }
  return "tushare";
}

function inferAssetRegion(platform, type, currency = "") {
  if (currency === "USD") {
    return "overseas";
  }
  if (type === "crypto" || platform === "okx" || platform === "ibkr" || platform === "schwab") {
    return "overseas";
  }
  return "domestic";
}

function syncFormByContext() {
  const type = document.querySelector("#asset-type").value;
  const platform = document.querySelector("#asset-platform").value;
  const regionField = document.querySelector("#asset-region");
  const currencyField = document.querySelector("#asset-currency");
  const fxField = document.querySelector("#asset-fx-rate");
  const quantityField = document.querySelector("#asset-quantity");
  const costField = document.querySelector("#asset-cost");
  const priceField = document.querySelector("#asset-price");
  const sourceField = document.querySelector("#asset-source");
  const sourceRow = document.querySelector("#asset-source-row");
  const sourceSelect = document.querySelector("#asset-source-select");
  const symbolField = document.querySelector("#asset-symbol");
  const priceLabel = document.querySelector("#asset-price-label");
  const recommendedSource = getPreferredQuoteSource(type, platform);
  const inferredRegion = inferAssetRegion(platform, type);
  const isCustomPlatform = platform === "other";
  if (sourceRow && sourceSelect) {
    sourceRow.classList.toggle("hidden", !isCustomPlatform);
    if (!isCustomPlatform) {
      sourceSelect.value = recommendedSource;
    }
  }
  sourceField.value = isCustomPlatform && sourceSelect ? sourceSelect.value : recommendedSource;
  if (!state.regionTouched || !regionField.value) {
    regionField.value = inferredRegion;
  }
  applyRegionSelection(regionField.value);
  if (priceLabel) {
    priceLabel.textContent = `最新单价（${getPriceUnitLabel(sourceField.value, currencyField.value)}）`;
  }

  if (type === "cash" || type === "liability") {
    quantityField.value = quantityField.value || "1";
    quantityField.readOnly = true;
    costField.placeholder = "填写总金额";
    priceField.placeholder = "填写当前金额";
    symbolField.placeholder = type === "cash" ? "CASH" : "DEBT";
    fxField.value = currencyField.value === "USD" ? fxField.value || "1" : "1";
    return;
  }

  quantityField.readOnly = false;
  costField.placeholder = "0";
  priceField.placeholder = "输入代码后自动获取，也可手动录入";

  if (platform === "alipay" || platform === "southfund") {
    symbolField.placeholder = "例如：000001.OF";
  } else if (platform === "tonghuashun") {
    symbolField.placeholder = "例如：600519.SH / 159915.SZ";
  } else if (platform === "ibkr" || platform === "schwab") {
    symbolField.placeholder = "例如：AAPL / MSFT";
  } else if (platform === "okx") {
    symbolField.placeholder = "例如：BTCUSDT";
  } else {
    symbolField.placeholder = "AAPL / 600519.SH / 000001.OF / BTCUSDT";
  }

  updateSymbolHint();
  validateAssetSymbolCompatibility();
}

function validateAssetSymbolCompatibility() {
  const symbol = document.querySelector("#asset-symbol").value.trim().toUpperCase();
  const source = document.querySelector("#asset-source").value;
  const type = document.querySelector("#asset-type").value;
  const platform = document.querySelector("#asset-platform").value;
  const validationElement = document.querySelector("#asset-symbol-validation");
  if (!validationElement) {
    return;
  }

  const message = getSymbolCompatibilityError(symbol, source, type, platform);
  if (!message) {
    validationElement.classList.add("hidden");
    validationElement.textContent = "";
    return;
  }

  validationElement.classList.remove("hidden");
  validationElement.textContent = message;
}

function getSymbolCompatibilityError(symbol, source, type, platform) {
  const normalized = normalizeAssetSymbol(symbol, type, platform);
  if (!normalized) {
    return "";
  }

  if (source === "binance" && !/^[A-Z0-9]{5,20}$/.test(normalized)) {
    return "当前选择 Binance，但代码不像加密货币交易对，建议使用类似 BTCUSDT 的格式。";
  }

  if (source === "finnhub" && (normalized.endsWith(".OF") || /^[0-9]{6}\.(SH|SZ)$/.test(normalized))) {
    return "当前选择 Finnhub，但代码看起来像中国基金或 A 股代码，建议改用 Tushare。";
  }

  if (source === "tushare") {
    if ((platform === "alipay" || platform === "southfund") && type === "fund" && !/^[0-9]{6}\.OF$/.test(normalized)) {
      return "当前选择 Tushare，场外基金建议使用类似 000001.OF 的基金代码。";
    }

    if ((platform === "tonghuashun" || type === "stock") && /^[A-Z]{1,10}$/.test(normalized) && !normalized.endsWith(".OF")) {
      return "当前选择 Tushare，但代码看起来像美股代码，A 股 / ETF 建议使用类似 600519.SH、159915.SZ。";
    }
  }

  if (source === "manual") {
    return "";
  }

  return "";
}

function normalizeAssetSymbol(symbol, type, platform) {
  const cleaned = String(symbol || "").trim().toUpperCase();
  if (!cleaned) {
    return "";
  }

  if (cleaned.includes(".")) {
    return cleaned;
  }

  if (type === "cash") {
    return "CASH";
  }

  if (type === "liability") {
    return "DEBT";
  }

  if (type === "crypto" || platform === "okx") {
    return cleaned;
  }

  if ((platform === "ibkr" || platform === "schwab") && /^[A-Z]+$/.test(cleaned)) {
    return cleaned;
  }

  if (type === "fund" && /^\d{6}$/.test(cleaned)) {
    return `${cleaned}.OF`;
  }

  if ((platform === "tonghuashun" || platform === "other") && /^\d{6}$/.test(cleaned)) {
    if (cleaned.startsWith("5") || cleaned.startsWith("6") || cleaned.startsWith("9")) {
      return `${cleaned}.SH`;
    }
    return `${cleaned}.SZ`;
  }

  return cleaned;
}

function getSymbolHint(symbol, type, platform) {
  const cleaned = String(symbol || "").trim().toUpperCase();
  if (!cleaned) {
    if (platform === "alipay" || platform === "southfund") {
      return "场外基金建议填写基金代码，例如 `000001.OF`。";
    }
    if (platform === "tonghuashun") {
      return "A 股 / ETF 建议填写完整交易所后缀，例如 `600519.SH`、`159915.SZ`。";
    }
    if (platform === "ibkr" || platform === "schwab") {
      return "美股通常直接填写股票代码，例如 `AAPL`、`MSFT`。";
    }
    if (platform === "okx" || type === "crypto") {
      return "加密货币建议填写交易对代码，例如 `BTCUSDT`。";
    }
    return "代码会根据平台和资产类型自动规范化，例如 `600519` 会转成 `600519.SH`。";
  }

  const normalized = normalizeAssetSymbol(cleaned, type, platform);
  if (normalized === cleaned) {
    return `当前代码将按 \`${normalized}\` 保存。`;
  }
  return `当前输入 \`${cleaned}\`，保存时将自动规范化为 \`${normalized}\`。`;
}

function updateSymbolHint() {
  const symbol = document.querySelector("#asset-symbol").value;
  const type = document.querySelector("#asset-type").value;
  const platform = document.querySelector("#asset-platform").value;
  document.querySelector("#asset-symbol-hint").innerHTML = getSymbolHint(symbol, type, platform);
}

async function applyRegionSelection(region) {
  const currencyField = document.querySelector("#asset-currency");
  const fxField = document.querySelector("#asset-fx-rate");
  const currency = region === "overseas" ? "USD" : "CNY";
  currencyField.value = currency;
  if (currency === "CNY") {
    fxField.value = "1";
    updatePriceUnitLabel();
    return;
  }
  try {
    const rates = await fetchCnyRates([currency]);
    if (rates[currency]) {
      fxField.value = String(rates[currency]);
      state.displayFxRates[currency] = rates[currency];
    }
  } catch (error) {
    console.error(error);
    fxField.value = "1";
  }
  updatePriceUnitLabel();
}

async function handleRegionFieldChange(event) {
  state.regionTouched = true;
  await applyRegionSelection(event.target.value);
  await autoFillLatestPrice();
}

function getPriceUnitLabel(source, currency) {
  if (source === "binance") {
    return "USDT";
  }
  return currency || "CNY";
}

function updatePriceUnitLabel() {
  const priceLabel = document.querySelector("#asset-price-label");
  if (!priceLabel) {
    return;
  }
  const source = document.querySelector("#asset-source").value;
  const currency = document.querySelector("#asset-currency").value;
  priceLabel.textContent = `最新单价（${getPriceUnitLabel(source, currency)}）`;
}

function formatUnitPrice(value, source, currency) {
  const unit = getPriceUnitLabel(source, currency);
  return `${formatNumber(Number(value) || 0)} ${unit}`;
}

function hydrateSettings() {
  document.querySelector("#alpha-vantage-key").value = state.settings.finnhubKey || "";
  document.querySelector("#tushare-token").value = state.settings.tushareToken || "";
  state.settings.autoRefreshInterval = 300;
  document.querySelector("#display-currency").value = state.displayCurrency;
  syncAutoRefreshControl();
  updateLastSyncLabel();
  renderProviderStatusLoading();
  syncSettingsAccess();
}

function syncSettingsAccess() {
  const canEdit = !!state.settings.canEdit;
  ["#alpha-vantage-key", "#tushare-token", "#save-settings-button"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) {
      element.disabled = !canEdit;
    }
  });

  let hint = document.querySelector("#settings-access-hint");
  if (!hint) {
    const actions = document.querySelector("#save-settings-button")?.closest(".form-actions");
    if (actions) {
      hint = document.createElement("p");
      hint.id = "settings-access-hint";
      hint.className = "settings-tip";
      actions.insertAdjacentElement("afterend", hint);
    }
  }
  if (hint) {
    hint.classList.add("settings-tip-warning");
    hint.style.color = "#a73d3d";
    hint.style.fontWeight = "600";
    hint.textContent = canEdit
      ? "当前为管理员账号，可以编辑行情配置。"
      : "当前为普通账号，非 admin 账户不能修改行情配置，只能查看。";
  }
}

function syncAutoRefreshControl() {
  const autoRefreshCompact = document.querySelector("#auto-refresh-compact");
  if (autoRefreshCompact) {
    autoRefreshCompact.value = String(state.settings.autoRefreshInterval || 300);
  }
  const autoRefreshSidebar = document.querySelector("#auto-refresh-sidebar");
  if (autoRefreshSidebar) {
    autoRefreshSidebar.value = String(state.settings.autoRefreshInterval || 300);
  }
  const autoRefreshCycle = document.querySelector("#auto-refresh-cycle");
  if (autoRefreshCycle) {
    const label = getAutoRefreshLabel(state.settings.autoRefreshInterval || 300);
    autoRefreshCycle.textContent = label;
    autoRefreshCycle.setAttribute("aria-label", `自动刷新间隔，当前 ${label}，点击切换`);
    autoRefreshCycle.title = `自动刷新间隔：${label}`;
  }
  const autoRefreshCyclePrimary = document.querySelector("#auto-refresh-cycle-primary");
  if (autoRefreshCyclePrimary) {
    const label = getAutoRefreshLabel(state.settings.autoRefreshInterval || 300);
    autoRefreshCyclePrimary.textContent = label;
    autoRefreshCyclePrimary.setAttribute("aria-label", `自动刷新间隔，当前 ${label}，点击切换`);
    autoRefreshCyclePrimary.title = `自动刷新间隔：${label}`;
  }
}

function getAutoRefreshLabel(intervalSeconds) {
  const intervalMap = {
    60: "1分钟",
    180: "3分钟",
    300: "5分钟",
    600: "10分钟"
  };
  return intervalMap[intervalSeconds] || "5分钟";
}

function setupAutoRefresh() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  if (!state.user || !state.settings.autoRefreshInterval) {
    return;
  }
  state.timerId = window.setInterval(() => {
    refreshAllPrices();
  }, state.settings.autoRefreshInterval * 1000);
}

function handleFilterChange(event) {
  state.filters.type = event.target.value;
  render();
}

function clearFilters() {
  state.filters.type = "all";
  document.querySelector("#asset-type-filter").value = "all";
  render();
}

function getFilteredAssets() {
  if (state.filters.type === "all") {
    return state.assets;
  }
  return state.assets.filter((asset) => asset.type === state.filters.type);
}

function getCurrentValue(asset) {
  const value = asset.quantity * (asset.currentPrice || 0) * (asset.fxRate || 1);
  return asset.type === "liability" ? -Math.abs(value) : value;
}

function getCostValue(asset) {
  const value = asset.quantity * asset.costPrice * (asset.fxRate || 1);
  return asset.type === "liability" ? -Math.abs(value) : value;
}

function getDailyProfit(asset) {
  if (asset.type === "cash" || asset.type === "liability") {
    return 0;
  }
  if (!shouldCountAssetForDailyProfit(asset)) {
    return 0;
  }
  return getQuoteProfitValue(asset);
}

function getQuoteProfitValue(asset) {
  if (asset.type === "cash" || asset.type === "liability") {
    return 0;
  }
  if (!asset.previousClose || !asset.currentPrice) {
    return 0;
  }
  return asset.quantity * (asset.currentPrice - asset.previousClose) * (asset.fxRate || 1);
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

function isUsEquityPlatform(platform) {
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
  if (isWeekend) {
    return { label: "休市", badgeClass: "freshness-badge--yesterday", zeroProfit: true };
  }
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) {
    return { label: "盘前", badgeClass: "freshness-badge--mixed", zeroProfit: true };
  }
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
    return { label: "盘中", badgeClass: "freshness-badge--today", zeroProfit: false };
  }
  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) {
    return { label: "盘后", badgeClass: "freshness-badge--mixed", zeroProfit: false };
  }
  return { label: "夜盘", badgeClass: "freshness-badge--yesterday", zeroProfit: true };
}

function shouldCountAssetForDailyProfit(asset) {
  if (!isAssetQuoteCurrent(asset)) {
    return false;
  }
  if (!isUsEquityPlatform(asset?.platform)) {
    return true;
  }
  const session = getUsMarketSessionInfo();
  return session.label === "盘中" || session.label === "盘后";
}

function normalizeQuoteDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    return "";
  }
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addDaysToDateString(dateText, days) {
  const normalized = normalizeQuoteDate(dateText);
  if (!normalized) {
    return "";
  }
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = String(date.getUTCFullYear());
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getAssetQuoteLagToleranceDays(asset) {
  return asset?.type === "fund" ? 1 : 0;
}

function getBeijingDateString(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
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

function getEffectiveQuoteDate(asset) {
  const normalized = normalizeQuoteDate(asset?.quoteDate);
  if (!normalized) {
    return "";
  }
  const platform = String(asset?.platform || "").toLowerCase();
  const quoteSource = String(asset?.quoteSource || "").toLowerCase();
  if (!["ibkr", "schwab"].includes(platform) || quoteSource !== "finnhub") {
    return normalized;
  }
  const updatedDate = getBeijingDateString(asset?.updatedAt);
  if (updatedDate && addDaysToDateString(normalized, 1) === updatedDate) {
    return updatedDate;
  }
  return normalized;
}

function isAssetQuoteToday(asset) {
  return getEffectiveQuoteDate(asset) === getTodayDateString();
}

function isAssetQuoteCurrent(asset) {
  const quoteDate = getEffectiveQuoteDate(asset);
  if (!quoteDate) {
    return false;
  }
  const toleranceDays = getAssetQuoteLagToleranceDays(asset);
  const earliestValidDate = addDaysToDateString(getTodayDateString(), -toleranceDays);
  return Boolean(earliestValidDate) && quoteDate >= earliestValidDate;
}

function getAssetQuoteDateText(asset) {
  const normalized = getEffectiveQuoteDate(asset);
  return normalized || "未知日期";
}

function getLatestAssetQuoteFetchedAt() {
  let latest = "";
  for (const asset of state.assets) {
    const fetchedAt = String(asset?.quoteFetchedAt || "").trim();
    if (fetchedAt && (!latest || fetchedAt > latest)) {
      latest = fetchedAt;
    }
  }
  return latest;
}

function getLatestAssetQuoteDate() {
  let latest = "";
  for (const asset of state.assets) {
    const quoteDate = getEffectiveQuoteDate(asset);
    if (quoteDate && (!latest || quoteDate > latest)) {
      latest = quoteDate;
    }
  }
  return latest;
}

function handleAuthModeChange(event) {
  state.authMode = event.currentTarget.dataset.authMode;
  syncAuthModeUI();
}

function handleOpenAuthModal(event) {
  const mode = event.currentTarget.dataset.openAuthModal;
  if (mode) {
    state.authMode = mode;
  }
  syncAuthModeUI();
  document.querySelector("#auth-modal").classList.remove("hidden");
}

function syncAuthModeUI() {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("is-auth-active", button.dataset.authMode === state.authMode);
  });
  document.querySelector("#auth-submit-button").textContent = state.authMode === "login" ? "登录" : "注册";
  document.querySelector("#auth-title").textContent = state.authMode === "login" ? "登录账户" : "创建账户";
}

function closeAuthModal() {
  document.querySelector("#auth-modal").classList.add("hidden");
}

function handleViewChange(event) {
  switchView(event.currentTarget.dataset.viewTarget);
}

function switchView(view) {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
  document.querySelectorAll("[data-view]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.view === view);
  });
}

function updateAuthUI() {
  const guest = document.querySelector("#auth-guest");
  const user = document.querySelector("#auth-user");
  const accountGuest = document.querySelector("#account-view-guest");
  const accountUser = document.querySelector("#account-view-user");
  const banner = document.querySelector("#auth-required-banner");
  if (state.user) {
    guest.classList.add("hidden");
    user.classList.remove("hidden");
    if (accountGuest) {
      accountGuest.classList.add("hidden");
    }
    if (accountUser) {
      accountUser.classList.remove("hidden");
    }
    banner.classList.add("hidden");
    document.querySelector("#current-username").textContent = state.user.username;
    document.querySelectorAll(".current-username").forEach((element) => {
      element.textContent = state.user.username;
    });
  } else {
    guest.classList.remove("hidden");
    user.classList.add("hidden");
    if (accountGuest) {
      accountGuest.classList.remove("hidden");
    }
    if (accountUser) {
      accountUser.classList.add("hidden");
    }
    banner.classList.remove("hidden");
    document.querySelector("#current-username").textContent = "-";
    document.querySelectorAll(".current-username").forEach((element) => {
      element.textContent = "-";
    });
    state.settings.canEdit = false;
  }
  syncSettingsAccess();
}

async function refreshProviderStatuses(options = {}) {
  const { silent = false, force = false } = options;
  if (!state.user) {
    return;
  }

  try {
    renderProviderStatusLoading();
    const response = await apiFetch(`/api/providers/status${force ? "?force=1" : ""}`);
    state.providerStatuses = response.providers;
    renderProviderStatuses(response.providers);
    if (!silent) {
      showToast("接口状态已刷新");
    }
  } catch (error) {
    if (!silent) {
      showToast(error.message || "接口状态检查失败");
    }
  }
}

function renderProviderStatuses(providers) {
  const container = document.querySelector("#provider-status-grid");
  const items = [
    ["finnhub", "Finnhub", providers.finnhub],
    ["tushareRealtime", "Tushare 实时", providers.tushareRealtime],
    ["tushareFund", "Tushare 基金", providers.tushareFund],
    ["binance", "Binance", providers.binance],
    ["fx", "汇率接口", providers.fx]
  ];

  container.innerHTML = items
    .map(([key, label, provider]) => `
      <article class="provider-card ${state.selectedProvider === key ? "is-selected" : ""}" data-provider-card="${key}">
        <div class="provider-card__head">
          <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
          <strong>${escapeHtml(label)}</strong>
          ${provider?.source ? `<span class="provider-card__meta">${escapeHtml(getProviderSourceLabel(provider.source))}</span>` : ""}
        </div>
        <p>${escapeHtml(provider?.message || "未检查")}</p>
        <small>${formatProviderCheckedAt(provider?.checkedAt)}</small>
      </article>
    `)
    .join("");

  container.querySelectorAll("[data-provider-card]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedProvider = card.dataset.providerCard;
      renderProviderStatuses(state.providerStatuses || providers);
      renderProviderDetail();
    });
  });

  renderProviderDetail();
}

function renderDashboardRiskBanner() {
  const banner = document.querySelector("#dashboard-risk-banner");
  if (!banner) {
    return;
  }

  const warnings = getActiveProviderWarnings();
  if (!warnings.length) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }

  banner.classList.remove("hidden");
  banner.textContent = `当前部分资产行情异常，收益可能不准确：${warnings.join("；")}`;
}

function renderProviderDetail() {
  const title = document.querySelector("#provider-detail-title");
  const description = document.querySelector("#provider-detail-description");
  const statusLine = document.querySelector("#provider-detail-status-line");
  const links = document.querySelector("#provider-detail-links");
  const alphaConfig = document.querySelector("#alpha-vantage-config");
  const tushareConfig = document.querySelector("#tushare-config");

  if (!title || !description || !statusLine || !links || !alphaConfig || !tushareConfig) {
    return;
  }

  const detail = getSelectedProviderDetail();
  title.textContent = detail.title;
  description.textContent = detail.description;
  statusLine.innerHTML = `
    <span class="status-dot ${getProviderStatusClass(detail.status.status)}"></span>
    <span>${escapeHtml(detail.status.message || "未检查")}</span>
    ${detail.status.source ? `<span class="provider-card__meta">${escapeHtml(getProviderSourceLabel(detail.status.source))}</span>` : ""}
  `;
  links.innerHTML = (detail.links || [])
    .map((link) => `<a class="ghost-button" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");

  alphaConfig.classList.toggle("hidden", !detail.showAlphaKey);
  tushareConfig.classList.toggle("hidden", !detail.showTushareToken);
}

function getProviderStatusClass(status) {
  if (status === "ok") {
    return "status-ok";
  }
  if (status === "warning") {
    return "status-warning";
  }
  return "status-error";
}

function renderSourceBadge(source) {
  const provider = getProviderStateBySource(source);
  return `
    <span class="source-badge">
      <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
      <span>${escapeHtml(getQuoteSourceLabel(source))}</span>
    </span>
  `;
}

function getProviderStateBySource(source) {
  if (!state.providerStatuses) {
    return null;
  }
  const map = {
    manual: { status: "ok", message: "手动价格" },
    tushare: state.providerStatuses.tushare,
    alpha_vantage: state.providerStatuses.alphaVantage,
    binance: state.providerStatuses.binance
  };
  return map[source] || null;
}

function getSelectedProviderDetail() {
  const providers = state.providerStatuses || {};
  const map = {
    alphaVantage: {
      title: "Alpha Vantage",
      description: "适合 IBKR、嘉信理财等美股和海外股票资产。这里配置 Alpha Vantage API Key。",
      links: [{ label: "获取 API Key", href: "https://www.alphavantage.co/support/#api-key" }],
      status: providers.alphaVantage || { status: "warning", message: "未检查" },
      showAlphaKey: true,
      showTushareToken: false
    },
    tushare: {
      title: "Tushare",
      description: "适合支付宝基金、同花顺 A 股和 ETF。中国资产建议优先使用这个数据源。",
      links: [{ label: "获取 Tushare Token", href: "https://tushare.pro/" }],
      status: providers.tushare || { status: "warning", message: "未检查" },
      showAlphaKey: false,
      showTushareToken: true
    },
    binance: {
      title: "Binance",
      description: "适合 BTC 等加密货币交易对。当前使用公共接口，不需要额外配置。",
      links: [{ label: "查看 Binance 行情文档", href: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" }],
      status: providers.binance || { status: "warning", message: "未检查" },
      showAlphaKey: false,
      showTushareToken: false
    },
    fx: {
      title: "汇率接口",
      description: "用于把 USD、HKD 等外币资产统一换算成 CNY。支持主接口和备用接口自动切换。",
      links: [],
      status: providers.fx || { status: "warning", message: "未检查" },
      showAlphaKey: false,
      showTushareToken: false
    }
  };
  return map[state.selectedProvider] || map.alphaVantage;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const usedSources = new Set(state.assets.map((asset) => asset.quoteSource));
  const warnings = [];

  if (usedSources.has("alpha_vantage")) {
    const status = state.providerStatuses.alphaVantage;
    if (status && status.status !== "ok") {
      warnings.push(`Alpha Vantage：${status.message}`);
    }
  }

  if (usedSources.has("tushare")) {
    const status = state.providerStatuses.tushare;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare：${status.message}`);
    }
  }

  if (usedSources.has("binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }

  const hasForeignCurrency = state.assets.some((asset) => asset.currency && asset.currency !== "CNY");
  if (hasForeignCurrency) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }

  return warnings;
}

function renderProviderStatuses(providers) {
  const container = document.querySelector("#provider-status-grid");
  const items = [
    ["alphaVantage", "Alpha Vantage", providers.alphaVantage],
    ["tushareRealtime", "Tushare 实时", providers.tushareRealtime],
    ["tushareFund", "Tushare 基金", providers.tushareFund],
    ["binance", "Binance", providers.binance],
    ["fx", "汇率接口", providers.fx]
  ];

  container.innerHTML = items
    .map(([key, label, provider]) => `
      <article class="provider-card ${state.selectedProvider === key ? "is-selected" : ""}" data-provider-card="${key}">
        <div class="provider-card__head">
          <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
          <strong>${escapeHtml(label)}</strong>
          ${provider?.source ? `<span class="provider-card__meta">${escapeHtml(getProviderSourceLabel(provider.source))}</span>` : ""}
        </div>
        <p>${escapeHtml(provider?.message || "未检查")}</p>
        <small>${formatProviderCheckedAt(provider?.checkedAt)}</small>
      </article>
    `)
    .join("");

  container.querySelectorAll("[data-provider-card]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedProvider = card.dataset.providerCard;
      renderProviderStatuses(state.providerStatuses || providers);
      renderProviderDetail();
    });
  });

  renderProviderDetail();
}

function renderDashboardRiskBanner() {
  const banner = document.querySelector("#dashboard-risk-banner");
  if (!banner) {
    return;
  }

  const warnings = getActiveProviderWarnings();
  if (!warnings.length) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }

  banner.classList.remove("hidden");
  banner.textContent = `当前部分资产行情异常，收益可能不准确：${warnings.join("；")}`;
}

function renderSourceBadge(asset) {
  const provider = getProviderStateByAsset(asset);
  return `
    <span class="source-badge">
      <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
      <span>${escapeHtml(getQuoteSourceLabel(asset.quoteSource))}</span>
    </span>
  `;
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "fund_eastmoney") {
    return state.providerStatuses.tushareFund;
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "alpha_vantage") {
    return state.providerStatuses.alphaVantage;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function getSelectedProviderDetail() {
  const providers = state.providerStatuses || {};
  const defaultStatus = { status: "warning", message: "未检查" };
  const map = {
    alphaVantage: {
      title: "Alpha Vantage",
      description: "用于 IBKR、嘉信理财等美股和海外股票。这里配置 Alpha Vantage API Key。",
      links: [{ label: "获取 API Key", href: "https://www.alphavantage.co/support/#api-key" }],
      status: providers.alphaVantage || defaultStatus,
      showAlphaKey: true,
      showTushareToken: false
    },
    tushareRealtime: {
      title: "Tushare 实时行情",
      description: "用于同花顺里的 A 股和 ETF 状态检查，只反映股票 / ETF 实时行情是否正常。",
      links: [{ label: "获取 Tushare Token", href: "https://tushare.pro/" }],
      status: providers.tushareRealtime || defaultStatus,
      showAlphaKey: false,
      showTushareToken: true
    },
    tushareFund: {
      title: "Tushare 基金净值",
      description: "用于支付宝基金净值状态检查，只反映基金净值接口是否有权限、是否可用。",
      links: [{ label: "获取 Tushare Token", href: "https://tushare.pro/" }],
      status: providers.tushareFund || defaultStatus,
      showAlphaKey: false,
      showTushareToken: true
    },
    binance: {
      title: "Binance",
      description: "用于 BTC 等加密货币交易对，当前使用公共接口，不需要额外配置。",
      links: [{ label: "查看 Binance 文档", href: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" }],
      status: providers.binance || defaultStatus,
      showAlphaKey: false,
      showTushareToken: false
    },
    fx: {
      title: "汇率接口",
      description: "用于把 USD、HKD 等外币资产统一换算成 CNY，支持主接口和备用接口自动切换。",
      links: [],
      status: providers.fx || defaultStatus,
      showAlphaKey: false,
      showTushareToken: false
    }
  };
  return map[state.selectedProvider] || map.alphaVantage;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  const hasAlphaVantage = state.assets.some((asset) => asset.quoteSource === "alpha_vantage");
  const hasTushareRealtime = state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund");
  const hasTushareFund = state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type === "fund");
  const hasBinance = state.assets.some((asset) => asset.quoteSource === "binance");
  const hasForeignCurrency = state.assets.some((asset) => asset.currency && asset.currency !== "CNY");

  if (hasAlphaVantage) {
    const status = state.providerStatuses.alphaVantage;
    if (status && status.status !== "ok") {
      warnings.push(`Alpha Vantage：${status.message}`);
    }
  }

  if (hasTushareRealtime) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }

  if (hasTushareFund) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 基金：${status.message}`);
    }
  }

  if (hasBinance) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }

  if (hasForeignCurrency) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }

  return warnings;
}

function formatProviderCheckedAt(value) {
  if (!value) {
    return "尚未检查";
  }
  return `检查时间：${new Date(value).toLocaleString("zh-CN")}`;
}

function getProviderSourceLabel(source) {
  const map = {
    primary: "主接口",
    fallback: "备用接口",
    unknown: "未知来源"
  };
  return map[source] || source;
}

updateLastSyncLabel = function updateLastSyncLabelFromQuotes() {
  const latestQuoteFetchedAt = getLatestAssetQuoteFetchedAt();
  const formattedFetchedAt = formatPreciseDateTime(latestQuoteFetchedAt);
  if (formattedFetchedAt) {
    setText("#last-sync-label", formattedFetchedAt);
    return;
  }
  const latestQuoteDate = getLatestAssetQuoteDate();
  if (latestQuoteDate) {
    setText("#last-sync-label", latestQuoteDate);
    return;
  }
  setText("#last-sync-label", "暂无报价更新");
};

renderDisplayCurrencyBadges = function renderDisplayCurrencyBadgesSegmented() {
  const label = state.displayCurrency || "CNY";
  const compactToggle = document.querySelector("#display-currency-compact-toggle");
  if (compactToggle) {
    compactToggle.setAttribute("aria-label", label === "USD" ? "切换为人民币显示" : "切换为美元显示");
    compactToggle.querySelectorAll(".currency-switch__option").forEach((button) => {
      const isActive = button.dataset.currency === label;
      button.dataset.active = isActive ? "true" : "false";
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
};

renderDisplayCurrencyBadges = function renderDisplayCurrencyBadgesFloatingTool() {
  const label = state.displayCurrency || "CNY";
  const compactToggle = document.querySelector("#display-currency-compact-toggle");
  if (compactToggle) {
    compactToggle.dataset.currency = label;
    compactToggle.setAttribute("aria-label", label === "USD" ? "当前美元，点击切换为人民币显示" : "当前人民币，点击切换为美元显示");
    compactToggle.title = label === "USD" ? "当前 USD，点击切换到 CNY" : "当前 CNY，点击切换到 USD";
    compactToggle.innerHTML = `
      <span class="sidebar-tool-button__icon" aria-hidden="true">${label === "USD" ? "$" : "¥"}</span>
    `;
  }
};

function getRefreshCooldownRemainingMs() {
  try {
    const lastAt = Number(window.localStorage.getItem(PRICE_REFRESH_COOLDOWN_KEY) || 0);
    if (!lastAt) {
      return 0;
    }
    return Math.max(0, PRICE_REFRESH_COOLDOWN_MS - (Date.now() - lastAt));
  } catch {
    return 0;
  }
}

function startRefreshCooldown() {
  try {
    window.localStorage.setItem(PRICE_REFRESH_COOLDOWN_KEY, String(Date.now()));
  } catch {
    // ignore storage failures
  }
  updateRefreshPriceButtonCooldown();
}

function updateRefreshPriceButtonCooldown() {
  const button = document.querySelector("#refresh-prices-btn");
  if (!button) {
    return;
  }

  const remainingMs = getRefreshCooldownRemainingMs();
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  button.disabled = remainingMs > 0;
  button.textContent = remainingMs > 0 ? `刷新实时价格 (${remainingSeconds}s)` : "刷新实时价格";

  if (state.refreshCooldownTimerId) {
    window.clearTimeout(state.refreshCooldownTimerId);
    state.refreshCooldownTimerId = null;
  }

  if (remainingMs > 0) {
    state.refreshCooldownTimerId = window.setTimeout(() => {
      updateRefreshPriceButtonCooldown();
    }, 1000);
  }
}

const originalRefreshAllPrices = refreshAllPrices;
refreshAllPrices = async function refreshAllPricesWithCooldown(...args) {
  const [options = {}] = args;
  if (options && typeof options === "object" && options.bypassCooldown) {
    return await originalRefreshAllPrices(...args);
  }
  const cooldownRemaining = getRefreshCooldownRemainingMs();
  if (cooldownRemaining > 0) {
    updateRefreshPriceButtonCooldown();
    showToast(`刷新过于频繁，请 ${Math.ceil(cooldownRemaining / 1000)} 秒后再试`);
    return;
  }
  startRefreshCooldown();
  try {
    return await originalRefreshAllPrices(...args);
  } finally {
    updateRefreshPriceButtonCooldown();
  }
};

function rebindRefreshPriceButton() {
  const button = document.querySelector("#refresh-prices-btn");
  if (!button || button.dataset.cooldownBound === "true") {
    return;
  }
  const replacement = button.cloneNode(true);
  replacement.dataset.cooldownBound = "true";
  button.replaceWith(replacement);
  replacement.addEventListener("click", refreshAllPrices);
  updateRefreshPriceButtonCooldown();
}

rebindRefreshPriceButton();

refreshAllPrices = async function refreshAllPricesWithoutButton(...args) {
  return await originalRefreshAllPrices(...args);
};

const unlockedRefreshAllPrices = refreshAllPrices;
refreshAllPrices = async function refreshAllPricesWithLock(...args) {
  try {
    return await unlockedRefreshAllPrices(...args);
  } finally {
    state.isRefreshingPrices = false;
  }
};

function getProviderCards(providers) {
  return [
    ["finnhub", "Finnhub", providers?.finnhub],
    ["tushareRealtime", "Tushare 实时", providers?.tushareRealtime],
    ["tushareFund", "场外基金净值", providers?.tushareFund],
    ["binance", "Binance", providers?.binance],
    ["fx", "汇率接口", providers?.fx]
  ];
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "fund_eastmoney") {
    return state.providerStatuses.tushareFund;
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "finnhub") {
    return state.providerStatuses.finnhub;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  if (state.assets.some((asset) => asset.quoteSource === "finnhub")) {
    const status = state.providerStatuses.finnhub;
    if (status && status.status !== "ok") {
      warnings.push(`Finnhub：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund")) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }
  if (state.assets.some((asset) => (asset.quoteSource === "tushare" && asset.type === "fund") || asset.quoteSource === "fund_eastmoney")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.currency && asset.currency !== "CNY")) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }
  return warnings;
}

function getQuoteSourceLabel(source) {
  const map = {
    manual: "手动",
    tushare: "Tushare",
    fund_eastmoney: "场外基金净值",
    finnhub: "Finnhub",
    binance: "Binance"
  };
  return map[source] || source;
}

function getProviderCards(providers) {
  return [
    ["finnhub", "Finnhub", providers?.finnhub],
    ["tushareRealtime", "Tushare 实时", providers?.tushareRealtime],
    ["tushareFund", "场外基金净值", providers?.tushareFund],
    ["binance", "Binance", providers?.binance],
    ["fx", "汇率接口", providers?.fx]
  ];
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "fund_eastmoney") {
    return state.providerStatuses.tushareFund;
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "finnhub") {
    return state.providerStatuses.finnhub;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  if (state.assets.some((asset) => asset.quoteSource === "finnhub")) {
    const status = state.providerStatuses.finnhub;
    if (status && status.status !== "ok") {
      warnings.push(`Finnhub：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund")) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }
  if (state.assets.some((asset) => (asset.quoteSource === "tushare" && asset.type === "fund") || asset.quoteSource === "fund_eastmoney")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.currency && asset.currency !== "CNY")) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }
  return warnings;
}

function getQuoteSourceLabel(source) {
  const map = {
    manual: "手动",
    tushare: "Tushare",
    fund_eastmoney: "场外基金净值",
    finnhub: "Finnhub",
    binance: "Binance"
  };
  return map[source] || source;
}

function getProviderCards(providers) {
  return [
    ["finnhub", "Finnhub", providers?.finnhub],
    ["tushareRealtime", "Tushare 实时", providers?.tushareRealtime],
    ["tushareFund", "场外基金净值", providers?.tushareFund],
    ["binance", "Binance", providers?.binance],
    ["fx", "汇率接口", providers?.fx]
  ];
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "fund_eastmoney") {
    return state.providerStatuses.tushareFund;
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "finnhub") {
    return state.providerStatuses.finnhub;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  if (state.assets.some((asset) => asset.quoteSource === "finnhub")) {
    const status = state.providerStatuses.finnhub;
    if (status && status.status !== "ok") {
      warnings.push(`Finnhub：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund")) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }
  if (state.assets.some((asset) => (asset.quoteSource === "tushare" && asset.type === "fund") || asset.quoteSource === "fund_eastmoney")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.currency && asset.currency !== "CNY")) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }
  return warnings;
}

function getQuoteSourceLabel(source) {
  const map = {
    manual: "手动",
    tushare: "Tushare",
    finnhub: "Finnhub",
    binance: "Binance"
  };
  return map[source] || source;
}

function getProviderCards(providers) {
  return [
    ["finnhub", "Finnhub", providers?.finnhub],
    ["tushareRealtime", "Tushare 实时", providers?.tushareRealtime],
    ["tushareFund", "场外基金净值", providers?.tushareFund],
    ["binance", "Binance", providers?.binance],
    ["fx", "汇率接口", providers?.fx]
  ];
}

function renderProviderStatusLoading() {
  const container = document.querySelector("#provider-status-grid");
  if (!container) {
    return;
  }

  container.innerHTML = getProviderCards({})
    .map(([, label]) => `
      <article class="provider-card">
        <div class="provider-card__head">
          <span class="status-dot status-warning"></span>
          <strong>${escapeHtml(label)}</strong>
        </div>
        <p>检查中...</p>
        <small>正在检测接口状态</small>
      </article>
    `)
    .join("");
}

function renderProviderStatuses(providers) {
  const container = document.querySelector("#provider-status-grid");
  if (!container) {
    return;
  }

  container.innerHTML = getProviderCards(providers)
    .map(([, label, provider]) => `
      <article class="provider-card">
        <div class="provider-card__head">
          <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
          <strong>${escapeHtml(label)}</strong>
          ${provider?.source ? `<span class="provider-card__meta">${escapeHtml(getProviderSourceLabel(provider.source))}</span>` : ""}
        </div>
        <p>${escapeHtml(provider?.message || "未检查")}</p>
        <small>${formatProviderCheckedAt(provider?.checkedAt)}</small>
      </article>
    `)
    .join("");
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "fund_eastmoney") {
    return state.providerStatuses.tushareFund;
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "finnhub") {
    return state.providerStatuses.finnhub;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function renderSourceBadge(asset) {
  const provider = getProviderStateByAsset(asset);
  return `
    <span class="source-badge">
      <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
      <span>${escapeHtml(getQuoteSourceLabel(asset.quoteSource))}</span>
    </span>
  `;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  if (state.assets.some((asset) => asset.quoteSource === "finnhub")) {
    const status = state.providerStatuses.finnhub;
    if (status && status.status !== "ok") {
      warnings.push(`Finnhub：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund")) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type === "fund")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "fund_eastmoney")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.currency && asset.currency !== "CNY")) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }
  return warnings;
}

function renderDashboardRiskBanner() {
  const banner = document.querySelector("#dashboard-risk-banner");
  if (!banner) {
    return;
  }
  const warnings = getActiveProviderWarnings();
  if (!warnings.length) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  banner.classList.remove("hidden");
  banner.textContent = `当前部分资产行情异常，收益可能不准确：${warnings.join("；")}`;
}

function formatProviderCheckedAt(value) {
  if (!value) {
    return "尚未检查";
  }
  return `检查时间：${new Date(value).toLocaleString("zh-CN")}`;
}

function formatProviderCheckedAt(value) {
  if (!value) {
    return "尚未检查";
  }
  return `检查时间：${new Date(value).toLocaleString("zh-CN")}`;
}

function getProviderSourceLabel(source) {
  const map = {
    primary: "主接口",
    fallback: "备用接口",
    unknown: "未知来源"
  };
  return map[source] || source;
}

function lockAppForGuest() {
  document.querySelectorAll('.view-panel:not([data-view="dashboard"]):not([data-view="account"])').forEach((panel) => {
    panel.classList.add("is-locked");
  });
  switchView("dashboard");
}

function unlockAppForUser() {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.remove("is-locked");
  });
}

function ensureLoggedIn() {
  if (state.user) {
    return true;
  }
  showToast("请先登录");
  return false;
}

async function apiFetch(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
  } catch {
    throw new Error("后端服务未启动，请先运行应用服务");
  }

  if (!response.ok) {
    let message = "请求失败";
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function getTypeLabel(type) {
  const map = {
    fund: "场外基金",
    stock: "股票 / ETF",
    crypto: "加密货币",
    cash: "现金",
    liability: "负债"
  };
  return map[type] || type;
}

function getPlatformLabel(platform) {
  const map = {
    alipay: "支付宝",
    southfund: "南方基金",
    tonghuashun: "同花顺",
    okx: "欧意 OKX",
    ibkr: "IBKR",
    schwab: "嘉信理财",
    bank: "现金 / 银行",
    other: "其他"
  };
  return map[platform] || platform;
}

function getPlatformCurrency(platform) {
  return ["ibkr", "schwab", "okx"].includes(platform) ? "USD" : "CNY";
}

function getDefaultAccountDisplayCurrency(platform) {
  return getPlatformCurrency(platform);
}

function inferAccountOverviewCurrency() {
  const hasOverseasAccount = buildAccountSummaryGroups(state.assets).some((group) => getPlatformCurrency(group.platform) === "USD");
  return hasOverseasAccount ? "USD" : "CNY";
}

function getCurrencyFxRateToCny(currency) {
  if (!currency || currency === "CNY") {
    return 1;
  }

  const cachedRate = Number(state.displayFxRates[currency]);
  if (cachedRate > 0) {
    return cachedRate;
  }

  const assetRate = state.assets.find((asset) => asset.currency === currency && Number(asset.fxRate) > 0);
  if (assetRate) {
    return Number(assetRate.fxRate);
  }

  return 1;
}

function getPlatformFxRateToCny(platform) {
  return getCurrencyFxRateToCny(getPlatformCurrency(platform));
}

function getAccountBalanceEntry(platform) {
  return state.accountBalances.find((item) => item.platform === platform) || null;
}

function getAccountDisplayCurrency(platform) {
  const entry = getAccountBalanceEntry(platform);
  return entry?.displayCurrency || getDefaultAccountDisplayCurrency(platform);
}

function getAccountFreeCashNative(platform) {
  const entry = getAccountBalanceEntry(platform);
  return Number(entry?.freeCash) || 0;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function getDisplayValueByCurrency(valueCny, currency) {
  const normalized = Number(valueCny) || 0;
  if (currency === "USD") {
    const usdRate = Number(state.displayFxRates.USD) || 0;
    if (usdRate > 0) {
      return normalized / usdRate;
    }
  }
  return normalized;
}

function formatCurrencyByUnit(valueCny, currency) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(getDisplayValueByCurrency(valueCny, currency));
}

function buildAccountSummaryGroups(assets) {
  const groups = {};
  const balancePlatforms = new Set(state.accountBalances.map((item) => item.platform));
  for (const asset of assets) {
    const key = asset.platform || "other";
    if (!groups[key]) {
      groups[key] = {
        platform: key,
        holdingsValue: 0,
        totalProfit: 0
      };
    }
    if (asset.type === "cash" || asset.type === "liability") {
      continue;
    }
    const currentValue = getCurrentValue(asset);
    const costValue = getCostValue(asset);
    groups[key].holdingsValue += currentValue;
    groups[key].totalProfit += currentValue - costValue;
  }

  for (const platform of balancePlatforms) {
    if (!groups[platform]) {
      groups[platform] = {
        platform,
        holdingsValue: 0,
        totalProfit: 0
      };
    }
  }

  return Object.values(groups)
    .map((group) => {
      const freeCashNative = getAccountFreeCashNative(group.platform);
      const freeCashCny = freeCashNative * getPlatformFxRateToCny(group.platform);
      const displayCurrency = getAccountDisplayCurrency(group.platform);
      return {
        ...group,
        freeCashNative,
        freeCashCny,
        displayCurrency,
        netValue: group.holdingsValue + freeCashCny
      };
    })
    .sort((left, right) => Math.abs(right.netValue) - Math.abs(left.netValue));
}

async function handleAccountBalanceSave(event) {
  if (!ensureLoggedIn()) {
    return;
  }
  const platform = event.currentTarget.dataset.platform;
  const input = document.querySelector(`.account-balance-input[data-platform="${platform}"]`);
  if (!input) {
    return;
  }
  const freeCash = Number(input.value) || 0;
  const payload = {
    platform,
    freeCash,
    displayCurrency: getAccountDisplayCurrency(platform),
    updatedAt: new Date().toISOString()
  };
  const response = await apiFetch("/api/account-balances", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const nextItem = response.accountBalance;
  const existingIndex = state.accountBalances.findIndex((item) => item.platform === nextItem.platform);
  if (existingIndex >= 0) {
    state.accountBalances[existingIndex] = nextItem;
  } else {
    state.accountBalances.push(nextItem);
  }
  await refreshWeeklySummary({ renderAfter: false });
  render();
  showToast(`${getPlatformLabel(platform)} 自由资金已保存`);
}

async function handleAccountDisplayCurrencyChange(event) {
  if (!ensureLoggedIn()) {
    return;
  }
  const nextCurrency = event.currentTarget.value;
  if (nextCurrency !== "CNY") {
    try {
      await ensureFxRateCached(nextCurrency);
    } catch (error) {
      showToast(error.message || "获取汇率失败");
      event.currentTarget.value = getAccountDisplayCurrency(event.currentTarget.dataset.platform);
      return;
    }
  }
  const platform = event.currentTarget.dataset.platform;
  const existing = getAccountBalanceEntry(platform);
  const payload = {
    platform,
    freeCash: existing?.freeCash || 0,
    displayCurrency: nextCurrency,
    updatedAt: new Date().toISOString()
  };
  const response = await apiFetch("/api/account-balances", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const nextItem = response.accountBalance;
  const existingIndex = state.accountBalances.findIndex((item) => item.platform === nextItem.platform);
  if (existingIndex >= 0) {
    state.accountBalances[existingIndex] = nextItem;
  } else {
    state.accountBalances.push(nextItem);
  }
  await refreshWeeklySummary({ renderAfter: false });
  render();
}

async function handleAccountOverviewCurrencyChange(event) {
  const nextCurrency = event.target.value;
  if (nextCurrency !== "CNY") {
    try {
      await ensureFxRateCached(nextCurrency);
    } catch (error) {
      showToast(error.message || "获取汇率失败");
      event.target.value = state.accountOverviewCurrency;
      return;
    }
  }
  state.accountOverviewCurrency = nextCurrency;
  render();
}

function renderPlatformSummary(assets) {
  const container = document.querySelector("#platform-summary-grid");
  const groups = buildAccountSummaryGroups(assets);
  if (!groups.length) {
    container.innerHTML = `
      <article class="stat-card">
        <span>暂无账户数据</span>
        <strong>¥0.00</strong>
        <small>录入资产后会自动汇总</small>
      </article>
    `;
    return;
  }

  container.innerHTML = groups
      .map((group) => {
        const freeCashLabel = group.freeCashCny >= 0 ? "账户余额" : "融资占用";
        const freeCashValue = Math.abs(group.freeCashCny);
        const unitLabel = getPlatformCurrency(group.platform);
        const displayUnit = state.displayCurrency || "CNY";
        const netValueText = getMaskedSensitiveText(formatCurrencyByUnit(group.netValue, displayUnit));
        const holdingsValueText = getMaskedSensitiveText(formatCurrencyByUnit(group.holdingsValue, displayUnit));
        const totalProfitText = getMaskedSensitiveText(formatCurrencyByUnit(group.totalProfit, displayUnit));
        const freeCashText = getMaskedSensitiveText(formatCurrencyByUnit(freeCashValue, displayUnit));
        const freeCashNativeText = getMaskedSensitiveText(`${formatNumber(group.freeCashNative)} ${unitLabel}`, `**** ${unitLabel}`);
        return `
          <article class="stat-card account-summary-card">
            <div class="account-summary-card__head">
              <div class="account-summary-card__title">
                <span>${escapeHtml(getPlatformLabel(group.platform))}</span>
              </div>
              <strong class="${getToneClass(group.netValue)}">${netValueText}</strong>
            </div>
          <div class="account-summary-card__grid">
            <div>
              <span>持仓市值</span>
              <strong>${holdingsValueText}</strong>
            </div>
            <div>
              <span>累计收益</span>
              <strong class="${getToneClass(group.totalProfit)}">${totalProfitText}</strong>
            </div>
            <div>
              <span>${freeCashLabel}</span>
              <strong class="${getToneClass(group.freeCashCny)}">${freeCashText}</strong>
            </div>
            <div>
              <span>自由资金（原币）</span>
              <strong>${freeCashNativeText}</strong>
            </div>
          </div>
          <div class="account-balance-form">
            <label>
              <span>当前账户自由资金（${unitLabel}）</span>
              <input type="number" step="0.01" class="account-balance-input" data-platform="${escapeHtml(group.platform)}" value="${escapeHtml(String(roundTo(group.freeCashNative, 2)))}" placeholder="0">
            </label>
            <button type="button" class="ghost-button save-account-balance-button" data-platform="${escapeHtml(group.platform)}">保存自由资金</button>
          </div>
          <small>账户净值 = 持仓市值 + 当前账户自由资金。这里填正数表示账户还有余额，填负数表示当前已使用融资。</small>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".save-account-balance-button").forEach((button) => {
    button.addEventListener("click", handleAccountBalanceSave);
  });
}

function renderHomepageAssetDistribution(assets) {
  const totalElement = document.querySelector("#asset-distribution-total");
  const chartElement = document.querySelector("#asset-distribution-chart");
  const legendElement = document.querySelector("#asset-distribution-legend");
  if (!totalElement || !chartElement || !legendElement) {
    return;
  }

  const buckets = [
    { key: "stock", label: "股票 / ETF", color: "#1d8478", value: 0 },
    { key: "fund", label: "场外基金", color: "#cf7445", value: 0 },
    { key: "crypto", label: "加密货币", color: "#d89c24", value: 0 },
    { key: "cash", label: "现金", color: "#776be8", value: 0 }
  ];

  for (const asset of assets) {
    if (asset.type === "liability") {
      continue;
    }
    const bucket = buckets.find((item) => item.key === asset.type) || buckets[buckets.length - 1];
    bucket.value += Math.max(0, getCurrentValue(asset));
  }

  for (const item of state.accountBalances) {
    const platform = item.platform || "other";
    const freeCashCny = (Number(item.freeCash) || 0) * getPlatformFxRateToCny(platform);
    if (freeCashCny > 0) {
      buckets[buckets.length - 1].value += freeCashCny;
    }
  }

  const activeBuckets = buckets.filter((item) => item.value > 0.0001);
  const total = activeBuckets.reduce((sum, item) => sum + item.value, 0);
  totalElement.textContent = total > 0 ? getMaskedSensitiveText(formatCurrency(total)) : "暂无数据";

  if (!activeBuckets.length || total <= 0) {
    chartElement.innerHTML = `<div class="distribution-card__chart-empty">暂无数据</div>`;
    legendElement.innerHTML = "";
    return;
  }

  let offset = 0;
  const circumference = 2 * Math.PI * 44;
  chartElement.innerHTML = `
    <svg viewBox="0 0 120 120" role="img" aria-label="资产分布图">
      <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(92,58,34,0.08)" stroke-width="12"></circle>
      ${activeBuckets
        .map((item) => {
          const ratio = item.value / total;
          const dash = ratio * circumference;
          const segment = `
            <circle
              cx="60"
              cy="60"
              r="44"
              fill="none"
              stroke="${item.color}"
              stroke-width="12"
              stroke-linecap="round"
              stroke-dasharray="${dash} ${circumference - dash}"
              stroke-dashoffset="${-offset}"
              transform="rotate(-90 60 60)"
            ></circle>
          `;
          offset += dash;
          return segment;
        })
        .join("")}
      <text x="60" y="54" text-anchor="middle" font-size="10" fill="#8a7463">资产</text>
      <text x="60" y="72" text-anchor="middle" font-size="18" font-weight="700" fill="#3b2a20">${activeBuckets.length}</text>
    </svg>
  `;

  legendElement.innerHTML = activeBuckets
    .map((item) => {
      const ratio = total > 0 ? (item.value / total) * 100 : 0;
      return `
        <div class="distribution-card__legend-item">
          <span class="distribution-card__swatch" style="background:${item.color}"></span>
          <div class="distribution-card__label">
            <strong>${escapeHtml(item.label)}</strong>
            <small>${ratio.toFixed(1)}%</small>
          </div>
          <div class="distribution-card__value">${getMaskedSensitiveText(formatCurrency(item.value))}</div>
        </div>
      `;
    })
    .join("");
}

function renderHomepagePlatformProfit(assets) {
  const container = document.querySelector("#platform-profit-compact");
  if (!container) {
    return;
  }

  const panel = document.querySelector("#platform-profit-panel");
  const rows = buildHomepagePlatformProfitRows(assets);
  if (!rows.length) {
    container.innerHTML = "";
    if (panel) {
      panel.classList.add("hidden");
    }
    return;
  }

  if (panel) {
    panel.classList.remove("hidden");
  }

  container.innerHTML = `
    <div class="platform-profit-strip__header">
      <span class="platform-profit-strip__title">当日平台盈亏</span>
    </div>
    <div class="platform-profit-strip__rows">
      ${rows
        .map((row, index) => `
          <div class="platform-profit-row">
            <span class="platform-profit-row__rank">${index + 1}</span>
            <div class="platform-profit-row__name-wrap">
              <span class="platform-profit-row__name">${escapeHtml(getPlatformLabel(row.platform))}</span>
              <div class="platform-profit-row__freshness">
                <span class="freshness-badge ${row.freshnessClass}">${row.freshnessLabel}</span>
                <small>${escapeHtml(row.dateText)}</small>
              </div>
            </div>
            <div class="platform-profit-row__metrics ${row.isStaleOnly ? "platform-profit-row__metrics--stale" : ""}">
              <strong class="${row.isStaleOnly ? "number-flat" : getToneClass(row.displayDailyProfit)}">${formatCurrency(row.displayDailyProfit)}</strong>
              <small>${formatSignedNumber(row.displayDailyRate)}%</small>
            </div>
          </div>
        `)
        .join("")}
    </div>
  `;

  const modalList = document.querySelector("#platform-profit-modal-list");
  if (modalList) {
    modalList.innerHTML = rows
      .map((row, index) => `
        <article class="platform-profit-modal-item">
          <div>
            <strong>${index + 1}. ${escapeHtml(getPlatformLabel(row.platform))}</strong>
            <small>${row.freshnessLabel} · ${escapeHtml(row.dateText)} · ${row.metricLabel} ${formatSignedNumber(row.displayDailyRate)}%</small>
          </div>
          <div class="platform-profit-modal-item__values ${row.isStaleOnly ? "platform-profit-modal-item__values--stale" : ""}">
            <strong class="${row.isStaleOnly ? "number-flat" : getToneClass(row.displayDailyProfit)}">${formatCurrency(row.displayDailyProfit)}</strong>
          </div>
        </article>
      `)
      .join("");
  }
}

function buildHomepagePlatformProfitRows(assets) {
  const groups = {};
  for (const asset of assets) {
    const platform = asset.platform || "other";
    if (!groups[platform]) {
      groups[platform] = {
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
    }
    const quoteDate = getEffectiveQuoteDate(asset);
    if (quoteDate) {
      if (!groups[platform].latestQuoteDate || quoteDate > groups[platform].latestQuoteDate) {
        groups[platform].latestQuoteDate = quoteDate;
      }
      if (quoteDate === getTodayDateString()) {
        groups[platform].hasTodayData = true;
      }
      if (isAssetQuoteCurrent(asset)) {
        groups[platform].hasCurrentData = true;
      } else {
        groups[platform].hasNonTodayData = true;
      }
    } else {
      groups[platform].hasNonTodayData = true;
    }

    groups[platform].displayDailyProfit += getQuoteProfitValue(asset);
    groups[platform].displayCostValue += Math.max(0, getCostValue(asset));

    if (shouldCountAssetForDailyProfit(asset)) {
      groups[platform].dailyProfit += getDailyProfit(asset);
      groups[platform].costValue += Math.max(0, getCostValue(asset));
    }
  }

  return Object.values(groups)
    .map((row) => {
      const isStaleOnly = !row.hasCurrentData;
      const effectiveDailyProfit = isStaleOnly ? 0 : row.dailyProfit;
      const effectiveCostValue = isStaleOnly ? 0 : row.costValue;
      const isUsPlatform = isUsEquityPlatform(row.platform);
      const usSession = isUsPlatform ? getUsMarketSessionInfo() : null;
      const shouldForceZero = Boolean(usSession?.zeroProfit);
      const displayDailyProfit = shouldForceZero
        ? 0
        : (isStaleOnly ? row.displayDailyProfit : row.dailyProfit);
      const displayDailyRate = shouldForceZero
        ? 0
        : (isStaleOnly
          ? (row.displayCostValue > 0 ? (row.displayDailyProfit / row.displayCostValue) * 100 : 0)
          : (row.costValue > 0 ? (row.dailyProfit / row.costValue) * 100 : 0));
      const freshnessLabel = isUsPlatform
        ? usSession.label
        : (row.hasTodayData ? (row.hasNonTodayData ? "部分更新" : "今日") : (row.hasCurrentData ? "最新" : "昨日"));
      const freshnessClass = isUsPlatform
        ? usSession.badgeClass
        : (row.hasTodayData ? (row.hasNonTodayData ? "freshness-badge--mixed" : "freshness-badge--today") : (row.hasCurrentData ? "freshness-badge--today" : "freshness-badge--yesterday"));
      const metricLabel = shouldForceZero
        ? "夜盘收益率"
        : (isUsPlatform
          ? `${usSession.label}收益率`
          : (isStaleOnly ? "昨日收益率" : (row.hasTodayData ? "当日收益率" : "最新收益率")));
      return {
        ...row,
        isStaleOnly,
        isUsPlatform,
        metricLabel,
        dailyProfit: effectiveDailyProfit,
        costValue: effectiveCostValue,
        displayDailyProfit,
        displayDailyRate,
        dailyRate: effectiveCostValue > 0 ? (effectiveDailyProfit / effectiveCostValue) * 100 : 0,
        freshnessLabel,
        freshnessClass,
        dateText: row.latestQuoteDate || "未知日期"
      };
    })
    .sort((left, right) => {
      if (right.hasCurrentData !== left.hasCurrentData) {
        return Number(right.hasCurrentData) - Number(left.hasCurrentData);
      }
      if (right.hasTodayData !== left.hasTodayData) {
        return Number(right.hasTodayData) - Number(left.hasTodayData);
      }
      return Math.abs(right.dailyProfit) - Math.abs(left.dailyProfit);
    });
}

function getQuoteSourceLabel(source) {
  const map = {
    manual: "手动",
    tushare: "Tushare",
    fund_eastmoney: "场外基金净值",
    finnhub: "Finnhub",
    binance: "Binance"
  };
  return map[source] || source;
}

function getDisplayValue(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  if (state.displayCurrency === "USD" && state.displayFxRates.USD) {
    return normalized / state.displayFxRates.USD;
  }
  return normalized;
}

function formatCurrency(value) {
  const currency = state.displayCurrency || "CNY";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(getDisplayValue(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 6
  }).format(Number.isFinite(value) ? value : 0);
}

function formatSignedNumber(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized >= 0 ? `+${normalized.toFixed(2)}` : normalized.toFixed(2);
}

function getMaskedSensitiveText(value, hiddenValue = "****") {
  return state.accountValuesVisible ? value : hiddenValue;
}

function renderAccountPrivacyToggle() {
  const button = document.querySelector("#account-privacy-toggle");
  if (!button) {
    return;
  }
  const isVisible = Boolean(state.accountValuesVisible);
  button.setAttribute("aria-pressed", String(isVisible));
  button.setAttribute("aria-label", isVisible ? "Hide account overview data" : "Show account overview data");
  button.innerHTML = `<span class="privacy-toggle__icon" aria-hidden="true">${getAccountPrivacyIcon(isVisible)}</span>`;
}

function getAccountPrivacyIcon(isVisible) {
  if (isVisible) {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M10.6 6.3A10.9 10.9 0 0 1 12 6c6.4 0 10 6 10 6a18.4 18.4 0 0 1-3.5 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M6.7 6.7C4.1 8.1 2 12 2 12s3.6 6 10 6c1.7 0 3.2-.4 4.5-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function toggleAccountValuesVisibility() {
  state.accountValuesVisible = !state.accountValuesVisible;
  render();
}

function applyNumberTone(element, value) {
  if (!element) {
    return;
  }
  element.classList.remove("number-up", "number-down", "number-flat");
  element.classList.add(getToneClass(value));
}

function getToneClass(value) {
  if (value > 0) {
    return "number-up";
  }
  if (value < 0) {
    return "number-down";
  }
  return "number-flat";
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function updateLastSyncLabel(value) {
  setText("#last-sync-label", value ? `更新于 ${new Date(value).toLocaleString("zh-CN")}` : "未刷新");
}

function updateLastSyncLabel(value) {
  const latestQuoteDate = getLatestAssetQuoteDate();
  if (latestQuoteDate) {
    setText("#last-sync-label", `报价至 ${latestQuoteDate}`);
    return;
  }
  if (value) {
    setText("#last-sync-label", `刷新于 ${new Date(value).toLocaleString("zh-CN")}`);
    return;
  }
  setText("#last-sync-label", "暂无报价更新");
}

function formatPreciseDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateLastSyncLabel(value) {
  const latestQuoteFetchedAt = getLatestAssetQuoteFetchedAt();
  const formattedFetchedAt = formatPreciseDateTime(latestQuoteFetchedAt);
  if (formattedFetchedAt) {
    setText("#last-sync-label", formattedFetchedAt);
    return;
  }
  const latestQuoteDate = getLatestAssetQuoteDate();
  if (latestQuoteDate) {
    setText("#last-sync-label", `报价至 ${latestQuoteDate}`);
    return;
  }
  const formattedSyncAt = formatPreciseDateTime(value);
  if (formattedSyncAt) {
    setText("#last-sync-label", `刷新于 ${formattedSyncAt}`);
    return;
  }
  setText("#last-sync-label", "暂无报价更新");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getProviderCards(providers) {
  return [
    ["finnhub", "Finnhub", providers?.finnhub],
    ["tushareRealtime", "Tushare 实时", providers?.tushareRealtime],
    ["tushareFund", "场外基金净值", providers?.tushareFund],
    ["binance", "Binance", providers?.binance],
    ["fx", "汇率接口", providers?.fx]
  ];
}

function renderProviderStatusLoading() {
  const container = document.querySelector("#provider-status-grid");
  if (!container) {
    return;
  }

  container.innerHTML = getProviderCards({})
    .map(([, label]) => `
      <article class="provider-card">
        <div class="provider-card__head">
          <span class="status-dot status-warning"></span>
          <strong>${escapeHtml(label)}</strong>
        </div>
        <p>检查中...</p>
        <small>正在检测接口状态</small>
      </article>
    `)
    .join("");
}

function renderProviderStatuses(providers) {
  const container = document.querySelector("#provider-status-grid");
  if (!container) {
    return;
  }

  container.innerHTML = getProviderCards(providers)
    .map(([, label, provider]) => `
      <article class="provider-card">
        <div class="provider-card__head">
          <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
          <strong>${escapeHtml(label)}</strong>
          ${provider?.source ? `<span class="provider-card__meta">${escapeHtml(getProviderSourceLabel(provider.source))}</span>` : ""}
        </div>
        <p>${escapeHtml(provider?.message || "未检查")}</p>
        <small>${formatProviderCheckedAt(provider?.checkedAt)}</small>
      </article>
    `)
    .join("");
}

function renderSourceBadge(asset) {
  const provider = getProviderStateByAsset(asset);
  return `
    <span class="source-badge">
      <span class="status-dot ${getProviderStatusClass(provider?.status)}"></span>
      <span>${escapeHtml(getQuoteSourceLabel(asset.quoteSource))}</span>
    </span>
  `;
}

function getProviderStateByAsset(asset) {
  if (!state.providerStatuses) {
    return null;
  }
  if (asset.quoteSource === "manual") {
    return { status: "ok", message: "手动价格" };
  }
  if (asset.quoteSource === "tushare") {
    return asset.type === "fund" ? state.providerStatuses.tushareFund : state.providerStatuses.tushareRealtime;
  }
  if (asset.quoteSource === "finnhub") {
    return state.providerStatuses.finnhub;
  }
  if (asset.quoteSource === "binance") {
    return state.providerStatuses.binance;
  }
  return null;
}

function getActiveProviderWarnings() {
  if (!state.providerStatuses || !state.assets.length) {
    return [];
  }

  const warnings = [];
  if (state.assets.some((asset) => asset.quoteSource === "finnhub")) {
    const status = state.providerStatuses.finnhub;
    if (status && status.status !== "ok") {
      warnings.push(`Finnhub：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type !== "fund")) {
    const status = state.providerStatuses.tushareRealtime;
    if (status && status.status !== "ok") {
      warnings.push(`Tushare 实时：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "tushare" && asset.type === "fund")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "fund_eastmoney")) {
    const status = state.providerStatuses.tushareFund;
    if (status && status.status !== "ok") {
      warnings.push(`场外基金净值：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.quoteSource === "binance")) {
    const status = state.providerStatuses.binance;
    if (status && status.status !== "ok") {
      warnings.push(`Binance：${status.message}`);
    }
  }
  if (state.assets.some((asset) => asset.currency && asset.currency !== "CNY")) {
    const status = state.providerStatuses.fx;
    if (status && status.status !== "ok") {
      warnings.push(`汇率接口：${status.message}`);
    }
  }
  return warnings;
}

function renderDashboardRiskBanner() {
  const banner = document.querySelector("#dashboard-risk-banner");
  if (!banner) {
    return;
  }
  const warnings = getActiveProviderWarnings();
  if (!warnings.length) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  banner.classList.remove("hidden");
  banner.textContent = `当前部分资产行情异常，收益可能不准确：${warnings.join("；")}`;
}

function formatProviderCheckedAt(value) {
  if (!value) {
    return "尚未检查";
  }
  return `检查时间：${new Date(value).toLocaleString("zh-CN")}`;
}

function getProviderSourceLabel(source) {
  const map = {
    primary: "主接口",
    fallback: "备用接口",
    unknown: "未知来源"
  };
  return map[source] || source;
}
