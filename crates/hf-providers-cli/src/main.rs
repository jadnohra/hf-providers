use std::str::FromStr;

use clap::{Parser, Subcommand};
use console::{Key, Style, Term};
use hf_providers_core::{
    api::{parse_model, HfClient},
    model::Model,
    provider::{ProviderInfo, ProviderKind, Readiness, PROVIDERS},
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
fn s_code() -> Style   { Style::new().color256(180) }         // warm tan
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

fn bool_str(v: Option<bool>) -> String {
    match v {
        Some(true) => format!("{}", s_hot().apply_to("\u{2713}")),
        _ => format!("{}", s_tree().apply_to("\u{2500}")),
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

fn fmt_price(v: Option<f64>) -> String {
    match v {
        Some(p) => format!("{}", s_price().apply_to(format!("${:.2}", p))),
        None => format!("{}", s_tree().apply_to("\u{2500}")),
    }
}

fn fmt_tput(v: Option<f64>) -> String {
    match v {
        Some(t) if t >= 100.0 => format!("{}", s_warm().apply_to(format!("{:.0} t/s", t))),
        Some(t) => format!("{}", s_dim().apply_to(format!("{:.0} t/s", t))),
        None => format!("{}", s_tree().apply_to("\u{2500}")),
    }
}

// ── CLI Args ─────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "hfp",
    about = "Find out how to run any Hugging Face model",
    version,
    after_help = "examples:\n  \
        hfp deepseek-r1\n  \
        hfp deepseek-r1@novita         (python snippet via novita)\n  \
        hfp deepseek-r1@novita:curl    (curl snippet via novita)\n  \
        hfp meta-llama/Llama-3.3-70B-Instruct\n  \
        hfp flux.1-dev\n  \
        hfp deepseek-r1 --cheapest\n  \
        hfp providers groq\n  \
        hfp run deepseek-r1"
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
    /// Code snippet to run a model.
    Run {
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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = HfClient::with_auto_token();

    match cli.command {
        Some(Commands::Run {
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
                use clap::CommandFactory;
                Cli::command().print_help()?;
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

// ── Search ───────────────────────────────────────────────────────────

async fn cmd_search(client: &HfClient, query: &str, opts: &Cli) -> anyhow::Result<()> {
    let term = Term::stderr();
    term.write_line(&format!("{}", s_dim().apply_to("searching...")))?;

    // Try exact match first.
    let model = match client.model_info(query).await {
        Ok(data) => parse_model(&data),
        Err(_) => None,
    };

    let model = if let Some(m) = model {
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
                    "  Or broaden search: hfp {}",
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
        interactive_picker(client, model, variants).await?;
    }

    Ok(())
}

// ── Run ──────────────────────────────────────────────────────────────

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
                    "  {} models   hfp <model> for details",
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
                    "  {} providers   hfp providers <name> for models",
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

// ── Display ──────────────────────────────────────────────────────────

fn print_model_full(model: &Model, variants: &[Model], opts: &Cli) {
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
        println!("{}", sep(64));

        println!(
            "  {:<16} {:<10} {:<9} {:<9} {:<9} {:<6} {}",
            s_dim().apply_to("Provider"),
            s_dim().apply_to("Status"),
            s_dim().apply_to("In $/1M"),
            s_dim().apply_to("Out $/1M"),
            s_dim().apply_to("Tput"),
            s_dim().apply_to("Tools"),
            s_dim().apply_to("JSON"),
        );

        for p in &providers {
            println!(
                "  {:<16} {:<10} {:<9} {:<9} {:<9} {:<6} {}",
                s_accent().apply_to(&p.name),
                readiness_str(p.readiness()),
                fmt_price(p.input_price_per_m),
                fmt_price(p.output_price_per_m),
                fmt_tput(p.throughput_tps),
                bool_str(p.supports_tools),
                bool_str(p.supports_structured),
            );
        }

        println!("{}", sep(64));

        let mut summary_parts = Vec::new();
        if let Some(c) = model.cheapest() {
            let price = match (c.input_price_per_m, c.output_price_per_m) {
                (Some(i), Some(o)) => format!(
                    " {}",
                    s_price().apply_to(format!("(${:.2}/${:.2})", i, o))
                ),
                _ => String::new(),
            };
            summary_parts.push(format!(
                "{} {}{}",
                s_dim().apply_to("cheapest:"),
                s_accent().apply_to(&c.name),
                price
            ));
        }
        if let Some(f) = model.fastest() {
            let tput = f
                .throughput_tps
                .map(|t| format!(" {}", s_warm().apply_to(format!("({:.0} t/s)", t))))
                .unwrap_or_default();
            summary_parts.push(format!(
                "{} {}{}",
                s_dim().apply_to("fastest:"),
                s_accent().apply_to(&f.name),
                tput
            ));
        }
        if !summary_parts.is_empty() {
            println!("  {}", summary_parts.join("   "));
        }
    }

    // ── Dedicated endpoint ──

    println!();
    println!("{}", s_header().apply_to("dedicated endpoint"));
    println!(
        "  {} {} {} {} {} {}",
        s_dim().apply_to("Deploy at"),
        s_accent().apply_to(format!("huggingface.co/{}", model.id)),
        s_dim().apply_to("\u{2192}"),
        s_dim().apply_to("Deploy"),
        s_dim().apply_to("\u{2192}"),
        s_dim().apply_to("Inference Endpoints"),
    );
    if let Some(ref hint) = Model::param_hint(&model.id) {
        let est = estimate_hourly(hint);
        if !est.is_empty() {
            println!("  {}", s_price().apply_to(est));
        }
    }

    // ── Local ──

    println!();
    println!("{}", s_header().apply_to("local"));
    println!(
        "  {}",
        s_code().apply_to(format!("vllm serve {}", model.id))
    );
    if let Some(ref hint) = Model::param_hint(&model.id) {
        let vram = estimate_vram(hint);
        if !vram.is_empty() {
            println!("  {}", s_dim().apply_to(format!("VRAM: ~{vram}")));
        }
    }

    // ── Variants ──

    if !variants.is_empty() {
        println!();
        println!("{}", s_header().apply_to("variants"));
        println!("{}", sep(64));

        for v in variants.iter().take(10) {
            let pcount = v.providers.len();
            let param = Model::param_hint(&v.id).unwrap_or_default();
            let prov_str = if pcount > 0 {
                s_hot().apply_to(if pcount == 1 {
                    "1 provider".to_string()
                } else {
                    format!("{pcount} providers")
                }).to_string()
            } else {
                s_dim().apply_to("0 providers").to_string()
            };
            println!(
                "  {:<48} {:<14} {}",
                &v.id,
                prov_str,
                if param.is_empty() {
                    String::new()
                } else {
                    s_param().apply_to(&param).to_string()
                }
            );
        }

        println!("{}", sep(64));
    }

    println!(
        "{}",
        s_hint().apply_to("  tip: hfp model@provider:lang for direct snippets")
    );
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
            "  {} results   hfp <model-id> for details",
            models.len()
        ))
    );
    println!();
}

// ── Interactive tree browser ─────────────────────────────────────────

#[derive(Clone)]
enum TreeAction {
    ToggleProvider(String),
    ToggleLang(String, Lang),
    DrillVariant(String),
    Quit,
}

struct TreeNode {
    label: String,
    action: Option<TreeAction>,
    code: bool,
}

fn build_tree(
    model: &Model,
    variants: &[Model],
    exp_prov: &Option<String>,
    exp_lang: &Option<(String, Lang)>,
) -> Vec<TreeNode> {
    let mut nodes = Vec::new();

    let mut provs: Vec<&ProviderInfo> = model.providers.iter().collect();
    provs.sort_by(|a, b| a.readiness().cmp(&b.readiness()).then(a.name.cmp(&b.name)));

    for p in &provs {
        let r = match p.readiness() {
            Readiness::Hot => "\u{25cf} hot",
            Readiness::Warm => "\u{25d0} warm",
            Readiness::Cold => "\u{25cb} cold",
            Readiness::Unavailable => "\u{2717} unavail",
        };
        let price = match (p.input_price_per_m, p.output_price_per_m) {
            (Some(i), Some(o)) => format!("  ${:.2}/${:.2}", i, o),
            _ => String::new(),
        };
        let tput = p
            .throughput_tps
            .map(|t| format!("  {:.0} t/s", t))
            .unwrap_or_default();

        nodes.push(TreeNode {
            label: format!("{:<16} {}{}{}", p.name, r, price, tput),
            action: Some(TreeAction::ToggleProvider(p.name.clone())),
            code: false,
        });

        if exp_prov.as_deref() == Some(p.name.as_str()) {
            let langs = [Lang::Python, Lang::Curl, Lang::Javascript];
            for (j, &lang) in langs.iter().enumerate() {
                let is_last = j == langs.len() - 1;
                let conn = if is_last { "\u{2514}\u{2500}" } else { "\u{251c}\u{2500}" };
                let name = match lang {
                    Lang::Python => "python",
                    Lang::Curl => "curl",
                    Lang::Javascript => "javascript",
                };
                nodes.push(TreeNode {
                    label: format!("  {conn} {name}"),
                    action: Some(TreeAction::ToggleLang(p.name.clone(), lang)),
                    code: false,
                });

                if exp_lang.as_ref() == Some(&(p.name.clone(), lang)) {
                    let code = snippet::generate(model, p, lang);
                    let cont = if is_last { "   " } else { "\u{2502}  " };
                    for line in code.lines() {
                        nodes.push(TreeNode {
                            label: format!("  {cont}{line}"),
                            action: None,
                            code: true,
                        });
                    }
                }
            }
        }
    }

    if !variants.is_empty() {
        nodes.push(TreeNode {
            label: "\u{2500}\u{2500} variants \u{2500}\u{2500}".to_string(),
            action: None,
            code: false,
        });
        for v in variants.iter().take(8) {
            let short = v.id.rsplit('/').next().unwrap_or(&v.id);
            let pcount = v.providers.len();
            let param = Model::param_hint(&v.id).unwrap_or_default();
            let plabel = if pcount == 1 {
                "1 provider".to_string()
            } else {
                format!("{pcount} providers")
            };
            let suffix = if param.is_empty() {
                String::new()
            } else {
                format!("  {param}")
            };
            nodes.push(TreeNode {
                label: format!("\u{21b3} {short}  {plabel}{suffix}"),
                action: Some(TreeAction::DrillVariant(v.id.clone())),
                code: false,
            });
        }
    }

    nodes.push(TreeNode {
        label: "quit".to_string(),
        action: Some(TreeAction::Quit),
        code: false,
    });

    nodes.push(TreeNode {
        label: "\u{2191}\u{2193} navigate  enter expand  q quit".to_string(),
        action: None,
        code: false,
    });

    nodes
}

fn render_tree(nodes: &[TreeNode], cursor: usize, sel: &[usize]) -> Vec<String> {
    let active = sel.get(cursor).copied().unwrap_or(usize::MAX);
    let mut lines = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        let is_active = i == active;
        let prefix = if is_active { "> " } else { "  " };
        let text = format!("{prefix}{}", node.label);
        if is_active {
            lines.push(format!("{}", s_accent().bold().apply_to(&text)));
        } else if node.code {
            lines.push(format!("{}", s_code().apply_to(&text)));
        } else if node.action.is_none() {
            lines.push(format!("{}", s_hint().apply_to(&text)));
        } else {
            lines.push(format!("{}", s_tree().apply_to(&text)));
        }
    }
    lines
}

fn selectables(nodes: &[TreeNode]) -> Vec<usize> {
    nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.action.is_some())
        .map(|(i, _)| i)
        .collect()
}

fn find_cursor(nodes: &[TreeNode], sel: &[usize], target: &TreeAction) -> Option<usize> {
    sel.iter().position(|&ni| match (&nodes[ni].action, target) {
        (Some(TreeAction::ToggleProvider(a)), TreeAction::ToggleProvider(b)) => a == b,
        (Some(TreeAction::ToggleLang(pa, la)), TreeAction::ToggleLang(pb, lb)) => {
            pa == pb && la == lb
        }
        _ => false,
    })
}

async fn interactive_picker(
    client: &HfClient,
    mut model: Model,
    mut variants: Vec<Model>,
) -> anyhow::Result<()> {
    let term = Term::stderr();
    let mut exp_prov: Option<String> = None;
    let mut exp_lang: Option<(String, Lang)> = None;
    let mut cursor: usize = 0;
    let mut drawn: usize = 0;

    loop {
        let nodes = build_tree(&model, &variants, &exp_prov, &exp_lang);
        let sel = selectables(&nodes);
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
        drawn = lines.len();

        let key = {
            let t = Term::stderr();
            tokio::task::spawn_blocking(move || t.read_key()).await?
        }?;

        match key {
            Key::ArrowUp | Key::Char('k') => {
                cursor = cursor.saturating_sub(1);
            }
            Key::ArrowDown | Key::Char('j') => {
                if cursor + 1 < sel.len() {
                    cursor += 1;
                }
            }
            Key::Enter => {
                let action = nodes[sel[cursor]].action.clone();
                match action {
                    Some(TreeAction::ToggleProvider(ref name)) => {
                        if exp_prov.as_deref() == Some(name) {
                            exp_prov = None;
                            exp_lang = None;
                        } else {
                            exp_prov = Some(name.clone());
                            exp_lang = None;
                        }
                        let nn = build_tree(&model, &variants, &exp_prov, &exp_lang);
                        let ns = selectables(&nn);
                        if let Some(pos) = find_cursor(&nn, &ns, action.as_ref().unwrap()) {
                            cursor = pos;
                        }
                    }
                    Some(TreeAction::ToggleLang(ref pname, lang)) => {
                        let key = (pname.clone(), lang);
                        if exp_lang.as_ref() == Some(&key) {
                            exp_lang = None;
                        } else {
                            exp_lang = Some(key);
                        }
                        let nn = build_tree(&model, &variants, &exp_prov, &exp_lang);
                        let ns = selectables(&nn);
                        if let Some(pos) = find_cursor(&nn, &ns, action.as_ref().unwrap()) {
                            cursor = pos;
                        }
                    }
                    Some(TreeAction::DrillVariant(ref id)) => {
                        term.clear_last_lines(drawn)?;
                        drawn = 0;
                        term.write_line(&format!(
                            "{}",
                            s_dim().apply_to("loading...")
                        ))?;

                        let data = match client.model_info(id).await {
                            Ok(d) => d,
                            Err(e) => {
                                term.clear_last_lines(1)?;
                                eprintln!(
                                    "{}",
                                    s_err().apply_to(format!("error: {e}"))
                                );
                                continue;
                            }
                        };
                        term.clear_last_lines(1)?;

                        if let Some(m) = parse_model(&data) {
                            let core = extract_core_name(&m.id);
                            let vr =
                                client.search_models(&core, 15).await.unwrap_or_default();
                            let new_v: Vec<Model> = vr
                                .iter()
                                .filter_map(parse_model)
                                .filter(|v| v.id != m.id)
                                .collect();

                            let opts = Cli {
                                query: None,
                                command: None,
                                cheapest: false,
                                fastest: false,
                                tools: false,
                                hot: false,
                                json: false,
                            };
                            print_model_full(&m, &new_v, &opts);
                            model = m;
                            variants = new_v;
                            exp_prov = None;
                            exp_lang = None;
                            cursor = 0;
                        }
                    }
                    Some(TreeAction::Quit) => {
                        term.clear_last_lines(drawn)?;
                        break;
                    }
                    None => {}
                }
            }
            Key::Escape | Key::Char('q') | Key::Char('\u{3}') => {
                term.clear_last_lines(drawn)?;
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────

fn estimate_vram(param_hint: &str) -> String {
    let b: f64 = param_hint
        .trim_end_matches('B')
        .trim_end_matches('b')
        .parse()
        .unwrap_or(0.0);
    if b <= 0.0 {
        return String::new();
    }
    format!("{:.0}GB FP16 / {:.0}GB INT8 / {:.0}GB INT4", b * 2.0, b, b * 0.5)
}

fn estimate_hourly(param_hint: &str) -> String {
    let b: f64 = param_hint
        .trim_end_matches('B')
        .trim_end_matches('b')
        .parse()
        .unwrap_or(0.0);
    if b <= 0.0 {
        return String::new();
    }
    if b <= 13.0 {
        "~$1.10/hr on A10G 24GB".to_string()
    } else if b <= 70.0 {
        "~$4.50/hr on A100 80GB".to_string()
    } else {
        "~$18/hr on 4xA100 80GB (multi-GPU)".to_string()
    }
}

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
