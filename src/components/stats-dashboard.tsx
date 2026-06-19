"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGroupPlayerStats,
  type PlayerStatsSummary,
} from "@/lib/firestore/stats";

type StatsDashboardProps = {
  groupId: string;
};

type SortKey =
  | "totalPoint"
  | "averageRank"
  | "averagePoint"
  | "winRate"
  | "dealInRate"
  | "firstPlaceRate"
  | "fourthPlaceRate";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "totalPoint", label: "合計ポイント" },
  { key: "averageRank", label: "平均順位" },
  { key: "averagePoint", label: "平均ポイント" },
  { key: "winRate", label: "和了率" },
  { key: "dealInRate", label: "放銃率" },
  { key: "firstPlaceRate", label: "トップ率" },
  { key: "fourthPlaceRate", label: "ラス率" },
];

const SORT_LABELS = new Map(SORT_OPTIONS.map((option) => [option.key, option.label]));

function formatPoint(value: number) {
  return `${value.toFixed(1)}pt`;
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function statValue(playerStats: PlayerStatsSummary, sortKey: SortKey) {
  const value = playerStats[sortKey];

  return Number.isFinite(value) ? value : 0;
}

function formatSortValue(playerStats: PlayerStatsSummary, sortKey: SortKey) {
  const value = statValue(playerStats, sortKey);

  if (
    sortKey === "winRate" ||
    sortKey === "dealInRate" ||
    sortKey === "firstPlaceRate" ||
    sortKey === "fourthPlaceRate"
  ) {
    return formatRate(value);
  }

  if (sortKey === "averageRank") {
    return value.toFixed(2);
  }

  return formatPoint(value);
}

function compareStats(left: PlayerStatsSummary, right: PlayerStatsSummary, sortKey: SortKey) {
  const leftValue = statValue(left, sortKey);
  const rightValue = statValue(right, sortKey);
  const primaryDiff =
    sortKey === "averageRank" || sortKey === "dealInRate" || sortKey === "fourthPlaceRate"
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

function selectedStatsById(
  stats: PlayerStatsSummary[],
  selectedPlayerId: string | null,
) {
  return stats.find((playerStats) => playerStats.playerId === selectedPlayerId) ?? null;
}

function sortDirectionLabel(sortKey: SortKey) {
  if (sortKey === "averageRank" || sortKey === "dealInRate" || sortKey === "fourthPlaceRate") {
    return "低い順";
  }

  return "高い順";
}

export function StatsDashboard({ groupId }: StatsDashboardProps) {
  const [stats, setStats] = useState<PlayerStatsSummary[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalPoint");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedStats = await getGroupPlayerStats(groupId);
      setStats(loadedStats);
      setSelectedPlayerId((currentPlayerId) => {
        if (currentPlayerId && loadedStats.some((playerStats) => playerStats.playerId === currentPlayerId)) {
          return currentPlayerId;
        }

        return loadedStats[0]?.playerId ?? null;
      });
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
    () => [...stats].sort((left, right) => compareStats(left, right, sortKey)),
    [sortKey, stats],
  );
  const selectedStats = selectedStatsById(stats, selectedPlayerId);

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
        <div className="stats-layout">
          <div className="ranking-list">
            {rankedStats.map((playerStats, index) => (
              <button
                key={playerStats.playerId}
                type="button"
                className={
                  playerStats.playerId === selectedPlayerId
                    ? "ranking-row is-active"
                    : "ranking-row"
                }
                onClick={() => setSelectedPlayerId(playerStats.playerId)}
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

          {selectedStats ? (
            <div className="stats-detail">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Player</p>
                  <h4>{selectedStats.name}</h4>
                </div>
              </div>
              <div className="metric-grid compact-metrics">
                <div className="metric">
                  <span className="label">合計ポイント</span>
                  <strong>{formatPoint(selectedStats.totalPoint)}</strong>
                </div>
                <div className="metric">
                  <span className="label">平均順位</span>
                  <strong>{selectedStats.averageRank.toFixed(2)}</strong>
                </div>
                <div className="metric">
                  <span className="label">平均ポイント</span>
                  <strong>{formatPoint(selectedStats.averagePoint)}</strong>
                </div>
                <div className="metric">
                  <span className="label">平均素点</span>
                  <strong>{selectedStats.averageScore.toFixed(0)}</strong>
                </div>
                <div className="metric">
                  <span className="label">トップ率</span>
                  <strong>{formatRate(selectedStats.firstPlaceRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">連対率</span>
                  <strong>{formatRate(selectedStats.secondOrBetterRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">ラス率</span>
                  <strong>{formatRate(selectedStats.fourthPlaceRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">和了率</span>
                  <strong>{formatRate(selectedStats.winRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">放銃率</span>
                  <strong>{formatRate(selectedStats.dealInRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">ツモ率</span>
                  <strong>{formatRate(selectedStats.tsumoRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">ロン率</span>
                  <strong>{formatRate(selectedStats.ronRate)}</strong>
                </div>
                <div className="metric">
                  <span className="label">参加局数</span>
                  <strong>{selectedStats.handCount}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
