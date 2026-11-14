import { registerHooks } from 'node:module';

// Resolve this repository's trusted TypeScript modules, without executing imported artwork.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/app/src/') && !/\.[a-z]+$/i.test(specifier))
      return next(specifier + '.ts', context);
    // The vendored Fabric build the tests import, so app modules and tests share one instance.
    if (specifier === 'fabric' && context.parentURL?.includes('/app/src/'))
      return next(new URL('../vendor/fabric/dist/index.min.mjs', import.meta.url).href, context);
    return next(specifier, context);
  },
});
