import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Node 24 strips TypeScript; source imports retain their eventual .js extension.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js') && specifier.startsWith('.') && context.parentURL) {
      const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (source.protocol === 'file:' && existsSync(fileURLToPath(source)))
        return nextResolve(source.href, context);
    }
    return nextResolve(specifier, context);
  },
});
