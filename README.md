# Deep Sea Hunter POC

絵文字だけで遊ぶ、オフライン対応の深海ハンティングPWAです。

## 現在の機能
- p5.jsによる軽量な2D描画（魚は絵文字）
- ゴムを引っ張って離す操作と簡易命中判定
- 捕獲数・スコア・発見済み生物をLocalStorageに保存
- PWA manifestとService Workerによるアプリシェルのキャッシュ
- 図鑑のローカル表示

## 起動
Service WorkerとPWAにはHTTPSまたはlocalhostが必要です。

Pythonがある環境なら、このフォルダーで次を実行し、http://localhost:8000 を開きます。

```sh
python -m http.server 8000
```

初回はオンラインで開いてp5.jsをキャッシュしてください。その後、Service Workerが有効になった状態ならオフライン起動できます。初回ロード前の完全オフライン起動はできません。

## 次のステップ
- 実機でタッチ操作・オフライン起動を確認
- ARカメラ背景を追加（通常背景モードも維持）
- 絵文字をローポリの3Dオブジェクトへ差し替え
- 必要になった段階でAPIやオンライン同期を検討

## 技術
HTML / CSS / JavaScript / p5.js / PWA。TypeScript・バックエンド・AIは使用していません。