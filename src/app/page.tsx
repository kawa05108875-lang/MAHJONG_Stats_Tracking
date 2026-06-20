"use client";

import { GroupDashboard } from "@/components/group-dashboard";
import { useAuth } from "@/components/auth-provider";
import { isFirebaseConfigured } from "@/lib/firebase";

export default function Home() {
  const { user, loading, error, debugInfo, signInWithGoogle, logout } = useAuth();

  if (!loading && user) {
    return <GroupDashboard user={user} onLogout={logout} />;
  }

  return (
    <main className="app-shell">
      <section className="panel brand-panel">
        <div className="stack">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">雀</span>
            <div>
              <p className="eyebrow">Mahjong Logbook</p>
              <h1>ジャンログ</h1>
            </div>
          </div>
          <p className="lead">
            半荘、局結果、プレイヤー別成績をすばやく残せる麻雀ログアプリです。
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

          <button type="button" className="primary-button" onClick={signInWithGoogle}>
            Googleでログイン
          </button>

          {error ? <p className="error">{error}</p> : null}
          {debugInfo ? <p className="muted">{debugInfo}</p> : null}
        </div>
      </section>
    </main>
  );
}
