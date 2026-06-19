"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { MatchCreator } from "@/components/match-creator";
import { PlayerManager } from "@/components/player-manager";
import { StatsDashboard } from "@/components/stats-dashboard";
import {
  createGroup,
  getJoinedGroups,
  joinGroup,
  type GroupSummary,
} from "@/lib/firestore/groups";

type GroupDashboardProps = {
  user: User;
  onLogout: () => Promise<void>;
};

type DashboardView = "groups" | "ranking" | "matches" | "players" | "rules";

const VIEW_LABELS: Array<{ key: Exclude<DashboardView, "groups">; label: string }> = [
  { key: "ranking", label: "ランキング" },
  { key: "matches", label: "半荘" },
  { key: "players", label: "メンバー" },
  { key: "rules", label: "ルール" },
];

function formatUma(group: GroupSummary) {
  const { first, second, third, fourth } = group.defaultRule.uma;

  return `${first >= 0 ? "+" : ""}${first} / ${second >= 0 ? "+" : ""}${second} / ${third} / ${fourth}`;
}

export function GroupDashboard({ user, onLogout }: GroupDashboardProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>("groups");
  const [groupName, setGroupName] = useState("");
  const [joinGroupId, setJoinGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
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
      setActiveView("ranking");
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

  async function handleJoinGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedGroupId = joinGroupId.trim();

    if (!trimmedGroupId) {
      setError("参加するグループIDを入力してください。");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const groupId = await joinGroup({
        groupId: trimmedGroupId,
        uid: user.uid,
      });

      setJoinGroupId("");
      await loadGroups();
      setSelectedGroupId(groupId);
      setActiveView("ranking");
    } catch (joinError) {
      const message =
        joinError instanceof Error
          ? joinError.message
          : "グループ参加に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループに参加できませんでした。グループIDまたはFirestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setJoining(false);
    }
  }

  function handleSelectGroup(groupId: string) {
    setSelectedGroupId(groupId);
    setActiveView("ranking");
  }

  const showGroupSelector = activeView === "groups" || !selectedGroup;

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

      <section className="workspace flow-workspace">
        {showGroupSelector ? (
          <section className="content-area group-selector-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Groups</p>
                <h2>グループを選択</h2>
              </div>
            </div>

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
                  onClick={() => handleSelectGroup(group.groupId)}
                >
                  <span>{group.name}</span>
                  <small>開始 {group.defaultRule.initialScore.toLocaleString()}点</small>
                </button>
              ))}
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

            <form className="form-grid" onSubmit={handleJoinGroup}>
              <label htmlFor="joinGroupId">グループIDで参加</label>
              <div className="inline-form">
                <input
                  id="joinGroupId"
                  value={joinGroupId}
                  onChange={(event) => setJoinGroupId(event.target.value)}
                  placeholder="共有されたグループID"
                />
                <button type="submit" disabled={joining}>
                  参加
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="content-area">
            {selectedGroup ? (
              <>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Group Home</p>
                  <h2>{selectedGroup.name}</h2>
                  <p className="share-code">グループID: {selectedGroup.groupId}</p>
                </div>
                <button type="button" onClick={() => setActiveView("groups")}>
                  グループ変更
                </button>
              </div>

              <div className="flow-nav" aria-label="グループ内メニュー">
                {VIEW_LABELS.map((view) => (
                  <button
                    key={view.key}
                    type="button"
                    className={activeView === view.key ? "is-active" : ""}
                    onClick={() => setActiveView(view.key)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>

              {activeView === "ranking" ? (
                <StatsDashboard groupId={selectedGroup.groupId} />
              ) : null}

              {activeView === "matches" ? (
                <MatchCreator key={selectedGroup.groupId} group={selectedGroup} user={user} />
              ) : null}

              {activeView === "players" ? (
                <PlayerManager groupId={selectedGroup.groupId} user={user} />
              ) : null}

              {activeView === "rules" ? (
                <>
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

                  <div className="metric-grid">
                    <div className="metric">
                      <span className="label">西入</span>
                      <strong>
                        {selectedGroup.defaultRule.westRoundEnabled ? "あり" : "なし"}
                      </strong>
                    </div>
                    <div className="metric">
                      <span className="label">上がりやめ</span>
                      <strong>
                        {selectedGroup.defaultRule.agariYameEnabled ?? true ? "あり" : "なし"}
                      </strong>
                    </div>
                  </div>
                </>
              ) : null}
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
        )}
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}
