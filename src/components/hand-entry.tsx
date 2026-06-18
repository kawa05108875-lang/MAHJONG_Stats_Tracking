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
import { finishMatch, type MatchSummary } from "@/lib/firestore/matches";
import {
  calculateCurrentScores,
  calculateMatchFinalResults,
  hasBankruptPlayer,
} from "@/lib/mahjong";
import type { HandType, ScoreDelta, WinType } from "@/types";

type HandEntryProps = {
  match: MatchSummary;
  user: User;
  onSaved: () => Promise<void>;
};

const HOUSE_LABELS = ["東", "南", "西", "北"] as const;

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

function applyScoreDeltas(
  currentScores: Record<string, number>,
  scoreDeltas: ScoreDelta[],
) {
  return scoreDeltas.reduce<Record<string, number>>(
    (scores, scoreDelta) => ({
      ...scores,
      [scoreDelta.playerId]: (scores[scoreDelta.playerId] ?? 0) + scoreDelta.delta,
    }),
    { ...currentScores },
  );
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

function getRoundIndex(match: MatchSummary) {
  const windOffset = match.currentRound.wind === "south" ? 4 : 0;

  return windOffset + match.currentRound.number - 1;
}

function getCurrentDealerPlayerId(match: MatchSummary) {
  const dealerSeatIndex = getCurrentDealerSeatIndex(match);

  return match.players.find((player) => player.seatIndex === dealerSeatIndex)?.playerId;
}

function getCurrentDealerSeatIndex(match: MatchSummary) {
  const eastSeatIndex =
    match.players.find((player) => player.playerId === match.dealerPlayerId)?.seatIndex ?? 0;

  return (eastSeatIndex + getRoundIndex(match)) % 4;
}

function getCurrentHouseIndex(match: MatchSummary, seatIndex: number) {
  return (seatIndex - getCurrentDealerSeatIndex(match) + 4) % 4;
}

function getCurrentHouseLabel(match: MatchSummary, seatIndex: number) {
  return HOUSE_LABELS[getCurrentHouseIndex(match, seatIndex)];
}

function getCurrentSeatPlayers(match: MatchSummary) {
  return [...match.players].sort(
    (left, right) =>
      getCurrentHouseIndex(match, left.seatIndex) -
      getCurrentHouseIndex(match, right.seatIndex),
  );
}

function calculateWinScoreDeltas(params: {
  match: MatchSummary;
  winType: WinType;
  winnerPlayerId: string;
  loserPlayerId: string;
  riichiPlayerIds: string[];
  ronPoint: number;
  dealerTsumoPoint: number;
  childTsumoPoint: number;
}) {
  const riichiStickPoint =
    (params.match.currentRiichiSticks + params.riichiPlayerIds.length) * 1000;
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);

  return params.match.players.map((player) => {
    const isWinner = player.playerId === params.winnerPlayerId;
    const isLoser = player.playerId === params.loserPlayerId;
    const isRiichi = params.riichiPlayerIds.includes(player.playerId);
    const riichiDelta = isRiichi ? -1000 : 0;
    let handDelta = 0;

    if (params.winType === "ron") {
      if (isWinner) {
        handDelta = params.ronPoint + riichiStickPoint;
      } else if (isLoser) {
        handDelta = -params.ronPoint;
      }
    } else {
      const winnerIsDealer = params.winnerPlayerId === currentDealerPlayerId;

      if (isWinner) {
        const paymentTotal = params.match.players
          .filter((candidate) => candidate.playerId !== params.winnerPlayerId)
          .reduce((total, candidate) => {
            if (winnerIsDealer) {
              return total + params.dealerTsumoPoint;
            }

            return (
              total +
              (candidate.playerId === currentDealerPlayerId
                ? params.dealerTsumoPoint
                : params.childTsumoPoint)
            );
          }, 0);

        handDelta = paymentTotal + riichiStickPoint;
      } else if (winnerIsDealer) {
        handDelta = -params.dealerTsumoPoint;
      } else {
        handDelta =
          player.playerId === currentDealerPlayerId
            ? -params.dealerTsumoPoint
            : -params.childTsumoPoint;
      }
    }

    return {
      playerId: player.playerId,
      delta: handDelta + riichiDelta,
    };
  });
}

function getNextHandProgression(params: {
  match: MatchSummary;
  handType: HandType;
  winnerPlayerId: string;
  tenpaiPlayerIds: string[];
}) {
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);
  const dealerRepeatRule =
    params.match.rule.dealerRepeatRule ?? "dealer-win-or-tenpai";
  const dealerWon =
    params.handType === "win" && params.winnerPlayerId === currentDealerPlayerId;
  const dealerTenpaiDraw =
    params.handType === "draw" && currentDealerPlayerId
      ? params.tenpaiPlayerIds.includes(currentDealerPlayerId)
      : false;
  const drawRepeats =
    params.handType === "draw" &&
    (dealerRepeatRule === "always" ||
      (dealerRepeatRule === "dealer-win-or-tenpai" && dealerTenpaiDraw));

  if (dealerWon || drawRepeats) {
    return {
      nextRound: params.match.currentRound,
      nextHonba: params.match.currentHonba + 1,
    };
  }

  return {
    nextRound: getNextRound(params.match.currentRound),
    nextHonba: params.handType === "draw" ? params.match.currentHonba + 1 : 0,
  };
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
  const [ronPoint, setRonPoint] = useState("");
  const [dealerTsumoPoint, setDealerTsumoPoint] = useState("");
  const [childTsumoPoint, setChildTsumoPoint] = useState("");
  const [riichiPlayerIds, setRiichiPlayerIds] = useState<string[]>([]);
  const [tenpaiPlayerIds, setTenpaiPlayerIds] = useState<string[]>([]);
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>(() =>
    createEmptyScoreInputs(match),
  );
  const [drawRiichiSticksConfirmed, setDrawRiichiSticksConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoreDeltas = useMemo<ScoreDelta[]>(
    () => {
      if (handType === "win") {
        return calculateWinScoreDeltas({
          match,
          winType,
          winnerPlayerId,
          loserPlayerId,
          riichiPlayerIds,
          ronPoint: parseScore(ronPoint),
          dealerTsumoPoint: parseScore(dealerTsumoPoint),
          childTsumoPoint: parseScore(childTsumoPoint),
        });
      }

      if (handType === "draw") {
        return calculateDrawScoreDeltas(match, tenpaiPlayerIds, riichiPlayerIds);
      }

      return match.players.map((player) => ({
        playerId: player.playerId,
        delta: parseScore(scoreInputs[player.playerId] ?? "0"),
      }));
    },
    [
      childTsumoPoint,
      dealerTsumoPoint,
      handType,
      loserPlayerId,
      match,
      riichiPlayerIds,
      ronPoint,
      scoreInputs,
      tenpaiPlayerIds,
      winType,
      winnerPlayerId,
    ],
  );
  const scoreDeltaTotal = scoreDeltas.reduce(
    (total, scoreDelta) => total + scoreDelta.delta,
    0,
  );
  const expectedScoreDeltaTotal =
    handType === "win" ? match.currentRiichiSticks * 1000 : 0;
  const scoreDeltaTotalIsValid =
    handType === "draw" || scoreDeltaTotal === expectedScoreDeltaTotal;
  const nextRiichiSticks =
    handType === "draw" ? match.currentRiichiSticks + riichiPlayerIds.length : 0;
  const currentDealerPlayerId = getCurrentDealerPlayerId(match);
  const currentSeatPlayers = useMemo(() => getCurrentSeatPlayers(match), [match]);
  const winnerIsDealer = winnerPlayerId === currentDealerPlayerId;
  const currentScores = useMemo(
    () => calculateCurrentScores(match.players, hands, match.rule.initialScore),
    [hands, match.players, match.rule.initialScore],
  );
  const finalResults = useMemo(
    () =>
      calculateMatchFinalResults(
        match.players,
        currentScores,
        match.dealerPlayerId,
        match.rule,
      ),
    [currentScores, match.dealerPlayerId, match.players, match.rule],
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
    setRonPoint("");
    setDealerTsumoPoint("");
    setChildTsumoPoint("");
    setRiichiPlayerIds([]);
    setTenpaiPlayerIds([]);
    setDrawRiichiSticksConfirmed(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!scoreDeltaTotalIsValid) {
      setError(
        handType === "win"
          ? "点数増減の合計が現在供託の回収分と一致するように入力してください。"
          : "点数増減の合計が0になるように入力してください。",
      );
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

    if (handType === "win" && winType === "ron" && parseScore(ronPoint) <= 0) {
      setError("ロンの支払い点を入力してください。");
      return;
    }

    if (
      handType === "win" &&
      winType === "tsumo" &&
      (parseScore(dealerTsumoPoint) <= 0 || (!winnerIsDealer && parseScore(childTsumoPoint) <= 0))
    ) {
      setError(
        winnerIsDealer
          ? "親ツモの各自支払い点を入力してください。"
          : "子ツモの親支払い点と子支払い点を入力してください。",
      );
      return;
    }

    if (handType === "draw" && !drawRiichiSticksConfirmed) {
      setError("流局後の供託本数を確認してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextProgression = getNextHandProgression({
        match,
        handType,
        winnerPlayerId,
        tenpaiPlayerIds,
      });
      const nextScores = applyScoreDeltas(currentScores, scoreDeltas);
      const finalResultsByBankruptcy =
        match.rule.bankruptcyEnabled && hasBankruptPlayer(nextScores)
          ? calculateMatchFinalResults(
              match.players,
              nextScores,
              match.dealerPlayerId,
              match.rule,
            )
          : undefined;

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
        nextRound: nextProgression.nextRound,
        nextHonba: nextProgression.nextHonba,
        nextRiichiSticks,
        finalResults: finalResultsByBankruptcy,
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

  async function handleFinishMatch() {
    if (hands.length === 0) {
      setError("少なくとも1局は入力してから半荘を終了してください。");
      return;
    }

    if (match.currentRiichiSticks > 0) {
      setError("供託が残っています。最後の局結果を確認してから半荘を終了してください。");
      return;
    }

    setFinishing(true);
    setError(null);

    try {
      await finishMatch({
        matchId: match.matchId,
        finalResults,
        uid: user.uid,
      });

      await onSaved();
    } catch (finishError) {
      const message =
        finishError instanceof Error ? finishError.message : "半荘結果の保存に失敗しました。";

      setError(
        message.includes("permission")
          ? "半荘結果を保存できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setFinishing(false);
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
        {currentSeatPlayers.map((player) => (
          <div
            key={player.playerId}
            className={`metric ${player.playerId === currentDealerPlayerId ? "current-dealer" : ""}`}
          >
            <span className="seat-label">
              {getCurrentHouseLabel(match, player.seatIndex)}
              {player.playerId === currentDealerPlayerId ? " / 親" : ""}
            </span>
            <span className="label">{player.name}</span>
            <strong>{currentScores[player.playerId]?.toLocaleString() ?? "-"}</strong>
          </div>
        ))}
      </div>

      <div className="result-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Final Preview</p>
            <h4>半荘結果プレビュー</h4>
          </div>
          <button type="button" onClick={handleFinishMatch} disabled={finishing || loading}>
            {finishing ? "保存中..." : "半荘を終了"}
          </button>
        </div>
        <div className="result-table">
          {finalResults.map((result) => (
            <div key={result.playerId} className="result-row">
              <strong>{result.rank}位</strong>
              <span>{result.name}</span>
              <span>{result.finalScore.toLocaleString()}点</span>
              <span>
                {result.rawPoint.toFixed(1)} + {result.uma.toFixed(1)} +{" "}
                {result.oka.toFixed(1)}
              </span>
              <strong>{result.totalPoint.toFixed(1)}pt</strong>
            </div>
          ))}
        </div>
        {match.currentRiichiSticks > 0 ? (
          <p className="error">供託が{match.currentRiichiSticks}本残っています。</p>
        ) : null}
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
                  onClick={() => {
                    setWinType(type);
                    setRonPoint("");
                    setDealerTsumoPoint("");
                    setChildTsumoPoint("");
                  }}
                >
                  {type === "ron" ? "ロン" : "ツモ"}
                </button>
              ))}
            </div>

            <label className="select-field">
              <span>和了者</span>
              <select
                value={winnerPlayerId}
                onChange={(event) => {
                  setWinnerPlayerId(event.target.value);
                  setRonPoint("");
                  setDealerTsumoPoint("");
                  setChildTsumoPoint("");
                }}
              >
                <option value="">選択</option>
                {currentSeatPlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                  </option>
                ))}
              </select>
            </label>

            {winType === "ron" ? (
              <>
                <label className="select-field">
                  <span>放銃者</span>
                  <select
                    value={loserPlayerId}
                    onChange={(event) => setLoserPlayerId(event.target.value)}
                  >
                    <option value="">選択</option>
                    {currentSeatPlayers
                      .filter((player) => player.playerId !== winnerPlayerId)
                      .map((player) => (
                        <option key={player.playerId} value={player.playerId}>
                          {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span className="label">ロン支払い点</span>
                  <input
                    inputMode="numeric"
                    value={ronPoint}
                    onChange={(event) => setRonPoint(event.target.value)}
                    placeholder="例: 8000"
                  />
                </label>
              </>
            ) : winnerPlayerId ? (
              winnerIsDealer ? (
                <label>
                  <span className="label">親ツモ 各自支払い点</span>
                  <input
                    inputMode="numeric"
                    value={dealerTsumoPoint}
                    onChange={(event) => setDealerTsumoPoint(event.target.value)}
                    placeholder="例: 4000"
                  />
                </label>
              ) : (
                <div className="score-input-grid">
                  <label>
                    <span>子ツモ 親支払い点</span>
                    <input
                      inputMode="numeric"
                      value={dealerTsumoPoint}
                      onChange={(event) => setDealerTsumoPoint(event.target.value)}
                      placeholder="例: 3900"
                    />
                  </label>
                  <label>
                    <span>子ツモ 子支払い点</span>
                    <input
                      inputMode="numeric"
                      value={childTsumoPoint}
                      onChange={(event) => setChildTsumoPoint(event.target.value)}
                      placeholder="例: 2000"
                    />
                  </label>
                </div>
              )
            ) : null}

            <div className="notice">
              <strong>供託回収</strong>
              <span>
                現在供託 {match.currentRiichiSticks}本 + 今回リーチ{" "}
                {riichiPlayerIds.length}本を和了者が回収します。
              </span>
            </div>
          </>
        ) : null}

        {handType === "draw" ? (
          <div className="check-list">
            <span className="label">聴牌者</span>
            {currentSeatPlayers.map((player) => (
              <label key={player.playerId} className="check-row">
                <input
                  type="checkbox"
                  checked={tenpaiPlayerIds.includes(player.playerId)}
                  onChange={() => {
                    togglePlayerId(player.playerId, tenpaiPlayerIds, setTenpaiPlayerIds);
                    setDrawRiichiSticksConfirmed(false);
                  }}
                />
                <span>
                  {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                </span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="check-list">
          <span className="label">リーチ者</span>
          {currentSeatPlayers.map((player) => (
            <label key={player.playerId} className="check-row">
              <input
                type="checkbox"
                checked={riichiPlayerIds.includes(player.playerId)}
                onChange={() => {
                  togglePlayerId(player.playerId, riichiPlayerIds, setRiichiPlayerIds);
                  setDrawRiichiSticksConfirmed(false);
                }}
              />
              <span>
                {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
              </span>
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
          {currentSeatPlayers.map((player) => (
            <label key={player.playerId}>
              <span>
                {getCurrentHouseLabel(match, player.seatIndex)} {player.name} 増減
              </span>
              <input
                inputMode="numeric"
                value={
                  handType === "win" || handType === "draw"
                    ? String(
                        scoreDeltas.find(
                          (scoreDelta) => scoreDelta.playerId === player.playerId,
                        )?.delta ?? 0,
                      )
                    : scoreInputs[player.playerId] ?? "0"
                }
                readOnly={handType === "win" || handType === "draw"}
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
            scoreDeltaTotalIsValid ? "success-text" : "error"
          }
        >
          点数増減合計: {scoreDeltaTotal.toLocaleString()}
          {handType === "win"
            ? ` / 供託回収分 ${expectedScoreDeltaTotal.toLocaleString()} と一致すれば保存できます`
            : ""}
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
