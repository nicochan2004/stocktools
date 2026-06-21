# Stocktools

監視銘柄リストの移動平均クロス(ゴールデンクロス/デッドクロス)接近・各種指標をグラフで確認できる、GitHub Pages上の静的サイト。

公開URL: https://nicochan2004.github.io/stocktools/

## 仕組み

- `scripts/fetch_data.py` が `scripts/watchlist.yaml` の銘柄について yfinance 経由で株価・PER等の指標・GC/DC判定を取得し、`data/watchlist_data.json` に書き出す
- `.github/workflows/update-data.yml` が平日の日本市場時間帯(9:00〜16:00, 15分おき)に上記スクリプトを自動実行し、データを更新してコミットする
- `watchlist/` のページがそのJSONを読み込み、グラフ・指標・GC/DCバッジを表示する

## 銘柄の追加・削除

ページ右上の「設定」から、このリポジトリへの write 権限を持つ GitHub Personal Access Token を登録すると、ページ上のフォームから銘柄の追加・削除ができる(`scripts/watchlist.yaml` を GitHub Contents API 経由で直接更新する)。トークンはブラウザの localStorage にのみ保存され、サーバーには送信されない。反映には次回のワークフロー実行(最大15分)までの時間がかかる。

## ローカルでのデータ生成

```bash
pip install -r requirements.txt
python scripts/fetch_data.py
```
