UPDATE blog_post_revisions r INNER JOIN blog_posts p ON p.id = r.post_id
 SET r.content = JSON_SET(r.content, '$.metadata.hideFromListing', CAST('true' AS JSON), '$.metadata.pageContent', CAST('true' AS JSON))
 WHERE p.source_path = 'content/link/link.md' AND p.version = 1 AND r.action = 'import';
UPDATE blog_posts SET status = 'published', metadata = JSON_SET(metadata, '$.hideFromListing', CAST('true' AS JSON), '$.pageContent', CAST('true' AS JSON))
 WHERE source_path = 'content/link/link.md' AND version = 1 AND status = 'draft';
DELETE d FROM blog_post_drafts d INNER JOIN blog_posts p ON p.id = d.post_id
 WHERE p.source_path = 'content/link/link.md' AND p.version = 1 AND p.status = 'published' AND JSON_EXTRACT(p.metadata, '$.pageContent') = CAST('true' AS JSON);
