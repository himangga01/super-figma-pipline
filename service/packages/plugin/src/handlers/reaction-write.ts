import { z } from 'zod';

// Closed write shapes follow the installed Plugin API types. Read schemas retain future fields;
// a write must validate the whole shape before dispatch instead of silently dropping them.
const number = z.number().finite();
const id = z.string().min(1).max(512);
const vector = z.object({ x: number, y: number }).strict();
const easingTypes = [
  'EASE_IN',
  'EASE_OUT',
  'EASE_IN_AND_OUT',
  'LINEAR',
  'EASE_IN_BACK',
  'EASE_OUT_BACK',
  'EASE_IN_AND_OUT_BACK',
  'CUSTOM_CUBIC_BEZIER',
  'GENTLE',
  'QUICK',
  'BOUNCY',
  'SLOW',
  'CUSTOM_SPRING',
] as const;
const bezier = z.object({ x1: number, y1: number, x2: number, y2: number }).strict();
const easing = z
  .object({
    type: z.enum(easingTypes),
    easingFunctionCubicBezier: bezier.optional(),
    easingFunctionSpring: z
      .object({ mass: number, stiffness: number, damping: number, initialVelocity: number })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === 'CUSTOM_CUBIC_BEZIER' && !value.easingFunctionCubicBezier)
      context.addIssue({ code: 'custom', message: 'cubic easing requires its curve' });
    if (value.type === 'CUSTOM_SPRING' && !value.easingFunctionSpring)
      context.addIssue({ code: 'custom', message: 'spring easing requires its parameters' });
  });
const transition = z.union([
  z
    .object({
      type: z.enum(['DISSOLVE', 'SMART_ANIMATE', 'SCROLL_ANIMATE']),
      easing,
      duration: number.nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT']),
      direction: z.enum(['LEFT', 'RIGHT', 'TOP', 'BOTTOM']),
      matchLayers: z.boolean(),
      easing,
      duration: number.nonnegative(),
    })
    .strict(),
]);
const motionEasing = z
  .object({
    type: z.enum([...easingTypes, 'HOLD']),
    easingFunctionCubicBezier: bezier.optional(),
    easingFunctionSpring: z.object({ bounce: number }).strict().optional(),
  })
  .strict();
const variableData: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      type: z
        .enum([
          'BOOLEAN',
          'COLOR',
          'EASING',
          'EXPRESSION',
          'FLOAT',
          'STRING',
          'TIMING',
          'VARIABLE_ALIAS',
        ])
        .optional(),
      resolvedType: z.enum(['BOOLEAN', 'COLOR', 'EASING', 'FLOAT', 'STRING', 'TIMING']).optional(),
      value: z
        .union([
          z.boolean(),
          z.string().max(250_000),
          number,
          z.object({ r: number, g: number, b: number, a: number.optional() }).strict(),
          z.object({ type: z.literal('VARIABLE_ALIAS'), id }).strict(),
          motionEasing,
          z
            .object({
              expressionFunction: z.enum([
                'ADDITION',
                'SUBTRACTION',
                'MULTIPLICATION',
                'DIVISION',
                'EQUALS',
                'NOT_EQUAL',
                'LESS_THAN',
                'LESS_THAN_OR_EQUAL',
                'GREATER_THAN',
                'GREATER_THAN_OR_EQUAL',
                'AND',
                'OR',
                'VAR_MODE_LOOKUP',
                'NEGATE',
                'NOT',
              ]),
              expressionArguments: z.array(variableData).max(4096),
            })
            .strict(),
        ])
        .optional(),
    })
    .strict(),
);
const action: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(['BACK', 'CLOSE']) }).strict(),
    z
      .object({
        type: z.literal('URL'),
        url: z.string().max(250_000),
        openInNewTab: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('NODE'),
        destinationId: id.nullable(),
        navigation: z.enum(['NAVIGATE', 'SWAP', 'OVERLAY', 'SCROLL_TO', 'CHANGE_TO']),
        // Older callers omit the null transition; keep that bounded compatibility without inventing data.
        transition: transition.nullable().optional(),
        preserveScrollPosition: z.boolean().optional(),
        overlayRelativePosition: vector.optional(),
        resetVideoPosition: z.boolean().optional(),
        resetScrollPosition: z.boolean().optional(),
        resetInteractiveComponents: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('SET_VARIABLE'),
        variableId: id.nullable(),
        variableValue: variableData.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('SET_VARIABLE_MODE'),
        variableCollectionId: id.nullable(),
        variableModeId: id.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal('CONDITIONAL'),
        conditionalBlocks: z
          .array(
            z
              .object({ condition: variableData.optional(), actions: z.array(action).max(4096) })
              .strict(),
          )
          .max(4096),
      })
      .strict(),
    z
      .object({
        type: z.literal('UPDATE_MEDIA_RUNTIME'),
        destinationId: id.nullable(),
        mediaAction: z.enum([
          'PLAY',
          'PAUSE',
          'TOGGLE_PLAY_PAUSE',
          'MUTE',
          'UNMUTE',
          'TOGGLE_MUTE_UNMUTE',
        ]),
      })
      .strict(),
    z
      .object({
        type: z.literal('UPDATE_MEDIA_RUNTIME'),
        destinationId: id.nullable().optional(),
        mediaAction: z.enum(['SKIP_FORWARD', 'SKIP_BACKWARD']),
        amountToSkip: number,
      })
      .strict(),
    z
      .object({
        type: z.literal('UPDATE_MEDIA_RUNTIME'),
        destinationId: id.nullable().optional(),
        mediaAction: z.literal('SKIP_TO'),
        newTimestamp: number,
      })
      .strict(),
  ]),
);
const trigger = z
  .union([
    z
      .object({ type: z.enum(['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'ON_MEDIA_END']) })
      .strict(),
    z.object({ type: z.literal('AFTER_TIMEOUT'), timeout: number.nonnegative() }).strict(),
    z.object({ type: z.enum(['MOUSE_UP', 'MOUSE_DOWN']), delay: number.nonnegative() }).strict(),
    z
      .object({
        type: z.enum(['MOUSE_ENTER', 'MOUSE_LEAVE']),
        delay: number.nonnegative(),
        deprecatedVersion: z.boolean(),
      })
      .strict(),
    z
      .object({
        type: z.literal('ON_KEY_DOWN'),
        device: z.enum(['KEYBOARD', 'XBOX_ONE', 'PS4', 'SWITCH_PRO', 'UNKNOWN_CONTROLLER']),
        keyCodes: z.array(z.number().int().nonnegative()).max(256),
      })
      .strict(),
    z.object({ type: z.literal('ON_MEDIA_HIT'), mediaHitTime: number.nonnegative() }).strict(),
  ])
  .nullable();
const reaction = z.object({ trigger, actions: z.array(action).max(4096) }).strict();

export const boundReactionWrite = (value: unknown): void => {
  let values = 0,
    characters = 0;
  const ancestors = new Set<object>();
  const bound = (item: unknown, depth: number): void => {
    if (++values > 50_000 || depth > 24) throw new TypeError('REACTION_WRITE_VALUE_LIMIT');
    if (typeof item === 'string') {
      characters += item.length;
      if (characters > 250_000) throw new TypeError('REACTION_WRITE_VALUE_LIMIT');
    } else if (item !== null && typeof item === 'object') {
      if (ancestors.has(item)) throw new TypeError('REACTION_WRITE_VALUE_LIMIT');
      ancestors.add(item);
      if (Array.isArray(item) && item.length > 4096)
        throw new TypeError('REACTION_WRITE_VALUE_LIMIT');
      for (const child of Object.values(item)) bound(child, depth + 1);
      ancestors.delete(item);
    }
  };
  bound(value, 0);
};

export const parseReactionWrite = (value: unknown): Reaction => {
  boundReactionWrite(value);
  return reaction.parse(value) as unknown as Reaction;
};
