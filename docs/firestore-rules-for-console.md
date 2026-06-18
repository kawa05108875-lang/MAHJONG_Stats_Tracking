# Firestore Rules 貼り付け用

Firebase Console の `Firestore Database` -> `ルール` に、プロジェクトルートの `firestore.rules` と同じ内容を貼り付けて公開してください。

フェーズ9のRules方針:

- 未ログインユーザーは全Firestoreデータにアクセス不可。
- `users` は本人のドキュメントだけ読み書き可能。
- `groups`、`players`、`matches`、`hands`、`playerStats` は対象グループの `groupMembers` に存在するログインユーザーだけ読み書き可能。
- `groupMembers` は本人の参加情報だけ読める。作成は本人の `uid` で `role: "member"` のみ許可。
- `groupId`、各ドキュメントID、作成者、作成日時などの不変フィールドは更新不可。
- 未定義コレクションと想定外操作はすべて拒否。

最新のRules本文は [firestore.rules](../firestore.rules) を参照してください。
