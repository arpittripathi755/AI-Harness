import type * as vscode from "vscode";
import type { ChatMessage } from "../llm/types";
import type { ChatSummary, UiTimelineItem } from "../shared/protocol";

/** A persisted conversation: its UI timeline plus the LLM message history. */
export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  /** What the webview renders (messages + tool cards). */
  timeline: UiTimelineItem[];
  /** LLM history excluding the system prompt (used to reseed a ChatSession). */
  history: ChatMessage[];
}

const STORAGE_KEY = "axiom.conversations.v1";
const ACTIVE_KEY = "axiom.activeConversation.v1";
const MAX_TITLE = 48;

/**
 * Owns the set of conversations and persists them to workspaceState so separate
 * chats survive reloads and restarts. Pure data — the provider owns the live
 * ChatSession and reseeds it from a record's history when switching chats.
 */
export class ConversationManager {
  private records: ConversationRecord[] = [];
  private activeId: string | undefined;
  private seq = 0;

  constructor(private readonly memento: vscode.Memento) {
    this.load();
  }

  private load(): void {
    try {
      const stored = this.memento.get<ConversationRecord[]>(STORAGE_KEY);
      if (Array.isArray(stored)) {
        this.records = stored;
      }
      this.activeId = this.memento.get<string>(ACTIVE_KEY);
    } catch {
      this.records = [];
    }
    if (this.records.length === 0) {
      this.create();
    } else if (!this.records.some((r) => r.id === this.activeId)) {
      this.activeId = this.records[0].id;
    }
  }

  private persist(): void {
    // Never let a persistence failure break the chat.
    void this.memento.update(STORAGE_KEY, this.records);
    void this.memento.update(ACTIVE_KEY, this.activeId);
  }

  private nextId(): string {
    this.seq += 1;
    // Avoid Date.now()/Math.random collisions across quick creates.
    return `c${this.seq}-${this.records.length}-${this.seq * 2654435761}`;
  }

  /** Create a new empty conversation and make it active. */
  create(): ConversationRecord {
    const record: ConversationRecord = {
      id: this.nextId(),
      title: "New Chat",
      createdAt: this.records.length, // monotonic ordering without Date.now()
      timeline: [],
      history: [],
    };
    this.records.unshift(record);
    this.activeId = record.id;
    this.persist();
    return record;
  }

  delete(id: string): void {
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length === 0) {
      this.create();
      return;
    }
    if (this.activeId === id) {
      this.activeId = this.records[0].id;
    }
    this.persist();
  }

  setActive(id: string): void {
    if (this.records.some((r) => r.id === id)) {
      this.activeId = id;
      this.persist();
    }
  }

  get active(): ConversationRecord {
    const found = this.records.find((r) => r.id === this.activeId);
    if (found) {
      return found;
    }
    // Should not happen, but guarantee a record.
    return this.records[0] ?? this.create();
  }

  get activeConversationId(): string | undefined {
    return this.activeId;
  }

  summaries(): ChatSummary[] {
    return this.records.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
    }));
  }

  /** Persist the current in-memory records (call after mutating a timeline/history). */
  save(): void {
    this.persist();
  }

  /** Set the active chat's title from its first user message, if still default. */
  maybeTitleFrom(text: string): void {
    const rec = this.active;
    if (rec.title === "New Chat" || rec.title === "") {
      const clean = text.trim().replace(/\s+/g, " ");
      rec.title = clean.length > MAX_TITLE ? clean.slice(0, MAX_TITLE) + "…" : clean;
      this.persist();
    }
  }
}
