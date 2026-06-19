"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  createPlayer,
  deleteUnusedPlayer,
  getGroupPlayers,
  updatePlayerLinkedUid,
  updatePlayerName,
  type PlayerSummary,
} from "@/lib/firestore/players";

type PlayerManagerProps = {
  groupId: string;
  user: User;
  onOpenPlayerStats: (playerId: string) => void;
};

function notifyPlayersChanged(groupId: string) {
  window.dispatchEvent(
    new CustomEvent("mahjong:players-changed", {
      detail: { groupId },
    }),
  );
}

export function PlayerManager({ groupId, user, onOpenPlayerStats }: PlayerManagerProps) {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [name, setName] = useState("");
  const [linkToMe, setLinkToMe] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedPlayerId = useMemo(
    () => players.find((player) => player.linkedUid === user.uid)?.playerId ?? null,
    [players, user.uid],
  );

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setPlayers(await getGroupPlayers(groupId));
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "プレイヤー一覧の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "プレイヤー一覧を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPlayers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadPlayers]);

  async function handleCreatePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("プレイヤー名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createPlayer({
        groupId,
        name: trimmedName,
        linkedUid: linkToMe ? user.uid : null,
      });

      setName("");
      setLinkToMe(false);
      await loadPlayers();
      notifyPlayersChanged(groupId);
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : "プレイヤー作成に失敗しました。";

      setError(
        message.includes("permission")
          ? "プレイヤーを作成できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditing(player: PlayerSummary) {
    setEditingPlayerId(player.playerId);
    setEditingName(player.name);
    setError(null);
  }

  async function handleUpdatePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingPlayerId) {
      return;
    }

    const trimmedName = editingName.trim();

    if (!trimmedName) {
      setError("プレイヤー名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updatePlayerName({
        playerId: editingPlayerId,
        name: trimmedName,
      });

      setEditingPlayerId(null);
      setEditingName("");
      await loadPlayers();
      notifyPlayersChanged(groupId);
    } catch (updateError) {
      const message =
        updateError instanceof Error
          ? updateError.message
          : "プレイヤー名の更新に失敗しました。";

      setError(
        message.includes("permission")
          ? "プレイヤー名を更新できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlayer(player: PlayerSummary) {
    const confirmed = window.confirm(
      `${player.name} を削除します。半荘で使用済みの場合は削除できません。`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteUnusedPlayer({
        groupId,
        playerId: player.playerId,
      });

      await loadPlayers();
      notifyPlayersChanged(groupId);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error
          ? deleteError.message
          : "プレイヤー削除に失敗しました。";

      setError(
        message.includes("permission")
          ? "プレイヤーを削除できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkPlayer(player: PlayerSummary) {
    setSaving(true);
    setError(null);

    try {
      await updatePlayerLinkedUid({
        playerId: player.playerId,
        linkedUid: user.uid,
      });

      await loadPlayers();
      notifyPlayersChanged(groupId);
    } catch (linkError) {
      const message =
        linkError instanceof Error
          ? linkError.message
          : "Googleアカウントとの紐づけに失敗しました。";

      setError(
        message.includes("permission")
          ? "Googleアカウントと紐づけできませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlinkPlayer(player: PlayerSummary) {
    setSaving(true);
    setError(null);

    try {
      await updatePlayerLinkedUid({
        playerId: player.playerId,
        linkedUid: null,
      });

      await loadPlayers();
      notifyPlayersChanged(groupId);
    } catch (unlinkError) {
      const message =
        unlinkError instanceof Error
          ? unlinkError.message
          : "Googleアカウントとの紐づけ解除に失敗しました。";

      setError(
        message.includes("permission")
          ? "Googleアカウントとの紐づけを解除できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="manager-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Players</p>
          <h3>メンバー管理</h3>
        </div>
      </div>

      <form className="form-grid" onSubmit={handleCreatePlayer}>
        <label htmlFor="playerName">プレイヤー追加</label>
        <div className="inline-form">
          <input
            id="playerName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: kawa"
            maxLength={30}
          />
          <button type="submit" disabled={saving}>
            追加
          </button>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={linkToMe}
            disabled={Boolean(linkedPlayerId)}
            onChange={(event) => setLinkToMe(event.target.checked)}
          />
          <span>
            {linkedPlayerId
              ? "自分に紐づいたプレイヤーは登録済みです"
              : "このプレイヤーを自分のログインユーザーに紐づける"}
          </span>
        </label>
      </form>

      {loading ? <p className="muted">プレイヤーを読み込んでいます...</p> : null}

      {!loading && players.length === 0 ? (
        <p className="empty-state">まだプレイヤーがありません。4人以上登録してください。</p>
      ) : null}

      <div className="player-list">
        {players.map((player) => (
          <div key={player.playerId} className="player-row">
            {editingPlayerId === player.playerId ? (
              <form className="inline-form player-edit" onSubmit={handleUpdatePlayer}>
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  maxLength={30}
                />
                <button type="submit" disabled={saving}>
                  保存
                </button>
              </form>
            ) : (
              <>
                <div className="player-main">
                  <strong>{player.name}</strong>
                  <span className={player.linkedUid ? "status-pill linked" : "status-pill"}>
                    {player.linkedUid
                      ? player.linkedUid === user.uid
                        ? "自分に紐づけ済み"
                        : "Firebaseユーザー紐づけ済み"
                      : "手入力プレイヤー"}
                  </span>
                </div>
                <div className="row-actions player-actions">
                  <button
                    type="button"
                    onClick={() => onOpenPlayerStats(player.playerId)}
                  >
                    成績
                  </button>
                  {!linkedPlayerId && !player.linkedUid ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleLinkPlayer(player)}
                    >
                      自分に紐づけ
                    </button>
                  ) : null}
                  {player.linkedUid === user.uid ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleUnlinkPlayer(player)}
                    >
                      紐づけ解除
                    </button>
                  ) : null}
                  <button type="button" onClick={() => startEditing(player)}>
                    名前変更
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={saving}
                    onClick={() => void handleDeletePlayer(player)}
                  >
                    削除
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {players.length > 0 && players.length < 4 ? (
        <p className="notice-text">半荘作成には4人以上のプレイヤー登録が必要です。</p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
