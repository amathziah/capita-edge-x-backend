# AI Backend Architecture

## Purpose

This document describes the live AI backend architecture in `capita-edgex-backend` after the AI module refactor.

The current design is built around one execution model:

1. route/controller entry
2. orchestrated tool planning
3. grounded read-model retrieval
4. validated model generation
5. trace, usage, and conversation persistence

The older mixed native Gemini tool-calling path has been removed from the main runtime path.

## Top-Level Flow

For the primary chat endpoints:

1. `POST /api/ai/chat`
2. `POST /api/ai/chat/stream`

the request flow is:

```text
HTTP request
  -> auth middleware
  -> ai.route.js
  -> aiChat.controller.js
  -> aiOrchestrator.service.js
     -> aiToolRegistry.service.js
     -> aiReadModel.service.js
     -> aiTrace.service.js
  -> ai.service.js
     -> aiGrounding.service.js
     -> aiRuntime.service.js
     -> aiBudget.service.js
  -> Supabase persistence
  -> JSON or SSE response
```

## Module Boundaries

### Routes

`src/modules/ai/ai.route.js`

Responsibilities:

- expose AI HTTP endpoints
- apply AI-specific rate limits
- map routes to controller exports

### Controllers

`src/modules/ai/ai.controller.js`

This is now a compatibility barrel that re-exports controller handlers from smaller files.

#### Chat Controller

`src/modules/ai/aiChat.controller.js`

Responsibilities:

- chat request handling
- SSE stream handling
- usage status and config endpoints
- invoice parsing and invoice audit endpoints
- rule-based insights and revenue forecast endpoints
- AI usage logging
- conversation persistence for chat

#### Ops Controller

`src/modules/ai/aiOps.controller.js`

Responsibilities:

- settlement generation
- command parsing endpoint
- collection draft generation
- collection reminder sending
- budget endpoint
- trace endpoints
- AI action execution endpoint

#### History Controller

`src/modules/ai/aiHistory.controller.js`

Responsibilities:

- conversations list
- conversation messages
- chat history list
- chat history deletion

#### Shared Controller Helpers

`src/modules/ai/aiController.shared.js`

Responsibilities:

- shared AI cost calculation
- budget gate helper
- org settings resolution
- AI request context building
- shared cache and usage helpers

## Orchestration Layer

### AI Orchestrator

`src/modules/ai/aiOrchestrator.service.js`

Responsibilities:

- create a trace id
- build an execution plan from the query
- execute planned tools
- log `plan`, `tool`, and `final` trace stages
- call grounded answer generation
- attach suggested frontend/server actions

This service is the main workflow coordinator for chat.

### Tool Registry

`src/modules/ai/aiToolRegistry.service.js`

Responsibilities:

- maintain available AI tool definitions
- map natural-language query patterns to tool plans
- execute a planned tool by delegating to the read model

Current planning strategy is heuristic and keyword-driven. It is intentionally simple and deterministic.

### Read Model

`src/modules/ai/aiReadModel.service.js`

Responsibilities:

- read tenant-scoped data from Supabase
- compose analytics and domain data into AI-friendly payloads
- normalize invoice, payment, expense, compliance, and business snapshot data
- attach provenance metadata for downstream grounding

This is the read-side adapter between the operational database and the AI layer.

## AI Service Layer

### Composition Service

`src/modules/ai/ai.service.js`

Responsibilities:

- compose the extracted AI helper services
- generate grounded chat answers
- generate grounded streaming answers
- build tool-backed execution when needed
- expose structured AI task methods used by controllers
- keep stable public methods for the module

This file is now primarily the main composition point rather than a monolithic implementation file.

### Budget Service

`src/modules/ai/aiBudget.service.js`

Responsibilities:

- normalize plan tiers
- query monthly AI usage
- enforce plan-level budget policy
- expose remaining budget state to controllers and services

### Grounding Service

`src/modules/ai/aiGrounding.service.js`

Responsibilities:

- build grounded prompts
- analyze query risk
- collect evidence facts from tool output
- validate grounded JSON payloads
- format grounded responses
- generate deterministic fallback answers from tool evidence
- generate safety metadata and refusal text

This service is the core anti-hallucination layer.

### Runtime Service

`src/modules/ai/aiRuntime.service.js`

Responsibilities:

- initialize Gemini client
- manage in-process rate bucket state
- manage retry and circuit-breaker behavior
- sanitize chat history
- deduplicate in-flight structured requests
- provide model instances

This service contains transport/runtime concerns only.

### Structured Task Service

`src/modules/ai/aiStructuredTask.service.js`

Responsibilities:

- invoice text parsing
- invoice audit JSON generation
- collection draft generation
- settlement draft generation
- command parsing
- validation for those structured outputs

This service handles non-chat structured AI tasks.

## Action Layer

### Action Registry

`src/modules/ai/aiActionRegistry.service.js`

Responsibilities:

- inspect the user query
- suggest client or server actions such as navigation, opening modals, or creating a customer

### Action Executor

`src/modules/ai/aiActionExecutor.service.js`

Responsibilities:

- execute server-side AI actions
- currently supports server-side customer creation

## Trace and Persistence

### Trace Service

`src/modules/ai/aiTrace.service.js`

Responsibilities:

- create trace ids
- persist orchestration events
- list traces for an organization
- fetch a full trace by id

Trace stages currently include:

- `plan`
- `tool`
- `final`
- `error`

### Usage and History Tables

Primary persistence tables used by the AI module:

- `ai_requests`
- `ai_tool_traces`
- `ai_conversations`
- `ai_chat_messages`
- `business_knowledge`

Supporting business data comes from operational tables such as:

- `invoices`
- `payments`
- `expenses`
- `customers`
- `compliance_tasks`
- `organization_configs`

## Request Lifecycle

### Non-Streaming Chat

1. controller validates request and budget gate
2. shared helper builds minimal AI context
3. orchestrator builds a tool plan
4. orchestrator executes tools and logs trace records
5. `ai.service` calls grounded generation
6. grounding service validates output or builds deterministic fallback
7. controller logs AI usage and saves conversation messages
8. response returns with text, provider, trace id, budget, and optional action

### Streaming Chat

1. controller validates request and budget gate
2. SSE headers are established
3. orchestrator emits any generated UI payloads from tool results
4. `ai.service` streams generation
5. controller persists usage and chat history at completion
6. final SSE event includes text, provider, budget, and metadata

## Safety Model

The AI backend treats private business facts as valid only when they come from executed tools.

Safety controls include:

- route-level rate limiting
- plan budget enforcement
- query risk classification
- evidence-backed JSON prompting for grounded responses
- citation validation
- unsupported-number detection
- deterministic fallback text when validation fails
- trace logging for plan, tool, and final stages

For grounded responses, the model output is not trusted directly. It must pass validation against retrieved evidence.

## Tenant Isolation

The backend uses the Supabase service role for many backend operations. Because of that, tenant isolation is enforced in application logic by consistently filtering on `organization_id`.

This makes the following rule critical:

- every AI data read must stay explicitly scoped to `req.user.organizationId`

The read-model layer is the main place where this scoping discipline is concentrated.

## Current Strengths

- single clear orchestration path for chat
- explicit grounding and validation layer
- read-model abstraction over domain data
- traceability of plan, tool, and final output
- decomposition of budget, runtime, grounding, structured tasks, and controllers
- deterministic fallbacks for failed grounded validation

## Remaining Debt

The refactor removed the largest structural problems, but some debt remains:

- `ai.service.js` is still the top-level composition point and could be split once more into a dedicated workflow service
- tool planning is still heuristic and could become brittle for broader natural-language variation
- some shared controller logic could move further downward into app services if stricter layering is desired
- tenant isolation still depends heavily on disciplined `organization_id` filtering in backend code

## Current File Map

```text
src/modules/ai/
  ai.route.js
  ai.controller.js
  aiController.shared.js
  aiChat.controller.js
  aiOps.controller.js
  aiHistory.controller.js
  ai.service.js
  aiBudget.service.js
  aiGrounding.service.js
  aiRuntime.service.js
  aiStructuredTask.service.js
  aiOrchestrator.service.js
  aiToolRegistry.service.js
  aiReadModel.service.js
  aiTrace.service.js
  aiActionRegistry.service.js
  aiActionExecutor.service.js
```

## Recommended Next Step

If the AI backend continues to grow, the next clean extraction is:

- move grounded answer generation and streaming generation from `ai.service.js` into a dedicated workflow service such as `aiWorkflow.service.js`

That would leave `ai.service.js` as either a very thin facade or remove the need for it entirely.
