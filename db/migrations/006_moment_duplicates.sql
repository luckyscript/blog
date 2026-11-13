CREATE TABLE IF NOT EXISTS blog_moment_duplicates (
 moment_id VARCHAR(36) PRIMARY KEY, duplicate_of VARCHAR(36) NOT NULL,
 reason VARCHAR(16) NOT NULL,
 FOREIGN KEY (moment_id) REFERENCES blog_moments(id) ON DELETE CASCADE,
 FOREIGN KEY (duplicate_of) REFERENCES blog_moments(id) ON DELETE CASCADE,
 INDEX blog_moment_duplicate_original (duplicate_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
