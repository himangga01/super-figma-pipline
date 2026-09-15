import { join, resolve } from 'node:path';

import { z } from 'zod';

import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
} from '../../mcp/src/fs/atomic-file.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import { recipeCanonical, recipeError, recipeHash, type ExecutableRecipe } from './recipe-plan.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const RecipeStepIntentSchema = z
  .object({
    version: z.literal(1),
    planHash: hash,
    stepId: z.string().min(1).max(256),
    operationName: z.enum([
      'get_node',
      'create_frame',
      'clone_node',
      'rename_node',
      'set_position',
      'get_variable_defs',
      'create_variable_collection',
      'add_variable_mode',
      'create_variable',
    ]),
    operationId: z.string().regex(/^sfp_op1_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u),
    argsHash: hash,
    args: z.record(z.string(), z.unknown()),
    resultSchemaHash: hash,
  })
  .strict();
export type RecipeStepIntent = z.infer<typeof RecipeStepIntentSchema>;
/** Immutable, exclusive local claims. These records never substitute for server operation evidence. */
export class RecipeCheckpointStore {
  private readonly root: string;
  constructor(
    root: string,
    private readonly atomic = new AtomicFileStore(),
  ) {
    this.root = resolve(root);
  }
  private directory(plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>): string {
    return join(
      this.root,
      recipeHash({ intentId: plan.intentId, actorId: plan.authority.actorId }).slice(7),
    );
  }
  private async read(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    name: string,
  ): Promise<unknown | null> {
    return withRetainedDirectoryChain(
      this.root,
      this.directory(plan),
      async authority => {
        try {
          const value: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await readFileWithinLimit(authority.child(name), 524288),
            ),
          );
          if (!isBoundedDesignJson(value, 524288, 30000))
            throw recipeError('RECIPE_CHECKPOINT_LIMIT');
          return value;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      { createMissing: true },
    );
  }
  private async create(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    name: string,
    value: unknown,
  ): Promise<boolean> {
    const bytes = Buffer.from(recipeCanonical(value));
    if (bytes.length > 524288) throw recipeError('RECIPE_CHECKPOINT_LIMIT');
    return withRetainedDirectoryChain(
      this.root,
      this.directory(plan),
      async authority => {
        try {
          await this.atomic.createNew(authority.child(name), bytes);
          return true;
        } catch (error) {
          if ((error as { code?: string }).code === 'TARGET_ALREADY_EXISTS') return false;
          throw error;
        }
      },
      { createMissing: true },
    );
  }
  async initialize(plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>): Promise<void> {
    const expected = { version: 1, planHash: recipeHash(plan), plan };
    await this.create(plan, 'intent.json', expected);
    if (recipeCanonical(await this.read(plan, 'intent.json')) !== recipeCanonical(expected))
      throw recipeError('RECIPE_INTENT_CHANGED');
  }
  private index(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= 128)
      throw recipeError('RECIPE_STEP_INDEX_INVALID');
    return index;
  }
  async intent(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    index: number,
  ): Promise<RecipeStepIntent | null> {
    const row = await this.read(plan, `${this.index(index)}.intent.json`);
    return row === null ? null : RecipeStepIntentSchema.parse(row);
  }
  async claim(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    index: number,
    intent: RecipeStepIntent,
  ): Promise<boolean> {
    return this.create(
      plan,
      `${this.index(index)}.intent.json`,
      RecipeStepIntentSchema.parse(intent),
    );
  }
  async settled(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    index: number,
    intent: RecipeStepIntent,
    receiptHash: string,
  ): Promise<void> {
    const expected = { intentHash: recipeHash(intent), receiptHash: hash.parse(receiptHash) };
    await this.create(plan, `${this.index(index)}.settled.json`, expected);
    if (
      recipeCanonical(await this.read(plan, `${this.index(index)}.settled.json`)) !==
      recipeCanonical(expected)
    )
      throw recipeError('RECIPE_CHECKPOINT_CHANGED');
  }
  async postIntent(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    index: number,
  ): Promise<RecipeStepIntent | null> {
    const row = await this.read(plan, `post-${this.index(index)}.intent.json`);
    return row === null ? null : RecipeStepIntentSchema.parse(row);
  }
  async claimPost(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    index: number,
    intent: RecipeStepIntent,
  ): Promise<boolean> {
    return this.create(
      plan,
      `post-${this.index(index)}.intent.json`,
      RecipeStepIntentSchema.parse(intent),
    );
  }
  async freshObservation(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    createIntent: (stepId: string) => Promise<RecipeStepIntent>,
  ): Promise<RecipeStepIntent> {
    // Slots are durable and never recycled: every invocation's freshness proof has a distinct ID.
    /* eslint-disable no-await-in-loop -- exclusive bounded slot allocation */
    for (let slot = 0; slot < 512; slot++) {
      const name = `observation-${slot}.intent.json`;
      if ((await this.read(plan, name)) !== null) continue;
      const intent = RecipeStepIntentSchema.parse(
        await createIntent(`sfp_internal:observe:${slot}`),
      );
      if (await this.create(plan, name, intent)) return intent;
    }
    /* eslint-enable no-await-in-loop */
    throw recipeError('RECIPE_OBSERVATION_CAPACITY');
  }
  async cancelled(plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>): Promise<boolean> {
    return (await this.read(plan, 'cancelled.json')) !== null;
  }
  async cancel(plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>): Promise<void> {
    await this.create(plan, 'cancelled.json', { planHash: recipeHash(plan) });
  }
}
