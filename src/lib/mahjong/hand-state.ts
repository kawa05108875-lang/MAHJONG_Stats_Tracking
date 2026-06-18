import type {
  DealerRepeatRule,
  HandType,
  MatchPlayer,
  MatchRound,
  MatchRule,
  ScoreDelta,
  SeatIndex,
  WinType,
} from "@/types/mahjong";

export type HandStateMatch = {
  players: MatchPlayer[];
  dealerPlayerId: string;
  rule: Pick<
    MatchRule,
    "dealerRepeatRule" | "returnScore" | "westRoundEnabled" | "agariyameEnabled"
  >;
  currentRound: MatchRound;
  currentHonba: number;
  currentRiichiSticks: number;
};

type ScoreMap = Record<string, number>;

const ROUND_ORDER: MatchRound[] = [
  { wind: "east", number: 1 },
  { wind: "east", number: 2 },
  { wind: "east", number: 3 },
  { wind: "east", number: 4 },
  { wind: "south", number: 1 },
  { wind: "south", number: 2 },
  { wind: "south", number: 3 },
  { wind: "south", number: 4 },
  { wind: "west", number: 1 },
  { wind: "west", number: 2 },
  { wind: "west", number: 3 },
  { wind: "west", number: 4 },
];

const DEFAULT_DEALER_REPEAT_RULE: DealerRepeatRule = "dealer-win-or-tenpai";

export function parseScore(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyScoreDeltas(
  currentScores: ScoreMap,
  scoreDeltas: ScoreDelta[],
) {
  return scoreDeltas.reduce<ScoreMap>(
    (scores, scoreDelta) => ({
      ...scores,
      [scoreDelta.playerId]: (scores[scoreDelta.playerId] ?? 0) + scoreDelta.delta,
    }),
    { ...currentScores },
  );
}

export function getNextRound(round: MatchRound): MatchRound {
  const currentIndex = ROUND_ORDER.findIndex(
    (candidate) => candidate.wind === round.wind && candidate.number === round.number,
  );

  if (currentIndex < 0 || currentIndex >= ROUND_ORDER.length - 1) {
    return round;
  }

  return ROUND_ORDER[currentIndex + 1];
}

export function getRoundIndex(match: Pick<HandStateMatch, "currentRound">) {
  const windOffset =
    match.currentRound.wind === "west"
      ? 8
      : match.currentRound.wind === "south"
        ? 4
        : 0;

  return windOffset + match.currentRound.number - 1;
}

export function getCurrentDealerSeatIndex(
  match: Pick<HandStateMatch, "players" | "dealerPlayerId" | "currentRound">,
) {
  const eastSeatIndex =
    match.players.find((player) => player.playerId === match.dealerPlayerId)?.seatIndex ?? 0;

  return ((eastSeatIndex + getRoundIndex(match)) % 4) as SeatIndex;
}

export function getCurrentDealerPlayerId(
  match: Pick<HandStateMatch, "players" | "dealerPlayerId" | "currentRound">,
) {
  const dealerSeatIndex = getCurrentDealerSeatIndex(match);

  return match.players.find((player) => player.seatIndex === dealerSeatIndex)?.playerId;
}

export function getCurrentHouseIndex(
  match: Pick<HandStateMatch, "players" | "dealerPlayerId" | "currentRound">,
  seatIndex: number,
) {
  return (seatIndex - getCurrentDealerSeatIndex(match) + 4) % 4;
}

export function getCurrentSeatPlayers(
  match: Pick<HandStateMatch, "players" | "dealerPlayerId" | "currentRound">,
) {
  return [...match.players].sort(
    (left, right) =>
      getCurrentHouseIndex(match, left.seatIndex) -
      getCurrentHouseIndex(match, right.seatIndex),
  );
}

export function calculateDrawScoreDeltas(
  match: Pick<HandStateMatch, "players">,
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

export function calculateWinScoreDeltas(params: {
  match: Pick<
    HandStateMatch,
    "players" | "dealerPlayerId" | "currentRound" | "currentRiichiSticks"
  >;
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

export function getNextHandProgression(params: {
  match: HandStateMatch;
  handType: HandType;
  winnerPlayerId: string;
  tenpaiPlayerIds: string[];
  nextScores: ScoreMap;
}): {
  nextRound: MatchRound;
  nextHonba: number;
  shouldFinishMatch: boolean;
} {
  const currentDealerPlayerId = getCurrentDealerPlayerId(params.match);
  const dealerRepeatRule =
    params.match.rule.dealerRepeatRule ?? DEFAULT_DEALER_REPEAT_RULE;
  const westRoundEnabled = params.match.rule.westRoundEnabled ?? false;
  const agariyameEnabled = params.match.rule.agariyameEnabled ?? true;
  const returnScore = params.match.rule.returnScore;
  const dealerWon =
    params.handType === "win" && params.winnerPlayerId === currentDealerPlayerId;
  const topScore = Math.max(...Object.values(params.nextScores));
  const dealerScore = currentDealerPlayerId
    ? (params.nextScores[currentDealerPlayerId] ?? 0)
    : 0;
  const dealerIsTop = dealerScore >= topScore;
  const scoreReachedReturn = topScore >= returnScore;
  const isSouthLast = params.match.currentRound.wind === "south" && params.match.currentRound.number === 4;
  const isWestLast = params.match.currentRound.wind === "west" && params.match.currentRound.number === 4;
  const dealerTenpaiDraw =
    params.handType === "draw" && currentDealerPlayerId
      ? params.tenpaiPlayerIds.includes(currentDealerPlayerId)
      : false;
  const drawRepeats =
    params.handType === "draw" &&
    (dealerRepeatRule === "always" ||
      (dealerRepeatRule === "dealer-win-or-tenpai" && dealerTenpaiDraw));

  if (dealerWon || drawRepeats) {
    const shouldAgariyame =
      agariyameEnabled &&
      dealerWon &&
      dealerIsTop &&
      scoreReachedReturn &&
      (isSouthLast || params.match.currentRound.wind === "west");

    return {
      nextRound: params.match.currentRound,
      nextHonba: params.match.currentHonba + 1,
      shouldFinishMatch: shouldAgariyame,
    };
  }

  const westFirstRound: MatchRound = { wind: "west", number: 1 };
  const shouldEnterWest =
    westRoundEnabled && isSouthLast && !scoreReachedReturn;

  return {
    nextRound: shouldEnterWest
      ? westFirstRound
      : getNextRound(params.match.currentRound),
    nextHonba: params.handType === "draw" ? params.match.currentHonba + 1 : 0,
    shouldFinishMatch:
      isWestLast || (isSouthLast && !shouldEnterWest) || (params.match.currentRound.wind === "west" && scoreReachedReturn),
  };
}
