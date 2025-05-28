const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Initialize Firebase Admin SDK
const serviceAccount = require(path.join(__dirname, "service_accountKey.json"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const dryRun = process.argv.includes("--dry-run");
const cutoffDate = new Date("2025-04-28T00:00:00Z");
const deletedUsers = [];
const MAX_DELETIONS = 950; // Safe quota limit
let totalDeleted = 0;

async function deleteOldAuthUsers() {
  console.log(`Starting Auth deletion... Dry Run Mode: ${dryRun ? "ON" : "OFF"}`);
  let nextPageToken = undefined;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    const deletions = [];

    for (const userRecord of result.users) {
      const uid = userRecord.uid;
      const phoneNumber = userRecord.phoneNumber || "N/A";
      const creationTime = userRecord.metadata.creationTime;

      if (!creationTime) {
        console.warn(`⚠️ Skipping ${uid}: No creationTime found.`);
        continue;
      }

      const createdAt = new Date(creationTime);

      if (createdAt < cutoffDate) {
        const logEntry = {
          uid,
          phoneNumber,
          createdAt: createdAt.toISOString()
        };

        if (dryRun) {
          console.log(`[DRY RUN] Would delete Auth user: ${uid} (Created: ${createdAt.toISOString()})`);
        } else if (totalDeleted < MAX_DELETIONS) {
          const deletion = auth.deleteUser(uid)
            .then(() => {
              console.log(`✅ Deleted Auth user: ${uid} (Created: ${createdAt.toISOString()})`);
              totalDeleted++;
            })
            .catch(err => {
              console.error(`❌ Error deleting user ${uid}:`, err.message);
            });

          deletions.push(deletion);
        } else {
          console.warn(`🚫 Quota limit reached. Skipping user: ${uid}`);
          nextPageToken = null; // stop loop
          break;
        }

        deletedUsers.push(logEntry);
      }
    }

    if (!dryRun && deletions.length > 0) {
      await Promise.all(deletions);
    }

    if (totalDeleted >= MAX_DELETIONS) {
      console.log(`⚠️ Reached maximum deletions (${MAX_DELETIONS}). Stopping...`);
      break;
    }

    nextPageToken = result.pageToken || null;
  } while (nextPageToken);

  // Save log
  const fileName = dryRun ? "dry_run_deleted_auth_users.json" : "deleted_auth_users.json";
  fs.writeFileSync(fileName, JSON.stringify(deletedUsers, null, 2));
  console.log(`📄 Log saved to: ${fileName}`);

  console.log(dryRun ? "✅ Dry run completed." : `🎉 Auth deletion complete. Total deleted: ${totalDeleted}`);
}

deleteOldAuthUsers().catch(console.error);
