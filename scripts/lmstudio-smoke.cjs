const baseUrl = (process.env.GRAPHITI_OPENAI_BASE_URL ?? process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, "");
const apiKey = process.env.GRAPHITI_OPENAI_API_KEY ?? process.env.LMSTUDIO_API_KEY ?? "lm-studio";
const chatModel = process.env.GRAPHITI_LLM_MODEL;
const embeddingModel = process.env.GRAPHITI_EMBEDDING_MODEL;

async function main() {
  console.log("Perry LM Studio smoke");
  console.log(`Base URL: ${baseUrl}`);

  const modelsResponse = await request("/models");
  const models = Array.isArray(modelsResponse.data) ? modelsResponse.data.map((model) => model.id) : [];
  console.log(`Models: ${models.length}`);
  for (const model of models) console.log(`- ${model}`);

  const selectedChatModel = chatModel ?? models.find((model) => !String(model).toLowerCase().includes("embedding"));
  const selectedEmbeddingModel =
    embeddingModel ?? models.find((model) => String(model).toLowerCase().includes("embedding"));

  if (selectedChatModel) {
    const chat = await request("/chat/completions", {
      method: "POST",
      body: {
        model: selectedChatModel,
        messages: [
          { role: "system", content: "You are a local API health checker. Return only the requested text." },
          { role: "user", content: "Return exactly: Perry local model smoke passed." },
        ],
        temperature: 0,
        max_tokens: 24,
      },
    });
    console.log(`Chat model: ${selectedChatModel}`);
    console.log(`Chat response: ${chat.choices?.[0]?.message?.content ?? "<empty>"}`);
  } else {
    console.log("Chat model: none found");
  }

  if (selectedEmbeddingModel) {
    const embedding = await request("/embeddings", {
      method: "POST",
      body: {
        model: selectedEmbeddingModel,
        input: "Perry Graphiti local embedding smoke",
      },
    });
    const vector = embedding.data?.[0]?.embedding;
    console.log(`Embedding model: ${selectedEmbeddingModel}`);
    console.log(`Embedding dimensions: ${Array.isArray(vector) ? vector.length : 0}`);
  } else {
    console.log("Embedding model: none found");
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
