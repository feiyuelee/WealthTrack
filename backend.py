from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import sleep, time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "wealthtrack.db"
SESSION_COOKIE = "wealthtrack_session"
SESSION_TTL_DAYS = 14
APP_SECRET = os.environ.get("WEALTHTRACK_SECRET", "change-me-in-production")
PROVIDER_STATUS_CACHE_TTL_SECONDS = 300
provider_status_cache: dict[str, Any] = {"key": None, "expires_at": 0.0, "providers": None}
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "12345678"
DEFAULT_FINNHUB_KEY = "d797klhr01qqpmhfoog0d797klhr01qqpmhfoogg"
DEFAULT_TUSHARE_TOKEN = "25790f70139144b663e37f1806836ba2a55bf0adb90e4bfb9dd85873"
BINANCE_PUBLIC_BASE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"]
BEIJING_TZ = ZoneInfo("Asia/Shanghai")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def get_today_beijing_date() -> str:
    return datetime.now(BEIJING_TZ).date().isoformat()


def get_week_start_date(date_text: str) -> str:
    current_date = datetime.strptime(date_text, "%Y-%m-%d").date()
    return (current_date - timedelta(days=current_date.weekday())).isoformat()


def get_platform_currency(platform: str) -> str:
    return "USD" if str(platform or "").strip().lower() in {"ibkr", "schwab", "okx"} else "CNY"


def resolve_fx_rate_to_cny(currency: str, fallback_rate: float = 0) -> float:
    normalized = str(currency or "").strip().upper()
    if normalized == "CNY" or not normalized:
        return 1.0
    if float(fallback_rate or 0) > 0:
        return float(fallback_rate)
    try:
        return float(fetch_fx_rates([normalized], "CNY").get("rates", {}).get(normalized) or 1)
    except Exception:
        return 1.0


def compute_asset_current_value(row: sqlite3.Row) -> float:
    value = float(row["quantity"] or 0) * float(row["current_price"] or 0) * float(row["fx_rate"] or 1)
    return -abs(value) if row["type"] == "liability" else value


def compute_asset_cost_value(row: sqlite3.Row) -> float:
    value = float(row["quantity"] or 0) * float(row["cost_price"] or 0) * float(row["fx_rate"] or 1)
    return -abs(value) if row["type"] == "liability" else value


def compute_portfolio_totals(conn: sqlite3.Connection, user_id: int) -> dict[str, float]:
    asset_rows = conn.execute(
        """
        SELECT type, platform, quantity, cost_price, current_price, currency, fx_rate
        FROM assets
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchall()
    balance_rows = conn.execute(
        """
        SELECT platform, free_cash
        FROM account_balances
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchall()

    fx_currencies = sorted(
        {
            get_platform_currency(str(row["platform"]))
            for row in balance_rows
            if get_platform_currency(str(row["platform"])) != "CNY"
        }
    )
    balance_fx_rates: dict[str, Any] = {}
    if fx_currencies:
        try:
            balance_fx_rates = fetch_fx_rates(fx_currencies, "CNY").get("rates", {})
        except Exception:
            balance_fx_rates = {}

    total_assets = 0.0
    total_cost = 0.0
    total_profit = 0.0
    total_margin = 0.0
    total_cash_balance = 0.0

    for row in asset_rows:
        current_value = compute_asset_current_value(row)
        cost_value = compute_asset_cost_value(row)
        total_assets += current_value
        total_cost += cost_value
        total_profit += current_value - cost_value

    for row in balance_rows:
        currency = get_platform_currency(str(row["platform"]))
        fx_rate = 1.0 if currency == "CNY" else float(balance_fx_rates.get(currency) or 1)
        free_cash_cny = float(row["free_cash"] or 0) * fx_rate
        total_assets += free_cash_cny
        if free_cash_cny < 0:
            total_margin += abs(free_cash_cny)
        else:
            total_cash_balance += free_cash_cny

    return {
        "totalAssets": total_assets,
        "totalCost": total_cost,
        "totalProfit": total_profit,
        "totalMargin": total_margin,
        "totalCashBalance": total_cash_balance,
    }


def ensure_portfolio_snapshot_for_date(conn: sqlite3.Connection, user_id: int, snapshot_date: str) -> None:
    existing = conn.execute(
        "SELECT 1 FROM portfolio_snapshots WHERE user_id = ? AND snapshot_date = ?",
        (user_id, snapshot_date),
    ).fetchone()
    if existing:
        return

    totals = compute_portfolio_totals(conn, user_id)
    conn.execute(
        """
        INSERT INTO portfolio_snapshots (
            user_id, snapshot_date, total_assets, total_cost, total_profit, total_margin, total_cash_balance, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            snapshot_date,
            totals["totalAssets"],
            totals["totalCost"],
            totals["totalProfit"],
            totals["totalMargin"],
            totals["totalCashBalance"],
            now_iso(),
        ),
    )


def upsert_account_balance(
    conn: sqlite3.Connection,
    user_id: int,
    platform: str,
    free_cash: float,
    display_currency: str,
    updated_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO account_balances (user_id, platform, free_cash, display_currency, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, platform) DO UPDATE SET
            free_cash = excluded.free_cash,
            display_currency = excluded.display_currency,
            updated_at = excluded.updated_at
        """,
        (user_id, platform, free_cash, display_currency, updated_at),
    )


def get_account_balance_entry(conn: sqlite3.Connection, user_id: int, platform: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT platform, free_cash, display_currency, updated_at
        FROM account_balances
        WHERE user_id = ? AND platform = ?
        """,
        (user_id, platform),
    ).fetchone()


def ensure_user_settings_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
    if "tushare_token" not in columns:
        conn.execute("ALTER TABLE user_settings ADD COLUMN tushare_token TEXT NOT NULL DEFAULT ''")
        conn.commit()
        columns.add("tushare_token")
    if "finnhub_key" not in columns:
        conn.execute("ALTER TABLE user_settings ADD COLUMN finnhub_key TEXT NOT NULL DEFAULT ''")
        if "alpha_vantage_key" in columns:
            conn.execute(
                """
                UPDATE user_settings
                SET finnhub_key = alpha_vantage_key
                WHERE finnhub_key = '' AND alpha_vantage_key <> ''
                """
            )
        conn.commit()


def ensure_account_balance_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(account_balances)").fetchall()}
    if "display_currency" not in columns:
        conn.execute("ALTER TABLE account_balances ADD COLUMN display_currency TEXT NOT NULL DEFAULT ''")
        conn.commit()


def ensure_asset_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
    if "quote_date" not in columns:
        conn.execute("ALTER TABLE assets ADD COLUMN quote_date TEXT NOT NULL DEFAULT ''")
        conn.commit()
    if "quote_fetched_at" not in columns:
        conn.execute("ALTER TABLE assets ADD COLUMN quote_fetched_at TEXT NOT NULL DEFAULT ''")
        conn.commit()


def ensure_admin_user(conn: sqlite3.Connection) -> None:
    username = ADMIN_USERNAME
    salt = secrets.token_hex(16)
    password_hash = hash_password(ADMIN_PASSWORD, salt)
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, password_salt = ?
            WHERE username = ?
            """,
            (password_hash, salt, username),
        )
    else:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, salt, now_iso()),
        )
        conn.execute(
            """
            INSERT INTO user_settings (user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at)
            VALUES (?, ?, ?, 0, '')
            """,
            (int(cursor.lastrowid), DEFAULT_FINNHUB_KEY, DEFAULT_TUSHARE_TOKEN),
        )
    conn.commit()


def init_db() -> None:
    with closing(get_db()) as conn:
        conn.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                finnhub_key TEXT NOT NULL DEFAULT '',
                tushare_token TEXT NOT NULL DEFAULT '',
                auto_refresh_interval INTEGER NOT NULL DEFAULT 0,
                last_sync_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                type TEXT NOT NULL,
                symbol TEXT NOT NULL,
                quantity REAL NOT NULL,
                cost_price REAL NOT NULL,
                current_price REAL NOT NULL DEFAULT 0,
                previous_close REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL,
                fx_rate REAL NOT NULL DEFAULT 1,
                quote_source TEXT NOT NULL,
                quote_date TEXT NOT NULL DEFAULT '',
                quote_fetched_at TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS account_balances (
                user_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                free_cash REAL NOT NULL DEFAULT 0,
                display_currency TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, platform),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                user_id INTEGER NOT NULL,
                snapshot_date TEXT NOT NULL,
                total_assets REAL NOT NULL DEFAULT 0,
                total_cost REAL NOT NULL DEFAULT 0,
                total_profit REAL NOT NULL DEFAULT 0,
                total_margin REAL NOT NULL DEFAULT 0,
                total_cash_balance REAL NOT NULL DEFAULT 0,
                captured_at TEXT NOT NULL,
                PRIMARY KEY (user_id, snapshot_date),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                platform TEXT NOT NULL,
                asset_name TEXT NOT NULL DEFAULT '',
                asset_type TEXT NOT NULL DEFAULT '',
                symbol TEXT NOT NULL DEFAULT '',
                quantity REAL NOT NULL DEFAULT 0,
                price REAL NOT NULL DEFAULT 0,
                fee REAL NOT NULL DEFAULT 0,
                cash_amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '',
                fx_rate REAL NOT NULL DEFAULT 1,
                quote_source TEXT NOT NULL DEFAULT 'manual',
                quote_date TEXT NOT NULL DEFAULT '',
                realized_profit REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                occurred_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        ensure_user_settings_columns(conn)
        ensure_account_balance_columns(conn)
        ensure_asset_columns(conn)
        ensure_admin_user(conn)
        conn.commit()


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
    ).hex()


def create_session_token(user_id: int) -> str:
    expires_at = int((datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).timestamp())
    payload = f"{user_id}:{expires_at}"
    signature = hmac.new(APP_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).decode("utf-8")
    return f"{payload}:{encoded_signature}"


def verify_session_token(token: str) -> int:
    try:
        user_id_text, expires_at_text, signature = token.split(":", 2)
        payload = f"{user_id_text}:{expires_at_text}"
        expected = base64.urlsafe_b64encode(
            hmac.new(APP_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
        ).decode("utf-8")
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        if int(expires_at_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return int(user_id_text)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录") from exc


def read_json_url(url: str) -> Any:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def read_eastmoney_json_url(url: str) -> Any:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://quote.eastmoney.com/",
        "Origin": "https://quote.eastmoney.com",
        "Connection": "keep-alive",
    }
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            request = Request(url, headers=headers)
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                sleep(0.35)
    raise last_error if last_error else RuntimeError("Eastmoney request failed")


def read_text_url(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=20) as response:
        content_type = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(content_type, errors="ignore")


def fetch_fx_rate_primary(base_currency: str, quote_currency: str) -> float:
    payload = read_json_url(f"https://api.frankfurter.dev/v2/rate/{base_currency}/{quote_currency}")
    if isinstance(payload, (int, float)):
        return float(payload)
    if payload.get("rate"):
        return float(payload["rate"])
    if payload.get("rates") and payload["rates"].get(quote_currency):
        return float(payload["rates"][quote_currency])
    raise ValueError("Primary FX payload invalid")


def fetch_fx_rate_fallback(base_currency: str, quote_currency: str) -> float:
    payload = read_json_url(f"https://open.er-api.com/v6/latest/{base_currency}")
    if payload.get("result") != "success":
        raise ValueError("Fallback FX payload invalid")
    rates = payload.get("rates", {})
    if quote_currency not in rates:
        raise ValueError("Fallback FX quote missing")
    return float(rates[quote_currency])


def fetch_fx_rates(currencies: list[str], quote_currency: str = "CNY") -> dict[str, Any]:
    rates: dict[str, float] = {}
    source = "primary"
    try:
        for currency in currencies:
            rates[currency] = fetch_fx_rate_primary(currency, quote_currency)
        return {"rates": rates, "source": source}
    except Exception:
        source = "fallback"
        for currency in currencies:
            rates[currency] = fetch_fx_rate_fallback(currency, quote_currency)
        return {"rates": rates, "source": source}


def import_tushare():
    try:
        import tushare as ts
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="服务器未安装 tushare，请先安装 requirements.txt") from exc
    return ts


class RegisterPayload(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=100)


class LoginPayload(RegisterPayload):
    pass


class AssetPayload(BaseModel):
    id: str
    name: str
    platform: str
    type: str
    symbol: str
    quantity: float
    costPrice: float
    currentPrice: float = 0
    previousClose: float = 0
    currency: str
    fxRate: float = 1
    quoteSource: str
    quoteDate: str = ""
    quoteFetchedAt: str = ""
    notes: str = ""
    updatedAt: str


class SettingsPayload(BaseModel):
    finnhubKey: str = ""
    tushareToken: str = ""
    autoRefreshInterval: int = 0
    lastSyncAt: str = ""


class AccountBalancePayload(BaseModel):
    platform: str
    freeCash: float = 0
    displayCurrency: str = ""
    updatedAt: str


class BatchQuoteRefreshPayload(BaseModel):
    assets: list[AssetPayload]


class TransactionPayload(BaseModel):
    id: str
    kind: str
    platform: str
    assetName: str = ""
    assetType: str = ""
    symbol: str = ""
    quantity: float = 0
    price: float = 0
    fee: float = 0
    cashAmount: float = 0
    currency: str = ""
    fxRate: float = 0
    quoteSource: str = "manual"
    quoteDate: str = ""
    notes: str = ""
    occurredAt: str


app = FastAPI(title="WealthTrack API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def get_current_user(session_cookie: str | None) -> sqlite3.Row:
    if not session_cookie:
        raise HTTPException(status_code=401, detail="请先登录")
    user_id = verify_session_token(session_cookie)
    with closing(get_db()) as conn:
        user = conn.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def save_asset_record(conn: sqlite3.Connection, user_id: int, payload: AssetPayload) -> None:
    conn.execute(
        """
        INSERT INTO assets (
            id, user_id, name, platform, type, symbol, quantity, cost_price,
            current_price, previous_close, currency, fx_rate, quote_source, quote_date, quote_fetched_at, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            name = excluded.name,
            platform = excluded.platform,
            type = excluded.type,
            symbol = excluded.symbol,
            quantity = excluded.quantity,
            cost_price = excluded.cost_price,
            current_price = excluded.current_price,
            previous_close = excluded.previous_close,
            currency = excluded.currency,
            fx_rate = excluded.fx_rate,
            quote_source = excluded.quote_source,
            quote_date = excluded.quote_date,
            quote_fetched_at = excluded.quote_fetched_at,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        (
            payload.id,
            user_id,
            payload.name,
            payload.platform,
            payload.type,
            payload.symbol,
            payload.quantity,
            payload.costPrice,
            payload.currentPrice,
            payload.previousClose,
            payload.currency,
            payload.fxRate,
            payload.quoteSource,
            payload.quoteDate,
            payload.quoteFetchedAt,
            payload.notes,
            payload.updatedAt,
        ),
    )


def get_matching_asset_row(
    conn: sqlite3.Connection,
    user_id: int,
    platform: str,
    asset_type: str,
    symbol: str,
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, name, platform, type, symbol, quantity, cost_price, current_price,
               previous_close, currency, fx_rate, quote_source, quote_date, quote_fetched_at, notes, updated_at
        FROM assets
        WHERE user_id = ? AND platform = ? AND type = ? AND symbol = ?
        LIMIT 1
        """,
        (user_id, platform, asset_type, symbol),
    ).fetchone()


def row_to_asset_payload(row: sqlite3.Row) -> AssetPayload:
    return AssetPayload(
        id=row["id"],
        name=row["name"],
        platform=row["platform"],
        type=row["type"],
        symbol=row["symbol"],
        quantity=row["quantity"],
        costPrice=row["cost_price"],
        currentPrice=row["current_price"],
        previousClose=row["previous_close"],
        currency=row["currency"],
        fxRate=row["fx_rate"],
        quoteSource=row["quote_source"],
        quoteDate=row["quote_date"],
        quoteFetchedAt=row["quote_fetched_at"],
        notes=row["notes"],
        updatedAt=row["updated_at"],
    )


def list_transactions_for_user(conn: sqlite3.Connection, user_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, kind, platform, asset_name, asset_type, symbol, quantity, price, fee, cash_amount,
               currency, fx_rate, quote_source, quote_date, realized_profit, notes, occurred_at, created_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 100
        """,
        (user_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "kind": row["kind"],
            "platform": row["platform"],
            "assetName": row["asset_name"],
            "assetType": row["asset_type"],
            "symbol": row["symbol"],
            "quantity": row["quantity"],
            "price": row["price"],
            "fee": row["fee"],
            "cashAmount": row["cash_amount"],
            "currency": row["currency"],
            "fxRate": row["fx_rate"],
            "quoteSource": row["quote_source"],
            "quoteDate": row["quote_date"],
            "realizedProfit": row["realized_profit"],
            "notes": row["notes"],
            "occurredAt": row["occurred_at"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def apply_transaction(conn: sqlite3.Connection, user_id: int, payload: TransactionPayload) -> dict[str, Any]:
    kind = str(payload.kind or "").strip().lower()
    if kind not in {"buy", "sell", "deposit", "withdraw"}:
        raise HTTPException(status_code=400, detail="不支持的交易类型")

    platform = str(payload.platform or "").strip().lower()
    if not platform:
        raise HTTPException(status_code=400, detail="缺少平台")

    currency = str(payload.currency or get_platform_currency(platform)).strip().upper() or get_platform_currency(platform)
    fx_rate = resolve_fx_rate_to_cny(currency, payload.fxRate)
    now_text = now_iso()
    account_entry = get_account_balance_entry(conn, user_id, platform)
    current_free_cash = float(account_entry["free_cash"] or 0) if account_entry else 0.0
    display_currency = (
        str(account_entry["display_currency"] or "").strip().upper()
        if account_entry and str(account_entry["display_currency"] or "").strip()
        else currency
    )

    quantity = float(payload.quantity or 0)
    price = float(payload.price or 0)
    fee = float(payload.fee or 0)
    cash_amount = 0.0
    realized_profit = 0.0

    if kind in {"deposit", "withdraw"}:
        raw_amount = float(payload.cashAmount or 0)
        if raw_amount <= 0:
            raise HTTPException(status_code=400, detail="入金或出金金额必须大于 0")
        cash_amount = raw_amount if kind == "deposit" else -raw_amount
        next_free_cash = current_free_cash + cash_amount
        upsert_account_balance(conn, user_id, platform, next_free_cash, display_currency, payload.occurredAt)
    else:
        asset_type = str(payload.assetType or "").strip().lower()
        symbol = str(payload.symbol or "").strip().upper()
        asset_name = str(payload.assetName or "").strip()
        if asset_type not in {"fund", "stock", "crypto", "cash", "liability"}:
            raise HTTPException(status_code=400, detail="缺少有效资产类型")
        if not symbol or quantity <= 0 or price <= 0:
            raise HTTPException(status_code=400, detail="买卖交易需要填写代码、数量和价格")

        matched_row = get_matching_asset_row(conn, user_id, platform, asset_type, symbol)
        matched_asset = row_to_asset_payload(matched_row) if matched_row else None
        gross_amount = quantity * price

        if kind == "buy":
            cash_amount = -(gross_amount + fee)
            next_free_cash = current_free_cash + cash_amount
            base_quantity = matched_asset.quantity if matched_asset else 0.0
            base_cost_total = (matched_asset.quantity * matched_asset.costPrice) if matched_asset else 0.0
            next_quantity = base_quantity + quantity
            next_cost_price = (base_cost_total + gross_amount + fee) / next_quantity if next_quantity > 0 else price

            next_asset = AssetPayload(
                id=matched_asset.id if matched_asset else payload.id,
                name=asset_name or (matched_asset.name if matched_asset else symbol),
                platform=platform,
                type=asset_type,
                symbol=symbol,
                quantity=next_quantity,
                costPrice=next_cost_price,
                currentPrice=price,
                previousClose=matched_asset.previousClose if matched_asset else price,
                currency=currency,
                fxRate=fx_rate,
                quoteSource=payload.quoteSource or (matched_asset.quoteSource if matched_asset else "manual"),
                quoteDate=payload.quoteDate or (matched_asset.quoteDate if matched_asset else ""),
                quoteFetchedAt=now_text,
                notes=(matched_asset.notes if matched_asset else "") or payload.notes,
                updatedAt=now_text,
            )
            save_asset_record(conn, user_id, next_asset)
            upsert_account_balance(conn, user_id, platform, next_free_cash, display_currency, payload.occurredAt)
        else:
            if not matched_asset:
                raise HTTPException(status_code=400, detail="未找到可卖出的持仓")
            if quantity > matched_asset.quantity + 1e-9:
                raise HTTPException(status_code=400, detail="卖出数量超过当前持仓")

            cash_amount = gross_amount - fee
            next_free_cash = current_free_cash + cash_amount
            realized_profit = quantity * (price - matched_asset.costPrice) - fee
            remaining_quantity = matched_asset.quantity - quantity

            if remaining_quantity <= 1e-9:
                conn.execute("DELETE FROM assets WHERE id = ? AND user_id = ?", (matched_asset.id, user_id))
            else:
                next_asset = matched_asset.model_copy(
                    update={
                        "quantity": remaining_quantity,
                        "currentPrice": price,
                        "fxRate": fx_rate,
                        "quoteDate": payload.quoteDate or matched_asset.quoteDate,
                        "quoteFetchedAt": now_text,
                        "updatedAt": now_text,
                    }
                )
                save_asset_record(conn, user_id, next_asset)
            upsert_account_balance(conn, user_id, platform, next_free_cash, display_currency, payload.occurredAt)

    conn.execute(
        """
        INSERT INTO transactions (
            id, user_id, kind, platform, asset_name, asset_type, symbol, quantity, price, fee, cash_amount,
            currency, fx_rate, quote_source, quote_date, realized_profit, notes, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.id,
            user_id,
            kind,
            platform,
            payload.assetName,
            payload.assetType,
            payload.symbol.strip().upper(),
            quantity,
            price,
            fee,
            cash_amount,
            currency,
            fx_rate,
            payload.quoteSource,
            payload.quoteDate,
            realized_profit,
            payload.notes,
            payload.occurredAt,
            now_text,
        ),
    )

    return {
        "transaction": {
            "id": payload.id,
            "kind": kind,
            "platform": platform,
            "assetName": payload.assetName,
            "assetType": payload.assetType,
            "symbol": payload.symbol.strip().upper(),
            "quantity": quantity,
            "price": price,
            "fee": fee,
            "cashAmount": cash_amount,
            "currency": currency,
            "fxRate": fx_rate,
            "quoteSource": payload.quoteSource,
            "quoteDate": payload.quoteDate,
            "realizedProfit": realized_profit,
            "notes": payload.notes,
            "occurredAt": payload.occurredAt,
            "createdAt": now_text,
        }
    }


def is_admin_user(user: sqlite3.Row | dict[str, Any]) -> bool:
    return str(user["username"]).strip().lower() == ADMIN_USERNAME


def get_admin_user_id(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)).fetchone()
    if not row:
        ensure_admin_user(conn)
        row = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)).fetchone()
    return int(row["id"])


def get_shared_settings(conn: sqlite3.Connection) -> sqlite3.Row:
    admin_user_id = get_admin_user_id(conn)
    return ensure_settings(conn, admin_user_id)


def ensure_settings(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    ensure_user_settings_columns(conn)
    settings = conn.execute(
        """
        SELECT user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at
        FROM user_settings
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    if settings:
        admin_user_id = get_admin_user_id(conn)
        if user_id == admin_user_id and (not settings["finnhub_key"] or not settings["tushare_token"]):
            conn.execute(
                """
                UPDATE user_settings
                SET finnhub_key = ?, tushare_token = ?
                WHERE user_id = ?
                """,
                (
                    settings["finnhub_key"] or DEFAULT_FINNHUB_KEY,
                    settings["tushare_token"] or DEFAULT_TUSHARE_TOKEN,
                    user_id,
                ),
            )
            conn.commit()
            settings = conn.execute(
                """
                SELECT user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at
                FROM user_settings
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return settings

    conn.execute(
        """
        INSERT INTO user_settings (user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at)
        VALUES (?, ?, ?, 0, '')
        """,
        (
            user_id,
            DEFAULT_FINNHUB_KEY if user_id == get_admin_user_id(conn) else '',
            DEFAULT_TUSHARE_TOKEN if user_id == get_admin_user_id(conn) else '',
        ),
    )
    conn.commit()
    return conn.execute(
        """
        SELECT user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at
        FROM user_settings
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()


def normalize_cn_symbol(symbol: str, asset_type: str, platform: str) -> str:
    cleaned = symbol.strip().upper()
    if "." in cleaned or not cleaned.isdigit():
        return cleaned

    if asset_type == "fund" and platform == "alipay":
        return f"{cleaned}.OF"

    if cleaned.startswith(("5", "6", "9")):
        return f"{cleaned}.SH"
    return f"{cleaned}.SZ"


def normalize_eastmoney_secid(symbol: str) -> tuple[str, str]:
    normalized = symbol.strip().upper()
    if "." not in normalized:
        raise ValueError(f"Unsupported Eastmoney symbol: {symbol}")
    code, market = normalized.split(".", 1)
    market = market.upper()
    market_map = {"SH": "1", "SZ": "0", "BJ": "0"}
    if market not in market_map:
        raise ValueError(f"Unsupported Eastmoney market: {market}")
    return normalized, f"{market_map[market]}.{code}"


def is_cn_exchange_traded_fund_symbol(symbol: str) -> bool:
    normalized = symbol.strip().upper()
    if re.fullmatch(r"\d{6}\.(SH|SZ)", normalized) is None:
        return False
    code = normalized.split(".", 1)[0]
    return code.startswith(("1", "5"))


def normalize_cn_etf_price_anomaly(
    current_price: float,
    previous_close: float,
    asset_previous_close: float,
    symbol: str,
    asset_type: str,
) -> tuple[float, float]:
    if asset_type != "fund" or not is_cn_exchange_traded_fund_symbol(symbol):
        return current_price, previous_close

    reference_previous_close = float(asset_previous_close or 0)
    if current_price < 10 or reference_previous_close <= 0:
        return current_price, previous_close

    ratio = current_price / reference_previous_close if reference_previous_close else 0
    if 9.5 <= ratio <= 10.5:
        normalized_current = current_price / 10
        normalized_previous = previous_close / 10 if previous_close > 0 else previous_close
        return normalized_current, normalized_previous

    return current_price, previous_close


def read_series_value(record: Any, *candidates: str) -> float:
    for key in candidates:
        for candidate in (key, key.lower(), key.upper()):
            if candidate in record and record[candidate] is not None and str(record[candidate]).strip() != "":
                return float(record[candidate])
    raise KeyError(f"Missing fields: {candidates}")


def to_quote_date(value: Any) -> str:
    if value in (None, ""):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if text.isdigit():
        if len(text) == 8:
            return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        try:
            timestamp = int(text)
            if timestamp > 10_000_000_000:
                timestamp = timestamp / 1000
            return datetime.fromtimestamp(timestamp, BEIJING_TZ).date().isoformat()
        except Exception:
            return ""
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    return ""


def scale_eastmoney_price(value: Any, precision: Any) -> float:
    numeric = float(value or 0)
    digits = int(precision or 2)
    return numeric / (10 ** max(0, digits))


def fetch_eastmoney_realtime_quote(symbol: str) -> dict[str, Any]:
    normalized_symbol, secid = normalize_eastmoney_secid(symbol)
    payload = read_eastmoney_json_url(
        "https://push2.eastmoney.com/api/qt/stock/get?"
        + urlencode(
            {
                "secid": secid,
                "invt": "2",
                "fltt": "2",
                "fields": "f43,f57,f58,f59,f60,f86,f124",
            }
        )
    )
    data = payload.get("data") or {}
    if not data:
        raise ValueError(f"Eastmoney quote missing data: {normalized_symbol}")

    precision = data.get("f59", 2)
    current_price = scale_eastmoney_price(data.get("f43"), precision)
    if current_price <= 0:
        raise ValueError(f"Eastmoney quote missing current price: {normalized_symbol}")

    previous_close = scale_eastmoney_price(data.get("f60"), precision)
    quote_date = to_quote_date(data.get("f124"))
    if not quote_date:
        quote_date = datetime.now(BEIJING_TZ).date().isoformat()

    return {
        "currentPrice": current_price,
        "previousClose": previous_close or current_price,
        "normalizedSymbol": normalized_symbol,
        "quoteSource": "tushare",
        "quoteDate": quote_date,
    }


def read_series_date(record: Any, *candidates: str) -> str:
    for key in candidates:
        for candidate in (key, key.lower(), key.upper()):
            if candidate in record and record[candidate] is not None and str(record[candidate]).strip() != "":
                parsed = to_quote_date(record[candidate])
                if parsed:
                    return parsed
    return ""


def resolve_finnhub_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    api_key = settings["finnhub_key"]
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在设置里填写 Finnhub API Key")

    symbol = asset.symbol.strip().upper()
    query = urlencode({"symbol": symbol, "token": api_key})
    payload = read_json_url(f"https://finnhub.io/api/v1/quote?{query}")
    current_price = float(payload.get("c", 0) or 0)
    if current_price <= 0:
        raise HTTPException(status_code=502, detail="Finnhub 未返回有效报价")

    return {
        "currentPrice": current_price,
        "previousClose": float(payload.get("pc", asset.previousClose) or asset.previousClose),
        "normalizedSymbol": symbol,
        "quoteSource": "finnhub",
        "quoteDate": to_quote_date(payload.get("t")),
    }


def resolve_binance_quote(asset: AssetPayload) -> dict[str, Any]:
    symbol = asset.symbol.strip().upper()
    payload = None
    last_error: Exception | None = None
    for base_url in BINANCE_PUBLIC_BASE_URLS:
        try:
            payload = read_json_url(f"{base_url}/api/v3/ticker/24hr?symbol={symbol}")
            break
        except Exception as exc:
            last_error = exc
    if payload is None:
        raise HTTPException(status_code=502, detail=f"Binance 行情接口不可用：{last_error}")
    return {
        "currentPrice": float(payload.get("lastPrice", 0) or 0),
        "previousClose": float(payload.get("prevClosePrice", asset.previousClose) or asset.previousClose),
        "normalizedSymbol": symbol,
        "quoteSource": "binance",
        "quoteDate": to_quote_date(payload.get("closeTime")),
    }


def resolve_tushare_fund_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    token = settings["tushare_token"]
    if not token:
        raise HTTPException(status_code=400, detail="请先在设置里填写 Tushare Token")

    ts = import_tushare()
    pro = ts.pro_api(token)
    ts_code = normalize_cn_symbol(asset.symbol, asset.type, asset.platform)
    market = "O" if ts_code.endswith(".OF") else "E"
    dataframe = pro.fund_nav(ts_code=ts_code, market=market)
    if dataframe is None or dataframe.empty:
        raise HTTPException(status_code=404, detail=f"Tushare 未找到基金净值：{ts_code}")

    dataframe = dataframe.sort_values("nav_date", ascending=False)
    previous_close = float(dataframe.iloc[1]["unit_nav"]) if len(dataframe.index) > 1 else asset.previousClose
    return {
        "currentPrice": float(dataframe.iloc[0]["unit_nav"]),
        "previousClose": previous_close,
        "normalizedSymbol": ts_code,
        "quoteSource": "tushare",
    }


def resolve_tushare_realtime_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    token = settings["tushare_token"]
    if not token:
        raise HTTPException(status_code=400, detail="请先在设置里填写 Tushare Token")

    ts = import_tushare()
    ts.set_token(token)
    ts_code = normalize_cn_symbol(asset.symbol, asset.type, asset.platform)
    dataframe = ts.realtime_quote(ts_code=ts_code, src="dc")
    if dataframe is None or dataframe.empty:
        raise HTTPException(status_code=404, detail=f"Tushare 未找到实时行情：{ts_code}")

    row = dataframe.iloc[0]
    quote_date = read_series_date(row, "date", "trade_date")
    if not quote_date:
        # Some realtime sources return price fields without an explicit date.
        # For A-share / ETF intraday quotes, treat the quote as today's Beijing trade date.
        quote_date = datetime.now(BEIJING_TZ).date().isoformat()
    return {
        "currentPrice": read_series_value(row, "price", "close", "last"),
        "previousClose": read_series_value(row, "pre_close", "prev_close"),
        "normalizedSymbol": ts_code,
        "quoteSource": "tushare",
        "quoteDate": quote_date,
    }


def resolve_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    if asset.type in {"cash", "liability"} or asset.quoteSource == "manual":
        return {
            "currentPrice": asset.currentPrice,
            "previousClose": asset.previousClose,
            "normalizedSymbol": asset.symbol,
            "quoteSource": "manual",
            "quoteDate": asset.quoteDate,
        }

    if asset.quoteSource == "binance":
        return resolve_binance_quote(asset)

    if asset.quoteSource == "finnhub":
        return resolve_finnhub_quote(asset, settings)

    if asset.quoteSource == "fund_eastmoney":
        return resolve_tushare_fund_quote(asset, settings)

    if asset.quoteSource == "tushare":
        if asset.type == "fund":
            return resolve_tushare_fund_quote(asset, settings)
        return resolve_tushare_realtime_quote(asset, settings)

    raise HTTPException(status_code=400, detail=f"暂不支持的数据源：{asset.quoteSource}")


def check_finnhub_status(settings: sqlite3.Row) -> dict[str, str]:
    api_key = settings["finnhub_key"]
    if not api_key:
        return {"status": "warning", "message": "未填写 API Key", "checkedAt": now_iso()}

    try:
        query = urlencode(
            {
                "function": "GLOBAL_QUOTE",
                "symbol": "IBM",
                "apikey": api_key,
            }
        )
        payload = read_json_url(f"https://www.alphavantage.co/query?{query}")
        quote = payload.get("Global Quote", {})
        if quote and quote.get("05. price"):
            return {"status": "ok", "message": "接口正常", "checkedAt": now_iso()}
        if payload.get("Note") or payload.get("Information") or payload.get("Error Message"):
            return {
                "status": "error",
                "message": str(payload.get("Note") or payload.get("Information") or payload.get("Error Message"))[:120],
                "checkedAt": now_iso(),
            }
        return {"status": "error", "message": "未返回有效报价", "checkedAt": now_iso()}
    except Exception as exc:
        return {"status": "error", "message": f"请求失败：{str(exc)[:80]}", "checkedAt": now_iso()}


def check_tushare_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        pro = ts.pro_api(token)
        dataframe = pro.trade_cal(exchange="SSE", limit=1)
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效数据", "checkedAt": now_iso()}
    except Exception as exc:
        return {"status": "error", "message": f"请求失败或 Token 无效：{str(exc)[:80]}", "checkedAt": now_iso()}


def check_tushare_realtime_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        ts.set_token(token)
        dataframe = ts.realtime_quote(ts_code="600519.SH", src="dc")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "A股 / ETF 实时接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效实时行情", "checkedAt": now_iso()}
    except Exception as exc:
        return {"status": "error", "message": f"Tushare 实时接口异常：{str(exc)[:120]}", "checkedAt": now_iso()}


def check_tushare_fund_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        pro = ts.pro_api(token)
        dataframe = pro.fund_nav(ts_code="000001.OF", market="O")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "基金净值接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效基金净值", "checkedAt": now_iso()}
    except Exception as exc:
        return {"status": "error", "message": f"Tushare 基金接口异常：{str(exc)[:120]}", "checkedAt": now_iso()}


def check_binance_status() -> dict[str, str]:
    last_error: Exception | None = None
    for index, base_url in enumerate(BINANCE_PUBLIC_BASE_URLS):
        try:
            payload = read_json_url(f"{base_url}/api/v3/ticker/24hr?symbol=BTCUSDT")
            if payload.get("lastPrice"):
                source = "primary" if index == 0 else "fallback"
                message = "接口正常" if index == 0 else "备用接口正常"
                return {"status": "ok", "message": message, "source": source, "checkedAt": now_iso()}
        except Exception as exc:
            last_error = exc
    return {"status": "error", "message": f"请求失败：{str(last_error)[:80]}", "source": "unknown", "checkedAt": now_iso()}


def check_fx_status() -> dict[str, str]:
    try:
        result = fetch_fx_rates(["USD"], "CNY")
        source_label = "主接口" if result["source"] == "primary" else "备用接口"
        return {
            "status": "ok",
            "message": f"{source_label}正常",
            "source": result["source"],
            "checkedAt": now_iso(),
        }
    except Exception as exc:
        return {"status": "error", "message": f"请求失败：{str(exc)[:80]}", "source": "unknown", "checkedAt": now_iso()}


def _classify_tushare_status_error(error_text: str, *, fund_mode: bool) -> str:
    lowered = error_text.lower()
    network_keywords = (
        "httpsconnectionpool",
        "max retries exceeded",
        "timed out",
        "timeout",
        "connection aborted",
        "failed to establish a new connection",
        "name or service not known",
    )
    if "没有接口访问权限" in error_text or "权限" in error_text:
        return "基金接口无权限，请检查 Tushare 积分" if fund_mode else "实时接口无权限，请检查 Tushare Token"
    if fund_mode and "doc_id=108" in lowered:
        return "基金接口无权限，请检查 Tushare 积分"
    if any(keyword in lowered for keyword in network_keywords):
        return "基金接口连接失败，请稍后重试" if fund_mode else "实时接口连接失败，请稍后重试"
    return "基金接口请求失败，请稍后重试" if fund_mode else "实时接口请求失败，请稍后重试"


def check_tushare_realtime_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        ts.set_token(token)
        dataframe = ts.realtime_quote(ts_code="600519.SH", src="dc")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "A股 / ETF 实时接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效实时行情", "checkedAt": now_iso()}
    except Exception as exc:
        return {
            "status": "error",
            "message": _classify_tushare_status_error(str(exc), fund_mode=False),
            "checkedAt": now_iso(),
        }


def check_tushare_fund_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        pro = ts.pro_api(token)
        dataframe = pro.fund_nav(ts_code="000001.OF", market="O")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "基金净值接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效基金净值", "checkedAt": now_iso()}
    except Exception as exc:
        return {
            "status": "error",
            "message": _classify_tushare_status_error(str(exc), fund_mode=True),
            "checkedAt": now_iso(),
        }


def fetch_tushare_realtime_dataframe(ts: Any, ts_code: str):
    last_error: Exception | None = None
    for source in ("dc", "dc", "sina"):
        try:
            dataframe = ts.realtime_quote(ts_code=ts_code, src=source)
            if dataframe is not None and not dataframe.empty:
                return dataframe
        except Exception as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    return None


def get_cn_equity_effective_quote_date(token: str) -> str:
    now_bj = datetime.now(BEIJING_TZ)
    reference_date = now_bj.date()
    if (now_bj.hour, now_bj.minute) < (9, 30):
        reference_date = reference_date - timedelta(days=1)

    try:
        ts = import_tushare()
        pro = ts.pro_api(token)
        start_date = (reference_date - timedelta(days=14)).strftime("%Y%m%d")
        end_date = reference_date.strftime("%Y%m%d")
        dataframe = pro.trade_cal(exchange="SSE", start_date=start_date, end_date=end_date)
        if dataframe is not None and not dataframe.empty:
            open_days = dataframe[dataframe["is_open"].astype(str) == "1"].sort_values("cal_date", ascending=False)
            if not open_days.empty:
                quote_date = to_quote_date(open_days.iloc[0]["cal_date"])
                if quote_date:
                    return quote_date
    except Exception:
        pass

    while reference_date.weekday() >= 5:
        reference_date = reference_date - timedelta(days=1)
    return reference_date.isoformat()


def resolve_tushare_realtime_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    token = settings["tushare_token"]
    if not token:
        raise HTTPException(status_code=400, detail="请先在设置里填写 Tushare Token")

    ts = import_tushare()
    ts.set_token(token)
    ts_code = normalize_cn_symbol(asset.symbol, asset.type, asset.platform)
    dataframe = fetch_tushare_realtime_dataframe(ts, ts_code)
    if dataframe is None or dataframe.empty:
        raise HTTPException(status_code=404, detail=f"Tushare 未找到实时行情：{ts_code}")

    row = dataframe.iloc[0]
    return {
        "currentPrice": read_series_value(row, "price", "close", "last"),
        "previousClose": read_series_value(row, "pre_close", "prev_close"),
        "normalizedSymbol": ts_code,
        "quoteSource": "tushare",
    }


def check_tushare_realtime_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        ts.set_token(token)
        dataframe = fetch_tushare_realtime_dataframe(ts, "600519.SH")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "A股 / ETF 实时接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效实时行情", "checkedAt": now_iso()}
    except Exception as exc:
        return {
            "status": "error",
            "message": _classify_tushare_status_error(str(exc), fund_mode=False),
            "checkedAt": now_iso(),
        }


def normalize_fund_symbol(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if cleaned.endswith(".OF"):
        return cleaned[:-3]
    return cleaned


def parse_eastmoney_fund_quote_html(html: str) -> tuple[float, float, str]:
    text = re.sub(r"<[^>]+>", " ", html)
    text = text.replace("&nbsp;", " ").replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)

    current_match = re.search(r"单位净值\s*\(\s*\d{4}-\d{2}-\d{2}\s*\)\s*([0-9]+(?:\.[0-9]+)?)", text)
    quote_date_match = re.search(r"单位净值\s*\(\s*(\d{4}-\d{2}-\d{2})\s*\)", text)
    if not current_match:
        current_match = re.search(r"单位净值\s*\(\s*\d{2}-\d{2}\s*\)\s*([0-9]+(?:\.[0-9]+)?)", text)
    if not current_match:
        raise ValueError("missing current nav")

    history_matches = re.findall(
        r"\d{2}-\d{2}\s+([0-9]+(?:\.[0-9]+)?)\s+[0-9]+(?:\.[0-9]+)?\s+[+-]?[0-9]+(?:\.[0-9]+)?%",
        text,
    )
    current_price = float(current_match.group(1))
    previous_close = float(history_matches[1]) if len(history_matches) > 1 else current_price
    quote_date = quote_date_match.group(1) if quote_date_match else ""
    return current_price, previous_close, quote_date


def resolve_tushare_fund_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    fund_code = normalize_fund_symbol(asset.symbol)
    html = read_text_url(f"https://fund.eastmoney.com/{fund_code}.html")
    current_price, previous_close, quote_date = parse_eastmoney_fund_quote_html(html)
    return {
        "currentPrice": current_price,
        "previousClose": previous_close,
        "normalizedSymbol": f"{fund_code}.OF",
        "quoteSource": "fund_eastmoney",
        "quoteDate": quote_date,
    }


def check_tushare_fund_status(settings: sqlite3.Row) -> dict[str, str]:
    try:
        html = read_text_url("https://fund.eastmoney.com/000001.html")
        current_price, _, _ = parse_eastmoney_fund_quote_html(html)
        if current_price > 0:
            return {"status": "ok", "message": "场外基金净值接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效基金净值", "checkedAt": now_iso()}
    except Exception as exc:
        lowered = str(exc).lower()
        if any(
            keyword in lowered
            for keyword in (
                "httpsconnectionpool",
                "max retries exceeded",
                "timed out",
                "timeout",
                "connection aborted",
                "failed to establish a new connection",
                "name or service not known",
            )
        ):
            message = "基金接口连接失败，请稍后重试"
        else:
            message = "基金接口请求失败，请稍后重试"
        return {"status": "error", "message": message, "checkedAt": now_iso()}


@app.post("/api/auth/register")
def register(payload: RegisterPayload, response: Response) -> dict[str, Any]:
    username = payload.username.strip().lower()
    if username == ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="admin 账号仅供管理员使用")
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")

    salt = secrets.token_hex(16)
    password_hash = hash_password(payload.password, salt)

    with closing(get_db()) as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="用户名已存在")

        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, salt, now_iso()),
        )
        user_id = int(cursor.lastrowid)
        conn.execute(
            """
            INSERT INTO user_settings (user_id, finnhub_key, tushare_token, auto_refresh_interval, last_sync_at)
            VALUES (?, '', '', 0, '')
            """,
            (user_id,),
        )
        conn.commit()

    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(user_id),
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
    )
    return {"user": {"id": user_id, "username": username, "isAdmin": username == ADMIN_USERNAME}}


@app.post("/api/auth/login")
def login(payload: LoginPayload, response: Response) -> dict[str, Any]:
    username = payload.username.strip().lower()
    with closing(get_db()) as conn:
        user = conn.execute(
            "SELECT id, username, password_hash, password_salt, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    password_hash = hash_password(payload.password, user["password_salt"])
    if not hmac.compare_digest(password_hash, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(int(user["id"])),
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
    )
    return {"user": {"id": int(user["id"]), "username": user["username"], "createdAt": user["created_at"], "isAdmin": is_admin_user(user)}}


@app.post("/api/auth/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(SESSION_COOKIE)
    return {"message": "ok"}


@app.get("/api/auth/me")
def me(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    return {"user": {"id": int(user["id"]), "username": user["username"], "createdAt": user["created_at"], "isAdmin": is_admin_user(user)}}


@app.get("/api/assets")
def list_assets(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        rows = conn.execute(
            """
            SELECT id, name, platform, type, symbol, quantity, cost_price, current_price,
                   previous_close, currency, fx_rate, quote_source, quote_date, quote_fetched_at, notes, updated_at
            FROM assets
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user["id"],),
        ).fetchall()

    assets = [
        {
            "id": row["id"],
            "name": row["name"],
            "platform": row["platform"],
            "type": row["type"],
            "symbol": row["symbol"],
            "quantity": row["quantity"],
            "costPrice": row["cost_price"],
            "currentPrice": row["current_price"],
            "previousClose": row["previous_close"],
            "currency": row["currency"],
            "fxRate": row["fx_rate"],
            "quoteSource": row["quote_source"],
            "quoteDate": row["quote_date"],
            "quoteFetchedAt": row["quote_fetched_at"],
            "notes": row["notes"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]
    return {"assets": assets}


@app.post("/api/assets")
def save_asset(payload: AssetPayload, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        save_asset_record(conn, user["id"], payload)
        conn.commit()
    return {"asset": payload.model_dump()}


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, str]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        conn.execute("DELETE FROM assets WHERE id = ? AND user_id = ?", (asset_id, user["id"]))
        conn.commit()
    return {"message": "ok"}


@app.get("/api/settings")
def get_settings(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        settings = get_shared_settings(conn)
    return {
        "settings": {
            "finnhubKey": settings["finnhub_key"],
            "tushareToken": settings["tushare_token"],
            "autoRefreshInterval": settings["auto_refresh_interval"],
            "lastSyncAt": settings["last_sync_at"],
            "canEdit": is_admin_user(user),
        }
    }


@app.put("/api/settings")
def update_settings(payload: SettingsPayload, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="只有管理员可以修改行情设置")
    with closing(get_db()) as conn:
        admin_user_id = get_admin_user_id(conn)
        ensure_settings(conn, admin_user_id)
        conn.execute(
            """
            UPDATE user_settings
            SET finnhub_key = ?, tushare_token = ?, auto_refresh_interval = ?, last_sync_at = ?
            WHERE user_id = ?
            """,
            (
                payload.finnhubKey,
                payload.tushareToken,
                payload.autoRefreshInterval,
                payload.lastSyncAt,
                admin_user_id,
            ),
        )
        conn.commit()
    return {"settings": {**payload.model_dump(), "canEdit": True}}


@app.get("/api/account-balances")
def list_account_balances(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        rows = conn.execute(
            """
            SELECT platform, free_cash, display_currency, updated_at
            FROM account_balances
            WHERE user_id = ?
            ORDER BY platform ASC
            """,
            (user["id"],),
        ).fetchall()
    return {
        "accountBalances": [
            {
                "platform": row["platform"],
                "freeCash": row["free_cash"],
                "displayCurrency": row["display_currency"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
    }


@app.get("/api/transactions")
def list_transactions(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        transactions = list_transactions_for_user(conn, int(user["id"]))
    return {"transactions": transactions}


@app.get("/api/summary/weekly")
def get_weekly_summary(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    today = get_today_beijing_date()
    week_start = get_week_start_date(today)

    with closing(get_db()) as conn:
        ensure_portfolio_snapshot_for_date(conn, int(user["id"]), today)
        current_totals = compute_portfolio_totals(conn, int(user["id"]))
        baseline = conn.execute(
            """
            SELECT snapshot_date, total_assets, captured_at
            FROM portfolio_snapshots
            WHERE user_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
            ORDER BY snapshot_date ASC
            LIMIT 1
            """,
            (int(user["id"]), week_start, today),
        ).fetchone()
        net_external_flow = 0.0
        if baseline:
            external_flow_row = conn.execute(
                """
                SELECT COALESCE(SUM(cash_amount * fx_rate), 0) AS net_flow
                FROM transactions
                WHERE user_id = ?
                  AND kind IN ('deposit', 'withdraw')
                  AND occurred_at > ?
                  AND occurred_at <= ?
                """,
                (int(user["id"]), baseline["captured_at"], now_iso()),
            ).fetchone()
            net_external_flow = float(external_flow_row["net_flow"] or 0) if external_flow_row else 0.0
        conn.commit()

    baseline_date = baseline["snapshot_date"] if baseline else today
    baseline_total_assets = float(baseline["total_assets"] or 0) if baseline else float(current_totals["totalAssets"])
    weekly_profit = float(current_totals["totalAssets"]) - baseline_total_assets - net_external_flow
    base = abs(baseline_total_assets)
    weekly_profit_rate = (weekly_profit / base) * 100 if base > 0 else 0.0

    return {
        "summary": {
            "weekStartDate": week_start,
            "currentDate": today,
            "baselineDate": baseline_date,
            "baselineTotalAssets": baseline_total_assets,
            "currentTotalAssets": float(current_totals["totalAssets"]),
            "netExternalFlow": net_external_flow,
            "profit": weekly_profit,
            "profitRate": weekly_profit_rate,
            "isPartial": baseline_date != week_start,
        }
    }


@app.post("/api/transactions")
def create_transaction(
    payload: TransactionPayload,
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        response = apply_transaction(conn, int(user["id"]), payload)
        conn.commit()
    return response


@app.put("/api/account-balances")
def save_account_balance(
    payload: AccountBalancePayload,
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        conn.execute(
            """
            INSERT INTO account_balances (user_id, platform, free_cash, display_currency, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, platform) DO UPDATE SET
                free_cash = excluded.free_cash,
                display_currency = excluded.display_currency,
                updated_at = excluded.updated_at
            """,
            (user["id"], payload.platform, payload.freeCash, payload.displayCurrency, payload.updatedAt),
        )
        conn.commit()
    return {"accountBalance": payload.model_dump()}


@app.delete("/api/account-balances")
def clear_account_balances(session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, str]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        conn.execute("DELETE FROM account_balances WHERE user_id = ?", (user["id"],))
        conn.commit()
    return {"message": "ok"}


@app.post("/api/quotes/resolve")
def quote_resolve(payload: AssetPayload, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    get_current_user(session_cookie)
    with closing(get_db()) as conn:
        settings = get_shared_settings(conn)
    quote = resolve_quote(payload, settings)
    if "quoteFetchedAt" not in quote or not quote["quoteFetchedAt"]:
        quote["quoteFetchedAt"] = now_iso()
    return {"quote": quote}


@app.post("/api/quotes/refresh")
def quote_refresh_batch(
    payload: BatchQuoteRefreshPayload,
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    assets = payload.assets or []
    if not assets:
        return {"assets": [], "successCount": 0, "failureCount": 0}

    with closing(get_db()) as conn:
        settings = get_shared_settings(conn)

    refreshed_assets: list[dict[str, Any]] = []
    success_count = 0
    failure_count = 0
    worker_count = max(1, min(6, len(assets)))

    def refresh_one(asset: AssetPayload) -> tuple[AssetPayload, bool]:
        try:
            quote = resolve_quote(asset, settings)
            quote_fetched_at = quote.get("quoteFetchedAt") or now_iso()
            updated_asset = asset.model_copy(
                update={
                    "currentPrice": quote.get("currentPrice", asset.currentPrice),
                    "previousClose": quote.get("previousClose", asset.previousClose),
                    "symbol": quote.get("normalizedSymbol") or asset.symbol,
                    "quoteSource": quote.get("quoteSource") or asset.quoteSource,
                    "quoteDate": quote.get("quoteDate") if "quoteDate" in quote else "",
                    "quoteFetchedAt": quote_fetched_at,
                    "updatedAt": now_iso(),
                }
            )
            return updated_asset, True
        except Exception:
            return asset, False

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = list(executor.map(refresh_one, assets))

    with closing(get_db()) as conn:
        for asset, ok in results:
            if ok:
                success_count += 1
                save_asset_record(conn, user["id"], asset)
            else:
                failure_count += 1
            refreshed_assets.append(asset.model_dump())
        conn.commit()

    return {
        "assets": refreshed_assets,
        "successCount": success_count,
        "failureCount": failure_count,
    }


@app.get("/api/fx/rates")
def fx_rates(currencies: str, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    get_current_user(session_cookie)
    currency_list = [item.strip().upper() for item in currencies.split(",") if item.strip()]
    if not currency_list:
        raise HTTPException(status_code=400, detail="缺少汇率币种")
    return fetch_fx_rates(currency_list, "CNY")


@app.get("/api/providers/status")
def provider_status(force: int = 0, session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_current_user(session_cookie)
    with closing(get_db()) as conn:
        settings = get_shared_settings(conn)
    cache_key = (
        "shared",
        settings["finnhub_key"],
        settings["tushare_token"],
    )
    now = time()
    if not force and provider_status_cache["key"] == cache_key and provider_status_cache["expires_at"] > now:
        return {"providers": provider_status_cache["providers"]}
    with ThreadPoolExecutor(max_workers=5) as executor:
        finnhub_future = executor.submit(check_finnhub_status, settings)
        tushare_realtime_future = executor.submit(check_tushare_realtime_status, settings)
        tushare_fund_future = executor.submit(check_tushare_fund_status, settings)
        binance_future = executor.submit(check_binance_status)
        fx_future = executor.submit(check_fx_status)
    providers = {
        "finnhub": finnhub_future.result(),
        "tushareRealtime": tushare_realtime_future.result(),
        "tushareFund": tushare_fund_future.result(),
        "binance": binance_future.result(),
        "fx": fx_future.result(),
    }
    provider_status_cache["key"] = cache_key
    provider_status_cache["expires_at"] = now + PROVIDER_STATUS_CACHE_TTL_SECONDS
    provider_status_cache["providers"] = providers
    return {
        "providers": providers
    }


@app.get("/")
def root() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")


def check_finnhub_status(settings: sqlite3.Row) -> dict[str, str]:
    api_key = settings["finnhub_key"]
    if not api_key:
        return {"status": "warning", "message": "未填写 Finnhub API Key", "checkedAt": now_iso()}

    try:
        query = urlencode({"symbol": "AAPL", "token": api_key})
        payload = read_json_url(f"https://finnhub.io/api/v1/quote?{query}")
        if float(payload.get("c", 0) or 0) > 0:
            return {"status": "ok", "message": "接口正常", "checkedAt": now_iso()}
        if payload.get("error"):
            return {"status": "error", "message": str(payload.get("error"))[:120], "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效报价", "checkedAt": now_iso()}
    except Exception as exc:
        return {"status": "error", "message": f"请求失败：{str(exc)[:120]}", "checkedAt": now_iso()}
def resolve_tushare_realtime_quote(asset: AssetPayload, settings: sqlite3.Row) -> dict[str, Any]:
    token = settings["tushare_token"]
    if not token:
        raise HTTPException(status_code=400, detail="请先在设置里填写 Tushare Token")

    ts = import_tushare()
    ts.set_token(token)
    ts_code = normalize_cn_symbol(asset.symbol, asset.type, asset.platform)
    dataframe = fetch_tushare_realtime_dataframe(ts, ts_code)
    if dataframe is None or dataframe.empty:
        raise HTTPException(status_code=404, detail=f"Tushare 未找到实时行情：{ts_code}")

    row = dataframe.iloc[0]
    quote_date = get_cn_equity_effective_quote_date(token)
    current_price = read_series_value(row, "price", "close", "last")
    previous_close = read_series_value(row, "pre_close", "prev_close")
    current_price, previous_close = normalize_cn_etf_price_anomaly(
        current_price,
        previous_close,
        asset.previousClose,
        ts_code,
        asset.type,
    )
    return {
        "currentPrice": current_price,
        "previousClose": previous_close,
        "normalizedSymbol": ts_code,
        "quoteSource": "tushare",
        "quoteDate": quote_date,
    }


def check_tushare_realtime_status(settings: sqlite3.Row) -> dict[str, str]:
    token = settings["tushare_token"]
    if not token:
        return {"status": "warning", "message": "未填写 Tushare Token", "checkedAt": now_iso()}

    try:
        ts = import_tushare()
        ts.set_token(token)
        dataframe = fetch_tushare_realtime_dataframe(ts, "600519.SH")
        if dataframe is not None and not dataframe.empty:
            return {"status": "ok", "message": "A股 / ETF 实时接口正常", "checkedAt": now_iso()}
        return {"status": "error", "message": "未返回有效实时行情", "checkedAt": now_iso()}
    except Exception as exc:
        return {
            "status": "error",
            "message": _classify_tushare_status_error(str(exc), fund_mode=False),
            "checkedAt": now_iso(),
        }
