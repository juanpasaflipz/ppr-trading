const DEFAULT_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'];

function getAvailableModels() {
  const envModels = (process.env.OPENAI_AVAILABLE_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return envModels.length ? envModels : DEFAULT_MODELS;
}

function getDefaultModel() {
  return process.env.OPENAI_DEFAULT_MODEL || getAvailableModels()[0] || 'gpt-5.4-mini';
}

class OpenAIService {
  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }

  getSettings() {
    return {
      enabled: this.isConfigured(),
      availableModels: getAvailableModels(),
      defaultModel: getDefaultModel(),
      provider: 'openai',
    };
  }

  async createResponse({ model, instructions, input }) {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const selectedModel = model || getDefaultModel();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        instructions,
        input,
        text: {
          format: {
            type: 'json_object',
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    const outputText = payload.output_text
      || payload.output?.map((item) => item?.content?.map((content) => content?.text).join('')).join('')
      || '';

    if (!outputText) {
      throw new Error('OpenAI response did not include output text');
    }

    return {
      model: selectedModel,
      parsed: JSON.parse(outputText),
      raw: payload,
    };
  }
}

const openaiService = new OpenAIService();
export default openaiService;
