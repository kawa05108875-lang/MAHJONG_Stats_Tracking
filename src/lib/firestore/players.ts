import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { CURRENT_PLAYER_STATS_VERSION } from "@/lib/mahjong";
import type { Match, Player } from "@/types";

export type PlayerSummary = Pick<
  Player,
  "playerId" | "groupId" | "name" | "linkedUid"
>;

function createInitialPlayerStats(playerId: string, groupId: string) {
  return {
    playerId,
    groupId,
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
    updatedAt: serverTimestamp(),
  };
}

export async function getGroupPlayers(groupId: string): Promise<PlayerSummary[]> {
  const db = getFirebaseDb();
  const playersQuery = query(
    collection(db, "players"),
    where("groupId", "==", groupId),
  );
  const playerSnapshots = await getDocs(playersQuery);

  return playerSnapshots.docs
    .map((snapshot) => {
      const player = snapshot.data() as Player;

      return {
        playerId: player.playerId,
        groupId: player.groupId,
        name: player.name,
        linkedUid: player.linkedUid ?? null,
      } satisfies PlayerSummary;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ja"));
}

export async function createPlayer(params: {
  groupId: string;
  name: string;
  linkedUid: string | null;
}) {
  const db = getFirebaseDb();
  const playerRef = doc(collection(db, "players"));
  const statsRef = doc(db, "playerStats", playerRef.id);
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.set(playerRef, {
    playerId: playerRef.id,
    groupId: params.groupId,
    name: params.name,
    linkedUid: params.linkedUid,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(statsRef, createInitialPlayerStats(playerRef.id, params.groupId));

  await batch.commit();

  return playerRef.id;
}

export async function updatePlayerName(params: {
  playerId: string;
  name: string;
}) {
  await updateDoc(doc(getFirebaseDb(), "players", params.playerId), {
    name: params.name,
    updatedAt: serverTimestamp(),
  });
}

export async function updatePlayerLinkedUid(params: {
  playerId: string;
  linkedUid: string | null;
}) {
  await updateDoc(doc(getFirebaseDb(), "players", params.playerId), {
    linkedUid: params.linkedUid,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUnusedPlayer(params: {
  groupId: string;
  playerId: string;
}) {
  const db = getFirebaseDb();
  const matchesQuery = query(
    collection(db, "matches"),
    where("groupId", "==", params.groupId),
  );
  const matchSnapshots = await getDocs(matchesQuery);
  const isUsed = matchSnapshots.docs.some((snapshot) => {
    const match = snapshot.data() as Match;

    return match.players.some((player) => player.playerId === params.playerId);
  });

  if (isUsed) {
    throw new Error("このプレイヤーは半荘で使用済みのため削除できません。");
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, "players", params.playerId));
  batch.delete(doc(db, "playerStats", params.playerId));

  await batch.commit();
}
