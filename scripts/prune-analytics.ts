import { getPool, closeDatabase } from "../src/db";
async function main() {
  let deleted = 0;
  while (true) {
    const [result] = await getPool().query<any>(
      "DELETE FROM blog_analytics_views WHERE started_at<UTC_TIMESTAMP(3)-INTERVAL 180 DAY LIMIT 2000"
    );
    deleted += result.affectedRows;
    if (result.affectedRows < 2000) break;
  }
  console.log(
    JSON.stringify({
      event: "analytics_retention",
      days: 180,
      deletedViews: deleted,
    })
  );
}
main()
  .catch(() => {
    console.error("ANALYTICS_RETENTION_FAILED");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
