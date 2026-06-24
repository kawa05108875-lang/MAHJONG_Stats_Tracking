import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { CURRENT_PLAYER_STATS_VERSION, calculatePlayerStats } from "@/lib/mahjong";
import type { Hand, Match, Player, PlayerStats } from "@/types";

export type PlayerStatsSummary = PlayerStats & {
  name: string;
};

function createEmptyStatsSummary(player: Pick<Player, "playerId" | "groupId" | "name">) {
  return {
    playerId: player.playerId,
    groupId: player.groupId,
    name: player.name,
    statsVersion: CURRENT_PLAYER_STATS_VERSION,
    matchCount: 0,
    handCount: 0,
    totalPoint: 0,
    averagePoint: 0,
    averageRank: 0,
    totalScore: 0,
    averageScore: 0,
    riichiCount: 0,
    winCount: 0,
    dealInCount: 0,
    tsumoWinCount: 0,
    ronWinCount: 0,
    totalWinScore: 0,
    averageWinScore: 0,
    totalDealInScore: 0,
    averageDealInScore: 0,
    riichiRate: 0,
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
    updatedAt: new Date(),
  } satisfies PlayerStatsSummary;
}

function hasCurrentStatsFields(stats: PlayerStats | undefined) {
  return (
    !!stats &&
    stats.statsVersion === CURRENT_PLAYER_STATS_VERSION &&
    typeof stats.riichiCount === "number" &&
    typeof stats.riichiRate === "number" &&
    typeof stats.totalWinScore === "number" &&
    typeof stats.averageWinScore === "number" &&
    typeof stats.totalDealInScore === "number" &&
    typeof stats.averageDealInScore === "number" &&
    typeof stats.winDealInDiff === "number"
  );
}

async function getGroupPlayersForStats(groupId: string) {
  const db = getFirebaseDb();
  const playersQuery = query(
    collection(db, "players"),
    where("groupId", "==", groupId),
  );
  const playerSnapshots = await getDocs(playersQuery);

  return playerSnapshots.docs.map((snapshot) => snapshot.data() as Player);
}

async function getGroupMatchesForStats(groupId: string) {
  const db = getFirebaseDb();
  const matchesQuery = query(
    collection(db, "matches"),
    where("groupId", "==", groupId),
  );
  const matchSnapshots = await getDocs(matchesQuery);

  return matchSnapshots.docs.map((snapshot) => snapshot.data() as Match);
}

async function getGroupHandsForStats(groupId: string) {
  const db = getFirebaseDb();
  const handsQuery = query(
    collection(db, "hands"),
    where("groupId", "==", groupId),
  );
  const handSnapshots = await getDocs(handsQuery);

  return handSnapshots.docs.map((snapshot) => snapshot.data() as Hand);
}

export async function recalculateGroupPlayerStats(groupId: string) {
  const db = getFirebaseDb();
  const [players, matches, hands] = await Promise.all([
    getGroupPlayersForStats(groupId),
    getGroupMatchesForStats(groupId),
    getGroupHandsForStats(groupId),
  ]);
  const calculatedStats = calculatePlayerStats(players, matches, hands, new Date());
  const batch = writeBatch(db);

  for (const stats of calculatedStats) {
    batch.set(doc(db, "playerStats", stats.playerId), {
      ...stats,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  return calculatedStats;
}

export async function getGroupPlayerStats(groupId: string): Promise<PlayerStatsSummary[]> {
  const db = getFirebaseDb();
  const [players, statsSnapshots] = await Promise.all([
    getGroupPlayersForStats(groupId),
    getDocs(query(collection(db, "playerStats"), where("groupId", "==", groupId))),
  ]);
  const statsByPlayerId = new Map(
    statsSnapshots.docs.map((snapshot) => {
      const stats = snapshot.data() as PlayerStats;

      return [stats.playerId, stats] as const;
    }),
  );
  const needsStatsRefresh = players.some(
    (player) => !hasCurrentStatsFields(statsByPlayerId.get(player.playerId)),
  );
  const effectiveStatsByPlayerId = needsStatsRefresh
    ? new Map(
        (await recalculateGroupPlayerStats(groupId)).map((stats) => [
          stats.playerId,
          stats,
        ] as const),
      )
    : statsByPlayerId;

  return players
    .map((player) => {
      const stats = effectiveStatsByPlayerId.get(player.playerId);

      if (!stats) {
        return createEmptyStatsSummary(player);
      }

      return {
        ...stats,
        name: player.name,
        statsVersion: stats.statsVersion ?? 1,
        riichiCount: stats.riichiCount ?? 0,
        totalWinScore: stats.totalWinScore ?? 0,
        averageWinScore: stats.averageWinScore ?? 0,
        totalDealInScore: stats.totalDealInScore ?? 0,
        averageDealInScore: stats.averageDealInScore ?? 0,
        winDealInDiff: stats.winDealInDiff ?? 0,
        riichiRate: stats.riichiRate ?? 0,
      } satisfies PlayerStatsSummary;
    })
    .sort((left, right) => right.totalPoint - left.totalPoint);
}
