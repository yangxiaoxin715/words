create table if not exists learners (
  id text primary key,
  nickname text not null,
  access_code text not null unique,
  grade text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists admin_users (
  id text primary key,
  display_name text not null,
  access_code text not null unique,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists questionnaires (
  id text primary key,
  learner_id text not null,
  answers_json text not null,
  submitted_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade
);

delete from questionnaires
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by learner_id
        order by datetime(submitted_at) desc, datetime(created_at) desc, id desc
      ) as duplicate_rank
    from questionnaires
  )
  where duplicate_rank > 1
);

create unique index if not exists questionnaires_learner_id_unique
  on questionnaires(learner_id);

create table if not exists word_states (
  id text primary key,
  learner_id text not null,
  word_key text not null,
  status text not null default 'new',
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  last_seen_at text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (learner_id, word_key),
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists flashcard_sessions (
  id text primary key,
  learner_id text not null,
  started_at text not null,
  ended_at text not null,
  duration_seconds integer not null default 0,
  card_count integer not null default 0,
  captured_count integer not null default 0,
  hunting_count integer not null default 0,
  created_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists flashcard_events (
  id text primary key,
  session_id text not null,
  learner_id text not null,
  word_key text not null,
  result text not null,
  previous_count integer not null default 0,
  next_count integer not null default 0,
  answered_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  foreign key (session_id) references flashcard_sessions(id) on delete cascade,
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists story_episodes (
  id text primary key,
  learner_id text not null,
  episode_number integer not null,
  title text not null,
  story_text text not null,
  target_words_json text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists day_submissions (
  id text primary key,
  learner_id text not null,
  day_number integer not null check (day_number between 1 and 7),
  checklist_json text not null,
  submitted_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (learner_id, day_number),
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists lookup_records (
  id text primary key,
  learner_id text not null,
  story_episode_id text,
  day_number integer check (day_number between 1 and 7),
  type text not null check (type in ('word', 'sentence')),
  text text not null,
  context text,
  result_json text not null,
  looked_up_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade,
  foreign key (story_episode_id) references story_episodes(id) on delete set null
);

create table if not exists story_guesses (
  id text primary key,
  learner_id text not null,
  story_episode_id text,
  day_number integer not null check (day_number in (6, 7)),
  guess_text text not null,
  submitted_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade,
  foreign key (story_episode_id) references story_episodes(id) on delete set null
);

create table if not exists teacher_notes (
  id text primary key,
  learner_id text not null,
  note_text text not null,
  wechat_state text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade
);

create table if not exists generated_drafts (
  id text primary key,
  learner_id text not null,
  source_episode_id text,
  draft_json text not null,
  status text not null default 'draft',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (learner_id) references learners(id) on delete cascade,
  foreign key (source_episode_id) references story_episodes(id) on delete set null
);
