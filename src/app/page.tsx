"use client";

import { useAuth } from "@/components/auth-provider";
import { isFirebaseConfigured } from "@/lib/firebase";

export default function Home() {
  const { user, loading, error, signInWithGoogle, logout } = useAuth();

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="stack">
          <p className="eyebrow">Mahjong Score Manager</p>
          <h1>麻雀成績管理</h1>
          <p className="lead">
            半荘、局結果、プレイヤー別成績を管理するための初期セットアップです。
          </p>

          {!isFirebaseConfigured ? (
            <div className="notice">
              <strong>Firebase未設定</strong>
              <span>
                `.env.example` をコピーして `.env.local` を作成し、Firebase ConsoleのWebアプリ設定を入力してください。
              </span>
            </div>
          ) : null}

          {loading ? <p className="muted">認証状態を確認しています...</p> : null}

          {!loading && user ? (
            <div className="account">
              <div>
                <span className="label">ログイン中</span>
                <strong>{user.displayName ?? "名前未設定"}</strong>
                <span className="muted">{user.email}</span>
              </div>
              <button type="button" onClick={logout}>
                ログアウト
              </button>
            </div>
          ) : null}

          {!loading && !user ? (
            <button type="button" className="primary-button" onClick={signInWithGoogle}>
              Googleでログイン
            </button>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
