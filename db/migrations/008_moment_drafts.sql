CREATE TABLE IF NOT EXISTS blog_moment_drafts (
 moment_id VARCHAR(36) PRIMARY KEY,
 content JSON NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 FOREIGN KEY (moment_id) REFERENCES blog_moments(id) ON DELETE CASCADE,
 INDEX blog_moment_draft_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
