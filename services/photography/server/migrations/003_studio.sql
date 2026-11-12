ALTER TABLE photos ADD COLUMN picked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collections ADD COLUMN layout TEXT NOT NULL DEFAULT '[]';
ALTER TABLE import_jobs ADD COLUMN target_photo_id INTEGER REFERENCES photos(id);
ALTER TABLE import_jobs ADD COLUMN target_version INTEGER;
CREATE TABLE photo_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 photo_id INTEGER NOT NULL REFERENCES photos(id),
 asset_id TEXT NOT NULL REFERENCES assets(id),
 created_at TEXT NOT NULL,
 UNIQUE(photo_id,asset_id)
);
CREATE INDEX idx_photo_versions_photo ON photo_versions(photo_id,id);
