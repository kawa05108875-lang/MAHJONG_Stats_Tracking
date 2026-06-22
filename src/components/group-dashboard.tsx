"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { MatchCreator } from "@/components/match-creator";
import { PlayerManager } from "@/components/player-manager";
import { PlayerStatsDetail, StatsDashboard } from "@/components/stats-dashboard";
import {
  createGroup,
  getJoinedGroups,
  joinGroup,
  updateGroupDefaultRule,
  type GroupSummary,
} from "@/lib/firestore/groups";
import type { AbortiveDrawType, DealerRepeatRule, MatchRule } from "@/types";

type GroupDashboardProps = {
  user: User;
  onLogout: () => Promise<void>;
};

type DashboardView = "groups" | "ranking" | "matches" | "players" | "rules" | "playerStats";

const VIEW_LABELS: Array<{ key: Exclude<DashboardView, "groups">; label: string }> = [
  { key: "ranking", label: "ランキング" },
  { key: "matches", label: "対局" },
  { key: "players", label: "メンバー" },
  { key: "rules", label: "ルール" },
];

const DEFAULT_DEALER_REPEAT_RULE: DealerRepeatRule = "dealer-win-or-tenpai";
const ABORTIVE_DRAW_LABELS: Array<{ key: AbortiveDrawType; label: string }> = [
  { key: "nineTerminals", label: "九種九牌" },
  { key: "fourWinds", label: "四風連打" },
  { key: "fourRiichi", label: "四家立直" },
  { key: "fourKan", label: "四槓散了" },
];

type RuleForm = ReturnType<typeof createRuleForm>;

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
    agariYameEnabled: rule.agariYameEnabled ?? true,
    westRoundEnabled: rule.westRoundEnabled ?? false,
    doubleRonEnabled: rule.doubleRonEnabled ?? true,
    tripleRonEnabled: rule.tripleRonEnabled ?? true,
    abortiveDrawEnabled: {
      nineTerminals: rule.abortiveDrawEnabled?.nineTerminals ?? true,
      fourWinds: rule.abortiveDrawEnabled?.fourWinds ?? true,
      fourRiichi: rule.abortiveDrawEnabled?.fourRiichi ?? true,
      fourKan: rule.abortiveDrawEnabled?.fourKan ?? true,
    },
  };
}

function buildRule(ruleForm: RuleForm, fallbackRule: MatchRule): MatchRule {
  return {
    initialScore: parseNumber(ruleForm.initialScore, fallbackRule.initialScore),
    returnScore: parseNumber(ruleForm.returnScore, fallbackRule.returnScore),
    uma: {
      first: parseNumber(ruleForm.umaFirst, fallbackRule.uma.first),
      second: parseNumber(ruleForm.umaSecond, fallbackRule.uma.second),
      third: parseNumber(ruleForm.umaThird, fallbackRule.uma.third),
      fourth: parseNumber(ruleForm.umaFourth, fallbackRule.uma.fourth),
    },
    bankruptcyEnabled: ruleForm.bankruptcyEnabled,
    tieBreak: fallbackRule.tieBreak,
    dealerRepeatRule: ruleForm.dealerRepeatRule ?? DEFAULT_DEALER_REPEAT_RULE,
    agariYameEnabled: ruleForm.agariYameEnabled,
    westRoundEnabled: ruleForm.westRoundEnabled,
    doubleRonEnabled: ruleForm.doubleRonEnabled,
    tripleRonEnabled: ruleForm.tripleRonEnabled,
    abortiveDrawEnabled: ruleForm.abortiveDrawEnabled,
  };
}

function ruleFormKey(ruleForm: RuleForm) {
  return JSON.stringify(ruleForm);
}

function shortGroupId(groupId: string) {
  if (groupId.length <= 12) {
    return groupId;
  }

  return `${groupId.slice(0, 6)}...${groupId.slice(-4)}`;
}

export function GroupDashboard({ user, onLogout }: GroupDashboardProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>("groups");
  const [selectedPlayerStatsId, setSelectedPlayerStatsId] = useState<string | null>(null);
  const [playerStatsReturnView, setPlayerStatsReturnView] =
    useState<DashboardView>("ranking");
  const [groupName, setGroupName] = useState("");
  const [joinGroupId, setJoinGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleFormState, setRuleFormState] = useState<{
    groupId: string;
    form: RuleForm;
  } | null>(null);
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.groupId === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const ruleForm = useMemo(() => {
    if (!selectedGroup) {
      return null;
    }

    if (ruleFormState?.groupId === selectedGroup.groupId) {
      return ruleFormState.form;
    }

    return createRuleForm(selectedGroup.defaultRule);
  }, [ruleFormState, selectedGroup]);
  const savedRuleForm = useMemo(
    () => (selectedGroup ? createRuleForm(selectedGroup.defaultRule) : null),
    [selectedGroup],
  );
  const ruleHasChanges =
    ruleForm && savedRuleForm
      ? ruleFormKey(ruleForm) !== ruleFormKey(savedRuleForm)
      : false;

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const joinedGroups = await getJoinedGroups(user.uid);
      setGroups(joinedGroups);
      setSelectedGroupId((currentGroupId) => {
        if (currentGroupId && joinedGroups.some((group) => group.groupId === currentGroupId)) {
          return currentGroupId;
        }

        return joinedGroups[0]?.groupId ?? null;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "グループ一覧の取得に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループ一覧を取得できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadGroups();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadGroups]);

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = groupName.trim();

    if (!trimmedName) {
      setError("グループ名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const groupId = await createGroup({
        name: trimmedName,
        uid: user.uid,
      });

      setGroupName("");
      await loadGroups();
      setSelectedGroupId(groupId);
      setActiveView("ranking");
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : "グループ作成に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループを作成できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleJoinGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedGroupId = joinGroupId.trim();

    if (!trimmedGroupId) {
      setError("参加するグループIDを入力してください。");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const groupId = await joinGroup({
        groupId: trimmedGroupId,
        uid: user.uid,
      });

      setJoinGroupId("");
      await loadGroups();
      setSelectedGroupId(groupId);
      setActiveView("ranking");
    } catch (joinError) {
      const message =
        joinError instanceof Error
          ? joinError.message
          : "グループ参加に失敗しました。";

      setError(
        message.includes("permission")
          ? "グループに参加できませんでした。グループIDまたはFirestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setJoining(false);
    }
  }

  function handleSelectGroup(groupId: string) {
    setSelectedGroupId(groupId);
    setCopiedGroupId(null);
    setSelectedPlayerStatsId(null);
    setPlayerStatsReturnView("ranking");
    setActiveView("ranking");
  }

  async function copyGroupId(groupId: string) {
    if (!navigator.clipboard) {
      setError("このブラウザではコピーできません。グループIDを長押ししてコピーしてください。");
      return;
    }

    try {
      await navigator.clipboard.writeText(groupId);
      setCopiedGroupId(groupId);
      setError(null);
    } catch {
      setError("グループIDをコピーできませんでした。IDを長押ししてコピーしてください。");
    }
  }

  function openPlayerStats(playerId: string) {
    setSelectedPlayerStatsId(playerId);
    setPlayerStatsReturnView(activeView === "players" ? "players" : "ranking");
    setActiveView("playerStats");
  }

  function setRuleForm(updater: (current: RuleForm | null) => RuleForm | null) {
    setRuleFormState((current) => {
      if (!selectedGroup) {
        return null;
      }

      const currentForm =
        current?.groupId === selectedGroup.groupId
          ? current.form
          : createRuleForm(selectedGroup.defaultRule);
      const nextForm = updater(currentForm);

      return nextForm ? { groupId: selectedGroup.groupId, form: nextForm } : null;
    });
  }

  function updateAbortiveDrawRule(key: AbortiveDrawType, enabled: boolean) {
    setRuleForm((current) =>
      current
        ? {
            ...current,
            abortiveDrawEnabled: {
              ...current.abortiveDrawEnabled,
              [key]: enabled,
            },
          }
        : current,
    );
  }

  async function handleSaveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedGroup || !ruleForm) {
      return;
    }

    if (!ruleHasChanges) {
      setError("ルールは変更されていません。");
      return;
    }

    const confirmed = window.confirm(
      "ルールを保存します。今後作成する半荘に反映されます。保存しますか？",
    );

    if (!confirmed) {
      return;
    }

    setRuleSaving(true);
    setError(null);

    try {
      await updateGroupDefaultRule({
        groupId: selectedGroup.groupId,
        defaultRule: buildRule(ruleForm, selectedGroup.defaultRule),
      });
      await loadGroups();
      setSelectedGroupId(selectedGroup.groupId);
      setActiveView("rules");
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "ルールの保存に失敗しました。";

      setError(
        message.includes("permission")
          ? "ルールを保存できませんでした。Firestore Security Rulesを確認してください。"
          : message,
      );
    } finally {
      setRuleSaving(false);
    }
  }

  const showGroupSelector = activeView === "groups" || !selectedGroup;

  return (
    <main className="app-frame">
      <header className="topbar">
        <div className="brand-lockup compact">
          <span className="brand-mark" aria-hidden="true">雀</span>
          <div>
            <p className="eyebrow">Mahjong Logbook</p>
            <h1>ジャンログ</h1>
          </div>
        </div>
        <div className="user-menu">
          <span>{user.displayName ?? user.email ?? "ログイン中"}</span>
          <button type="button" className="small-utility-button" onClick={onLogout}>
            ログアウト
          </button>
        </div>
      </header>

      <section className="workspace flow-workspace">
        {showGroupSelector ? (
          <section className="content-area group-selector-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Groups</p>
                <h2>グループを選択</h2>
              </div>
            </div>

            {loading ? <p className="muted">グループを読み込んでいます...</p> : null}

            {!loading && groups.length === 0 ? (
              <p className="empty-state">まだグループがありません。</p>
            ) : null}

            <div className="group-list">
              {groups.map((group) => (
                <button
                  key={group.groupId}
                  type="button"
                  className={
                    group.groupId === selectedGroupId ? "group-item is-active" : "group-item"
                  }
                  onClick={() => handleSelectGroup(group.groupId)}
                >
                  <span>{group.name}</span>
                </button>
              ))}
            </div>

            <form className="form-grid" onSubmit={handleCreateGroup}>
              <label htmlFor="groupName">新規グループ</label>
              <div className="inline-form">
                <input
                  id="groupName"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="例: 週末麻雀会"
                  maxLength={40}
                />
                <button type="submit" disabled={saving}>
                  作成
                </button>
              </div>
            </form>

            <form className="form-grid" onSubmit={handleJoinGroup}>
              <label htmlFor="joinGroupId">グループIDで参加</label>
              <div className="inline-form">
                <input
                  id="joinGroupId"
                  value={joinGroupId}
                  onChange={(event) => setJoinGroupId(event.target.value)}
                  placeholder="共有されたグループID"
                />
                <button type="submit" disabled={joining}>
                  参加
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="content-area">
            {selectedGroup ? (
              <>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Group Home</p>
                  <h2>{selectedGroup.name}</h2>
                  <div className="share-code">
                    <span title={selectedGroup.groupId}>
                      ID {shortGroupId(selectedGroup.groupId)}
                    </span>
                    <button
                      type="button"
                      className="small-utility-button"
                      onClick={() => void copyGroupId(selectedGroup.groupId)}
                    >
                      {copiedGroupId === selectedGroup.groupId ? "コピー済み" : "コピー"}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="small-utility-button"
                  onClick={() => setActiveView("groups")}
                >
                  グループ変更
                </button>
              </div>

              <div className="flow-nav" aria-label="グループ内メニュー">
                {VIEW_LABELS.map((view) => (
                  <button
                    key={view.key}
                    type="button"
                    className={activeView === view.key ? "is-active" : ""}
                    onClick={() => setActiveView(view.key)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>

              {activeView === "ranking" ? (
                <StatsDashboard
                  groupId={selectedGroup.groupId}
                  onOpenPlayerStats={openPlayerStats}
                />
              ) : null}

              {activeView === "matches" ? (
                <MatchCreator key={selectedGroup.groupId} group={selectedGroup} user={user} />
              ) : null}

              {activeView === "players" ? (
                <PlayerManager
                  groupId={selectedGroup.groupId}
                  user={user}
                  onOpenPlayerStats={openPlayerStats}
                />
              ) : null}

              {activeView === "playerStats" ? (
                <PlayerStatsDetail
                  groupId={selectedGroup.groupId}
                  playerId={selectedPlayerStatsId}
                  onBack={() => setActiveView(playerStatsReturnView)}
                />
              ) : null}

              {activeView === "rules" ? (
                ruleForm ? (
                  <form className="match-form" onSubmit={handleSaveRule}>
                    <div className="rule-grid">
                      <label>
                        <span>開始点</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.initialScore}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, initialScore: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>返し点</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.returnScore}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, returnScore: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>ウマ 1着</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.umaFirst}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, umaFirst: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>ウマ 2着</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.umaSecond}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, umaSecond: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>ウマ 3着</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.umaThird}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, umaThird: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>ウマ 4着</span>
                        <input
                          inputMode="numeric"
                          value={ruleForm.umaFourth}
                          onChange={(event) =>
                            setRuleForm((current) =>
                              current ? { ...current, umaFourth: event.target.value } : current,
                            )
                          }
                        />
                      </label>
                    </div>

                    <label className="select-field">
                      <span>トビ終了</span>
                      <select
                        value={ruleForm.bankruptcyEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  bankruptcyEnabled: event.target.value === "enabled",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="enabled">あり: 誰かが飛んだら終了</option>
                        <option value="disabled">なし: 誰かが飛んでも続行</option>
                      </select>
                    </label>

                    <label className="select-field">
                      <span>連荘ルール</span>
                      <select
                        value={ruleForm.dealerRepeatRule ?? DEFAULT_DEALER_REPEAT_RULE}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  dealerRepeatRule: event.target.value as DealerRepeatRule,
                                }
                              : current,
                          )
                        }
                      >
                        <option value="dealer-win-or-tenpai">親和了・親テンパイ流局で連荘</option>
                        <option value="dealer-win">親和了のみ連荘</option>
                        <option value="always">流局は親テンパイに関係なく連荘</option>
                      </select>
                    </label>

                    <label className="select-field">
                      <span>西入</span>
                      <select
                        value={ruleForm.westRoundEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  westRoundEnabled: event.target.value === "enabled",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="enabled">あり: 南4局終了時に誰も返し点未満なら西入</option>
                        <option value="disabled">なし: 南4局で半荘終了</option>
                      </select>
                    </label>

                    <label className="select-field">
                      <span>上がりやめ</span>
                      <select
                        value={ruleForm.agariYameEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  agariYameEnabled: event.target.value === "enabled",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="enabled">あり: 最終局の親がトップで和了したら終了</option>
                        <option value="disabled">なし: 親が和了したら連荘</option>
                      </select>
                    </label>

                    <label className="select-field">
                      <span>ダブロン</span>
                      <select
                        value={ruleForm.doubleRonEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  doubleRonEnabled: event.target.value === "enabled",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="enabled">あり</option>
                        <option value="disabled">なし</option>
                      </select>
                    </label>

                    <label className="select-field">
                      <span>トリロン</span>
                      <select
                        value={ruleForm.tripleRonEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setRuleForm((current) =>
                            current
                              ? {
                                  ...current,
                                  tripleRonEnabled: event.target.value === "enabled",
                                }
                              : current,
                          )
                        }
                      >
                        <option value="enabled">あり</option>
                        <option value="disabled">なし</option>
                      </select>
                    </label>

                    <div className="check-list">
                      <span className="label">途中流局</span>
                      {ABORTIVE_DRAW_LABELS.map((option) => (
                        <label key={option.key} className="check-row">
                          <input
                            type="checkbox"
                            checked={ruleForm.abortiveDrawEnabled[option.key]}
                            onChange={(event) =>
                              updateAbortiveDrawRule(option.key, event.target.checked)
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>

                    <p className="notice-text">
                      変更がある時だけ保存できます。保存前に確認が表示されます。
                    </p>

                    <button
                      type="submit"
                      className="primary-button"
                      disabled={ruleSaving || !ruleHasChanges}
                    >
                      {ruleSaving ? "保存中..." : ruleHasChanges ? "ルールを保存" : "変更なし"}
                    </button>
                  </form>
                ) : null
              ) : null}
              </>
            ) : (
              <div className="empty-panel">
                <h2>グループを作成してください</h2>
                <p className="muted">
                  グループを作成すると、既定ルールが保存されてホームを確認できます。
                </p>
              </div>
            )}
          </section>
        )}
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}
