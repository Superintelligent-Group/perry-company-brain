use rusqlite::{params, Connection};
use std::env;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_RECORDS: usize = 10_000;
const DEFAULT_DB_PATH: &str = "target/perry-rust-sqlite.sqlite";
const DEFAULT_JOURNAL: &str = "DELETE";
const DEFAULT_SYNC: &str = "NORMAL";

type BenchResult<T> = Result<T, Box<dyn std::error::Error>>;

#[derive(Debug)]
struct Config {
    records: usize,
    db_path: String,
    journal: String,
    sync: String,
}

#[derive(Debug)]
struct Step {
    name: &'static str,
    duration: Duration,
    ops: Option<usize>,
}

#[derive(Debug)]
struct SyntheticMeeting {
    id: String,
    source_id: String,
    title: String,
    project: &'static str,
    created_at: String,
    source_url: String,
    discord_url: String,
    summary: String,
    decision_one: String,
    decision_two: String,
    action_one: String,
    action_two: String,
}

fn main() -> BenchResult<()> {
    let config = Config::parse(env::args().skip(1))?;

    if config.db_path != ":memory:" {
        if let Some(parent) = Path::new(&config.db_path).parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
    }

    let mut steps = Vec::new();
    let total_start = Instant::now();
    let mut conn = Connection::open(&config.db_path)?;
    apply_pragmas(&conn, &config)?;

    timed(&mut steps, "schema setup", None, || create_schema(&conn))?;

    let run_id = run_id();
    let insert_counts = timed(
        &mut steps,
        "bulk insert transaction",
        Some(config.records),
        || insert_synthetic_run(&mut conn, &run_id, config.records),
    )?;

    steps.push(Step {
        name: "total measured runtime",
        duration: total_start.elapsed(),
        ops: Some(insert_counts.total_rows()),
    });

    print_report(&config, &run_id, &insert_counts, &steps);
    Ok(())
}

impl Config {
    fn parse<I>(mut args: I) -> BenchResult<Self>
    where
        I: Iterator<Item = String>,
    {
        let mut config = Self {
            records: DEFAULT_RECORDS,
            db_path: DEFAULT_DB_PATH.to_string(),
            journal: DEFAULT_JOURNAL.to_string(),
            sync: DEFAULT_SYNC.to_string(),
        };

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => {
                    print_help();
                    std::process::exit(0);
                }
                "--records" | "-n" => {
                    let value = next_value(&mut args, &arg)?;
                    config.records = value.parse::<usize>()?;
                }
                "--db" => {
                    config.db_path = next_value(&mut args, &arg)?;
                }
                "--journal" => {
                    config.journal = next_value(&mut args, &arg)?.to_ascii_uppercase();
                }
                "--sync" => {
                    config.sync = next_value(&mut args, &arg)?.to_ascii_uppercase();
                }
                _ => return Err(format!("unknown argument: {arg}").into()),
            }
        }

        if config.records == 0 {
            return Err("--records must be greater than zero".into());
        }

        Ok(config)
    }
}

fn next_value<I>(args: &mut I, flag: &str) -> BenchResult<String>
where
    I: Iterator<Item = String>,
{
    args.next()
        .ok_or_else(|| format!("missing value for {flag}").into())
}

fn print_help() {
    println!(
        "Perry Rust SQLite Benchmark\n\
         \n\
         Usage:\n\
           cargo run --release -- [options]\n\
         \n\
         Options:\n\
           -n, --records <count>   Synthetic meetings to insert [default: {DEFAULT_RECORDS}]\n\
               --db <path>         SQLite path or :memory: [default: {DEFAULT_DB_PATH}]\n\
               --journal <mode>    SQLite journal_mode pragma [default: {DEFAULT_JOURNAL}]\n\
               --sync <mode>       SQLite synchronous pragma [default: {DEFAULT_SYNC}]\n\
           -h, --help              Show this help"
    );
}

fn apply_pragmas(conn: &Connection, config: &Config) -> BenchResult<()> {
    conn.pragma_update(None, "journal_mode", config.journal.as_str())?;
    conn.pragma_update(None, "synchronous", config.sync.as_str())?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

fn create_schema(conn: &Connection) -> BenchResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          notion_page_id TEXT,
          notion_url TEXT,
          discord_message_url TEXT,
          status TEXT NOT NULL,
          error TEXT,
          UNIQUE(source, source_id)
        );

        CREATE TABLE IF NOT EXISTS decisions (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS action_items (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          owner TEXT,
          due_date TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          url TEXT,
          title TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL,
          title TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          announcement TEXT NOT NULL,
          knowledge_json TEXT NOT NULL,
          route_json TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fts_queue (
          entity_key TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          meeting_id TEXT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          url TEXT,
          created_at TEXT NOT NULL,
          queued_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
          type,
          entity_id UNINDEXED,
          meeting_id UNINDEXED,
          title,
          body,
          url UNINDEXED,
          created_at UNINDEXED
        );

        CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
        CREATE INDEX IF NOT EXISTS idx_meetings_source_id ON meetings(source, source_id);
        CREATE INDEX IF NOT EXISTS idx_decisions_meeting_id ON decisions(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
        CREATE INDEX IF NOT EXISTS idx_actions_meeting_id ON action_items(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_actions_created_at ON action_items(created_at);
        CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
        CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);
        CREATE INDEX IF NOT EXISTS idx_fts_queue_queued_at ON fts_queue(queued_at);
        ",
    )?;
    Ok(())
}

fn insert_synthetic_run(
    conn: &mut Connection,
    run_id: &str,
    records: usize,
) -> BenchResult<InsertCounts> {
    let tx = conn.transaction()?;
    let mut counts = InsertCounts::default();

    {
        let mut insert_meeting = tx.prepare(
            "INSERT INTO meetings (
              id, source, source_id, title, created_at, updated_at, notion_page_id,
              notion_url, discord_message_url, status, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;
        let mut insert_decision =
            tx.prepare("INSERT INTO decisions (id, meeting_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)")?;
        let mut insert_action = tx.prepare(
            "INSERT INTO action_items (id, meeting_id, text, owner, due_date, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )?;
        let mut insert_approval = tx.prepare(
            "INSERT INTO approvals (
              id, meeting_id, title, payload_json, announcement, knowledge_json,
              route_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;
        let mut insert_fts = tx.prepare(
            "INSERT INTO fts_queue (
              entity_key, type, entity_id, meeting_id, title, body, url, created_at, queued_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;

        for index in 0..records {
            let meeting = SyntheticMeeting::new(run_id, index);

            insert_meeting.execute(params![
                meeting.id,
                "granola",
                meeting.source_id,
                meeting.title,
                meeting.created_at,
                meeting.created_at,
                Option::<String>::None,
                meeting.source_url,
                meeting.discord_url,
                "processed",
                Option::<String>::None
            ])?;
            counts.meetings += 1;

            for (decision_index, decision_text) in [&meeting.decision_one, &meeting.decision_two]
                .iter()
                .enumerate()
            {
                let decision_id = format!("{}:decision:{}", meeting.id, decision_index + 1);
                insert_decision.execute(params![
                    decision_id,
                    meeting.id,
                    decision_text,
                    "proposed",
                    meeting.created_at
                ])?;
                insert_fts.execute(params![
                    format!("decision:{decision_id}"),
                    "decision",
                    decision_id,
                    meeting.id,
                    meeting.title,
                    decision_text,
                    meeting.source_url,
                    meeting.created_at,
                    meeting.created_at
                ])?;
                counts.decisions += 1;
                counts.fts_queue += 1;
            }

            let action_rows = [
                (&meeting.action_one, "Ada", "tomorrow"),
                (&meeting.action_two, "Grace", "next week"),
            ];
            for (action_index, (action_text, owner, due_date)) in action_rows.iter().enumerate() {
                let action_id = format!("{}:action:{}", meeting.id, action_index + 1);
                insert_action.execute(params![
                    action_id,
                    meeting.id,
                    action_text,
                    owner,
                    due_date,
                    "open",
                    meeting.created_at
                ])?;
                insert_fts.execute(params![
                    format!("action:{action_id}"),
                    "action",
                    action_id,
                    meeting.id,
                    meeting.title,
                    action_text,
                    meeting.source_url,
                    meeting.created_at,
                    meeting.created_at
                ])?;
                counts.actions += 1;
                counts.fts_queue += 1;
            }

            insert_fts.execute(params![
                format!("meeting:{}", meeting.id),
                "meeting",
                meeting.id,
                Option::<String>::None,
                meeting.title,
                meeting.summary,
                meeting.source_url,
                meeting.created_at,
                meeting.created_at
            ])?;
            counts.fts_queue += 1;

            insert_approval.execute(params![
                format!("approval:{}", meeting.id),
                meeting.id,
                meeting.title,
                meeting.payload_json(),
                meeting.summary,
                meeting.knowledge_json(),
                meeting.route_json(),
                "pending",
                meeting.created_at,
                meeting.created_at
            ])?;
            counts.approvals += 1;
        }
    }

    tx.commit()?;
    Ok(counts)
}

impl SyntheticMeeting {
    fn new(run_id: &str, index: usize) -> Self {
        let project = match index % 3 {
            0 => "Wallace",
            1 => "Platypi",
            _ => "Perry",
        };
        let source_id = format!("synthetic-{run_id}-{index}");
        let id = format!("granola:{source_id}");
        let title = format!("{project} product review {index}");
        let created_at = format!(
            "2026-05-23T15:{:02}:{:02}.000Z",
            (index / 60) % 60,
            index % 60
        );
        let source_url = format!("https://notes.granola.ai/{source_id}");
        let discord_url = format!("https://discord.com/channels/synthetic/{run_id}/{index}");
        let decision_one = format!("Use {project} route {index}.");
        let decision_two = format!("Keep source citations for project {project}.");
        let action_one = format!("Review {project} follow-up {index} by tomorrow");
        let action_two = format!("Update Notion docs for {project} {index}");
        let summary = format!(
            "Decisions:\n- {decision_one}\n- {decision_two}\n\nAction items:\n- Ada: {action_one}\n- Grace: {action_two}"
        );

        Self {
            id,
            source_id,
            title,
            project,
            created_at,
            source_url,
            discord_url,
            summary,
            decision_one,
            decision_two,
            action_one,
            action_two,
        }
    }

    fn payload_json(&self) -> String {
        format!(
            r#"{{"source":"granola","sourceId":"{}","title":"{}","creatorName":"Synthetic Runner","attendees":[{{"name":"Ada","email":"ada@doppel.example"}},{{"name":"Grace","email":"grace@doppel.example"}}],"startedAt":"{}","sourceUrl":"{}","summaryMarkdown":{}}}"#,
            self.source_id,
            self.title,
            self.created_at,
            self.source_url,
            json_string(&self.summary)
        )
    }

    fn knowledge_json(&self) -> String {
        format!(
            r#"{{"decisions":[{{"text":{}}},{{"text":{}}}],"actionItems":[{{"text":{},"owner":"Ada","dueDate":"tomorrow"}},{{"text":{},"owner":"Grace","dueDate":"next week"}}]}}"#,
            json_string(&self.decision_one),
            json_string(&self.decision_two),
            json_string(&self.action_one),
            json_string(&self.action_two)
        )
    }

    fn route_json(&self) -> String {
        format!(
            r#"{{"publishMode":"approval","reason":"synthetic","project":"{}"}}"#,
            self.project
        )
    }
}

#[derive(Debug, Default)]
struct InsertCounts {
    meetings: usize,
    decisions: usize,
    actions: usize,
    approvals: usize,
    fts_queue: usize,
}

impl InsertCounts {
    fn total_rows(&self) -> usize {
        self.meetings + self.decisions + self.actions + self.approvals + self.fts_queue
    }
}

fn timed<T, F>(
    steps: &mut Vec<Step>,
    name: &'static str,
    ops: Option<usize>,
    f: F,
) -> BenchResult<T>
where
    F: FnOnce() -> BenchResult<T>,
{
    let start = Instant::now();
    let result = f()?;
    steps.push(Step {
        name,
        duration: start.elapsed(),
        ops,
    });
    Ok(result)
}

fn run_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before UNIX_EPOCH")
        .as_millis()
        .to_string()
}

fn json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c.is_control() => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output.push('"');
    output
}

fn print_report(config: &Config, run_id: &str, counts: &InsertCounts, steps: &[Step]) {
    println!("Perry Rust SQLite synthetic benchmark");
    println!("DB: {}", config.db_path);
    println!("Records: {}", config.records);
    println!("Run ID: {run_id}");
    println!("Journal: {}", config.journal);
    println!("Synchronous: {}", config.sync);
    println!();
    println!("Rows written:");
    println!("  meetings:   {}", counts.meetings);
    println!("  decisions:  {}", counts.decisions);
    println!("  actions:    {}", counts.actions);
    println!("  approvals:  {}", counts.approvals);
    println!("  fts_queue:  {}", counts.fts_queue);
    println!("  total:      {}", counts.total_rows());
    println!();

    for step in steps {
        let ms = step.duration.as_secs_f64() * 1_000.0;
        match step.ops {
            Some(ops) => {
                let per_sec = ops as f64 / step.duration.as_secs_f64();
                println!(
                    "{:<26} {:>10.1} ms | {:>12.1} ops/sec",
                    step.name, ms, per_sec
                );
            }
            None => println!("{:<26} {:>10.1} ms", step.name, ms),
        }
    }
}
