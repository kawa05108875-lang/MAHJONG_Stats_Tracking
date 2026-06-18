# MAHJONG Stats Tracking

仲間内の4人麻雀グループで、半荘・局結果・プレイヤー別成績を管理するWebアプリです。

## Stack

- Next.js
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Vercel

## Local Development

```powershell
npm run dev
```

Node.js が PowerShell の PATH に見えていない場合は、同じターミナルで先に実行します。

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm run dev
```

ローカルネットワークの端末から確認する場合は、PCのIPv4アドレスを使います。

```powershell
ipconfig
```

例:

```text
http://192.168.11.29:3000
```

## Environment Variables

`.env.example` をコピーして `.env.local` を作成し、Firebase Console の Web アプリ設定から値を入れます。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Vercel にも同じ環境変数を設定します。

## Firebase

Googleログインを使うため、Firebase Authentication で Google provider を有効にします。

Vercel の本番URLでログインする場合は、Firebase Console の `Authentication` -> `Settings` -> `Authorized domains` に Vercel ドメインを追加します。

Firestore Rules を反映するには次を実行します。

```powershell
npx firebase-tools deploy --only firestore:rules --project mahjong-b0db2
```

CLI が使えない場合は、Firebase Console の `Firestore Database` -> `ルール` に `firestore.rules` の内容を貼り付けて公開します。

## Verification

```powershell
npm run lint
npm run build
```

## Feature Scope

実装済みの主な機能:

- Googleログイン
- グループ作成
- プレイヤー管理
- 半荘作成
- 局入力
- 半荘結果計算
- 成績・ランキング表示
- Firestore Security Rules
- 西入・上がりやめオプション
