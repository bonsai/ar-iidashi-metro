# Deep Sea Hunter POC

絵文字だけで遊ぶ、オフライン対応の深海ハンティングPWAです。

## 現在の機能
- p5.jsによる軽量な2D描画（魚は絵文字）
- ゴムを引っ張って離す操作と簡易命中判定
- 捕獲数・スコア・発見済み生物をLocalStorageに保存
- PWA manifestとService Workerによるアプリシェルのキャッシュ（同一オリジンは network-first）
- 図鑑のローカル表示

## 起動
Service WorkerとPWAにはHTTPSまたはlocalhostが必要です。

Pythonがある環境なら、このフォルダーで次を実行し、http://localhost:8000 を開きます。

```sh
python -m http.server 8000
```

初回はオンラインで開いてp5.jsをキャッシュしてください。その後、Service Workerが有効になった状態ならオフライン起動できます。初回ロード前の完全オフライン起動はできません。

## キャッシュ戦略

同一オリジン（`index.html` / `style.css` / `game.js` など）は **network-first** で配信します。
`game.js` だけを push しても、既存の訪問者が再訪問した時点で新しいコードが届きます。

変更時は次のルールに従ってください。詳細は [docs/caching-strategy.md](docs/caching-strategy.md)。

- 同一オリジンのファイル（アプリシェル）は **network-first**。cache-first に戻さないこと。
- `APP_SHELL` の**ファイル一覧**を変えたら `sw.js` の `CACHE_VERSION` を上げる（現在は `2`）。
  古い世代は `activate` が削除する。中身だけの変更では上げなくてよい。
- ネットワークが応答しない場合はタイムアウト（`NETWORK_TIMEOUT_MS`）後、キャッシュ →
  `index.html` の順にフォールバックする。オフライン起動は従来どおり playable。

検証は実ブラウザ（Playwright + Chromium）で実行します。

```sh
pip install playwright && playwright install chromium
python3 scripts/verify-sw-cache-strategy.py --expect-fresh
```

## 次のステップ
- 実機でタッチ操作・オフライン起動を確認
- ARカメラ背景を追加（通常背景モードも維持）
- 絵文字をローポリの3Dオブジェクトへ差し替え
- 必要になった段階でAPIやオンライン同期を検討

## 技術
HTML / CSS / JavaScript / p5.js / PWA。TypeScript・バックエンド・AIは使用していません。