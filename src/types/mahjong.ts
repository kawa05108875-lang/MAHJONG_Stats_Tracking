export type AppTimestamp = Date | { seconds: number; nanoseconds: number };

export type UserProfile = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: AppTimestamp;
  updatedAt: AppTimestamp;
};

export type SeatIndex = 0 | 1 | 2 | 3;

export type Wind = "east" | "south" | "west" | "north";

export type RoundWind = "east" | "south";

export type RoundNumber = 1 | 2 | 3 | 4;

export type MatchRound = {
  wind: RoundWind;
  number: RoundNumber;
};

export type MatchStatus = "inputting" | "finished" | "cancelled";

export type HandType = "win" | "draw" | "penalty";

export type WinType = "tsumo" | "ron";

export type TieBreakRule = "dealer-near";

export type DealerRepeatRule =
  | "dealer-win"
  | "dealer-win-or-tenpai"
  | "always";

export type Uma = {
  first: number;
  second: number;
  third: number;
  fourth: number;
};

export type MatchRule = {
  initialScore: number;
  returnScore: number;
  uma: Uma;
  bankruptcyEnabled: boolean;
  tieBreak: TieBreakRule;
  dealerRepeatRule?: DealerRepeatRule;
};

export type Group = {
  groupId: string;
  name: string;
  createdBy: string;
  defaultRule: MatchRule;
  createdAt: AppTimestamp;
  updatedAt: AppTimestamp;
};

export type GroupMemberRole = "member";

export type GroupMember = {
  groupId: string;
  uid: string;
  role: GroupMemberRole;
  joinedAt: AppTimestamp;
};

export type Player = {
  playerId: string;
  groupId: string;
  name: string;
  linkedUid: string | null;
  createdAt: AppTimestamp;
  updatedAt: AppTimestamp;
};

export type MatchPlayer = {
  playerId: string;
  name: string;
  seatIndex: SeatIndex;
};

export type ScoreDelta = {
  playerId: string;
  delta: number;
};

export type MatchFinalResult = {
  playerId: string;
  name: string;
  seatIndex: SeatIndex;
  finalScore: number;
  rank: 1 | 2 | 3 | 4;
  rawPoint: number;
  uma: number;
  oka: number;
  totalPoint: number;
};

export type Match = {
  matchId: string;
  groupId: string;
  date: string;
  status: MatchStatus;
  players: MatchPlayer[];
  dealerPlayerId: string;
  rule: MatchRule;
  currentRound: MatchRound;
  currentHonba: number;
  currentRiichiSticks: number;
  finalResults: MatchFinalResult[] | null;
  createdBy: string;
  updatedBy: string;
  createdAt: AppTimestamp;
  updatedAt: AppTimestamp;
};

export type Hand = {
  handId: string;
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
  createdBy: string;
  updatedBy: string;
  createdAt: AppTimestamp;
  updatedAt: AppTimestamp;
};

export type PlayerStats = {
  playerId: string;
  groupId: string;
  matchCount: number;
  handCount: number;
  totalPoint: number;
  averagePoint: number;
  averageRank: number;
  totalScore: number;
  averageScore: number;
  winCount: number;
  dealInCount: number;
  tsumoWinCount: number;
  ronWinCount: number;
  firstPlaceCount: number;
  secondPlaceCount: number;
  thirdPlaceCount: number;
  fourthPlaceCount: number;
  winRate: number;
  dealInRate: number;
  tsumoRate: number;
  ronRate: number;
  firstPlaceRate: number;
  secondOrBetterRate: number;
  fourthPlaceRate: number;
  updatedAt: AppTimestamp;
};

export const DEFAULT_MATCH_RULE: MatchRule = {
  initialScore: 25000,
  returnScore: 30000,
  uma: {
    first: 30,
    second: 10,
    third: -10,
    fourth: -30,
  },
  bankruptcyEnabled: true,
  tieBreak: "dealer-near",
  dealerRepeatRule: "dealer-win-or-tenpai",
};
