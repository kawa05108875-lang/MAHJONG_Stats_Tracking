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
import { recalculateGroupPlayerStats } from "@/lib/firestore/stats";
import type {
  AbortiveDrawProgression,
  AbortiveDrawType,
  HandType,
  MatchFinalResult,
  MatchRound,
  ScoreDelta,
  WinType,
} from "@/types";

type HandEntryProps = {
  match: MatchSummary;
  user: User;
  onSaved: () => Promise<void>;
};

function notifyStatsChanged(groupId: string) {
  window.dispatchEvent(
    new CustomEvent("mahjong:stats-changed", {
      detail: { groupId },
    }),
  );
}

const HOUSE_LABELS = ["東", "南", "西", "北"] as const;
const RON_HONBA_BONUS = 300;
const TSUMO_HONBA_BONUS = 100;
const ABORTIVE_DRAW_OPTIONS: Array<{ key: AbortiveDrawType; label: string }> = [
  { key: "nineTerminals", label: "九種九牌" },
  { key: "fourWinds", label: "四風連打" },
  { key: "fourRiichi", label: "四家立直" },
  { key: "fourKan", label: "四槓散了" },
];
const ABORTIVE_DRAW_PROGRESSION_OPTIONS: Array<{
  key: AbortiveDrawProgression;
  label: string;
}> = [
  { key: "repeat", label: "同じ局で本場+1" },
  { key: "advance", label: "次の局で本場+1" },
];
type RonWinnerCount = 1 | 2 | 3;

function parseScore(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function playerName(match: MatchSummary, playerId: string | undefined) {
  return match.players.find((player) => player.playerId === playerId)?.name ?? "-";
}

function playerNames(match: MatchSummary, playerIds: string[] | undefined) {
  return playerIds?.map((playerId) => playerName(match, playerId)).join(" / ") || "-";
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

function calculateAbortiveDrawScoreDeltas(
  match: MatchSummary,
  riichiPlayerIds: string[],
) {
  return match.players.map((player) => ({
    playerId: player.playerId,
    delta: riichiPlayerIds.includes(player.playerId) ? -1000 : 0,
  }));
}

function getRoundIndex(match: MatchSummary) {
  const windOffset =
    match.currentRound.wind === "west" ? 8 : match.currentRound.wind === "south" ? 4 : 0;

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

function getUpperRonWinnerPlayerId(
  match: MatchSummary,
  loserPlayerId: string,
  winnerPlayerIds: string[],
) {
  const loser = match.players.find((player) => player.playerId === loserPlayerId);

  if (!loser || winnerPlayerIds.length === 0) {
    return winnerPlayerIds[0];
  }

  return [...winnerPlayerIds].sort((leftPlayerId, rightPlayerId) => {
    const left = match.players.find((player) => player.playerId === leftPlayerId);
    const right = match.players.find((player) => player.playerId === rightPlayerId);
    const loserHouseIndex = getCurrentHouseIndex(match, loser.seatIndex);
    const leftDistance = left
      ? (getCurrentHouseIndex(match, left.seatIndex) - loserHouseIndex + 4) % 4
      : 4;
    const rightDistance = right
      ? (getCurrentHouseIndex(match, right.seatIndex) - loserHouseIndex + 4) % 4
      : 4;

    return leftDistance - rightDistance;
  })[0];
}

function isLastScheduledRound(round: MatchRound, westRoundEnabled: boolean) {
  const lastWind = westRoundEnabled ? "west" : "south";

  return round.wind === lastWind && round.number === 4;
}

function hasReturnScore(results: MatchFinalResult[], returnScore: number) {
  return results.some((result) => result.finalScore >= returnScore);
}

function playerIsTop(results: MatchFinalResult[], playerId: string | undefined) {
  return results.some((result) => result.playerId === playerId && result.rank === 1);
}

function shouldFinishAfterHand(params: {
  match: MatchSummary;
  handType: HandType;
  winnerPlayerIds: string[];
  nextRound: MatchRound;
  finalResults: MatchFinalResult[];
}) {
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);
  const westRoundEnabled = params.match.rule.westRoundEnabled ?? false;
  const agariYameEnabled = params.match.rule.agariYameEnabled ?? true;
  const currentRoundIsSouthLast =
    params.match.currentRound.wind === "south" && params.match.currentRound.number === 4;
  const currentRoundIsFinalScheduledRound = isLastScheduledRound(
    params.match.currentRound,
    westRoundEnabled,
  );

  if (agariYameEnabled && currentRoundIsFinalScheduledRound) {
    const dealerWon =
      params.handType === "win" && params.winnerPlayerIds.includes(currentDealerPlayerId ?? "");

    if (dealerWon && playerIsTop(params.finalResults, currentDealerPlayerId)) {
      return true;
    }
  }

  if (
    currentRoundIsSouthLast &&
    westRoundEnabled &&
    !hasReturnScore(params.finalResults, params.match.rule.returnScore)
  ) {
    return false;
  }

  if (currentRoundIsSouthLast) {
    const repeatsSouthLast =
      params.nextRound.wind === params.match.currentRound.wind &&
      params.nextRound.number === params.match.currentRound.number;

    return !repeatsSouthLast;
  }

  if (params.match.currentRound.wind === "west") {
    return (
      hasReturnScore(params.finalResults, params.match.rule.returnScore) ||
      (params.match.currentRound.number === 4 &&
        params.nextRound.wind === params.match.currentRound.wind &&
        params.nextRound.number === params.match.currentRound.number)
    );
  }

  return false;
}

function calculateWinScoreDeltas(params: {
  match: MatchSummary;
  winType: WinType;
  winnerPlayerIds: string[];
  loserPlayerId: string;
  riichiPlayerIds: string[];
  ronPointsByWinner: Record<string, number>;
  dealerTsumoPoint: number;
  childTsumoPoint: number;
}) {
  const riichiStickPoint =
    (params.match.currentRiichiSticks + params.riichiPlayerIds.length) * 1000;
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);
  const primaryWinnerPlayerId = params.winnerPlayerIds[0] ?? "";
  const upperRonWinnerPlayerId = getUpperRonWinnerPlayerId(
    params.match,
    params.loserPlayerId,
    params.winnerPlayerIds,
  );
  const ronHonbaPoint = params.match.currentHonba * RON_HONBA_BONUS;
  const ronBasePointTotal = params.winnerPlayerIds.reduce(
    (total, playerId) => total + (params.ronPointsByWinner[playerId] ?? 0),
    0,
  );
  const dealerTsumoPointWithHonba =
    params.dealerTsumoPoint + params.match.currentHonba * TSUMO_HONBA_BONUS;
  const childTsumoPointWithHonba =
    params.childTsumoPoint + params.match.currentHonba * TSUMO_HONBA_BONUS;

  return params.match.players.map((player) => {
    const isWinner = params.winnerPlayerIds.includes(player.playerId);
    const isLoser = player.playerId === params.loserPlayerId;
    const isRiichi = params.riichiPlayerIds.includes(player.playerId);
    const riichiDelta = isRiichi ? -1000 : 0;
    let handDelta = 0;

    if (params.winType === "ron") {
      if (isWinner) {
        handDelta = params.ronPointsByWinner[player.playerId] ?? 0;

        if (player.playerId === upperRonWinnerPlayerId) {
          handDelta += ronHonbaPoint + riichiStickPoint;
        }
      } else if (isLoser) {
        handDelta = -(ronBasePointTotal + ronHonbaPoint);
      }
    } else {
      const winnerIsDealer = primaryWinnerPlayerId === currentDealerPlayerId;

      if (isWinner) {
        const paymentTotal = params.match.players
          .filter((candidate) => candidate.playerId !== primaryWinnerPlayerId)
          .reduce((total, candidate) => {
            if (winnerIsDealer) {
              return total + dealerTsumoPointWithHonba;
            }

            return (
              total +
              (candidate.playerId === currentDealerPlayerId
                ? dealerTsumoPointWithHonba
                : childTsumoPointWithHonba)
            );
          }, 0);

        handDelta = paymentTotal + riichiStickPoint;
      } else if (winnerIsDealer) {
        handDelta = -dealerTsumoPointWithHonba;
      } else {
        handDelta =
          player.playerId === currentDealerPlayerId
            ? -dealerTsumoPointWithHonba
            : -childTsumoPointWithHonba;
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
  winnerPlayerIds: string[];
  tenpaiPlayerIds: string[];
  abortiveDrawProgression: AbortiveDrawProgression;
}) {
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);

  if (params.handType === "abortive-draw") {
    return {
      nextRound:
        params.abortiveDrawProgression === "advance"
          ? getNextRound(params.match.currentRound)
          : params.match.currentRound,
      nextHonba: params.match.currentHonba + 1,
    };
  }

  const dealerRepeatRule =
    params.match.rule.dealerRepeatRule ?? "dealer-win-or-tenpai";
  const dealerWon =
    params.handType === "win" && params.winnerPlayerIds.includes(currentDealerPlayerId ?? "");
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

function abortiveDrawLabel(abortiveDrawType: AbortiveDrawType | undefined) {
  return (
    ABORTIVE_DRAW_OPTIONS.find((option) => option.key === abortiveDrawType)?.label ??
    "途中流局"
  );
}

function handTypeLabel(
  handType: HandType,
  winType?: WinType,
  abortiveDrawType?: AbortiveDrawType,
) {
  if (handType === "win") {
    return winType === "tsumo" ? "ツモ" : "ロン";
  }

  if (handType === "abortive-draw") {
    return abortiveDrawLabel(abortiveDrawType);
  }

  if (handType === "draw") {
    return "流局";
  }

  return "罰符";
}

function abortiveDrawProgressionLabel(
  abortiveDrawProgression: AbortiveDrawProgression | undefined,
) {
  return (
    ABORTIVE_DRAW_PROGRESSION_OPTIONS.find(
      (option) => option.key === abortiveDrawProgression,
    )?.label ?? "同じ局で本場+1"
  );
}

export function HandEntry({ match, user, onSaved }: HandEntryProps) {
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [handTypeSelected, setHandTypeSelected] = useState(false);
  const [handType, setHandType] = useState<HandType>("win");
  const [winType, setWinType] = useState<WinType>("ron");
  const [abortiveDrawType, setAbortiveDrawType] = useState<AbortiveDrawType | "">("");
  const [abortiveDrawProgression, setAbortiveDrawProgression] =
    useState<AbortiveDrawProgression>("repeat");
  const [ronWinnerCount, setRonWinnerCount] = useState<RonWinnerCount>(1);
  const [winnerPlayerId, setWinnerPlayerId] = useState("");
  const [winnerPlayerIds, setWinnerPlayerIds] = useState<string[]>([]);
  const [loserPlayerId, setLoserPlayerId] = useState("");
  const [ronPoint, setRonPoint] = useState("");
  const [ronPointInputs, setRonPointInputs] = useState<Record<string, string>>({});
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
  const effectiveWinnerPlayerIds = useMemo(
    () =>
      handType === "win" && winType === "ron" && ronWinnerCount > 1
        ? winnerPlayerIds
        : winnerPlayerId
          ? [winnerPlayerId]
          : [],
    [handType, ronWinnerCount, winType, winnerPlayerId, winnerPlayerIds],
  );
  const ronPointsByWinner = useMemo(
    () =>
      ronWinnerCount > 1
        ? Object.fromEntries(
            winnerPlayerIds.map((playerId) => [
              playerId,
              parseScore(ronPointInputs[playerId] ?? "0"),
            ]),
          )
        : winnerPlayerId
          ? { [winnerPlayerId]: parseScore(ronPoint) }
          : {},
    [ronPoint, ronPointInputs, ronWinnerCount, winnerPlayerId, winnerPlayerIds],
  );
  const drawTenpaiPlayerIds = useMemo(
    () =>
      handType === "draw"
        ? Array.from(new Set([...tenpaiPlayerIds, ...riichiPlayerIds]))
        : tenpaiPlayerIds,
    [handType, riichiPlayerIds, tenpaiPlayerIds],
  );

  const scoreDeltas = useMemo<ScoreDelta[]>(
    () => {
      if (handType === "win") {
        return calculateWinScoreDeltas({
          match,
          winType,
          winnerPlayerIds: effectiveWinnerPlayerIds,
          loserPlayerId,
          riichiPlayerIds,
          ronPointsByWinner,
          dealerTsumoPoint: parseScore(dealerTsumoPoint),
          childTsumoPoint: parseScore(childTsumoPoint),
        });
      }

      if (handType === "draw") {
        return calculateDrawScoreDeltas(match, drawTenpaiPlayerIds, riichiPlayerIds);
      }

      if (handType === "abortive-draw") {
        return calculateAbortiveDrawScoreDeltas(match, riichiPlayerIds);
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
      effectiveWinnerPlayerIds,
      riichiPlayerIds,
      ronPointsByWinner,
      scoreInputs,
      drawTenpaiPlayerIds,
      winType,
    ],
  );
  const scoreDeltaTotal = scoreDeltas.reduce(
    (total, scoreDelta) => total + scoreDelta.delta,
    0,
  );
  const expectedScoreDeltaTotal =
    handType === "win" ? match.currentRiichiSticks * 1000 : 0;
  const scoreDeltaTotalIsValid =
    handType === "draw" ||
    handType === "abortive-draw" ||
    scoreDeltaTotal === expectedScoreDeltaTotal;
  const nextRiichiSticks =
    handType === "draw" || handType === "abortive-draw"
      ? match.currentRiichiSticks + riichiPlayerIds.length
      : 0;
  const currentDealerPlayerId = getCurrentDealerPlayerId(match);
  const currentSeatPlayers = useMemo(() => getCurrentSeatPlayers(match), [match]);
  const enabledAbortiveDrawOptions = useMemo(
    () =>
      ABORTIVE_DRAW_OPTIONS.filter(
        (option) => match.rule.abortiveDrawEnabled?.[option.key] ?? true,
      ),
    [match.rule.abortiveDrawEnabled],
  );
  const winnerIsDealer = effectiveWinnerPlayerIds[0] === currentDealerPlayerId;
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
        match.currentRiichiSticks,
      ),
    [currentScores, match.currentRiichiSticks, match.dealerPlayerId, match.players, match.rule],
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

  function toggleRiichiPlayerId(playerId: string) {
    const willAddRiichi = !riichiPlayerIds.includes(playerId);

    togglePlayerId(playerId, riichiPlayerIds, setRiichiPlayerIds);

    if (handType === "draw" && willAddRiichi && !tenpaiPlayerIds.includes(playerId)) {
      setTenpaiPlayerIds([...tenpaiPlayerIds, playerId]);
    }

    setDrawRiichiSticksConfirmed(false);
  }

  function resetForm() {
    setHandTypeSelected(false);
    setHandType("win");
    setWinType("ron");
    setRonWinnerCount(1);
    setAbortiveDrawType("");
    setAbortiveDrawProgression("repeat");
    setScoreInputs(createEmptyScoreInputs(match));
    setWinnerPlayerId("");
    setWinnerPlayerIds([]);
    setLoserPlayerId("");
    setRonPoint("");
    setRonPointInputs({});
    setDealerTsumoPoint("");
    setChildTsumoPoint("");
    setRiichiPlayerIds([]);
    setTenpaiPlayerIds([]);
    setDrawRiichiSticksConfirmed(false);
  }

  function selectHandType(type: HandType) {
    const nextAbortiveDrawType =
      type === "abortive-draw" ? enabledAbortiveDrawOptions[0]?.key ?? "" : "";

    setHandType(type);
    setHandTypeSelected(true);
    setError(null);
    setAbortiveDrawType(nextAbortiveDrawType);
    setAbortiveDrawProgression("repeat");
    setRonWinnerCount(1);
    if (nextAbortiveDrawType === "fourRiichi") {
      setRiichiPlayerIds(currentSeatPlayers.map((player) => player.playerId));
    }
    setDrawRiichiSticksConfirmed(false);
  }

  function changeHandType() {
    setHandTypeSelected(false);
    setError(null);
    setWinnerPlayerId("");
    setWinnerPlayerIds([]);
    setLoserPlayerId("");
    setRonWinnerCount(1);
    setAbortiveDrawType("");
    setAbortiveDrawProgression("repeat");
    setRonPoint("");
    setRonPointInputs({});
    setDealerTsumoPoint("");
    setChildTsumoPoint("");
    setTenpaiPlayerIds([]);
    setDrawRiichiSticksConfirmed(false);
  }

  function selectRonWinnerCount(count: RonWinnerCount) {
    setWinType("ron");
    setRonWinnerCount(count);
    setWinnerPlayerId("");
    setWinnerPlayerIds([]);
    setRonPoint("");
    setRonPointInputs({});
    setDealerTsumoPoint("");
    setChildTsumoPoint("");
  }

  function toggleRonWinner(playerId: string) {
    setWinnerPlayerIds((current) => {
      if (current.includes(playerId)) {
        const next = current.filter((value) => value !== playerId);
        setRonPointInputs((inputs) => {
          const rest = { ...inputs };
          delete rest[playerId];
          return rest;
        });
        return next;
      }

      if (current.length >= ronWinnerCount) {
        return current;
      }

      return [...current, playerId];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!handTypeSelected) {
      setError("局結果の種類を選択してください。");
      return;
    }

    if (!scoreDeltaTotalIsValid) {
      setError(
        handType === "win"
          ? "点数増減の合計が現在供託の回収分と一致するように入力してください。"
          : "点数増減の合計が0になるように入力してください。",
      );
      return;
    }

    if (handType === "win" && effectiveWinnerPlayerIds.length === 0) {
      setError("和了者を選択してください。");
      return;
    }

    if (
      handType === "win" &&
      winType === "ron" &&
      ronWinnerCount > 1 &&
      effectiveWinnerPlayerIds.length !== ronWinnerCount
    ) {
      setError(`${ronWinnerCount}人の和了者を選択してください。`);
      return;
    }

    if (handType === "win" && winType === "ron" && !loserPlayerId) {
      setError("放銃者を選択してください。");
      return;
    }

    if (
      handType === "win" &&
      winType === "ron" &&
      effectiveWinnerPlayerIds.includes(loserPlayerId)
    ) {
      setError("放銃者と和了者は別のプレイヤーを選択してください。");
      return;
    }

    if (
      handType === "win" &&
      winType === "ron" &&
      effectiveWinnerPlayerIds.some((playerId) => (ronPointsByWinner[playerId] ?? 0) <= 0)
    ) {
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

    if (handType === "abortive-draw" && !abortiveDrawType) {
      setError("途中流局の種類を選択してください。");
      return;
    }

    if (handType === "abortive-draw" && abortiveDrawType === "fourRiichi" && riichiPlayerIds.length !== 4) {
      setError("四家立直は4人全員をリーチ者にしてください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextProgression = getNextHandProgression({
        match,
        handType,
        winnerPlayerIds: effectiveWinnerPlayerIds,
        tenpaiPlayerIds: drawTenpaiPlayerIds,
        abortiveDrawProgression,
      });
      const nextScores = applyScoreDeltas(currentScores, scoreDeltas);
      const nextRiichiSticksForFinalResults =
        handType === "draw" || handType === "abortive-draw" ? nextRiichiSticks : 0;
      const calculatedFinalResults = calculateMatchFinalResults(
        match.players,
        nextScores,
        match.dealerPlayerId,
        match.rule,
        nextRiichiSticksForFinalResults,
      );
      const finalResultsByBankruptcy =
        match.rule.bankruptcyEnabled && hasBankruptPlayer(nextScores)
          ? calculatedFinalResults
          : undefined;
      const shouldFinishByRule =
        handType !== "abortive-draw" &&
        shouldFinishAfterHand({
          match,
          handType,
          winnerPlayerIds: effectiveWinnerPlayerIds,
          nextRound: nextProgression.nextRound,
          finalResults: calculatedFinalResults,
        });
      const finalResultsByRule =
        finalResultsByBankruptcy ?? (shouldFinishByRule ? calculatedFinalResults : undefined);

      await createHandAndAdvanceMatch({
        matchId: match.matchId,
        groupId: match.groupId,
        round: match.currentRound,
        honba: match.currentHonba,
        riichiSticksBefore: match.currentRiichiSticks,
        handType,
        winType: handType === "win" ? winType : undefined,
        abortiveDrawType:
          handType === "abortive-draw" && abortiveDrawType ? abortiveDrawType : undefined,
        abortiveDrawProgression:
          handType === "abortive-draw" ? abortiveDrawProgression : undefined,
        riichiPlayerIds,
        winnerPlayerId: handType === "win" ? effectiveWinnerPlayerIds[0] : undefined,
        winnerPlayerIds: handType === "win" ? effectiveWinnerPlayerIds : undefined,
        loserPlayerId: handType === "win" && winType === "ron" ? loserPlayerId : undefined,
        tenpaiPlayerIds: handType === "draw" ? drawTenpaiPlayerIds : undefined,
        scoreDeltas,
        memo: null,
        nextRound: nextProgression.nextRound,
        nextHonba: nextProgression.nextHonba,
        nextRiichiSticks,
        finalResults: finalResultsByRule,
        uid: user.uid,
      });

      await recalculateGroupPlayerStats(match.groupId);
      notifyStatsChanged(match.groupId);

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

    setFinishing(true);
    setError(null);

    try {
      await finishMatch({
        matchId: match.matchId,
        finalResults,
        uid: user.uid,
      });
      await recalculateGroupPlayerStats(match.groupId);
      notifyStatsChanged(match.groupId);

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
      </div>

      <form className="match-form" onSubmit={handleSubmit}>
        {!handTypeSelected ? (
          <div className="hand-type-selector">
            <div className="segmented-control compact">
              {(["win", "draw"] as const).map((type) => (
                <button key={type} type="button" onClick={() => selectHandType(type)}>
                  {type === "win" ? "和了" : "流局"}
                </button>
              ))}
            </div>
            <div className="minor-action-row">
              {(["abortive-draw", "penalty"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="compact-action-button"
                  disabled={type === "abortive-draw" && enabledAbortiveDrawOptions.length === 0}
                  onClick={() => selectHandType(type)}
                >
                  {type === "abortive-draw" ? "途中流局" : "罰符"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="section-header">
              <div>
                <p className="eyebrow">Hand Type</p>
                <h4>
                  {handType === "win"
                    ? "和了"
                    : handType === "draw"
                      ? "流局"
                      : handType === "abortive-draw"
                        ? "途中流局"
                        : "罰符"}
                </h4>
              </div>
              <button type="button" onClick={changeHandType}>
                戻る
              </button>
            </div>

            {handType === "win" ? (
              <>
                <div>
                  <p className="label">和了形式</p>
                  <div className="segmented-control compact">
                    {(["ron", "tsumo"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={winType === type && (type === "tsumo" || ronWinnerCount === 1) ? "is-active" : ""}
                        onClick={() => {
                          setWinType(type);
                          setRonWinnerCount(1);
                          setWinnerPlayerIds([]);
                          setRonPoint("");
                          setRonPointInputs({});
                          setDealerTsumoPoint("");
                          setChildTsumoPoint("");
                        }}
                      >
                        {type === "ron" ? "ロン" : "ツモ"}
                      </button>
                    ))}
                  </div>
                  <div className="segmented-control compact secondary-win-control">
                    {([
                      { count: 2, label: "ダブロン", enabled: match.rule.doubleRonEnabled ?? true },
                      { count: 3, label: "トリロン", enabled: match.rule.tripleRonEnabled ?? true },
                    ] as const).map((option) => (
                      <button
                        key={option.count}
                        type="button"
                        className={winType === "ron" && ronWinnerCount === option.count ? "is-active" : ""}
                        disabled={!option.enabled}
                        onClick={() => selectRonWinnerCount(option.count)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {winType === "tsumo" || ronWinnerCount === 1 ? (
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
                      {currentSeatPlayers
                        .filter((player) => player.playerId !== loserPlayerId)
                        .map((player) => (
                          <option key={player.playerId} value={player.playerId}>
                            {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}

                {winType === "ron" ? (
                  <>
                    <label className="select-field">
                      <span>放銃者</span>
                      <select
                        value={loserPlayerId}
                        onChange={(event) => {
                          const nextLoserPlayerId = event.target.value;
                          setLoserPlayerId(nextLoserPlayerId);
                          setWinnerPlayerIds((current) =>
                            current.filter((playerId) => playerId !== nextLoserPlayerId),
                          );
                        }}
                      >
                        <option value="">選択</option>
                        {currentSeatPlayers
                          .filter((player) => !effectiveWinnerPlayerIds.includes(player.playerId))
                          .map((player) => (
                            <option key={player.playerId} value={player.playerId}>
                              {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {ronWinnerCount === 1 ? (
                      <label>
                        <span className="label">ロン支払い点（素点・本場なし）</span>
                        <input
                          inputMode="numeric"
                          value={ronPoint}
                          onChange={(event) => setRonPoint(event.target.value)}
                          placeholder="例: 8000"
                        />
                      </label>
                    ) : (
                      <>
                        <div className="check-list">
                          <span className="label">和了者（{ronWinnerCount}人）</span>
                          {currentSeatPlayers.map((player) => {
                            const checked = winnerPlayerIds.includes(player.playerId);
                            const disabled =
                              player.playerId === loserPlayerId ||
                              (!checked && winnerPlayerIds.length >= ronWinnerCount);

                            return (
                              <label key={player.playerId} className="check-row">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => toggleRonWinner(player.playerId)}
                                />
                                <span>
                                  {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="score-input-grid">
                          {winnerPlayerIds.map((playerId) => (
                            <label key={playerId}>
                              <span>{playerName(match, playerId)} ロン支払い点（素点・本場なし）</span>
                              <input
                                inputMode="numeric"
                                value={ronPointInputs[playerId] ?? ""}
                                onChange={(event) =>
                                  setRonPointInputs((current) => ({
                                    ...current,
                                    [playerId]: event.target.value,
                                  }))
                                }
                                placeholder="例: 8000"
                              />
                            </label>
                          ))}
                        </div>
                        <p className="notice-text">
                          本場と供託は放銃者から見た上家側の和了者に加算されます。
                        </p>
                      </>
                    )}
                  </>
                ) : winnerPlayerId ? (
                  winnerIsDealer ? (
                    <label>
                      <span className="label">親ツモ 各自支払い点（素点・本場なし）</span>
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
                        <span>子ツモ 親支払い点（素点・本場なし）</span>
                        <input
                          inputMode="numeric"
                          value={dealerTsumoPoint}
                          onChange={(event) => setDealerTsumoPoint(event.target.value)}
                          placeholder="例: 3900"
                        />
                      </label>
                      <label>
                        <span>子ツモ 子支払い点（素点・本場なし）</span>
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

                <p className="notice-text">素点だけ入力してください。本場と供託は自動反映されます。</p>
              </>
            ) : null}

            {handType === "draw" ? (
              <div className="check-list">
                <span className="label">聴牌者</span>
                {currentSeatPlayers.map((player) => {
                  const isRiichiPlayer = riichiPlayerIds.includes(player.playerId);

                  return (
                    <label key={player.playerId} className="check-row">
                      <input
                        type="checkbox"
                        checked={drawTenpaiPlayerIds.includes(player.playerId)}
                        disabled={isRiichiPlayer}
                        onChange={() => {
                          if (isRiichiPlayer) {
                            return;
                          }

                          togglePlayerId(player.playerId, tenpaiPlayerIds, setTenpaiPlayerIds);
                          setDrawRiichiSticksConfirmed(false);
                        }}
                      />
                      <span>
                        {getCurrentHouseLabel(match, player.seatIndex)} {player.name}
                        {isRiichiPlayer ? "（リーチ）" : ""}
                      </span>
                    </label>
                  );
                })}
                <p className="notice-text">リーチ者は自動で聴牌扱いになります。</p>
              </div>
            ) : null}

            {handType === "abortive-draw" ? (
              <>
                <label className="select-field">
                  <span>途中流局の種類</span>
                  <select
                    value={abortiveDrawType}
                    onChange={(event) => {
                      const nextType = event.target.value as AbortiveDrawType;
                      setAbortiveDrawType(nextType);
                      if (nextType === "fourRiichi") {
                        setRiichiPlayerIds(currentSeatPlayers.map((player) => player.playerId));
                      }
                    }}
                  >
                    {enabledAbortiveDrawOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <p className="label">局の進行</p>
                  <div className="segmented-control compact">
                    {ABORTIVE_DRAW_PROGRESSION_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={abortiveDrawProgression === option.key ? "is-active" : ""}
                        onClick={() => setAbortiveDrawProgression(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <div className="check-list">
              <span className="label">リーチ者</span>
              {currentSeatPlayers.map((player) => (
                <label key={player.playerId} className="check-row">
                  <input
                    type="checkbox"
                    checked={riichiPlayerIds.includes(player.playerId)}
                    onChange={() => toggleRiichiPlayerId(player.playerId)}
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
                  聴牌者 {drawTenpaiPlayerIds.length}人 / ノーテン{" "}
                  {match.players.length - drawTenpaiPlayerIds.length}人
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

            {handType === "abortive-draw" ? (
              <p className="notice-text">
                点数移動なしで{abortiveDrawProgressionLabel(abortiveDrawProgression)}
                にします。リーチ者がいれば供託に入ります。
              </p>
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
                      handType === "win" ||
                      handType === "draw" ||
                      handType === "abortive-draw"
                        ? String(
                            scoreDeltas.find(
                              (scoreDelta) => scoreDelta.playerId === player.playerId,
                            )?.delta ?? 0,
                          )
                        : scoreInputs[player.playerId] ?? "0"
                    }
                    readOnly={
                      handType === "win" ||
                      handType === "draw" ||
                      handType === "abortive-draw"
                    }
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
              {handType === "abortive-draw"
                ? " / 途中流局はリーチ棒だけ供託に入ります"
                : ""}
            </p>

            <button type="submit" className="primary-button sticky-action" disabled={saving}>
              局結果を保存
            </button>
          </>
        )}
      </form>

      <div className="section-header">
        <div>
          <p className="eyebrow">Current Scores</p>
          <h4>現在点</h4>
        </div>
      </div>

      <div className="score-grid hand-scoreboard">
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

      {match.currentRiichiSticks > 0 ? (
        <p className="notice-text">
          供託が{match.currentRiichiSticks}本残っています。半荘終了時はトップに加算されます。
        </p>
      ) : null}

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
                {handTypeLabel(hand.handType, hand.winType, hand.abortiveDrawType)}
              </strong>
              <span className="muted">
                {hand.handType === "win"
                  ? `和了: ${playerNames(match, hand.winnerPlayerIds ?? (hand.winnerPlayerId ? [hand.winnerPlayerId] : []))} / 放銃: ${playerName(match, hand.loserPlayerId)}`
                  : hand.handType === "draw"
                    ? `聴牌: ${(hand.tenpaiPlayerIds ?? []).map((playerId) => playerName(match, playerId)).join(" / ") || "-"}`
                    : hand.handType === "abortive-draw"
                      ? abortiveDrawProgressionLabel(hand.abortiveDrawProgression)
                      : "罰符"}
              </span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="primary-button"
        onClick={handleFinishMatch}
        disabled={finishing || loading}
      >
        {finishing ? "保存中..." : "半荘を終了"}
      </button>
    </section>
  );
}
