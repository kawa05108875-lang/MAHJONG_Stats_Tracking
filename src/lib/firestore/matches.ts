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
import type { Match, MatchFinalResult, MatchPlayer, MatchRule } from "@/types";

export type MatchSummary = Pick<
  Match,
  | "matchId"
  | "groupId"
  | "date"
  | "status"
  | "players"
  | "dealerPlayerId"
  | "rule"
  | "currentRound"
  | "currentHonba"
  | "currentRiichiSticks"
  | "finalResults"
>;

export async function createMatch(params: {
  groupId: string;
  date: string;
  players: MatchPlayer[];
  dealerPlayerId: string;
  rule: MatchRule;
  uid: string;
}) {
  const db = getFirebaseDb();
  const matchRef = doc(collection(db, "matches"));
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.set(matchRef, {
    matchId: matchRef.id,
    groupId: params.groupId,
    date: params.date,
    status: "inputting",
    players: params.players,
    dealerPlayerId: params.dealerPlayerId,
    rule: params.rule,
    currentRound: {
      wind: "east",
      number: 1,
    },
    currentHonba: 0,
    currentRiichiSticks: 0,
    finalResults: null,
    createdBy: params.uid,
    updatedBy: params.uid,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();

  return matchRef.id;
}

export async function getGroupMatches(groupId: string): Promise<MatchSummary[]> {
  const db = getFirebaseDb();
  const matchesQuery = query(
    collection(db, "matches"),
    where("groupId", "==", groupId),
  );
  const matchSnapshots = await getDocs(matchesQuery);

  return matchSnapshots.docs
    .map((snapshot) => {
      const match = snapshot.data() as Match;

      return {
        matchId: match.matchId,
        groupId: match.groupId,
        date: match.date,
        status: match.status,
        players: match.players,
        dealerPlayerId: match.dealerPlayerId,
        rule: match.rule,
        currentRound: match.currentRound,
        currentHonba: match.currentHonba,
        currentRiichiSticks: match.currentRiichiSticks,
        finalResults: match.finalResults,
      } satisfies MatchSummary;
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export async function finishMatch(params: {
  matchId: string;
  finalResults: MatchFinalResult[];
  uid: string;
}) {
  const db = getFirebaseDb();
  const matchRef = doc(db, "matches", params.matchId);

  await updateDoc(matchRef, {
    status: "finished",
    finalResults: params.finalResults,
    updatedBy: params.uid,
    updatedAt: serverTimestamp(),
  });
}
