"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  createMatch,
  getGroupMatches,
  type MatchSummary,
} from "@/lib/firestore/matches";
import { getGroupPlayers, type PlayerSummary } from "@/lib/firestore/players";
import type { GroupSummary } from "@/lib/firestore/groups";
import type { MatchPlayer, MatchRule, SeatIndex } from "@/types";

type MatchCreatorProps = {
  group: GroupSummary;
  user: User;
};

const SEAT_LABELS = ["席1", "席2", "席3", "席4"] as const;

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
  };
}

export function MatchCreator({ group, user }: MatchCreatorProps) {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [date, setDate] = useState(todayString());
  const [seatPlayerIds, setSeatPlayerIds] = useState<string[]>(["", "", "", ""]);
  const [dealerPlayerId, setDealerPlayerId] = useState("");
  const [ruleForm, setRuleForm] = useState(() => createRuleForm(group.defaultRule));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMatchId, setCreatedMatchId] = useState<string | null>(null);

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

  const canCreateMatch =
    selectedPlayers.length === 4 &&
    new Set(seatPlayerIds).size === 4 &&
    seatPlayerIds.every(Boolean) &&
    Boolean(dealerPlayerId);

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

  function updateSeat(index: number, playerId: string) {
    setSeatPlayerIds((current) => {
      const next = [...current];
      next[index] = playerId;

      if (!next.includes(dealerPlayerId)) {
        setDealerPlayerId("");
      }

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
        dealerPlayerId,
        rule: buildRule(),
        uid: user.uid,
      });

      setCreatedMatchId(matchId);
      setSeatPlayerIds(["", "", "", ""]);
      setDealerPlayerId("");
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

        <label className="select-field" htmlFor="dealerPlayer">
          <span>起家</span>
          <select
            id="dealerPlayer"
            value={dealerPlayerId}
            onChange={(event) => setDealerPlayerId(event.target.value)}
          >
            <option value="">選択</option>
            {selectedPlayers.map((player) => (
              <option key={player.playerId} value={player.playerId}>
                {player.name}
              </option>
            ))}
          </select>
        </label>

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

        <button type="submit" className="primary-button" disabled={saving || !canCreateMatch}>
          半荘を開始
        </button>
      </form>

      {players.length > 0 && players.length < 4 ? (
        <p className="notice-text">半荘作成には4人以上のプレイヤー登録が必要です。</p>
      ) : null}

      {createdMatchId ? (
        <p className="success-text">半荘を作成しました。局入力はフェーズ6で追加します。</p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

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
              {match.status === "inputting" ? "入力中" : match.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
