# Firebase設定手順

## 1. Firebase Consoleで行うこと

1. Firebase Consoleで新しいプロジェクトを作成する。
2. Authenticationを開き、Googleログインを有効にする。
3. Firestore Databaseを作成する。
4. Webアプリを追加し、Firebase設定値を取得する。

## 2. ローカル環境変数

`.env.example` を `.env.local` にコピーし、Firebase ConsoleのWebアプリ設定値を入力する。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

## 3. 起動確認

```bash
npm run dev
```

ブラウザで `http://127.0.0.1:3000` を開く。

`.env.local` が未設定の場合、画面にFirebase未設定の案内が表示される。

## 4. Firestore Rules

ログイン後に `users/{uid}` へユーザー情報を書き込むため、Firestore Rulesに以下を設定する。

Firebase Consoleの `Firestore Database` から `ルール` タブを開き、`firestore.rules` と同じ内容を貼り付けて公開する。

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }

    function isSelf(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    match /users/{uid} {
      allow read, create, update: if isSelf(uid);
      allow delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

この設定により、ログインユーザーは自分の `users/{uid}` だけを読み書きできる。
