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
export { getNextRound } from "@/lib/mahjong";
import type {
  Hand,
  HandType,
  MatchFinalResult,
  MatchRound,
  ScoreDelta,
  WinType,
} from "@/types";

export type HandSummary = Pick<
  Hand,
  | "handId"
  | "matchId"
  | "groupId"
  | "round"
  | "honba"
  | "riichiSticksBefore"
  | "handType"
  | "winType"
  | "riichiPlayerIds"
  | "winnerPlayerId"
  | "loserPlayerId"
  | "tenpaiPlayerIds"
  | "scoreDeltas"
  | "memo"
>;

export type CreateHandInput = {
  matchId: string;
  groupId: string;
  round: MatchRound;
  honba: number;
  riichiSticksBefore: number;
  handType: HandType;
  winType?: WinType;
  riichiPlayerIds: string[];
  winnerPlayerId?: string;
  loserPlayerId?: string;
  tenpaiPlayerIds?: string[];
  scoreDeltas: ScoreDelta[];
  memo: string | null;
  nextRound: MatchRound;
  nextHonba: number;
  nextRiichiSticks: number;
  finalResults?: MatchFinalResult[];
  uid: string;
};

export function formatRound(round: MatchRound) {
  if (round.wind === "west") {
    return `${"西"}${round.number}${"局"}`;
  }

  return `${round.wind === "east" ? "東" : "南"}${round.number}局`;
}

export async function getMatchHands(groupId: string, matchId: string): Promise<HandSummary[]> {
  const db = getFirebaseDb();
  const handsQuery = query(
    collection(db, "hands"),
    where("groupId", "==", groupId),
    where("matchId", "==", matchId),
  );
  const handSnapshots = await getDocs(handsQuery);

  return handSnapshots.docs
    .map((snapshot) => snapshot.data() as Hand)
    .map((hand) => {
      return {
        handId: hand.handId,
        matchId: hand.matchId,
        groupId: hand.groupId,
        round: hand.round,
        honba: hand.honba,
        riichiSticksBefore: hand.riichiSticksBefore,
        handType: hand.handType,
        winType: hand.winType,
        riichiPlayerIds: hand.riichiPlayerIds,
        winnerPlayerId: hand.winnerPlayerId,
        loserPlayerId: hand.loserPlayerId,
        tenpaiPlayerIds: hand.tenpaiPlayerIds,
        scoreDeltas: hand.scoreDeltas,
        memo: hand.memo,
      } satisfies HandSummary;
    });
}

export async function createHandAndAdvanceMatch(input: CreateHandInput) {
  const db = getFirebaseDb();
  const handRef = doc(collection(db, "hands"));
  const matchRef = doc(db, "matches", input.matchId);
  const now = serverTimestamp();
  const batch = writeBatch(db);
  const handData = {
    handId: handRef.id,
    matchId: input.matchId,
    groupId: input.groupId,
    round: input.round,
    honba: input.honba,
    riichiSticksBefore: input.riichiSticksBefore,
    handType: input.handType,
    riichiPlayerIds: input.riichiPlayerIds,
    scoreDeltas: input.scoreDeltas,
    memo: input.memo,
    createdBy: input.uid,
    updatedBy: input.uid,
    createdAt: now,
    updatedAt: now,
    ...(input.winType ? { winType: input.winType } : {}),
    ...(input.winnerPlayerId ? { winnerPlayerId: input.winnerPlayerId } : {}),
    ...(input.loserPlayerId ? { loserPlayerId: input.loserPlayerId } : {}),
    ...(input.tenpaiPlayerIds ? { tenpaiPlayerIds: input.tenpaiPlayerIds } : {}),
  };

  batch.set(handRef, handData);

  batch.update(matchRef, {
    currentRound: input.nextRound,
    currentHonba: input.nextHonba,
    currentRiichiSticks: input.nextRiichiSticks,
    ...(input.finalResults
      ? {
          status: "finished",
          finalResults: input.finalResults,
        }
      : {}),
    updatedBy: input.uid,
    updatedAt: now,
  });

  await batch.commit();

  return handRef.id;
}
