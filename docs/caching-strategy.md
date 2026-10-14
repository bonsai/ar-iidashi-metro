# キャッシュ戦略（Service Worker）

`sw.js` のキャッシュルールと、ファイルを変更したときの必須事項をまとめたものです。
Issue #5 で cache-first をやめ、同一オリジンを network-first に変更しました。

## ルールの要約

| 対象 | 戦略 | フォールバック先 |
| --- | --- | --- |
| 同一オリジン（`./index.html` `./style.css` `./game.js` `./manifest.webmanifest` `./icon.svg`） | **network-first**（`cache: 'no-cache'` で毎回再検証） | キャッシュ → ナビゲーション要求なら `index.html` |
| `p5.js`（jsdelivr CDN） | **cache-first**（変更なし。Issue #6 で扱う） | ネットワーク（無ければ失敗） |

キャッシュ世代は `deep-sea-hunter-v{CACHE_VERSION}`。`activate` が現在の世代以外をすべて削除します。

## なぜ cache-first をやめたのか

cache-first のままだと、次の連鎖が起きます。

1. `sw.js` を変えない限り Service Worker 本体は更新されない。
2. Service Worker が更新されないと `sw.js:23` の `cache.match()` が**古い `game.js`** を返し続ける。
3. GitHub Actions は main への push で自動デプロイするのに、古いクライアントには何も届かない。

つまり自動デプロイが push に対して実質 no-op になっていました（KPI「反映までのセッション数: 無期限」）。
network-first にすると、Service Worker の更新を待たずに**その場で**ネットワーク上の最新版を返せるので、
「反映までのセッション数」が 1 セッションになります。

## 変更時に守るべきルール

### 1. 同一オリジンのファイルを触ったら、`CACHE_VERSION` を上げる

`APP_SHELL` の**ファイル一覧**を変えた場合（`icon.png` を追加した、`index.html` を分割した、など）は、
`sw.js` の `CACHE_VERSION` を必ず上げます。上げないと古い世代に古いファイルが残り、
インストール時に取得し損ねたファイルがオフラインで欠落します。

```js
const CACHE_VERSION = 2;  // -> 3
```

参照侧でファイルを足すだけの変更（`game.js` や `style.css` の**中身**だけの変更）は
versioning 不要です。network-first がネットワークから拾い直すので、
`CACHE_VERSION` を上げると逆に古いクライアントが一度だけ巻き戻ります。

### 2. `sw.js` 自体を編集した時点で Service Worker は更新される

`sw.js` を編集すると次の訪問時にブラウザが更新を検知し、`install` → `skipWaiting()` →
`activate`（古い世代を削除）→ `clients.claim()` が走ります。段階的な更新にはしません。

### 3. `NETWORK_TIMEOUT_MS` は「応答が無い」ためのガード

無応答な回線では `fetch` が解決しないので、`AbortController` で 4000ms で打ち切ります。
タイムアウト時は通常のオフラインと同じくキャッシュへフォールバックします。
実測ではサーバー応答なしでも 8 秒程度で画面が出ます（`index.html` と `game.js` で 2 回タイムアウトするため）。

### 4. p5.js の挙動は意図的に変えていない

`P5_URL` は jsdelivr の CDN で、インストール時にキャッシュし、取得時は cache-first です。
CDN を自前ホストする作業は Issue #6 のスコープです。

## 検証

`scripts/verify-sw-cache-strategy.py` が、Playwright + 同梱 Chromium で実際にブラウザを動かして確認します。
静的レビューでは「既に SW を導入済みだったクライアント」が再現できないため、必要に応じて実行してください。

```sh
pip install playwright && playwright install chromium

# 修正前の挙動の再現（BUILD-1 に取り残される）
python3 scripts/verify-sw-cache-strategy.py --expect-stale

# 修正後（v1 導入済みクライアントが v2 へ移行する）
python3 scripts/verify-sw-cache-strategy.py --expect-fresh \
    --sw-before /tmp/sw-before.js --sw-after ./sw.js

# sw.js を変えず game.js だけ push した場合（受入条件そのもの）
python3 scripts/verify-sw-cache-strategy.py --expect-fresh \
    --sw-before ./sw.js --sw-after ./sw.js
```

同一のブラウザプロファイルを使い回すことで、Cache Storage と Service Worker 登録が訪問をまたいで永続し、
「既に SW を導入済みだったクライアントで再訪問する」状況を再現しています。

## 実測結果（Chromium 1228 / Playwright 1.61.0）

`game.js` の先頭に `window.__BUILD__ = 'BUILD-2';` を挿入して擬似デプロイし、
同じプロファイルで再訪問した結果。

### 修正前（cache-first・`CACHE_NAME` 固定）

```text
[visit 1] sw=sw-before.js build=BUILD-1 caches=['deep-sea-hunter-v1']
[deploy]   game.js を BUILD-1 -> BUILD-2 に差し替え / sw.js: 変更なし
[visit 2] sw update: {'updated': False, 'before': 'activated', 'after': 'activated'}
[visit 2] online build=BUILD-1 caches=['deep-sea-hunter-v1']
```

`updated: False`（`sw.js` が同一バイトなので Service Worker が更新されない）→ `BUILD-1` のまま。
これが Issue #5 の症状です。

### 修正後（network-first・`CACHE_VERSION = 2`）

`sw.js` を差し替えて再訪問した場合：

```text
[visit 1] sw=sw-before.js build=BUILD-1 caches=['deep-sea-hunter-v1']
[deploy]   game.js を BUILD-1 -> BUILD-2 に差し替え / sw.js: 差し替え
[visit 2] sw update: {'updated': True, 'after': 'activated'}
[visit 2] online build=BUILD-2 caches=['deep-sea-hunter-v2']
[visit 2] offline build=BUILD-2 canvas=True p5=True start=True
[visit 2] hung network: 8.16s で描画（ビルド BUILD-2 / canvas True）
```

`sw.js` を**変えずに** `game.js` だけ push した場合（受入条件そのもの）：

```text
[visit 1] sw=sw.js build=BUILD-1 caches=['deep-sea-hunter-v2']
[deploy]   game.js を BUILD-1 -> BUILD-2 に差し替え / sw.js: 変更なし
[visit 2] sw update: {'updated': False, 'before': 'activated', 'after': 'activated'}
[visit 2] online build=BUILD-2 caches=['deep-sea-hunter-v2']
[visit 2] offline build=BUILD-2 canvas=True p5=True start=True
[visit 2] hung network: 8.13s で描画（ビルド BUILD-2 / canvas True）
```

`updated: False` でも `BUILD-2` が届いています。Service Worker の更新を待つ必要がありません。

キャッシュ内容（`caches.keys()` と各キャッシュのエントリ）:

```text
caches.keys() = ['deep-sea-hunter-v2']
/                     @127.0.0.1
/game.js              @127.0.0.1
/icon.svg             @127.0.0.1
/index.html           @127.0.0.1
/manifest.webmanifest @127.0.0.1
/style.css            @127.0.0.1
/npm/p5@1.11.3/lib/p5.min.js @cdn.jsdelivr.net
```

旧世代 `deep-sea-hunter-v1` は残っていません。