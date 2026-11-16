CREATE TABLE IF NOT EXISTS blog_series (
 id VARCHAR(36) PRIMARY KEY,
 slug VARCHAR(120) NOT NULL UNIQUE,
 title VARCHAR(160) NOT NULL,
 description TEXT NOT NULL,
 section VARCHAR(20) NOT NULL DEFAULT 'blog',
 status VARCHAR(16) NOT NULL DEFAULT 'draft',
 state VARCHAR(16) NOT NULL DEFAULT 'ongoing',
 root_post_id VARCHAR(36) NULL UNIQUE,
 version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 FOREIGN KEY (root_post_id) REFERENCES blog_posts(id) ON DELETE RESTRICT,
 INDEX blog_series_public (status, section, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_series_entries (
 post_id VARCHAR(36) PRIMARY KEY,
 series_id VARCHAR(36) NOT NULL,
 FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
 FOREIGN KEY (series_id) REFERENCES blog_series(id) ON DELETE CASCADE,
 INDEX blog_series_entry_collection (series_id, post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
