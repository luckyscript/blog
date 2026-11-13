CREATE TABLE IF NOT EXISTS blog_analytics_views (
 id VARCHAR(36) PRIMARY KEY, visitor_key CHAR(64) NOT NULL, session_key CHAR(64) NOT NULL,
 path VARCHAR(512) NOT NULL, category VARCHAR(24) NOT NULL,
 referrer_host VARCHAR(255) NOT NULL DEFAULT '', referrer_path VARCHAR(512) NOT NULL DEFAULT '',
 utm_source VARCHAR(80) NOT NULL DEFAULT '', utm_medium VARCHAR(80) NOT NULL DEFAULT '', utm_campaign VARCHAR(80) NOT NULL DEFAULT '',
 device VARCHAR(16) NOT NULL, browser VARCHAR(32) NOT NULL, os VARCHAR(32) NOT NULL,
 country VARCHAR(2) NOT NULL DEFAULT '', region VARCHAR(80) NOT NULL DEFAULT '', city VARCHAR(80) NOT NULL DEFAULT '',
 language VARCHAR(20) NOT NULL DEFAULT '', viewport_width INT NOT NULL DEFAULT 0, viewport_height INT NOT NULL DEFAULT 0,
 started_at DATETIME(3) NOT NULL, last_seen_at DATETIME(3) NOT NULL,
 duration_ms INT NOT NULL DEFAULT 0, scroll_percent INT NOT NULL DEFAULT 0, interactions INT NOT NULL DEFAULT 0,
 lcp_ms INT NULL, inp_ms INT NULL, cls_milli INT NULL, fcp_ms INT NULL, ttfb_ms INT NULL,
 INDEX blog_analytics_started (started_at), INDEX blog_analytics_active (last_seen_at),
 INDEX blog_analytics_visitor (visitor_key, started_at), INDEX blog_analytics_session (session_key, started_at),
 INDEX blog_analytics_category (category, started_at), INDEX blog_analytics_path (path(190), started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_analytics_events (
 id VARCHAR(36) PRIMARY KEY, view_id VARCHAR(36) NOT NULL,
 type VARCHAR(32) NOT NULL, target VARCHAR(512) NOT NULL DEFAULT '', label VARCHAR(40) NOT NULL DEFAULT '',
 value INT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL,
 FOREIGN KEY (view_id) REFERENCES blog_analytics_views(id) ON DELETE CASCADE,
 INDEX blog_analytics_event_time (created_at), INDEX blog_analytics_event_type (type, created_at),
 INDEX blog_analytics_event_view (view_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
