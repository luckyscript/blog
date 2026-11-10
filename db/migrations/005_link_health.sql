CREATE TABLE IF NOT EXISTS blog_link_health (
 link_id VARCHAR(36) PRIMARY KEY, url_hash VARCHAR(64) NOT NULL,
 state VARCHAR(16) NOT NULL, http_status INT, latency_ms INT,
 reason VARCHAR(24) NOT NULL DEFAULT '', checked_at DATETIME(3) NOT NULL,
 FOREIGN KEY (link_id) REFERENCES blog_links(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
