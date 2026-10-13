import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  PortalError,
  WorkflowInputSchema,
  parse,
  type Workflow,
  type StoredRun,
  type RunEvent,
  ActivitySchema,
  ActivityDraftSchema,
  ActivityQuerySchema,
  type Activity,
  type ActivityDraft,
} from './contract.js';

interface Database {
  version: 2;
  workflows: Workflow[];
  runs: StoredRun[];
  activities: Activity[];
  nextActivitySequence: number;
  activityUnrecordedCount: number;
}
export const ACTIVITY_CAPACITY = 2000;
export class PortalStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly activitySessionId = randomUUID();
  private activityFailure: string | null = null;
  private unpersistedActivityGaps = 0;
  private constructor(
    readonly directory: string,
    private data: Database,
  ) {}
  static async open(directory: string): Promise<PortalStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let data: Database = {
      version: 2,
      workflows: [],
      runs: [],
      activities: [],
      nextActivitySequence: 1,
      activityUnrecordedCount: 0,
    };
    try {
      const bytes = await readFile(join(directory, 'portal.json'));
      if (bytes.length > 32 * 1024 * 1024)
        throw new PortalError('STORE_LIMIT', 'The portal store exceeds its configured limit.', 500);
      const loaded = JSON.parse(bytes.toString());
      if (![1, 2].includes(loaded.version)) throw new Error('Invalid store version');
      data =
        loaded.version === 1
          ? {
              ...loaded,
              version: 2,
              activities: [],
              nextActivitySequence: 1,
              activityUnrecordedCount: 0,
            }
          : (loaded as Database);
      if (
        data.version !== 2 ||
        !Array.isArray(data.workflows) ||
        !Array.isArray(data.runs) ||
        data.workflows.length > 100 ||
        data.runs.length > 200
      )
        throw new Error('Invalid store');
      if (
        !Array.isArray(data.activities) ||
        data.activities.length > ACTIVITY_CAPACITY ||
        !Number.isSafeInteger(data.nextActivitySequence) ||
        data.nextActivitySequence < 1 ||
        !Number.isSafeInteger(data.activityUnrecordedCount) ||
        data.activityUnrecordedCount < 0
      )
        throw new Error('Invalid activity history');
      data.activities = data.activities.map(row => parse(ActivitySchema, row));
      if (
        new Set(data.activities.map(row => row.id)).size !== data.activities.length ||
        new Set(data.activities.map(row => row.sequence)).size !== data.activities.length ||
        data.activities.some(row => row.sequence >= data.nextActivitySequence)
      )
        throw new Error('Invalid activity sequence');
      for (const workflow of data.workflows) {
        const {
          id: _id,
          revision: _revision,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...input
        } = workflow;
        parse(WorkflowInputSchema, input);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new PortalError(
          'STORE_INVALID',
          'The portal store cannot be read safely. Preserve the file for inspection.',
          500,
        );
    }
    return new PortalStore(directory, data);
  }
  /* eslint-disable promise/no-callback-in-promise -- serialize an atomic store transaction before publication */
  private write<T>(change: (data: Database) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const gaps = this.unpersistedActivityGaps;
      const next = structuredClone(this.data),
        result = change(next);
      next.activityUnrecordedCount += gaps;
      const bytes = JSON.stringify(next);
      if (Buffer.byteLength(bytes) > 32 * 1024 * 1024)
        throw new PortalError(
          'STORE_LIMIT',
          'The portal history has reached its storage limit.',
          409,
        );
      const temporary = join(this.directory, `portal-${randomUUID()}.tmp`);
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(this.directory, 'portal.json'));
      this.data = next;
      this.unpersistedActivityGaps -= gaps;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  /* eslint-enable promise/no-callback-in-promise */
  activityHealth() {
    const count = this.data.activities.length;
    const unrecordedCount = this.data.activityUnrecordedCount + this.unpersistedActivityGaps;
    return {
      available: count < ACTIVITY_CAPACITY && this.activityFailure === null,
      complete: unrecordedCount === 0 && this.activityFailure !== 'ACTIVITY_WRITE_FAILED',
      errorCode: this.activityFailure ?? (count >= ACTIVITY_CAPACITY ? 'ACTIVITY_CAPACITY' : null),
      unrecordedCount,
    };
  }
  listActivities(input: unknown = {}) {
    const query = parse(ActivityQuerySchema, input);
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
      throw new PortalError('INVALID_REQUEST', 'Invalid activity date range.');
    const all = this.data.activities.toSorted((a, b) => a.sequence - b.sequence);
    const rows = all.filter(
      row =>
        row.sequence > query.after &&
        (!query.type || row.type === query.type) &&
        (!query.source || row.source === query.source) &&
        (!query.status || row.status === query.status) &&
        (!query.workflowId || row.workflowId === query.workflowId) &&
        (!query.runId || row.runId === query.runId) &&
        (!query.from || Date.parse(row.at) >= Date.parse(query.from)) &&
        (!query.to || Date.parse(row.at) <= Date.parse(query.to)),
    );
    const activities = rows.slice(0, query.limit);
    return structuredClone({
      activities,
      nextCursor: activities.at(-1)?.sequence ?? this.data.nextActivitySequence - 1,
      hasMore: rows.length > query.limit,
      retention: {
        capacity: ACTIVITY_CAPACITY,
        count: all.length,
        remaining: ACTIVITY_CAPACITY - all.length,
        full: all.length >= ACTIVITY_CAPACITY,
        oldestSequence: all[0]?.sequence ?? 0,
        newestSequence: this.data.nextActivitySequence - 1,
      },
      audit: this.activityHealth(),
    });
  }
  async recordActivity(input: ActivityDraft): Promise<Activity> {
    try {
      const draft = parse(ActivityDraftSchema, input);
      const activity = await this.write(data => {
        if (draft.type === 'request.rejected' && draft.actor === 'unverified-request') {
          const existing = data.activities.find(
            row =>
              row.type === draft.type &&
              row.actor === draft.actor &&
              row.metadata.errorCode === draft.metadata.errorCode &&
              row.metadata.route === draft.metadata.route &&
              row.metadata.method === draft.metadata.method,
          );
          if (existing) {
            Object.assign(existing, {
              sequence: data.nextActivitySequence++,
              updatedAt: new Date().toISOString(),
              requestId: draft.requestId,
              sessionId: draft.sessionId,
              metadata: {
                ...existing.metadata,
                rejectionCount: (existing.metadata.rejectionCount ?? 1) + 1,
              },
            });
            return parse(ActivitySchema, existing);
          }
        }
        if (data.activities.length >= ACTIVITY_CAPACITY) {
          data.activityUnrecordedCount++;
          return null;
        }
        const at = new Date().toISOString();
        const row = parse(ActivitySchema, {
          ...draft,
          id: randomUUID(),
          sequence: data.nextActivitySequence++,
          at,
          updatedAt: at,
        });
        data.activities.push(row);
        return row;
      });
      if (activity === null) {
        this.activityFailure = 'ACTIVITY_CAPACITY';
        throw new PortalError('ACTIVITY_CAPACITY', 'Activity capacity reached.', 409);
      }
      this.activityFailure = null;
      return activity;
    } catch (error) {
      if (error instanceof PortalError && error.code === 'ACTIVITY_CAPACITY') throw error;
      this.activityFailure = 'ACTIVITY_WRITE_FAILED';
      this.unpersistedActivityGaps++;
      throw new PortalError('ACTIVITY_WRITE_FAILED', 'Activity could not be persisted.', 503);
    }
  }
  async settleActivity(
    id: string,
    status: 'succeeded' | 'failed' | 'unknown',
    patch: Partial<Pick<ActivityDraft, 'workflowId' | 'runId' | 'workspaceId' | 'metadata'>> = {},
  ): Promise<Activity> {
    try {
      return await this.write(data => {
        const index = data.activities.findIndex(row => row.id === id);
        const row = data.activities[index];
        if (!row || row.source !== 'server' || row.status !== 'started')
          throw new Error('Activity no longer pending');
        const settled = parse(ActivitySchema, {
          ...row,
          ...patch,
          metadata: { ...row.metadata, ...patch.metadata },
          status,
          sequence: data.nextActivitySequence++,
          updatedAt: new Date().toISOString(),
        });
        data.activities[index] = settled;
        return settled;
      });
    } catch {
      this.activityFailure = 'ACTIVITY_WRITE_FAILED';
      this.unpersistedActivityGaps++;
      throw new PortalError(
        'ACTIVITY_WRITE_FAILED',
        'The effect outcome could not be recorded. Inspect existing state before retrying.',
        503,
      );
    }
  }
  async observeActivity(
    input: Omit<ActivityDraft, 'source' | 'status' | 'actor' | 'sessionId' | 'requestId'> & {
      source?: 'server' | 'service';
    },
  ): Promise<void> {
    try {
      await this.recordActivity({
        ...input,
        source: input.source ?? 'service',
        status: 'observed',
        actor: 'local-owner',
        sessionId: this.activitySessionId,
        requestId: randomUUID(),
      });
    } catch {
      // Observation/cleanup must still settle. The visible audit health retains the missing record.
    }
  }
  listWorkflows(): Workflow[] {
    return structuredClone(this.data.workflows);
  }
  getWorkflow(id: string): Workflow {
    const row = this.data.workflows.find(w => w.id === id);
    if (!row) throw new PortalError('WORKFLOW_NOT_FOUND', 'The workflow was not found.', 404);
    return structuredClone(row);
  }
  async createWorkflow(input: unknown): Promise<Workflow> {
    const value = parse(WorkflowInputSchema, input);
    return this.write(data => {
      if (data.workflows.length >= 100)
        throw new PortalError('WORKFLOW_LIMIT', 'The workflow limit was reached.', 409);
      const at = new Date().toISOString(),
        row = { ...value, id: randomUUID(), revision: 1, createdAt: at, updatedAt: at };
      data.workflows.push(row);
      return row;
    });
  }
  async updateWorkflow(id: string, revision: number, input: unknown): Promise<Workflow> {
    const value = parse(WorkflowInputSchema, input);
    return this.write(data => {
      const row = data.workflows.find(w => w.id === id);
      if (!row) throw new PortalError('WORKFLOW_NOT_FOUND', 'The workflow was not found.', 404);
      if (row.revision !== revision)
        throw new PortalError(
          'REVISION_CONFLICT',
          'The workflow changed. Reload it before saving.',
          409,
        );
      Object.assign(row, value, { revision: revision + 1, updatedAt: new Date().toISOString() });
      return row;
    });
  }
  listRuns(): StoredRun[] {
    return structuredClone(this.data.runs);
  }
  getRun(id: string): StoredRun {
    const row = this.data.runs.find(r => r.id === id);
    if (!row) throw new PortalError('RUN_NOT_FOUND', 'The run was not found.', 404);
    return structuredClone(row);
  }
  async createRun(run: StoredRun): Promise<void> {
    await this.write(data => {
      if (data.runs.length >= 200)
        throw new PortalError(
          'RUN_LIMIT',
          'The retained run limit was reached. Preserve and rotate the portal store before starting more runs.',
          409,
        );
      data.runs.unshift(run);
    });
  }
  async updateRun(id: string, change: (run: StoredRun) => void): Promise<StoredRun> {
    return this.write(data => {
      const run = data.runs.find(r => r.id === id);
      if (!run) throw new PortalError('RUN_NOT_FOUND', 'The run was not found.', 404);
      change(run);
      run.updatedAt = new Date().toISOString();
      return run;
    });
  }
  async event(id: string, type: string, message: string, data: unknown = null): Promise<void> {
    await this.updateRun(id, run => {
      const event: RunEvent = {
        sequence: run.nextSequence++,
        at: new Date().toISOString(),
        type,
        message,
        data,
      };
      run.events.push(event);
      run.events = run.events.slice(-500);
    });
  }
  async recoverInterrupted(): Promise<void> {
    await this.write(data => {
      for (const activity of data.activities)
        if (activity.source === 'server' && activity.status === 'started') {
          activity.status = 'unknown';
          activity.metadata.errorCode = 'PORTAL_SERVER_RESTARTED';
          activity.sequence = data.nextActivitySequence++;
          activity.updatedAt = new Date().toISOString();
        }
      for (const run of data.runs)
        if (['queued', 'active', 'awaiting-approval'].includes(run.status)) {
          run.status = 'unknown';
          if (!run.unresolvedOperation)
            run.unresolvedOperation = { id: run.operationId, name: null };
          if (run.unresolvedOperation) run.operationId = run.unresolvedOperation.id;
          run.updatedAt = new Date().toISOString();
          run.approvals = [];
          run.error = {
            code: 'PORTAL_SERVER_RESTARTED',
            message:
              'The web server restarted during an operation. Inspect service status; effects were not replayed.',
          };
          for (const node of run.nodes)
            if (node.status === 'active' || node.status === 'waiting') {
              node.status = 'unknown';
              node.message = 'The web server restarted before this stage was resolved.';
            }
        }
    });
  }
}
