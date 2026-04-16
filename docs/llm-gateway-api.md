# LLM Gateway API Documentation

## Authentication
Include your API key in the Authorization header as a Bearer token:
  Authorization: Bearer llmgw_xxxxxxxxxxxxxxxx
Generate API keys from the "API Keys" page. Each key is scoped to a project and all usage is tracked under your account.

## List Models
GET /api/v1/models
Returns all available models with their provider and pricing information.

### Example Request
curl https://llm-gateway.replit.app/api/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"

### Example Response
{
  "models": [
    {
      "id": "gemini-2.5-flash",
      "provider": "gemini",
      "pricing": {
        "input_per_1m_tokens": 0.30,
        "output_per_1m_tokens": 2.50
      }
    },
    ...
  ]
}

## Chat Completion
POST /api/v1/chat/completions
Send a chat completion request. The gateway routes to the correct provider based on the model you specify.

### Example Request
curl -X POST https://llm-gateway.replit.app/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 1024,
    "run_id": "my-pipeline-run-001"
  }'

### Request Parameters
| Parameter   | Type            | Required | Description |
|-------------|-----------------|----------|-------------|
| model       | string          | Yes      | The model ID to use (determines provider) |
| messages    | array           | Yes      | Array of message objects with role and content |
| max_tokens  | number          | No       | Maximum tokens in response (default: 1024) |
| temperature | number          | No       | Sampling temperature (0-2, default: 1) |
| run_id      | string          | No       | Optional identifier to group multiple requests into a single run. When provided, the response includes a run_total_cost field with the cumulative cost of all calls sharing that run ID. |
| tools       | array           | No       | List of tools the model can call. Uses OpenAI-compatible format across all providers. |
| tool_choice | string | object | No       | Controls tool use: "auto", "none", "required", or a specific tool object. |
| stream      | boolean         | No       | Set to true to receive Server-Sent Events (SSE) instead of a single JSON response. |

### Example Response
{
  "id": "resp_abc123",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "content": "Hello! How can I help you today?",
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 12,
    "total_tokens": 22
  },
  "estimated_cost": 0.00021,
  "run_total_cost": 0.00483
}

## Streaming
Set "stream": true in your request to receive Server-Sent Events (SSE). The response follows the OpenAI-compatible streaming format.
Each chunk is sent as a data: line, followed by a final data: [DONE] message.
Usage is tracked the same as non-streaming requests and logged after the stream completes.

## Tool Use / Function Calling
The gateway supports tool use (function calling) across all providers using a unified OpenAI-compatible format.
Define tools in your request and the model will return tool calls when appropriate. Works with OpenAI, Anthropic, and Gemini models.

### tool_choice Options
| Value | Behavior |
|-------|----------|
| "auto" | Model decides whether to call tools (default) |
| "none" | Model will not call any tools |
| "required" | Model must call at least one tool |
| {"type":"function","function":{"name":"..."}} | Force the model to call a specific tool |

### Gemini 3 Thought Signatures
Gemini 3 models require thought signatures to be preserved during tool calling. When a Gemini 3 model returns tool calls, each tool call may include a thought_signature field. You MUST pass this back in the assistant message when sending tool results.

## Vision / Multimodal
Send images alongside text using the same POST /api/v1/chat/completions endpoint. All models across OpenAI, Anthropic, and Gemini support vision.
Instead of a plain string, pass an array of content parts for the content field.

### Content Part Types
| Part Type | Fields | Description |
|-----------|--------|-------------|
| text | text: string | Text content in the message |
| image_url | image_url.url: string | HTTPS URL or base64 data URI |

## Embeddings
POST /api/v1/embeddings
Generate vector embeddings for text input.

### Request Parameters
| Parameter  | Type            | Required | Description |
|------------|-----------------|----------|-------------|
| model      | string          | Yes      | The embedding model ID |
| input      | string or array | Yes      | Text or array of texts to embed |
| dimensions | number          | No       | Output vector dimensions (model-dependent) |

## Image Generation
POST /api/v1/images/generations
Generate images from text prompts. Supports OpenAI (gpt-image-1) and Gemini models.

### Request Parameters
| Parameter  | Type   | Required | Description |
|------------|--------|----------|-------------|
| model      | string | Yes      | The image model ID |
| prompt     | string | Yes      | Text description of the desired image |
| n          | number | No       | Number of images to generate (1-10, default: 1) |
| size       | string | No       | Image size |
| quality    | string | No       | Image quality (OpenAI: low, medium, high, auto) |
| background | string | No       | Background type (OpenAI: transparent, opaque, auto) |
| run_id     | string | No       | Optional run ID for cost tracking |

## Supported Models & Pricing
Prices shown per 1M tokens (input / output).

### OpenAI
| Model | Input | Output |
|-------|-------|--------|
| gpt-5.4 | $2.50 | $15.00 |
| gpt-5 | $1.25 | $10.00 |
| gpt-5.2 | $1.75 | $14.00 |
| gpt-4.1 | $2.00 | $8.00 |
| gpt-4.1-mini | $1.00 | $4.00 |
| gpt-4.1-nano | $0.50 | $2.00 |

### Anthropic
| Model | Input | Output |
|-------|-------|--------|
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-opus-4-6 | $5.00 | $25.00 |
| claude-haiku-4-5 | $1.00 | $5.00 |

### Gemini
| Model | Input | Output |
|-------|-------|--------|
| gemini-2.5-flash | $0.30 | $2.50 |
| gemini-2.5-pro | $1.25 | $10.00 |
| gemini-3-flash-preview | $0.50 | $3.00 |
| gemini-3-pro-preview | $2.00 | $12.00 |
| gemini-3.1-pro-preview | $2.00 | $12.00 |

### Embedding Models
| Model | Price per 1M tokens |
|-------|---------------------|
| text-embedding-004 | $0.10 |
| gemini-embedding-001 | $0.15 |

### Image Models
| Model | Provider | Price per Image |
|-------|----------|-----------------|
| gpt-image-1 | openai | $0.04 |
| gemini-2.5-flash-image | gemini | $0.02 |
| gemini-3.1-flash-image-preview | gemini | $0.07 |
| imagen-4.0-generate-001 | gemini | $0.03 |

## Base URL
https://llm-gateway.replit.app
