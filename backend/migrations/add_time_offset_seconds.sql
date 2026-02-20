-- Migration: Add time_offset_seconds column to videos table
-- Purpose: Support batch upload of multiple videos sharing the same CSV/Excel data.
--          Each video can have a time offset (in seconds) indicating where it starts
--          within the CSV timeline, enabling correct data matching for split videos.
-- Date: 2026-02-20

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS time_offset_seconds FLOAT DEFAULT 0;

-- Add comment for documentation
-- COMMENT ON COLUMN videos.time_offset_seconds IS 'Time offset in seconds: where this video starts within the CSV timeline. Used when a long stream is split into multiple videos sharing the same CSV.';
