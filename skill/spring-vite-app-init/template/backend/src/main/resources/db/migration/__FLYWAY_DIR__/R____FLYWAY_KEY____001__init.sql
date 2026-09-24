-- 基线：示例表。本脚本可重复执行。

CREATE SCHEMA IF NOT EXISTS __DB_NAME__;

CREATE TABLE IF NOT EXISTS __DB_NAME__.t_note (
  c_id VARCHAR(32) NOT NULL,
  c_title VARCHAR(100),
  j_extra JSON,
  c_created_user VARCHAR(100),
  dt_created_at TIMESTAMP,
  dt_updated_at TIMESTAMP,
  c_updated_user VARCHAR(100),
  CONSTRAINT pk_t_note PRIMARY KEY (c_id)
);

COMMENT ON TABLE __DB_NAME__.t_note IS '示例笔记';
COMMENT ON COLUMN __DB_NAME__.t_note.c_id IS '主键';
COMMENT ON COLUMN __DB_NAME__.t_note.c_title IS '标题';
COMMENT ON COLUMN __DB_NAME__.t_note.j_extra IS '扩展 JSON';
COMMENT ON COLUMN __DB_NAME__.t_note.c_created_user IS '创建人';
COMMENT ON COLUMN __DB_NAME__.t_note.dt_created_at IS '创建时间';
COMMENT ON COLUMN __DB_NAME__.t_note.dt_updated_at IS '更新时间';
COMMENT ON COLUMN __DB_NAME__.t_note.c_updated_user IS '更新人';

CREATE INDEX IF NOT EXISTS idx_t_note_title ON __DB_NAME__.t_note (c_title);
