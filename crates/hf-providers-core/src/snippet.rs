use std::str::FromStr;

#[cfg(feature = "network")]
use crate::model::Model;
#[cfg(feature = "network")]
use crate::provider::ProviderInfo;

#[derive(Clone, Copy, PartialEq)]
pub enum Lang {
    Python,
    Curl,
    Javascript,
}

impl FromStr for Lang {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "python" | "py" => Ok(Self::Python),
            "curl" => Ok(Self::Curl),
            "js" | "javascript" => Ok(Self::Javascript),
            other => Err(format!("unknown lang: {other}")),
        }
    }
}

/// Generate a snippet from just model_id and provider name strings.
pub fn generate_simple(model_id: &str, provider_name: &str, lang: Lang) -> String {
    let prov = provider_name;

    match lang {
        Lang::Python => format!(
            r#"from huggingface_hub import InferenceClient

client = InferenceClient(provider="{prov}")
response = client.chat.completions.create(
    model="{model_id}",
    messages=[{{"role": "user", "content": "Hello!"}}]
)
print(response.choices[0].message.content)"#
        ),

        Lang::Curl => format!(
            r#"curl -X POST https://router.huggingface.co/v1/chat/completions \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{{"model":"{model_id}:{prov}","messages":[{{"role":"user","content":"Hello!"}}]}}'"#
        ),

        Lang::Javascript => format!(
            r#"import {{ InferenceClient }} from "@huggingface/inference";

const client = new InferenceClient(process.env.HF_TOKEN);
const result = await client.chatCompletion({{
  model: "{model_id}",
  provider: "{prov}",
  messages: [{{ role: "user", content: "Hello!" }}],
}});
console.log(result.choices[0].message.content);"#
        ),
    }
}

#[cfg(feature = "network")]
pub fn generate(model: &Model, provider: &ProviderInfo, lang: Lang) -> String {
    generate_simple(&model.id, &provider.name, lang)
}
