# Phase 4 — Actions and Proactivity

> **Duration:** 3-4 weeks
> **Goal:** Jarvis acts on the world: reminders, goals, automations, and proactive nudges.
> **Prerequisites:** Phase 2 (2.2 Agent Module for routing), Phase 3 (3.1 Importance Scoring for proactivity)

---

## Overview

Phase 4 is the transition from "Jarvis knows" to "Jarvis does." The Action Engine handles reminders, todos, and extensible tool execution. Goals Tracking lets Jarvis monitor personal objectives. Identity Mode personalizes every interaction. Proactivity makes Jarvis anticipate needs. The Plugin System opens Jarvis to external integrations.

---

## 4.1 — Action Engine (Reminders and Todos)

**Feasibility:** 80% | **Effort:** L

### Problem

Jarvis can only store and retrieve memories. It cannot create reminders ("Rappelle-moi d'envoyer le rapport demain a 9h"), manage todos ("Ajoute acheter du lait a ma liste"), or trigger actions at specific times.

### Data Model (SQLite)

```sql
-- Reminders
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  due_at TEXT NOT NULL,           -- ISO 8601
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | delivered | cancelled
  recurrence TEXT,                -- null | daily | weekly | monthly
  source TEXT DEFAULT 'agent'
);

-- Todos
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT DEFAULT 'pending',  -- pending | completed | cancelled
  priority TEXT DEFAULT 'normal', -- low | normal | high
  source TEXT DEFAULT 'agent'
);

-- Notifications (pending delivery to wake-listener)
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,             -- reminder | proactive | goal
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  status TEXT DEFAULT 'pending'   -- pending | delivered
);
```

### Implementation

**Install dependency:**

```bash
cd jarvis && npm install better-sqlite3 && npm install -D @types/better-sqlite3
```

**Create:** `jarvis/src/action/action.module.ts`

```typescript
@Module({
  imports: [OllamaModule, TemporalModule],
  controllers: [ActionController],
  providers: [
    ActionService,
    ReminderService,
    TodoService,
    ActionDbService,
    NotificationService,
  ],
  exports: [ActionService, NotificationService],
})
export class ActionModule {}
```

**Create:** `jarvis/src/action/action-db.service.ts`

```typescript
@Injectable()
export class ActionDbService implements OnModuleInit {
  private db: Database.Database;

  onModuleInit() {
    const dbPath = path.join(process.cwd(), "data", "jarvis-actions.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.createTables();
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        recurrence TEXT,
        source TEXT DEFAULT 'agent'
      );
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'normal',
        source TEXT DEFAULT 'agent'
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        status TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    `);
  }

  // Generic prepared-statement wrappers
  insertReminder(reminder: Reminder): void {
    /* ... */
  }
  getDueReminders(now: string): Reminder[] {
    /* ... */
  }
  updateReminderStatus(id: string, status: string): void {
    /* ... */
  }
  insertTodo(todo: Todo): void {
    /* ... */
  }
  getTodos(status?: string): Todo[] {
    /* ... */
  }
  updateTodoStatus(id: string, status: string): void {
    /* ... */
  }
  insertNotification(notification: Notification): void {
    /* ... */
  }
  getPendingNotifications(): Notification[] {
    /* ... */
  }
  markNotificationDelivered(id: string): void {
    /* ... */
  }
}
```

**Create:** `jarvis/src/action/reminder.service.ts`

```typescript
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private actionDb: ActionDbService,
    private temporalService: TemporalService,
    private notificationService: NotificationService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(text: string, dueExpression: string): Promise<Reminder> {
    const temporal = this.temporalService.parse(dueExpression);
    if (!temporal) {
      throw new BadRequestException(
        `Cannot parse temporal expression: "${dueExpression}"`,
      );
    }

    const recurrence = this.temporalService.detectRecurrence(dueExpression);

    const reminder: Reminder = {
      id: randomUUID(),
      text,
      dueAt: temporal.resolvedDate,
      createdAt: new Date().toISOString(),
      status: "pending",
      recurrence: recurrence?.frequency ?? null,
      source: "agent",
    };

    this.actionDb.insertReminder(reminder);
    this.logger.log(`Reminder created: "${text}" due at ${reminder.dueAt}`);
    return reminder;
  }

  // Cron: check every minute for due reminders
  @Cron("0 * * * * *")
  async checkDueReminders() {
    const now = new Date().toISOString();
    const due = this.actionDb.getDueReminders(now);

    for (const reminder of due) {
      this.notificationService.createNotification({
        type: "reminder",
        text: `Rappel : ${reminder.text}`,
      });
      this.actionDb.updateReminderStatus(reminder.id, "delivered");

      this.eventEmitter.emit(JARVIS_EVENTS.REMINDER_DUE, {
        reminderId: reminder.id,
        text: reminder.text,
      });

      // Handle recurrence: create next occurrence
      if (reminder.recurrence) {
        const nextDue = this.computeNextOccurrence(
          reminder.dueAt,
          reminder.recurrence,
        );
        this.actionDb.insertReminder({
          ...reminder,
          id: randomUUID(),
          dueAt: nextDue,
          status: "pending",
        });
      }
    }
  }

  private computeNextOccurrence(currentDue: string, frequency: string): string {
    const date = new Date(currentDue);
    switch (frequency) {
      case "daily":
        date.setDate(date.getDate() + 1);
        break;
      case "weekly":
        date.setDate(date.getDate() + 7);
        break;
      case "monthly":
        date.setMonth(date.getMonth() + 1);
        break;
    }
    return date.toISOString();
  }
}
```

**Create:** `jarvis/src/action/todo.service.ts`

```typescript
@Injectable()
export class TodoService {
  constructor(
    private actionDb: ActionDbService,
    private ollamaService: OllamaService,
  ) {}

  create(text: string, priority?: string): Todo {
    const todo: Todo = {
      id: randomUUID(),
      text,
      createdAt: new Date().toISOString(),
      status: "pending",
      priority: priority ?? "normal",
      source: "agent",
    };
    this.actionDb.insertTodo(todo);
    return todo;
  }

  complete(todoId: string): void {
    this.actionDb.updateTodoStatus(todoId, "completed");
  }

  async list(status?: string): Promise<Todo[]> {
    return this.actionDb.getTodos(status);
  }

  async queryNaturalLanguage(question: string): Promise<string> {
    const todos = this.actionDb.getTodos("pending");
    if (todos.length === 0) return "Tu n'as aucune tache en cours.";

    const context = todos
      .map((t, i) => `${i + 1}. ${t.text} (${t.priority})`)
      .join("\n");
    return this.ollamaService.generate(
      `Voici les taches en cours:\n${context}\n\nQuestion: ${question}`,
      "Tu es Jarvis. Reponds en francais a propos des taches de l'utilisateur.",
    );
  }
}
```

**Create:** `jarvis/src/action/notification.service.ts`

```typescript
@Injectable()
export class NotificationService {
  constructor(private actionDb: ActionDbService) {}

  createNotification(params: { type: string; text: string }): void {
    this.actionDb.insertNotification({
      id: randomUUID(),
      type: params.type,
      text: params.text,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  }

  getPending(): Notification[] {
    return this.actionDb.getPendingNotifications();
  }

  markDelivered(id: string): void {
    this.actionDb.markNotificationDelivered(id);
  }
}
```

**Create:** `jarvis/src/action/action.controller.ts`

```typescript
@ApiTags("action")
@Controller("agent")
export class ActionController {
  constructor(private notificationService: NotificationService) {}

  @Get("notifications/pending")
  getPendingNotifications() {
    return this.notificationService.getPending();
  }

  @Delete("notifications/:id")
  markDelivered(@Param("id") id: string) {
    this.notificationService.markDelivered(id);
    return { acknowledged: true };
  }
}
```

**Create:** `jarvis/src/action/action.service.ts`

Orchestrates reminder/todo creation from agent intents:

```typescript
@Injectable()
export class ActionService {
  constructor(
    private reminderService: ReminderService,
    private todoService: TodoService,
  ) {}

  async execute(intent: IntentResult): Promise<EngineResult> {
    switch (intent.primary) {
      case IntentType.SCHEDULE_EVENT:
        return this.handleReminder(intent);
      case IntentType.CREATE_TASK:
        return this.handleCreateTodo(intent);
      case IntentType.QUERY_TASKS:
        return this.handleQueryTodos(intent);
      case IntentType.COMPLETE_TASK:
        return this.handleCompleteTodo(intent);
      default:
        return { answer: "Action non reconnue." };
    }
  }

  private async handleReminder(intent: IntentResult): Promise<EngineResult> {
    const timeExpr = intent.entities.time ?? intent.extractedContent;
    const reminder = await this.reminderService.create(
      intent.extractedContent,
      timeExpr,
    );
    return {
      answer: `Rappel cree pour ${new Date(reminder.dueAt).toLocaleString("fr-FR")}: "${reminder.text}"`,
      actions: [
        {
          type: "reminder_created",
          description: reminder.text,
          status: "executed",
        },
      ],
    };
  }

  private async handleCreateTodo(intent: IntentResult): Promise<EngineResult> {
    const todo = this.todoService.create(
      intent.extractedContent,
      intent.priority,
    );
    return {
      answer: `Tache ajoutee : "${todo.text}"`,
      actions: [
        { type: "todo_created", description: todo.text, status: "executed" },
      ],
    };
  }

  private async handleQueryTodos(intent: IntentResult): Promise<EngineResult> {
    const answer = await this.todoService.queryNaturalLanguage(
      intent.extractedContent,
    );
    return { answer };
  }

  private async handleCompleteTodo(
    intent: IntentResult,
  ): Promise<EngineResult> {
    // Use LLM to match natural language to a specific todo
    // Then mark it complete
    return { answer: "Tache terminee." };
  }
}
```

### Wake-Listener: Notification Polling

**Create:** `wake-listener/notification_poller.py`

```python
import threading
import time
import requests
import logging

logger = logging.getLogger(__name__)

class NotificationPoller:
    """Background thread that polls NestJS for pending notifications."""

    def __init__(self, api_url: str, tts_client, interval: int = 30):
        self.api_url = api_url
        self.tts_client = tts_client
        self.interval = interval
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        logger.info(f"Notification poller started (interval: {self.interval}s)")

    def stop(self):
        self._running = False

    def _poll_loop(self):
        while self._running:
            try:
                self._check_notifications()
            except Exception as e:
                logger.error(f"Notification poll error: {e}")
            time.sleep(self.interval)

    def _check_notifications(self):
        resp = requests.get(
            f"{self.api_url}/agent/notifications/pending",
            timeout=5,
        )
        resp.raise_for_status()
        notifications = resp.json()

        for notif in notifications:
            logger.info(f"Notification: {notif['text']}")
            self.tts_client.speak(notif['text'])

            # Acknowledge delivery
            requests.delete(
                f"{self.api_url}/agent/notifications/{notif['id']}",
                timeout=5,
            )
```

**Modify:** `wake-listener/wake_listener.py` — start poller:

```python
from notification_poller import NotificationPoller

# After TtsClient initialization:
poller = NotificationPoller(config.jarvis_api_url, tts_client, interval=30)
poller.start()
```

### Integration with Agent IntentRouter

**Modify:** `jarvis/src/agent/router/intent-router.service.ts`

```typescript
constructor(
  // ... existing
  private actionService: ActionService,
) {}

async route(intent: IntentResult, context: AgentContext): Promise<EngineResult> {
  switch (intent.primary) {
    // ... existing cases ...

    case IntentType.SCHEDULE_EVENT:
    case IntentType.CREATE_TASK:
    case IntentType.QUERY_TASKS:
    case IntentType.COMPLETE_TASK:
      return this.actionService.execute(intent);
  }
}
```

### Verification

- "Rappelle-moi d'appeler Paul demain a 9h" → reminder created in SQLite, fires at 9h
- "Ajoute acheter du lait a ma liste" → todo created
- "Quels sont mes todos ?" → LLM-formatted list
- Wake-listener receives TTS notification when reminder is due
- `GET /agent/notifications/pending` returns pending items
- `DELETE /agent/notifications/:id` marks as delivered

---

## 4.2 — Goals Tracking

**Feasibility:** 85% | **Effort:** M

### Problem

No way to set, track, or query personal goals. "Mon objectif est de courir 3 fois par semaine" has no structured storage or progress tracking.

### Data Model

Goals stored in Qdrant collection `jarvis_goals` for semantic search:

```typescript
// jarvis/src/goals/goals.types.ts

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: "active" | "completed" | "paused" | "abandoned";
  targetDate?: string; // ISO 8601
  frequency?: string; // 'weekly', 'daily', etc.
  targetCount?: number; // e.g., 3 times per week
  progress: GoalProgress[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgress {
  date: string;
  note: string;
  value?: number; // e.g., 1 run completed
}

export type GoalPayload = {
  text: string; // searchable description
  title: string;
  status: string;
  targetDate?: string;
  frequency?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
```

### Implementation

**Create:** `jarvis/src/goals/goals.module.ts`

```typescript
@Module({
  imports: [OllamaModule, VectorstoreModule, TemporalModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
```

**Create:** `jarvis/src/goals/goals.service.ts`

```typescript
@Injectable()
export class GoalsService implements OnModuleInit {
  private readonly COLLECTION = "jarvis_goals";

  constructor(
    private ollamaService: OllamaService,
    private vectorstoreService: VectorstoreService,
    private temporalService: TemporalService,
  ) {}

  async onModuleInit() {
    await this.vectorstoreService.ensureGoalsCollection(/* vectorSize from first embed */);
  }

  async addGoal(text: string): Promise<Goal> {
    // Use LLM to extract structured goal from natural language
    const parsed = await this.parseGoalWithLLM(text);

    const goal: Goal = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      status: "active",
      targetDate: parsed.targetDate,
      frequency: parsed.frequency,
      targetCount: parsed.targetCount,
      progress: [],
      tags: parsed.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Embed and store in Qdrant
    const [vector] = await this.ollamaService.embed([
      `${goal.title} ${goal.description ?? ""}`,
    ]);
    await this.vectorstoreService.upsertGoal([
      {
        id: goal.id,
        vector,
        payload: {
          text: `${goal.title} ${goal.description ?? ""}`,
          title: goal.title,
          status: goal.status,
          targetDate: goal.targetDate,
          frequency: goal.frequency,
          tags: goal.tags,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
        },
      },
    ]);

    return goal;
  }

  async queryGoals(question: string): Promise<string> {
    const [queryVector] = await this.ollamaService.embed([question]);
    const results = await this.vectorstoreService.searchGoals(queryVector, 5);

    if (results.length === 0) return "Tu n'as aucun objectif defini.";

    const context = results
      .map(
        (r) =>
          `- ${r.payload.title} (${r.payload.status})${r.payload.targetDate ? `, echeance: ${r.payload.targetDate}` : ""}`,
      )
      .join("\n");

    return this.ollamaService.generate(
      `Objectifs de l'utilisateur:\n${context}\n\nQuestion: ${question}`,
      "Tu es Jarvis. Reponds en francais a propos des objectifs personnels de l'utilisateur.",
    );
  }

  async updateProgress(
    goalTitle: string,
    progressNote: string,
  ): Promise<string> {
    // Semantic search to find the matching goal
    const [queryVector] = await this.ollamaService.embed([goalTitle]);
    const results = await this.vectorstoreService.searchGoals(queryVector, 1);

    if (results.length === 0) return "Je n'ai pas trouve cet objectif.";

    // Update payload with progress note
    // (Qdrant setPayload to update updatedAt)
    return `Progres note pour "${results[0].payload.title}": ${progressNote}`;
  }

  private async parseGoalWithLLM(text: string): Promise<ParsedGoal> {
    const prompt = `Extract a structured goal from this French text.
Return ONLY valid JSON:
{
  "title": "short goal title",
  "description": "full description",
  "targetDate": "ISO date or null",
  "frequency": "daily|weekly|monthly or null",
  "targetCount": "number or null",
  "tags": ["tag1", "tag2"]
}

Text: "${text}"`;

    const response = await this.ollamaService.generateWith("small", prompt);
    return JSON.parse(this.extractJSON(response));
  }
}
```

**Create:** `jarvis/src/goals/goals.controller.ts`

```typescript
@ApiTags("goals")
@Controller("goals")
export class GoalsController {
  constructor(private goalsService: GoalsService) {}

  @Post()
  async addGoal(@Body() dto: { text: string }) {
    return this.goalsService.addGoal(dto.text);
  }

  @Post("query")
  async queryGoals(@Body() dto: { question: string }) {
    const answer = await this.goalsService.queryGoals(dto.question);
    return { answer };
  }

  @Post("progress")
  async updateProgress(@Body() dto: { goalTitle: string; note: string }) {
    const result = await this.goalsService.updateProgress(
      dto.goalTitle,
      dto.note,
    );
    return { result };
  }
}
```

**Modify:** `jarvis/src/vectorstore/vectorstore.service.ts` — add goals collection methods:

```typescript
private readonly goalsCollection: string;

constructor(private configService: ConfigService) {
  // ...
  this.goalsCollection = this.configService.get('QDRANT_GOALS_COLLECTION', 'jarvis_goals');
}

async ensureGoalsCollection(vectorSize: number) { /* same pattern as ensureMemoryCollection */ }
async upsertGoal(points: PointStruct[]) { /* same pattern as upsertMemory */ }
async searchGoals(queryVector: number[], limit: number) { /* same pattern as searchMemory */ }
```

### Verification

- "Mon objectif est de courir 3 fois par semaine" → goal created with frequency: weekly, targetCount: 3
- "Quels sont mes objectifs ?" → LLM-formatted list of active goals
- "J'ai couru aujourd'hui" → progress update on the running goal
- Goals visible in Qdrant dashboard under `jarvis_goals` collection

---

## 4.3 — Identity Mode

**Feasibility:** 90% | **Effort:** S

### Problem

Every conversation starts without context of who the user is. System prompts are generic. Jarvis doesn't know the user's name, role, or priorities.

### Implementation

**Create:** `jarvis/identity.json`

```json
{
  "name": "Antoine",
  "role": "Architecte logiciel",
  "currentProjects": ["Jarvis", "Projet X"],
  "priorities": ["Livraison Q1", "Reduction dette technique"],
  "preferences": {
    "responseLanguage": "fr",
    "verbosity": "concise",
    "tone": "professionnel mais amical"
  }
}
```

**Create:** `jarvis/src/agent/identity/identity.service.ts`

```typescript
@Injectable()
export class IdentityService implements OnModuleInit {
  private profile: IdentityProfile;
  private readonly logger = new Logger(IdentityService.name);

  onModuleInit() {
    const identityPath = path.join(process.cwd(), "identity.json");
    try {
      const raw = fs.readFileSync(identityPath, "utf-8");
      this.profile = JSON.parse(raw);
      this.logger.log(`Identity loaded: ${this.profile.name}`);
    } catch {
      this.logger.warn("No identity.json found, using defaults.");
      this.profile = { name: "Utilisateur" };
    }
  }

  getProfile(): IdentityProfile {
    return this.profile;
  }

  buildSystemPromptContext(): string {
    const parts: string[] = [`Tu parles a ${this.profile.name}.`];
    if (this.profile.role) {
      parts.push(`Son role: ${this.profile.role}.`);
    }
    if (this.profile.currentProjects?.length) {
      parts.push(
        `Projets en cours: ${this.profile.currentProjects.join(", ")}.`,
      );
    }
    if (this.profile.priorities?.length) {
      parts.push(`Priorites: ${this.profile.priorities.join(", ")}.`);
    }
    if (this.profile.preferences?.tone) {
      parts.push(`Ton de reponse: ${this.profile.preferences.tone}.`);
    }
    return parts.join(" ");
  }
}
```

**Modify:** `jarvis/src/agent/agent.service.ts` — inject identity into prompts:

```typescript
constructor(
  // ...
  private identityService: IdentityService,
) {}

async process(dto: AgentProcessDto): Promise<AgentResponse> {
  const context = this.contextManager.getOrCreate(sessionId);
  context.identityContext = this.identityService.getProfile();
  // ... rest of flow
}
```

**Modify:** `jarvis/src/memory/memory.service.ts` — enrich query system prompt:

```typescript
const identityContext = this.identityService.buildSystemPromptContext();
const systemPrompt = `Tu es Jarvis, un assistant personnel. ${identityContext} Reponds en francais.`;
```

### Verification

- Set `identity.json` with name "Antoine"
- `/agent/process { "text": "Bonjour" }` → response uses "Antoine" in greeting
- Memory queries include identity context in LLM prompt
- Missing `identity.json` → graceful fallback, no crash

---

## 4.4 — Proactivity

**Feasibility:** 82% | **Effort:** L

### Problem

Jarvis is purely reactive. It never initiates contact. No "Tu as un RDV dans 30 minutes" or "Tu n'as pas couru cette semaine."

### Proactive Signals

| Signal                         | Source               | Urgency |
| ------------------------------ | -------------------- | ------- |
| Upcoming event (< 2h)          | Memory `eventDate`   | High    |
| Due reminder                   | Reminder DB          | High    |
| Stale goal (no progress in 7d) | Goals collection     | Medium  |
| Weekly habit missed            | Recurrence detection | Medium  |
| Summary available              | Auto-summary         | Low     |

### Implementation

**Create:** `jarvis/src/action/proactivity.service.ts`

```typescript
@Injectable()
export class ProactivityService {
  private readonly logger = new Logger(ProactivityService.name);

  constructor(
    private memoryService: MemoryService,
    private goalsService: GoalsService,
    private notificationService: NotificationService,
    private memoryScoringService: MemoryScoringService,
  ) {}

  // Run every 15 minutes
  @Cron("0 */15 * * * *")
  async scanForProactiveItems() {
    this.logger.debug("Proactivity scan started...");

    const candidates: ProactiveCandidate[] = [];

    // 1. Check upcoming events (memories with eventDate in next 2 hours)
    await this.checkUpcomingEvents(candidates);

    // 2. Check stale goals
    await this.checkStaleGoals(candidates);

    // 3. Score and filter candidates
    const filtered = candidates
      .filter((c) => c.urgency > 0.5)
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, 3); // Max 3 notifications per scan

    // 4. Create notifications
    for (const candidate of filtered) {
      this.notificationService.createNotification({
        type: "proactive",
        text: candidate.message,
      });
      this.logger.log(`Proactive notification: ${candidate.message}`);
    }
  }

  private async checkUpcomingEvents(candidates: ProactiveCandidate[]) {
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const results = await this.memoryService.search("", 10, {
      field: "eventDate",
      gte: now.toISOString(),
      lte: twoHoursLater.toISOString(),
    });

    for (const mem of results.results) {
      const eventTime = new Date(mem.eventDate!);
      const minutesUntil = (eventTime.getTime() - now.getTime()) / (1000 * 60);

      candidates.push({
        message: `Dans ${Math.round(minutesUntil)} minutes : ${mem.text}`,
        urgency: minutesUntil < 30 ? 1.0 : 0.7,
        type: "upcoming_event",
      });
    }
  }

  private async checkStaleGoals(candidates: ProactiveCandidate[]) {
    const answer = await this.goalsService.queryGoals(
      "objectifs sans progres recent",
    );
    if (answer && !answer.includes("aucun objectif")) {
      candidates.push({
        message: `Rappel objectif : ${answer.slice(0, 200)}`,
        urgency: 0.6,
        type: "stale_goal",
      });
    }
  }
}

interface ProactiveCandidate {
  message: string;
  urgency: number;
  type: string;
}
```

### Verification

- Add a memory with `eventDate` in 30 minutes → notification created
- Wait 15 minutes (or trigger manually) → proactivity scan runs
- Wake-listener receives TTS notification via polling
- Stale goals (no progress in 7d) trigger a nudge

---

## 4.5 — Plugin System

**Feasibility:** 85% | **Effort:** L

### Problem

Adding new capabilities (weather, calendar, home automation) requires modifying core code. No standard extension mechanism.

### Plugin Interface

**Create:** `jarvis/src/plugins/plugin.interface.ts`

```typescript
export interface JarvisPlugin {
  /** Unique plugin identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /** Intents this plugin can handle */
  supportedIntents: IntentType[];

  /** Process an intent and return a result */
  handle(intent: IntentResult, context: AgentContext): Promise<PluginResponse>;

  /** Called on module init — setup resources */
  initialize?(): Promise<void>;

  /** Called on module destroy — cleanup */
  destroy?(): Promise<void>;
}

export interface PluginResponse {
  answer: string;
  actions?: AgentAction[];
  data?: Record<string, unknown>;
}
```

**Create:** `jarvis/src/plugins/plugin-registry.service.ts`

```typescript
@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly plugins = new Map<string, JarvisPlugin>();
  private readonly intentMap = new Map<IntentType, JarvisPlugin>();
  private readonly logger = new Logger(PluginRegistryService.name);

  async onModuleInit() {
    for (const [name, plugin] of this.plugins) {
      await plugin.initialize?.();
      for (const intent of plugin.supportedIntents) {
        this.intentMap.set(intent, plugin);
      }
      this.logger.log(
        `Plugin registered: ${name} (${plugin.supportedIntents.join(", ")})`,
      );
    }
  }

  register(plugin: JarvisPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  getPluginForIntent(intent: IntentType): JarvisPlugin | undefined {
    return this.intentMap.get(intent);
  }

  listPlugins(): Array<{
    name: string;
    description: string;
    intents: IntentType[];
  }> {
    return [...this.plugins.values()].map((p) => ({
      name: p.name,
      description: p.description,
      intents: p.supportedIntents,
    }));
  }
}
```

### Example Plugins

**Create:** `jarvis/src/plugins/weather/weather.plugin.ts`

```typescript
@Injectable()
export class WeatherPlugin implements JarvisPlugin {
  name = "weather";
  description = "Local weather via wttr.in";
  supportedIntents = [IntentType.EXECUTE_ACTION]; // or a new WEATHER intent

  async handle(intent: IntentResult): Promise<PluginResponse> {
    const location = intent.entities.location ?? "Brussels";
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
    );
    const data = await response.json();

    const current = data.current_condition[0];
    const temp = current.temp_C;
    const desc = current.lang_fr?.[0]?.value ?? current.weatherDesc[0].value;

    return {
      answer: `A ${location}, il fait ${temp}°C. ${desc}.`,
      data: { temperature: temp, description: desc },
    };
  }
}
```

**Create:** `jarvis/src/plugins/calendar/calendar.plugin.ts`

```typescript
@Injectable()
export class CalendarPlugin implements JarvisPlugin {
  name = "calendar";
  description = "Read/write local iCal files";
  supportedIntents = [IntentType.SCHEDULE_EVENT, IntentType.QUERY_SCHEDULE];

  async handle(intent: IntentResult): Promise<PluginResponse> {
    // Read/write .ics files from a configured directory
    // Parse iCal format, return events as natural language
  }
}
```

### Integration with IntentRouter

**Modify:** `jarvis/src/agent/router/intent-router.service.ts`

```typescript
constructor(
  // ... existing
  private pluginRegistry: PluginRegistryService,
) {}

async route(intent: IntentResult, context: AgentContext): Promise<EngineResult> {
  // Check plugins first
  const plugin = this.pluginRegistry.getPluginForIntent(intent.primary);
  if (plugin) {
    const result = await plugin.handle(intent, context);
    return { answer: result.answer, actions: result.actions };
  }

  // ... existing switch cases
}
```

### Verification

- Weather plugin: "Quel temps fait-il a Paris ?" → returns temperature from wttr.in
- Plugin list: `GET /agent/plugins` → lists registered plugins
- New plugin can be added without modifying core router code

---

## Implementation Order

```text
4.3 Identity Mode (needs 1.4, independent — quick win)
  |
  v
4.1 Action Engine (needs 2.2 Agent Module)
  |
  +--> 4.2 Goals Tracking (parallel with 4.1, needs 2.2)
  |
  v
4.4 Proactivity (needs 4.1 + 3.1 Importance Scoring)
  |
  v
4.5 Plugin System (needs 2.2, can be parallel with 4.4)
```

Recommended: start with 4.3 (Identity, quick win), then 4.1 (Action Engine) and 4.2 (Goals) in parallel, then 4.4 (Proactivity), finally 4.5 (Plugins).

---

## Files Summary

### Files to Create

| File                                             | Step |
| ------------------------------------------------ | ---- |
| `jarvis/identity.json`                           | 4.3  |
| `jarvis/src/agent/identity/identity.service.ts`  | 4.3  |
| `jarvis/src/action/action.module.ts`             | 4.1  |
| `jarvis/src/action/action.service.ts`            | 4.1  |
| `jarvis/src/action/action.controller.ts`         | 4.1  |
| `jarvis/src/action/action-db.service.ts`         | 4.1  |
| `jarvis/src/action/action.types.ts`              | 4.1  |
| `jarvis/src/action/reminder.service.ts`          | 4.1  |
| `jarvis/src/action/todo.service.ts`              | 4.1  |
| `jarvis/src/action/notification.service.ts`      | 4.1  |
| `jarvis/src/action/proactivity.service.ts`       | 4.4  |
| `jarvis/src/goals/goals.module.ts`               | 4.2  |
| `jarvis/src/goals/goals.service.ts`              | 4.2  |
| `jarvis/src/goals/goals.controller.ts`           | 4.2  |
| `jarvis/src/goals/goals.types.ts`                | 4.2  |
| `jarvis/src/plugins/plugin.interface.ts`         | 4.5  |
| `jarvis/src/plugins/plugin-registry.service.ts`  | 4.5  |
| `jarvis/src/plugins/weather/weather.plugin.ts`   | 4.5  |
| `jarvis/src/plugins/calendar/calendar.plugin.ts` | 4.5  |
| `wake-listener/notification_poller.py`           | 4.1  |

### Files to Modify

| File                                               | Steps         |
| -------------------------------------------------- | ------------- |
| `jarvis/src/app.module.ts`                         | 4.1, 4.2, 4.5 |
| `jarvis/src/agent/agent.service.ts`                | 4.3           |
| `jarvis/src/agent/router/intent-router.service.ts` | 4.1, 4.2, 4.5 |
| `jarvis/src/memory/memory.service.ts`              | 4.3           |
| `jarvis/src/vectorstore/vectorstore.service.ts`    | 4.2           |
| `jarvis/.env`                                      | 4.2           |
| `wake-listener/wake_listener.py`                   | 4.1           |

### Dependencies to Install

```bash
cd jarvis && npm install better-sqlite3 @types/better-sqlite3
```
