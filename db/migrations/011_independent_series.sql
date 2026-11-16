CREATE TABLE IF NOT EXISTS blog_series_notes (
 id VARCHAR(36) PRIMARY KEY, series_id VARCHAR(36) NOT NULL,
 slug VARCHAR(180) NOT NULL, title VARCHAR(255) NOT NULL, markdown LONGTEXT NOT NULL,
 description TEXT NOT NULL, context VARCHAR(200) NOT NULL DEFAULT '', status VARCHAR(16) NOT NULL DEFAULT 'draft',
 published_at DATETIME(3) NOT NULL, content_updated_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, version INT NOT NULL DEFAULT 1,
 FOREIGN KEY (series_id) REFERENCES blog_series(id) ON DELETE RESTRICT,
 UNIQUE KEY blog_series_note_slug(series_id,slug), INDEX blog_series_notes_public(series_id,status,published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_series_note_drafts (
 note_id VARCHAR(36) PRIMARY KEY, content JSON NOT NULL, updated_at DATETIME(3) NOT NULL,
 FOREIGN KEY (note_id) REFERENCES blog_series_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_series_note_revisions (
 id VARCHAR(36) PRIMARY KEY,note_id VARCHAR(36) NOT NULL,content JSON NOT NULL,
 action VARCHAR(24) NOT NULL,created_at DATETIME(3) NOT NULL,
 FOREIGN KEY (note_id) REFERENCES blog_series_notes(id) ON DELETE CASCADE,
 INDEX blog_series_note_history(note_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_series_paths (
 path VARCHAR(512) PRIMARY KEY,series_id VARCHAR(36) NOT NULL,note_id VARCHAR(36) NULL,
 FOREIGN KEY (series_id) REFERENCES blog_series(id) ON DELETE CASCADE,
 FOREIGN KEY (note_id) REFERENCES blog_series_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
