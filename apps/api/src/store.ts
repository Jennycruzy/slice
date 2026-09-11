import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { BookSnapshot, ChildOrder, ExecutionMetrics, ExecutionRequest, ExecutionState, ExitRule, Fill, Receipt, SessionGrant } from "@slice/core";

export interface ExecutionRecord {
  id: string;
  request: ExecutionRequest;
  snapshot: BookSnapshot;
  state: ExecutionState;
  children: ChildOrder[];
  fills: Fill[];
  metrics: ExecutionMetrics | null;
  exitRule: ExitRule | null;
  completionMidPrice: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  cancelRequested: boolean;
  heartbeatAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface ExecutionRow extends QueryResultRow {
  id: string;
  request: ExecutionRequest;
  snapshot: BookSnapshot;
  state: ExecutionState;
  children: ChildOrder[];
  fills: Fill[];
  metrics: ExecutionMetrics | null;
  exit_rule: ExitRule | null;
  completion_mid_price: string | null;
  failure_code: string | null;
  failure_message: string | null;
  cancel_requested: boolean;
  heartbeat_at: Date;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface GrantRecord extends SessionGrant {
  digest: `0x${string}`;
  revokedAt: string | null;
}

export class PostgresStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS slice_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        request JSONB NOT NULL,
        snapshot JSONB NOT NULL,
        state TEXT NOT NULL,
        children JSONB NOT NULL DEFAULT '[]'::jsonb,
        fills JSONB NOT NULL DEFAULT '[]'::jsonb,
        metrics JSONB,
        exit_rule JSONB,
        completion_mid_price NUMERIC,
        failure_code TEXT,
        failure_message TEXT,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        heartbeat_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      );
      ALTER TABLE executions ADD COLUMN IF NOT EXISTS exit_rule JSONB;
      CREATE INDEX IF NOT EXISTS executions_owner_created_idx ON executions ((request->>'owner'), created_at DESC);
      CREATE TABLE IF NOT EXISTS session_grants (
        grant_id TEXT PRIMARY KEY,
        digest TEXT UNIQUE NOT NULL,
        grant_payload JSONB NOT NULL,
        consumed_contracts NUMERIC NOT NULL DEFAULT 0,
        revoked_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        execution_id TEXT UNIQUE NOT NULL REFERENCES executions(id),
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS receipts_created_idx ON receipts (created_at DESC);
      INSERT INTO slice_schema_migrations (version) VALUES ('001-durable-json-execution-store') ON CONFLICT (version) DO NOTHING;
    `);
  }

  async createExecution(id: string, request: ExecutionRequest, snapshot: BookSnapshot): Promise<ExecutionRecord> {
    const now = new Date();
    const result = await this.pool.query<ExecutionRow>(
      `INSERT INTO executions (id, request, snapshot, state, heartbeat_at, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, 'running', $4, $4, $4)
       RETURNING *`,
      [id, JSON.stringify(request), JSON.stringify(snapshot), now],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Execution ${id} was not created`);
    return this.toExecution(row);
  }

  async getExecution(id: string): Promise<ExecutionRecord | null> {
    const result = await this.pool.query<ExecutionRow>(`SELECT * FROM executions WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : this.toExecution(row);
  }

  async replaceRequest(id: string, request: ExecutionRequest): Promise<void> {
    const result = await this.pool.query(`UPDATE executions SET request = $2::jsonb, updated_at = $3, heartbeat_at = $3 WHERE id = $1`, [id, JSON.stringify(request), new Date()]);
    if (result.rowCount !== 1) throw new Error(`Execution ${id} no longer exists`);
  }

  async listActiveExecutions(): Promise<ExecutionRecord[]> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT * FROM executions WHERE state IN ('running', 'reconnecting', 'paused', 'awaiting_authorization') ORDER BY created_at ASC`,
    );
    return result.rows.map((row) => this.toExecution(row));
  }

  async appendChild(id: string, child: ChildOrder): Promise<void> {
    await this.pool.query(
      `UPDATE executions SET children = children || $2::jsonb, updated_at = $3, heartbeat_at = $3 WHERE id = $1`,
      [id, JSON.stringify([child]), new Date()],
    );
  }

  async replaceChild(id: string, child: ChildOrder): Promise<void> {
    const execution = await this.getExecution(id);
    if (execution === null) throw new Error(`Execution ${id} no longer exists`);
    const children = execution.children.map((existing) => existing.id === child.id ? child : existing);
    await this.pool.query(
      `UPDATE executions SET children = $2::jsonb, updated_at = $3, heartbeat_at = $3 WHERE id = $1`,
      [id, JSON.stringify(children), new Date()],
    );
  }

  async appendFills(id: string, fills: Fill[]): Promise<void> {
    if (fills.length === 0) return;
    await this.pool.query(
      `UPDATE executions SET fills = fills || $2::jsonb, updated_at = $3, heartbeat_at = $3 WHERE id = $1`,
      [id, JSON.stringify(fills), new Date()],
    );
  }

  async setState(id: string, state: ExecutionState, details: { metrics?: ExecutionMetrics | null; completionMidPrice?: string | null; failureCode?: string | null; failureMessage?: string | null } = {}): Promise<void> {
    const now = new Date();
    const completed = ["completed", "partial", "cancelled", "failed"].includes(state) ? now : null;
    await this.pool.query(
      `UPDATE executions
       SET state = $2, metrics = COALESCE($3::jsonb, metrics), completion_mid_price = COALESCE($4, completion_mid_price),
           failure_code = $5, failure_message = $6, completed_at = COALESCE($7, completed_at), updated_at = $8, heartbeat_at = $8
       WHERE id = $1`,
      [id, state, details.metrics === undefined ? null : JSON.stringify(details.metrics), details.completionMidPrice ?? null, details.failureCode ?? null, details.failureMessage ?? null, completed, now],
    );
  }

  async heartbeat(id: string): Promise<void> {
    await this.pool.query(`UPDATE executions SET heartbeat_at = $2, updated_at = $2 WHERE id = $1`, [id, new Date()]);
  }

  async setExitRule(id: string, rule: ExitRule): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date();
      const result = await client.query<ExecutionRow>(
        `UPDATE executions SET exit_rule = $2::jsonb, updated_at = $3, heartbeat_at = $3 WHERE id = $1 RETURNING *`,
        [id, JSON.stringify(rule), now],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error(`Execution ${id} no longer exists`);
      const receiptResult = await client.query<QueryResultRow & { payload: Receipt }>(`SELECT payload FROM receipts WHERE execution_id = $1 FOR UPDATE`, [id]);
      const receipt = receiptResult.rows[0]?.payload;
      if (receipt !== undefined) {
        await client.query(`UPDATE receipts SET payload = $2::jsonb WHERE execution_id = $1`, [id, JSON.stringify({ ...receipt, exitRule: rule })]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requestCancel(id: string): Promise<void> {
    await this.pool.query(`UPDATE executions SET cancel_requested = TRUE, updated_at = $2 WHERE id = $1`, [id, new Date()]);
  }

  async saveGrant(grant: GrantRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_grants (grant_id, digest, grant_payload) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (grant_id) DO UPDATE SET grant_payload = EXCLUDED.grant_payload, digest = EXCLUDED.digest`,
      [grant.grantId, grant.digest, JSON.stringify(grant)],
    );
  }

  async setGrantDigest(grantId: string, digest: string): Promise<void> {
    await this.pool.query(`UPDATE session_grants SET digest = $2 WHERE grant_id = $1`, [grantId, digest]);
  }

  async reserveGrant(grantId: string, quantity: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE session_grants
       SET consumed_contracts = consumed_contracts + $2::numeric
       WHERE grant_id = $1
         AND consumed_contracts + $2::numeric <= (grant_payload->>'maxContracts')::numeric
       RETURNING grant_id`,
      [grantId, quantity],
    );
    if (result.rowCount !== 1) throw new Error("Order exceeds the remaining session contract cap");
  }

  async getGrant(grantId: string): Promise<GrantRecord | null> {
    const result = await this.pool.query<QueryResultRow & { grant_payload: GrantRecord; revoked_at: Date | null }>(`SELECT grant_payload, revoked_at FROM session_grants WHERE grant_id = $1`, [grantId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    return { ...row.grant_payload, revokedAt: row.revoked_at?.toISOString() ?? null };
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO receipts (id, execution_id, payload, created_at) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (execution_id) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [receipt.id, receipt.executionId, JSON.stringify(receipt), new Date(receipt.completedAt)],
    );
  }

  async completeExecution(
    id: string,
    state: Extract<ExecutionState, "completed" | "partial" | "cancelled" | "failed">,
    details: { metrics: ExecutionMetrics; completionMidPrice: string | null; failureCode?: string | null; failureMessage?: string | null },
  ): Promise<{ execution: ExecutionRecord; receipt: Receipt | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date();
      const completedAt = now;
      const updated = await client.query<ExecutionRow>(
        `UPDATE executions
         SET state = $2, metrics = $3::jsonb, completion_mid_price = $4,
             failure_code = $5, failure_message = $6, completed_at = $7, updated_at = $8, heartbeat_at = $8
         WHERE id = $1
         RETURNING *`,
        [id, state, JSON.stringify(details.metrics), details.completionMidPrice, details.failureCode ?? null, details.failureMessage ?? null, completedAt, now],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error(`Execution ${id} no longer exists`);
      const execution = this.toExecution(row);
      let receipt: Receipt | null = null;
      if (execution.completedAt !== null && execution.metrics !== null && (state !== "failed" || execution.fills.length > 0)) {
        const existing = await client.query<QueryResultRow & { payload: Receipt }>(`SELECT payload FROM receipts WHERE execution_id = $1 FOR UPDATE`, [id]);
        const receiptId = existing.rows[0]?.payload.id ?? randomUUID();
        receipt = this.receiptFromExecution(execution, receiptId);
        await client.query(
          `INSERT INTO receipts (id, execution_id, payload, created_at) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (execution_id) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
          [receipt.id, receipt.executionId, JSON.stringify(receipt), new Date(receipt.completedAt)],
        );
      }
      await client.query("COMMIT");
      return { execution, receipt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async repairMissingReceipts(): Promise<number> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT e.*
       FROM executions e
       LEFT JOIN receipts r ON r.execution_id = e.id
       WHERE e.state IN ('completed', 'partial', 'cancelled', 'failed')
         AND e.completed_at IS NOT NULL
         AND e.metrics IS NOT NULL
         AND jsonb_array_length(e.fills) > 0
         AND r.id IS NULL
       ORDER BY e.completed_at ASC`,
    );
    for (const row of result.rows) {
      const execution = this.toExecution(row);
      await this.saveReceipt(this.receiptFromExecution(execution, randomUUID()));
    }
    return result.rows.length;
  }

  async getReceipt(id: string): Promise<Receipt | null> {
    const result = await this.pool.query<QueryResultRow & { payload: Receipt }>(`SELECT payload FROM receipts WHERE id = $1`, [id]);
    return result.rows[0]?.payload ?? null;
  }

  async getReceiptForExecution(executionId: string): Promise<Receipt | null> {
    const result = await this.pool.query<QueryResultRow & { payload: Receipt }>(`SELECT payload FROM receipts WHERE execution_id = $1`, [executionId]);
    return result.rows[0]?.payload ?? null;
  }

  private toExecution(row: ExecutionRow): ExecutionRecord {
    return {
      id: row.id,
      request: row.request,
      snapshot: row.snapshot,
      state: row.state,
      children: row.children,
      fills: row.fills,
      metrics: row.metrics,
      exitRule: row.exit_rule,
      completionMidPrice: row.completion_mid_price,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      cancelRequested: row.cancel_requested,
      heartbeatAt: row.heartbeat_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  private receiptFromExecution(execution: ExecutionRecord, id: string): Receipt {
    if (execution.completedAt === null || execution.metrics === null) throw new Error(`Execution ${execution.id} is not complete enough to create a receipt`);
    return {
      id,
      executionId: execution.id,
      marketId: execution.request.marketId,
      marketName: execution.request.marketName,
      symbol: execution.request.symbol,
      side: execution.request.side,
      strategy: execution.request.strategy,
      status: execution.state === "completed" ? "completed" : execution.state === "cancelled" ? "cancelled" : "partial",
      createdAt: execution.createdAt,
      completedAt: execution.completedAt,
      snapshot: execution.snapshot,
      childOrders: execution.children,
      fills: execution.fills,
      metrics: execution.metrics,
      exitRule: execution.exitRule,
    };
  }
}
