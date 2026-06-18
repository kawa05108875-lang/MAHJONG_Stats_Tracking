"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { MatchCreator } from "@/components/match-creator";
import { PlayerManager } from "@/components/player-manager";
import {
  createGroup,
  getJoinedGroups,
  type GroupSummary,
} from "@/lib/firestore/groups";
import { resetGroupMatchData } from "@/lib/firestore/maintenance";

type GroupDashboardProps = {
  user: User;
  onLogout: () => Promise<void>;
};

function formatUma(group: GroupSummary) {
  const { first, second, third, fourth } = group.defaultRule.uma;

  return `${first >= 0 ? "+" : ""}${first} / ${second >= 0 ? "+" : ""}${second} / ${third} / ${fourth}`;
}

export function GroupDashboard({ user, onLogout }: GroupDashboardProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [matchDataVersion, setMatchDataVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.groupId === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const joinedGroups = await getJoinedGroups(user.uid);
      setGroups(joinedGroups);
      setSelectedGroupId((currentGroupId) => {
        if (currentGroupId && joinedGroups.some((group) => group.groupId === currentGroupId)) {
          return currentGroupId;
        }

        return joinedGroups[0]?.groupId ?? null;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "グループ一覧の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループ一覧を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadGroups();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadGroups]);

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = groupName.trim();

    if (!trimmedName) {
      setError("グループ名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const groupId = await createGroup({
        name: trimmedName,
        uid: user.uid,
      });

      setGroupName("");
      await loadGroups();
      setSelectedGroupId(groupId);
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : "グループ作成に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループを作成できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleResetMatchData() {
    if (!selectedGroup) {
      return;
    }

    const confirmed = window.confirm(
      "このグループの半荘、局履歴、成績を削除します。グループとプレイヤーは残ります。実行しますか？",
    );

    if (!confirmed) {
      return;
    }

    setResetting(true);
    setError(null);

    try {
      const result = await resetGroupMatchData(selectedGroup.groupId);
      setMatchDataVersion((current) => current + 1);
      setError(
        `削除しました: 半荘 ${result.deletedMatches}件 / 局履歴 ${result.deletedHands}件 / 成績 ${result.deletedStats}件`,
      );
    } catch (resetError) {
      const message =
        resetError instanceof Error
          ? resetError.message
          : "半荘データの削除に失敗しました。";

      setError(
        message.includes("permission")
          ? "半荘データを削除できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="app-frame">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mahjong Score Manager</p>
          <h1>麻雀成績管理</h1>
        </div>
        <div className="user-menu">
          <span>{user.displayName ?? user.email ?? "ログイン中"}</span>
          <button type="button" onClick={onLogout}>
            ログアウト
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="section-header">
            <div>
              <p className="eyebrow">Groups</p>
              <h2>グループ</h2>
            </div>
            <button type="button" onClick={loadGroups} disabled={loading}>
              更新
            </button>
          </div>

          <form className="form-grid" onSubmit={handleCreateGroup}>
            <label htmlFor="groupName">新規グループ</label>
            <div className="inline-form">
              <input
                id="groupName"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="例: 週末麻雀会"
                maxLength={40}
              />
              <button type="submit" disabled={saving}>
                作成
              </button>
            </div>
          </form>

          {loading ? <p className="muted">グループを読み込んでいます...</p> : null}

          {!loading && groups.length === 0 ? (
            <p className="empty-state">まだグループがありません。</p>
          ) : null}

          <div className="group-list">
            {groups.map((group) => (
              <button
                key={group.groupId}
                type="button"
                className={
                  group.groupId === selectedGroupId ? "group-item is-active" : "group-item"
                }
                onClick={() => setSelectedGroupId(group.groupId)}
              >
                <span>{group.name}</span>
                <small>開始 {group.defaultRule.initialScore.toLocaleString()}点</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="content-area">
          {selectedGroup ? (
            <>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Group Home</p>
                  <h2>{selectedGroup.name}</h2>
                </div>
              </div>

              <div className="metric-grid">
                <div className="metric">
                  <span className="label">開始点</span>
                  <strong>{selectedGroup.defaultRule.initialScore.toLocaleString()}</strong>
                </div>
                <div className="metric">
                  <span className="label">返し点</span>
                  <strong>{selectedGroup.defaultRule.returnScore.toLocaleString()}</strong>
                </div>
                <div className="metric">
                  <span className="label">ウマ</span>
                  <strong>{formatUma(selectedGroup)}</strong>
                </div>
                <div className="metric">
                  <span className="label">トビ終了</span>
                  <strong>
                    {selectedGroup.defaultRule.bankruptcyEnabled ? "あり" : "なし"}
                  </strong>
                </div>
              </div>

              <PlayerManager groupId={selectedGroup.groupId} user={user} />
              <div className="danger-zone">
                <div>
                  <h3>対局データの初期化</h3>
                  <p className="muted">
                    半荘、局履歴、成績だけを削除します。グループとプレイヤーは残ります。
                  </p>
                </div>
                <button
                  type="button"
                  className="danger-button"
                  onClick={handleResetMatchData}
                  disabled={resetting}
                >
                  {resetting ? "削除中..." : "半荘データを削除"}
                </button>
              </div>
              <MatchCreator
                key={`${selectedGroup.groupId}-${matchDataVersion}`}
                group={selectedGroup}
                user={user}
              />

              <div className="placeholder-grid">
                <div>
                  <h3>ランキング概要</h3>
                  <p className="muted">フェーズ8で成績集計後に表示します。</p>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <h2>グループを作成してください</h2>
              <p className="muted">
                グループを作成すると、既定ルールが保存されてホームを確認できます。
              </p>
            </div>
          )}
        </section>
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}
