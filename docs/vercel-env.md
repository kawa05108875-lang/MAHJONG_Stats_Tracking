# Vercel環境変数設定

Vercelにデプロイする場合、ローカルの `.env.local` と同じFirebase設定値をVercelにも登録する。

## 登録する環境変数

Vercelの `Project Settings` → `Environment Variables` に以下を追加する。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

値はFirebase ConsoleのWebアプリ設定に表示される `firebaseConfig` からコピーする。

## Firebase Consoleとの対応

```ts
const firebaseConfig = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY に入れる",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN に入れる",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID に入れる",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET に入れる",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID に入れる",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID に入れる"
};
```

`.env.local` と同じく、Vercelの値にもダブルクォーテーションと末尾カンマは含めない。

## Environmentの選択

まずは以下すべてに同じ値を設定してよい。

- Production
- Preview
- Development

本番用と開発用でFirebaseプロジェクトを分ける場合は、それぞれ別の値を設定する。

## 設定後に必要なこと

- Vercelの環境変数を変更したら、再デプロイが必要。
- Googleログインを本番URLで使う場合、Firebase Authenticationの承認済みドメインにVercelのドメインが必要。

通常、Firebase Authenticationには `localhost` と `firebaseapp.com` 系のドメインが最初から入っている。Vercelの本番URLでログインできない場合は、Firebase Consoleの `Authentication` → `Settings` → `Authorized domains` に以下を追加する。

```text
your-app.vercel.app
```

