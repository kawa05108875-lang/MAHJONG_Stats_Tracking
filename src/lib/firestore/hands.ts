import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import type {
  AbortiveDrawProgression,
  AbortiveDrawType,
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
  | "abortiveDrawType"
  | "abortiveDrawProgression"
  | "riichiPlayerIds"
  | "winnerPlayerId"
  | "winnerPlayerIds"
  | "loserPlayerId"
  | "tenpaiPlayerIds"
  | "scoreDeltas"
  | "memo"
  | "createdAt"
>;

export type CreateHandInput = {
  matchId: string;
  groupId: string;
  round: MatchRound;
  honba: number;
  riichiSticksBefore: number;
  handType: HandType;
  winType?: WinType;
  abortiveDrawType?: AbortiveDrawType;
  abortiveDrawProgression?: AbortiveDrawProgression;
  riichiPlayerIds: string[];
  winnerPlayerId?: string;
  winnerPlayerIds?: string[];
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

export type RecalculatedHandInput = Omit<
  CreateHandInput,
  "finalResults" | "nextHonba" | "nextRiichiSticks" | "nextRound" | "uid"
> & {
  handId: string;
};

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

export function formatRound(round: MatchRound) {
  const windLabel =
    round.wind === "east" ? "東" : round.wind === "south" ? "南" : "西";

  return `${windLabel}${round.number}局`;
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

export async function getMatchHands(groupId: string, matchId: string): Promise<HandSummary[]> {
  const db = getFirebaseDb();
  const handsQuery = query(
    collection(db, "hands"),
    where("groupId", "==", groupId),
  );
  const handSnapshots = await getDocs(handsQuery);

  return handSnapshots.docs
    .map((snapshot) => snapshot.data() as Hand)
    .filter((hand) => hand.matchId === matchId)
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
        abortiveDrawType: hand.abortiveDrawType,
        abortiveDrawProgression: hand.abortiveDrawProgression,
        riichiPlayerIds: hand.riichiPlayerIds,
        winnerPlayerId: hand.winnerPlayerId,
        winnerPlayerIds: hand.winnerPlayerIds,
        loserPlayerId: hand.loserPlayerId,
        tenpaiPlayerIds: hand.tenpaiPlayerIds,
        scoreDeltas: hand.scoreDeltas,
        memo: hand.memo,
        createdAt: hand.createdAt,
      } satisfies HandSummary;
    })
    .sort((left, right) => {
      const leftSeconds = "seconds" in left.createdAt ? left.createdAt.seconds : 0;
      const rightSeconds = "seconds" in right.createdAt ? right.createdAt.seconds : 0;

      return leftSeconds - rightSeconds;
    });
}

function createMutableHandData(
  input: CreateHandInput | RecalculatedHandInput,
  options: { includeDeletedOptionalFields: boolean },
) {
  const data = {
    round: input.round,
    honba: input.honba,
    riichiSticksBefore: input.riichiSticksBefore,
    handType: input.handType,
    riichiPlayerIds: input.riichiPlayerIds,
    scoreDeltas: input.scoreDeltas,
    memo: input.memo,
  };

  return {
    ...data,
    ...(input.winType || options.includeDeletedOptionalFields
      ? { winType: input.winType ?? deleteField() }
      : {}),
    ...(input.abortiveDrawType || options.includeDeletedOptionalFields
      ? { abortiveDrawType: input.abortiveDrawType ?? deleteField() }
      : {}),
    ...(input.abortiveDrawProgression || options.includeDeletedOptionalFields
      ? { abortiveDrawProgression: input.abortiveDrawProgression ?? deleteField() }
      : {}),
    ...(input.winnerPlayerId || options.includeDeletedOptionalFields
      ? { winnerPlayerId: input.winnerPlayerId ?? deleteField() }
      : {}),
    ...(input.winnerPlayerIds || options.includeDeletedOptionalFields
      ? { winnerPlayerIds: input.winnerPlayerIds ?? deleteField() }
      : {}),
    ...(input.loserPlayerId || options.includeDeletedOptionalFields
      ? { loserPlayerId: input.loserPlayerId ?? deleteField() }
      : {}),
    ...(input.tenpaiPlayerIds || options.includeDeletedOptionalFields
      ? { tenpaiPlayerIds: input.tenpaiPlayerIds ?? deleteField() }
      : {}),
  };
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
    ...createMutableHandData(input, { includeDeletedOptionalFields: false }),
    createdBy: input.uid,
    updatedBy: input.uid,
    createdAt: now,
    updatedAt: now,
  };

  batch.set(handRef, handData);

  batch.update(matchRef, {
    currentRound: input.nextRound,
    currentHonba: input.nextHonba,
    currentRiichiSticks: input.finalResults ? 0 : input.nextRiichiSticks,
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

export async function updateHandsAndMatchAfterEdit(input: {
  matchId: string;
  hands: RecalculatedHandInput[];
  nextRound: MatchRound;
  nextHonba: number;
  nextRiichiSticks: number;
  uid: string;
}) {
  const db = getFirebaseDb();
  const matchRef = doc(db, "matches", input.matchId);
  const now = serverTimestamp();
  const batch = writeBatch(db);

  for (const hand of input.hands) {
    batch.update(doc(db, "hands", hand.handId), {
      ...createMutableHandData(hand, { includeDeletedOptionalFields: true }),
      updatedBy: input.uid,
      updatedAt: now,
    });
  }

  batch.update(matchRef, {
    status: "inputting",
    currentRound: input.nextRound,
    currentHonba: input.nextHonba,
    currentRiichiSticks: input.nextRiichiSticks,
    finalResults: null,
    updatedBy: input.uid,
    updatedAt: now,
  });

  await batch.commit();
}

export async function updateHandScoreDeltasAndMatchFinalResults(input: {
  matchId: string;
  handId: string;
  scoreDeltas: ScoreDelta[];
  finalResults?: MatchFinalResult[];
  uid: string;
}) {
  const db = getFirebaseDb();
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.update(doc(db, "hands", input.handId), {
    scoreDeltas: input.scoreDeltas,
    updatedBy: input.uid,
    updatedAt: now,
  });

  if (input.finalResults) {
    batch.update(doc(db, "matches", input.matchId), {
      finalResults: input.finalResults,
      updatedBy: input.uid,
      updatedAt: now,
    });
  }

  await batch.commit();
}
