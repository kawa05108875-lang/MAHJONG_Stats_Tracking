import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { DEFAULT_MATCH_RULE, type Group, type GroupMember, type MatchRule } from "@/types";

export type GroupSummary = Pick<
  Group,
  "groupId" | "name" | "createdBy" | "defaultRule"
> & {
  joinedAt?: GroupMember["joinedAt"];
};

function groupMemberId(groupId: string, uid: string) {
  return `${groupId}_${uid}`;
}

export async function createGroup(params: { name: string; uid: string }) {
  const db = getFirebaseDb();
  const groupRef = doc(collection(db, "groups"));
  const memberRef = doc(
    db,
    "groupMembers",
    groupMemberId(groupRef.id, params.uid),
  );
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.set(groupRef, {
    groupId: groupRef.id,
    name: params.name,
    createdBy: params.uid,
    defaultRule: DEFAULT_MATCH_RULE,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(memberRef, {
    groupId: groupRef.id,
    uid: params.uid,
    role: "member",
    joinedAt: now,
  });

  await batch.commit();

  return groupRef.id;
}

export async function joinGroup(params: { groupId: string; uid: string }) {
  const db = getFirebaseDb();
  const trimmedGroupId = params.groupId.trim();
  const groupRef = doc(db, "groups", trimmedGroupId);
  const groupSnapshot = await getDoc(groupRef);

  if (!groupSnapshot.exists()) {
    throw new Error("指定されたグループが見つかりません。");
  }

  const memberRef = doc(
    db,
    "groupMembers",
    groupMemberId(trimmedGroupId, params.uid),
  );
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.set(memberRef, {
    groupId: trimmedGroupId,
    uid: params.uid,
    role: "member",
    joinedAt: now,
  });

  await batch.commit();

  return trimmedGroupId;
}

export async function getJoinedGroups(uid: string): Promise<GroupSummary[]> {
  const db = getFirebaseDb();
  const membersQuery = query(
    collection(db, "groupMembers"),
    where("uid", "==", uid),
  );
  const memberSnapshots = await getDocs(membersQuery);
  const memberships = memberSnapshots.docs.map((snapshot) => snapshot.data() as GroupMember);

  const groups: Array<GroupSummary | null> = await Promise.all(
    memberships.map(async (membership) => {
      const groupSnapshot = await getDoc(doc(db, "groups", membership.groupId));

      if (!groupSnapshot.exists()) {
        return null;
      }

      const group = groupSnapshot.data() as Group;

      return {
        groupId: group.groupId,
        name: group.name,
        createdBy: group.createdBy,
        defaultRule: group.defaultRule,
        joinedAt: membership.joinedAt,
      } satisfies GroupSummary;
    }),
  );

  const joinedGroups = groups.filter(
    (group): group is GroupSummary => group !== null,
  );

  return joinedGroups.sort((left, right) => left.name.localeCompare(right.name, "ja"));
}

export async function updateGroupDefaultRule(params: {
  groupId: string;
  defaultRule: MatchRule;
}) {
  const db = getFirebaseDb();
  const groupRef = doc(db, "groups", params.groupId);

  await updateDoc(groupRef, {
    defaultRule: params.defaultRule,
    updatedAt: serverTimestamp(),
  });
}
