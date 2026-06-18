"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { HandEntry } from "@/components/hand-entry";
import {
  createMatch,
  getGroupMatches,
  type MatchSummary,
} from "@/lib/firestore/matches";
import { getGroupPlayers, type PlayerSummary } from "@/lib/firestore/players";
import type { GroupSummary } from "@/lib/firestore/groups";
import type {
  DealerRepeatRule,
  MatchFinalResult,
  MatchPlayer,
  MatchRule,
  SeatIndex,
} from "@/types";

type MatchCreatorProps = {
  group: GroupSummary;
  user: User;
};

const SEAT_LABELS = ["東家", "南家", "西家", "北家"] as const;
const DEFAULT_DEALER_REPEAT_RULE: DealerRepeatRule = "dealer-win-or-tenpai";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRuleForm(rule: MatchRule) {
  return {
    initialScore: String(rule.initialScore),
    returnScore: String(rule.returnScore),
    umaFirst: String(rule.uma.first),
    umaSecond: String(rule.uma.second),
    umaThird: String(rule.uma.third),
    umaFourth: String(rule.uma.fourth),
    bankruptcyEnabled: rule.bankruptcyEnabled,
    dealerRepeatRule: rule.dealerRepeatRule ?? DEFAULT_DEALER_REPEAT_RULE,
  };
}

function statusLabel(status: MatchSummary["status"]) {
  if (status === "inputting") {
    return "入力中";
  }

  if (status === "finished") {
    return "終了";
  }

  return "キャンセル";
}

function MatchResultPanel({ results }: { results: MatchFinalResult[] }) {
  return (
    <section className="result-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Final Results</p>
          <h3>半荘結果</h3>
        </div>
      </div>
      <div className="result-table">
        {results.map((result) => (
          <div key={result.playerId} className="result-row">
            <strong>{result.rank}位</strong>
            <span>{result.name}</span>
            <span>{result.finalScore.toLocaleString()}点</span>
            <span>
              素点 {result.rawPoint.toFixed(1)} / ウマ {result.uma.toFixed(1)} / オカ{" "}
              {result.oka.toFixed(1)}
            </span>
            <strong>{result.totalPoint.toFixed(1)}pt</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MatchCreator({ group, user }: MatchCreatorProps) {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [date, setDate] = useState(todayString());
  const [seatPlayerIds, setSeatPlayerIds] = useState<string[]>(["", "", "", ""]);
  const [ruleForm, setRuleForm] = useState(() => createRuleForm(group.defaultRule));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMatchId, setCreatedMatchId] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const selectedPlayers = useMemo(
    () =>
      seatPlayerIds
        .map((playerId, seatIndex) => {
          const player = players.find((candidate) => candidate.playerId === playerId);

          if (!player) {
            return null;
          }

          return {
            playerId: player.playerId,
            name: player.name,
            seatIndex: seatIndex as SeatIndex,
          } satisfies MatchPlayer;
        })
        .filter((player): player is MatchPlayer => player !== null),
    [players, seatPlayerIds],
  );

  const selectedPlayerIds = seatPlayerIds.filter(Boolean);
  const selectedMatch = useMemo(
    () => matches.find((match) => match.matchId === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  );
  const uniqueSelectedPlayerCount = new Set(selectedPlayerIds).size;
  const canCreateMatch =
    selectedPlayers.length === 4 &&
    uniqueSelectedPlayerCount === 4 &&
    seatPlayerIds.every(Boolean);
  const disabledReason = !canCreateMatch
    ? players.length < 4
      ? "半荘作成には4人以上のプレイヤー登録が必要です。"
      : selectedPlayerIds.length < 4
        ? "東家、南家、西家、北家をすべて選択してください。"
        : uniqueSelectedPlayerCount < 4
          ? "同じプレイヤーが重複しています。"
          : null
    : null;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [loadedPlayers, loadedMatches] = await Promise.all([
        getGroupPlayers(group.groupId),
        getGroupMatches(group.groupId),
      ]);

      setPlayers(loadedPlayers);
      setMatches(loadedMatches);
      setSelectedMatchId((currentMatchId) => {
        if (currentMatchId && loadedMatches.some((match) => match.matchId === currentMatchId)) {
          return currentMatchId;
        }

        return loadedMatches[0]?.matchId ?? null;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "半荘作成に必要なデータ取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "半荘データを取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [group.groupId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  useEffect(() => {
    function handlePlayersChanged(event: Event) {
      const customEvent = event as CustomEvent<{ groupId?: string }>;

      if (customEvent.detail?.groupId === group.groupId) {
        void loadData();
      }
    }

    window.addEventListener("mahjong:players-changed", handlePlayersChanged);

    return () => {
      window.removeEventListener("mahjong:players-changed", handlePlayersChanged);
    };
  }, [group.groupId, loadData]);

  function updateSeat(index: number, playerId: string) {
    setSeatPlayerIds((current) => {
      const next = [...current];
      next[index] = playerId;

      return next;
    });
  }

  function buildRule(): MatchRule {
    return {
      initialScore: parseNumber(ruleForm.initialScore, group.defaultRule.initialScore),
      returnScore: parseNumber(ruleForm.returnScore, group.defaultRule.returnScore),
      uma: {
        first: parseNumber(ruleForm.umaFirst, group.defaultRule.uma.first),
        second: parseNumber(ruleForm.umaSecond, group.defaultRule.uma.second),
        third: parseNumber(ruleForm.umaThird, group.defaultRule.uma.third),
        fourth: parseNumber(ruleForm.umaFourth, group.defaultRule.uma.fourth),
      },
      bankruptcyEnabled: ruleForm.bankruptcyEnabled,
      tieBreak: group.defaultRule.tieBreak,
      dealerRepeatRule: ruleForm.dealerRepeatRule,
    };
  }

  async function handleCreateMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canCreateMatch) {
      setError("重複しない4人のプレイヤーと起家を選択してください。");
      return;
    }

    setSaving(true);
    setError(null);
    setCreatedMatchId(null);

    try {
      const matchId = await createMatch({
        groupId: group.groupId,
        date,
        players: selectedPlayers,
        dealerPlayerId: seatPlayerIds[0],
        rule: buildRule(),
        uid: user.uid,
      });

      setCreatedMatchId(matchId);
      setSelectedMatchId(matchId);
      setSeatPlayerIds(["", "", "", ""]);
      await loadData();
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : "半荘作成に失敗しました。";

      setError(
        message.includes("permission")
          ? "半荘を作成できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="manager-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Matches</p>
          <h3>半荘作成</h3>
        </div>
        <button type="button" onClick={loadData} disabled={loading}>
          更新
        </button>
      </div>

      <form className="match-form" onSubmit={handleCreateMatch}>
        <p className="notice-text">
          登録済みプレイヤー: {players.length}人 / 選択中: {selectedPlayers.length}人
        </p>

        <label htmlFor="matchDate">対局日</label>
        <input
          id="matchDate"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />

        <div className="seat-grid">
          {SEAT_LABELS.map((label, index) => (
            <label key={label} className="select-field">
              <span>{label}</span>
              <select
                value={seatPlayerIds[index]}
                onChange={(event) => updateSeat(index, event.target.value)}
              >
                <option value="">選択</option>
                {players.map((player) => (
                  <option
                    key={player.playerId}
                    value={player.playerId}
                    disabled={
                      seatPlayerIds.includes(player.playerId) &&
                      seatPlayerIds[index] !== player.playerId
                    }
                  >
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p className="notice-text">起家は東家として保存されます。</p>

        <div className="rule-grid">
          <label>
            <span>開始点</span>
            <input
              inputMode="numeric"
              value={ruleForm.initialScore}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  initialScore: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>返し点</span>
            <input
              inputMode="numeric"
              value={ruleForm.returnScore}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  returnScore: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>ウマ 1着</span>
            <input
              inputMode="numeric"
              value={ruleForm.umaFirst}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  umaFirst: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>ウマ 2着</span>
            <input
              inputMode="numeric"
              value={ruleForm.umaSecond}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  umaSecond: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>ウマ 3着</span>
            <input
              inputMode="numeric"
              value={ruleForm.umaThird}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  umaThird: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>ウマ 4着</span>
            <input
              inputMode="numeric"
              value={ruleForm.umaFourth}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  umaFourth: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={ruleForm.bankruptcyEnabled}
            onChange={(event) =>
              setRuleForm((current) => ({
                ...current,
                bankruptcyEnabled: event.target.checked,
              }))
            }
          />
          <span>トビ終了あり</span>
        </label>

        <label className="select-field">
          <span>連荘ルール</span>
          <select
            value={ruleForm.dealerRepeatRule}
            onChange={(event) =>
              setRuleForm((current) => ({
                ...current,
                dealerRepeatRule: event.target.value as DealerRepeatRule,
              }))
            }
          >
            <option value="dealer-win-or-tenpai">親和了・親テンパイ流局で連荘</option>
            <option value="dealer-win">親和了のみ連荘</option>
            <option value="always">流局は親テンパイに関係なく連荘</option>
          </select>
        </label>

        <button type="submit" className="primary-button" disabled={saving || !canCreateMatch}>
          半荘を開始
        </button>
      </form>

      {disabledReason ? <p className="notice-text">{disabledReason}</p> : null}

      {createdMatchId ? (
        <p className="success-text">半荘を作成しました。局入力はフェーズ6で追加します。</p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {selectedMatch?.status === "finished" && selectedMatch.finalResults ? (
        <MatchResultPanel results={selectedMatch.finalResults} />
      ) : selectedMatch ? (
        <HandEntry
          key={selectedMatch.matchId}
          match={selectedMatch}
          user={user}
          onSaved={loadData}
        />
      ) : null}

      <div className="match-list">
        <h4>最近の半荘</h4>
        {loading ? <p className="muted">半荘を読み込んでいます...</p> : null}
        {!loading && matches.length === 0 ? (
          <p className="empty-state">まだ半荘がありません。</p>
        ) : null}
        {matches.slice(0, 5).map((match) => (
          <div key={match.matchId} className="match-row">
            <div>
              <strong>{match.date}</strong>
              <span className="muted">
                {match.players.map((player) => player.name).join(" / ")}
              </span>
            </div>
            <span className="status-pill linked">
              {statusLabel(match.status)}
            </span>
            <button type="button" onClick={() => setSelectedMatchId(match.matchId)}>
              {match.status === "finished" ? "結果" : "局入力"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
