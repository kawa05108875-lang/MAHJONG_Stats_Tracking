"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGroupPlayerStats,
  type PlayerStatsSummary,
} from "@/lib/firestore/stats";

type StatsDashboardProps = {
  groupId: string;
  onOpenPlayerStats: (playerId: string) => void;
};

type PlayerStatsDetailProps = {
  groupId: string;
  playerId: string | null;
  onBack: () => void;
};

type SortKey =
  | "totalPoint"
  | "averageRank"
  | "averagePoint"
  | "winRate"
  | "riichiRate"
  | "tsumoRate"
  | "averageWinScore"
  | "dealInRate"
  | "winDealInDiff"
  | "averageDealInScore"
  | "firstPlaceRate"
  | "secondOrBetterRate"
  | "fourthPlaceRate";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "totalPoint", label: "合計ポイント" },
  { key: "averageRank", label: "平均順位" },
  { key: "averagePoint", label: "平均ポイント" },
  { key: "winRate", label: "和了率" },
  { key: "riichiRate", label: "立直率" },
  { key: "tsumoRate", label: "ツモ率" },
  { key: "averageWinScore", label: "平均打点" },
  { key: "dealInRate", label: "放銃率" },
  { key: "winDealInDiff", label: "和放差" },
  { key: "averageDealInScore", label: "平均放銃打点" },
  { key: "firstPlaceRate", label: "トップ率" },
  { key: "secondOrBetterRate", label: "連対率" },
  { key: "fourthPlaceRate", label: "ラス率" },
];

const SORT_LABELS = new Map(SORT_OPTIONS.map((option) => [option.key, option.label]));

function formatPoint(value: number) {
  return `${value.toFixed(1)}pt`;
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number) {
  return `${Math.round(value).toLocaleString()}点`;
}

function statValue(playerStats: PlayerStatsSummary, sortKey: SortKey) {
  const value = playerStats[sortKey];

  return Number.isFinite(value) ? value : 0;
}

function formatSortValue(playerStats: PlayerStatsSummary, sortKey: SortKey) {
  const value = statValue(playerStats, sortKey);

  if (
    sortKey === "winRate" ||
    sortKey === "riichiRate" ||
    sortKey === "tsumoRate" ||
    sortKey === "dealInRate" ||
    sortKey === "winDealInDiff" ||
    sortKey === "firstPlaceRate" ||
    sortKey === "secondOrBetterRate" ||
    sortKey === "fourthPlaceRate"
  ) {
    return formatRate(value);
  }

  if (sortKey === "averageRank") {
    return value.toFixed(2);
  }

  if (sortKey === "averageWinScore" || sortKey === "averageDealInScore") {
    return formatScore(value);
  }

  return formatPoint(value);
}

function compareStats(left: PlayerStatsSummary, right: PlayerStatsSummary, sortKey: SortKey) {
  const leftValue = statValue(left, sortKey);
  const rightValue = statValue(right, sortKey);
  const primaryDiff =
    sortKey === "averageRank" ||
    sortKey === "dealInRate" ||
    sortKey === "averageDealInScore" ||
    sortKey === "fourthPlaceRate"
      ? leftValue - rightValue
      : rightValue - leftValue;

  if (primaryDiff !== 0) {
    return primaryDiff;
  }

  const pointDiff = statValue(right, "totalPoint") - statValue(left, "totalPoint");

  if (pointDiff !== 0) {
    return pointDiff;
  }

  return left.name.localeCompare(right.name, "ja");
}

function findStatsById(
  stats: PlayerStatsSummary[],
  selectedPlayerId: string | null,
) {
  return stats.find((playerStats) => playerStats.playerId === selectedPlayerId) ?? null;
}

function sortDirectionLabel(sortKey: SortKey) {
  if (
    sortKey === "averageRank" ||
    sortKey === "dealInRate" ||
    sortKey === "averageDealInScore" ||
    sortKey === "fourthPlaceRate"
  ) {
    return "低い順";
  }

  return "高い順";
}

function StatsDetailCard({ playerStats }: { playerStats: PlayerStatsSummary }) {
  return (
    <div className="stats-detail">
      <div className="section-header">
        <div>
          <p className="eyebrow">Player</p>
          <h4>{playerStats.name}</h4>
        </div>
      </div>
      <div className="metric-grid compact-metrics">
        <div className="metric">
          <span className="label">合計ポイント</span>
          <strong>{formatPoint(playerStats.totalPoint)}</strong>
        </div>
        <div className="metric">
          <span className="label">平均順位</span>
          <strong>{playerStats.averageRank.toFixed(2)}</strong>
        </div>
        <div className="metric">
          <span className="label">平均ポイント</span>
          <strong>{formatPoint(playerStats.averagePoint)}</strong>
        </div>
        <div className="metric">
          <span className="label">平均素点</span>
          <strong>{playerStats.averageScore.toFixed(0)}</strong>
        </div>
        <div className="metric">
          <span className="label">トップ率</span>
          <strong>{formatRate(playerStats.firstPlaceRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">連対率</span>
          <strong>{formatRate(playerStats.secondOrBetterRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">ラス率</span>
          <strong>{formatRate(playerStats.fourthPlaceRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">和了率</span>
          <strong>{formatRate(playerStats.winRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">立直率</span>
          <strong>{formatRate(playerStats.riichiRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">放銃率</span>
          <strong>{formatRate(playerStats.dealInRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">和放差</span>
          <strong>{formatRate(playerStats.winDealInDiff)}</strong>
        </div>
        <div className="metric">
          <span className="label">ツモ率</span>
          <strong>{formatRate(playerStats.tsumoRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">平均打点</span>
          <strong>{formatScore(playerStats.averageWinScore)}</strong>
        </div>
        <div className="metric">
          <span className="label">平均放銃打点</span>
          <strong>{formatScore(playerStats.averageDealInScore)}</strong>
        </div>
        <div className="metric">
          <span className="label">ロン率</span>
          <strong>{formatRate(playerStats.ronRate)}</strong>
        </div>
        <div className="metric">
          <span className="label">参加局数</span>
          <strong>{playerStats.handCount}</strong>
        </div>
      </div>
    </div>
  );
}

export function StatsDashboard({ groupId, onOpenPlayerStats }: StatsDashboardProps) {
  const [stats, setStats] = useState<PlayerStatsSummary[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("totalPoint");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedStats = await getGroupPlayerStats(groupId);
      setStats(loadedStats);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "成績の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "成績を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStats();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadStats]);

  useEffect(() => {
    function handleStatsChanged(event: Event) {
      const customEvent = event as CustomEvent<{ groupId?: string }>;

      if (customEvent.detail?.groupId === groupId) {
        void loadStats();
      }
    }

    window.addEventListener("mahjong:stats-changed", handleStatsChanged);

    return () => {
      window.removeEventListener("mahjong:stats-changed", handleStatsChanged);
    };
  }, [groupId, loadStats]);

  const rankedStats = useMemo(
    () =>
      stats
        .filter((playerStats) => playerStats.matchCount > 0)
        .sort((left, right) => compareStats(left, right, sortKey)),
    [sortKey, stats],
  );

  return (
    <section className="manager-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Stats</p>
          <h3>ランキング</h3>
        </div>
      </div>

      <label className="select-field compact-field">
        <span>並び替え</span>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {loading ? <p className="muted">成績を読み込んでいます...</p> : null}
      {!loading && rankedStats.length === 0 ? (
        <p className="empty-state">まだ成績がありません。半荘を終了すると表示されます。</p>
      ) : null}

      {rankedStats.length > 0 ? (
        <div className="ranking-list">
          <p className="notice-text">プレイヤーを押すと個人成績を確認できます。</p>
          <div className="ranking-list">
            {rankedStats.map((playerStats, index) => (
              <button
                key={playerStats.playerId}
                type="button"
                className="ranking-row"
                onClick={() => onOpenPlayerStats(playerStats.playerId)}
              >
                <strong>{index + 1}</strong>
                <span>{playerStats.name}</span>
                <span>{formatSortValue(playerStats, sortKey)}</span>
                <small>
                  {SORT_LABELS.get(sortKey)} {sortDirectionLabel(sortKey)}
                </small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

export function PlayerStatsDetail({ groupId, playerId, onBack }: PlayerStatsDetailProps) {
  const [stats, setStats] = useState<PlayerStatsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setStats(await getGroupPlayerStats(groupId));
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "成績の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "成績を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStats();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadStats]);

  const selectedStats = findStatsById(stats, playerId);

  return (
    <section className="manager-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Player Stats</p>
          <h3>個人成績</h3>
        </div>
        <button type="button" onClick={onBack}>
          戻る
        </button>
      </div>

      {loading ? <p className="muted">成績を読み込んでいます...</p> : null}
      {!loading && !selectedStats ? (
        <p className="empty-state">このプレイヤーの成績が見つかりません。</p>
      ) : null}
      {selectedStats ? <StatsDetailCard playerStats={selectedStats} /> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
