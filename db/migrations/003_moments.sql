CREATE TABLE IF NOT EXISTS blog_moment_sources (
 id VARCHAR(190) PRIMARY KEY, platform VARCHAR(16) NOT NULL, account VARCHAR(128) NOT NULL,
 title VARCHAR(255) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, sync_state JSON NOT NULL,
 last_attempt_at DATETIME(3), last_success_at DATETIME(3), last_error VARCHAR(255),
 created_at DATETIME(3) NOT NULL, UNIQUE KEY blog_moment_source_account (platform, account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_moments (
 id VARCHAR(36) PRIMARY KEY, source_id VARCHAR(190) NOT NULL, external_id VARCHAR(128) NOT NULL,
 source_url TEXT NOT NULL, title VARCHAR(500) NOT NULL, body_text LONGTEXT NOT NULL, body_html LONGTEXT NOT NULL,
 media JSON NOT NULL, tags JSON NOT NULL, content_hash VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'published', published_at DATETIME(3) NOT NULL,
 first_seen_at DATETIME(3) NOT NULL, last_seen_at DATETIME(3) NOT NULL,
 FOREIGN KEY (source_id) REFERENCES blog_moment_sources(id),
 UNIQUE KEY blog_moments_external (source_id, external_id), INDEX blog_moments_public (status, published_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_moment_sync_runs (
 id VARCHAR(36) PRIMARY KEY, source_id VARCHAR(190) NOT NULL,
 started_at DATETIME(3) NOT NULL, finished_at DATETIME(3), outcome VARCHAR(16) NOT NULL,
 pages INT NOT NULL DEFAULT 0, received INT NOT NULL DEFAULT 0, changed INT NOT NULL DEFAULT 0,
 error VARCHAR(255), FOREIGN KEY (source_id) REFERENCES blog_moment_sources(id), INDEX (source_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
