CREATE TABLE IF NOT EXISTS blog_links (
 id VARCHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL, url TEXT NOT NULL,
 description VARCHAR(500) NOT NULL DEFAULT '', category VARCHAR(100) NOT NULL,
 status VARCHAR(16) NOT NULL, sort_order INT NOT NULL DEFAULT 0, visits INT NOT NULL DEFAULT 0,
 source_key VARCHAR(64) UNIQUE, version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 INDEX blog_links_public (status, sort_order, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
