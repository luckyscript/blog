SET @series_comment_upgrade = (SELECT IF(COUNT(*)=0, 'ALTER TABLE blog_comments ADD COLUMN series_note_id VARCHAR(36) NULL, ADD CONSTRAINT blog_comments_series_note_fk FOREIGN KEY (series_note_id) REFERENCES blog_series_notes(id) ON DELETE CASCADE, ADD INDEX blog_comments_series_note (series_note_id,status,created_at)', 'SELECT 1') FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='blog_comments' AND column_name='series_note_id');
PREPARE series_comment_statement FROM @series_comment_upgrade;
EXECUTE series_comment_statement;
DEALLOCATE PREPARE series_comment_statement;
