import type {
  AppTimestamp,
  Hand,
  Match,
  MatchFinalResult,
  Player,
  PlayerStats,
} from "@/types/mahjong";

export type FinishedMatchForStats = Pick<
  Match,
  "groupId" | "players" | "status" | "finalResults"
>;

export type HandForStats = Pick<
  Hand,
  | "handType"
  | "winType"
  | "riichiPlayerIds"
  | "winnerPlayerId"
  | "winnerPlayerIds"
  | "loserPlayerId"
  | "scoreDeltas"
>;

type MutableStats = Omit<PlayerStats, "updatedAt">;

export const CURRENT_PLAYER_STATS_VERSION = 6;

function divideOrZero(value: number, divisor: number) {
  return divisor === 0 ? 0 : value / divisor;
}

function createEmptyStats(player: Pick<Player, "playerId" | "groupId">): MutableStats {
  return {
    playerId: player.playerId,
    groupId: player.groupId,
    statsVersion: CURRENT_PLAYER_STATS_VERSION,
    matchCount: 0,
    handCount: 0,
    totalPoint: 0,
    averagePoint: 0,
    averageRank: 0,
    totalScore: 0,
    averageScore: 0,
    riichiCount: 0,
    riichiWinCount: 0,
    winCount: 0,
    dealInCount: 0,
    tsumoWinCount: 0,
    ronWinCount: 0,
    totalWinScore: 0,
    averageWinScore: 0,
    totalDealInScore: 0,
    averageDealInScore: 0,
    riichiRate: 0,
    riichiWinRate: 0,
    firstPlaceCount: 0,
    secondPlaceCount: 0,
    thirdPlaceCount: 0,
    fourthPlaceCount: 0,
    winRate: 0,
    dealInRate: 0,
    winDealInDiff: 0,
    tsumoRate: 0,
    ronRate: 0,
    firstPlaceRate: 0,
    secondOrBetterRate: 0,
    fourthPlaceRate: 0,
  };
}

function applyMatchResult(stats: MutableStats, result: MatchFinalResult) {
  stats.matchCount += 1;
  stats.totalPoint += result.totalPoint;
  stats.totalScore += result.finalScore;

  if (result.rank === 1) {
    stats.firstPlaceCount += 1;
  } else if (result.rank === 2) {
    stats.secondPlaceCount += 1;
  } else if (result.rank === 3) {
    stats.thirdPlaceCount += 1;
  } else {
    stats.fourthPlaceCount += 1;
  }
}

function applyHand(stats: MutableStats, hand: HandForStats) {
  const joinedHand = hand.scoreDeltas.some(
    (scoreDelta) => scoreDelta.playerId === stats.playerId,
  );

  if (!joinedHand) {
    return;
  }

  if (hand.handType === "penalty") {
    return;
  }

  stats.handCount += 1;

  if (hand.riichiPlayerIds.includes(stats.playerId)) {
    stats.riichiCount += 1;
  }

  if (hand.handType !== "win") {
    return;
  }

  const winnerPlayerIds = hand.winnerPlayerIds ?? (hand.winnerPlayerId ? [hand.winnerPlayerId] : []);

  if (winnerPlayerIds.includes(stats.playerId)) {
    const scoreDelta = hand.scoreDeltas.find(
      (delta) => delta.playerId === stats.playerId,
    );

    stats.winCount += 1;
    stats.totalWinScore += Math.max(scoreDelta?.delta ?? 0, 0);

    if (hand.winType === "tsumo") {
      stats.tsumoWinCount += 1;
    } else if (hand.winType === "ron") {
      stats.ronWinCount += 1;
    }

    if (hand.riichiPlayerIds.includes(stats.playerId)) {
      stats.riichiWinCount += 1;
    }
  }

  if (hand.winType === "ron" && hand.loserPlayerId === stats.playerId) {
    const scoreDelta = hand.scoreDeltas.find(
      (delta) => delta.playerId === stats.playerId,
    );
    const riichiStickPaidByLoser = hand.riichiPlayerIds.includes(stats.playerId) ? 1000 : 0;
    const dealInScore = Math.max(
      Math.abs(Math.min(scoreDelta?.delta ?? 0, 0)) - riichiStickPaidByLoser,
      0,
    );

    stats.dealInCount += 1;
    stats.totalDealInScore += dealInScore;
  }
}

function finalizeStats(stats: MutableStats, updatedAt: AppTimestamp): PlayerStats {
  const rankTotal =
    stats.firstPlaceCount +
    stats.secondPlaceCount * 2 +
    stats.thirdPlaceCount * 3 +
    stats.fourthPlaceCount * 4;

  return {
    ...stats,
    averagePoint: divideOrZero(stats.totalPoint, stats.matchCount),
    averageRank: divideOrZero(rankTotal, stats.matchCount),
    averageScore: divideOrZero(stats.totalScore, stats.matchCount),
    averageWinScore: divideOrZero(stats.totalWinScore, stats.winCount),
    averageDealInScore: divideOrZero(stats.totalDealInScore, stats.dealInCount),
    riichiRate: divideOrZero(stats.riichiCount, stats.handCount),
    riichiWinRate: divideOrZero(stats.riichiWinCount, stats.riichiCount),
    winRate: divideOrZero(stats.winCount, stats.handCount),
    dealInRate: divideOrZero(stats.dealInCount, stats.handCount),
    winDealInDiff: divideOrZero(stats.winCount - stats.dealInCount, stats.handCount),
    tsumoRate: divideOrZero(stats.tsumoWinCount, stats.winCount),
    ronRate: divideOrZero(stats.ronWinCount, stats.winCount),
    firstPlaceRate: divideOrZero(stats.firstPlaceCount, stats.matchCount),
    secondOrBetterRate: divideOrZero(
      stats.firstPlaceCount + stats.secondPlaceCount,
      stats.matchCount,
    ),
    fourthPlaceRate: divideOrZero(stats.fourthPlaceCount, stats.matchCount),
    updatedAt,
  };
}

export function calculatePlayerStats(
  players: Pick<Player, "playerId" | "groupId">[],
  matches: FinishedMatchForStats[],
  hands: HandForStats[],
  updatedAt: AppTimestamp = new Date(),
) {
  const statsByPlayerId = new Map(
    players.map((player) => [player.playerId, createEmptyStats(player)]),
  );

  for (const match of matches) {
    if (match.status !== "finished" || !match.finalResults) {
      continue;
    }

    for (const result of match.finalResults) {
      const stats = statsByPlayerId.get(result.playerId);

      if (stats) {
        applyMatchResult(stats, result);
      }
    }
  }

  for (const hand of hands) {
    for (const stats of statsByPlayerId.values()) {
      applyHand(stats, hand);
    }
  }

  return Array.from(statsByPlayerId.values()).map((stats) =>
    finalizeStats(stats, updatedAt),
  );
}
