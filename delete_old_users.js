const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

const dryRun = process.argv.includes("--dry-run");

async function deleteUsersWithoutCreatedOn() {
  console.log(`Starting script... Dry Run Mode: ${dryRun ? "ON" : "OFF"}`);

  const usersRef = db.collection("users");
  const snapshot = await usersRef.get();

  if (snapshot.empty) {
    console.log("✅ No users found.");
    return;
  }

  const deletions = [];

  snapshot.forEach(doc => {
    const userData = doc.data();
    const uid = doc.id;

    if (!userData.createdOn) {
      if (!uid) {
        console.warn(`⚠️ Skipping doc ${doc.id} — missing UID.`);
        return;
      }

      if (dryRun) {
        console.log(`[DRY RUN] Would back up and delete user WITHOUT createdOn: ${uid}`);
      } else {
        const backupUser = db.collection("deleted_users").doc(uid).set({
          ...userData,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          deletionReason: "Missing createdOn"
        });

        const deleteAuth = auth.deleteUser(uid)
          .then(() => console.log(`✅ Deleted Auth user: ${uid}`))
          .catch(err => console.error(`❌ Error deleting Auth user ${uid}:`, err));

        const deleteDoc = doc.ref.delete()
          .then(() => console.log(`🗑️ Deleted Firestore doc: ${doc.id}`))
          .catch(err => console.error(`❌ Error deleting Firestore doc ${doc.id}:`, err));

        deletions.push(Promise.all([backupUser, deleteAuth, deleteDoc]));
      }
    }
  });

  if (!dryRun) {
    await Promise.all(deletions);
    console.log("🎉 Deletion and backup of users without createdOn completed.");
  } else {
    console.log("✅ Dry run completed. No users were deleted.");
  }
}

deleteUsersWithoutCreatedOn().catch(console.error);
