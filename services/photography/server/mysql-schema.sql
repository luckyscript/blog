CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(191) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS admin_users (id INT PRIMARY KEY CHECK(id=1), password_hash VARCHAR(128) NOT NULL, salt VARCHAR(48) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS sessions (token_hash VARCHAR(64) PRIMARY KEY, expires_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS settings (`key` VARCHAR(191) PRIMARY KEY, value LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS assets (
 id VARCHAR(64) PRIMARY KEY, sha256 VARCHAR(64) NOT NULL UNIQUE,
 master_path TEXT NOT NULL, filename VARCHAR(255) NOT NULL, format VARCHAR(16) NOT NULL,
 bytes BIGINT NOT NULL, width INT NOT NULL, height INT NOT NULL,
 metadata LONGTEXT NOT NULL DEFAULT ('{}'), created_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS renditions (
 id VARCHAR(96) PRIMARY KEY, asset_id VARCHAR(64) NOT NULL,
 width INT NOT NULL, height INT NOT NULL, format VARCHAR(16) NOT NULL, path TEXT NOT NULL,
 FOREIGN KEY(asset_id) REFERENCES assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS photos (
 id INT PRIMARY KEY AUTO_INCREMENT, asset_id VARCHAR(64), title VARCHAR(240) NOT NULL,
 description TEXT NOT NULL DEFAULT (''), category VARCHAR(32) NOT NULL DEFAULT 'daily',
 date VARCHAR(10), captured_raw TEXT, offset_time VARCHAR(32), equipment_id VARCHAR(80),
 exif LONGTEXT NOT NULL DEFAULT ('{}'), featured INT NOT NULL DEFAULT 0, featured_order INT NOT NULL DEFAULT 0,
 status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','trash')),
 position VARCHAR(16) NOT NULL DEFAULT 'center', is_demo INT NOT NULL DEFAULT 0, demo_data LONGTEXT,
 author VARCHAR(200) NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT (''),
 version INT NOT NULL DEFAULT 1, created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL,
 picked INT NOT NULL DEFAULT 0, rating INT NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
 private_note TEXT NOT NULL DEFAULT (''),
 FOREIGN KEY(asset_id) REFERENCES assets(id),
 INDEX idx_photos_status_date_id(status,date,id), INDEX idx_photos_status_rating(status,rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS collections (
 id INT PRIMARY KEY AUTO_INCREMENT, slug VARCHAR(80) NOT NULL UNIQUE, title VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT (''), story TEXT NOT NULL DEFAULT (''), label VARCHAR(120) NOT NULL DEFAULT '',
 english VARCHAR(120) NOT NULL DEFAULT '', quote VARCHAR(200) NOT NULL DEFAULT '', cover_photo_id INT,
 status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 sort_order INT NOT NULL DEFAULT 0, is_demo INT NOT NULL DEFAULT 0, version INT NOT NULL DEFAULT 1,
 layout LONGTEXT NOT NULL DEFAULT ('[]'), FOREIGN KEY(cover_photo_id) REFERENCES photos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS collection_photos (
 collection_id INT NOT NULL, photo_id INT NOT NULL, sort_order INT NOT NULL,
 PRIMARY KEY(collection_id,photo_id), FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
 FOREIGN KEY(photo_id) REFERENCES photos(id), INDEX idx_collection_photos_photo(photo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS import_jobs (
 id VARCHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, source_type VARCHAR(16) NOT NULL,
 source_root TEXT, source_path TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'queued',
 error TEXT, photo_id INT, created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL,
 source_bytes BIGINT, source_modified DOUBLE, target_photo_id INT, target_version INT,
 FOREIGN KEY(photo_id) REFERENCES photos(id), FOREIGN KEY(target_photo_id) REFERENCES photos(id),
 INDEX idx_import_jobs_status(status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS import_scans (
 id VARCHAR(36) PRIMARY KEY, root TEXT NOT NULL, folder TEXT NOT NULL, files LONGTEXT NOT NULL, created_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS photo_versions (
 id INT PRIMARY KEY AUTO_INCREMENT, photo_id INT NOT NULL, asset_id VARCHAR(64) NOT NULL, created_at VARCHAR(32) NOT NULL,
 UNIQUE(photo_id,asset_id), FOREIGN KEY(photo_id) REFERENCES photos(id), FOREIGN KEY(asset_id) REFERENCES assets(id),
 INDEX idx_photo_versions_photo(photo_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
