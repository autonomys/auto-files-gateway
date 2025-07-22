CREATE SCHEMA moderation;
CREATE TABLE moderation.banned_files (
    cid TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_banned_files_cid ON moderation.banned_files (cid);