ALTER TABLE photos ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5);
ALTER TABLE photos ADD COLUMN private_note TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_photos_status_rating ON photos(status,rating);
