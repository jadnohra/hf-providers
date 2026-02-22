use std::io::Write as _;
use std::str::FromStr;

use clap::{Parser, Subcommand};
use comfy_table::{presets, Cell, Color, ContentArrangement, Table};
use console::{Key, Style, Term};
use hf_providers_core::{
    api::{parse_model, HfClient},
    cloud,
    estimate::{self, Fit},
    hardware::{self, Runtime},
    model::Model,
    provider::{ProviderInfo, ProviderKind, Readiness, PROVIDERS},
    reference::REFERENCE_MODELS,
    snippet::{self, Lang},
};

// ── Palette ──────────────────────────────────────────────────────────

fn s_header() -> Style { Style::new().color256(252).bold() }  // bright gray, bold
fn s_dim() -> Style    { Style::new().color256(248) }         // light gray
fn s_tree() -> Style   { Style::new().color256(245) }         // mid gray
fn s_hint() -> Style   { Style::new().color256(243) }         // soft gray
fn s_hot() -> Style    { Style::new().color256(114) }         // green
fn s_warm() -> Style   { Style::new().color256(214) }         // amber
fn s_cold() -> Style   { Style::new().color256(248) }         // light gray
fn s_err() -> Style    { Style::new().color256(167) }         // red
fn s_price() -> Style  { Style::new().color256(109) }         // teal
fn s_bold() -> Style   { Style::new().bold() }
fn s_accent() -> Style { Style::new().color256(109) }         // teal accent
fn s_label() -> Style  { Style::new().color256(146) }         // muted lavender
fn s_heart() -> Style  { Style::new().color256(168) }         // rose
fn s_param() -> Style  { Style::new().color256(139) }         // mauve

fn sep(width: usize) -> String {
    s_tree().apply_to("\u{2500}".repeat(width)).to_string()
}

fn readiness_str(r: Readiness) -> String {
    match r {
        Readiness::Hot         => format!("{}", s_hot().apply_to("\u{25cf} hot")),
        Readiness::Warm        => format!("{}", s_warm().apply_to("\u{25d0} warm")),
        Readiness::Cold        => format!("{}", s_cold().apply_to("\u{25cb} cold")),
        Readiness::Unavailable => format!("{}", s_err().apply_to("\u{2717} unavail")),
    }
}

fn fmt_count(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

// ── CLI Args ─────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "hf-providers",
    about = "Find inference providers for Hugging Face models, compare them, get code snippets",
    version,
    after_help = "examples:\n  \
        hf-providers deepseek-r1\n  \
        hf-providers deepseek-r1@novita         (python snippet via novita)\n  \
        hf-providers deepseek-r1@novita:curl    (curl snippet via novita)\n  \
        hf-providers meta-llama/Llama-3.3-70B-Instruct\n  \
        hf-providers flux.1-dev\n  \
        hf-providers deepseek-r1 --cheapest\n  \
        hf-providers providers groq\n  \
        hf-providers snippet deepseek-r1\n  \
        hf-providers machine rtx4090            (what can this GPU run?)\n  \
        hf-providers need llama-3.3-70b         (API vs cloud vs local cost)\n  \
        hf-providers                             (trending models)"
)]
struct Cli {
    query: Option<String>,

    #[command(subcommand)]
    command: Option<Commands>,

    #[arg(long)]
    cheapest: bool,

    #[arg(long)]
    fastest: bool,

    #[arg(long)]
    tools: bool,

    #[arg(long)]
    hot: bool,

    #[arg(long, short)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Code snippet for a model.
    Snippet {
        model: String,
        #[arg(long, short, default_value = "python")]
        lang: String,
        #[arg(long, short)]
        provider: Option<String>,
        #[arg(long)]
        fastest: bool,
        #[arg(long)]
        cheapest: bool,
    },
    /// List providers or browse a provider's models.
    Providers {
        name: Option<String>,
        #[arg(long, short)]
        task: Option<String>,
    },
    /// Live status across providers.
    Status {
        model: String,
        #[arg(long, short)]
        watch: Option<u64>,
    },
    /// What can this GPU run?
    Machine {
        /// GPU key, e.g. rtx4090, 4090, m4-max-128, h100
        gpu: String,
        /// Optional model to evaluate, e.g. deepseek-r1 or meta-llama/Llama-3.3-70B-Instruct
        model: Option<String>,
    },
    /// Compare costs: API vs cloud GPU vs local GPU
    Need {
        /// Model to analyze, e.g. deepseek-r1 or meta-llama/Llama-3.3-70B-Instruct
        model: String,
    },
    /// Update GPU and cloud pricing data from GitHub
    Sync,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = HfClient::with_auto_token();

    match cli.command {
        Some(Commands::Snippet {
            model,
            lang,
            provider,
            fastest,
            cheapest,
        }) => {
            cmd_run(&client, &model, &lang, provider.as_deref(), fastest, cheapest).await?;
        }
        Some(Commands::Providers { name, task }) => {
            cmd_providers(&client, name.as_deref(), task.as_deref()).await?;
        }
        Some(Commands::Status { model, watch }) => {
            cmd_status(&client, &model, watch).await?;
        }
        Some(Commands::Machine { gpu, model }) => {
            cmd_machine(&client, &gpu, model.as_deref()).await?;
        }
        Some(Commands::Need { model }) => {
            cmd_need(&client, &model).await?;
        }
        Some(Commands::Sync) => {
            cmd_sync().await?;
        }
        None => {
            if let Some(ref raw) = cli.query {
                let (model, at_provider, at_lang) = parse_query(raw);
                if at_provider.is_some() || at_lang.is_some() {
                    let lang = at_lang
                        .as_deref()
                        .unwrap_or("python");
                    cmd_run(&client, &model, lang, at_provider.as_deref(), false, false)
                        .await?;
                } else {
                    cmd_search(&client, &model, &cli).await?;
                }
            } else {
                cmd_trending(&client).await?;
            }
        }
    }
    Ok(())
}

// ── Query parsing ────────────────────────────────────────────────────

/// Split `deepseek-r1@novita:curl` into `(model, Some("novita"), Some("curl"))`.
fn parse_query(raw: &str) -> (String, Option<String>, Option<String>) {
    if let Some(at_pos) = raw.rfind('@') {
        let model = raw[..at_pos].to_string();
        let rest = &raw[at_pos + 1..];
        let (provider, lang) = if let Some(colon) = rest.find(':') {
            let p = &rest[..colon];
            let l = &rest[colon + 1..];
            (
                if p.is_empty() { None } else { Some(p.to_string()) },
                if l.is_empty() { None } else { Some(l.to_string()) },
            )
        } else if rest.is_empty() {
            (None, None)
        } else {
            (Some(rest.to_string()), None)
        };
        (model, provider, lang)
    } else {
        (raw.to_string(), None, None)
    }
}

// ── Trending ─────────────────────────────────────────────────────────

async fn cmd_trending(client: &HfClient) -> anyhow::Result<()> {
    let term = Term::stderr();
    term.write_line(&format!("{}", s_dim().apply_to("loading...")))?;

    let results = client.trending_models(30).await?;
    term.clear_last_lines(1)?;

    let models: Vec<Model> = results
        .iter()
        .filter_map(parse_model)
        .filter(|m| !m.providers.is_empty())
        .take(10)
        .collect();

    if models.is_empty() {
        eprintln!("{}", s_err().apply_to("error: could not fetch trending models"));
        return Ok(());
    }

    println!();
    println!("{}", s_header().apply_to("trending models"));
    println!("{}", sep(64));

    for m in &models {
        let pcount = m.providers.len();
        let tag = m.pipeline_tag.as_deref().unwrap_or("");
        let param = Model::param_hint(&m.id).unwrap_or_default();
        let prov_str = s_hot().apply_to(format!("{pcount} providers")).to_string();

        println!(
            "  {:<45} {:<18} {:<14} {}",
            s_bold().apply_to(&m.id),
            s_label().apply_to(tag),
            prov_str,
            if param.is_empty() {
                String::new()
            } else {
                s_param().apply_to(&param).to_string()
            }
        );
    }

    println!("{}", sep(64));

    if term.is_term() {
        let (first, rest) = models.split_first().unwrap();
        interactive_picker(client, first, rest).await?;
    }

    Ok(())
}

// ── Search ───────────────────────────────────────────────────────────

async fn cmd_search(client: &HfClient, query: &str, opts: &Cli) -> anyhow::Result<()> {
    let term = Term::stderr();
    term.write_line(&format!("{}", s_dim().apply_to("searching...")))?;

    // Try exact match first.
    let model = match client.model_info(query).await {
        Ok(data) => parse_model(&data),
        Err(_) => None,
    };

    let model = if let Some(mut m) = model {
        // Detail endpoint returns providers without pricing/perf data.
        // If we have providers but none have pricing, enrich from search.
        let needs_enrichment = !m.providers.is_empty()
            && m.providers.iter().all(|p| p.input_price_per_m.is_none() && p.throughput_tps.is_none());
        if needs_enrichment {
            // Search by model name only (not org/name) since the search API
            // does free-text matching and "org/name" may match the wrong model.
            let search_term = m.id.split('/').next_back().unwrap_or(&m.id);
            if let Ok(results) = client.search_models(search_term, 5).await {
                if let Some(rich) = results.iter().find_map(|r| {
                    let parsed = parse_model(r)?;
                    (parsed.id == m.id).then_some(parsed)
                }) {
                    m.providers = rich.providers;
                }
            }
        }
        term.clear_last_lines(1)?;
        m
    } else {
        let results = client.search_models(query, 15).await?;
        term.clear_last_lines(1)?;

        if results.is_empty() {
            eprintln!(
                "{}",
                s_err().apply_to(format!("error: no models found for '{query}'"))
            );
            eprintln!();
            eprintln!(
                "{}",
                s_dim().apply_to("  Try the full model ID, e.g. deepseek-ai/DeepSeek-R1")
            );
            eprintln!(
                "{}",
                s_dim().apply_to(format!(
                    "  Or broaden search: hf-providers {}",
                    query.split('-').next().unwrap_or(query)
                ))
            );
            return Ok(());
        }

        let models: Vec<Model> = results.iter().filter_map(parse_model).collect();

        if models.is_empty() {
            eprintln!(
                "{}",
                s_err().apply_to("error: could not parse results")
            );
            return Ok(());
        }

        // Multiple results: show compact list unless there's one clear winner.
        let has_clear_winner = models.len() == 1
            || (!models[0].providers.is_empty()
                && models[0].likes > models.get(1).map(|m| m.likes).unwrap_or(0) * 5);

        if !has_clear_winner && models.len() > 1 {
            print_search_results(query, &models);
            return Ok(());
        }

        models
            .into_iter()
            .find(|m| !m.providers.is_empty())
            .unwrap_or_else(|| {
                results
                    .iter()
                    .find_map(parse_model)
                    .expect("already checked non-empty")
            })
    };

    if opts.json {
        println!("{}", serde_json::to_string_pretty(&model)?);
        return Ok(());
    }

    // Search for variants.
    let core = extract_core_name(&model.id);
    let variant_results = client.search_models(&core, 15).await.unwrap_or_default();
    let variants: Vec<Model> = variant_results
        .iter()
        .filter_map(parse_model)
        .filter(|m| m.id != model.id)
        .collect();

    print_model_full(&model, &variants, opts);

    // Interactive picker (TTY only, not --json, not piped).
    let term = Term::stderr();
    if term.is_term() && !opts.json {
        interactive_picker(client, &model, &variants).await?;
    }

    Ok(())
}

// ── Snippet ──────────────────────────────────────────────────────────

async fn cmd_run(
    client: &HfClient,
    query: &str,
    lang: &str,
    provider: Option<&str>,
    fastest: bool,
    cheapest: bool,
) -> anyhow::Result<()> {
    let data = match client.model_info(query).await {
        Ok(d) => d,
        Err(_) => {
            let results = client.search_models(query, 1).await?;
            results
                .into_iter()
                .next()
                .ok_or_else(|| anyhow::anyhow!("model not found: {query}"))?
        }
    };

    let model =
        parse_model(&data).ok_or_else(|| anyhow::anyhow!("could not parse model data"))?;

    let chosen = if let Some(name) = provider {
        model.providers.iter().find(|p| p.name == name)
    } else if fastest {
        model.fastest()
    } else if cheapest {
        model.cheapest()
    } else {
        model.cheapest().or(model.providers.first())
    };

    let prov = chosen.ok_or_else(|| anyhow::anyhow!("no providers available"))?;

    let l = Lang::from_str(lang).unwrap_or(Lang::Python);

    let label = if provider.is_some() {
        "selected"
    } else if fastest {
        "fastest"
    } else {
        "cheapest"
    };

    println!(
        "{}",
        s_dim().apply_to(format!("# {} via {} ({label})", model.id, prov.name))
    );
    println!();
    println!("{}", snippet::generate(&model, prov, l));
    Ok(())
}

// ── Providers ────────────────────────────────────────────────────────

async fn cmd_providers(
    client: &HfClient,
    name: Option<&str>,
    task: Option<&str>,
) -> anyhow::Result<()> {
    match name {
        Some(prov) => {
            let results = client.models_by_provider(prov, task, 20).await?;
            let models: Vec<Model> = results.iter().filter_map(parse_model).collect();

            let p = PROVIDERS.iter().find(|p| p.id == prov);
            let display = p.map(|p| p.display_name).unwrap_or(prov);
            let kind = p
                .map(|p| match p.kind {
                    ProviderKind::InferenceProvider => "serverless GPU",
                    ProviderKind::HfInference => "HF CPU",
                })
                .unwrap_or("");

            println!();
            println!(
                "{}  {}",
                s_bold().apply_to(format!("{prov} \u{2014} {display}")),
                s_dim().apply_to(kind)
            );
            println!("{}", sep(64));

            for m in &models {
                let tag = m.pipeline_tag.as_deref().unwrap_or("");
                println!(
                    "  {:<45} {:<18} {}",
                    s_bold().apply_to(&m.id),
                    s_dim().apply_to(tag),
                    s_dim().apply_to(format!("\u{2665} {}", fmt_count(m.likes)))
                );
            }

            println!("{}", sep(64));
            println!(
                "{}",
                s_hint().apply_to(format!(
                    "  {} models   hf-providers <model> for details",
                    models.len()
                ))
            );
            println!();
        }
        None => {
            println!();
            println!("{}", s_header().apply_to("inference providers"));
            println!("{}", sep(64));

            for p in PROVIDERS {
                let kind_str = match p.kind {
                    ProviderKind::InferenceProvider => s_dim().apply_to("serverless GPU"),
                    ProviderKind::HfInference => s_warm().apply_to("HF CPU"),
                };
                println!(
                    "  {:<18} {:<16} {}",
                    s_bold().apply_to(p.id),
                    s_dim().apply_to(p.display_name),
                    kind_str
                );
            }

            println!("{}", sep(64));
            println!(
                "{}",
                s_hint().apply_to(format!(
                    "  {} providers   hf-providers providers <name> for models",
                    PROVIDERS.len()
                ))
            );
            println!();
        }
    }
    Ok(())
}

// ── Status ───────────────────────────────────────────────────────────

async fn cmd_status(
    client: &HfClient,
    query: &str,
    watch: Option<u64>,
) -> anyhow::Result<()> {
    let pulse = ['\u{2731}', '\u{2726}', '\u{00b7}', '\u{2726}'];
    let mut frame: usize = 0;

    loop {
        let data = client.model_info(query).await?;
        let model =
            parse_model(&data).ok_or_else(|| anyhow::anyhow!("could not parse model"))?;

        let term = Term::stderr();
        if watch.is_some() {
            term.clear_screen()?;
        }

        let refresh = if watch.is_some() {
            format!(
                "  {}",
                s_warm().apply_to(format!("{} refreshing...", pulse[frame % pulse.len()]))
            )
        } else {
            String::new()
        };

        let now = chrono::Local::now().format("%H:%M:%S");
        println!();
        println!(
            "{}  {}{}",
            s_bold().apply_to(&model.id),
            s_dim().apply_to(now),
            refresh
        );
        println!("{}", sep(64));

        for p in &model.providers {
            let r = p.readiness();
            let ttft = p
                .latency_s
                .map(|l| format!("~{:.0}ms TTFT", l * 1000.0))
                .unwrap_or_else(|| {
                    if r == Readiness::Cold {
                        "unavailable".to_string()
                    } else {
                        "\u{2500}".to_string()
                    }
                });

            println!(
                "  {:<16} {:<12} {}",
                s_accent().apply_to(&p.name),
                readiness_str(r),
                s_dim().apply_to(ttft)
            );
        }

        println!("{}", sep(64));

        match watch {
            Some(secs) => {
                println!(
                    "{}",
                    s_hint().apply_to(format!("  \u{21bb} {secs}s"))
                );
                frame += 1;
                tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
            }
            None => {
                println!();
                break;
            }
        }
    }
    Ok(())
}

// ── Machine ──────────────────────────────────────────────────────────

async fn cmd_machine(client: &HfClient, input: &str, model_query: Option<&str>) -> anyhow::Result<()> {
    let gpus = hardware::load_hardware_cached()?;
    let (key, gpu) = hardware::find_gpu(&gpus, input)
        .ok_or_else(|| anyhow::anyhow!("no GPU matching '{input}' in hardware database"))?;

    // GPU header.
    let vendor_prefix = match gpu.vendor.as_str() {
        "nvidia" => "NVIDIA ",
        "amd" => "AMD ",
        "intel" => "Intel ",
        _ => "",
    };
    println!();
    println!(
        "  {}",
        s_header().apply_to(format!("{vendor_prefix}{}", gpu.name))
    );

    let dot = s_tree().apply_to("\u{00b7}");
    let specs = [
        format!("{:.0} GB", gpu.vram_gb),
        format!("{:.0} GB/s", gpu.mem_bw_gb_s),
        format!("{:.1} FP16 TFLOPS", gpu.fp16_tflops),
        format!("{}W TDP", gpu.tdp_w),
    ];
    println!(
        "  {}",
        s_dim().apply_to(
            specs
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(&format!("  {}  ", dot))
        )
    );

    // Cost line: street price + electricity estimate.
    let mut cost_parts: Vec<String> = Vec::new();
    if let Some(usd) = gpu.street_usd {
        cost_parts.push(format!("street: ~${usd}"));
    }
    let elec_mo = gpu.tdp_w as f64 * 0.80 * 730.0 / 1000.0 * 0.12;
    cost_parts.push(format!("elec: ~${:.0}/mo", elec_mo));
    println!(
        "  {}",
        s_price().apply_to(
            cost_parts.join(&format!("  {}  ", dot))
        )
    );

    // Build list of (short_name, params) to evaluate.
    struct ModelEntry {
        short: String,
        params: u64,
    }

    let entries: Vec<ModelEntry> = if let Some(query) = model_query {
        let term = Term::stderr();
        term.write_line(&format!("{}", s_dim().apply_to("resolving model...")))?;

        let model = match client.model_info(query).await {
            Ok(data) => parse_model(&data),
            Err(_) => {
                let results = client.search_models(query, 5).await?;
                results.iter().find_map(parse_model)
            }
        };
        term.clear_last_lines(1)?;

        let model = model.ok_or_else(|| anyhow::anyhow!("model not found: {query}"))?;
        let params = model.estimated_params()
            .or_else(|| {
                REFERENCE_MODELS.iter()
                    .find(|rm| rm.id == model.id)
                    .map(|rm| rm.params)
            })
            .ok_or_else(|| anyhow::anyhow!("cannot determine param count for {}\n  \
                try: hf-providers machine {} org/Model-70B-Instruct", model.id, input))?;
        let short = model.id.rsplit('/').next().unwrap_or(&model.id);
        vec![ModelEntry { short: short.to_string(), params }]
    } else {
        REFERENCE_MODELS.iter()
            .map(|rm| ModelEntry { short: rm.short.to_string(), params: rm.params })
            .collect()
    };

    let runtimes = gpu.available_runtimes();
    let multi_rt = runtimes.len() > 1;

    let fmt_toks = |v: Option<f64>| -> String {
        let dash = "\u{2500}";
        match v {
            Some(t) if t >= 1000.0 => format!("{:.1}k t/s", t / 1000.0),
            Some(t) if t >= 1.0 => format!("{:.0} t/s", t),
            Some(t) if t > 0.0 => "<1 t/s".to_string(),
            Some(_) => dash.to_string(),
            None => dash.to_string(),
        }
    };

    let decode_color = |v: Option<f64>| -> Color {
        match v {
            Some(t) if t >= 30.0 => Color::AnsiValue(114),
            Some(t) if t >= 10.0 => Color::AnsiValue(214),
            Some(_) => Color::AnsiValue(208),
            None => Color::AnsiValue(245),
        }
    };

    // Single model mode: show per-runtime rows in one table.
    if model_query.is_some() {
        println!();
        println!(
            "  {}  {}",
            s_bold().apply_to(&entries[0].short),
            s_param().apply_to(Model::fmt_params(entries[0].params)),
        );

        let mut table = Table::new();
        table.load_preset(presets::NOTHING);
        table.set_content_arrangement(ContentArrangement::Dynamic);
        let mut header = vec![
            Cell::new("  Quant").fg(Color::AnsiValue(243)),
            Cell::new("Weight").fg(Color::AnsiValue(243)),
            Cell::new("Fit").fg(Color::AnsiValue(243)),
            Cell::new("Decode").fg(Color::AnsiValue(243)),
            Cell::new("Prefill").fg(Color::AnsiValue(243)),
        ];
        if multi_rt {
            header.insert(0, Cell::new("  Runtime").fg(Color::AnsiValue(243)));
        }
        table.set_header(header);

        let mut has_rows = false;
        for &rt in &runtimes {
            if let Some((q, est)) = estimate::best_quant(&gpu, entries[0].params, rt) {
                let fit_str = match &est.fit {
                    Fit::Full => "fits in VRAM".to_string(),
                    Fit::NoFit => "does not fit".to_string(),
                };
                let fit_c = match &est.fit {
                    Fit::Full => Color::AnsiValue(114),
                    Fit::NoFit => Color::AnsiValue(167),
                };
                let mut row = vec![
                    Cell::new(format!("  {}", q.label())).fg(Color::AnsiValue(248)),
                    Cell::new(format!("{:.0} GB", est.weight_gb)).fg(Color::AnsiValue(248)),
                    Cell::new(&fit_str).fg(fit_c),
                    Cell::new(fmt_toks(est.decode_tok_s)).fg(decode_color(est.decode_tok_s)),
                    Cell::new(fmt_toks(est.prefill_tok_s)).fg(Color::AnsiValue(248)),
                ];
                if multi_rt {
                    row.insert(0, Cell::new(format!("  {rt}")).fg(Color::AnsiValue(109)));
                }
                table.add_row(row);
                has_rows = true;
            }
        }

        if has_rows {
            println!("{table}");
        } else {
            println!("  {}", s_err().apply_to("does not fit, even at Q4"));
        }
    } else {
        // Reference model list: show categories per runtime.
        for &rt in &runtimes {
            let rt_suffix = if multi_rt { format!(" ({})", rt) } else { String::new() };

            struct EvalRow {
                short: String,
                quant: String,
                decode: Option<f64>,
                prefill: Option<f64>,
            }

            let mut comfortable: Vec<EvalRow> = Vec::new();
            let mut tight: Vec<EvalRow> = Vec::new();
            let mut wont_run: Vec<String> = Vec::new();

            for entry in &entries {
                match estimate::best_quant(&gpu, entry.params, rt) {
                    Some((q, est)) => {
                        let is_full = est.fit == Fit::Full;
                        let fast_decode = est.decode_tok_s.map(|d| d >= 30.0).unwrap_or(false);
                        let row = EvalRow {
                            short: entry.short.clone(),
                            quant: q.label().to_string(),
                            decode: est.decode_tok_s,
                            prefill: est.prefill_tok_s,
                        };
                        if is_full && fast_decode {
                            comfortable.push(row);
                        } else {
                            tight.push(row);
                        }
                    }
                    None => {
                        wont_run.push(entry.short.clone());
                    }
                }
            }

            if !comfortable.is_empty() {
                println!();
                println!("{}", s_hot().apply_to(format!("  comfortable{rt_suffix}")));

                let mut table = Table::new();
                table.load_preset(presets::NOTHING);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec![
                    Cell::new("  Model").fg(Color::AnsiValue(243)),
                    Cell::new("Quant").fg(Color::AnsiValue(243)),
                    Cell::new("Decode").fg(Color::AnsiValue(243)),
                    Cell::new("Prefill").fg(Color::AnsiValue(243)),
                ]);

                for r in &comfortable {
                    table.add_row(vec![
                        Cell::new(format!("  {}", r.short)).fg(Color::AnsiValue(252)),
                        Cell::new(&r.quant).fg(Color::AnsiValue(248)),
                        Cell::new(fmt_toks(r.decode)).fg(decode_color(r.decode)),
                        Cell::new(fmt_toks(r.prefill)).fg(Color::AnsiValue(248)),
                    ]);
                }
                println!("{table}");
            }

            if !tight.is_empty() {
                println!();
                println!("{}", s_warm().apply_to(format!("  tight{rt_suffix}")));

                let mut table = Table::new();
                table.load_preset(presets::NOTHING);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec![
                    Cell::new("  Model").fg(Color::AnsiValue(243)),
                    Cell::new("Quant").fg(Color::AnsiValue(243)),
                    Cell::new("Decode").fg(Color::AnsiValue(243)),
                    Cell::new("Prefill").fg(Color::AnsiValue(243)),
                ]);

                for r in &tight {
                    table.add_row(vec![
                        Cell::new(format!("  {}", r.short)).fg(Color::AnsiValue(252)),
                        Cell::new(&r.quant).fg(Color::AnsiValue(248)),
                        Cell::new(fmt_toks(r.decode)).fg(decode_color(r.decode)),
                        Cell::new(fmt_toks(r.prefill)).fg(Color::AnsiValue(248)),
                    ]);
                }
                println!("{table}");
            }

            if !wont_run.is_empty() {
                println!();
                println!("{}", s_err().apply_to(format!("  won't run{rt_suffix}")));
                for name in &wont_run {
                    println!("  {}", s_dim().apply_to(format!("  {name}")));
                }
            }
        }
    }

    let rt_label = runtimes.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(" / ");
    println!();
    println!(
        "{}",
        s_hint().apply_to(format!("  gpu key: {key}   estimates: {rt_label}"))
    );
    println!();

    Ok(())
}

// ── Need ─────────────────────────────────────────────────────────────

/// Effective cost per 1M output tokens given $/hr and decode tok/s.
fn cost_per_m(price_hr: f64, tok_s: f64) -> f64 {
    price_hr / tok_s / 3600.0 * 1_000_000.0
}

fn fmt_cost(v: f64) -> String {
    if v >= 100.0 {
        format!("${:.0}", v)
    } else if v >= 1.0 {
        format!("${:.2}", v)
    } else {
        format!("${:.3}", v)
    }
}

async fn cmd_need(client: &HfClient, query: &str) -> anyhow::Result<()> {
    // 1. Resolve model.
    let term = Term::stderr();
    term.write_line(&format!("{}", s_dim().apply_to("resolving model...")))?;

    let model = match client.model_info(query).await {
        Ok(data) => parse_model(&data),
        Err(_) => {
            let results = client.search_models(query, 5).await?;
            results.iter().find_map(parse_model)
        }
    };
    term.clear_last_lines(1)?;

    let model = model.ok_or_else(|| anyhow::anyhow!("model not found: {query}"))?;
    let params = model
        .estimated_params()
        .or_else(|| {
            REFERENCE_MODELS
                .iter()
                .find(|rm| rm.id == model.id)
                .map(|rm| rm.params)
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "cannot determine param count for {}\n  \
                 try a model with known size, e.g. hf-providers need llama-3.3-70b",
                model.id
            )
        })?;

    let short = model.id.rsplit('/').next().unwrap_or(&model.id);
    let weight_q4 = params as f64 * 0.5 / 1e9;

    // Header.
    println!();
    println!(
        "  {}  {}  {}",
        s_header().apply_to(short),
        s_param().apply_to(Model::fmt_params(params)),
        s_dim().apply_to(format!("Q4 = {:.0} GB", weight_q4)),
    );

    // ── API providers ────────────────────────────────────────────────
    let api_providers: Vec<&ProviderInfo> = model
        .providers
        .iter()
        .filter(|p| p.output_price_per_m.is_some())
        .collect();

    let cheapest_api_out = api_providers
        .iter()
        .filter_map(|p| p.output_price_per_m)
        .fold(f64::INFINITY, f64::min);

    if !api_providers.is_empty() {
        println!();
        println!("  {}", s_header().apply_to("api providers"));
        println!("  {}", sep(48));

        let mut table = Table::new();
        table.load_preset(presets::NOTHING);
        table.set_content_arrangement(ContentArrangement::Dynamic);
        table.set_header(vec![
            Cell::new("  Provider").fg(Color::AnsiValue(243)),
            Cell::new("Status").fg(Color::AnsiValue(243)),
            Cell::new("$/1M in").fg(Color::AnsiValue(243)),
            Cell::new("$/1M out").fg(Color::AnsiValue(243)),
        ]);

        let mut sorted: Vec<&&ProviderInfo> = api_providers.iter().collect();
        sorted.sort_by(|a, b| {
            a.output_price_per_m
                .unwrap()
                .partial_cmp(&b.output_price_per_m.unwrap())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        for p in &sorted {
            let in_price = p
                .input_price_per_m
                .map(fmt_cost)
                .unwrap_or_else(|| "\u{2500}".to_string());
            let out_price = fmt_cost(p.output_price_per_m.unwrap());
            let rd = p.readiness();
            table.add_row(vec![
                Cell::new(format!("  {}", p.name)).fg(Color::AnsiValue(252)),
                Cell::new(readiness_str(rd)),
                Cell::new(&in_price).fg(Color::AnsiValue(109)),
                Cell::new(&out_price).fg(Color::AnsiValue(109)),
            ]);
        }
        println!("{table}");
    } else {
        println!();
        println!(
            "  {}",
            s_dim().apply_to("no api providers with pricing found")
        );
    }

    // ── Cloud GPU ────────────────────────────────────────────────────
    let gpus = hardware::load_hardware_cached()?;
    let offerings = cloud::load_cloud_cached()?;

    struct CloudRow {
        name: String,
        provider: String,
        gpu_count: u32,
        total_hr: f64,
        quant: String,
        tok_s: f64,
        eff_cost: f64,
    }

    let mut cloud_rows: Vec<CloudRow> = Vec::new();

    for (_key, offering) in &offerings {
        let gpu = match gpus.iter().find(|(k, _)| *k == offering.gpu) {
            Some((_, g)) => g,
            None => continue,
        };

        let result = if offering.gpu_count > 1 {
            estimate::best_quant_multi_gpu(gpu, params, Runtime::LlamaCpp, offering.gpu_count)
        } else {
            estimate::best_quant(gpu, params, Runtime::LlamaCpp)
        };

        if let Some((q, est)) = result {
            let tok_s = est.decode_tok_s.unwrap_or(0.0);
            if tok_s <= 0.0 {
                continue;
            }
            let total_hr = offering.price_hr * offering.gpu_count as f64;
            let eff = cost_per_m(total_hr, tok_s);
            cloud_rows.push(CloudRow {
                name: offering.name.clone(),
                provider: offering.provider.clone(),
                gpu_count: offering.gpu_count,
                total_hr,
                quant: q.label().to_string(),
                tok_s,
                eff_cost: eff,
            });
        }
    }

    cloud_rows.sort_by(|a, b| a.eff_cost.partial_cmp(&b.eff_cost).unwrap());

    if !cloud_rows.is_empty() {
        println!();
        println!(
            "  {}",
            s_header().apply_to("cloud gpu rental")
        );
        println!(
            "  {}",
            s_dim().apply_to("floor cost at 100% utilization")
        );
        println!("  {}", sep(60));

        let mut table = Table::new();
        table.load_preset(presets::NOTHING);
        table.set_content_arrangement(ContentArrangement::Dynamic);
        table.set_header(vec![
            Cell::new("  Offering").fg(Color::AnsiValue(243)),
            Cell::new("$/hr").fg(Color::AnsiValue(243)),
            Cell::new("Quant").fg(Color::AnsiValue(243)),
            Cell::new("tok/s").fg(Color::AnsiValue(243)),
            Cell::new("$/1M out").fg(Color::AnsiValue(243)),
        ]);

        for r in cloud_rows.iter().take(10) {
            let gpu_label = if r.gpu_count > 1 {
                format!("{}x {}", r.gpu_count, r.name)
            } else {
                r.name.clone()
            };
            let label = format!("{} ({})", gpu_label, r.provider);
            table.add_row(vec![
                Cell::new(format!("  {label}")).fg(Color::AnsiValue(252)),
                Cell::new(format!("${:.2}", r.total_hr)).fg(Color::AnsiValue(109)),
                Cell::new(&r.quant).fg(Color::AnsiValue(248)),
                Cell::new(format!("{:.0}", r.tok_s)).fg(Color::AnsiValue(248)),
                Cell::new(fmt_cost(r.eff_cost)).fg(Color::AnsiValue(109)),
            ]);
        }
        println!("{table}");
    }

    // ── Local GPU ────────────────────────────────────────────────────
    struct LocalRow {
        name: String,
        street: Option<u32>,
        quant: String,
        tok_s: f64,
        eff_cost: f64,
        payback_m_tok: Option<f64>,
    }

    let elec_kwh = 0.12_f64;
    let load_pct = 0.80_f64;

    let mut local_rows: Vec<LocalRow> = Vec::new();

    for (_key, gpu) in &gpus {
        for &rt in &gpu.available_runtimes() {
            if let Some((q, est)) = estimate::best_quant(gpu, params, rt) {
                let tok_s = est.decode_tok_s.unwrap_or(0.0);
                if tok_s <= 0.0 {
                    continue;
                }
                let elec_hr = gpu.tdp_w as f64 * load_pct * elec_kwh / 1000.0;
                let eff = cost_per_m(elec_hr, tok_s);

                let payback = gpu.street_usd.and_then(|usd| {
                    if cheapest_api_out.is_finite() && eff < cheapest_api_out {
                        let saving_per_m = cheapest_api_out - eff;
                        Some(usd as f64 / saving_per_m)
                    } else {
                        None
                    }
                });

                // Deduplicate: keep best runtime per GPU name.
                if let Some(existing) = local_rows.iter_mut().find(|r| r.name == gpu.name) {
                    if tok_s > existing.tok_s {
                        existing.quant = q.label().to_string();
                        existing.tok_s = tok_s;
                        existing.eff_cost = eff;
                        existing.payback_m_tok = payback;
                    }
                    continue;
                }

                local_rows.push(LocalRow {
                    name: gpu.name.clone(),
                    street: gpu.street_usd,
                    quant: q.label().to_string(),
                    tok_s,
                    eff_cost: eff,
                    payback_m_tok: payback,
                });
            }
        }
    }

    local_rows.sort_by(|a, b| a.eff_cost.partial_cmp(&b.eff_cost).unwrap());

    // Show only GPUs with street price + Apple Silicon, top 8.
    let local_display: Vec<&LocalRow> = local_rows
        .iter()
        .filter(|r| r.street.is_some())
        .take(8)
        .collect();

    if !local_display.is_empty() {
        println!();
        println!(
            "  {}",
            s_header().apply_to("local gpu")
        );
        println!(
            "  {}",
            s_dim().apply_to("marginal electricity only, $0.12/kWh, 80% TDP")
        );
        println!("  {}", sep(64));

        let mut table = Table::new();
        table.load_preset(presets::NOTHING);
        table.set_content_arrangement(ContentArrangement::Dynamic);
        table.set_header(vec![
            Cell::new("  GPU").fg(Color::AnsiValue(243)),
            Cell::new("Street").fg(Color::AnsiValue(243)),
            Cell::new("Quant").fg(Color::AnsiValue(243)),
            Cell::new("tok/s").fg(Color::AnsiValue(243)),
            Cell::new("$/1M out").fg(Color::AnsiValue(243)),
            Cell::new("payback").fg(Color::AnsiValue(243)),
        ]);

        for r in &local_display {
            let street_str = r
                .street
                .map(|v| format!("${v}"))
                .unwrap_or_else(|| "\u{2500}".to_string());
            let payback_str = r
                .payback_m_tok
                .map(|v| {
                    if v >= 1000.0 {
                        format!("{:.1}B tok", v / 1000.0)
                    } else {
                        format!("{:.0}M tok", v)
                    }
                })
                .unwrap_or_else(|| "\u{2500}".to_string());
            table.add_row(vec![
                Cell::new(format!("  {}", r.name)).fg(Color::AnsiValue(252)),
                Cell::new(&street_str).fg(Color::AnsiValue(109)),
                Cell::new(&r.quant).fg(Color::AnsiValue(248)),
                Cell::new(format!("{:.0}", r.tok_s)).fg(Color::AnsiValue(248)),
                Cell::new(fmt_cost(r.eff_cost)).fg(Color::AnsiValue(109)),
                Cell::new(&payback_str).fg(Color::AnsiValue(248)),
            ]);
        }
        println!("{table}");
    }

    // Footer.
    println!();
    if cheapest_api_out.is_finite() {
        println!(
            "{}",
            s_hint().apply_to(format!(
                "  payback = street price / (cheapest API ${:.2}/1M - local $/1M)",
                cheapest_api_out
            ))
        );
    }
    println!();

    Ok(())
}

// ── Display ──────────────────────────────────────────────────────────

fn print_model_full(model: &Model, _variants: &[Model], opts: &Cli) {
    let tag = model.pipeline_tag.as_deref().unwrap_or("unknown");
    let param = Model::param_hint(&model.id).unwrap_or_default();
    let inf = model.inference_status.as_deref().unwrap_or("unknown");

    println!();
    println!(
        "{}  {}  {}",
        s_bold().apply_to(&model.id),
        s_label().apply_to(tag),
        if param.is_empty() {
            String::new()
        } else {
            s_param().apply_to(&param).to_string()
        }
    );
    // Summary badges: library, license, key capabilities
    let mut badges = Vec::new();
    if let Some(ref lib) = model.library_name {
        badges.push(s_label().apply_to(lib.as_str()).to_string());
    }
    if let Some(ref lic) = model.license {
        badges.push(s_hot().apply_to(lic.as_str()).to_string());
    }
    let caps: Vec<&str> = model
        .tags
        .iter()
        .filter_map(|t| match t.as_str() {
            "conversational" => Some("chat"),
            "text-generation" => None, // redundant with pipeline_tag
            t if t.starts_with("arxiv:") => Some("paper"),
            "endpoints_compatible" => Some("endpoints"),
            "fp8" => Some("fp8"),
            _ => None,
        })
        .collect();
    for cap in &caps {
        badges.push(s_dim().apply_to(*cap).to_string());
    }
    if !badges.is_empty() {
        println!("  {}", badges.join(&format!("  {}  ", s_tree().apply_to("\u{00b7}"))));
    }

    println!(
        "{} {}  {} {}  inference: {}",
        s_heart().apply_to("\u{2665}"),
        s_dim().apply_to(fmt_count(model.likes)),
        s_dim().apply_to("\u{2193}"),
        s_dim().apply_to(fmt_count(model.downloads)),
        s_dim().apply_to(inf)
    );

    if let Some(params) = model.safetensors_params {
        let dot = s_tree().apply_to("\u{00b7}");
        let q4 = Model::weight_gb(params, 0.5);
        let q8 = Model::weight_gb(params, 1.0);
        let fp16 = Model::weight_gb(params, 2.0);
        let fmt_gb = |gb: f64| -> String {
            if gb >= 1000.0 {
                format!("{:.1} TB", gb / 1000.0)
            } else {
                format!("{:.0} GB", gb)
            }
        };
        println!(
            "{}  {}  Q4: {}  {}  Q8: {}  {}  FP16: {}",
            s_param().apply_to(Model::fmt_params(params)),
            dot,
            s_dim().apply_to(format!("~{}", fmt_gb(q4))),
            dot,
            s_dim().apply_to(format!("~{}", fmt_gb(q8))),
            dot,
            s_dim().apply_to(format!("~{}", fmt_gb(fp16))),
        );
    }

    // ── Serverless providers ──

    let mut providers: Vec<&ProviderInfo> = model.providers.iter().collect();

    if opts.tools {
        providers.retain(|p| p.supports_tools == Some(true));
    }
    if opts.hot {
        providers.retain(|p| p.readiness() == Readiness::Hot);
    }
    if opts.cheapest {
        providers.sort_by(|a, b| {
            a.output_price_per_m
                .unwrap_or(f64::MAX)
                .partial_cmp(&b.output_price_per_m.unwrap_or(f64::MAX))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else if opts.fastest {
        providers.sort_by(|a, b| {
            b.throughput_tps
                .unwrap_or(0.0)
                .partial_cmp(&a.throughput_tps.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else {
        providers.sort_by(|a, b| a.readiness().cmp(&b.readiness()).then(a.name.cmp(&b.name)));
    }

    println!();
    if providers.is_empty() {
        println!("{}", s_header().apply_to("serverless providers"));
        println!("{}", sep(64));
        println!("  {}", s_dim().apply_to("none available"));
        println!("{}", sep(64));
    } else {
        println!("{}", s_header().apply_to("serverless providers"));

        let mut table = Table::new();
        table
            .load_preset(presets::NOTHING)
            .set_content_arrangement(ContentArrangement::Dynamic)
            .set_header(vec![
                Cell::new("Provider").fg(Color::AnsiValue(248)),
                Cell::new("Status").fg(Color::AnsiValue(248)),
                Cell::new("In $/1M").fg(Color::AnsiValue(248)),
                Cell::new("Out $/1M").fg(Color::AnsiValue(248)),
                Cell::new("Tput").fg(Color::AnsiValue(248)),
                Cell::new("Tools").fg(Color::AnsiValue(248)),
                Cell::new("JSON").fg(Color::AnsiValue(248)),
            ]);

        for p in &providers {
            let status_color = match p.readiness() {
                Readiness::Hot => Color::AnsiValue(114),
                Readiness::Warm => Color::AnsiValue(214),
                Readiness::Cold => Color::AnsiValue(208),
                Readiness::Unavailable => Color::AnsiValue(245),
            };
            let dash = "\u{2500}";
            let check = "\u{2713}";

            table.add_row(vec![
                Cell::new(&p.name).fg(Color::AnsiValue(109)),
                Cell::new(format!("{}", p.readiness())).fg(status_color),
                Cell::new(p.input_price_per_m.map(|v| format!("${:.2}", v)).unwrap_or_else(|| dash.into())).fg(Color::AnsiValue(109)),
                Cell::new(p.output_price_per_m.map(|v| format!("${:.2}", v)).unwrap_or_else(|| dash.into())).fg(Color::AnsiValue(109)),
                Cell::new(p.throughput_tps.map(|v| format!("{:.0} t/s", v)).unwrap_or_else(|| dash.into()))
                    .fg(if p.throughput_tps.unwrap_or(0.0) >= 100.0 { Color::AnsiValue(214) } else { Color::AnsiValue(248) }),
                Cell::new(if p.supports_tools == Some(true) { check } else { dash })
                    .fg(if p.supports_tools == Some(true) { Color::AnsiValue(114) } else { Color::AnsiValue(245) }),
                Cell::new(if p.supports_structured == Some(true) { check } else { dash })
                    .fg(if p.supports_structured == Some(true) { Color::AnsiValue(114) } else { Color::AnsiValue(245) }),
            ]);
        }

        println!("{table}");
        println!();

        let dash = "\u{2500}";
        let nw = [model.cheapest(), model.fastest()]
            .iter()
            .filter_map(|o| o.as_ref())
            .map(|p| p.name.len())
            .max()
            .unwrap_or(8);

        let fmt_summary = |label: &str, p: &ProviderInfo| {
            let price = match (p.input_price_per_m, p.output_price_per_m) {
                (Some(i), Some(o)) => format!("${:.2}/${:.2}", i, o),
                _ => dash.to_string(),
            };
            let tput = p.throughput_tps
                .map(|t| format!("{:.0} t/s", t))
                .unwrap_or_else(|| dash.to_string());
            println!("  {} {}  {}  {}",
                s_dim().apply_to(format!("{:<10}", label)),
                s_accent().apply_to(format!("{:<nw$}", p.name)),
                s_price().apply_to(format!("{:<14}", price)),
                s_dim().apply_to(tput),
            );
        };
        if let Some(c) = model.cheapest() {
            fmt_summary("cheapest:", c);
        }
        if let Some(f) = model.fastest() {
            fmt_summary("fastest:", f);
        }
    }

    // ── Local estimates ──

    if let Some(params) = model.estimated_params() {
        if let Ok(gpus) = hardware::load_hardware_cached() {
            struct EstRow {
                gpu_name: String,
                rt_label: String,
                quant: estimate::Quant,
                weight_gb: f64,
                fit: Fit,
                decode_tok_s: Option<f64>,
                prefill_tok_s: Option<f64>,
            }

            let mut rows: Vec<EstRow> = Vec::new();
            for (key, gpu) in &gpus {
                if !hardware::DEFAULT_DISPLAY_GPUS.contains(&key.as_str()) {
                    continue;
                }
                // Pick the best runtime (highest decode tok/s).
                let mut best: Option<(Runtime, estimate::Quant, estimate::Estimate)> = None;
                for rt in gpu.available_runtimes() {
                    if let Some((q, est)) = estimate::best_quant(gpu, params, rt) {
                        let dominated = best.as_ref().map(|(_, _, b)| {
                            est.decode_tok_s.unwrap_or(0.0) <= b.decode_tok_s.unwrap_or(0.0)
                        }).unwrap_or(false);
                        if !dominated {
                            best = Some((rt, q, est));
                        }
                    }
                }
                if let Some((rt, q, est)) = best {
                    let rt_label = if gpu.available_runtimes().len() > 1 {
                        rt.to_string()
                    } else {
                        String::new()
                    };
                    rows.push(EstRow {
                        gpu_name: est.gpu_name,
                        rt_label,
                        quant: q,
                        weight_gb: est.weight_gb,
                        fit: est.fit,
                        decode_tok_s: est.decode_tok_s,
                        prefill_tok_s: est.prefill_tok_s,
                    });
                }
            }
            if !rows.is_empty() {
                let has_rt = rows.iter().any(|r| !r.rt_label.is_empty());

                println!();
                println!("{}", s_header().apply_to("local estimates"));
                let mut table = Table::new();
                table.load_preset(presets::NOTHING);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                let mut header = vec![
                    Cell::new(" GPU").fg(Color::AnsiValue(243)),
                ];
                if has_rt {
                    header.push(Cell::new("Rt").fg(Color::AnsiValue(243)));
                }
                header.extend([
                    Cell::new("Quant").fg(Color::AnsiValue(243)),
                    Cell::new("Weight").fg(Color::AnsiValue(243)),
                    Cell::new("Fit").fg(Color::AnsiValue(243)),
                    Cell::new("Decode").fg(Color::AnsiValue(243)),
                    Cell::new("Prefill").fg(Color::AnsiValue(243)),
                ]);
                table.set_header(header);

                for est in &rows {
                    let fit_str = match &est.fit {
                        Fit::Full => "fits".to_string(),
                        Fit::NoFit => "no fit".to_string(),
                    };
                    let fit_color = match &est.fit {
                        Fit::Full => Color::AnsiValue(114),
                            Fit::NoFit => Color::AnsiValue(245),
                    };
                    let dash = "\u{2500}";
                    let fmt_toks = |v: Option<f64>| -> String {
                        match v {
                            Some(t) if t >= 1000.0 => format!("{:.1}k t/s", t / 1000.0),
                            Some(t) => format!("{:.0} t/s", t),
                            None => dash.to_string(),
                        }
                    };
                    let decode_color = match est.decode_tok_s {
                        Some(t) if t >= 30.0 => Color::AnsiValue(114),
                        Some(t) if t >= 10.0 => Color::AnsiValue(214),
                        Some(_) => Color::AnsiValue(208),
                        None => Color::AnsiValue(245),
                    };

                    let mut row = vec![
                        Cell::new(&est.gpu_name).fg(Color::AnsiValue(109)),
                    ];
                    if has_rt {
                        row.push(Cell::new(&est.rt_label).fg(Color::AnsiValue(146)));
                    }
                    row.extend([
                        Cell::new(est.quant.label()).fg(Color::AnsiValue(248)),
                        Cell::new(format!("{:.0} GB", est.weight_gb)).fg(Color::AnsiValue(248)),
                        Cell::new(&fit_str).fg(fit_color),
                        Cell::new(fmt_toks(est.decode_tok_s)).fg(decode_color),
                        Cell::new(fmt_toks(est.prefill_tok_s)).fg(Color::AnsiValue(248)),
                    ]);
                    table.add_row(row);
                }

                println!("{table}");
            }
        }
    }

    println!();
}

fn print_search_results(query: &str, models: &[Model]) {
    println!();
    println!(
        "{}",
        s_header().apply_to(format!("search: {query}"))
    );
    println!("{}", sep(64));

    for m in models.iter().take(15) {
        let pcount = m.providers.len();
        let tag = m.pipeline_tag.as_deref().unwrap_or("");
        let param = Model::param_hint(&m.id).unwrap_or_default();
        let prov_str = if pcount > 0 {
            s_hot().apply_to(format!("{pcount} providers")).to_string()
        } else {
            s_dim().apply_to("0 providers").to_string()
        };

        println!(
            "  {:<45} {:<18} {:<14} {}",
            s_bold().apply_to(&m.id),
            s_label().apply_to(tag),
            prov_str,
            if param.is_empty() {
                String::new()
            } else {
                s_param().apply_to(&param).to_string()
            }
        );
    }

    println!("{}", sep(64));
    println!(
        "{}",
        s_hint().apply_to(format!(
            "  {} results   hf-providers <model-id> for details",
            models.len()
        ))
    );
    println!();
}

// ── Interactive tree browser ─────────────────────────────────────────

#[derive(Clone, PartialEq)]
enum NK {
    Model(String),                       // model ID
    Prov(String, String),                // (model_id, provider_name)
    Lang(String, String, Lang),          // (model_id, provider_name, lang)
    Decor,
}

struct TreeNode {
    label: String,
    detail: String,
    readiness: Option<Readiness>,
    kind: NK,
    code: bool,
    disabled: bool,
}

impl TreeNode {
    fn selectable(&self) -> bool {
        !self.code && !self.disabled && self.kind != NK::Decor
    }
}

struct ProvExp {
    name: String,
    lang: Option<Lang>,
}

enum Exp {
    None,
    Open {
        model_id: String,
        prov: Option<ProvExp>,
    },
}

fn prov_detail(p: &ProviderInfo) -> String {
    let status = match p.readiness() {
        Readiness::Hot => "\u{25cf} hot",
        Readiness::Warm => "\u{25d0} warm",
        Readiness::Cold => "\u{25cb} cold",
        Readiness::Unavailable => "\u{2717} unavail",
    };
    let price = match (p.input_price_per_m, p.output_price_per_m) {
        (Some(i), Some(o)) => format!("${:.2}/${:.2}", i, o),
        _ => String::new(),
    };
    let tput = p
        .throughput_tps
        .map(|t| format!("{:.0} t/s", t))
        .unwrap_or_default();
    format!("{:<10} {:<14} {}", status, price, tput)
}

fn lang_name(l: Lang) -> &'static str {
    match l {
        Lang::Python => "python",
        Lang::Curl => "curl",
        Lang::Javascript => "javascript",
    }
}

const LANGS: [Lang; 3] = [Lang::Python, Lang::Curl, Lang::Javascript];

fn add_langs(
    nodes: &mut Vec<TreeNode>,
    mdl: &Model,
    prov: &ProviderInfo,
    exp_lang: &Option<Lang>,
    pad: &str,
    model_id: &str,
) {
    for (j, &lang) in LANGS.iter().enumerate() {
        let last = j == 2;
        let conn = if last { "\u{2514}\u{2500}" } else { "\u{251c}\u{2500}" };
        nodes.push(TreeNode {
            label: format!("{pad}{conn} {}", lang_name(lang)),
            detail: String::new(),
            readiness: None,
            kind: NK::Lang(model_id.to_string(), prov.name.clone(), lang),
            code: false,
            disabled: false,
        });
        if *exp_lang == Some(lang) {
            let code = snippet::generate(mdl, prov, lang);
            let cont = if last { "   " } else { "\u{2502}  " };
            for line in code.lines() {
                nodes.push(TreeNode {
                    label: format!("{pad}{cont}\u{258e} {line}"),
                    detail: String::new(),
                    readiness: None,
                    kind: NK::Decor,
                    code: true,
                    disabled: false,
                });
            }
        }
    }
}

fn sorted_provs(providers: &[ProviderInfo]) -> Vec<&ProviderInfo> {
    let mut v: Vec<&ProviderInfo> = providers.iter().collect();
    v.sort_by(|a, b| a.readiness().cmp(&b.readiness()).then(a.name.cmp(&b.name)));
    v
}

fn model_summary(m: &Model) -> String {
    let pc = m.providers.len();
    let pl = if pc == 1 { "1 provider".to_string() } else { format!("{pc} providers") };
    let mut parts = vec![pl];
    let mut prices: Vec<f64> = m.providers.iter().filter_map(|p| p.output_price_per_m).collect();
    prices.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if let (Some(&lo), Some(&hi)) = (prices.first(), prices.last()) {
        if (lo - hi).abs() < 0.005 {
            parts.push(format!("${:.2}", lo));
        } else {
            parts.push(format!("${:.2}\u{2013}${:.2}", lo, hi));
        }
    }
    let mut tputs: Vec<f64> = m.providers.iter().filter_map(|p| p.throughput_tps).collect();
    tputs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if let (Some(&lo), Some(&hi)) = (tputs.first(), tputs.last()) {
        if (lo - hi).abs() < 0.5 {
            parts.push(format!("{:.0} t/s", lo));
        } else {
            parts.push(format!("{:.0}\u{2013}{:.0} t/s", lo, hi));
        }
    }
    parts.join("  ")
}

fn build_tree(model: &Model, variants: &[Model], var_cache: &[(String, Model)], exp: &Exp) -> Vec<TreeNode> {
    let mut nodes = Vec::new();

    // Collect all models (main + variants) for consistent layout.
    let all_models: Vec<&Model> = std::iter::once(model).chain(variants.iter()).collect();

    // Compute column width from all visible names.
    let mut max_w: usize = 0;
    for m in &all_models {
        let short = m.id.rsplit('/').next().unwrap_or(&m.id);
        max_w = max_w.max(short.len());
        if let Exp::Open { model_id, .. } = exp {
            if model_id == &m.id {
                // Check cached data for provider names.
                let data = if m.id == model.id { Some(model) } else {
                    var_cache.iter().find(|(k, _)| k == &m.id).map(|(_, v)| v)
                        .or_else(|| variants.iter().find(|v| v.id == m.id))
                };
                if let Some(d) = data {
                    for p in &d.providers {
                        max_w = max_w.max(p.name.len() + 2);
                    }
                }
            }
        }
    }
    let col = max_w + 2;

    nodes.push(TreeNode {
        label: "[\u{2191}\u{2193}] move  [\u{2192}] open  [\u{2190}] close  [\u{23ce}] copy  [q/esc] quit"
            .to_string(),
        detail: String::new(),
        readiness: None,
        kind: NK::Decor,
        code: false,
        disabled: false,
    });

    for m in &all_models {
        let short = m.id.rsplit('/').next().unwrap_or(&m.id);
        let pc = m.providers.len();
        nodes.push(TreeNode {
            label: format!("{short:<col$}"),
            detail: model_summary(m),
            readiness: None,
            kind: NK::Model(m.id.clone()),
            code: false,
            disabled: pc == 0,
        });

        // If this model is expanded, show its providers.
        if let Exp::Open { model_id, prov: ref prov_exp } = exp {
            if model_id == &m.id {
                // Prefer cached data (richer), fall back to what we have.
                let data: &Model = if m.id == model.id { model } else {
                    var_cache.iter().find(|(k, _)| k == &m.id).map(|(_, v)| v)
                        .or_else(|| variants.iter().find(|v| v.id == m.id))
                        .unwrap_or(m)
                };
                let provs = sorted_provs(&data.providers);
                if provs.is_empty() {
                    nodes.push(TreeNode {
                        label: "  (no providers)".to_string(),
                        detail: String::new(),
                        readiness: None,
                        kind: NK::Decor,
                        code: false,
                        disabled: false,
                    });
                }
                for p in &provs {
                    nodes.push(TreeNode {
                        label: format!("  {:<w$}", p.name, w = col - 2),
                        detail: prov_detail(p),
                        readiness: Some(p.readiness()),
                        kind: NK::Prov(m.id.clone(), p.name.clone()),
                        code: false,
                        disabled: false,
                    });
                    if let Some(pe) = prov_exp {
                        if pe.name == p.name {
                            add_langs(&mut nodes, data, p, &pe.lang, "    ", &m.id);
                        }
                    }
                }
            }
        }
    }

    nodes
}

fn node_style(kind: &NK) -> Style {
    match kind {
        NK::Model(_) => Style::new().color256(14),          // bright cyan
        NK::Prov(_, _) => Style::new().color256(10),        // bright green
        NK::Lang(_, _, _) => Style::new().color256(15),     // bright white
        NK::Decor => Style::new().color256(248),            // light gray
    }
}

fn readiness_style(r: Readiness) -> Style {
    match r {
        Readiness::Hot => Style::new().color256(114),        // green
        Readiness::Warm => Style::new().color256(214),       // yellow
        Readiness::Cold => Style::new().color256(208),       // orange
        Readiness::Unavailable => Style::new().color256(245), // dark gray
    }
}

fn render_tree(nodes: &[TreeNode], cursor: usize, sel: &[usize]) -> Vec<String> {
    let active = sel.get(cursor).copied().unwrap_or(usize::MAX);
    let dim = Style::new().color256(242);
    nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let pfx = if i == active { "> " } else { "  " };
            if n.disabled {
                let text = format!("{pfx}{}{}", n.label, n.detail);
                format!("{}", dim.apply_to(&text))
            } else if n.code {
                format!("{}", Style::new().color256(246).apply_to(format!("{pfx}{}", n.label)))
            } else if n.detail.is_empty() {
                let text = format!("{pfx}{}", n.label);
                let sty = if i == active { node_style(&n.kind).bold() } else { node_style(&n.kind) };
                format!("{}", sty.apply_to(&text))
            } else {
                // Name part styled by node kind, detail part styled by readiness.
                let name_sty = if i == active { node_style(&n.kind).bold() } else { node_style(&n.kind) };
                let det_sty = match n.readiness {
                    Some(r) => if i == active { readiness_style(r).bold() } else { readiness_style(r) },
                    None => if i == active { node_style(&n.kind).bold() } else { node_style(&n.kind) },
                };
                format!("{}{}{}", name_sty.apply_to(pfx), name_sty.apply_to(&n.label), det_sty.apply_to(&n.detail))
            }
        })
        .collect()
}

fn sel_indices(nodes: &[TreeNode]) -> Vec<usize> {
    nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.selectable())
        .map(|(i, _)| i)
        .collect()
}

fn find_sel(nodes: &[TreeNode], sel: &[usize], target: &NK) -> Option<usize> {
    sel.iter().position(|&ni| &nodes[ni].kind == target)
}

async fn interactive_picker(
    client: &HfClient,
    model: &Model,
    variants: &[Model],
) -> anyhow::Result<()> {
    let term = Term::stderr();
    // Auto-expand main model.
    let mut exp = Exp::Open { model_id: model.id.clone(), prov: None };
    let mut cursor: usize = 0;
    let mut drawn: usize = 0;
    let mut var_cache: Vec<(String, Model)> = Vec::new();
    let mut status: Option<String> = None;

    loop {
        let nodes = build_tree(model, variants, &var_cache, &exp);
        let sel = sel_indices(&nodes);
        if sel.is_empty() {
            break;
        }
        cursor = cursor.min(sel.len() - 1);

        let lines = render_tree(&nodes, cursor, &sel);
        if drawn > 0 {
            term.clear_last_lines(drawn)?;
        }
        for line in &lines {
            term.write_line(line)?;
        }
        if let Some(ref msg) = status {
            term.write_line("")?;
            term.write_line(msg)?;
            drawn = lines.len() + 2;
            status = None;
        } else {
            drawn = lines.len();
        }

        let key = {
            let t = Term::stderr();
            tokio::task::spawn_blocking(move || t.read_key()).await?
        }?;

        match key {
            Key::ArrowUp | Key::Char('k') => cursor = cursor.saturating_sub(1),
            Key::ArrowDown | Key::Char('j') => {
                if cursor + 1 < sel.len() {
                    cursor += 1;
                }
            }

            // ── Expand / drill right ─────────────────────────────
            Key::ArrowRight | Key::Char('l') => {
                let kind = nodes[sel[cursor]].kind.clone();
                match kind {
                    NK::Model(ref id) => {
                        let already = matches!(&exp, Exp::Open { model_id, .. } if model_id == id);
                        if already {
                            // Already open — move into first child provider.
                            let nn = build_tree(model, variants, &var_cache, &exp);
                            let ns = sel_indices(&nn);
                            let pos = ns.iter().position(|&ni| {
                                matches!(&nn[ni].kind, NK::Prov(mid, _) if mid == id)
                            });
                            if let Some(p) = pos {
                                cursor = p;
                            }
                        } else {
                            // Need to fetch data for non-main models.
                            if *id != model.id && !var_cache.iter().any(|(k, _)| k == id) {
                                // Check if variants already have data.
                                let has_data = variants.iter().any(|v| v.id == *id && !v.providers.is_empty());
                                if !has_data {
                                    term.clear_last_lines(drawn)?;
                                    drawn = 0;
                                    term.write_line(&format!("{}", s_dim().apply_to("loading...")))?;
                                    let short = id.rsplit('/').next().unwrap_or(id);
                                    let results = match client.search_models(short, 5).await {
                                        Ok(r) => r,
                                        Err(e) => {
                                            term.clear_last_lines(1)?;
                                            eprintln!("{}", s_err().apply_to(format!("error: {e}")));
                                            continue;
                                        }
                                    };
                                    term.clear_last_lines(1)?;
                                    if let Some(m) = results.iter().filter_map(parse_model).find(|m| m.id == *id) {
                                        var_cache.push((id.clone(), m));
                                    }
                                }
                            }
                            exp = Exp::Open { model_id: id.clone(), prov: None };
                            let nn = build_tree(model, variants, &var_cache, &exp);
                            let ns = sel_indices(&nn);
                            if let Some(p) = find_sel(&nn, &ns, &kind) {
                                cursor = p;
                            }
                        }
                    }
                    NK::Prov(ref mid, ref pname) => {
                        if let Exp::Open { ref model_id, prov: ref mut pe } = exp {
                            if *model_id == *mid {
                                let already = pe.as_ref().map(|p| &p.name == pname).unwrap_or(false);
                                if already {
                                    // Move into first lang child.
                                    let t = NK::Lang(mid.clone(), pname.clone(), Lang::Python);
                                    let nn = build_tree(model, variants, &var_cache, &exp);
                                    let ns = sel_indices(&nn);
                                    if let Some(p) = find_sel(&nn, &ns, &t) {
                                        cursor = p;
                                    }
                                } else {
                                    *pe = Some(ProvExp { name: pname.clone(), lang: None });
                                    let nn = build_tree(model, variants, &var_cache, &exp);
                                    let ns = sel_indices(&nn);
                                    if let Some(p) = find_sel(&nn, &ns, &kind) {
                                        cursor = p;
                                    }
                                }
                            }
                        }
                    }
                    NK::Lang(ref mid, ref pname, lang) => {
                        if let Exp::Open { ref model_id, prov: Some(ref mut pe) } = exp {
                            if *model_id == *mid && &pe.name == pname && pe.lang != Some(lang) {
                                pe.lang = Some(lang);
                            }
                        }
                        let nn = build_tree(model, variants, &var_cache, &exp);
                        let ns = sel_indices(&nn);
                        if let Some(p) = find_sel(&nn, &ns, &kind) {
                            cursor = p;
                        }
                    }
                    NK::Decor => {}
                }
            }

            // ── Collapse / go to parent left ─────────────────────
            Key::ArrowLeft | Key::Char('h') => {
                let kind = nodes[sel[cursor]].kind.clone();
                let mut need_rebuild = false;

                match kind {
                    NK::Model(ref id) => {
                        if matches!(&exp, Exp::Open { model_id, .. } if model_id == id) {
                            exp = Exp::None;
                            need_rebuild = true;
                        }
                    }
                    NK::Prov(ref mid, ref pname) => {
                        if let Exp::Open { ref model_id, ref mut prov } = exp {
                            if model_id == mid {
                                let this_exp = prov.as_ref().map(|p| &p.name == pname).unwrap_or(false);
                                if this_exp {
                                    *prov = None;
                                    need_rebuild = true;
                                } else {
                                    // Go to parent model.
                                    let t = NK::Model(mid.clone());
                                    if let Some(p) = find_sel(&nodes, &sel, &t) {
                                        cursor = p;
                                    }
                                }
                            }
                        }
                    }
                    NK::Lang(ref mid, ref pname, this_lang) => {
                        if let Exp::Open { ref model_id, prov: Some(ref mut pe) } = exp {
                            if model_id == mid && &pe.name == pname {
                                if pe.lang == Some(this_lang) {
                                    pe.lang = None;
                                    need_rebuild = true;
                                } else {
                                    let t = NK::Prov(mid.clone(), pname.clone());
                                    if let Some(p) = find_sel(&nodes, &sel, &t) {
                                        cursor = p;
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }

                if need_rebuild {
                    let nn = build_tree(model, variants, &var_cache, &exp);
                    let ns = sel_indices(&nn);
                    if let Some(p) = find_sel(&nn, &ns, &kind) {
                        cursor = p;
                    } else {
                        cursor = cursor.min(ns.len().saturating_sub(1));
                    }
                }
            }

            Key::Char('c') | Key::Enter => {
                // Collect visible code lines and copy to clipboard.
                let code: String = nodes
                    .iter()
                    .filter(|n| n.code)
                    .map(|n| n.label.trim().to_string())
                    .collect::<Vec<_>>()
                    .join("\n");
                if !code.is_empty() {
                    if let Ok(mut child) = std::process::Command::new("pbcopy")
                        .stdin(std::process::Stdio::piped())
                        .spawn()
                    {
                        if let Some(ref mut stdin) = child.stdin {
                            let _ = stdin.write_all(code.as_bytes());
                        }
                        let _ = child.wait();
                        let what = match &exp {
                            Exp::Open { model_id, prov: Some(pe) } if pe.lang.is_some() =>
                                format!("{}:{} ({})", model_id, pe.name, lang_name(pe.lang.unwrap())),
                            _ => "code".to_string(),
                        };
                        status = Some(format!(
                            "  {}",
                            Style::new().color256(114).apply_to(
                                format!("\u{2500}\u{2500} \u{2713} copied {} \u{2500}\u{2500}", what)
                            )
                        ));
                    }
                }
            }

            Key::Escape | Key::Char('q') | Key::Char('\u{3}') => {
                term.clear_last_lines(drawn)?;
                break;
            }
            _ => {}
        }

        // Auto-expand code when cursor lands on a Lang node.
        if cursor < sel.len() {
            if let NK::Lang(ref mid, ref pname, lang) = nodes[sel[cursor]].kind {
                if let Exp::Open { ref model_id, prov: Some(ref mut pe) } = exp {
                    if model_id == mid && &pe.name == pname && pe.lang != Some(lang) {
                        pe.lang = Some(lang);
                    }
                }
            }
        }
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────

fn extract_core_name(model_id: &str) -> String {
    let name = model_id.split('/').next_back().unwrap_or(model_id);
    let base = name
        .replace("-Instruct", "")
        .replace("-instruct", "")
        .replace("-Chat", "")
        .replace("-chat", "")
        .replace("-FP8", "")
        .replace("-fp8", "");
    let parts: Vec<&str> = base.split('-').collect();
    let core = parts.iter().take(3).copied().collect::<Vec<_>>().join("-");
    if model_id.contains('/') {
        if let Some(org) = model_id.split('/').next() {
            return format!("{org}/{core}");
        }
    }
    core
}

// ── Sync ─────────────────────────────────────────────────────────────

async fn cmd_sync() -> anyhow::Result<()> {
    let term = Term::stderr();
    term.write_line(&format!("{}", s_dim().apply_to("downloading latest data...")))?;

    let result = hf_providers_core::sync::sync_data().await?;

    term.clear_last_lines(1)?;
    println!();
    println!(
        "  {}",
        s_hot().apply_to("synced")
    );
    println!(
        "  {}",
        s_dim().apply_to(format!(
            "hardware.toml: {} GPUs   cloud.toml: {} offerings",
            result.hardware_count, result.cloud_count
        ))
    );
    if let Some(dir) = hf_providers_core::cache::cache_dir() {
        println!(
            "  {}",
            s_hint().apply_to(format!("cached in {}", dir.display()))
        );
    }
    println!();
    Ok(())
}
