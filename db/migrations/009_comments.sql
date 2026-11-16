CREATE TABLE IF NOT EXISTS blog_comments (
 id VARCHAR(36) PRIMARY KEY,
 post_id VARCHAR(36) NULL,
 moment_id VARCHAR(36) NULL,
 parent_id VARCHAR(36) NULL,
 author_id VARCHAR(36) NULL,
 author_name VARCHAR(60) NOT NULL,
 author_email VARCHAR(254) NOT NULL DEFAULT '',
 body TEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
 FOREIGN KEY (moment_id) REFERENCES blog_moments(id) ON DELETE CASCADE,
 FOREIGN KEY (parent_id) REFERENCES blog_comments(id) ON DELETE CASCADE,
 FOREIGN KEY (author_id) REFERENCES blog_users(id) ON DELETE SET NULL,
 INDEX blog_comments_post (post_id,status,created_at),
 INDEX blog_comments_moment (moment_id,status,created_at),
 INDEX blog_comments_review (status,created_at),
 INDEX blog_comments_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_comment_limits (
 rate_key VARCHAR(64) PRIMARY KEY,
 attempts INT NOT NULL,
 resets_at DATETIME(3) NOT NULL,
 INDEX blog_comment_limit_expiry (resets_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
