import {
  collection,
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

export async function resetGroupMatchData(groupId: string) {
  const db = getFirebaseDb();
  const [handSnapshots, matchSnapshots, statsSnapshots] = await Promise.all([
    getDocs(query(collection(db, "hands"), where("groupId", "==", groupId))),
    getDocs(query(collection(db, "matches"), where("groupId", "==", groupId))),
    getDocs(query(collection(db, "playerStats"), where("groupId", "==", groupId))),
  ]);

  const deletedHands = await deleteSnapshotsInBatches(handSnapshots.docs);
  const deletedMatches = await deleteSnapshotsInBatches(matchSnapshots.docs);
  const deletedStats = await deleteSnapshotsInBatches(statsSnapshots.docs);

  return {
    deletedHands,
    deletedMatches,
    deletedStats,
  };
}
