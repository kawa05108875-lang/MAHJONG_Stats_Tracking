import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";

const DELETE_BATCH_SIZE = 450;

async function deleteSnapshotsInBatches(
  snapshots: QueryDocumentSnapshot<DocumentData>[],
) {
  const db = getFirebaseDb();
  let deletedCount = 0;

  for (let index = 0; index < snapshots.length; index += DELETE_BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = snapshots.slice(index, index + DELETE_BATCH_SIZE);

    for (const snapshot of chunk) {
      batch.delete(snapshot.ref);
    }

    await batch.commit();
    deletedCount += chunk.length;
  }

  return deletedCount;
}

export async function deleteMatchData(params: {
  groupId: string;
  matchId: string;
}) {
  const db = getFirebaseDb();
  const handSnapshots = await getDocs(
    query(
      collection(db, "hands"),
      where("groupId", "==", params.groupId),
      where("matchId", "==", params.matchId),
    ),
  );
  const deletedHands = await deleteSnapshotsInBatches(handSnapshots.docs);
  const batch = writeBatch(db);

  batch.delete(doc(db, "matches", params.matchId));
  await batch.commit();

  return {
    deletedHands,
    deletedMatches: 1,
  };
}
