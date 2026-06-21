"""監視銘柄リストの株価・指標・GC/DC判定を取得し、data/watchlist_data.json に書き出す。

GitHub Actionsから定期実行される。ロジックは「00_AI workplace/株」フォルダの
src/cross_signals.py・src/price_sources/yfinance_source.py を移植したもの。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yaml
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST_PATH = ROOT / "scripts" / "watchlist.yaml"
OUTPUT_PATH = ROOT / "data" / "watchlist_data.json"

NEAR_THRESHOLD = 0.02
CONVERGE_LOOKBACK = 10
CONVERGE_RATIO = 0.7
PAIRS = (("ma5", "ma25", "5x25"), ("ma25", "ma75", "25x75"))


def load_watchlist() -> list[dict]:
    data = yaml.safe_load(WATCHLIST_PATH.read_text(encoding="utf-8")) or []
    return [{"code": str(item["code"]), "name": item.get("name", "")} for item in data]


def add_moving_averages(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ma5"] = df["close"].rolling(5).mean()
    df["ma25"] = df["close"].rolling(25).mean()
    df["ma75"] = df["close"].rolling(75).mean()
    return df


def _analyze_pair(diff: pd.Series, price: float, label: str) -> dict | None:
    diff_now = diff.iloc[-1]
    diff_prev = diff.iloc[-2]
    diff_ref = diff.iloc[-(CONVERGE_LOOKBACK + 1)] if len(diff) > CONVERGE_LOOKBACK else diff.iloc[0]

    crossed = (diff_now > 0) != (diff_prev > 0)
    if crossed:
        kind = "ゴールデンクロス" if diff_now > 0 else "デッドクロス"
        return {"pair": label, "kind": kind, "status": "発生", "text": f"{label} {kind}発生（直近）"}

    near = abs(diff_now) / price < NEAR_THRESHOLD if price else False
    converging = abs(diff_ref) > 0 and abs(diff_now) < abs(diff_ref) * CONVERGE_RATIO
    if near and converging:
        kind = "デッドクロス" if diff_now > 0 else "ゴールデンクロス"
        return {"pair": label, "kind": kind, "status": "接近", "text": f"{label} {kind}接近"}
    return None


def detect_signals(df: pd.DataFrame) -> list[dict]:
    if len(df) < 80:
        return []
    price = df["close"].iloc[-1]
    signals = []
    for short_col, long_col, label in PAIRS:
        result = _analyze_pair(df[short_col] - df[long_col], price, label)
        if result:
            signals.append(result)
    return signals


def _clean(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, float)):
        return float(value)
    return value


def fetch_one(code: str, name: str) -> dict:
    ticker = yf.Ticker(f"{code}.T")

    history = ticker.history(period="6mo").reset_index().rename(columns={"Date": "date", "Close": "close"})
    history["date"] = pd.to_datetime(history["date"]).dt.strftime("%Y-%m-%d")
    history = add_moving_averages(history[["date", "close"]])

    fast_info = ticker.fast_info
    price = float(fast_info["lastPrice"])
    prev_close = float(fast_info["previousClose"])
    change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0

    info = ticker.get_info()
    fundamentals = {
        "name": name or info.get("longName") or info.get("shortName"),
        "per": _clean(info.get("trailingPE")),
        "forward_per": _clean(info.get("forwardPE")),
        "pbr": _clean(info.get("priceToBook")),
        "dividend_yield": _clean(info.get("dividendYield")),
        "market_cap": _clean(info.get("marketCap")),
        "eps": _clean(info.get("trailingEps")),
        "roe": _clean(info.get("returnOnEquity")),
        "week52_high": _clean(info.get("fiftyTwoWeekHigh")),
        "week52_low": _clean(info.get("fiftyTwoWeekLow")),
        "avg_volume": _clean(info.get("averageVolume")),
    }

    return {
        "code": code,
        "name": fundamentals["name"] or name or code,
        "price": _clean(price),
        "change_pct": _clean(change_pct),
        "history": [
            {
                "date": row["date"],
                "close": _clean(row["close"]),
                "ma5": _clean(row["ma5"]),
                "ma25": _clean(row["ma25"]),
                "ma75": _clean(row["ma75"]),
            }
            for _, row in history.iterrows()
        ],
        "fundamentals": fundamentals,
        "signals": detect_signals(history),
    }


def main():
    watchlist = load_watchlist()
    stocks = []
    errors = []

    for item in watchlist:
        code, name = item["code"], item["name"]
        try:
            stocks.append(fetch_one(code, name))
        except Exception as e:
            errors.append(f"{code} {name}: {e}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stocks": stocks,
        "errors": errors,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"watchlist: {len(watchlist)}件 / 成功: {len(stocks)}件 / エラー: {len(errors)}件")


if __name__ == "__main__":
    main()
