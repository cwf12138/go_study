CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0))
) STRICT;

CREATE TABLE memo_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(user_id,id),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.user_id')=user_id,0))
) STRICT;

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  folder_id TEXT,
  title TEXT NOT NULL,
  updated_seconds INTEGER NOT NULL,
  updated_nanos INTEGER NOT NULL CHECK(updated_nanos BETWEEN 0 AND 999999999),
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>=1),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,folder_id) REFERENCES memo_folders(user_id,id),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.user_id')=user_id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.folder_id'),'')=coalesce(folder_id,'')),
  CHECK(coalesce(json_extract(payload_json,'$.title'),'')=title)
) STRICT;
CREATE INDEX memos_owner_order ON memos(user_id,pinned DESC,updated_seconds DESC,updated_nanos DESC,id);
CREATE INDEX memos_owner_folder ON memos(user_id,folder_id,updated_seconds DESC,updated_nanos DESC,id);

CREATE TABLE todo_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(user_id,id),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.user_id')=user_id,0))
) STRICT;
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  list_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,list_id) REFERENCES todo_lists(user_id,id),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.user_id')=user_id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.list_id')=list_id,0))
) STRICT;
CREATE INDEX todos_owner_list ON todos(user_id,list_id,id);

CREATE TABLE text_clips (
  user_id TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(user_id,id),
  CHECK(coalesce(json_extract(payload_json,'$.id')=id,0)),
  CHECK(coalesce(json_extract(payload_json,'$.user_id')=user_id,0))
) STRICT;

CREATE TABLE source_snapshot (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  backup_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  imported_at TEXT NOT NULL,
  original_bytes BLOB NOT NULL
) STRICT;

CREATE TABLE memo_todo_links (
  user_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  todo_id TEXT NOT NULL,
  PRIMARY KEY(user_id,memo_id,todo_id),
  FOREIGN KEY(user_id,memo_id) REFERENCES memos(user_id,id),
  FOREIGN KEY(user_id,todo_id) REFERENCES todos(user_id,id)
) STRICT;
CREATE TABLE commands (
  user_id TEXT NOT NULL REFERENCES users(id),
  command_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  todo_id TEXT NOT NULL,
  PRIMARY KEY(user_id,command_id),
  FOREIGN KEY(user_id,memo_id,todo_id) REFERENCES memo_todo_links(user_id,memo_id,todo_id)
) STRICT;
