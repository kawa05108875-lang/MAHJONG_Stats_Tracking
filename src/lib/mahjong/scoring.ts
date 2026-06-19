import type {
  Hand,
  MatchFinalResult,
  MatchPlayer,
  MatchRule,
  ScoreDelta,
  SeatIndex,
} from "@/types/mahjong";

export type PlayerScoreMap = Record<string, number>;

const RANK_UMA_KEY = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
} as const;

export function sumScoreDeltas(scoreDeltas: ScoreDelta[]) {
  return scoreDeltas.reduce((total, scoreDelta) => total + scoreDelta.delta, 0);
}

export function isZeroSumScoreDelta(scoreDeltas: ScoreDelta[]) {
  return sumScoreDeltas(scoreDeltas) === 0;
}

export function createInitialScores(players: MatchPlayer[], initialScore: number) {
  return players.reduce<PlayerScoreMap>((scores, player) => {
    scores[player.playerId] = initialScore;
    return scores;
  }, {});
}

export function calculateCurrentScores(
  players: MatchPlayer[],
  hands: Pick<Hand, "scoreDeltas">[],
  initialScore: number,
) {
  const scores = createInitialScores(players, initialScore);

  for (const hand of hands) {
    for (const scoreDelta of hand.scoreDeltas) {
      if (scoreDelta.playerId in scores) {
        scores[scoreDelta.playerId] += scoreDelta.delta;
      }
    }
  }

  return scores;
}

export function hasBankruptPlayer(scores: PlayerScoreMap) {
  return Object.values(scores).some((score) => score < 0);
}

export function getDealerRelativeSeatDistance(
  seatIndex: SeatIndex,
  dealerSeatIndex: SeatIndex,
) {
  return (seatIndex - dealerSeatIndex + 4) % 4;
}

export function rankPlayersByScore(
  players: MatchPlayer[],
  scores: PlayerScoreMap,
  dealerPlayerId: string,
) {
  const dealer = players.find((player) => player.playerId === dealerPlayerId);

  if (!dealer) {
    throw new Error("Dealer player is not included in match players.");
  }

  return [...players]
    .sort((left, right) => {
      const scoreDiff = (scores[right.playerId] ?? 0) - (scores[left.playerId] ?? 0);

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return (
        getDealerRelativeSeatDistance(left.seatIndex, dealer.seatIndex) -
        getDealerRelativeSeatDistance(right.seatIndex, dealer.seatIndex)
      );
    })
    .map((player, index) => ({
      ...player,
      rank: (index + 1) as 1 | 2 | 3 | 4,
      score: scores[player.playerId] ?? 0,
    }));
}

export function calculateRawPoint(finalScore: number, returnScore: number) {
  return (finalScore - returnScore) / 1000;
}

export function calculateOka(rank: 1 | 2 | 3 | 4, rule: MatchRule) {
  if (rank !== 1) {
    return 0;
  }

  return ((rule.returnScore - rule.initialScore) * 4) / 1000;
}

export function calculateMatchFinalResults(
  players: MatchPlayer[],
  scores: PlayerScoreMap,
  dealerPlayerId: string,
  rule: MatchRule,
  remainingRiichiSticks = 0,
): MatchFinalResult[] {
  const rankedPlayers = rankPlayersByScore(players, scores, dealerPlayerId);
  const riichiStickPoint = remainingRiichiSticks * 1000;

  return rankedPlayers.map((player) => {
    const finalScore = player.score + (player.rank === 1 ? riichiStickPoint : 0);
    const rawPoint = calculateRawPoint(finalScore, rule.returnScore);
    const uma = rule.uma[RANK_UMA_KEY[player.rank]];
    const oka = calculateOka(player.rank, rule);

    return {
      playerId: player.playerId,
      name: player.name,
      seatIndex: player.seatIndex,
      finalScore,
      rank: player.rank,
      rawPoint,
      uma,
      oka,
      totalPoint: rawPoint + uma + oka,
    };
  });
}

export function calculateMatchFinalResultsFromHands(
  players: MatchPlayer[],
  hands: Pick<Hand, "scoreDeltas">[],
  dealerPlayerId: string,
  rule: MatchRule,
  remainingRiichiSticks = 0,
) {
  const scores = calculateCurrentScores(players, hands, rule.initialScore);

  return calculateMatchFinalResults(
    players,
    scores,
    dealerPlayerId,
    rule,
    remainingRiichiSticks,
  );
}
