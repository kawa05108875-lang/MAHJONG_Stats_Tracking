"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  createHandAndAdvanceMatch,
  formatRound,
  getMatchHands,
  getNextRound,
  type HandSummary,
} from "@/lib/firestore/hands";
import type { MatchSummary } from "@/lib/firestore/matches";
import { calculateCurrentScores, isZeroSumScoreDelta } from "@/lib/mahjong";
import type { HandType, ScoreDelta, WinType } from "@/types";

type HandEntryProps = {
  match: MatchSummary;
  user: User;
  onSaved: () => Promise<void>;
};

function parseScore(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function playerName(match: MatchSummary, playerId: string | undefined) {
  return match.players.find((player) => player.playerId === playerId)?.name ?? "-";
}

function createEmptyScoreInputs(match: MatchSummary) {
  return Object.fromEntries(match.players.map((player) => [player.playerId, "0"]));
}

function calculateDrawScoreDeltas(
  match: MatchSummary,
  tenpaiPlayerIds: string[],
  riichiPlayerIds: string[],
) {
  const tenpaiCount = tenpaiPlayerIds.length;
  const notenCount = match.players.length - tenpaiCount;

  return match.players.map((player) => {
    const isTenpai = tenpaiPlayerIds.includes(player.playerId);
    const riichiDelta = riichiPlayerIds.includes(player.playerId) ? -1000 : 0;
    let notenPenaltyDelta = 0;

    if (tenpaiCount > 0 && notenCount > 0) {
      notenPenaltyDelta = isTenpai ? 3000 / tenpaiCount : -3000 / notenCount;
    }

    return {
      playerId: player.playerId,
      delta: notenPenaltyDelta + riichiDelta,
    };
  });
}

function handTypeLabel(handType: HandType, winType?: WinType) {
  if (handType === "win") {
    return winType === "tsumo" ? "ツモ" : "ロン";
  }

  if (handType === "draw") {
    return "流局";
  }

  return "罰符";
}

export function HandEntry({ match, user, onSaved }: HandEntryProps) {
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [handType, setHandType] = useState<HandType>("win");
  const [winType, setWinType] = useState<WinType>("ron");
  const [winnerPlayerId, setWinnerPlayerId] = useState("");
  const [loserPlayerId, setLoserPlayerId] = useState("");
  const [riichiPlayerIds, setRiichiPlayerIds] = useState<string[]>([]);
  const [tenpaiPlayerIds, setTenpaiPlayerIds] = useState<string[]>([]);
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>(() =>
    createEmptyScoreInputs(match),
  );
  const [drawRiichiSticksConfirmed, setDrawRiichiSticksConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoreDeltas = useMemo<ScoreDelta[]>(
    () => {
      if (handType === "draw") {
        return calculateDrawScoreDeltas(match, tenpaiPlayerIds, riichiPlayerIds);
      }

      return match.players.map((player) => ({
        playerId: player.playerId,
        delta: parseScore(scoreInputs[player.playerId] ?? "0"),
      }));
    },
    [handType, match, riichiPlayerIds, scoreInputs, tenpaiPlayerIds],
  );
  const scoreDeltaTotal = scoreDeltas.reduce(
    (total, scoreDelta) => total + scoreDelta.delta,
    0,
  );
  const requiresZeroSumScoreDelta = handType !== "draw";
  const nextRiichiSticks =
    handType === "draw" ? match.currentRiichiSticks + riichiPlayerIds.length : 0;
  const currentScores = useMemo(
    () => calculateCurrentScores(match.players, hands, match.rule.initialScore),
    [hands, match.players, match.rule.initialScore],
  );

  const loadHands = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setHands(await getMatchHands(match.groupId, match.matchId));
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "局履歴の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "局履歴を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [match.groupId, match.matchId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadHands();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadHands]);

  function togglePlayerId(
    playerId: string,
    values: string[],
    setValues: (nextValues: string[]) => void,
  ) {
    setValues(
      values.includes(playerId)
        ? values.filter((value) => value !== playerId)
        : [...values, playerId],
    );
  }

  function resetForm() {
    setScoreInputs(createEmptyScoreInputs(match));
    setWinnerPlayerId("");
    setLoserPlayerId("");
    setRiichiPlayerIds([]);
    setTenpaiPlayerIds([]);
    setDrawRiichiSticksConfirmed(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (requiresZeroSumScoreDelta && !isZeroSumScoreDelta(scoreDeltas)) {
      setError("点数増減の合計が0になるように入力してください。");
      return;
    }

    if (handType === "win" && !winnerPlayerId) {
      setError("和了者を選択してください。");
      return;
    }

    if (handType === "win" && winType === "ron" && !loserPlayerId) {
      setError("放銃者を選択してください。");
      return;
    }

    if (handType === "draw" && !drawRiichiSticksConfirmed) {
      setError("流局後の供託本数を確認してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createHandAndAdvanceMatch({
        matchId: match.matchId,
        groupId: match.groupId,
        round: match.currentRound,
        honba: match.currentHonba,
        riichiSticksBefore: match.currentRiichiSticks,
        handType,
        winType: handType === "win" ? winType : undefined,
        riichiPlayerIds,
        winnerPlayerId: handType === "win" ? winnerPlayerId : undefined,
        loserPlayerId: handType === "win" && winType === "ron" ? loserPlayerId : undefined,
        tenpaiPlayerIds: handType === "draw" ? tenpaiPlayerIds : undefined,
        scoreDeltas,
        memo: null,
        nextRound: getNextRound(match.currentRound),
        nextHonba: 0,
        nextRiichiSticks,
        uid: user.uid,
      });

      resetForm();
      await loadHands();
      await onSaved();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "局結果の保存に失敗しました。";

      setError(
        message.includes("permission")
          ? "局結果を保存できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hand-entry-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Hand Entry</p>
          <h3>
            {formatRound(match.currentRound)} {match.currentHonba}本場
          </h3>
        </div>
        <button type="button" onClick={loadHands} disabled={loading}>
          更新
        </button>
      </div>

      <div className="score-grid">
        {match.players.map((player) => (
          <div key={player.playerId} className="metric">
            <span className="label">{player.name}</span>
            <strong>{currentScores[player.playerId]?.toLocaleString() ?? "-"}</strong>
          </div>
        ))}
      </div>

      <form className="match-form" onSubmit={handleSubmit}>
        <div className="segmented-control">
          {(["win", "draw", "penalty"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={handType === type ? "is-active" : ""}
              onClick={() => {
                setHandType(type);
                setDrawRiichiSticksConfirmed(false);
              }}
            >
              {type === "win" ? "和了" : type === "draw" ? "流局" : "罰符"}
            </button>
          ))}
        </div>

        {handType === "win" ? (
          <>
            <div className="segmented-control compact">
              {(["ron", "tsumo"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={winType === type ? "is-active" : ""}
                  onClick={() => setWinType(type)}
                >
                  {type === "ron" ? "ロン" : "ツモ"}
                </button>
              ))}
            </div>

            <label className="select-field">
              <span>和了者</span>
              <select
                value={winnerPlayerId}
                onChange={(event) => setWinnerPlayerId(event.target.value)}
              >
                <option value="">選択</option>
                {match.players.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>

            {winType === "ron" ? (
              <label className="select-field">
                <span>放銃者</span>
                <select
                  value={loserPlayerId}
                  onChange={(event) => setLoserPlayerId(event.target.value)}
                >
                  <option value="">選択</option>
                  {match.players.map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {handType === "draw" ? (
          <div className="check-list">
            <span className="label">聴牌者</span>
            {match.players.map((player) => (
              <label key={player.playerId} className="check-row">
                <input
                  type="checkbox"
                  checked={tenpaiPlayerIds.includes(player.playerId)}
                  onChange={() => {
                    togglePlayerId(player.playerId, tenpaiPlayerIds, setTenpaiPlayerIds);
                    setDrawRiichiSticksConfirmed(false);
                  }}
                />
                <span>{player.name}</span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="check-list">
          <span className="label">リーチ者</span>
          {match.players.map((player) => (
            <label key={player.playerId} className="check-row">
              <input
                type="checkbox"
                checked={riichiPlayerIds.includes(player.playerId)}
                onChange={() => {
                  togglePlayerId(player.playerId, riichiPlayerIds, setRiichiPlayerIds);
                  setDrawRiichiSticksConfirmed(false);
                }}
              />
              <span>{player.name}</span>
            </label>
          ))}
        </div>

        {handType === "draw" ? (
          <div className="notice">
            <strong>流局精算確認</strong>
            <span>
              聴牌者 {tenpaiPlayerIds.length}人 / ノーテン{" "}
              {match.players.length - tenpaiPlayerIds.length}人
            </span>
            <span>
              現在供託 {match.currentRiichiSticks}本 + 今回リーチ{" "}
              {riichiPlayerIds.length}本 = 次局供託 {nextRiichiSticks}本
            </span>
            <label className="check-row">
              <input
                type="checkbox"
                checked={drawRiichiSticksConfirmed}
                onChange={(event) =>
                  setDrawRiichiSticksConfirmed(event.target.checked)
                }
              />
              <span>この供託本数で保存する</span>
            </label>
          </div>
        ) : null}

        <div className="score-input-grid">
          {match.players.map((player) => (
            <label key={player.playerId}>
              <span>{player.name} 増減</span>
              <input
                inputMode="numeric"
                value={
                  handType === "draw"
                    ? String(
                        scoreDeltas.find(
                          (scoreDelta) => scoreDelta.playerId === player.playerId,
                        )?.delta ?? 0,
                      )
                    : scoreInputs[player.playerId] ?? "0"
                }
                readOnly={handType === "draw"}
                onChange={(event) =>
                  setScoreInputs((current) => ({
                    ...current,
                    [player.playerId]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <p
          className={
            scoreDeltaTotal === 0 || !requiresZeroSumScoreDelta ? "success-text" : "error"
          }
        >
          点数増減合計: {scoreDeltaTotal.toLocaleString()}
          {handType === "draw"
            ? " / ノーテン罰符とリーチ棒を自動計算しています"
            : ""}
        </p>

        <button type="submit" className="primary-button" disabled={saving}>
          局結果を保存
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      <div className="match-list">
        <h4>入力済み局</h4>
        {loading ? <p className="muted">局履歴を読み込んでいます...</p> : null}
        {!loading && hands.length === 0 ? (
          <p className="empty-state">まだ局結果がありません。</p>
        ) : null}
        {hands.map((hand) => (
          <div key={hand.handId} className="match-row">
            <div>
              <strong>
                {formatRound(hand.round)} {hand.honba}本場 /{" "}
                {handTypeLabel(hand.handType, hand.winType)}
              </strong>
              <span className="muted">
                {hand.handType === "win"
                  ? `和了: ${playerName(match, hand.winnerPlayerId)} / 放銃: ${playerName(match, hand.loserPlayerId)}`
                  : hand.handType === "draw"
                    ? `聴牌: ${(hand.tenpaiPlayerIds ?? []).map((playerId) => playerName(match, playerId)).join(" / ") || "-"}`
                    : "罰符"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
